// ipcHandlers.ts

import { ipcMain, shell, dialog, app, clipboard, BrowserWindow } from "electron"
import { IIpcHandlerDeps } from "./main"
import { configHelper } from "./ConfigHelper"
import fs from "fs"
import path from "path"
import { execSync } from "child_process"
import { sanitizeTexts } from "./sanitizer"
import { processText } from "./textProcessor"
import { safeLog, safeError } from "./main"
import { 
  getAiSettings, 
  saveAiSettings, 
  waitForStoreReady, 
  AudioDeviceSettings,
  AiSettings,
  getStoreInstance
} from "./store"
import * as fsPromises from 'fs/promises'; // Import fs.promises
import pdf from 'pdf-parse'; // Import pdf-parse
import mammoth from 'mammoth'; // Import mammoth
import { GoogleSpeechService } from "./GoogleSpeechService"

// --- Define and EXPORT AI Constants ---
export const DEFAULT_PERSONALITY = 'Default';
export const personalityPrompts: { [key: string]: string } = {
  [DEFAULT_PERSONALITY]: 'You are a helpful AI assistant providing concise talking points based on the conversation and user context.',
  'Formal': 'You are a professional AI assistant. Respond formally, concisely, and objectively. Focus on professional language suitable for a job interview setting.',
  'Friendly': 'You are a friendly and encouraging AI assistant. Use a positive, conversational, and supportive tone. You can be slightly more casual but remain professional.',
  'Analytical': 'You are an analytical AI assistant. Focus on structured reasoning, logical connections, and potential implications in your responses. Be objective and data-oriented.',
  'Assertive': 'You are an assertive AI assistant. Be direct, confident, and clear in your communication. Focus on actionable advice and strong statements.',
};
// --- End AI Constants ---

// Function to generate a random string without using crypto directly
function generateRandomString(length: number): string {
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return result;
}

