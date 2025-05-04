/// <reference lib="dom" />

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

// Original console.log statements replaced with safeLog
safeLog("Preload script starting...")
import { contextBridge, ipcRenderer } from "electron"
const { shell } = require("electron")

const PROCESSING_EVENTS = {
  //global states
  UNAUTHORIZED: "procesing-unauthorized",
  NO_SCREENSHOTS: "processing-no-screenshots",
  OUT_OF_CREDITS: "out-of-credits",
  API_KEY_INVALID: "api-key-invalid",

  //states for generating the initial solution
  INITIAL_START: "initial-start",
  PROBLEM_EXTRACTED: "problem-extracted",
  SOLUTION_SUCCESS: "solution-success",
  INITIAL_SOLUTION_ERROR: "solution-error",
  RESET: "reset",

  //states for processing the debugging
  DEBUG_START: "debug-start",
  DEBUG_SUCCESS: "debug-success",
  DEBUG_ERROR: "debug-error"
} as const

// At the top of the file
safeLog("Preload script is running")

const electronAPI = {
  // Original methods
  openSubscriptionPortal: async (authData: { id: string; email: string }) => {
    return ipcRenderer.invoke("open-subscription-portal", authData)
  },
  openSettingsPortal: () => ipcRenderer.invoke("open-settings-portal"),
  updateContentDimensions: (dimensions: { width: number; height: number }) =>
    ipcRenderer.invoke("update-content-dimensions", dimensions),
  clearStore: () => ipcRenderer.invoke("clear-store"),
  getScreenshots: () => ipcRenderer.invoke("get-screenshots"),
  deleteScreenshot: (path: string) =>
    ipcRenderer.invoke("delete-screenshot", path),
  toggleMainWindow: async () => {
    safeLog("toggleMainWindow called from preload")
    try {
      const result = await ipcRenderer.invoke("toggle-window")
      safeLog("toggle-window result:", result)
      return result
    } catch (error) {
      console.error("Error in toggleMainWindow:", error)
      throw error
    }
  },
  // Event listeners
  onScreenshotTaken: (
    callback: (data: { path: string; preview: string }) => void
  ) => {
    const subscription = (_: any, data: { path: string; preview: string }) =>
      callback(data)
    ipcRenderer.on("screenshot-taken", subscription)
    return () => {
      ipcRenderer.removeListener("screenshot-taken", subscription)
    }
  },
  onResetView: (callback: () => void) => {
    const subscription = () => callback()
    ipcRenderer.on("reset-view", subscription)
    return () => {
      ipcRenderer.removeListener("reset-view", subscription)
    }
  },
  onSolutionStart: (callback: () => void) => {
    const subscription = () => callback()
    ipcRenderer.on(PROCESSING_EVENTS.INITIAL_START, subscription)
    return () => {
      ipcRenderer.removeListener(PROCESSING_EVENTS.INITIAL_START, subscription)
    }
  },
  onDebugStart: (callback: () => void) => {
    const subscription = () => callback()
    ipcRenderer.on(PROCESSING_EVENTS.DEBUG_START, subscription)
    return () => {
      ipcRenderer.removeListener(PROCESSING_EVENTS.DEBUG_START, subscription)
    }
  },
  onDebugSuccess: (callback: (data: any) => void) => {
    ipcRenderer.on("debug-success", (_event, data) => callback(data))
    return () => {
      ipcRenderer.removeListener("debug-success", (_event, data) =>
        callback(data)
      )
    }
  },
  onDebugError: (callback: (error: string) => void) => {
    const subscription = (_: any, error: string) => callback(error)
    ipcRenderer.on(PROCESSING_EVENTS.DEBUG_ERROR, subscription)
    return () => {
      ipcRenderer.removeListener(PROCESSING_EVENTS.DEBUG_ERROR, subscription)
    }
  },
  onSolutionError: (callback: (error: string) => void) => {
    const subscription = (_: any, error: string) => callback(error)
    ipcRenderer.on(PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR, subscription)
    return () => {
      ipcRenderer.removeListener(
        PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR,
        subscription
      )
    }
  },
  onProcessingNoScreenshots: (callback: () => void) => {
    const subscription = () => callback()
    ipcRenderer.on(PROCESSING_EVENTS.NO_SCREENSHOTS, subscription)
    return () => {
      ipcRenderer.removeListener(PROCESSING_EVENTS.NO_SCREENSHOTS, subscription)
    }
  },
  onOutOfCredits: (callback: () => void) => {
    const subscription = () => callback()
    ipcRenderer.on(PROCESSING_EVENTS.OUT_OF_CREDITS, subscription)
    return () => {
      ipcRenderer.removeListener(PROCESSING_EVENTS.OUT_OF_CREDITS, subscription)
    }
  },
  onProblemExtracted: (callback: (data: any) => void) => {
    const subscription = (_: any, data: any) => callback(data)
    ipcRenderer.on(PROCESSING_EVENTS.PROBLEM_EXTRACTED, subscription)
    return () => {
      ipcRenderer.removeListener(
        PROCESSING_EVENTS.PROBLEM_EXTRACTED,
        subscription
      )
    }
  },
  onSolutionSuccess: (callback: (data: any) => void) => {
    const subscription = (_: any, data: any) => callback(data)
    ipcRenderer.on(PROCESSING_EVENTS.SOLUTION_SUCCESS, subscription)
    return () => {
      ipcRenderer.removeListener(
        PROCESSING_EVENTS.SOLUTION_SUCCESS,
        subscription
      )
    }
  },
  onUnauthorized: (callback: () => void) => {
    const subscription = () => callback()
    ipcRenderer.on(PROCESSING_EVENTS.UNAUTHORIZED, subscription)
    return () => {
      ipcRenderer.removeListener(PROCESSING_EVENTS.UNAUTHORIZED, subscription)
    }
  },
  // External URL handler
  openLink: (url: string) => shell.openExternal(url),
  triggerScreenshot: () => ipcRenderer.invoke("trigger-screenshot"),
  triggerProcessScreenshots: () =>
    ipcRenderer.invoke("trigger-process-screenshots"),
  triggerReset: () => ipcRenderer.invoke("trigger-reset"),
  triggerMoveLeft: () => ipcRenderer.invoke("trigger-move-left"),
  triggerMoveRight: () => ipcRenderer.invoke("trigger-move-right"),
  triggerMoveUp: () => ipcRenderer.invoke("trigger-move-up"),
  triggerMoveDown: () => ipcRenderer.invoke("trigger-move-down"),
  onSubscriptionUpdated: (callback: () => void) => {
    const subscription = () => callback()
    ipcRenderer.on("subscription-updated", subscription)
    return () => {
      ipcRenderer.removeListener("subscription-updated", subscription)
    }
  },
  onSubscriptionPortalClosed: (callback: () => void) => {
    const subscription = () => callback()
    ipcRenderer.on("subscription-portal-closed", subscription)
    return () => {
      ipcRenderer.removeListener("subscription-portal-closed", subscription)
    }
  },
  onReset: (callback: () => void) => {
    const subscription = () => callback()
    ipcRenderer.on(PROCESSING_EVENTS.RESET, subscription)
    return () => {
      ipcRenderer.removeListener(PROCESSING_EVENTS.RESET, subscription)
    }
  },
  startUpdate: () => ipcRenderer.invoke("start-update"),
  installUpdate: () => ipcRenderer.invoke("install-update"),
  onUpdateAvailable: (callback: (info: any) => void) => {
    const subscription = (_: any, info: any) => callback(info)
    ipcRenderer.on("update-available", subscription)
    return () => {
      ipcRenderer.removeListener("update-available", subscription)
    }
  },
  onUpdateDownloaded: (callback: (info: any) => void) => {
    const subscription = (_: any, info: any) => callback(info)
    ipcRenderer.on("update-downloaded", subscription)
    return () => {
      ipcRenderer.removeListener("update-downloaded", subscription)
    }
  },
  decrementCredits: () => ipcRenderer.invoke("decrement-credits"),
  onCreditsUpdated: (callback: (credits: number) => void) => {
    const subscription = (_event: any, credits: number) => callback(credits)
    ipcRenderer.on("credits-updated", subscription)
    return () => {
      ipcRenderer.removeListener("credits-updated", subscription)
    }
  },
  getPlatform: () => process.platform,
  
  // New methods for OpenAI API integration
  getConfig: () => ipcRenderer.invoke("get-config"),
  updateConfig: (config: { apiKey?: string; model?: string; language?: string; opacity?: number }) => 
    ipcRenderer.invoke("update-config", config),
  onShowSettings: (callback: () => void) => {
    const subscription = () => callback()
    ipcRenderer.on("show-settings-dialog", subscription)
    return () => {
      ipcRenderer.removeListener("show-settings-dialog", subscription)
    }
  },
  checkApiKey: () => ipcRenderer.invoke("check-api-key"),
  validateApiKey: (apiKey: string) => 
    ipcRenderer.invoke("validate-api-key", apiKey),
  openExternal: (url: string) => 
    ipcRenderer.invoke("openExternal", url),
  onApiKeyInvalid: (callback: () => void) => {
    const subscription = () => callback()
    ipcRenderer.on(PROCESSING_EVENTS.API_KEY_INVALID, subscription)
    return () => {
      ipcRenderer.removeListener(PROCESSING_EVENTS.API_KEY_INVALID, subscription)
    }
  },
  removeListener: (eventName: string, callback: (...args: any[]) => void) => {
    ipcRenderer.removeListener(eventName, callback)
  },
  onDeleteLastScreenshot: (callback: () => void) => {
    const subscription = () => callback()
    ipcRenderer.on("delete-last-screenshot", subscription)
    return () => {
      ipcRenderer.removeListener("delete-last-screenshot", subscription)
    }
  },
  deleteLastScreenshot: () => ipcRenderer.invoke("delete-last-screenshot"),
  
  // Add Voice Input support
  onToggleVoiceInput: (callback: () => void) => {
    const subscription = () => callback();
    ipcRenderer.on('toggle-voice-input', subscription);
    return () => {
      ipcRenderer.removeListener('toggle-voice-input', subscription);
    };
  },
  // New methods for voice input and text input
  toggleVoiceInput: () => ipcRenderer.invoke("toggle-voice-input"),
  showTextInputDialog: () => ipcRenderer.invoke("show-input-dialog"),
  
  // Dialog submission and cancellation with session IDs
  dialogSubmit: (sessionId: string, text: string) => 
    ipcRenderer.send("dialog-submit", sessionId, text),
  dialogCancel: (sessionId: string) => 
    ipcRenderer.send("dialog-cancel", sessionId),
  
  // Overlay-based input dialog events  
  onShowInputOverlay: (callback: (sessionId: string) => void) => {
    const subscription = (_: any, sessionId: string) => callback(sessionId);
    ipcRenderer.on('show-input-overlay', subscription);
    return () => {
      ipcRenderer.removeListener('show-input-overlay', subscription);
    };
  },
  onCloseInputOverlay: (callback: () => void) => {
    const subscription = () => callback();
    ipcRenderer.on('close-input-overlay', subscription);
    return () => {
      ipcRenderer.removeListener('close-input-overlay', subscription);
    };
  },
  
  // Add a specific method for the handle-ai-query channel
  handleAiQuery: (args: { query: string; language: string }) => 
    ipcRenderer.invoke('handle-ai-query', args),

  // --- Methods needed for Whisper IPC ---
  // Ensure invoke is exposed (if not already covered by a generic one)
  invoke: (channel: string, ...args: any[]) => {
      safeLog(`Preload: Invoking ${channel} with args:`, args);
      // Validate channel names if needed for security
      const allowedInvokeChannels = [
        'start-audio-capture', 'stop-audio-capture', 
        // Add other existing invoke channels used by your app here
        'open-subscription-portal', 'open-settings-portal', 'update-content-dimensions', 
        'clear-store', 'get-screenshots', 'delete-screenshot', 'toggle-window',
        'trigger-screenshot', 'trigger-process-screenshots', 'trigger-reset',
        'trigger-move-left', 'trigger-move-right', 'trigger-move-up', 'trigger-move-down',
        'start-update', 'install-update', 'decrement-credits', 'get-config',
        'update-config', 'check-api-key', 'validate-api-key', 'openExternal',
        'delete-last-screenshot', 'toggle-voice-input', 'show-input-dialog', 
        'handle-ai-query',
        'get-ai-settings', 
        'save-ai-settings',
        'getOpenAIApiKey', 
        'getGoogleSpeechApiKey',
        'saveGoogleSpeechApiKey',
        'getSpeechService',
        'saveSpeechService',
        'extract-resume-text',
        'transcribe-audio',
        'generate-response-suggestion',
        'get-audio-device-settings',
        'save-audio-device-settings',
        'testGoogleSpeechApiKey',
        'get-personality-prompt',
        'get-personality',
      ];
      if (!allowedInvokeChannels.includes(channel)) {
          safeLog(`Preload ERROR: Denied invoke call to untrusted channel: ${channel}`);
          throw new Error(`Untrusted invoke channel: ${channel}`);
      }
      return ipcRenderer.invoke(channel, ...args);
  },
  // Ensure on is exposed for general listeners (if not already covered)
  on: (channel: string, func: (...args: any[]) => void) => {
    safeLog(`Preload: Registering generic listener for ${channel}`);
    const allowedListenerChannels = [
        // Add other existing listener channels used by your app here
        'screenshot-taken', 'reset-view', 'debug-success', 'debug-error', 
        'solution-error', 'processing-no-screenshots', 'out-of-credits', 
        'problem-extracted', 'solution-success', 'unauthorized', 
        'subscription-updated', 'subscription-portal-closed', 'reset',
        'update-available', 'update-downloaded', 'credits-updated', 
        'show-settings-dialog', 'api-key-invalid', 'delete-last-screenshot',
        'toggle-voice-input', 'show-input-overlay', 'close-input-overlay',
        'restore-focus', 'audio-capture-error', 'audio-capture-status',
        'auto-response-update'
        // DO NOT add 'audio-data-chunk' here if using specific handler below
    ];
     if (!allowedListenerChannels.includes(channel)) {
         safeLog(`Preload ERROR: Denied listener registration for untrusted channel: ${channel}`);
         throw new Error(`Untrusted listener channel: ${channel}`);
     }
    // Deliberately strip event as it includes `sender`
    const subscription = (event: Electron.IpcRendererEvent, ...args: any[]) => func(...args);
    ipcRenderer.on(channel, subscription);
    // Return a cleanup function
    return () => {
      safeLog(`Preload: Removing generic listener for ${channel}`);
      ipcRenderer.removeListener(channel, subscription);
    };
  },

  // Explicit listener setup for audio data
  /* // Commented out onAudioDataChunk
  onAudioDataChunk: (callback: (audioBuffer: ArrayBuffer) => void) => {
    const handler = (event: Electron.IpcRendererEvent, audioBuffer: ArrayBuffer) => {
        // Validate data if possible (e.g., check if it's an ArrayBuffer)
        if (!(audioBuffer instanceof ArrayBuffer)) {
            safeLog('Preload ERROR: Received non-ArrayBuffer data on audio-data-chunk channel');
            return; 
        }
        // safeLog('Preload: Received audio-data-chunk'); // Can be very verbose
        callback(audioBuffer);
    };
    const channelName = 'audio-data-chunk';
    ipcRenderer.on(channelName, handler);
    safeLog(`Preload: Registered specific listener for ${channelName}`);
    return () => {
        safeLog(`Preload: Removing specific listener for ${channelName}`);
        ipcRenderer.removeListener(channelName, handler);
    };
  },
  */
  // --- End of Whisper IPC Methods ---

  // Transcribe audio data
  transcribeAudio: async (audioData: ArrayBuffer | { buffer: ArrayBuffer, mimeType: string }) => {
    // Handle new format with mimeType
    if (audioData && typeof audioData === 'object' && 'buffer' in audioData && 'mimeType' in audioData) {
      const result = await ipcRenderer.invoke('transcribe-audio', audioData);
      // Return the complete result including word timestamps if available
      return result;
    } else {
      // Legacy format (just buffer)
      const result = await ipcRenderer.invoke('transcribe-audio', audioData);
      // Return the complete result including word timestamps if available
      return result;
    }
  },

  // New audio capture notification events
  onAudioCaptureError: (callback: (error: {
    type: string;
    message: string;
    details: string;
    troubleshooting: string[];
  }) => void) => {
    const subscription = (_: any, error: any) => callback(error);
    ipcRenderer.on('audio-capture-error', subscription);
    return () => {
      ipcRenderer.removeListener('audio-capture-error', subscription);
    };
  },
  
  onAudioCaptureStatus: (callback: (status: {
    status: 'started' | 'stopped';
    usingTeamsDriver?: boolean;
    message: string;
  }) => void) => {
    const subscription = (_: any, status: any) => callback(status);
    ipcRenderer.on('audio-capture-status', subscription);
    return () => {
      ipcRenderer.removeListener('audio-capture-status', subscription);
    };
  },

  getOpenAIApiKey: () => ipcRenderer.invoke('getOpenAIApiKey'),

  getGoogleSpeechApiKey: () => ipcRenderer.invoke('getGoogleSpeechApiKey'),
  saveGoogleSpeechApiKey: (apiKey: string) => ipcRenderer.invoke('saveGoogleSpeechApiKey', apiKey),
  getSpeechService: () => ipcRenderer.invoke('getSpeechService'),
  saveSpeechService: (service: 'whisper' | 'google') => ipcRenderer.invoke('saveSpeechService', service),

  // uploadResume: (filePath: string) => ipcRenderer.invoke('handle-resume-upload', filePath), // Remove/comment old one
  // Add new handlers
  extractResumeText: (filePath: string) => ipcRenderer.invoke('extract-resume-text', filePath),
  getAiSettings: () => ipcRenderer.invoke('get-ai-settings'),
  // Allow partial settings object for saving
  saveAiSettings: (settings: Partial<{ personality: string; interviewStage: string; userPreferences: string }>) => 
    ipcRenderer.invoke('save-ai-settings', settings),
  generateResponseSuggestion: (payload: { question: string; jobContext: any; resumeTextContent: string | null; speakerRole?: string }) => 
    ipcRenderer.invoke('generate-response-suggestion', payload),

  // Add a direct method to update the main UI display
  updateAssistanceDisplay: (responseText: string) => {
    safeLog("Updating main UI with auto response");
    // This will be a shared window variable that the main UI can watch
    try {
      // Set the response in window.__AUTO_RESPONSE__ variable
      // This will be observed by the main UI component
      if (window) {
        (window as any).__AUTO_RESPONSE__ = responseText;
        
        // Also dispatch a custom event that components can listen for
        const event = new CustomEvent('auto-response-generated', { 
          detail: { responseText } 
        });
        window.dispatchEvent(event);
        
        // Also send an IPC message to the main process
        // This allows the main process to forward it to all renderers if needed
        ipcRenderer.invoke('auto-response-generated', responseText)
          .catch(err => safeLog("Error sending auto-response IPC:", err));
        
        return true;
      }
      return false;
    } catch (error) {
      safeLog("Error updating assistance display:", error);
      return false;
    }
  },
  
  // Listen for automatic response generation events
  onAutoResponseGenerated: (callback: (responseText: string) => void) => {
    const handler = (event: CustomEvent) => {
      callback(event.detail.responseText);
    };
    
    window.addEventListener('auto-response-generated', handler as EventListener);
    
    // Return cleanup function
    return () => {
      window.removeEventListener('auto-response-generated', handler as EventListener);
    };
  },
  
  // Listen for auto-response updates from main process
  onAutoResponseUpdate: (callback: (responseText: string) => void) => {
    const subscription = (_: any, responseText: string) => callback(responseText);
    ipcRenderer.on('auto-response-update', subscription);
    return () => {
      ipcRenderer.removeListener('auto-response-update', subscription);
    };
  },

  // ---> Add Audio Device Settings Methods <-----
  getAudioDeviceSettings: () => ipcRenderer.invoke('get-audio-device-settings'),
  saveAudioDeviceSettings: (settings: { speakerDeviceId?: string | null; microphoneDeviceId?: string | null }) => 
    ipcRenderer.invoke('save-audio-device-settings', settings),
  // ---> END Add Methods <-----------------------
}

