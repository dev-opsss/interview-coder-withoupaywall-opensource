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
import fsPromises from 'fs/promises'; // Use promises version of fs
import pdf from 'pdf-parse';
import mammoth from 'mammoth';
import { initializeStore, getStoreInstance } from './store'
import { release } from "node:os"
import { autoUpdater } from "electron-updater"
import { SpeechBridge } from './SpeechBridge';
import { AudioCapture } from './AudioCapture';
import { GoogleSpeechService } from './GoogleSpeechService';

// Create a services object to store references to our services
export const appServices = {
  speechBridge: null as SpeechBridge | null,
  audioCapture: null as AudioCapture | null,
  configHelper,
  googleSpeechService: null as GoogleSpeechService | null,
  processingHelper: null as ProcessingHelper | null
};

// Add a constant for dev server URL at the top of the file
const DEV_SERVER_URL = 'http://localhost:5173';

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
  store: any
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
  googleSpeechService: GoogleSpeechService | null
}

// Initialize helpers
function initializeHelpers() {
  state.screenshotHelper = ScreenshotHelper.getInstance(state.view)
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
    store: getStoreInstance(),
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

  // Synchronize settings between ConfigHelper and store
  synchronizeConfigurations();
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
    safeLog("Using existing window instead of creating a new one")
    return
  }

  safeLog("Starting window creation process...")

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
      preload: path.join(__dirname, 'preload.js'),
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
        // Retry loading after a delay
        safeLog("Retrying to load development server...")
        setTimeout(async () => {
          try {
            await state.mainWindow?.loadURL(DEV_SERVER_URL)
          } catch (error) {
            safeError(`Failed to load dev server on retry: ${error}`);
            
            // Try to load local file as absolute last resort
            const localIndexPath = path.join(app.getAppPath(), 'dist', 'index.html');
            safeLog("Falling back to:", localIndexPath)
            if (fs.existsSync(localIndexPath)) {
              try {
                await state.mainWindow!.loadFile(localIndexPath)
                safeLog("Loaded local file successfully");
              } catch (loadFileError) {
                safeError("Failed to load index file:", loadFileError)
              }
            } else {
              safeError("Could not find index.html in dist folder")
            }
          }
        }, 1000)
      } else {
        // In production, retry loading after a short delay as a last resort
        const prodIndexPath = path.join(app.getAppPath(), 'dist', 'index.html');
        setTimeout(async () => {
          try {
            // Try again with the file URL
            await state.mainWindow?.loadFile(prodIndexPath)
            safeLog("Loaded local file on retry")
          } catch (error) {
            safeError("Failed to load file on retry:", error)
          }
        }, 1000)
      }
    }
  )

  if (isDev) {
    // In development, load from the dev server
    safeLog("Loading from development server: " + DEV_SERVER_URL)
    try {
      // Load URL from the development server
      await state.mainWindow.loadURL(DEV_SERVER_URL)
    } catch (error) {
      safeError("Failed to load dev server, falling back to local file:", error)
      // Fallback to local file if dev server is not available
      const indexPath = path.join(__dirname, "../dist/index.html")
      safeLog("Falling back to:", indexPath)
      if (fs.existsSync(indexPath)) {
        state.mainWindow!.loadFile(indexPath)
      } else {
        safeError("Could not find index.html in dist folder")
      }
    }
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
  
  // Show the window with initial opacity
  try {
    // Always make window visible first
    state.mainWindow.show();
    state.mainWindow.focus();
    
    // Check for environment variable to force window visibility
    const forceVisible = process.env.FORCE_VISIBLE === 'true';
    
    // Then set opacity based on config or env var
    if (forceVisible) {
      safeLog('FORCE_VISIBLE is set, making window fully visible');
      state.mainWindow.setOpacity(1.0);
      state.isWindowVisible = true;
    } else if (savedOpacity <= 0.1) {
      safeLog('Initial opacity too low, setting to default 1.0');
      state.mainWindow.setOpacity(1.0);
  } else {
    safeLog(`Setting initial opacity to ${savedOpacity}`);
    state.mainWindow.setOpacity(savedOpacity);
    }
    
    state.isWindowVisible = true;
  } catch (error) {
    safeError('Error showing window:', error);
  }

  try {
    // Load credentials before initializing GoogleSpeechService
    let apiKey = await configHelper.getApiKey();
    let serviceAccountKeyContent: string | null = null; // Store the key content directly
    try {
      serviceAccountKeyContent = await configHelper.loadServiceAccountKey(); // Returns decrypted key string or null
      
      if (typeof serviceAccountKeyContent !== 'string' || serviceAccountKeyContent.trim() === '') {
        serviceAccountKeyContent = null; // Ensure it's null if invalid or empty
      }

      if (!apiKey && !serviceAccountKeyContent) {
        console.warn('[Main Process] No API Key or valid Service Account key content found. Google Speech service may not work.');
        // Decide if you want to throw an error or proceed without credentials
      }
    } catch (error) {
        console.error('[Main Process] Failed to load Google Cloud credentials:', error);
        serviceAccountKeyContent = null; // Ensure it's null on error
        // Handle error appropriately, maybe prevent service initialization
    }

    // Initialize GoogleSpeechService with loaded credentials and EXPLICIT language
    appServices.googleSpeechService = new GoogleSpeechService(
      serviceAccountKeyContent ?? apiKey ?? undefined,
      'en-US' // <-- Explicitly set language code
    );
    console.log(`[Main Process] GoogleSpeechService initialized with API Key: ${!!apiKey}, Service Account Content: ${!!serviceAccountKeyContent}`);

    // SpeechBridge depends on GoogleSpeechService and mainWindow
    appServices.speechBridge = new SpeechBridge(appServices.googleSpeechService, state.mainWindow);
    console.log('SpeechBridge initialized in createWindow.');

    // --- IPC handlers are now managed within SpeechBridge --- 

    // Use state.mainWindow for the closed event
    if (state.mainWindow) {
      state.mainWindow.on('closed', () => {
        state.mainWindow = null
        state.isWindowVisible = false
        state.windowPosition = null
        state.windowSize = null

        // Clean up services that might hold references or resources
        appServices.googleSpeechService?.cleanup(); // Add cleanup method if needed
        appServices.speechBridge?.cleanup(); // Add cleanup method if needed

        console.log('Main window closed and cleaned up.');
      });
    } else {
       console.warn('Could not attach closed handler: mainWindow is null after creation attempt.');
    }

  } catch (error) {
    safeError("Failed to initialize application services:", error)
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
    // Use non-null assertion since we've already checked with isDestroyed()
    const bounds = state.mainWindow!.getBounds();
    state.windowPosition = { x: bounds.x, y: bounds.y };
    state.windowSize = { width: bounds.width, height: bounds.height };
    state.mainWindow!.setIgnoreMouseEvents(true, { forward: true });
    state.mainWindow!.setOpacity(0);
    state.isWindowVisible = false;
    safeLog('Window hidden, opacity set to 0');
  }
}

