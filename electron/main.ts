// IMPORTANT: This must be the very first code executed
// Patch process.stdout and process.stderr write methods to prevent EPIPE errors
const originalStdoutWrite = process.stdout.write;
const originalStderrWrite = process.stderr.write;

// Safely wrap write to handle EPIPE errors
process.stdout.write = function(
  chunk: string | Uint8Array, 
  encodingOrCallback?: string | Function,
  callback?: Function
): boolean {
  try {
    return originalStdoutWrite.apply(process.stdout, arguments as any);
  } catch (err: any) {
    if (err && err.code === 'EPIPE') {
      // Silently ignore EPIPE errors
      return true;
    }
    throw err;
  }
} as typeof process.stdout.write;

process.stderr.write = function(
  chunk: string | Uint8Array, 
  encodingOrCallback?: string | Function,
  callback?: Function
): boolean {
  try {
    return originalStderrWrite.apply(process.stderr, arguments as any);
  } catch (err: any) {
    if (err && err.code === 'EPIPE') {
      // Silently ignore EPIPE errors
      return true;
    }
    throw err;
  }
} as typeof process.stderr.write;

// Now import everything else
import { app, BrowserWindow, screen, shell, ipcMain, dialog, session } from "electron"
import path from "path"
import fs from "fs"
import { initializeIpcHandlers } from "./ipcHandlers"
import { ProcessingHelper } from "./ProcessingHelper"
import { ScreenshotHelper } from "./ScreenshotHelper"
import { ShortcutsHelper } from "./shortcuts"
import { initAutoUpdater } from "./autoUpdater"
import { configHelper } from "./ConfigHelper"
import * as dotenv from "dotenv"

// Global uncaughtException handler for EPIPE errors
process.on('uncaughtException', (error: NodeJS.ErrnoException) => {
  // If it's an EPIPE error, just suppress it
  if (error && typeof error === 'object' && error.code === 'EPIPE') {
    // Suppress EPIPE errors completely - they should never crash the app
    return;
  }
  
  // Also handle other non-fatal errors that should be suppressed
  const suppressibleErrors = [
    'ECONNRESET',  // Connection reset by peer
    'ECONNABORTED', // Connection aborted
    'ENOTCONN',    // Socket is not connected
    'ESHUTDOWN',   // Cannot send after socket shutdown
    'EPIPE',       // Broken pipe
    'EIO'          // I/O error
  ];
  
  if (error && typeof error === 'object' && error.code && suppressibleErrors.includes(error.code)) {
    // These network/IO errors should not crash the app
    try {
      process.stderr.write(`[Global handler] Suppressed non-fatal error: ${error.code}\n`);
    } catch (_) {
      // Silent if stderr fails
    }
    return;
  }
  
  // For all other errors, log them safely and rethrow
  try {
    const errorInfo = {
      name: error.name,
      message: error.message,
      stack: error.stack,
      code: error.code
    };
    process.stderr.write(`Uncaught exception: ${JSON.stringify(errorInfo, null, 2)}\n`);
  } catch (_) {
    // If we can't even log the error, we're in trouble but still continue
  }
  
  // Gracefully crash the app to prevent weird/undefined states
  if (app && typeof app.exit === 'function') {
    // Try to exit gracefully with non-zero code
    app.exit(1);
  } else {
    // If we can't access app, use process.exit as fallback
    process.exit(1);
  }
});

// Global console override to prevent EPIPE errors
const originalConsole = {
  log: console.log,
  error: console.error,
  warn: console.warn,
  info: console.info,
  debug: console.debug,
  trace: console.trace
};

// Simpler versions that don't need to catch EPIPE since our streams handle that
console.log = function(...args) {
  try {
    originalConsole.log.apply(console, args);
  } catch (err) {
    // Already using safe streams, but add extra protection
    try {
      process.stdout.write(args.map(a => String(a)).join(' ') + '\n');
    } catch (e) {
      // Silent failure
    }
  }
};

console.error = function(...args) {
  try {
    originalConsole.error.apply(console, args);
  } catch (err) {
    try {
      process.stderr.write(args.map(a => String(a)).join(' ') + '\n');
    } catch (e) {
      // Silent failure
    }
  }
};

console.warn = function(...args) {
  try {
    originalConsole.warn.apply(console, args);
  } catch (err) {
    try {
      process.stderr.write('[WARN] ' + args.map(a => String(a)).join(' ') + '\n');
    } catch (e) {
      // Silent failure
    }
  }
};

// Add overrides for other console methods
console.info = function(...args) {
  try {
    originalConsole.info.apply(console, args);
  } catch (err) {
    try {
      process.stdout.write('[INFO] ' + args.map(a => String(a)).join(' ') + '\n');
    } catch (e) {
      // Silent failure
    }
  }
};

console.debug = function(...args) {
  try {
    originalConsole.debug.apply(console, args);
  } catch (err) {
    try {
      process.stdout.write('[DEBUG] ' + args.map(a => String(a)).join(' ') + '\n');
    } catch (e) {
      // Silent failure
    }
  }
};

