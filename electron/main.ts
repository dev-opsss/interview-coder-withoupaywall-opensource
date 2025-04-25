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

// Add a global variable to track the native module
let macAudioModule: any = null;

async function startMacAudioCapture(webContents: Electron.WebContents): Promise<() => Promise<void>> {
  safeLog('Attempting to start macOS audio capture...');
  
  // If we haven't loaded the native module yet, try to load it
  if (!macAudioModule) {
    try {
      // Improved path resolution for native module with multiple fallback paths
      const possibleModulePaths = [
        // Production paths
        path.join(process.resourcesPath, 'native-modules', 'macos', 'build', 'Release', 'audio_capture_macos.node'),
        
        // Development paths
        path.join(__dirname, '..', 'native-modules', 'macos', 'build', 'Release', 'audio_capture_macos.node'),
        path.join(process.cwd(), 'native-modules', 'macos', 'build', 'Release', 'audio_capture_macos.node'),
        
        // Additional fallbacks for different directory structures
        path.join(app.getAppPath(), 'native-modules', 'macos', 'build', 'Release', 'audio_capture_macos.node'),
        path.join(path.dirname(app.getPath('exe')), 'native-modules', 'macos', 'build', 'Release', 'audio_capture_macos.node')
      ];
      
      safeLog("Looking for audio_capture_macos.node in these locations:");
      possibleModulePaths.forEach(p => safeLog(' - ' + p));
      
      // Try each path until we find the module
      for (const candidatePath of possibleModulePaths) {
        try {
          if (fs.existsSync(candidatePath)) {
            safeLog(`Found native module at: ${candidatePath}`);
            macAudioModule = require(candidatePath);
            break;
          }
        } catch (pathError) {
          // Continue to the next path
        }
      }
      
      if (!macAudioModule) {
        throw new Error(`Native module not found in any of the expected locations`);
      }
      
      safeLog("Native macOS audio module loaded successfully!");
    } catch (loadError) {
      safeError("Failed to load native macOS audio module:", loadError);
      
      // Send notification to user about missing module instead of generating dummy data
      if (webContents && !webContents.isDestroyed()) {
        webContents.send('audio-capture-error', {
          type: 'module_not_found',
          message: 'Audio capture module could not be loaded. Audio transcription may not work properly.',
          details: loadError.message || 'Unknown error loading audio module',
          troubleshooting: [
            'Try reinstalling the application',
            'Check if your system supports native modules'
          ]
        });
      }
      
      // Return a no-op stop function
      return async () => {
        safeLog('No audio capture to stop (module was not loaded)');
      };
    }
  }
  
  try {
    // Get available audio devices
    const devices = macAudioModule.listDevices();
    safeLog("Available Audio Devices:");
    
    // Look for Microsoft Teams Audio driver
    let foundTeamsDriver = false;
    let foundAnyDevice = false;
    
    if (Array.isArray(devices) && devices.length > 0) {
      foundAnyDevice = true;
      devices.forEach((device: any, index: number) => {
        safeLog(`  [${index}] ID: ${device.id}, Name: ${device.name}`);
        if (device.name.includes("Microsoft Teams Audio") || device.id.includes("MSLoopbackDriverDevice_UID")) {
          foundTeamsDriver = true;
          safeLog(`Found Microsoft Teams Audio driver: ${device.name}`);
        }
      });
    }
    
    if (!foundAnyDevice) {
      throw new Error("No audio capture devices found");
    }
    
    if (!foundTeamsDriver) {
      safeLog("Microsoft Teams Audio driver not found. Will use default input device.");
    }
    
    // Create the audio callback function
    const audioCallback = (audioData: any) => {
      try {
        if (!isCapturingAudio || !webContents || webContents.isDestroyed()) {
          return;
        }
        
        // Check if the data is in the expected format
        if (audioData && audioData.data) {
          // Send to renderer
          webContents.send('audio-data-chunk', audioData.data.buffer);
          
          // Log occasionally (not every frame to avoid console spam)
          if (Math.random() < 0.001) {  // Reduced from 0.01 to 0.001 (log ~0.1% of frames)
            safeLog(`Audio data received: ${audioData.data.length} samples`);
          }
        }
      } catch (callbackError) {
        safeError("Error in audio callback:", callbackError);
      }
    };
    
    // Start audio capture with the native module
    safeLog("Starting audio capture with native module...");
    const options = {
      generateTestTone: false // Set to true for testing without actual audio input
    };
    
    const result = macAudioModule.startCapture(audioCallback, options);
    if (!result) {
      throw new Error("Failed to start audio capture");
    }
    
    safeLog("Native audio capture started successfully!");
    
    // Send success notification to the renderer
    if (webContents && !webContents.isDestroyed()) {
      webContents.send('audio-capture-status', {
        status: 'started',
        usingTeamsDriver: foundTeamsDriver,
        message: foundTeamsDriver ? 
          'Audio capture started using Microsoft Teams driver (system audio)' : 
          'Audio capture started using microphone'
      });
    }
    
    // Return the stop function
    return async () => {
      safeLog("Stopping native audio capture...");
      try {
        macAudioModule.stopCapture();
        safeLog("Native audio capture stopped successfully");
        
        // Notify renderer that capture is stopped
        if (webContents && !webContents.isDestroyed()) {
          webContents.send('audio-capture-status', {
            status: 'stopped',
            message: 'Audio capture stopped'
          });
        }
      } catch (stopError) {
        safeError("Error stopping native audio capture:", stopError);
      }
    };
  } catch (startError) {
    safeError("Error starting native audio capture:", startError);
    
    // Check if the error is related to permissions
    const errorMessage = startError.message || 'Unknown error';
    const isPermissionError = errorMessage.includes('permission') || 
                            errorMessage.includes('denied') ||
                            errorMessage.includes('access');
    
    // Send notification to user about the error
    if (webContents && !webContents.isDestroyed()) {
      webContents.send('audio-capture-error', {
        type: isPermissionError ? 'permission_denied' : 'capture_failed',
        message: isPermissionError ? 
          'Microphone permission denied. Please check your system privacy settings.' :
          'Failed to start audio capture.',
        details: errorMessage,
        troubleshooting: isPermissionError ? [
          '1. Open System Settings > Privacy & Security > Microphone',
          '2. Ensure this application is allowed to access the microphone',
          '3. Restart the application after granting permission'
        ] : [
          'Check if your audio devices are properly connected',
          'Try installing Microsoft Teams to enable system audio capture',
          'Restart the application and try again'
        ]
      });
    }
    
    // Return a no-op stop function
    return async () => {
      safeLog('No audio capture to stop (failed to start)');
    };
  }
}