export function initializeIpcHandlers(deps: IIpcHandlerDeps): void {
  safeLog("Initializing IPC handlers")
  
  // Ensure store is ready for faster first-time access
  waitForStoreReady(3000).then(ready => {
    if (ready) {
      safeLog("Store initialized successfully");
    } else {
      safeLog("Store initialization timeout - will initialize on first use");
    }
  }).catch(err => {
    safeError("Error initializing store:", err);
  });

  // Configuration handlers
  ipcMain.handle("get-config", () => {
    return configHelper.loadConfig();
  })
  safeLog("Registered IPC handler: get-config");

  ipcMain.handle("update-config", (_event, updates) => {
    return configHelper.updateConfig(updates);
  })
  safeLog("Registered IPC handler: update-config");

  // Provider-specific API key handlers
  ipcMain.handle("get-openai-api-key", () => {
    return configHelper.getOpenAIApiKey();
  })
  safeLog("Registered IPC handler: get-openai-api-key");

  ipcMain.handle("get-gemini-api-key", () => {
    return configHelper.getGeminiApiKey();
  })
  safeLog("Registered IPC handler: get-gemini-api-key");

  ipcMain.handle("get-anthropic-api-key", () => {
    return configHelper.getAnthropicApiKey();
  })
  safeLog("Registered IPC handler: get-anthropic-api-key");

  ipcMain.handle("check-api-key", () => {
    // This checks if *any* API key (OpenAI, Gemini, Anthropic, or Google Speech) is set.
    const openAIKeyExists = !!configHelper.getApiKey(); // Checks the main apiKey field
    const googleKeyExists = !!configHelper.getGoogleSpeechApiKey();
    return openAIKeyExists || googleKeyExists;
  })
  safeLog("Registered IPC handler: check-api-key");
  
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
  ipcMain.handle("handle-ai-query", async (_event, payload) => {
    // Destructure payload
    const { query, language, jobContext, resumeTextContent } = payload;
    
    safeLog(`Handling AI query: "${query}" (Language: ${language})`);
    safeLog(`Job Context: ${JSON.stringify(jobContext)}`);
    safeLog(`Resume provided: ${!!resumeTextContent} (length: ${resumeTextContent?.length || 0})`);

    // Check for API key first
    if (!configHelper.hasApiKey()) {
      safeError("AI Query failed: API key missing");
      deps.getMainWindow()?.webContents.send(deps.PROCESSING_EVENTS.API_KEY_INVALID);
      return { success: false, error: 'API key required' }; // Return structured error
    }

    try {
      // 1. Get AI Settings from store
      const settings = await getAiSettings();
      const personality = settings.personality; // Uses default from getAiSettings
      const interviewStage = settings.interviewStage;
      const userPreferences = settings.userPreferences;

      // 2. Get Base System Prompt
      const baseSystemPrompt = personalityPrompts[personality] || personalityPrompts[DEFAULT_PERSONALITY];

      // 3. Construct Context String from payload and settings
      let contextString = 'Relevant Context:\n';
      if (jobContext?.jobTitle) contextString += `- Job Title: ${jobContext.jobTitle}\n`;
      if (jobContext?.keySkills) contextString += `- Key Skills: ${jobContext.keySkills}\n`;
      if (jobContext?.companyMission) contextString += `- Company Mission/Values: ${jobContext.companyMission}\n`;
      if (interviewStage) contextString += `- Interview Stage: ${interviewStage}\n`;
      if (userPreferences) contextString += `- User Preferences: ${userPreferences}\n`;
      if (resumeTextContent) {
        // Optional: Summarize resume if too long?
        const summary = resumeTextContent.substring(0, 500); // Limit resume context
        contextString += `- Resume Summary: ${summary}...\n`;
      }
      // Remove initial placeholder if nothing was added
      if (contextString === 'Relevant Context:\n') {
         contextString = ''; // No context provided
      }

      // 4. Construct Final System Prompt
      let finalSystemPrompt = baseSystemPrompt;
      if (contextString) {
        finalSystemPrompt += `\n\n${contextString.trim()}`;
      }
      safeLog(`Using Personality: ${personality}`);
      safeLog(`Final System Prompt: ${finalSystemPrompt.substring(0, 200)}...`);

      // 5. Delegate to ProcessingHelper
      if (!deps.processingHelper) {
        safeError('ProcessingHelper not available in IPC handler dependencies.');
        return { success: false, error: 'Internal error: Processing helper not initialized.' };
      }
      
      const result = await deps.processingHelper.handleSimpleQuery(query, language, finalSystemPrompt);
      
      return result;

    } catch (error: any) {
      safeError("Error handling AI query in IPC handler:", error);
      return { success: false, error: error.message || 'An unknown error occurred handling the AI query.' };
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
      const sessionId = generateRandomString(16);

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
        return result;
      }
      
      // Make sure the text field is directly accessible for the renderer process
      // Create a proper serializable object for the IPC response
      const response = {
        success: true,
        text: typeof result.text === 'string' ? result.text : String(result.text || ''),
        words: Array.isArray(result.words) ? result.words.map(word => ({
          word: word.word || '',
          startTime: typeof word.startTime === 'number' ? word.startTime : 0,
          endTime: typeof word.endTime === 'number' ? word.endTime : 0
        })) : []
      };

      // Log words array size for debugging
      if (Array.isArray(result.words)) {
        safeLog(`Returning transcription with ${result.words.length} words with timing information`);
      }
      
      return response;
    } catch (error: any) {
      safeError('Error in audio transcription:', error);
      return { 
        success: false, 
        error: error.message || 'Failed to transcribe audio' 
      };
    }
  });

  ipcMain.handle('getOpenAIApiKey', async () => {
    return configHelper.getOpenAIApiKey();
  });

  // --- Add Missing Speech Service Handlers ---
  ipcMain.handle('getGoogleSpeechApiKey', async () => {
    return configHelper.getGoogleSpeechApiKey();
  })
  safeLog("Registered IPC handler: getGoogleSpeechApiKey");

  ipcMain.handle('setGoogleSpeechApiKey', async (_event, apiKey: string) => {
    try {
       await configHelper.setGoogleSpeechApiKey(apiKey);
       // Optional: Re-initialize GoogleSpeechService if needed after key change
       // Consider security implications - maybe require app restart?
      return { success: true };
     } catch (error: any) {
       console.error('Error setting Google Speech API Key:', error);
       return { success: false, error: error.message };
    }
  })
  safeLog("Registered IPC handler: setGoogleSpeechApiKey");

  ipcMain.handle('getSpeechService', async () => {
    return configHelper.getSpeechService();
  })
  safeLog("Registered IPC handler: getSpeechService");

  // Restrict service type to only what ConfigHelper accepts
  ipcMain.handle("setSpeechService", async (_event, service: 'whisper' | 'google') => {
    try {
      await configHelper.setSpeechService(service);
      // Optional: Trigger service re-initialization or UI update
      return { success: true };
    } catch (error: any) {
      console.error('Error setting Speech Service:', error);
      return { success: false, error: error.message };
    }
  })
  safeLog("Registered IPC handler: setSpeechService");

  ipcMain.handle('testGoogleSpeechApiKey', async () => {
    try {
      const result = await configHelper.testGoogleSpeechApiKey();
      return result;
    } catch (error: any) {
      console.error('Error testing Google Speech API key:', error);
      return { valid: false, error: error.message || 'Unknown error occurred' };
    }
  })
  safeLog("Registered IPC handler: testGoogleSpeechApiKey");

  // Stealth mode handlers
  ipcMain.handle('enable-stealth-mode', async () => {
    try {
      // Enable maximum stealth mode
      const mainWindow = deps.getMainWindow();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setOpacity(0);
        mainWindow.setIgnoreMouseEvents(true, { forward: true });
        mainWindow.minimize();
        
        // Platform-specific hiding
        if (process.platform === "darwin") {
          mainWindow.setHiddenInMissionControl(true);
          mainWindow.setSkipTaskbar(true);
        } else if (process.platform === "win32") {
          mainWindow.setSkipTaskbar(true);
          mainWindow.setPosition(-2000, -2000);
        }
        
        // Change process title
        process.title = "System Process";
        
        return { success: true, message: "Stealth mode enabled" };
      }
      return { success: false, error: "Main window not available" };
    } catch (error: any) {
      console.error('Error enabling stealth mode:', error);
      return { success: false, error: error.message };
    }
  })
  safeLog("Registered IPC handler: enable-stealth-mode");

  ipcMain.handle('disable-stealth-mode', async () => {
    try {
      const mainWindow = deps.getMainWindow();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setOpacity(1);
        mainWindow.setIgnoreMouseEvents(false);
        mainWindow.restore();
        mainWindow.show();
        
        // Restore process title
        process.title = "Interview Coder";
        
        return { success: true, message: "Stealth mode disabled" };
      }
      return { success: false, error: "Main window not available" };
    } catch (error: any) {
      console.error('Error disabling stealth mode:', error);
      return { success: false, error: error.message };
    }
  })
  safeLog("Registered IPC handler: disable-stealth-mode");

  ipcMain.handle('get-process-info', async () => {
    try {
      return {
        pid: process.pid,
        title: process.title,
        platform: process.platform,
        argv: process.argv.slice(2), // Hide full path
        version: process.version
      };
    } catch (error: any) {
      console.error('Error getting process info:', error);
      return { error: error.message };
    }
  })
  safeLog("Registered IPC handler: get-process-info");

  ipcMain.handle('force-quit-app', async () => {
    try {
      console.log('Force quit requested via IPC');
      // Remove the close event listener temporarily to allow actual quit
      const mainWindow = deps.getMainWindow();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.removeAllListeners('close');
        mainWindow.close();
      }
      app.quit();
      return { success: true };
    } catch (error: any) {
      console.error('Error force quitting app:', error);
      return { success: false, error: error.message };
    }
  })
  safeLog("Registered IPC handler: force-quit-app");

  ipcMain.handle("set-service-account-credentials-from-file", async (_event, filePath: string) => {
    try {
      // Read the file content first
      const keyJsonText = await fsPromises.readFile(filePath, 'utf8');
      // Use storeServiceAccountKey with the text content
      await configHelper.storeServiceAccountKey(keyJsonText);
      // Optionally trigger re-initialization of GoogleSpeechService
      return { success: true };
    } catch (error: any) {
      console.error('Error setting service account credentials from file:', error);
      // Provide more specific error feedback
      const message = error.code === 'ENOENT' ? `File not found: ${filePath}` : 
                      error instanceof SyntaxError ? "Invalid JSON format in the service account file." : 
                      error.message || "Failed to read or encrypt the service account file.";
      return { success: false, error: message };
    }
  });
  safeLog("Registered IPC handler: set-service-account-credentials-from-file");
  
  ipcMain.handle("set-service-account-credentials-from-text", async (_event, keyJsonText: string) => {
     try {
       // Use storeServiceAccountKey directly
       await configHelper.storeServiceAccountKey(keyJsonText);
       // Optionally trigger re-initialization of GoogleSpeechService
       return { success: true };
     } catch (error: any) {
       console.error('Error setting service account credentials from text:', error);
        // Provide more specific error feedback
       const message = error instanceof SyntaxError ? "Invalid JSON format provided." : 
                       error.message || "Failed to parse or encrypt the service account JSON.";
       return { success: false, error: message };
     }
  });
  safeLog("Registered IPC handler: set-service-account-credentials-from-text");

  ipcMain.handle("clear-service-account-credentials", async () => {
    try {
      // Use removeServiceAccountCredentials
      const removed = await configHelper.removeServiceAccountCredentials();
      // Optionally trigger re-initialization of GoogleSpeechService
      return { success: removed };
    } catch (error: any) {
      console.error('Error clearing service account credentials:', error);
      return { success: false, error: error.message };
    }
  });
  safeLog("Registered IPC handler: clear-service-account-credentials");

  ipcMain.handle("has-service-account-credentials", () => {
     return configHelper.hasServiceAccountCredentials();
  });
  safeLog("Registered IPC handler: has-service-account-credentials");

  // --- Add AI Settings Handlers ---
  ipcMain.handle('get-ai-settings', async () => {
    try {
      return await getAiSettings(); // Use existing function from store
    } catch (error) {
      safeError("Error getting AI settings:", error);
      return { // Return default structure on error
        personality: DEFAULT_PERSONALITY,
        interviewStage: 'Initial Screening',
        userPreferences: '',
        autoMode: false,
      };
    }
  });

  ipcMain.handle('save-ai-settings', async (_event, settings: Partial<AiSettings>) => {
    try {
      await saveAiSettings(settings); // Use existing function from store
      return { success: true };
    } catch (error) {
      safeError("Error saving AI settings:", error);
      return { success: false, error: 'Failed to save AI settings' };
    }
  });
  // --- End AI Settings Handlers ---

  // --- Add Audio Device Settings Handlers ---
  ipcMain.handle('get-audio-device-settings', async () => {
    try {
      await waitForStoreReady();
      const store = getStoreInstance();
      return {
        speakerDeviceId: store.get('selectedSpeakerDeviceId', null),
        microphoneDeviceId: store.get('selectedMicrophoneDeviceId', null),
      };
    } catch (error) {
      safeError("Error getting audio device settings:", error);
      return { speakerDeviceId: null, microphoneDeviceId: null };
    }
  });

  ipcMain.handle('save-audio-device-settings', async (_event, settings: Partial<AudioDeviceSettings>) => {
    try {
      await waitForStoreReady();
      const store = getStoreInstance();
      if (settings.speakerDeviceId !== undefined) {
        store.set('selectedSpeakerDeviceId', settings.speakerDeviceId);
      }
      if (settings.microphoneDeviceId !== undefined) {
        store.set('selectedMicrophoneDeviceId', settings.microphoneDeviceId);
      }
      return { success: true };
    } catch (error) {
      safeError("Error saving audio device settings:", error);
      return { success: false, error: 'Failed to save audio device settings' };
    }
  });
  // --- End Audio Device Settings Handlers ---

  // --- Add Resume Text Extraction Handler ---
  ipcMain.handle('extract-resume-text', async (_event, filePath: string) => {
    if (!filePath || !fs.existsSync(filePath)) {
      safeError('Extract Resume: File path is invalid or file does not exist.', filePath);
      return null;
    }
    try {
      const ext = path.extname(filePath).toLowerCase();
      let textContent = '';
      if (ext === '.pdf') {
        const dataBuffer = await fsPromises.readFile(filePath);
        const data = await pdf(dataBuffer);
        textContent = data.text;
      } else if (ext === '.docx') {
        const result = await mammoth.extractRawText({ path: filePath });
        textContent = result.value;
      } else if (ext === '.txt') {
        textContent = await fsPromises.readFile(filePath, 'utf8');
      } else {
        safeError('Extract Resume: Unsupported file type:', ext);
        return null; 
      }
      safeLog(`Extract Resume: Successfully extracted text (length: ${textContent.length}) from ${filePath}`);
      return textContent;
    } catch (error) {
      safeError(`Extract Resume: Error processing file ${filePath}:`, error);
      return null;
    }
  });
  // --- End Resume Text Extraction Handler ---

  // --- Add Response Suggestion Handler ---
  ipcMain.handle('generate-response-suggestion', async (_event, payload) => {
    if (!deps.processingHelper) {
      return { success: false, error: 'Processing helper not initialized' };
    }
    // Assuming ProcessingHelper has a method to handle this
    try {
      return await deps.processingHelper.generateResponseSuggestion(
        payload.question,
        payload.jobContext,
        payload.resumeTextContent,
        await getAiSettings(), // Fetch current AI settings
        payload.speakerRole
      );
    } catch (error: any) {
      safeError('Error generating response suggestion:', error);
      return { success: false, error: error.message || 'Unknown error generating suggestion' };
    }
  });
  // --- End Response Suggestion Handler ---

  // --- Remove Native Audio Capture Handlers ---
  // ipcMain.handle('start-audio-capture', async (event) => { ... });
  // ipcMain.handle('stop-audio-capture', async (event) => { ... });
  // --- End Removal ---

  // --- Add Auto Response Broadcast Handler ---
  ipcMain.handle('auto-response-generated', async (_event, responseText: string) => {
    safeLog('IPC: Received auto-response-generated request');
    
    try {
      // Get all browser windows
      const mainWindow = deps.getMainWindow();
      if (mainWindow && !mainWindow.isDestroyed()) {
        // Send the auto-generated response to the main window
        mainWindow.webContents.send('auto-response-update', responseText);
        safeLog('IPC: Broadcasted auto-response to main window');
      }
      
      return { success: true };
    } catch (error: any) {
      safeError("Error broadcasting auto-response:", error);
      return { 
        success: false, 
        error: error.message || 'An unknown error occurred broadcasting the auto-response.'
      };
    }
  });
  // --- End Auto Response Broadcast Handler ---

  ipcMain.handle("get-personality-prompt", async (_event, personality?: string) => {
    try {
      // Update to await the async function
      const settings = await getAiSettings();
      const personality = settings.personality; // Uses default from getAiSettings
      // Get the personality prompt, defaulting to Default if not found
      return personality ? personalityPrompts[personality] || personalityPrompts[DEFAULT_PERSONALITY] 
        : personalityPrompts[DEFAULT_PERSONALITY];
    } catch (error) {
      console.error("Error getting personality prompt:", error);
      return personalityPrompts[DEFAULT_PERSONALITY];
    }
  });

  ipcMain.handle("get-personality", async () => {
    try {
      // Update to await the async function
      const settings = await getAiSettings();
      return settings.personality || DEFAULT_PERSONALITY;
    } catch (error) {
      console.error("Error getting personality:", error);
      return DEFAULT_PERSONALITY;
    }
  });

  // Add Google Speech API related handlers
  ipcMain.handle('get-google-speech-api-key', async () => {
    return configHelper.getGoogleSpeechApiKey() || '';
  });

  ipcMain.handle('save-google-speech-api-key', async (_, apiKey) => {
    try {
      configHelper.setGoogleSpeechApiKey(apiKey);
      return true;
    } catch (error: any) {
      console.error('Error saving Google Speech API key:', error);
      return false;
    }
  });

  // --- ADDED: Settings Handlers --- 
  ipcMain.handle('load-setting', async (_event, key: string) => {
    try {
      await waitForStoreReady();
      const store = getStoreInstance();
      return store.get(key);
    } catch (error) {
      safeError(`Error loading setting ${key}:`, error);
      return null;
    }
  });

  ipcMain.handle('save-setting', async (_event, key: string, value: any) => {
    try {
      await waitForStoreReady();
      const store = getStoreInstance();
      store.set(key, value);
      return { success: true };
    } catch (error) {
      safeError(`Error saving setting ${key}:`, error);
      return { success: false, error: `Failed to save setting ${key}` };
    }
  });

  // --- ADDED: Core Functionality Handlers ---
  // ipcMain.handle('transcribe-audio', async (_event, payload: { buffer: ArrayBuffer, mimeType: string }) => {
  //    if (!deps.processingHelper) {
  //      return { success: false, error: 'Processing helper not initialized' };
  //    }
  //    // Assuming ProcessingHelper has a method to handle transcription
  //    try {
  //      // Convert ArrayBuffer back to Buffer/Uint8Array if needed by the service
  //      const audioData = Buffer.from(payload.buffer); 
  //      return await deps.processingHelper.handleAudioTranscription(audioData, payload.mimeType);
  //    } catch (error: any) {
  //       safeError('Error transcribing audio via IPC:', error);
  //      return { success: false, error: error.message || 'Unknown transcription error' };
  //    }
  // });
  // --- END: Core Functionality Handlers --- 

  ipcMain.on('REQUEST_INTERVIEWER_TURN_SUGGESTION', async (event, args) => {
    const { question, jobContext, resumeTextContent, settings } = args;
    const mainWindow = BrowserWindow.getFocusedWindow(); // Or however you get your main window reference

    if (!mainWindow) {
      console.error('REQUEST_INTERVIEWER_TURN_SUGGESTION: mainWindow not found');
      return;
    }

    if (!deps.processingHelper) {
      console.error('REQUEST_INTERVIEWER_TURN_SUGGESTION: processingHelper not initialized');
      mainWindow.webContents.send('INTERVIEWER_TURN_SUGGESTION_RESULT', {
        success: false,
        error: 'Processing service not available.',
      });
      return;
    }

    console.log('[MainIPC] Received REQUEST_INTERVIEWER_TURN_SUGGESTION for question:', question.substring(0, 50) + '...');

    try {
      const result = await deps.processingHelper.generateResponseSuggestion(
        question,          // The last interviewer transcript
        jobContext,
        resumeTextContent,
        settings,
        'interviewer'      // <<< HARDCODE speakerRole to 'interviewer'
      );
      mainWindow.webContents.send('INTERVIEWER_TURN_SUGGESTION_RESULT', result);
    } catch (error: any) {
      console.error('[MainIPC] Error processing REQUEST_INTERVIEWER_TURN_SUGGESTION:', error);
      mainWindow.webContents.send('INTERVIEWER_TURN_SUGGESTION_RESULT', {
        success: false,
        error: error.message || 'Failed to generate suggestion for interviewer turn.',
      });
    }
  });

  safeLog('IPC Handlers initialization complete.');
}