console.trace = function(...args) {
  try {
    originalConsole.trace.apply(console, args);
  } catch (err) {
    try {
      process.stderr.write('[TRACE] ' + args.map(a => String(a)).join(' ') + '\n');
    } catch (e) {
      // Silent failure
    }
  }
};

// Constants
const isDev = process.env.NODE_ENV === "development"

// Safe console logging to prevent EPIPE errors - keep for compatibility with existing code
export const safeLog = (...args: any[]) => {
  console.log(...args);
};

// Safe error logging - keep for compatibility with existing code
export const safeError = (...args: any[]) => {
  console.error(...args);
};

// Application State
const state = {
  // Window management properties
  mainWindow: null as BrowserWindow | null,
  isWindowVisible: false,
  windowPosition: null as { x: number; y: number } | null,
  windowSize: null as { width: number; height: number } | null,
  screenWidth: 0,
  screenHeight: 0,
  step: 0,
  currentX: 0,
  currentY: 0,

  // Application helpers
  screenshotHelper: null as ScreenshotHelper | null,
  shortcutsHelper: null as ShortcutsHelper | null,
  processingHelper: null as ProcessingHelper | null,

  // View and state management
  view: "queue" as "queue" | "solutions" | "debug",
  problemInfo: null as any,
  hasDebugged: false,

  // Processing events
  PROCESSING_EVENTS: {
    UNAUTHORIZED: "processing-unauthorized",
    NO_SCREENSHOTS: "processing-no-screenshots",
    OUT_OF_CREDITS: "out-of-credits",
    API_KEY_INVALID: "api-key-invalid",
    INITIAL_START: "initial-start",
    PROBLEM_EXTRACTED: "problem-extracted",
    SOLUTION_SUCCESS: "solution-success",
    INITIAL_SOLUTION_ERROR: "solution-error",
    DEBUG_START: "debug-start",
    DEBUG_SUCCESS: "debug-success",
    DEBUG_ERROR: "debug-error"
  } as const
}

// Add interfaces for helper classes
export interface IProcessingHelperDeps {
  getScreenshotHelper: () => ScreenshotHelper | null
  getMainWindow: () => BrowserWindow | null
  getView: () => "queue" | "solutions" | "debug"
  setView: (view: "queue" | "solutions" | "debug") => void
  getProblemInfo: () => any
  setProblemInfo: (info: any) => void
  getScreenshotQueue: () => string[]
  getExtraScreenshotQueue: () => string[]
  clearQueues: () => void
  takeScreenshot: () => Promise<string>
  getImagePreview: (filepath: string) => Promise<string>
  deleteScreenshot: (
    path: string
  ) => Promise<{ success: boolean; error?: string }>
  setHasDebugged: (value: boolean) => void
  getHasDebugged: () => boolean
  PROCESSING_EVENTS: typeof state.PROCESSING_EVENTS
}

export interface IShortcutsHelperDeps {
  getMainWindow: () => BrowserWindow | null
  takeScreenshot: () => Promise<string>
  getImagePreview: (filepath: string) => Promise<string>
  processingHelper: ProcessingHelper | null
  clearQueues: () => void
  setView: (view: "queue" | "solutions" | "debug") => void
  isVisible: () => boolean
  toggleMainWindow: () => void
  moveWindowLeft: () => void
  moveWindowRight: () => void
  moveWindowUp: () => void
  moveWindowDown: () => void
  toggleVoiceInput: () => void
}

export interface IIpcHandlerDeps {
  getMainWindow: () => BrowserWindow | null
  setWindowDimensions: (width: number, height: number) => void
  getScreenshotQueue: () => string[]
  getExtraScreenshotQueue: () => string[]
  deleteScreenshot: (
    path: string
  ) => Promise<{ success: boolean; error?: string }>
  getImagePreview: (filepath: string) => Promise<string>
  processingHelper: ProcessingHelper | null
  PROCESSING_EVENTS: typeof state.PROCESSING_EVENTS
  takeScreenshot: () => Promise<string>
  getView: () => "queue" | "solutions" | "debug"
  toggleMainWindow: () => void
  clearQueues: () => void
  setView: (view: "queue" | "solutions" | "debug") => void
  moveWindowLeft: () => void
  moveWindowRight: () => void
  moveWindowUp: () => void
  moveWindowDown: () => void
}