async function startWindowsAudioCapture(webContents: Electron.WebContents): Promise<() => Promise<void>> {
   safeLog('Attempting to start Windows audio capture...');
   // --- Integration Point for Windows native module/method --- 
   safeLog("Windows native audio capture not implemented yet.");
   
   // Send notification to user about missing implementation
   if (webContents && !webContents.isDestroyed()) {
     webContents.send('audio-capture-error', {
       type: 'not_implemented',
       message: 'Windows audio capture is not yet implemented.',
       details: 'This feature is coming in a future update.',
       troubleshooting: [
         'Use macOS for audio capture features',
         'Check for application updates'
       ]
     });
   }
   
   // Return a no-op stop function
   return async () => {
     safeLog('No Windows audio capture to stop (not implemented)');
   };
}

async function startLinuxAudioCapture(webContents: Electron.WebContents): Promise<() => Promise<void>> {
    safeLog('Attempting to start Linux audio capture...');
    // --- Integration Point for Linux ALSA/PulseAudio loopback --- 
    safeLog("Linux native audio capture not implemented yet.");
    
    // Send notification to user about missing implementation
    if (webContents && !webContents.isDestroyed()) {
      webContents.send('audio-capture-error', {
        type: 'not_implemented',
        message: 'Linux audio capture is not yet implemented.',
        details: 'This feature is coming in a future update.',
        troubleshooting: [
          'Use macOS for audio capture features',
          'Check for application updates'
        ]
      });
    }
    
    // Return a no-op stop function
    return async () => {
      safeLog('No Linux audio capture to stop (not implemented)');
    };
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

async function getConfig() {
  try {
    const userDataPath = app.getPath("userData")
    const configPath = path.join(userDataPath, "config.json")
    
    if (fs.existsSync(configPath)) {
      const configData = await fs.promises.readFile(configPath, "utf8")
      return JSON.parse(configData)
    } else {
      // Create default config
      const defaultConfig = { apiKey: "", model: "gpt-4" }
      await fs.promises.writeFile(
        configPath,
        JSON.stringify(defaultConfig, null, 2),
        "utf8"
      )
      return defaultConfig
    }
  } catch (error) {
    console.error("Error loading config:", error)
    return { apiKey: "", model: "gpt-4" }
  }
}

// Add saveConfig function
async function saveConfig(config: Config) {
  try {
    const userDataPath = app.getPath("userData")
    const configPath = path.join(userDataPath, "config.json")
    await fs.promises.writeFile(
      configPath,
      JSON.stringify(config, null, 2),
      "utf8"
    )
    return true
  } catch (error) {
    console.error("Error saving config:", error)
    return false
  }
}

// Update Config interface (add before getConfig if it exists, otherwise add it here)
interface Config {
  apiKey?: string;
  model?: string;
  language?: string;
  opacity?: number;
  googleSpeechApiKey?: string;
  speechService?: string;
  // Add any other existing properties here
}

// Add the handlers for Google Speech API
ipcMain.handle('getGoogleSpeechApiKey', async () => {
  const config = await getConfig();
  return config.googleSpeechApiKey || null;
});

ipcMain.handle('saveGoogleSpeechApiKey', async (_, apiKey) => {
  const config = await getConfig();
  config.googleSpeechApiKey = apiKey;
  await saveConfig(config);
  return true;
});

ipcMain.handle('getSpeechService', async () => {
  const config = await getConfig();
  return config.speechService || 'whisper';
});

ipcMain.handle('saveSpeechService', async (_, service) => {
  const config = await getConfig();
  config.speechService = service;
  await saveConfig(config);
  return true;
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
        // Improved path resolution for native module with multiple fallback paths
        const possibleModulePaths = [
          // Production paths
          path.join(process.resourcesPath, 'native-modules', 'macos', 'build', 'Release', 'audio_capture_macos.node'),
          
          // Development paths
          path.join(__dirname, '..', 'native-modules', 'macos', 'build', 'Release', 'audio_capture_macos.node'),
          path.join(process.cwd(), 'native-modules', 'macos', 'build', 'Release', 'audio_capture_macos.node'),
          
          // Additional fallbacks for different directory structures
          path.join(app.getAppPath(), 'native-modules', 'macos', 'build', 'Release', 'audio_capture_macos.node'),
          path.join(path.dirname(app.getPath('exe')), 'native-modules', 'macos', 'build', 'Release', 'audio_capture_macos.node')
        ];
        
        safeLog("Checking these paths for audio_capture_macos.node:");
        possibleModulePaths.forEach(p => safeLog(' - ' + p));
        
        // Try each path until we find the module
        let nativeAudio = null;
        let modulePath = '';
        
        for (const candidatePath of possibleModulePaths) {
          try {
            if (fs.existsSync(candidatePath)) {
              modulePath = candidatePath;
              safeLog(`Found native module at: ${modulePath}`);
              nativeAudio = require(modulePath);
              break;
            }
          } catch (pathError) {
            // Continue to the next path
          }
        }
        
        if (!nativeAudio) {
          throw new Error(`Native module not found in any of the expected locations`);
        }
        
        safeLog("Native macOS module loaded successfully.");

        // --- Test Device Listing ---
        const devices = nativeAudio.listDevices();
        safeLog("Available Audio Devices (macOS):");
        let targetDeviceUID = ""; // Store the UID to use for capture
        if (Array.isArray(devices)) {
            devices.forEach((device, index) => {
                safeLog(`  [${index}] ID: ${device.id}, Name: ${device.name}`);
                // Prioritize Microsoft Teams Audio driver if available
                if (device.name.includes("Microsoft Teams Audio") || device.id.includes("MSLoopbackDriverDevice_UID")) {
                    targetDeviceUID = device.id;
                    safeLog(`Found Microsoft Teams Audio driver: ${device.name}`);
                } else if (!targetDeviceUID && index === 0) {
                    // Fallback to the first device if Teams driver not found
                    targetDeviceUID = device.id;
                }
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
            
            const dummyDataCallback = (audioChunk: any) => {
                try {
                    // Later: This will receive ArrayBuffer data from the native side
                    // For now, it might not be called until ThreadSafeFunction is set up
                    if (Math.random() < 0.001) { // Add throttling to reduce log frequency
                        safeLog("JavaScript dummyDataCallback received chunk " + 
                              (audioChunk.data ? `(size: ${audioChunk.data.length} samples)` : "(no data)"));
                    }

                    // --- Add any actual processing logic here within the try block ---
                    // Example: Access Float32Array data
                    if (audioChunk && audioChunk.data) {
                        const floatArray = audioChunk.data;
                        // Send to renderer if needed
                        // getMainWindow()?.webContents.send('audio-data', floatArray); // Example
                    }
                    // -------------------------------------------------------------

                } catch (jsError) {
                    safeError("Error inside JavaScript audio callback:", jsError);
                }
            };
            
            try {
                safeLog("Attempting to start capture...");
                const options = { generateTestTone: false }; // Set to true for testing without actual audio input
                const startSuccess = nativeAudio.startCapture(dummyDataCallback, options);
                
                if (startSuccess) {
                    safeLog("nativeAudio.startCapture call succeeded. Capture should be active.");

                    // Schedule stop capture after a delay
                    setTimeout(() => {
                        try {
                            safeLog("Attempting to stop capture...");
                            nativeAudio.stopCapture();
                            safeLog("nativeAudio.stopCapture call succeeded.");
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
