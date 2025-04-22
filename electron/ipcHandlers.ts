// ipcHandlers.ts

import { ipcMain, shell, dialog, app, clipboard, BrowserWindow } from "electron"
import { randomBytes } from "crypto"
import { IIpcHandlerDeps } from "./main"
import { configHelper } from "./ConfigHelper"
import fs from "fs"
import path from "path"
import { execSync } from "child_process"
import { sanitizeTexts } from "./sanitizer"
import { processText } from "./textProcessor"
import { safeLog, safeError } from "./main"

export function initializeIpcHandlers(deps: IIpcHandlerDeps): void {
  safeLog("Initializing IPC handlers")

  // Configuration handlers
  ipcMain.handle("get-config", () => {
    return configHelper.loadConfig();
  })

  ipcMain.handle("update-config", (_event, updates) => {
    return configHelper.updateConfig(updates);
  })

  ipcMain.handle("check-api-key", () => {
    return configHelper.hasApiKey();
  })
  
  ipcMain.handle("validate-api-key", async (_event, apiKey) => {
    // First check the format
    if (!configHelper.isValidApiKeyFormat(apiKey)) {
      return { 
        valid: false, 
        error: "Invalid API key format. OpenAI API keys start with 'sk-'" 
      };
    }
    
    // Then test the API key with OpenAI
    const result = await configHelper.testApiKey(apiKey);
    return result;
  })

  // Credits handlers
  ipcMain.handle("set-initial-credits", async (_event, credits: number) => {
    const mainWindow = deps.getMainWindow()
    if (!mainWindow) return

    try {
      // Set the credits in a way that ensures atomicity
      await mainWindow.webContents.executeJavaScript(
        `window.__CREDITS__ = ${credits}`
      )
      mainWindow.webContents.send("credits-updated", credits)
    } catch (error) {
      console.error("Error setting initial credits:", error)
      throw error
    }
  })

  ipcMain.handle("decrement-credits", async () => {
    const mainWindow = deps.getMainWindow()
    if (!mainWindow) return

    try {
      const currentCredits = await mainWindow.webContents.executeJavaScript(
        "window.__CREDITS__"
      )
      if (currentCredits > 0) {
        const newCredits = currentCredits - 1
        await mainWindow.webContents.executeJavaScript(
          `window.__CREDITS__ = ${newCredits}`
        )
        mainWindow.webContents.send("credits-updated", newCredits)
      }
    } catch (error) {
      console.error("Error decrementing credits:", error)
    }
  })

  // Screenshot queue handlers
  ipcMain.handle("get-screenshot-queue", () => {
    return deps.getScreenshotQueue()
  })

  ipcMain.handle("get-extra-screenshot-queue", () => {
    return deps.getExtraScreenshotQueue()
  })

  ipcMain.handle("delete-screenshot", async (event, path: string) => {
    return deps.deleteScreenshot(path)
  })

  ipcMain.handle("get-image-preview", async (event, path: string) => {
    return deps.getImagePreview(path)
  })

  // Screenshot processing handlers
  ipcMain.handle("process-screenshots", async () => {
    // Check for API key before processing
    if (!configHelper.hasApiKey()) {
      const mainWindow = deps.getMainWindow();
      if (mainWindow) {
        mainWindow.webContents.send(deps.PROCESSING_EVENTS.API_KEY_INVALID);
      }
      return;
    }
    
    await deps.processingHelper?.processScreenshots()
  })

  // Window dimension handlers
  ipcMain.handle(
    "update-content-dimensions",
    async (event, { width, height }: { width: number; height: number }) => {
      if (width && height) {
        deps.setWindowDimensions(width, height)
      }
    }
  )

  ipcMain.handle(
    "set-window-dimensions",
    (event, width: number, height: number) => {
      deps.setWindowDimensions(width, height)
    }
  )

  // Screenshot management handlers
  ipcMain.handle("get-screenshots", async () => {
    try {
      let previews = []
      const currentView = deps.getView()

      if (currentView === "queue") {
        const queue = deps.getScreenshotQueue()
        previews = await Promise.all(
          queue.map(async (path) => ({
            path,
            preview: await deps.getImagePreview(path)
          }))
        )
      } else {
        const extraQueue = deps.getExtraScreenshotQueue()
        previews = await Promise.all(
          extraQueue.map(async (path) => ({
            path,
            preview: await deps.getImagePreview(path)
          }))
        )
      }

      return previews
    } catch (error) {
      console.error("Error getting screenshots:", error)
      throw error
    }
  })

  // Screenshot trigger handlers
  ipcMain.handle("trigger-screenshot", async () => {
    const mainWindow = deps.getMainWindow()
    if (mainWindow) {
      try {
        const screenshotPath = await deps.takeScreenshot()
        const preview = await deps.getImagePreview(screenshotPath)
        mainWindow.webContents.send("screenshot-taken", {
          path: screenshotPath,
          preview
        })
        return { success: true }
      } catch (error) {
        console.error("Error triggering screenshot:", error)
        return { error: "Failed to trigger screenshot" }
      }
    }
    return { error: "No main window available" }
  })

  ipcMain.handle("take-screenshot", async () => {
    try {
      const screenshotPath = await deps.takeScreenshot()
      const preview = await deps.getImagePreview(screenshotPath)
      return { path: screenshotPath, preview }
    } catch (error) {
      console.error("Error taking screenshot:", error)
      return { error: "Failed to take screenshot" }
    }
  })

  // Auth-related handlers removed

  ipcMain.handle("open-external-url", (event, url: string) => {
    shell.openExternal(url)
  })
  
  // Open external URL handler
  ipcMain.handle("openLink", (event, url: string) => {
    try {
      console.log(`Opening external URL: ${url}`);
      shell.openExternal(url);
      return { success: true };
    } catch (error) {
      console.error(`Error opening URL ${url}:`, error);
      return { success: false, error: `Failed to open URL: ${error}` };
    }
  })

  // Settings portal handler
  ipcMain.handle("open-settings-portal", () => {
    const mainWindow = deps.getMainWindow();
    if (mainWindow) {
      mainWindow.webContents.send("show-settings-dialog");
      return { success: true };
    }
    return { success: false, error: "Main window not available" };
  })

  // Window management handlers
  ipcMain.handle("toggle-window", () => {
    try {
      deps.toggleMainWindow()
      return { success: true }
    } catch (error) {
      console.error("Error toggling window:", error)
      return { error: "Failed to toggle window" }
    }
  })

  ipcMain.handle("reset-queues", async () => {
    try {
      deps.clearQueues()
      return { success: true }
    } catch (error) {
      console.error("Error resetting queues:", error)
      return { error: "Failed to reset queues" }
    }
  })

  // Process screenshot handlers
  ipcMain.handle("trigger-process-screenshots", async () => {
    try {
      // Check for API key before processing
      if (!configHelper.hasApiKey()) {
        const mainWindow = deps.getMainWindow();
        if (mainWindow) {
          mainWindow.webContents.send(deps.PROCESSING_EVENTS.API_KEY_INVALID);
        }
        return { success: false, error: "API key required" };
      }
      
      await deps.processingHelper?.processScreenshots()
      return { success: true }
    } catch (error) {
      console.error("Error processing screenshots:", error)
      return { error: "Failed to process screenshots" }
    }
  })

  // Reset handlers
  ipcMain.handle("trigger-reset", () => {
    try {
      // First cancel any ongoing requests
      deps.processingHelper?.cancelOngoingRequests()

      // Clear all queues immediately
      deps.clearQueues()

      // Reset view to queue
      deps.setView("queue")

      // Get main window and send reset events
      const mainWindow = deps.getMainWindow()
      if (mainWindow && !mainWindow.isDestroyed()) {
        // Send reset events in sequence
        mainWindow.webContents.send("reset-view")
        mainWindow.webContents.send("reset")
      }

      return { success: true }
    } catch (error) {
      console.error("Error triggering reset:", error)
      return { error: "Failed to trigger reset" }
    }
  })

  // Window movement handlers
  ipcMain.handle("trigger-move-left", () => {
    try {
      deps.moveWindowLeft()
      return { success: true }
    } catch (error) {
      console.error("Error moving window left:", error)
      return { error: "Failed to move window left" }
    }
  })

  ipcMain.handle("trigger-move-right", () => {
    try {
      deps.moveWindowRight()
      return { success: true }
    } catch (error) {
      console.error("Error moving window right:", error)
      return { error: "Failed to move window right" }
    }
  })

  ipcMain.handle("trigger-move-up", () => {
    try {
      deps.moveWindowUp()
      return { success: true }
    } catch (error) {
      console.error("Error moving window up:", error)
      return { error: "Failed to move window up" }
    }
  })

  ipcMain.handle("trigger-move-down", () => {
    try {
      deps.moveWindowDown()
      return { success: true }
    } catch (error) {
      console.error("Error moving window down:", error)
      return { error: "Failed to move window down" }
    }
  })
  
  // Delete last screenshot handler
  ipcMain.handle("delete-last-screenshot", async () => {
    try {
      const queue = deps.getView() === "queue" 
        ? deps.getScreenshotQueue() 
        : deps.getExtraScreenshotQueue()
      
      if (queue.length === 0) {
        return { success: false, error: "No screenshots to delete" }
      }
      
      // Get the last screenshot in the queue
      const lastScreenshot = queue[queue.length - 1]
      
      // Delete it
      const result = await deps.deleteScreenshot(lastScreenshot)
      
      // Notify the renderer about the change
      const mainWindow = deps.getMainWindow()
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("screenshot-deleted", { path: lastScreenshot })
      }
      
      return result
    } catch (error) {
      console.error("Error deleting last screenshot:", error)
      return { success: false, error: "Failed to delete last screenshot" }
    }
  })

  // Handle voice input text processing (Existing handler for code tasks)
  ipcMain.handle("trigger-process-text", async (_event, { text, language }) => {
    try {
      // Check for API key first (important!)
      const config = await configHelper.loadConfig();
      if (!config?.apiKey) {
        safeError('API key missing for trigger-process-text');
        // Optionally notify the renderer
        deps.getMainWindow()?.webContents.send(deps.PROCESSING_EVENTS.API_KEY_INVALID);
        return { success: false, error: 'API key is not configured.' };
      }
      // Process the text and return the result
      // Reverted call to original signature
      return await processText(text); 
    } catch (error) {
      safeError('Error in text processing handler:', error);
      return { success: false, error: 'Failed to process text input' };
    }
  });

  // NEW Handler for general AI queries from the text input
  ipcMain.handle("handle-ai-query", async (_event, { query, language }) => {
    safeLog(`Handling AI Query: \"${query}\" (Language: ${language})`);
    try {
      // Check if processingHelper exists (it's optional in deps)
      if (!deps.processingHelper) {
        safeError('ProcessingHelper not available in IPC handler dependencies.');
        return { success: false, error: 'Internal error: Processing helper not initialized.' };
      }

      // No need to check API key here, the helper method does it
      // const config = await configHelper.loadConfig();
      // const apiKey = config?.apiKey;
      // if (!apiKey) { ... }

      // Call the new method on the processing helper instance
      return await deps.processingHelper.handleSimpleQuery(query, language);

      // --- Remove previous commented-out logic and placeholder --- 
      /*
      const config = await configHelper.loadConfig();
      const apiKey = config?.apiKey;

      if (!apiKey) {
        safeError('API key missing for handle-ai-query');
        deps.getMainWindow()?.webContents.send(deps.PROCESSING_EVENTS.API_KEY_INVALID);
        return { success: false, error: 'API key is not configured.' };
      }

      // --- AI Interaction Logic (COMMENTED OUT) --- 
      safeLog('Attempting AI call...'); 
      
      // Example using Gemini (replace with your actual implementation)
      // const genAI = new GoogleGenerativeAI(apiKey);
      // Choose a model appropriate for general queries (e.g., gemini-pro)
      // This model name might come from config as well
      // const modelName = config.model || 'gemini-pro'; // Requires adding 'model' to Config type
      // const model = genAI.getGenerativeModel({ model: modelName });
      // 
      // const result = await model.generateContent(query);
      // const response = await result.response;
      // const textResponse = response.text();

      // safeLog(`AI Query successful. Response length: ${textResponse?.length}`);
      // return { success: true, data: textResponse };
      
      // --- End AI Interaction Logic --- 

      // Placeholder response until AI logic is implemented and uncommented
      safeLog("AI Query handler executed (placeholder response).");
      return { success: true, data: `Placeholder response for query: \"${query}\"` };
      */

    } catch (error: any) {
      // The helper method should catch its own errors, but add a fallback
      safeError('Unexpected error in handle-ai-query handler:', error);
      const errorMessage = error.message || 'An unknown error occurred processing the AI query.';
      return { success: false, error: errorMessage };
    }
  });

  // Text input dialog
  ipcMain.handle("show-input-dialog", async () => {
    try {
      const mainWindow = deps.getMainWindow();
      if (!mainWindow) {
        return { success: false, error: "Main window not available" };
      }

      // Generate a unique session ID for this dialog
      const sessionId = randomBytes(16).toString('hex');

      // Create a promise that will resolve when the user submits the form or cancels
      return new Promise((resolve) => {
        // Set up listeners for this specific dialog session
        const submitListener = (_: Electron.IpcMainEvent, dialogSessionId: string, text: string) => {
          if (dialogSessionId === sessionId) {
            cleanup();
            resolve(text);
          }
        };

        const cancelListener = (_: Electron.IpcMainEvent, dialogSessionId: string) => {
          if (dialogSessionId === sessionId) {
            cleanup();
            resolve(null);
          }
        };

        // Register temporary event listeners for this dialog session
        ipcMain.on('dialog-submit', submitListener);
        ipcMain.on('dialog-cancel', cancelListener);

        // Create a function to handle window closed event
        const windowClosedHandler = () => {
          cleanup();
          resolve(null);
        };

        // Function to clean up resources
        const cleanup = () => {
          // Remove event listeners
          ipcMain.removeListener('dialog-submit', submitListener);
          ipcMain.removeListener('dialog-cancel', cancelListener);
          
          // Remove window closed event handler if the window still exists
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.removeListener('closed', windowClosedHandler);
            
            // Send message to close the overlay if the window and webContents still exist
            if (!mainWindow.webContents.isDestroyed()) {
              mainWindow.webContents.send('close-input-overlay');
            }
          }
        };

        // Send message to the renderer process to display the overlay
        mainWindow.webContents.send('show-input-overlay', sessionId);

        // Cleanup if the window closes
        mainWindow.once('closed', windowClosedHandler);
      });
    } catch (error) {
      safeError('Error showing input dialog:', error);
      return null;
    }
  });

  // Voice input toggle handler
  ipcMain.handle('toggle-voice-input', () => {
    safeLog('Toggle voice input requested from renderer');
    
    try {
      const mainWindow = deps.getMainWindow();
      if (!mainWindow || mainWindow.isDestroyed()) {
        safeError('Cannot toggle voice input: Main window not available or destroyed');
        return { success: false, error: 'Main window not available' };
      }
      
      // Forward the toggle request to the renderer
      mainWindow.webContents.send('toggle-voice-input');
      safeLog('Sent toggle-voice-input event to renderer');
      return { success: true };
    } catch (error) {
      safeError('Error toggling voice input:', error);
      return { success: false, error: 'Failed to toggle voice input' };
    }
  });

  // Audio transcription handler
  ipcMain.handle('transcribe-audio', async (_event, audioData) => {
    safeLog('Received audio for transcription');
    try {
      // Check for API key
      const config = await configHelper.loadConfig();
      if (!config?.apiKey) {
        safeError('API key missing for audio transcription');
        deps.getMainWindow()?.webContents.send(deps.PROCESSING_EVENTS.API_KEY_INVALID);
        return { success: false, error: 'API key is not configured.' };
      }

      // Use deps.processingHelper to handle the transcription
      if (!deps.processingHelper) {
        safeError('ProcessingHelper not available for audio transcription');
        return { success: false, error: 'Internal error: Processing helper not initialized.' };
      }

      // Check if audioData is an object with buffer and mimeType properties
      const isNewFormat = audioData && typeof audioData === 'object' && 'buffer' in audioData && 'mimeType' in audioData;
      
      if (!isNewFormat) {
        safeLog('Received audio data in legacy format (buffer only)');
        if (!audioData || (audioData instanceof ArrayBuffer && audioData.byteLength === 0)) {
          safeError('Empty audio buffer received');
          return { success: false, error: 'Empty audio data received. Please try again.' };
        }
      } else {
        safeLog(`Received audio data in new format with mime type: ${audioData.mimeType}`);
        if (!audioData.buffer || (audioData.buffer instanceof ArrayBuffer && audioData.buffer.byteLength === 0)) {
          safeError('Empty audio buffer received in structured format');
          return { success: false, error: 'Empty audio data received. Please try again.' };
        }
      }
      
      let audioBuffer;
      let mimeType;
      
      if (isNewFormat) {
        audioBuffer = audioData.buffer;
        mimeType = audioData.mimeType;
        safeLog(`Audio buffer size: ${audioBuffer.byteLength} bytes, MIME type: ${mimeType}`);
      } else {
        // Legacy format - just the buffer
        audioBuffer = audioData;
        mimeType = 'audio/mpeg'; // Default
        safeLog(`Audio buffer size (legacy format): ${audioBuffer.byteLength} bytes, using default MIME type: ${mimeType}`);
      }
      
      // Call the handleAudioTranscription method with both buffer and mime type
      safeLog(`Calling ProcessingHelper.handleAudioTranscription with ${audioBuffer.byteLength} bytes of data`);
      const result = await deps.processingHelper.handleAudioTranscription(audioBuffer, mimeType);
      
      safeLog(`Transcription result: ${result.success ? 'success' : 'failure'}`);
      if (!result.success) {
        safeError(`Transcription error: ${result.error}`);
      }
      
      return result;
    } catch (error: any) {
      safeError('Error in audio transcription:', error);
      return { 
        success: false, 
        error: error.message || 'Failed to transcribe audio' 
      };
    }
  });
}
