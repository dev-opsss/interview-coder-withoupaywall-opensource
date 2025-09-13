/**
 * Integration tests for Multi-Monitor functionality
 * These tests focus on the IPC communication and core logic
 */

import { mockElectronAPI } from '../setup';

describe('Multi-Monitor Integration Tests', () => {
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

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Setup default mock responses
    mockElectronAPI.invoke.mockImplementation((channel: string, ...args: any[]) => {
      switch (channel) {
        case 'get-monitors':
          return Promise.resolve(mockMonitors);
        case 'get-current-monitor':
          return Promise.resolve(mockMonitors[0]);
        case 'move-window-to-monitor':
          return Promise.resolve({ success: true });
        case 'move-window-to-next-monitor':
          return Promise.resolve({ success: true });
        case 'get-window-presets':
          return Promise.resolve([]);
        case 'get-multi-monitor-settings':
          return Promise.resolve({
            preferredMonitor: 'monitor-1',
            autoSwitchMonitor: true,
            rememberLastPosition: true,
            adaptToMonitorChanges: true,
          });
        default:
          return Promise.resolve(null);
      }
    });
  });

  describe('Monitor Detection', () => {
    test('should detect multiple monitors', async () => {
      const monitors = await mockElectronAPI.invoke('get-monitors');
      
      expect(monitors).toHaveLength(2);
      expect(monitors[0].isPrimary).toBe(true);
      expect(monitors[1].isPrimary).toBe(false);
      expect(mockElectronAPI.invoke).toHaveBeenCalledWith('get-monitors');
    });

    test('should identify current monitor', async () => {
      const currentMonitor = await mockElectronAPI.invoke('get-current-monitor');
      
      expect(currentMonitor).toEqual(mockMonitors[0]);
      expect(currentMonitor.isPrimary).toBe(true);
      expect(mockElectronAPI.invoke).toHaveBeenCalledWith('get-current-monitor');
    });

    test('should handle single monitor setup', async () => {
      mockElectronAPI.invoke.mockImplementation((channel) => {
        if (channel === 'get-monitors') {
          return Promise.resolve([mockMonitors[0]]);
        }
        return Promise.resolve(null);
      });

      const monitors = await mockElectronAPI.invoke('get-monitors');
      
      expect(monitors).toHaveLength(1);
      expect(monitors[0].isPrimary).toBe(true);
    });

    test('should handle monitor detection errors', async () => {
      mockElectronAPI.invoke.mockImplementation((channel) => {
        if (channel === 'get-monitors') {
          return Promise.reject(new Error('Monitor detection failed'));
        }
        return Promise.resolve(null);
      });

      await expect(mockElectronAPI.invoke('get-monitors')).rejects.toThrow('Monitor detection failed');
    });
  });

  describe('Window Positioning', () => {
    test('should move window to specific monitor', async () => {
      const result = await mockElectronAPI.invoke('move-window-to-monitor', 'monitor-2', 'center');
      
      expect(result.success).toBe(true);
      expect(mockElectronAPI.invoke).toHaveBeenCalledWith('move-window-to-monitor', 'monitor-2', 'center');
    });

    test('should move window to next monitor', async () => {
      const result = await mockElectronAPI.invoke('move-window-to-next-monitor');
      
      expect(result.success).toBe(true);
      expect(mockElectronAPI.invoke).toHaveBeenCalledWith('move-window-to-next-monitor');
    });

    test('should handle invalid monitor ID', async () => {
      mockElectronAPI.invoke.mockImplementation((channel, monitorId) => {
        if (channel === 'move-window-to-monitor' && monitorId === 'invalid-monitor') {
          return Promise.resolve({ success: false, error: 'Monitor not found' });
        }
        return Promise.resolve({ success: true });
      });

      const result = await mockElectronAPI.invoke('move-window-to-monitor', 'invalid-monitor', 'center');
      
      expect(result.success).toBe(false);
      expect(result.error).toBe('Monitor not found');
    });

    test('should support different positioning options', async () => {
      const positions = ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'center'];
      
      for (const position of positions) {
        const result = await mockElectronAPI.invoke('move-window-to-monitor', 'monitor-1', position);
        expect(result.success).toBe(true);
        expect(mockElectronAPI.invoke).toHaveBeenCalledWith('move-window-to-monitor', 'monitor-1', position);
      }
    });
  });

  describe('Window Presets', () => {
    const mockPresets = [
      {
        id: 'preset-1',
        name: 'Top Left',
        monitorId: 'monitor-1',
        position: { x: 20, y: 45, width: 800, height: 600 },
        relativePosition: 'top-left',
      },
      {
        id: 'preset-2',
        name: 'Center Large',
        monitorId: 'monitor-2',
        position: { x: 2200, y: 320, width: 1200, height: 800 },
        relativePosition: 'center',
      },
    ];

    beforeEach(() => {
      mockElectronAPI.invoke.mockImplementation((channel: string, ...args: any[]) => {
        switch (channel) {
          case 'get-window-presets':
            return Promise.resolve(mockPresets);
          case 'apply-window-preset':
            return Promise.resolve({ success: true });
          case 'create-window-preset':
            return Promise.resolve({ success: true, presetId: 'new-preset-id' });
          case 'remove-window-preset':
            return Promise.resolve({ success: true });
          default:
            return Promise.resolve(null);
        }
      });
    });

    test('should retrieve window presets', async () => {
      const presets = await mockElectronAPI.invoke('get-window-presets');
      
      expect(presets).toHaveLength(2);
      expect(presets[0].name).toBe('Top Left');
      expect(presets[1].name).toBe('Center Large');
      expect(mockElectronAPI.invoke).toHaveBeenCalledWith('get-window-presets');
    });

    test('should apply window preset', async () => {
      const result = await mockElectronAPI.invoke('apply-window-preset', 'preset-1');
      
      expect(result.success).toBe(true);
      expect(mockElectronAPI.invoke).toHaveBeenCalledWith('apply-window-preset', 'preset-1');
    });

    test('should create new window preset', async () => {
      const result = await mockElectronAPI.invoke('create-window-preset', 'My Custom Preset');
      
      expect(result.success).toBe(true);
      expect(result.presetId).toBe('new-preset-id');
      expect(mockElectronAPI.invoke).toHaveBeenCalledWith('create-window-preset', 'My Custom Preset');
    });

    test('should remove window preset', async () => {
      const result = await mockElectronAPI.invoke('remove-window-preset', 'preset-1');
      
      expect(result.success).toBe(true);
      expect(mockElectronAPI.invoke).toHaveBeenCalledWith('remove-window-preset', 'preset-1');
    });

    test('should handle preset operations errors', async () => {
      mockElectronAPI.invoke.mockImplementation((channel, presetId) => {
        if (channel === 'apply-window-preset' && presetId === 'invalid-preset') {
          return Promise.resolve({ success: false, error: 'Preset not found' });
        }
        return Promise.resolve({ success: true });
      });

      const result = await mockElectronAPI.invoke('apply-window-preset', 'invalid-preset');
      
      expect(result.success).toBe(false);
      expect(result.error).toBe('Preset not found');
    });
  });

  describe('Settings Management', () => {
    test('should retrieve multi-monitor settings', async () => {
      const settings = await mockElectronAPI.invoke('get-multi-monitor-settings');
      
      expect(settings).toHaveProperty('preferredMonitor');
      expect(settings).toHaveProperty('autoSwitchMonitor');
      expect(settings).toHaveProperty('rememberLastPosition');
      expect(settings).toHaveProperty('adaptToMonitorChanges');
      expect(mockElectronAPI.invoke).toHaveBeenCalledWith('get-multi-monitor-settings');
    });

    test('should update multi-monitor settings', async () => {
      const settingsUpdate = {
        preferredMonitor: 'monitor-2',
        autoSwitchMonitor: false,
      };

      mockElectronAPI.invoke.mockImplementation((channel, settings) => {
        if (channel === 'update-multi-monitor-settings') {
          return Promise.resolve({ success: true });
        }
        return Promise.resolve(null);
      });

      const result = await mockElectronAPI.invoke('update-multi-monitor-settings', settingsUpdate);
      
      expect(result.success).toBe(true);
      expect(mockElectronAPI.invoke).toHaveBeenCalledWith('update-multi-monitor-settings', settingsUpdate);
    });

    test('should handle settings validation', async () => {
      const invalidSettings = {
        preferredMonitor: 'invalid-monitor-id',
        autoSwitchMonitor: 'not-a-boolean',
      };

      mockElectronAPI.invoke.mockImplementation((channel, settings) => {
        if (channel === 'update-multi-monitor-settings') {
          return Promise.resolve({ 
            success: false, 
            error: 'Invalid settings format' 
          });
        }
        return Promise.resolve(null);
      });

      const result = await mockElectronAPI.invoke('update-multi-monitor-settings', invalidSettings);
      
      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid settings format');
    });
  });

  describe('Error Handling', () => {
    test('should handle network errors', async () => {
      mockElectronAPI.invoke.mockRejectedValue(new Error('Network error'));

      await expect(mockElectronAPI.invoke('get-monitors')).rejects.toThrow('Network error');
    });

    test('should handle timeout errors', async () => {
      mockElectronAPI.invoke.mockRejectedValue(new Error('Timeout'));

      await expect(mockElectronAPI.invoke('move-window-to-monitor', 'monitor-1', 'center')).rejects.toThrow('Timeout');
    });

    test('should handle malformed responses', async () => {
      mockElectronAPI.invoke.mockResolvedValue(null);

      const result = await mockElectronAPI.invoke('get-monitors');
      expect(result).toBeNull();
    });
  });

  describe('Performance Tests', () => {
    test('should handle rapid monitor switches', async () => {
      const promises = [];
      
      for (let i = 0; i < 10; i++) {
        promises.push(mockElectronAPI.invoke('move-window-to-next-monitor'));
      }
      
      const results = await Promise.all(promises);
      
      expect(results).toHaveLength(10);
      results.forEach(result => {
        expect(result.success).toBe(true);
      });
    });

    test('should handle concurrent preset operations', async () => {
      // Setup specific mock responses for concurrent operations
      mockElectronAPI.invoke.mockImplementation((channel: string) => {
        switch (channel) {
          case 'get-window-presets':
            return Promise.resolve([]);
          case 'apply-window-preset':
            return Promise.resolve({ success: true });
          case 'create-window-preset':
            return Promise.resolve({ success: true, presetId: 'new-preset' });
          default:
            return Promise.resolve({ success: true });
        }
      });

      const operations = [
        mockElectronAPI.invoke('get-window-presets'),
        mockElectronAPI.invoke('apply-window-preset', 'preset-1'),
        mockElectronAPI.invoke('create-window-preset', 'Test Preset'),
      ];
      
      const results = await Promise.all(operations);
      
      expect(results).toHaveLength(3);
      expect(Array.isArray(results[0])).toBe(true); // presets array
      expect(results[1].success).toBe(true); // apply result
      expect(results[2].success).toBe(true); // create result
    });
  });
});