function showMainWindow(): void {
  safeLog('Attempting to show main window...');
  if (!state.mainWindow) {
    safeError('Cannot show window: state.mainWindow is null');
    return;
  }
  
  if (state.mainWindow.isDestroyed()) {
    safeError('Cannot show window: window has been destroyed');
    return;
  }

  try {
    if (state.windowPosition && state.windowSize) {
      safeLog(`Setting window bounds to ${JSON.stringify(state.windowPosition)}, ${JSON.stringify(state.windowSize)}`);
      state.mainWindow!.setBounds({
        ...state.windowPosition,
        ...state.windowSize
      });
    }
    
    // Force full opacity and ensure window is visible
    state.mainWindow!.setIgnoreMouseEvents(false);
    state.mainWindow!.setAlwaysOnTop(true, "screen-saver", 1);
    state.mainWindow!.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true
    });
    state.mainWindow!.setContentProtection(true);
    
    // Show window first with full opacity
    state.mainWindow!.setOpacity(1);
    state.mainWindow!.show();
    state.mainWindow!.focus();
    
    // Force redraw
    state.mainWindow!.webContents.invalidate();
    
    state.isWindowVisible = true;
    safeLog('Window should now be visible with opacity=1');
  } catch (error) {
    safeError('Error while showing window:', error);
  }
}

