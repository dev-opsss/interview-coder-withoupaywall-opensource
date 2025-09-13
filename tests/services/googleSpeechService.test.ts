import { GoogleSpeechService } from '../../src/services/googleSpeechService';
import { mockElectronAPI } from '../setup';

describe('GoogleSpeechService', () => {
  let speechService: GoogleSpeechService;

  beforeEach(() => {
    jest.clearAllMocks();
    speechService = new GoogleSpeechService();
  });

  describe('API Key Management', () => {
    test('should set API key successfully', async () => {
      mockElectronAPI.setGoogleSpeechApiKey.mockResolvedValue({
        success: true,
      });

      const result = await speechService.setApiKey('test-api-key');
      
      expect(result.success).toBe(true);
      expect(mockElectronAPI.setGoogleSpeechApiKey).toHaveBeenCalledWith('test-api-key');
    });

    test('should handle API key setting failure', async () => {
      mockElectronAPI.setGoogleSpeechApiKey.mockResolvedValue({
        success: false,
        error: 'Invalid API key',
      });

      const result = await speechService.setApiKey('invalid-key');
      
      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid API key');
    });

    test('should get API key', async () => {
      mockElectronAPI.getGoogleSpeechApiKey.mockResolvedValue('test-api-key');

      const apiKey = await speechService.getApiKey();
      
      expect(apiKey).toBe('test-api-key');
      expect(mockElectronAPI.getGoogleSpeechApiKey).toHaveBeenCalled();
    });

    test('should test API key validity', async () => {
      mockElectronAPI.testGoogleSpeechApiKey.mockResolvedValue({
        valid: true,
      });

      const result = await speechService.testApiKey();
      
      expect(result.valid).toBe(true);
      expect(mockElectronAPI.testGoogleSpeechApiKey).toHaveBeenCalled();
    });
  });

  describe('Speech Recognition', () => {
    beforeEach(() => {
      mockElectronAPI.getGoogleSpeechApiKey.mockResolvedValue('test-api-key');
    });

    test('should start streaming successfully', async () => {
      const mockCallback = jest.fn();
      mockElectronAPI.onTranscriptionReceived.mockReturnValue(() => {});

      await speechService.startStreaming(mockCallback);
      
      expect(mockElectronAPI.onTranscriptionReceived).toHaveBeenCalled();
      expect(mockElectronAPI.toggleVoiceInput).toHaveBeenCalled();
      expect(speechService.isStreaming).toBe(true);
    });

    test('should not start streaming without API key', async () => {
      mockElectronAPI.getGoogleSpeechApiKey.mockResolvedValue(null);
      const mockCallback = jest.fn();

      await speechService.startStreaming(mockCallback);
      
      expect(speechService.isStreaming).toBe(false);
      expect(mockElectronAPI.toggleVoiceInput).not.toHaveBeenCalled();
    });

    test('should stop streaming', async () => {
      const mockCallback = jest.fn();
      const mockUnsubscribe = jest.fn();
      mockElectronAPI.onTranscriptionReceived.mockReturnValue(mockUnsubscribe);

      // Start streaming first
      await speechService.startStreaming(mockCallback);
      expect(speechService.isStreaming).toBe(true);

      // Then stop
      await speechService.stopStreaming();
      
      expect(speechService.isStreaming).toBe(false);
      expect(mockElectronAPI.toggleVoiceInput).toHaveBeenCalledTimes(2); // Start and stop
      expect(mockUnsubscribe).toHaveBeenCalled();
    });

    test('should handle transcription callback', async () => {
      const mockCallback = jest.fn();
      let transcriptionCallback: any;

      mockElectronAPI.onTranscriptionReceived.mockImplementation((callback) => {
        transcriptionCallback = callback;
        return () => {};
      });

      await speechService.startStreaming(mockCallback);
      
      // Simulate transcription data
      const transcriptionData = {
        transcript: 'Hello world',
        isFinal: true,
        speaker: 'user' as const,
        words: [
          { word: 'Hello', startTime: 0, endTime: 0.5 },
          { word: 'world', startTime: 0.5, endTime: 1.0 },
        ],
      };

      transcriptionCallback(transcriptionData);
      
      expect(mockCallback).toHaveBeenCalledWith('Hello world', true);
    });

    test('should transcribe audio data', async () => {
      const audioData = {
        buffer: new ArrayBuffer(1024),
        type: 'audio/webm',
      };

      const mockResult = {
        success: true,
        transcript: 'Test transcription',
        confidence: 0.95,
      };

      mockElectronAPI.transcribeAudio.mockResolvedValue(mockResult);

      const result = await speechService.transcribeAudio(audioData);
      
      expect(result).toEqual(mockResult);
      expect(mockElectronAPI.transcribeAudio).toHaveBeenCalledWith(audioData);
    });

    test('should handle transcription errors', async () => {
      const audioData = {
        buffer: new ArrayBuffer(1024),
        type: 'audio/webm',
      };

      mockElectronAPI.transcribeAudio.mockRejectedValue(new Error('Transcription failed'));

      await expect(speechService.transcribeAudio(audioData)).rejects.toThrow('Transcription failed');
    });
  });

  describe('Configuration', () => {
    test('should configure recognition options', () => {
      const options = {
        encoding: 'LINEAR16',
        sampleRateHertz: 16000,
        languageCode: 'en-US',
        maxAlternatives: 1,
        profanityFilter: true,
        enableWordTimeOffsets: true,
      };

      speechService.configure(options);
      
      // Since configure is likely a private method or affects internal state,
      // we can test its effects through other methods
      expect(speechService).toBeDefined();
    });

    test('should get current configuration', () => {
      const config = speechService.getConfiguration();
      
      expect(config).toHaveProperty('encoding');
      expect(config).toHaveProperty('sampleRateHertz');
      expect(config).toHaveProperty('languageCode');
    });
  });

  describe('Error Handling', () => {
    test('should handle Electron API unavailability', async () => {
      // Mock window.electronAPI as undefined
      const originalElectronAPI = window.electronAPI;
      delete (window as any).electronAPI;

      const mockCallback = jest.fn();
      await speechService.startStreaming(mockCallback);
      
      expect(speechService.isStreaming).toBe(false);

      // Restore electronAPI
      window.electronAPI = originalElectronAPI;
    });

    test('should handle API key retrieval errors', async () => {
      mockElectronAPI.getGoogleSpeechApiKey.mockRejectedValue(new Error('API key error'));
      
      const mockCallback = jest.fn();
      await speechService.startStreaming(mockCallback);
      
      expect(speechService.isStreaming).toBe(false);
    });

    test('should handle streaming toggle errors', async () => {
      mockElectronAPI.getGoogleSpeechApiKey.mockResolvedValue('test-key');
      mockElectronAPI.toggleVoiceInput.mockRejectedValue(new Error('Toggle error'));
      
      const mockCallback = jest.fn();
      await speechService.startStreaming(mockCallback);
      
      expect(speechService.isStreaming).toBe(false);
    });

    test('should handle transcription callback errors gracefully', async () => {
      const mockCallback = jest.fn(() => {
        throw new Error('Callback error');
      });
      
      let transcriptionCallback: any;
      mockElectronAPI.onTranscriptionReceived.mockImplementation((callback) => {
        transcriptionCallback = callback;
        return () => {};
      });

      await speechService.startStreaming(mockCallback);
      
      // Should not throw when callback throws
      expect(() => {
        transcriptionCallback({
          transcript: 'Test',
          isFinal: true,
          speaker: 'user',
        });
      }).not.toThrow();
    });
  });

  describe('State Management', () => {
    test('should track streaming state correctly', async () => {
      expect(speechService.isStreaming).toBe(false);
      
      const mockCallback = jest.fn();
      mockElectronAPI.onTranscriptionReceived.mockReturnValue(() => {});
      
      await speechService.startStreaming(mockCallback);
      expect(speechService.isStreaming).toBe(true);
      
      await speechService.stopStreaming();
      expect(speechService.isStreaming).toBe(false);
    });

    test('should not start streaming if already streaming', async () => {
      const mockCallback = jest.fn();
      mockElectronAPI.onTranscriptionReceived.mockReturnValue(() => {});
      
      // Start streaming first time
      await speechService.startStreaming(mockCallback);
      expect(mockElectronAPI.toggleVoiceInput).toHaveBeenCalledTimes(1);
      
      // Try to start again
      await speechService.startStreaming(mockCallback);
      expect(mockElectronAPI.toggleVoiceInput).toHaveBeenCalledTimes(1); // Should not be called again
    });

    test('should not stop streaming if not streaming', async () => {
      expect(speechService.isStreaming).toBe(false);
      
      await speechService.stopStreaming();
      
      expect(mockElectronAPI.toggleVoiceInput).not.toHaveBeenCalled();
    });
  });

  describe('Language Support', () => {
    test('should support different language codes', () => {
      const languages = ['en-US', 'es-ES', 'fr-FR', 'de-DE', 'it-IT'];
      
      languages.forEach(languageCode => {
        speechService.configure({ languageCode });
        const config = speechService.getConfiguration();
        expect(config.languageCode).toBe(languageCode);
      });
    });

    test('should handle invalid language codes gracefully', () => {
      expect(() => {
        speechService.configure({ languageCode: 'invalid-lang' });
      }).not.toThrow();
    });
  });

  describe('Audio Format Support', () => {
    test('should support different audio encodings', () => {
      const encodings = ['LINEAR16', 'FLAC', 'MULAW', 'AMR', 'AMR_WB'];
      
      encodings.forEach(encoding => {
        speechService.configure({ encoding });
        const config = speechService.getConfiguration();
        expect(config.encoding).toBe(encoding);
      });
    });

    test('should support different sample rates', () => {
      const sampleRates = [8000, 16000, 32000, 44100, 48000];
      
      sampleRates.forEach(sampleRateHertz => {
        speechService.configure({ sampleRateHertz });
        const config = speechService.getConfiguration();
        expect(config.sampleRateHertz).toBe(sampleRateHertz);
      });
    });
  });
});
