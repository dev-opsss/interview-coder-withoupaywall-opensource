/**
 * Focused tests for logging system functionality
 * Tests the actual logging behavior without complex mocking
 */

describe('Logging System Integration', () => {
  test('should have logging system available', () => {
    // Test that the logging system can be imported
    expect(() => {
      const { log } = require('../electron/logger');
      expect(log).toBeDefined();
      expect(log.speech).toBeDefined();
      expect(log.auth).toBeDefined();
      expect(log.setGlobalLevel).toBeDefined();
    }).not.toThrow();
  });

  test('should have all required logging categories', () => {
    const { log } = require('../electron/logger');
    
    const expectedCategories = [
      'speech', 'ui', 'ipc', 'auth', 'file', 
      'network', 'window', 'system', 'performance', 'general'
    ];

    expectedCategories.forEach(category => {
      expect(log[category]).toBeDefined();
      expect(typeof log[category].info).toBe('function');
      expect(typeof log[category].error).toBe('function');
      expect(typeof log[category].warn).toBe('function');
      expect(typeof log[category].debug).toBe('function');
      expect(typeof log[category].trace).toBe('function');
    });
  });

  test('should have configuration methods', () => {
    const { log } = require('../electron/logger');
    
    expect(typeof log.setGlobalLevel).toBe('function');
    expect(typeof log.setCategoryLevel).toBe('function');
    expect(typeof log.enableCategory).toBe('function');
    expect(typeof log.disableCategory).toBe('function');
    expect(typeof log.enableFileLogging).toBe('function');
    expect(typeof log.disableFileLogging).toBe('function');
    expect(typeof log.enableConsoleLogging).toBe('function');
    expect(typeof log.disableConsoleLogging).toBe('function');
    expect(typeof log.getConfig).toBe('function');
  });

  test('should have backwards compatibility functions', () => {
    const { safeLog, safeError } = require('../electron/logger');
    
    expect(typeof safeLog).toBe('function');
    expect(typeof safeError).toBe('function');
    
    // Test that they can be called without throwing
    expect(() => {
      safeLog('Test message');
      safeError('Test error');
    }).not.toThrow();
  });

  test('should have sanitization utility', () => {
    const { log } = require('../electron/logger');
    
    expect(typeof log.sanitizeData).toBe('function');
    
    // Test basic sanitization
    const testData = { apiKey: 'sk-1234567890abcdef' };
    const sanitized = log.sanitizeData(testData);
    
    expect(sanitized).toBeDefined();
    expect(typeof sanitized).toBe('object');
  });

  test('should return configuration object', () => {
    const { log } = require('../electron/logger');
    
    const config = log.getConfig();
    
    expect(config).toBeDefined();
    expect(config).toHaveProperty('globalLevel');
    expect(config).toHaveProperty('categoryLevels');
    expect(config).toHaveProperty('enabledCategories');
    expect(config).toHaveProperty('fileLogging');
    expect(config).toHaveProperty('console');
    
    // Verify types
    expect(typeof config.globalLevel).toBe('number');
    expect(config.enabledCategories).toBeInstanceOf(Set);
    expect(typeof config.fileLogging).toBe('object');
    expect(typeof config.console).toBe('object');
  });

  test('should allow configuration changes', () => {
    const { log, LogLevel } = require('../electron/logger');
    
    // Test setting global level
    expect(() => {
      log.setGlobalLevel(LogLevel.ERROR);
    }).not.toThrow();
    
    // Test setting category level
    expect(() => {
      log.setCategoryLevel('speech', LogLevel.TRACE);
    }).not.toThrow();
    
    // Test enabling/disabling categories
    expect(() => {
      log.disableCategory('ui');
      log.enableCategory('auth');
    }).not.toThrow();
  });

  test('should handle timing utilities', () => {
    const { log } = require('../electron/logger');
    
    expect(typeof log.time).toBe('function');
    expect(typeof log.timeEnd).toBe('function');
    
    // Test that timing methods can be called
    expect(() => {
      log.time('test-operation');
      log.timeEnd('test-operation');
    }).not.toThrow();
  });
});

describe('IPC Handler Mocking', () => {
  beforeEach(() => {
    // Setup window.electronAPI mock
    (global as any).window = {
      electronAPI: {
        invoke: jest.fn()
      }
    };
  });

  test('should mock get-logging-config IPC call', async () => {
    const mockConfig = {
      globalLevel: 'INFO',
      categoryLevels: { speech: 'DEBUG' },
      enabledCategories: ['speech', 'ui'],
      fileLogging: { enabled: true, directory: '/test' },
      consoleLogging: { enabled: true }
    };

    ((global as any).window.electronAPI.invoke as jest.Mock)
      .mockResolvedValue(mockConfig);

    const result = await (global as any).window.electronAPI.invoke('get-logging-config');
    
    expect(result).toEqual(mockConfig);
    expect((global as any).window.electronAPI.invoke).toHaveBeenCalledWith('get-logging-config');
  });

  test('should mock set-logging-config IPC call', async () => {
    const mockResult = { success: true };
    const configToSave = {
      globalLevel: 'ERROR',
      categoryLevels: {},
      enabledCategories: ['auth'],
      fileLogging: { enabled: false, directory: '' },
      consoleLogging: { enabled: true }
    };

    ((global as any).window.electronAPI.invoke as jest.Mock)
      .mockResolvedValue(mockResult);

    const result = await (global as any).window.electronAPI.invoke('set-logging-config', configToSave);
    
    expect(result).toEqual(mockResult);
    expect((global as any).window.electronAPI.invoke).toHaveBeenCalledWith('set-logging-config', configToSave);
  });
});