// Initialize helpers
function initializeHelpers() {
  state.screenshotHelper = new ScreenshotHelper(state.view)
  state.processingHelper = new ProcessingHelper({
    getScreenshotHelper,
    getMainWindow,
    getView,
    setView,
    getProblemInfo,
    setProblemInfo,
    getScreenshotQueue,
    getExtraScreenshotQueue,
    clearQueues,
    takeScreenshot,
    getImagePreview,
    deleteScreenshot,
    setHasDebugged,
    getHasDebugged,
    PROCESSING_EVENTS: state.PROCESSING_EVENTS
  } as IProcessingHelperDeps)
  state.shortcutsHelper = new ShortcutsHelper({
    getMainWindow,
    takeScreenshot,
    getImagePreview,
    processingHelper: state.processingHelper,
    clearQueues,
    setView,
    isVisible: () => state.isWindowVisible,
    toggleMainWindow,
    moveWindowLeft: () =>
      moveWindowHorizontal((x) =>
        Math.max(-(state.windowSize?.width || 0) / 2, x - state.step)
      ),
    moveWindowRight: () =>
      moveWindowHorizontal((x) =>
        Math.min(
          state.screenWidth - (state.windowSize?.width || 0) / 2,
          x + state.step
        )
      ),
    moveWindowUp: () => moveWindowVertical((y) => y - state.step),
    moveWindowDown: () => moveWindowVertical((y) => y + state.step),
    toggleVoiceInput
  } as IShortcutsHelperDeps)
}

// Auth callback handler

// Register the interview-coder protocol
if (process.platform === "darwin") {
  app.setAsDefaultProtocolClient("interview-coder")
} else {
  app.setAsDefaultProtocolClient("interview-coder", process.execPath, [
    path.resolve(process.argv[1] || "")
  ])
}

// Handle the protocol. In this case, we choose to show an Error Box.
if (process.defaultApp && process.argv.length >= 2) {
  app.setAsDefaultProtocolClient("interview-coder", process.execPath, [
    path.resolve(process.argv[1])
  ])
}

// Force Single Instance Lock
const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  app.quit()
} else {
  app.on("second-instance", (event, commandLine) => {
    // Someone tried to run a second instance, we should focus our window.
    if (state.mainWindow) {
      if (state.mainWindow.isMinimized()) state.mainWindow.restore()
      state.mainWindow.focus()

      // Protocol handler removed - no longer using auth callbacks
    }
  })
}

// Auth callback removed as we no longer use Supabase authentication

