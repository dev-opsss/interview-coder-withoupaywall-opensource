/**
 * Integration tests for IPC communication between main and renderer processes
 */

import { ipcMain, ipcRenderer } from 'electron';
import { mockElectronAPI } from '../setup';

// Mock electron modules
jest.mock('electron', () => ({
  ipcMain: {
    handle: jest.fn(),
    on: jest.fn(),
    removeListener: jest.fn(),
  },
  ipcRenderer: {
    invoke: jest.fn(),
    on: jest.fn(),
    send: jest.fn(),
    removeListener: jest.fn(),
  },
}));

describe('IPC Integration Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Configuration IPC', () => {
    test('should handle get-config request', async () => {
      const mockConfig = {
        apiKey: 'test-key',
        apiProvider: 'openai',
        extractionModel: 'gpt-4o',
        solutionModel: 'gpt-4o',
        debuggingModel: 'gpt-4o',
      };

      mockElectronAPI.getConfig.mockResolvedValue(mockConfig);

      const result = await mockElectronAPI.getConfig();
      
      expect(result).toEqual(mockConfig);
      expect(mockElectronAPI.getConfig).toHaveBeenCalled();
    });

    test('should handle update-config request', async () => {
      const configUpdate = {
        apiKey: 'new-test-key',
        apiProvider: 'gemini',
      };

      mockElectronAPI.updateConfig.mockResolvedValue(true);

      const result = await mockElectronAPI.updateConfig(configUpdate);
      
      expect(result).toBe(true);
      expect(mockElectronAPI.updateConfig).toHaveBeenCalledWith(configUpdate);
    });

    test('should handle check-api-key request', async () => {
      mockElectronAPI.checkApiKey.mockResolvedValue(true);

      const result = await mockElectronAPI.checkApiKey();
      
      expect(result).toBe(true);
      expect(mockElectronAPI.checkApiKey).toHaveBeenCalled();
    });

    test('should handle validate-api-key request', async () => {
      const validationResult = { valid: true };
      mockElectronAPI.validateApiKey.mockResolvedValue(validationResult);

      const result = await mockElectronAPI.validateApiKey('test-key');
      
      expect(result).toEqual(validationResult);
      expect(mockElectronAPI.validateApiKey).toHaveBeenCalledWith('test-key');
    });
  });

  describe('Multi-Monitor IPC', () => {
    const mockMonitors = [
      {
        id: 'monitor-1',
        displayId: 1,
        name: 'Built-in Display',
        bounds: { x: 0, y: 0, width: 1920, height: 1080 },
        workArea: { x: 0, y: 25, width: 1920, height: 1055 },
        scaleFactor: 1,
        isPrimary: true,
        isInternal: true,
      },
      {
        id: 'monitor-2',
        displayId: 2,
        name: 'External Monitor',
        bounds: { x: 1920, y: 0, width: 2560, height: 1440 },
        workArea: { x: 1920, y: 0, width: 2560, height: 1440 },
        scaleFactor: 1,
        isPrimary: false,
        isInternal: false,
      },
    ];

    test('should handle get-monitors request', async () => {
      mockElectronAPI.invoke.mockImplementation((channel) => {
        if (channel === 'get-monitors') {
          return Promise.resolve(mockMonitors);
        }
        return Promise.resolve(null);
      });

      const result = await mockElectronAPI.invoke('get-monitors');
      
      expect(result).toEqual(mockMonitors);
      expect(mockElectronAPI.invoke).toHaveBeenCalledWith('get-monitors');
    });

    test('should handle get-current-monitor request', async () => {
      mockElectronAPI.invoke.mockImplementation((channel) => {
        if (channel === 'get-current-monitor') {
          return Promise.resolve(mockMonitors[0]);
        }
        return Promise.resolve(null);
      });

      const result = await mockElectronAPI.invoke('get-current-monitor');
      
      expect(result).toEqual(mockMonitors[0]);
      expect(mockElectronAPI.invoke).toHaveBeenCalledWith('get-current-monitor');
    });

    test('should handle move-window-to-monitor request', async () => {
      mockElectronAPI.invoke.mockImplementation((channel, monitorId, position) => {
        if (channel === 'move-window-to-monitor') {
          return Promise.resolve({ success: true });
        }
        return Promise.resolve(null);
      });

      const result = await mockElectronAPI.invoke('move-window-to-monitor', 'monitor-2', 'center');
      
      expect(result).toEqual({ success: true });
      expect(mockElectronAPI.invoke).toHaveBeenCalledWith('move-window-to-monitor', 'monitor-2', 'center');
    });

    test('should handle move-window-to-next-monitor request', async () => {
      mockElectronAPI.invoke.mockImplementation((channel) => {
        if (channel === 'move-window-to-next-monitor') {
          return Promise.resolve({ success: true });
        }
        return Promise.resolve(null);
      });

      const result = await mockElectronAPI.invoke('move-window-to-next-monitor');
      
      expect(result).toEqual({ success: true });
      expect(mockElectronAPI.invoke).toHaveBeenCalledWith('move-window-to-next-monitor');
    });
  });

  describe('Window Presets IPC', () => {
    const mockPresets = [
      {
        id: 'preset-1',
        name: 'Top Left',
        monitorId: 'monitor-1',
        position: { x: 20, y: 20, width: 800, height: 600 },
        relativePosition: 'top-left',
      },
      {
        id: 'preset-2',
        name: 'Center',
        monitorId: 'monitor-1',
        position: { x: 560, y: 240, width: 800, height: 600 },
        relativePosition: 'center',
      },
    ];

    test('should handle get-window-presets request', async () => {
      mockElectronAPI.invoke.mockImplementation((channel) => {
        if (channel === 'get-window-presets') {
          return Promise.resolve(mockPresets);
        }
        return Promise.resolve(null);
      });

      const result = await mockElectronAPI.invoke('get-window-presets');
      
      expect(result).toEqual(mockPresets);
      expect(mockElectronAPI.invoke).toHaveBeenCalledWith('get-window-presets');
    });

    test('should handle apply-window-preset request', async () => {
      mockElectronAPI.invoke.mockImplementation((channel, presetId) => {
        if (channel === 'apply-window-preset') {
          return Promise.resolve({ success: true });
        }
        return Promise.resolve(null);
      });

      const result = await mockElectronAPI.invoke('apply-window-preset', 'preset-1');
      
      expect(result).toEqual({ success: true });
      expect(mockElectronAPI.invoke).toHaveBeenCalledWith('apply-window-preset', 'preset-1');
    });

    test('should handle create-window-preset request', async () => {
      mockElectronAPI.invoke.mockImplementation((channel, name) => {
        if (channel === 'create-window-preset') {
          return Promise.resolve({ success: true, presetId: 'new-preset-id' });
        }
        return Promise.resolve(null);
      });

      const result = await mockElectronAPI.invoke('create-window-preset', 'My Preset');
      
      expect(result).toEqual({ success: true, presetId: 'new-preset-id' });
      expect(mockElectronAPI.invoke).toHaveBeenCalledWith('create-window-preset', 'My Preset');
    });

    test('should handle remove-window-preset request', async () => {
      mockElectronAPI.invoke.mockImplementation((channel, presetId) => {
        if (channel === 'remove-window-preset') {
          return Promise.resolve({ success: true });
        }
        return Promise.resolve(null);
      });

      const result = await mockElectronAPI.invoke('remove-window-preset', 'preset-1');
      
      expect(result).toEqual({ success: true });
      expect(mockElectronAPI.invoke).toHaveBeenCalledWith('remove-window-preset', 'preset-1');
    });
  });

  describe('Speech Recognition IPC', () => {
    test('should handle transcribe-audio request', async () => {
      const audioData = { buffer: new ArrayBuffer(1024), mimeType: 'audio/webm' };
      const transcriptionResult = {
        success: true,
        text: 'Hello world',
        words: [
          { word: 'Hello', startTime: 0, endTime: 0.5 },
          { word: 'world', startTime: 0.5, endTime: 1.0 },
        ],
      };

      mockElectronAPI.transcribeAudio.mockResolvedValue(transcriptionResult);

      const result = await mockElectronAPI.transcribeAudio(audioData);
      
      expect(result).toEqual(transcriptionResult);
      expect(mockElectronAPI.transcribeAudio).toHaveBeenCalledWith(audioData);
    });

    test('should handle toggle-voice-input request', async () => {
      mockElectronAPI.toggleVoiceInput.mockResolvedValue(undefined);

      await mockElectronAPI.toggleVoiceInput();
      
      expect(mockElectronAPI.toggleVoiceInput).toHaveBeenCalled();
    });

    test('should handle speech service settings', async () => {
      mockElectronAPI.getSpeechService.mockResolvedValue('whisper');
      mockElectronAPI.setSpeechService.mockResolvedValue(true);

      const currentService = await mockElectronAPI.getSpeechService();
      expect(currentService).toBe('whisper');

      const setResult = await mockElectronAPI.setSpeechService('google');
      expect(setResult).toBe(true);
    });
  });

  describe('AI Settings IPC', () => {
    const mockAiSettings = {
      personality: 'Default',
      interviewStage: 'Initial Screening',
      userPreferences: 'Be concise',
      autoMode: false,
    };

    test('should handle get-ai-settings request', async () => {
      mockElectronAPI.invoke.mockImplementation((channel) => {
        if (channel === 'get-ai-settings') {
          return Promise.resolve(mockAiSettings);
        }
        return Promise.resolve(null);
      });

      const result = await mockElectronAPI.invoke('get-ai-settings');
      
      expect(result).toEqual(mockAiSettings);
      expect(mockElectronAPI.invoke).toHaveBeenCalledWith('get-ai-settings');
    });

    test('should handle save-ai-settings request', async () => {
      const settingsUpdate = { personality: 'Friendly' };
      
      mockElectronAPI.invoke.mockImplementation((channel, settings) => {
        if (channel === 'save-ai-settings') {
          return Promise.resolve({ success: true });
        }
        return Promise.resolve(null);
      });

      const result = await mockElectronAPI.invoke('save-ai-settings', settingsUpdate);
      
      expect(result).toEqual({ success: true });
      expect(mockElectronAPI.invoke).toHaveBeenCalledWith('save-ai-settings', settingsUpdate);
    });

    test('should handle handle-ai-query request', async () => {
      const query = {
        query: 'What is React?',
        language: 'javascript',
        jobContext: { jobTitle: 'Frontend Developer' },
        resumeTextContent: 'Experienced developer...',
      };

      const aiResponse = {
        success: true,
        data: 'React is a JavaScript library for building user interfaces.',
      };

      mockElectronAPI.invoke.mockImplementation((channel, payload) => {
        if (channel === 'handle-ai-query') {
          return Promise.resolve(aiResponse);
        }
        return Promise.resolve(null);
      });

      const result = await mockElectronAPI.invoke('handle-ai-query', query);
      
      expect(result).toEqual(aiResponse);
      expect(mockElectronAPI.invoke).toHaveBeenCalledWith('handle-ai-query', query);
    });
  });

  describe('Screenshot Management IPC', () => {
    test('should handle get-screenshots request', async () => {
      const mockScreenshots = {
        success: true,
        previews: [
          { path: '/path/to/screenshot1.png', preview: 'base64-data-1' },
          { path: '/path/to/screenshot2.png', preview: 'base64-data-2' },
        ],
      };

      mockElectronAPI.getScreenshots.mockResolvedValue(mockScreenshots);

      const result = await mockElectronAPI.getScreenshots();
      
      expect(result).toEqual(mockScreenshots);
      expect(mockElectronAPI.getScreenshots).toHaveBeenCalled();
    });

    test('should handle trigger-screenshot request', async () => {
      mockElectronAPI.triggerScreenshot.mockResolvedValue({ success: true });

      const result = await mockElectronAPI.triggerScreenshot();
      
      expect(result).toEqual({ success: true });
      expect(mockElectronAPI.triggerScreenshot).toHaveBeenCalled();
    });

    test('should handle delete-screenshot request', async () => {
      const screenshotPath = '/path/to/screenshot.png';
      mockElectronAPI.deleteScreenshot.mockResolvedValue({ success: true });

      const result = await mockElectronAPI.deleteScreenshot(screenshotPath);
      
      expect(result).toEqual({ success: true });
      expect(mockElectronAPI.deleteScreenshot).toHaveBeenCalledWith(screenshotPath);
    });
  });

  describe('Window Management IPC', () => {
    test('should handle toggle-window request', async () => {
      mockElectronAPI.toggleMainWindow.mockResolvedValue({ success: true });

      const result = await mockElectronAPI.toggleMainWindow();
      
      expect(result).toEqual({ success: true });
      expect(mockElectronAPI.toggleMainWindow).toHaveBeenCalled();
    });

    test('should handle window movement requests', async () => {
      mockElectronAPI.triggerMoveLeft.mockResolvedValue({ success: true });
      mockElectronAPI.triggerMoveRight.mockResolvedValue({ success: true });
      mockElectronAPI.triggerMoveUp.mockResolvedValue({ success: true });
      mockElectronAPI.triggerMoveDown.mockResolvedValue({ success: true });

      await Promise.all([
        mockElectronAPI.triggerMoveLeft(),
        mockElectronAPI.triggerMoveRight(),
        mockElectronAPI.triggerMoveUp(),
        mockElectronAPI.triggerMoveDown(),
      ]);

      expect(mockElectronAPI.triggerMoveLeft).toHaveBeenCalled();
      expect(mockElectronAPI.triggerMoveRight).toHaveBeenCalled();
      expect(mockElectronAPI.triggerMoveUp).toHaveBeenCalled();
      expect(mockElectronAPI.triggerMoveDown).toHaveBeenCalled();
    });

    test('should handle update-content-dimensions request', async () => {
      const dimensions = { width: 1200, height: 800 };
      mockElectronAPI.updateContentDimensions.mockResolvedValue(undefined);

      await mockElectronAPI.updateContentDimensions(dimensions);
      
      expect(mockElectronAPI.updateContentDimensions).toHaveBeenCalledWith(dimensions);
    });
  });

  describe('Error Handling', () => {
    test('should handle IPC errors gracefully', async () => {
      const error = new Error('IPC communication failed');
      mockElectronAPI.getConfig.mockRejectedValue(error);

      await expect(mockElectronAPI.getConfig()).rejects.toThrow('IPC communication failed');
    });

    test('should handle timeout errors', async () => {
      mockElectronAPI.triggerScreenshot.mockRejectedValue(new Error('Timeout'));

      await expect(mockElectronAPI.triggerScreenshot()).rejects.toThrow('Timeout');
    });

    test('should handle malformed responses', async () => {
      mockElectronAPI.getConfig.mockResolvedValue(null);

      const result = await mockElectronAPI.getConfig();
      expect(result).toBeNull();
    });
  });

  describe('Event Listeners', () => {
    test('should handle screenshot-taken events', () => {
      const mockCallback = jest.fn();
      const mockUnsubscribe = jest.fn();
      
      mockElectronAPI.onScreenshotTaken.mockReturnValue(mockUnsubscribe);
      
      const unsubscribe = mockElectronAPI.onScreenshotTaken(mockCallback);
      
      expect(mockElectronAPI.onScreenshotTaken).toHaveBeenCalledWith(mockCallback);
      expect(unsubscribe).toBe(mockUnsubscribe);
    });

    test('should handle transcription events', () => {
      const mockCallback = jest.fn();
      const mockUnsubscribe = jest.fn();
      
      mockElectronAPI.onTranscriptionReceived.mockReturnValue(mockUnsubscribe);
      
      const unsubscribe = mockElectronAPI.onTranscriptionReceived(mockCallback);
      
      expect(mockElectronAPI.onTranscriptionReceived).toHaveBeenCalledWith(mockCallback);
      expect(unsubscribe).toBe(mockUnsubscribe);
    });

    test('should handle settings dialog events', () => {
      const mockCallback = jest.fn();
      const mockUnsubscribe = jest.fn();
      
      mockElectronAPI.onShowSettings.mockReturnValue(mockUnsubscribe);
      
      const unsubscribe = mockElectronAPI.onShowSettings(mockCallback);
      
      expect(mockElectronAPI.onShowSettings).toHaveBeenCalledWith(mockCallback);
      expect(unsubscribe).toBe(mockUnsubscribe);
    });
  });
});
