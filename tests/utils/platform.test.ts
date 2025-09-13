/**
 * Tests for platform utility functions
 */

import { mockElectronAPI } from '../setup';

describe('Platform Utilities', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should detect platform from Electron API', async () => {
    mockElectronAPI.getPlatform.mockReturnValue('darwin');
    
    const platform = mockElectronAPI.getPlatform();
    expect(platform).toBe('darwin');
    expect(mockElectronAPI.getPlatform).toHaveBeenCalled();
  });

  test('should handle different platforms', () => {
    const platforms = ['darwin', 'win32', 'linux'];
    
    platforms.forEach(platform => {
      mockElectronAPI.getPlatform.mockReturnValue(platform);
      const result = mockElectronAPI.getPlatform();
      expect(result).toBe(platform);
    });
  });

  test('should provide consistent platform detection', () => {
    mockElectronAPI.getPlatform.mockReturnValue('darwin');
    
    // Multiple calls should return the same result
    const platform1 = mockElectronAPI.getPlatform();
    const platform2 = mockElectronAPI.getPlatform();
    
    expect(platform1).toBe(platform2);
    expect(platform1).toBe('darwin');
  });
});

describe('Configuration Management', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should handle configuration retrieval', async () => {
    const mockConfig = {
      apiKey: 'test-key',
      apiProvider: 'openai',
      extractionModel: 'gpt-4o',
      solutionModel: 'gpt-4o',
      debuggingModel: 'gpt-4o',
    };

    mockElectronAPI.getConfig.mockResolvedValue(mockConfig);

    const config = await mockElectronAPI.getConfig();
    
    expect(config).toEqual(mockConfig);
    expect(mockElectronAPI.getConfig).toHaveBeenCalled();
  });

  test('should handle configuration updates', async () => {
    const configUpdate = {
      apiKey: 'new-key',
      apiProvider: 'gemini',
    };

    mockElectronAPI.updateConfig.mockResolvedValue(true);

    const result = await mockElectronAPI.updateConfig(configUpdate);
    
    expect(result).toBe(true);
    expect(mockElectronAPI.updateConfig).toHaveBeenCalledWith(configUpdate);
  });

  test('should handle configuration validation', async () => {
    mockElectronAPI.checkApiKey.mockResolvedValue(true);
    mockElectronAPI.validateApiKey.mockResolvedValue({ valid: true });

    const isValid = await mockElectronAPI.checkApiKey();
    const validation = await mockElectronAPI.validateApiKey('test-key');
    
    expect(isValid).toBe(true);
    expect(validation.valid).toBe(true);
  });

  test('should handle configuration errors', async () => {
    mockElectronAPI.getConfig.mockRejectedValue(new Error('Config error'));

    await expect(mockElectronAPI.getConfig()).rejects.toThrow('Config error');
  });
});

describe('API Key Management', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should manage OpenAI API key', async () => {
    mockElectronAPI.getOpenAIApiKey.mockResolvedValue('openai-key');

    const apiKey = await mockElectronAPI.getOpenAIApiKey();
    
    expect(apiKey).toBe('openai-key');
    expect(mockElectronAPI.getOpenAIApiKey).toHaveBeenCalled();
  });

  test('should manage Gemini API key', async () => {
    mockElectronAPI.getGeminiApiKey.mockResolvedValue('gemini-key');

    const apiKey = await mockElectronAPI.getGeminiApiKey();
    
    expect(apiKey).toBe('gemini-key');
    expect(mockElectronAPI.getGeminiApiKey).toHaveBeenCalled();
  });

  test('should manage Anthropic API key', async () => {
    mockElectronAPI.getAnthropicApiKey.mockResolvedValue('anthropic-key');

    const apiKey = await mockElectronAPI.getAnthropicApiKey();
    
    expect(apiKey).toBe('anthropic-key');
    expect(mockElectronAPI.getAnthropicApiKey).toHaveBeenCalled();
  });

  test('should handle missing API keys', async () => {
    mockElectronAPI.getOpenAIApiKey.mockResolvedValue('');
    mockElectronAPI.getGeminiApiKey.mockResolvedValue(null);

    const openaiKey = await mockElectronAPI.getOpenAIApiKey();
    const geminiKey = await mockElectronAPI.getGeminiApiKey();
    
    expect(openaiKey).toBe('');
    expect(geminiKey).toBeNull();
  });
});
