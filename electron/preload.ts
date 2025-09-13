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

// --- Centralized Whitelisted Channels ---
// Combine all necessary channels here
const ipcRendererInvokeChannel: string[] = [
  'open-subscription-portal', 'open-settings-portal', 'update-content-dimensions', 
  'clear-store', 'get-screenshots', 'delete-screenshot', 'toggle-window',
  'trigger-screenshot', 'trigger-process-screenshots', 'trigger-reset',
  'trigger-move-left', 'trigger-move-right', 'trigger-move-up', 'trigger-move-down',
  'start-update', 'install-update', 'decrement-credits', 'get-config',
  'update-config', 'check-api-key', 'validate-api-key', 'openExternal',
  'delete-last-screenshot', 'toggle-voice-input', 'show-input-dialog', 
  'handle-ai-query',
  'get-ai-settings', 'save-ai-settings',
  'getOpenAIApiKey', // Assuming this exists in main
  'getGoogleSpeechApiKey', 'setGoogleSpeechApiKey', 
  'getSpeechService', 'setSpeechService', // Renamed saveSpeechService
  'testGoogleSpeechApiKey', 'has-service-account-credentials',
  'set-service-account-credentials-from-file', 
  'set-service-account-credentials-from-text', // Added
  'clear-service-account-credentials',
  'extract-resume-text', 'transcribe-audio', 'generate-response-suggestion',
  'get-audio-device-settings', 'save-audio-device-settings',
  'get-personality-prompt', 'get-personality',
  'dialog:openFile', 'dialog:saveFile', 'get-app-path', 'get-config-sync',
  'test-api-key', 'speech:getStatus',
   // Add any other invoke channels used
];

const ipcRendererOnChannel: string[] = [
  'screenshot-taken', 'reset-view', 'debug-success', 'debug-error', 
  'solution-error', 'processing-no-screenshots', 'out-of-credits', 
  'problem-extracted', 'solution-success', 'unauthorized', 
  'subscription-updated', 'subscription-portal-closed', 'reset',
  'update-available', 'update-downloaded', 'credits-updated', 
  'show-settings-dialog', 'api-key-invalid', 'delete-last-screenshot',
  'toggle-voice-input', 'show-input-overlay', 'close-input-overlay',
  'restore-focus', 'audio-capture-error', 'audio-capture-status',
  'auto-response-update',
  // Speech specific listeners
  // 'speech:transcription', // Kept for potential other uses?
  // 'speech:error',         // Kept for potential other uses?
  // 'speech:status',        // Kept for potential other uses?
  'speech:transcript-update', // <<<<< Main transcript channel
  'speech:stream-error',    // <<<<< Main error channel
  'speech:status',          // <<<<< CORRECTED: Ensure status channel is whitelisted
   // Add any other listener channels used
];

const ipcRendererSendChannel: string[] = [
  'toMain', 'extract-solution', 'debug-code', 'minimize-window',
  'set-opacity', 'reset-app', 'reload-window', 'toggle-inspector',
  'devtools', 'quit-app', 'set-config', 'get-config', // Note: get-config might be invoke
  'rescan-problem', 'screenshot', 'delete-last-screenshot',
  // Speech recognition channels
  'speech:start', 'speech:stop', 'speech:pause', 'speech:resume',
  'speech:audio-data', 'speech:start-capture', 'speech:stop-capture',
  'dialog-submit', 'dialog-cancel', 
   // Add any other send channels used
];

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

