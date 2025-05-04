import { autoUpdater } from "electron-updater"
import { BrowserWindow, ipcMain, app } from "electron"
import log from "electron-log"

// Safe console logging to prevent EPIPE errors
const safeLog = (...args: any[]) => {
  try {
    console.log(...args);
  } catch (error: any) {
    // Silently handle EPIPE errors
    if (error && typeof error === 'object' && 'code' in error && error.code === 'EPIPE') {
      // Process communication pipe is closed, ignore
    } else if (error) {
      // Try to log to stderr instead
      try {
        process.stderr.write(`Error during logging: ${error?.message || String(error)}\n`);
      } catch (_) {
        // Last resort, ignore completely
      }
    }
  }
};

// Safe error logging
const safeError = (...args: any[]) => {
  try {
    console.error(...args);
  } catch (error: any) {
    // Silently handle EPIPE errors
    if (error && typeof error === 'object' && 'code' in error && error.code === 'EPIPE') {
      // Process communication pipe is closed, ignore
    } else if (error) {
      // Try to log to stderr instead
      try {
        process.stderr.write(`ERROR: ${args.map(a => String(a)).join(' ')}\n`);
      } catch (_) {
        // Last resort, ignore completely
      }
    }
  }
};

export function initAutoUpdater() {
  safeLog("Initializing auto-updater...")

  // Skip update checks in development
  if (!app.isPackaged) {
    safeLog("Skipping auto-updater in development mode")
    return
  }

  if (!process.env.GH_TOKEN) {
    safeError("GH_TOKEN environment variable is not set")
    return
  }

  // Configure auto updater
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.allowDowngrade = true
  autoUpdater.allowPrerelease = true

  // Enable more verbose logging
  autoUpdater.logger = log
  log.transports.file.level = "debug"
  safeLog(
    "Auto-updater logger configured with level:",
    log.transports.file.level
  )

  // Log all update events
  autoUpdater.on("checking-for-update", () => {
    safeLog("Checking for updates...")
  })

  autoUpdater.on("update-available", (info) => {
    safeLog("Update available:", info)
    // Notify renderer process about available update
    BrowserWindow.getAllWindows().forEach((window) => {
      safeLog("Sending update-available to window")
      window.webContents.send("update-available", info)
    })
  })

  autoUpdater.on("update-not-available", (info) => {
    safeLog("Update not available:", info)
  })

  autoUpdater.on("download-progress", (progressObj) => {
    safeLog("Download progress:", progressObj)
  })

  autoUpdater.on("update-downloaded", (info) => {
    safeLog("Update downloaded:", info)
    // Notify renderer process that update is ready to install
    BrowserWindow.getAllWindows().forEach((window) => {
      safeLog("Sending update-downloaded to window")
      window.webContents.send("update-downloaded", info)
    })
  })

  autoUpdater.on("error", (err) => {
    safeError("Auto updater error:", err)
  })

  // Check for updates immediately
  safeLog("Checking for updates...")
  autoUpdater
    .checkForUpdates()
    .then((result) => {
      safeLog("Update check result:", result)
    })
    .catch((err) => {
      safeError("Error checking for updates:", err)
    })

  // Set up update checking interval (every 1 hour)
  setInterval(() => {
    safeLog("Checking for updates (interval)...")
    autoUpdater
      .checkForUpdates()
      .then((result) => {
        safeLog("Update check result (interval):", result)
      })
      .catch((err) => {
        safeError("Error checking for updates (interval):", err)
      })
  }, 60 * 60 * 1000)

  // Handle IPC messages from renderer
  ipcMain.handle("start-update", async () => {
    safeLog("Start update requested")
    try {
      await autoUpdater.downloadUpdate()
      safeLog("Update download completed")
      return { success: true }
    } catch (error: unknown) {
      safeError("Failed to start update:", error)
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle("install-update", () => {
    safeLog("Install update requested")
    autoUpdater.quitAndInstall()
  })
}