// Before exposing the API
safeLog(
  "About to expose electronAPI with methods:",
  Object.keys(electronAPI)
)

// Expose the API
contextBridge.exposeInMainWorld("electronAPI", electronAPI)

safeLog("electronAPI exposed to window")

// Add this focus restoration handler
ipcRenderer.on("restore-focus", () => {
  // Try to focus the active element if it exists
  const activeElement = document.activeElement as HTMLElement
  if (activeElement && typeof activeElement.focus === "function") {
    activeElement.focus()
  }
})

// Remove auth-callback handling - no longer needed

// Also expose a way to remove listeners if needed (example)
contextBridge.exposeInMainWorld("electronUtils", {
  removeListener: (channel: string, listener: (...args: any[]) => void) => {
    ipcRenderer.removeListener(channel, listener)
  }
})

declare global {
  interface Window {
    electron: {
      // ... existing electron properties ...
      getPlatform: () => NodeJS.Platform;
      getConfig: () => Promise<any>; // Consider defining a specific config type
      updateConfig: (config: { apiKey?: string; model?: string; language?: string; opacity?: number }) => Promise<void>;
      onShowSettings: (callback: () => void) => () => void;
      checkApiKey: () => Promise<boolean>;
      validateApiKey: (apiKey: string) => Promise<boolean>;
      openExternal: (url: string) => Promise<void>;
      onApiKeyInvalid: (callback: () => void) => () => void;
      removeListener: (eventName: string, callback: (...args: any[]) => void) => void;
      removeAllListeners: (eventName: string) => void;
      // ... other existing methods ...

      // Transcription / Assistant related
      toggleVoiceInput: () => Promise<boolean>;
      // startAudioCapture: () => Promise<void>; // Removed native capture
      // stopAudioCapture: () => Promise<void>; // Removed native capture
      transcribeAudio: (audioData: { buffer: ArrayBuffer; type: string }) => Promise<string | null>;
      handleAiQuery: (args: { query: string; language?: string }) => Promise<string | null>;
      // handleResumeUpload: (filePath: string) => Promise<string | null>; // Likely replaced by extractResumeText
      getGoogleSpeechApiKey: () => Promise<string | null>;
      saveGoogleSpeechApiKey: (apiKey: string) => Promise<void>;
      getSpeechService: () => Promise<'whisper' | 'google' | null>;
      saveSpeechService: (service: 'whisper' | 'google') => Promise<void>;

      // ---> Updated AI Settings Types <-----
      getAiSettings: () => Promise<{ 
        personality: string; 
        interviewStage: string; 
        userPreferences: string; 
      }>; // No longer null
      saveAiSettings: (settings: { 
        personality?: string; // Allow partial updates
        interviewStage?: string; 
        userPreferences?: string; 
      }) => Promise<void>; 
      // ---> END Updated Types <----------
      
      // ---> Add Resume Text Extraction Type <-----
      extractResumeText: (filePath: string) => Promise<string | null>;
      // ---> END Add Type <-------------------------

      // ---> Add Response Suggestion Type <-----
      generateResponseSuggestion: (payload: { question: string; jobContext: any; resumeTextContent: string | null; speakerRole?: string }) => Promise<{ success: boolean; data?: string; error?: string }>;
      // ---> END Add Type <-------------------------

      // ---> Add Auto Response Types <-----
      updateAssistanceDisplay: (responseText: string) => boolean;
      onAutoResponseGenerated: (callback: (responseText: string) => void) => (() => void);
      onAutoResponseUpdate: (callback: (responseText: string) => void) => (() => void);
      // ---> END Add Type <-------------------------

      onTranscriptionReceived: (callback: (text: string) => void) => () => void;
      onTranscriptionError: (callback: (error: any) => void) => () => void;
      // ... potentially other methods ...
      ipcRenderer: {
        invoke(channel: string, ...args: any[]): Promise<any>;
        on(channel: string, listener: (event: Electron.IpcRendererEvent, ...args: any[]) => void): Electron.IpcRenderer;
        removeListener(channel: string, listener: (...args: any[]) => void): Electron.IpcRenderer;
        // Add send if needed
      };

      // ---> Add Audio Device Settings Methods <-----
      getAudioDeviceSettings: () => Promise<{ speakerDeviceId: string | null; microphoneDeviceId: string | null }>;
      saveAudioDeviceSettings: (settings: { speakerDeviceId?: string | null; microphoneDeviceId?: string | null }) => Promise<{ success: boolean; error?: string }>;
      // ---> END Add Methods <-----------------------
    }
  }
}