// --- Define the electronAPI object ---
const electronAPI = {
  // Generic IPC handlers
  invoke: (channel: string, ...args: any[]) => {
    if (ipcRendererInvokeChannel.includes(channel)) {
      safeLog(`Preload: Invoking ${channel}`);
      return ipcRenderer.invoke(channel, ...args);
    }
    safeLog(`Preload ERROR: Denied invoke call to untrusted channel: ${channel}`);
    throw new Error(`Untrusted invoke channel: ${channel}`);
  },
  send: (channel: string, ...args: any[]) => {
    if (ipcRendererSendChannel.includes(channel)) {
      ipcRenderer.send(channel, ...args);
    } else {
      safeLog(`Preload ERROR: Denied send call to untrusted channel: ${channel}`);
    }
  },
  on: (channel: string, func: (...args: any[]) => void) => {
    if (ipcRendererOnChannel.includes(channel)) {
      const subscription = (event: Electron.IpcRendererEvent, ...args: any[]) => func(...args);
      ipcRenderer.on(channel, subscription);
      safeLog(`Preload: Registered generic listener for ${channel}`);
      return () => {
        safeLog(`Preload: Removing generic listener for ${channel}`);
        ipcRenderer.removeListener(channel, subscription);
      };
    }
    safeLog(`Preload ERROR: Denied listener registration for untrusted channel: ${channel}`);
    // Return an empty cleanup function for disallowed channels
    return () => {}; 
  },
  removeListener: (channel: string, func: (...args: any[]) => void) => {
    // No channel validation needed here, assuming it was validated on 'on'
    ipcRenderer.removeListener(channel, func);
  },
  removeAllListeners: (channel: string) => {
     if (ipcRendererOnChannel.includes(channel)) { // Validate again for safety
       ipcRenderer.removeAllListeners(channel);
     } else {
       safeLog(`Preload ERROR: Denied removeAllListeners call for untrusted channel: ${channel}`);
     }
  },

  // Original specific methods
  openSubscriptionPortal: async (authData: { id: string; email: string }) => 
    ipcRenderer.invoke("open-subscription-portal", authData),
  openSettingsPortal: () => ipcRenderer.invoke("open-settings-portal"),
  updateContentDimensions: (dimensions: { width: number; height: number }) =>
    ipcRenderer.invoke("update-content-dimensions", dimensions),
  clearStore: () => ipcRenderer.invoke("clear-store"),
  getScreenshots: () => ipcRenderer.invoke("get-screenshots"),
  deleteScreenshot: (path: string) =>
    ipcRenderer.invoke("delete-screenshot", path),
  toggleMainWindow: async () => ipcRenderer.invoke("toggle-window"),
  openLink: (url: string) => shell.openExternal(url), // Use shell directly
  triggerScreenshot: () => ipcRenderer.invoke("trigger-screenshot"),
  triggerProcessScreenshots: () =>
    ipcRenderer.invoke("trigger-process-screenshots"),
  triggerReset: () => ipcRenderer.invoke("trigger-reset"),
  triggerMoveLeft: () => ipcRenderer.invoke("trigger-move-left"),
  triggerMoveRight: () => ipcRenderer.invoke("trigger-move-right"),
  triggerMoveUp: () => ipcRenderer.invoke("trigger-move-up"),
  triggerMoveDown: () => ipcRenderer.invoke("trigger-move-down"),
  startUpdate: () => ipcRenderer.invoke("start-update"),
  installUpdate: () => ipcRenderer.invoke("install-update"),
  decrementCredits: () => ipcRenderer.invoke("decrement-credits"),
  getPlatform: () => process.platform,
  getConfig: () => ipcRenderer.invoke("get-config"),
  updateConfig: (config: { apiKey?: string; model?: string; language?: string; opacity?: number }) => 
    ipcRenderer.invoke("update-config", config),
  // Provider-specific API key methods
  getOpenAIApiKey: () => ipcRenderer.invoke("get-openai-api-key"),
  getGeminiApiKey: () => ipcRenderer.invoke("get-gemini-api-key"),
  getAnthropicApiKey: () => ipcRenderer.invoke("get-anthropic-api-key"),
  loadSetting: (key: string) => ipcRenderer.invoke('load-setting', key),
  saveSetting: (key: string, value: any) => ipcRenderer.invoke('save-setting', key, value),
  getAISettings: () => ipcRenderer.invoke('get-ai-settings'),
  saveAISettings: (settings: any) => ipcRenderer.invoke('save-ai-settings', settings),
  getAudioDeviceSettings: () => ipcRenderer.invoke('get-audio-device-settings'),
  saveAudioDeviceSettings: (settings: any) => ipcRenderer.invoke('save-audio-device-settings', settings),
  extractResumeText: (filePath: string) => ipcRenderer.invoke('extract-resume-text', filePath),
  generateResponseSuggestion: (payload: any) => ipcRenderer.invoke('generate-response-suggestion', payload),
  transcribeAudio: (payload: any) => ipcRenderer.invoke('transcribe-audio', payload), // Assuming this exists
  checkApiKey: () => ipcRenderer.invoke("check-api-key"),
  validateApiKey: (apiKey: string) => 
    ipcRenderer.invoke("validate-api-key", apiKey),
  openExternal: (url: string) => // Duplicate, keep one
    ipcRenderer.invoke("openExternal", url),
  deleteLastScreenshot: () => ipcRenderer.invoke("delete-last-screenshot"),
  toggleVoiceInput: () => ipcRenderer.invoke("toggle-voice-input"),
  showTextInputDialog: () => ipcRenderer.invoke("show-input-dialog"),
  dialogSubmit: (sessionId: string, text: string) => 
    ipcRenderer.send("dialog-submit", sessionId, text),
  dialogCancel: (sessionId: string) => 
    ipcRenderer.send("dialog-cancel", sessionId),
  handleAiQuery: (args: { query: string; language: string }) => 
    ipcRenderer.invoke('handle-ai-query', args),
  getGoogleSpeechApiKey: () => ipcRenderer.invoke('getGoogleSpeechApiKey'),
  setGoogleSpeechApiKey: (apiKey: string) => ipcRenderer.invoke('setGoogleSpeechApiKey', apiKey),
  getSpeechService: () => ipcRenderer.invoke('getSpeechService'),
  setSpeechService: (service: 'whisper' | 'google') => ipcRenderer.invoke('setSpeechService', service), // Renamed from saveSpeechService
  testGoogleSpeechApiKey: () => ipcRenderer.invoke('testGoogleSpeechApiKey'), // Added based on usage
  // Stealth mode methods
  enableStealthMode: () => ipcRenderer.invoke('enable-stealth-mode'),
  disableStealthMode: () => ipcRenderer.invoke('disable-stealth-mode'),
  getProcessInfo: () => ipcRenderer.invoke('get-process-info'),
  forceQuitApp: () => ipcRenderer.invoke('force-quit-app'),
  hasServiceAccountCredentials: () => ipcRenderer.invoke('has-service-account-credentials'),
  setServiceAccountCredentialsFromFile: (filePath: string) => 
    ipcRenderer.invoke('set-service-account-credentials-from-file', filePath),
  setServiceAccountCredentialsFromText: (keyJsonText: string) => // Added
    ipcRenderer.invoke('set-service-account-credentials-from-text', keyJsonText),
  clearServiceAccountCredentials: () => 
    ipcRenderer.invoke('clear-service-account-credentials'),
  getPersonalityPrompt: (personality?: string) => ipcRenderer.invoke('get-personality-prompt', personality), // Added based on usage
  getPersonality: () => ipcRenderer.invoke('get-personality'), // Added based on usage


  // Specific Listeners (using the generic 'on' method internally for consistency)
  onScreenshotTaken: (callback: (data: { path: string; preview: string }) => void) => 
    electronAPI.on('screenshot-taken', callback),
  onResetView: (callback: () => void) => 
    electronAPI.on('reset-view', callback),
  onSolutionStart: (callback: () => void) => 
    electronAPI.on(PROCESSING_EVENTS.INITIAL_START, callback),
  onDebugStart: (callback: () => void) => 
    electronAPI.on(PROCESSING_EVENTS.DEBUG_START, callback),
  onDebugSuccess: (callback: (data: any) => void) => 
    electronAPI.on("debug-success", callback),
  onDebugError: (callback: (error: string) => void) => 
    electronAPI.on(PROCESSING_EVENTS.DEBUG_ERROR, callback),
  onSolutionError: (callback: (error: string) => void) => 
    electronAPI.on(PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR, callback),
  onProcessingNoScreenshots: (callback: () => void) => 
    electronAPI.on(PROCESSING_EVENTS.NO_SCREENSHOTS, callback),
  onOutOfCredits: (callback: () => void) => 
    electronAPI.on(PROCESSING_EVENTS.OUT_OF_CREDITS, callback),
  onProblemExtracted: (callback: (data: any) => void) => 
    electronAPI.on(PROCESSING_EVENTS.PROBLEM_EXTRACTED, callback),
  onSolutionSuccess: (callback: (data: any) => void) => 
    electronAPI.on(PROCESSING_EVENTS.SOLUTION_SUCCESS, callback),
  onUnauthorized: (callback: () => void) => 
    electronAPI.on(PROCESSING_EVENTS.UNAUTHORIZED, callback),
  onSubscriptionUpdated: (callback: () => void) => 
    electronAPI.on("subscription-updated", callback),
  onSubscriptionPortalClosed: (callback: () => void) => 
    electronAPI.on("subscription-portal-closed", callback),
  onReset: (callback: () => void) => 
    electronAPI.on(PROCESSING_EVENTS.RESET, callback),
  onUpdateAvailable: (callback: (info: any) => void) => 
    electronAPI.on("update-available", callback),
  onUpdateDownloaded: (callback: (info: any) => void) => 
    electronAPI.on("update-downloaded", callback),
  onCreditsUpdated: (callback: (credits: number) => void) => 
    electronAPI.on("credits-updated", callback),
  onShowSettings: (callback: () => void) => 
    electronAPI.on("show-settings-dialog", callback),
  onApiKeyInvalid: (callback: () => void) => 
    electronAPI.on(PROCESSING_EVENTS.API_KEY_INVALID, callback),
  onDeleteLastScreenshot: (callback: () => void) => 
    electronAPI.on("delete-last-screenshot", callback),
  onToggleVoiceInput: (callback: () => void) => 
    electronAPI.on('toggle-voice-input', callback),
  onShowInputOverlay: (callback: (sessionId: string) => void) => 
    electronAPI.on('show-input-overlay', callback),
  onCloseInputOverlay: (callback: () => void) => 
    electronAPI.on('close-input-overlay', callback),
  onAudioCaptureError: (callback: (error: any) => void) => 
    electronAPI.on('audio-capture-error', callback),
  onAudioCaptureStatus: (callback: (status: any) => void) => 
    electronAPI.on('audio-capture-status', callback),
  onAutoResponseUpdate: (callback: (responseText: string) => void) =>
    electronAPI.on('auto-response-update', callback),

  // --- NEW: Listeners for Transcription Updates/Errors from Main Process --- 
  // These now use the generic 'on' method which handles channel validation and cleanup
  onTranscriptionReceived: (callback: (data: { transcript: string, isFinal: boolean, speaker: 'user' | 'interviewer' }) => void) => 
    electronAPI.on('speech:transcript-update', callback),
  onSpeechStreamError: (callback: (error: { code: number, message: string }) => void) => 
    electronAPI.on('speech:stream-error', callback),

  // --- NEW: Listener for Status Updates from Main Process ---
  onSpeechStatusUpdate: (callback: (status: string) => void) => 
    electronAPI.on('speech:status', callback),

  // Flag to indicate running in Electron
  isElectron: true,
};

// Expose the consolidated API
safeLog("About to expose electronAPI with methods:", Object.keys(electronAPI));
contextBridge.exposeInMainWorld("electronAPI", electronAPI);
safeLog("electronAPI exposed to window");

// Add focus restoration handler
ipcRenderer.on("restore-focus", () => {
  const activeElement = document.activeElement as HTMLElement;
  if (activeElement && typeof activeElement.focus === "function") {
    activeElement.focus();
  }
});