// Window management functions
async function createWindow(): Promise<void> {
  if (state.mainWindow) {
    if (state.mainWindow.isMinimized()) state.mainWindow.restore()
    state.mainWindow.focus()
    return
  }

  const primaryDisplay = screen.getPrimaryDisplay()
  const workArea = primaryDisplay.workAreaSize
  state.screenWidth = workArea.width
  state.screenHeight = workArea.height
  state.step = 60
  state.currentY = 50

  // Configure session for cross-origin isolation before window creation
  const ses = session.defaultSession;
  
  // Set COOP and COEP headers for cross-origin isolation
  ses.webRequest.onHeadersReceived((details, callback) => {
    // Create headers as Record<string, string[]> which is typical for modification
    const newHeaders: Record<string, string[]> = {}; 

    // Copy existing headers, ensuring lowercase keys and string[] values
    if (details.responseHeaders) {
      for (const key in details.responseHeaders) {
        if (Object.prototype.hasOwnProperty.call(details.responseHeaders, key)) {
          const value = details.responseHeaders[key];
          const lowerKey = key.toLowerCase();

          if (typeof value === 'string') {
            newHeaders[lowerKey] = [value]; // Convert string to string[]
          } else if (Array.isArray(value)) {
            newHeaders[lowerKey] = value; // Keep existing string[]
          }
          // Silently ignore headers with invalid types
        }
      }
    }

    // Add/overwrite the necessary COOP/COEP headers (lowercase, string[])
    newHeaders['cross-origin-opener-policy'] = ['same-origin'];
    newHeaders['cross-origin-embedder-policy'] = ['credentialless'];
    newHeaders['cross-origin-resource-policy'] = ['cross-origin'];

    // Use type assertion to bypass conflicting/inaccurate type definitions
    callback({ 
      responseHeaders: newHeaders as any 
    });
  });

  // Add log for debugging
  safeLog("Configured session with COOP and COEP:credentialless headers for cross-origin isolation");

  const windowSettings: Electron.BrowserWindowConstructorOptions = {
    width: 800,
    height: 600,
    minWidth: 750,
    minHeight: 550,
    x: state.currentX,
    y: 50,
    alwaysOnTop: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: isDev
        ? path.join(__dirname, "../dist-electron/preload.js")
        : path.join(__dirname, "preload.js"),
      scrollBounce: true,
      webSecurity: !isDev,
    },
    show: true,
    frame: false,
    transparent: true,
    fullscreenable: false,
    hasShadow: false,
    opacity: 1.0,  // Start with full opacity
    backgroundColor: "#00000000",
    focusable: true,
    skipTaskbar: true,
    type: "panel",
    paintWhenInitiallyHidden: true,
    titleBarStyle: "hidden",
    enableLargerThanScreen: true,
    movable: true
  }

  state.mainWindow = new BrowserWindow(windowSettings)

  // Additional configuration to allow SharedArrayBuffer
  state.mainWindow.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
    // Allow all permissions needed for audio capture and SharedArrayBuffer
    callback(true);
  });

  // Load extensions in development mode to help debug
  if (isDev) {
    try {
      state.mainWindow.webContents.session.setPermissionCheckHandler(() => true);
    } catch (e) {
      safeError("Error configuring permission check handler:", e);
    }
  }

  // Add more detailed logging for window events
  state.mainWindow.webContents.on("did-finish-load", () => {
    safeLog("Window finished loading")
  })
  state.mainWindow.webContents.on(
    "did-fail-load",
    async (event, errorCode, errorDescription) => {
      safeError("Window failed to load:", errorCode, errorDescription)
      if (isDev) {
        // In development, retry loading after a short delay
        safeLog("Retrying to load development server...")
        setTimeout(() => {
          state.mainWindow?.loadURL("http://localhost:54321").catch((error) => {
            safeError("Failed to load dev server on retry:", error)
          })
        }, 1000)
      }
    }
  )

  if (isDev) {
    // In development, load from the dev server
    safeLog("Loading from development server: http://localhost:54321")
    state.mainWindow.loadURL("http://localhost:54321").catch((error) => {
      safeError("Failed to load dev server, falling back to local file:", error)
      // Fallback to local file if dev server is not available
      const indexPath = path.join(__dirname, "../dist/index.html")
      safeLog("Falling back to:", indexPath)
      if (fs.existsSync(indexPath)) {
        state.mainWindow.loadFile(indexPath)
      } else {
        safeError("Could not find index.html in dist folder")
      }
    })
  } else {
    // In production, load from the built files
    const indexPath = path.join(__dirname, "../dist/index.html")
    safeLog("Loading production build:", indexPath)
    
    if (fs.existsSync(indexPath)) {
      state.mainWindow.loadFile(indexPath)
    } else {
      safeError("Could not find index.html in dist folder")
    }
  }

  // Configure window behavior
  state.mainWindow.webContents.setZoomFactor(1)
  if (isDev) {
    state.mainWindow.webContents.openDevTools()
  }
  state.mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    safeLog("Attempting to open URL:", url)
    try {
      const parsedURL = new URL(url);
      const hostname = parsedURL.hostname;
      const allowedHosts = ["google.com", "supabase.co"];
      if (allowedHosts.includes(hostname) || hostname.endsWith(".google.com") || hostname.endsWith(".supabase.co")) {
        shell.openExternal(url);
        return { action: "deny" }; // Do not open this URL in a new Electron window
      }
    } catch (error) {
      safeError("Invalid URL %d in setWindowOpenHandler: %d" , url , error);
      return { action: "deny" }; // Deny access as URL string is malformed or invalid
    }
    return { action: "allow" };
  })

  // Enhanced screen capture resistance
  state.mainWindow.setContentProtection(true)

  state.mainWindow.setVisibleOnAllWorkspaces(true, {
    visibleOnFullScreen: true
  })
  state.mainWindow.setAlwaysOnTop(true, "screen-saver", 1)

  // Additional screen capture resistance settings
  if (process.platform === "darwin") {
    // Prevent window from being captured in screenshots
    state.mainWindow.setHiddenInMissionControl(true)
    state.mainWindow.setWindowButtonVisibility(false)
    state.mainWindow.setBackgroundColor("#00000000")

    // Prevent window from being included in window switcher
    state.mainWindow.setSkipTaskbar(true)

    // Disable window shadow
    state.mainWindow.setHasShadow(false)
  }

  // Prevent the window from being captured by screen recording
  state.mainWindow.webContents.setBackgroundThrottling(false)
  state.mainWindow.webContents.setFrameRate(60)

  // Set up window listeners
  state.mainWindow.on("move", handleWindowMove)
  state.mainWindow.on("resize", handleWindowResize)
  state.mainWindow.on("closed", handleWindowClosed)

  // Initialize window state
  const bounds = state.mainWindow.getBounds()
  state.windowPosition = { x: bounds.x, y: bounds.y }
  state.windowSize = { width: bounds.width, height: bounds.height }
  state.currentX = bounds.x
  state.currentY = bounds.y
  state.isWindowVisible = true
  
  // Set opacity based on user preferences or hide initially
  // Ensure the window is visible for the first launch or if opacity > 0.1
  const savedOpacity = configHelper.getOpacity();
  safeLog(`Initial opacity from config: ${savedOpacity}`);
  
  // Always make sure window is shown first
  state.mainWindow.showInactive(); // Use showInactive for consistency
  
  if (savedOpacity <= 0.1) {
    safeLog('Initial opacity too low, setting to 0 and hiding window');
    state.mainWindow.setOpacity(0);
    state.isWindowVisible = false;
  } else {
    safeLog(`Setting initial opacity to ${savedOpacity}`);
    state.mainWindow.setOpacity(savedOpacity);
    state.isWindowVisible = true;
  }
}

