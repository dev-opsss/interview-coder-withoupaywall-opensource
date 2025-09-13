import '@testing-library/jest-dom';

// Mock Electron APIs
const mockElectronAPI = {
  // Configuration methods
  getConfig: jest.fn(),
  updateConfig: jest.fn(),
  checkApiKey: jest.fn(),
  validateApiKey: jest.fn(),
  
  // Provider-specific API keys
  getOpenAIApiKey: jest.fn(),
  getGeminiApiKey: jest.fn(),
  getAnthropicApiKey: jest.fn(),
  
  // Screenshot methods
  getScreenshots: jest.fn(),
  deleteScreenshot: jest.fn(),
  triggerScreenshot: jest.fn(),
  triggerProcessScreenshots: jest.fn(),
  takeScreenshot: jest.fn(),
  
  // Window management
  toggleMainWindow: jest.fn(),
  triggerReset: jest.fn(),
  triggerMoveLeft: jest.fn(),
  triggerMoveRight: jest.fn(),
  triggerMoveUp: jest.fn(),
  triggerMoveDown: jest.fn(),
  updateContentDimensions: jest.fn(),
  
  // Multi-monitor methods
  invoke: jest.fn(),
  'get-monitors': jest.fn(),
  'get-current-monitor': jest.fn(),
  'move-window-to-monitor': jest.fn(),
  'move-window-to-next-monitor': jest.fn(),
  'get-window-presets': jest.fn(),
  'apply-window-preset': jest.fn(),
  'create-window-preset': jest.fn(),
  'remove-window-preset': jest.fn(),
  'get-multi-monitor-settings': jest.fn(),
  'update-multi-monitor-settings': jest.fn(),
  
  // Speech recognition
  getGoogleSpeechApiKey: jest.fn(),
  setGoogleSpeechApiKey: jest.fn(),
  testGoogleSpeechApiKey: jest.fn(),
  getSpeechService: jest.fn(),
  setSpeechService: jest.fn(),
  transcribeAudio: jest.fn(),
  toggleVoiceInput: jest.fn(),
  
  // AI settings
  'get-ai-settings': jest.fn(),
  'save-ai-settings': jest.fn(),
  'handle-ai-query': jest.fn(),
  
  // Event listeners
  onScreenshotTaken: jest.fn(() => () => {}),
  onResetView: jest.fn(() => () => {}),
  onSolutionStart: jest.fn(() => () => {}),
  onDebugStart: jest.fn(() => () => {}),
  onDebugSuccess: jest.fn(() => () => {}),
  onSolutionError: jest.fn(() => () => {}),
  onApiKeyInvalid: jest.fn(() => () => {}),
  onTranscriptionReceived: jest.fn(() => () => {}),
  onTranscriptionError: jest.fn(() => () => {}),
  onSpeechStatusChange: jest.fn(() => () => {}),
  onShowSettings: jest.fn(() => () => {}),
  
  // Utility methods
  openLink: jest.fn(),
  openExternal: jest.fn(),
  removeListener: jest.fn(),
  
  // Platform info
  getPlatform: jest.fn(() => 'darwin'),
};

// Mock window.electronAPI
Object.defineProperty(window, 'electronAPI', {
  value: mockElectronAPI,
  writable: true,
});

// Mock global variables
Object.defineProperty(window, '__CREDITS__', {
  value: 999,
  writable: true,
});

Object.defineProperty(window, '__LANGUAGE__', {
  value: 'python',
  writable: true,
});

Object.defineProperty(window, '__IS_INITIALIZED__', {
  value: true,
  writable: true,
});

// Mock Audio Context for voice recognition tests
const mockAudioContext = {
  createAnalyser: jest.fn(() => ({
    connect: jest.fn(),
    disconnect: jest.fn(),
    frequencyBinCount: 1024,
    getByteFrequencyData: jest.fn(),
  })),
  createMediaStreamSource: jest.fn(() => ({
    connect: jest.fn(),
    disconnect: jest.fn(),
  })),
  createScriptProcessor: jest.fn(() => ({
    connect: jest.fn(),
    disconnect: jest.fn(),
    onaudioprocess: null,
  })),
  sampleRate: 44100,
  state: 'running',
  suspend: jest.fn(),
  resume: jest.fn(),
  close: jest.fn(),
};

Object.defineProperty(window, 'AudioContext', {
  value: jest.fn(() => mockAudioContext),
  writable: true,
});

Object.defineProperty(window, 'webkitAudioContext', {
  value: jest.fn(() => mockAudioContext),
  writable: true,
});

// Mock MediaRecorder
const mockMediaRecorder = {
  start: jest.fn(),
  stop: jest.fn(),
  pause: jest.fn(),
  resume: jest.fn(),
  requestData: jest.fn(),
  state: 'inactive',
  ondataavailable: null,
  onstop: null,
  onerror: null,
};

Object.defineProperty(window, 'MediaRecorder', {
  value: jest.fn(() => mockMediaRecorder),
  writable: true,
});

// Mock navigator.mediaDevices
Object.defineProperty(navigator, 'mediaDevices', {
  value: {
    getUserMedia: jest.fn(() => Promise.resolve({
      getTracks: () => [{ stop: jest.fn() }],
    })),
    enumerateDevices: jest.fn(() => Promise.resolve([
      {
        deviceId: 'default',
        kind: 'audioinput',
        label: 'Default - Built-in Microphone',
        groupId: 'group1',
      },
      {
        deviceId: 'speaker1',
        kind: 'audiooutput', 
        label: 'Built-in Speakers',
        groupId: 'group2',
      },
    ])),
  },
  writable: true,
});

// Mock fetch for API calls
global.fetch = jest.fn(() =>
  Promise.resolve({
    ok: true,
    json: () => Promise.resolve({}),
    text: () => Promise.resolve(''),
  })
) as jest.Mock;

// Mock ResizeObserver
global.ResizeObserver = jest.fn().mockImplementation(() => ({
  observe: jest.fn(),
  unobserve: jest.fn(),
  disconnect: jest.fn(),
}));

// Mock IntersectionObserver
global.IntersectionObserver = jest.fn().mockImplementation(() => ({
  observe: jest.fn(),
  unobserve: jest.fn(),
  disconnect: jest.fn(),
}));

// Suppress console warnings in tests
const originalConsoleWarn = console.warn;
console.warn = (...args: any[]) => {
  // Suppress specific warnings that are expected in tests
  const message = args[0];
  if (
    typeof message === 'string' && (
      message.includes('Warning: ReactDOM.render is deprecated') ||
      message.includes('Warning: componentWillReceiveProps') ||
      message.includes('act(...)')
    )
  ) {
    return;
  }
  originalConsoleWarn.apply(console, args);
};

// Don't use fake timers by default as they cause issues with async tests
// jest.useFakeTimers();

// Clean up after each test
afterEach(() => {
  jest.clearAllMocks();
  // jest.clearAllTimers(); // Only clear if using fake timers
});

// Export mock for use in tests
export { mockElectronAPI };
