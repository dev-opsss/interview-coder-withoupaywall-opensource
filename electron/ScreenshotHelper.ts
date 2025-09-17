// ScreenshotHelper.ts

import path from "node:path"
import fs from "node:fs"
import { app, desktopCapturer, screen } from "electron"
import { v4 as uuidv4 } from "uuid"
import os from "os"
// Use require instead of import for child_process
const { execFile } = require("child_process")

// Create a custom execFile function that doesn't rely on util.promisify
function customExecFile(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(command, args, (error: Error | null) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

export class ScreenshotHelper {
  private static instance: ScreenshotHelper
  private screenshotQueue: string[] = []
  private extraScreenshotQueue: string[] = []
  private view: "queue" | "solutions" | "debug" = "queue"
  private readonly MAX_SCREENSHOTS = 50
  private screenshotDir: string
  private extraScreenshotDir: string
  private tempDir: string

  private constructor(initialView?: "queue" | "solutions" | "debug") {
    // Private constructor to enforce singleton pattern
    this.screenshotDir = path.join(app.getPath("userData"), "screenshots")
    this.extraScreenshotDir = path.join(
      app.getPath("userData"),
      "extra-screenshots"
    )
    this.tempDir = os.tmpdir()

    // Set initial view if provided
    if (initialView) {
      this.view = initialView;
  }
  
    // Create screenshot directories
    if (!fs.existsSync(this.screenshotDir)) {
      fs.mkdirSync(this.screenshotDir, { recursive: true })
    }
    if (!fs.existsSync(this.extraScreenshotDir)) {
      fs.mkdirSync(this.extraScreenshotDir, { recursive: true })
    }
  }

  public static getInstance(initialView?: "queue" | "solutions" | "debug"): ScreenshotHelper {
    if (!ScreenshotHelper.instance) {
      ScreenshotHelper.instance = new ScreenshotHelper(initialView)
    }
    return ScreenshotHelper.instance
  }

  /**
   * Take a screenshot of the entire desktop and save it to a temporary file.
   */
  public async takeScreenshot(
    hideMainWindow: () => void,
    showMainWindow: () => void
  ): Promise<string> {
    console.log("Taking screenshot in view:", this.view)
    hideMainWindow()
    
    // Delay for window hiding
    const hideDelay = process.platform === 'win32' ? 500 : 300
    await new Promise((resolve) => setTimeout(resolve, hideDelay))

    let screenshotPath = ""
    try {
      // Get the primary display
      const primaryDisplay = screen.getPrimaryDisplay()
      const { id } = primaryDisplay

      // Capture the desktop screen
      const sources = await desktopCapturer.getSources({
        types: ["screen"],
        thumbnailSize: primaryDisplay.size
      })
      
      // Find the main screen source
      const mainSource = sources.find(source => 
        source.display_id === id.toString() || 
        sources.length === 1 || 
        source.id.includes("screen:0")
      )

      if (!mainSource) {
        throw new Error("Could not find main screen source")
      }

      // Get the thumbnail NativeImage and resize for better performance
      const thumbnail = mainSource.thumbnail
      
      // Resize to reduce file size while maintaining readability
      // Max width of 1200px should be sufficient for most coding problems
      const resizedThumbnail = thumbnail.resize({ width: 1200 })
      
      // Save the screenshot based on current view
      if (this.view === "queue") {
        screenshotPath = path.join(this.screenshotDir, `${uuidv4()}.png`)
        fs.writeFileSync(screenshotPath, resizedThumbnail.toPNG() as any)
        console.log("Adding screenshot to main queue:", screenshotPath)
        this.screenshotQueue.push(screenshotPath)
        if (this.screenshotQueue.length > this.MAX_SCREENSHOTS) {
          const removedPath = this.screenshotQueue.shift()
          if (removedPath) {
            try {
              fs.unlinkSync(removedPath)
              console.log(
                "Removed old screenshot from main queue:",
                removedPath
              )
            } catch (error) {
              console.error("Error removing old screenshot:", error)
            }
          }
        }
      } else {
        // In solutions view, only add to extra queue
        screenshotPath = path.join(this.extraScreenshotDir, `${uuidv4()}.png`)
        fs.writeFileSync(screenshotPath, resizedThumbnail.toPNG() as any)
        console.log("Adding screenshot to extra queue:", screenshotPath)
        this.extraScreenshotQueue.push(screenshotPath)
        if (this.extraScreenshotQueue.length > this.MAX_SCREENSHOTS) {
          const removedPath = this.extraScreenshotQueue.shift()
          if (removedPath) {
            try {
              fs.unlinkSync(removedPath)
              console.log(
                "Removed old screenshot from extra queue:",
                removedPath
              )
            } catch (error) {
              console.error("Error removing old screenshot:", error)
            }
          }
        }
      }
    } catch (error) {
      console.error("Screenshot error:", error)
      throw error
    } finally {
      // Delay for showing window again
      await new Promise((resolve) => setTimeout(resolve, 200))
      showMainWindow()
    }

    return screenshotPath
  }

  /**
   * Convert the given screenshot path to the correct format for different platforms.
   */
  public getPathForPlatform(filePath: string): string {
    // For macOS, no change needed
    if (process.platform === "darwin") {
      return filePath
    }
    
    // For Windows, convert to Windows path format
    if (process.platform === "win32") {
      return filePath.replace(/\//g, "\\")
    }
    
    // For Linux, no change needed
    return filePath
  }

  public setView(view: "queue" | "solutions" | "debug") {
    this.view = view
  }

  public getAllScreenshots(): string[] {
    return this.view === "queue"
      ? [...this.screenshotQueue]
      : [...this.extraScreenshotQueue]
  }

  /**
   * Get the list of screenshots in the main queue
   */
  public getScreenshotQueue(): string[] {
    return [...this.screenshotQueue];
  }

  /**
   * Get the list of screenshots in the extra queue
   */
  public getExtraScreenshotQueue(): string[] {
    return [...this.extraScreenshotQueue];
  }

  /**
   * Get an image preview from a file path
   */
  public async getImagePreview(filepath: string): Promise<string> {
    try {
      if (!fs.existsSync(filepath)) {
        console.warn(`Preview requested for non-existent file: ${filepath}`);
        return "";
      }
      
      // Simple implementation: return the file path
      // In a full implementation, you might generate a smaller preview or base64 data
      return filepath;
    } catch (error) {
      console.error("Error getting image preview:", error);
      return "";
    }
  }

  /**
   * Clear both screenshot queues (memory only, keep files on disk)
   */
  public clearQueues(): void {
    console.log("Clearing screenshot queues from memory (keeping files on disk)");
    this.screenshotQueue = [];
    this.extraScreenshotQueue = [];
  }

  public async clearAllScreenshots(): Promise<void> {
    if (this.view === "queue") {
      // Clear queue screenshots
      for (const screenshot of this.screenshotQueue) {
        try {
          await fs.promises.unlink(screenshot)
        } catch (error) {
          console.error("Error deleting screenshot:", error)
        }
      }
      this.screenshotQueue = []
    } else {
      // Clear extra screenshots
      for (const screenshot of this.extraScreenshotQueue) {
        try {
          await fs.promises.unlink(screenshot)
        } catch (error) {
          console.error("Error deleting extra screenshot:", error)
        }
      }
      this.extraScreenshotQueue = []
    }
  }

  public async deleteScreenshot(
    path: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      if (fs.existsSync(path)) {
        await fs.promises.unlink(path)
      }
      
      if (this.view === "queue") {
        this.screenshotQueue = this.screenshotQueue.filter(
          (filePath) => filePath !== path
        )
      } else {
        this.extraScreenshotQueue = this.extraScreenshotQueue.filter(
          (filePath) => filePath !== path
        )
      }
      return { success: true }
    } catch (error: unknown) {
      console.error("Error deleting file:", error)
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { success: false, error: errorMessage }
    }
  }

  public clearExtraScreenshotQueue(): void {
    // Clear extraScreenshotQueue
    this.extraScreenshotQueue.forEach((screenshotPath) => {
      if (fs.existsSync(screenshotPath)) {
        fs.unlink(screenshotPath, (err) => {
          if (err)
            console.error(
              `Error deleting extra screenshot at ${screenshotPath}:`,
              err
            )
        })
      }
    })
    this.extraScreenshotQueue = []
  }

}