function handleWindowMove(): void {
  if (!state.mainWindow) return
  const bounds = state.mainWindow.getBounds()
  state.windowPosition = { x: bounds.x, y: bounds.y }
  state.currentX = bounds.x
  state.currentY = bounds.y
}

function handleWindowResize(): void {
  if (!state.mainWindow) return
  const bounds = state.mainWindow.getBounds()
  state.windowSize = { width: bounds.width, height: bounds.height }
}

function handleWindowClosed(): void {
  state.mainWindow = null
  state.isWindowVisible = false
  state.windowPosition = null
  state.windowSize = null
}

// Window visibility functions
function hideMainWindow(): void {
  if (!state.mainWindow?.isDestroyed()) {
    const bounds = state.mainWindow.getBounds();
    state.windowPosition = { x: bounds.x, y: bounds.y };
    state.windowSize = { width: bounds.width, height: bounds.height };
    state.mainWindow.setIgnoreMouseEvents(true, { forward: true });
    state.mainWindow.setOpacity(0);
    state.isWindowVisible = false;
    safeLog('Window hidden, opacity set to 0');
  }
}

function showMainWindow(): void {
  if (!state.mainWindow?.isDestroyed()) {
    if (state.windowPosition && state.windowSize) {
      state.mainWindow.setBounds({
        ...state.windowPosition,
        ...state.windowSize
      });
    }
    state.mainWindow.setIgnoreMouseEvents(false);
    state.mainWindow.setAlwaysOnTop(true, "screen-saver", 1);
    state.mainWindow.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true
    });
    state.mainWindow.setContentProtection(true);
    state.mainWindow.setOpacity(0); // Set opacity to 0 before showing
    state.mainWindow.showInactive(); // Use showInactive instead of show+focus
    state.mainWindow.setOpacity(1); // Then set opacity to 1 after showing
    state.isWindowVisible = true;
    safeLog('Window shown with showInactive(), opacity set to 1');
  }
}

function toggleMainWindow(): void {
  safeLog(`Toggling window. Current state: ${state.isWindowVisible ? 'visible' : 'hidden'}`);
  if (state.isWindowVisible) {
    hideMainWindow();
  } else {
    showMainWindow();
  }
}

// Window movement functions
function moveWindowHorizontal(updateFn: (x: number) => number): void {
  if (!state.mainWindow) return
  state.currentX = updateFn(state.currentX)
  state.mainWindow.setPosition(
    Math.round(state.currentX),
    Math.round(state.currentY)
  )
}

function moveWindowVertical(updateFn: (y: number) => number): void {
  if (!state.mainWindow) return

  const newY = updateFn(state.currentY)
  // Allow window to go 2/3 off screen in either direction
  const maxUpLimit = (-(state.windowSize?.height || 0) * 2) / 3
  const maxDownLimit =
    state.screenHeight + ((state.windowSize?.height || 0) * 2) / 3

  // Log the current state and limits
  safeLog({
    newY,
    maxUpLimit,
    maxDownLimit,
    screenHeight: state.screenHeight,
    windowHeight: state.windowSize?.height,
    currentY: state.currentY
  })

  // Only update if within bounds
  if (newY >= maxUpLimit && newY <= maxDownLimit) {
    state.currentY = newY
    state.mainWindow.setPosition(
      Math.round(state.currentX),
      Math.round(state.currentY)
    )
  }
}

// Window dimension functions
function setWindowDimensions(width: number, height: number): void {
  if (!state.mainWindow?.isDestroyed()) {
    const [currentX, currentY] = state.mainWindow.getPosition()
    const primaryDisplay = screen.getPrimaryDisplay()
    const workArea = primaryDisplay.workAreaSize
    const maxWidth = Math.floor(workArea.width * 0.5)

    state.mainWindow.setBounds({
      x: Math.min(currentX, workArea.width - maxWidth),
      y: currentY,
      width: Math.min(width + 32, maxWidth),
      height: Math.ceil(height)
    })
  }
}

// Environment setup
function loadEnvVariables() {
  if (isDev) {
    safeLog("Loading env variables from:", path.join(process.cwd(), ".env"))
    dotenv.config({ path: path.join(process.cwd(), ".env") })
  } else {
    safeLog(
      "Loading env variables from:",
      path.join(process.resourcesPath, ".env")
    )
    dotenv.config({ path: path.join(process.resourcesPath, ".env") })
  }
  safeLog("Environment variables loaded for open-source version")
}

// --- Placeholder for Audio Capture State ---
let isCapturingAudio = false;
let stopCaptureFunction: (() => Promise<void>) | null = null; // Function to stop platform capture

// --- Platform-Specific Audio Capture Functions ---

