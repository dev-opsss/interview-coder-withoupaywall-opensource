export interface ElectronAPI {
  // Original methods
  openSubscriptionPortal: (authData: {
    id: string
    email: string
  }) => Promise<{ success: boolean; error?: string }>
  updateContentDimensions: (dimensions: {
    width: number
    height: number
  }) => Promise<void>
  clearStore: () => Promise<{ success: boolean; error?: string }>
  getScreenshots: () => Promise<{
    success: boolean
    previews?: Array<{ path: string; preview: string }> | null
    error?: string
  }>
  deleteScreenshot: (
    path: string
  ) => Promise<{ success: boolean; error?: string }>
  onScreenshotTaken: (
    callback: (data: { path: string; preview: string }) => void
  ) => () => void
  onResetView: (callback: () => void) => () => void
  onSolutionStart: (callback: () => void) => () => void
  onDebugStart: (callback: () => void) => () => void
  onDebugSuccess: (callback: (data: any) => void) => () => void
  onSolutionError: (callback: (error: string) => void) => () => void
  onProcessingNoScreenshots: (callback: () => void) => () => void
  onProblemExtracted: (callback: (data: any) => void) => () => void
  onSolutionSuccess: (callback: (data: any) => void) => () => void
  onUnauthorized: (callback: () => void) => () => void
  onDebugError: (callback: (error: string) => void) => () => void
  openExternal: (url: string) => void
  toggleMainWindow: () => Promise<{ success: boolean; error?: string }>
  triggerScreenshot: () => Promise<{ success: boolean; error?: string }>
  triggerProcessScreenshots: () => Promise<{ success: boolean; error?: string }>
  triggerReset: () => Promise<{ success: boolean; error?: string }>
  triggerMoveLeft: () => Promise<{ success: boolean; error?: string }>
  triggerMoveRight: () => Promise<{ success: boolean; error?: string }>
  triggerMoveUp: () => Promise<{ success: boolean; error?: string }>
  triggerMoveDown: () => Promise<{ success: boolean; error?: string }>
  onSubscriptionUpdated: (callback: () => void) => () => void
  onSubscriptionPortalClosed: (callback: () => void) => () => void
  startUpdate: () => Promise<{ success: boolean; error?: string }>
  installUpdate: () => void
  onUpdateAvailable: (callback: (info: any) => void) => () => void
  onUpdateDownloaded: (callback: (info: any) => void) => () => void

  decrementCredits: () => Promise<void>
  setInitialCredits: (credits: number) => Promise<void>
  onCreditsUpdated: (callback: (credits: number) => void) => () => void
  onOutOfCredits: (callback: () => void) => () => void
  openSettingsPortal: () => Promise<void>
  getPlatform: () => string
  
  // New methods for OpenAI integration
  getConfig: () => Promise<{ apiKey: string; model: string }>
  updateConfig: (config: { apiKey?: string; model?: string }) => Promise<boolean>
  // Provider-specific API key methods
  getOpenAIApiKey: () => Promise<string>
  getGeminiApiKey: () => Promise<string>
  getAnthropicApiKey: () => Promise<string>
  checkApiKey: () => Promise<boolean>
  validateApiKey: (apiKey: string) => Promise<{ valid: boolean; error?: string }>
  openLink: (url: string) => void
  onApiKeyInvalid: (callback: () => void) => () => void
  removeListener: (eventName: string, callback: (...args: any[]) => void) => void

  // Speech Recognition methods
  getGoogleSpeechApiKey: () => Promise<string | null>
  setGoogleSpeechApiKey: (apiKey: string) => Promise<{ success: boolean; error?: string }>
  testGoogleSpeechApiKey: () => Promise<{ valid: boolean; error?: string }>
  hasServiceAccountCredentials: () => Promise<boolean>
  setServiceAccountCredentialsFromFile: (filePath: string) => Promise<{ success: boolean; error?: string }>
  setServiceAccountCredentialsFromText: (keyJsonText: string) => Promise<{ success: boolean; error?: string }>
  clearServiceAccountCredentials: () => Promise<{ success: boolean; error?: string }>
  getSpeechService: () => Promise<string>
  setSpeechService: (service: string) => Promise<boolean>
  toggleVoiceInput: () => void
  transcribeAudio: (audioData: { buffer: ArrayBuffer; type: string }) => Promise<any>
  onTranscriptionReceived: (callback: (data: { transcript: string, isFinal: boolean, speaker: 'user' | 'interviewer', words?: { word: string, startTime: number, endTime: number }[] }) => void) => () => void
  onTranscriptionError: (callback: (error: string) => void) => (() => void)
  onSpeechStatusChange: (callback: (status: string) => void) => (() => void)
  onSpeechStreamError: (callback: (error: { code: number, message: string }) => void) => () => void

  // Add methods that your preload script exposes to the renderer
  send: (channel: string, ...args: any[]) => void;
  on: (channel: string, callback: (...args: any[]) => void) => (() => void);
  invoke: (channel: string, ...args: any[]) => Promise<any>;
  removeAllListeners: (channel: string) => void;
  isElectron: boolean;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
    electron: {
      ipcRenderer: {
        on: (channel: string, func: (...args: any[]) => void) => void
        removeListener: (
          channel: string,
          func: (...args: any[]) => void
        ) => void
      }
    }
    __CREDITS__: number
    __LANGUAGE__: string
    __IS_INITIALIZED__: boolean
    __AUTH_TOKEN__?: string | null
    electron?: ElectronAPI
    AudioContext: typeof AudioContext
    webkitAudioContext?: typeof AudioContext
  }
}

export {};