function toggleMainWindow(): void {
  safeLog(`Toggling window. Current state: ${state.isWindowVisible ? 'visible' : 'hidden'}, mainWindow exists: ${state.mainWindow ? 'yes' : 'no'}`);
  
  if (!state.mainWindow) {
    safeError('Cannot toggle window: state.mainWindow is null');
    return;
  }
  
  if (state.mainWindow.isDestroyed()) {
    safeError('Cannot toggle window: window has been destroyed');
    return;
  }
  
  try {
    // Direct toggle without using helper functions
  if (state.isWindowVisible) {
      // Hide window
      safeLog('Hiding window directly...');
      
      // Save current position and size
      const bounds = state.mainWindow.getBounds();
      state.windowPosition = { x: bounds.x, y: bounds.y };
      state.windowSize = { width: bounds.width, height: bounds.height };
      
      // Hide the window
      state.mainWindow.setOpacity(0);
      state.mainWindow.setIgnoreMouseEvents(true, { forward: true });
      state.isWindowVisible = false;
  } else {
      // Show window
      safeLog('Showing window directly...');
      
      // Restore position and size if available
      if (state.windowPosition && state.windowSize) {
        state.mainWindow.setBounds({
          ...state.windowPosition,
          ...state.windowSize
        });
      }
      
      // Show the window
      state.mainWindow.setOpacity(1);
      state.mainWindow.setIgnoreMouseEvents(false);
      state.mainWindow.show();
      state.mainWindow.focus();
      state.isWindowVisible = true;
    }
  } catch (error) {
    safeError('Error toggling window:', error);
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
    const [currentX, currentY] = state.mainWindow!.getPosition()
    const primaryDisplay = screen.getPrimaryDisplay()
    const workArea = primaryDisplay.workAreaSize
    const maxWidth = Math.floor(workArea.width * 0.5)

    state.mainWindow!.setBounds({
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
// let isCapturingAudio = false;
// let stopCaptureFunction: (() => Promise<void>) | null = null; // Function to stop platform capture

// --- Platform-Specific Audio Capture Functions ---

// Add a global variable to track the native module
// let macAudioModule: any = null;

/* // Commented out entire function
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
        // if (!isCapturingAudio || !webContents || webContents.isDestroyed()) { // Use isCapturingAudio if kept
        if (!webContents || webContents.isDestroyed()) { // Simplified check if state is removed
          return;
        }
        
        // Check if the data is in the expected format
        if (audioData && audioData.data) {
          // Send to renderer
          // webContents.send('audio-data-chunk', audioData.data.buffer); // Removed IPC channel
          
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
  } catch (startError: any) { // Explicitly type startError
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
          // 'Try installing Microsoft Teams to enable system audio capture', // Removed suggestion
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
*/

/* // Commented out entire function
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
         // 'Use macOS for audio capture features', // Removed suggestion
         'Check for application updates'
       ]
     });
   }
   
   // Return a no-op stop function
   return async () => {
     safeLog('No Windows audio capture to stop (not implemented)');
   };
}
*/

/* // Commented out entire function
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
          // 'Use macOS for audio capture features', // Removed suggestion
          'Check for application updates'
        ]
      });
    }
    
    // Return a no-op stop function
    return async () => {
      safeLog('No Linux audio capture to stop (not implemented)');
    };
}
*/


// --- Updated IPC Handlers for Audio ---
// Removed start-audio-capture and stop-audio-capture handlers as they are no longer needed
// ipcMain.handle('start-audio-capture', async (event) => { ... });
// ipcMain.handle('stop-audio-capture', async (event) => { ... });

// Function to synchronize configuration between ConfigHelper and store
function synchronizeConfigurations() {
  try {
    const store = getStoreInstance();
    if (!store) {
      safeError('Cannot synchronize configurations: store not initialized');
      return;
    }
    
    safeLog('Synchronizing configuration systems...');
    
    // Check current values
    const configHelperService = configHelper.getSpeechService();
    const configHelperGoogleApiKey = configHelper.getGoogleSpeechApiKey();
    
    const storeService = store.get('config.speechService');
    const storeGoogleApiKey = store.get('config.googleSpeechApiKey');
    
    // Log current state
    safeLog(`Current config - ConfigHelper: service=${configHelperService}, API key present=${!!configHelperGoogleApiKey}`);
    safeLog(`Current config - Store: service=${storeService}, API key present=${!!storeGoogleApiKey}`);
    
    // Synchronize speech service
    if (storeService && storeService !== configHelperService) {
      safeLog(`Synchronizing speechService from store to ConfigHelper: ${storeService}`);
      configHelper.setSpeechService(storeService);
    } else if (configHelperService && configHelperService !== storeService) {
      safeLog(`Synchronizing speechService from ConfigHelper to store: ${configHelperService}`);
      store.set('config.speechService', configHelperService);
    }
    
    // Synchronize Google API key
    if (storeGoogleApiKey && storeGoogleApiKey !== configHelperGoogleApiKey) {
      safeLog('Synchronizing Google API key from store to ConfigHelper');
      configHelper.setGoogleSpeechApiKey(storeGoogleApiKey);
    } else if (configHelperGoogleApiKey && configHelperGoogleApiKey !== storeGoogleApiKey) {
      safeLog('Synchronizing Google API key from ConfigHelper to store');
      store.set('config.googleSpeechApiKey', configHelperGoogleApiKey);
    }
    
    safeLog('Configuration synchronization complete.');
  } catch (error) {
    safeError('Error synchronizing configurations:', error);
  }
}

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
    
    // --- Initialize Store EARLY --- 
    const storeInitialized = await initializeStore();
    if (!storeInitialized) {
      safeError("FATAL: Store initialization failed. Application might not function correctly.");
    } else {
      safeLog("Store initialization completed.");
    }
    
    // Ensure configuration exists
    if (!configHelper.hasApiKey()) {
      safeLog("No API key found in configuration. User will need to set up.")
    }
    
    initializeHelpers()

    // Reconstruct the ipcDeps object
    const ipcDeps: IIpcHandlerDeps = {
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
      moveWindowDown: () => moveWindowVertical((y) => y + state.step),
      googleSpeechService: appServices.googleSpeechService
    };

    initializeIpcHandlers(ipcDeps); // Call the initializer with dependencies
    safeLog("IPC Handlers initialization initiated."); // Log after calling

    await createWindow()

    state.shortcutsHelper?.registerGlobalShortcuts()

    // Initialize auto-updater regardless of environment
    initAutoUpdater()
    safeLog(
      "Auto-updater initialized in",
      isDev ? "development" : "production",
      "mode"
    )

    // Initialize GOOGLE_APPLICATION_CREDENTIALS if service account is available
    try {
      if (configHelper.hasServiceAccountCredentials()) {
        console.log('Main Process: Detected service account credentials, initializing environment');
        
        // Ensure we have a path to the credentials file
        const tempJsonPath = path.join(app.getPath('temp'), 'speech-credentials-main.json');
        
        // Write service account JSON to a file the Google client can access
        const serviceAccountJson = configHelper.loadServiceAccountKey();
        if (serviceAccountJson) {
          fs.writeFileSync(tempJsonPath, serviceAccountJson);
          
          // Set environment variable for Google Speech API
          process.env.GOOGLE_APPLICATION_CREDENTIALS = tempJsonPath;
          console.log(`Main Process: Set GOOGLE_APPLICATION_CREDENTIALS to ${tempJsonPath}`);
        } else {
          console.log('Main Process: Could not load service account key, skipping environment setup');
        }
      }
    } catch (error) {
      console.error('Main Process: Error initializing Google credentials:', error);
    }

  } catch (error) {
    safeError("Failed to initialize application:", error)
    app.quit()
  }
}

app.whenReady().then(initializeApp)

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

// Clean up services on app quit
app.on('before-quit', () => {
  if (appServices.audioCapture) {
    appServices.audioCapture.cleanup();
  }
  
  if (appServices.speechBridge) {
    appServices.speechBridge.cleanup();
  }
});

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