async function startMacAudioCapture(webContents: Electron.WebContents): Promise<() => Promise<void>> {
  safeLog('Attempting to start macOS audio capture...');
  
  // Removed check for 'screen' permission as it's not the correct API call
  // and actual permission depends on the native capture method used.
  // The native module integration itself should handle errors due to permissions.

  // --- Integration Point for macOS native module --- 
  // TODO: Replace placeholder with actual native module integration
  safeLog("macOS native audio capture not implemented yet.");
  const intervalId = setInterval(() => {
      if (!isCapturingAudio || !webContents || webContents.isDestroyed()) {
          clearInterval(intervalId);
          isCapturingAudio = false; 
          stopCaptureFunction = null;
          return;
      }
      const dummyChunk = new Float32Array(1024).fill(Math.random() * 0.2 - 0.1);
      if (webContents && !webContents.isDestroyed()) {
          // Ensure conversion to ArrayBuffer before sending if needed (dummy already is)
          webContents.send('audio-data-chunk', dummyChunk.buffer);
      }
  }, 250); 

  const stopFnPlaceholder = async () => {
      safeLog('Stopping macOS placeholder audio capture...');
      clearInterval(intervalId);
      stopCaptureFunction = null;
  };
  return stopFnPlaceholder;
}

async function startWindowsAudioCapture(webContents: Electron.WebContents): Promise<() => Promise<void>> {
   safeLog('Attempting to start Windows audio capture...');
   // --- Integration Point for Windows native module/method --- 
   // TODO: Replace placeholder
   safeLog("Windows native audio capture not implemented yet.");
    const intervalId = setInterval(() => {
        if (!isCapturingAudio || !webContents || webContents.isDestroyed()) {
            clearInterval(intervalId);
            isCapturingAudio = false;
            stopCaptureFunction = null;
            return;
        }
        const dummyChunk = new Float32Array(1024).fill(Math.random() * 0.2 - 0.1); 
        if (webContents && !webContents.isDestroyed()) {
            webContents.send('audio-data-chunk', dummyChunk.buffer);
        }
    }, 250); 
    const stopFnPlaceholder = async () => { 
        safeLog('Stopping Windows placeholder audio capture...');
        clearInterval(intervalId); 
        stopCaptureFunction = null;
    }; 
    // stopCaptureFunction = stopFnPlaceholder;
    return stopFnPlaceholder;
}

async function startLinuxAudioCapture(webContents: Electron.WebContents): Promise<() => Promise<void>> {
    safeLog('Attempting to start Linux audio capture...');
    // --- Integration Point for Linux ALSA/PulseAudio loopback --- 
    // TODO: Replace placeholder
    safeLog("Linux native audio capture not implemented yet.");
    const intervalId = setInterval(() => { 
        if (!isCapturingAudio || !webContents || webContents.isDestroyed()) {
            clearInterval(intervalId);
            isCapturingAudio = false;
            stopCaptureFunction = null;
            return;
        }
        const dummyChunk = new Float32Array(1024).fill(Math.random() * 0.2 - 0.1); 
         if (webContents && !webContents.isDestroyed()) {
             webContents.send('audio-data-chunk', dummyChunk.buffer);
         }
    }, 250); 
    const stopFnPlaceholder = async () => { 
        safeLog('Stopping Linux placeholder audio capture...');
        clearInterval(intervalId); 
        stopCaptureFunction = null;
    }; 
    // stopCaptureFunction = stopFnPlaceholder;
    return stopFnPlaceholder;
}


// --- Updated IPC Handlers for Audio ---
ipcMain.handle('start-audio-capture', async (event) => {
  if (isCapturingAudio) {
    safeLog('Audio capture already in progress.');
    return { success: true, message: 'Already capturing' };
  }
  safeLog('IPC: Received start-audio-capture request.');

  const mainWindow = getMainWindow(); // Use your existing function to get the window
  if (!mainWindow || mainWindow.isDestroyed()) {
      safeError('Cannot start audio capture: Main window not available.');
      return { success: false, error: 'Main window not available' };
  }

  try {
    isCapturingAudio = true; // Set flag early
    let platformStopFunction: () => Promise<void>;

    switch (process.platform) {
        case 'darwin': // macOS
            platformStopFunction = await startMacAudioCapture(mainWindow.webContents);
            break;
        case 'win32': // Windows
            platformStopFunction = await startWindowsAudioCapture(mainWindow.webContents);
            break;
        case 'linux': // Linux
            platformStopFunction = await startLinuxAudioCapture(mainWindow.webContents);
            break;
        default:
            throw new Error(`Unsupported platform for audio capture: ${process.platform}`);
    }
    stopCaptureFunction = platformStopFunction; // Store the specific stop function
    safeLog(`Audio capture started successfully for ${process.platform}.`);
    return { success: true, message: `Capture started for ${process.platform}` };

  } catch (error: any) {
      safeError('Failed to start audio capture:', error);
      isCapturingAudio = false; // Reset flag on error
      stopCaptureFunction = null;
      return { success: false, error: error.message || 'Unknown error starting audio capture' };
  }
});

ipcMain.handle('stop-audio-capture', async (event) => {
  if (!isCapturingAudio) {
    safeLog('Audio capture is not in progress.');
    return { success: true, message: 'Was not capturing' };
  }
  safeLog('IPC: Received stop-audio-capture request.');

  if (stopCaptureFunction) {
      try {
          await stopCaptureFunction(); // Call the stored platform-specific stop function
          safeLog('Platform audio capture stopped successfully.');
      } catch (error: any) {
          safeError('Error stopping platform audio capture:', error);
          // Continue cleanup even if platform stop failed
      }
  } else {
      safeLog('No active stop function found, cleaning up flags only.');
  }

  isCapturingAudio = false; // Ensure flag is reset
  stopCaptureFunction = null; // Clear stored function

  return { success: true, message: 'Capture stop request processed.' };
});

// Initialize application
async function initializeApp() {
  try {
    // Set custom cache directory to prevent permission issues
    const appDataPath = path.join(app.getPath('appData'), 'interview-coder-v1')
    const sessionPath = path.join(appDataPath, 'session')
    const tempPath = path.join(appDataPath, 'temp')
    const cachePath = path.join(appDataPath, 'cache')
    
    // Create directories if they don't exist
    for (const dir of [appDataPath, sessionPath, tempPath, cachePath]) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }
    }
    
    app.setPath('userData', appDataPath)
    app.setPath('sessionData', sessionPath)      
    app.setPath('temp', tempPath)
    app.setPath('cache', cachePath)
      
    loadEnvVariables()
    
    // Ensure a configuration file exists
    if (!configHelper.hasApiKey()) {
      safeLog("No API key found in configuration. User will need to set up.")
    }
    
    initializeHelpers()
    initializeIpcHandlers({
      getMainWindow,
      setWindowDimensions,
      getScreenshotQueue,
      getExtraScreenshotQueue,
      deleteScreenshot,
      getImagePreview,
      processingHelper: state.processingHelper,
      PROCESSING_EVENTS: state.PROCESSING_EVENTS,
      takeScreenshot,
      getView,
      toggleMainWindow,
      clearQueues,
      setView,
      moveWindowLeft: () =>
        moveWindowHorizontal((x) =>
          Math.max(-(state.windowSize?.width || 0) / 2, x - state.step)
        ),
      moveWindowRight: () =>
        moveWindowHorizontal((x) =>
          Math.min(
            state.screenWidth - (state.windowSize?.width || 0) / 2,
            x + state.step
          )
        ),
      moveWindowUp: () => moveWindowVertical((y) => y - state.step),
      moveWindowDown: () => moveWindowVertical((y) => y + state.step)
    })
    await createWindow()

    // --- Test loading and calling the native macOS audio module ---
    if (process.platform === 'darwin') { // Only run on macOS
      try {
        // Construct path relative to the current file (__dirname in main.ts)
        // __dirname points to the directory containing the executing JS file (e.g., dist-electron)
        const basePath = isDev 
          ? path.resolve(__dirname, '..') // Go up one level from dist-electron to project root in dev
          : process.resourcesPath; // Production path might still need adjustment
          
        const modulePath = path.join(basePath, 'native-modules/macos/build/Release/audio_capture_macos.node');
        
        safeLog(`Attempting to load native module from: ${modulePath}`);
        const nativeAudio = require(modulePath);
        safeLog("Native macOS module loaded successfully.");

        // --- Test Device Listing ---
        const devices = nativeAudio.listDevices();
        safeLog("Available Audio Devices (macOS):");
        let targetDeviceUID = ""; // Store the UID to use for capture
        if (Array.isArray(devices)) {
            devices.forEach((device, index) => {
                safeLog(`  [${index}] ID: ${device.id}, Name: ${device.name}`);
                // ----> CHOOSE YOUR TARGET DEVICE HERE <---- 
                // Example: Use Microsoft Teams Audio if found, otherwise default to first device
                if (device.name === "Microsoft Teams Audio") {
                    targetDeviceUID = device.id;
                } else if (!targetDeviceUID && index === 0) {
                    // Fallback to the first device if specific one not found
                    // targetDeviceUID = device.id; // Uncomment to fallback
                } 
                // Or uncomment below to hardcode an ID if needed:
                // targetDeviceUID = "MSLoopbackDriverDevice_UID"; 
            });
        } else {
            safeLog(devices); // Log as is if not an array
        }
        // --------------------------

        // --- Test Start/Stop Capture ---
        if (!targetDeviceUID) {
            safeError("No target device UID selected or found for capture test.");
        } else {
            safeLog(`Selected Target Device UID for capture: ${targetDeviceUID}`);
            
            const dummyDataCallback = (audioChunk: ArrayBuffer) => {
                try {
                    // Later: This will receive ArrayBuffer data from the native side
                    // For now, it might not be called until ThreadSafeFunction is set up
                    safeLog("JavaScript dummyDataCallback received chunk (size: " + audioChunk.byteLength + ")");

                    // --- Add any actual processing logic here within the try block ---
                    // Example: Convert to Float32Array
                    // const floatArray = new Float32Array(audioChunk);
                    // Send to renderer, etc.
                    // getMainWindow()?.webContents.send('audio-data', floatArray); // Example
                    // -------------------------------------------------------------

                } catch (jsError) {
                    safeError("Error inside JavaScript audio callback:", jsError);
                }
            };
            
            try {
                safeLog("Attempting to start capture...");
                const startSuccess = nativeAudio.startCapture(targetDeviceUID, dummyDataCallback);
                if (startSuccess) {
                    safeLog("nativeAudio.startCapture call succeeded. Capture should be active.");

                    // Schedule stop capture after a delay
                    setTimeout(() => {
                        try {
                            safeLog("Attempting to stop capture...");
                            const stopSuccess = nativeAudio.stopCapture();
                            if (stopSuccess) {
                                safeLog("nativeAudio.stopCapture call succeeded.");
                            } else {
                                safeLog("nativeAudio.stopCapture call returned false (or threw).");
                            }
                        } catch (stopError) {
                             safeError("Error calling nativeAudio.stopCapture:", stopError);
                        }
                    }, 5000); // Stop after 5 seconds

                } else {
                    safeLog("nativeAudio.startCapture call returned false (or threw).");
                }
            } catch(startError) {
                safeError("Error calling nativeAudio.startCapture:", startError);
            }
        }
        // ----------------------------

      } catch (error) {
        safeError("Failed to load or call native macOS audio module:", error);
      }
    }
    // --- End test code ---

    state.shortcutsHelper?.registerGlobalShortcuts()

    // Initialize auto-updater regardless of environment
    initAutoUpdater()
    safeLog(
      "Auto-updater initialized in",
      isDev ? "development" : "production",
      "mode"
    )
  } catch (error) {
    safeError("Failed to initialize application:", error)
    app.quit()
  }
}

// App event handlers
app.on("open-url", (event, url) => {
  safeLog("open-url event received:", url)
  event.preventDefault()
})

// Handle second instance (removed auth callback handling)
app.on("second-instance", (event, commandLine) => {
  safeLog("second-instance event received:", commandLine)
  
  // Focus or create the main window
  if (!state.mainWindow) {
    createWindow()
  } else {
    if (state.mainWindow.isMinimized()) state.mainWindow.restore()
    state.mainWindow.focus()
  }
})

// Prevent multiple instances of the app
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit()
      state.mainWindow = null
    }
  })
}

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

// State getter/setter functions
function getMainWindow(): BrowserWindow | null {
  return state.mainWindow
}

function getView(): "queue" | "solutions" | "debug" {
  return state.view
}

function setView(view: "queue" | "solutions" | "debug"): void {
  state.view = view
  state.screenshotHelper?.setView(view)
}

function getScreenshotHelper(): ScreenshotHelper | null {
  return state.screenshotHelper
}

function getProblemInfo(): any {
  return state.problemInfo
}

function setProblemInfo(problemInfo: any): void {
  state.problemInfo = problemInfo
}

function getScreenshotQueue(): string[] {
  return state.screenshotHelper?.getScreenshotQueue() || []
}

function getExtraScreenshotQueue(): string[] {
  return state.screenshotHelper?.getExtraScreenshotQueue() || []
}

function clearQueues(): void {
  state.screenshotHelper?.clearQueues()
  state.problemInfo = null
  setView("queue")
}

async function takeScreenshot(): Promise<string> {
  if (!state.mainWindow) throw new Error("No main window available")
  return (
    state.screenshotHelper?.takeScreenshot(
      () => hideMainWindow(),
      () => showMainWindow()
    ) || ""
  )
}

async function getImagePreview(filepath: string): Promise<string> {
  return state.screenshotHelper?.getImagePreview(filepath) || ""
}

async function deleteScreenshot(
  path: string
): Promise<{ success: boolean; error?: string }> {
  return (
    state.screenshotHelper?.deleteScreenshot(path) || {
      success: false,
      error: "Screenshot helper not initialized"
    }
  )
}

function setHasDebugged(value: boolean): void {
  state.hasDebugged = value
}

function getHasDebugged(): boolean {
  return state.hasDebugged
}

// Add this function
function toggleVoiceInput(): void {
  const mainWindow = getMainWindow();
  if (mainWindow && !mainWindow.isDestroyed()) {
    safeLog("Toggling voice input in renderer...");
    mainWindow.webContents.send("toggle-voice-input");
  }
}

// Export state and functions for other modules
export {
  state,
  createWindow,
  hideMainWindow,
  showMainWindow,
  toggleMainWindow,
  setWindowDimensions,
  moveWindowHorizontal,
  moveWindowVertical,
  getMainWindow,
  getView,
  setView,
  getScreenshotHelper,
  getProblemInfo,
  setProblemInfo,
  getScreenshotQueue,
  getExtraScreenshotQueue,
  clearQueues,
  takeScreenshot,
  getImagePreview,
  deleteScreenshot,
  setHasDebugged,
  getHasDebugged,
  toggleVoiceInput
}

app.whenReady().then(initializeApp)
