import { MultiMonitorManager, MonitorInfo } from '../../electron/MultiMonitorManager';

// Mock Electron screen API
const mockScreen = {
  getAllDisplays: jest.fn(),
  getPrimaryDisplay: jest.fn(),
  on: jest.fn(),
};

// Mock electron-store
const mockStore = {
  get: jest.fn(),
  set: jest.fn(),
};

jest.mock('electron', () => ({
  screen: mockScreen,
}));

jest.mock('../../electron/store', () => ({
  getStoreInstance: () => mockStore,
}));

describe('MultiMonitorManager', () => {
  let multiMonitorManager: MultiMonitorManager;
  
  const mockMonitors: MonitorInfo[] = [
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
      name: 'External Monitor 1 (2560x1440)',
      bounds: { x: 1920, y: 0, width: 2560, height: 1440 },
      workArea: { x: 1920, y: 0, width: 2560, height: 1440 },
      scaleFactor: 1,
      isPrimary: false,
      isInternal: false,
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    
    mockScreen.getAllDisplays.mockReturnValue(mockMonitors.map(m => ({
      id: m.displayId,
      bounds: m.bounds,
      workArea: m.workArea,
      scaleFactor: m.scaleFactor,
      internal: m.isInternal,
    })));
    
    mockScreen.getPrimaryDisplay.mockReturnValue({
      id: 1,
      bounds: mockMonitors[0].bounds,
      workArea: mockMonitors[0].workArea,
      scaleFactor: 1,
      internal: true,
    });

    mockStore.get.mockReturnValue(null);
    
    multiMonitorManager = new MultiMonitorManager();
  });

  afterEach(() => {
    multiMonitorManager.destroy();
  });

  describe('Monitor Detection', () => {
    test('should detect all monitors', () => {
      const monitors = multiMonitorManager.getMonitors();
      expect(monitors).toHaveLength(2);
      expect(monitors[0].isPrimary).toBe(true);
      expect(monitors[1].isPrimary).toBe(false);
    });

    test('should identify primary monitor correctly', () => {
      const primaryMonitor = multiMonitorManager.getPrimaryMonitor();
      expect(primaryMonitor).toBeTruthy();
      expect(primaryMonitor?.isPrimary).toBe(true);
      expect(primaryMonitor?.id).toBe('monitor-1');
    });

    test('should get monitor by ID', () => {
      const monitor = multiMonitorManager.getMonitorById('monitor-2');
      expect(monitor).toBeTruthy();
      expect(monitor?.name).toBe('External Monitor 1 (2560x1440)');
    });

    test('should return null for invalid monitor ID', () => {
      const monitor = multiMonitorManager.getMonitorById('invalid-id');
      expect(monitor).toBeNull();
    });
  });

  describe('Position Calculations', () => {
    test('should calculate top-left position correctly', () => {
      const position = multiMonitorManager.calculateOptimalPosition(
        'monitor-1',
        'top-left',
        800,
        600
      );
      
      expect(position).toEqual({
        x: 20, // workArea.x + padding
        y: 45, // workArea.y + padding  
      });
    });

    test('should calculate center position correctly', () => {
      const position = multiMonitorManager.calculateOptimalPosition(
        'monitor-1',
        'center',
        800,
        600
      );
      
      expect(position).toEqual({
        x: 560, // (1920 - 800) / 2
        y: 252.5, // (1055 - 600) / 2 + 25
      });
    });

    test('should calculate top-right position correctly', () => {
      const position = multiMonitorManager.calculateOptimalPosition(
        'monitor-1',
        'top-right',
        800,
        600
      );
      
      expect(position).toEqual({
        x: 1100, // 1920 - 800 - 20
        y: 45, // workArea.y + padding
      });
    });

    test('should handle invalid monitor ID by using primary', () => {
      const position = multiMonitorManager.calculateOptimalPosition(
        'invalid-id',
        'center',
        800,
        600
      );
      
      // Should fall back to primary monitor
      expect(position.x).toBeGreaterThanOrEqual(0);
      expect(position.y).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Monitor Point Detection', () => {
    test('should find monitor containing point', () => {
      // Point in first monitor
      const monitor1 = multiMonitorManager.getMonitorContainingPoint(500, 500);
      expect(monitor1?.id).toBe('monitor-1');
      
      // Point in second monitor
      const monitor2 = multiMonitorManager.getMonitorContainingPoint(2000, 500);
      expect(monitor2?.id).toBe('monitor-2');
      
      // Point outside any monitor
      const noMonitor = multiMonitorManager.getMonitorContainingPoint(-100, -100);
      expect(noMonitor).toBeNull();
    });
  });

  describe('Preset Management', () => {
    test('should add preset successfully', () => {
      const presetData = {
        name: 'Test Preset',
        monitorId: 'monitor-1',
        position: { x: 100, y: 100, width: 800, height: 600 },
        relativePosition: 'custom' as const,
      };
      
      const presetId = multiMonitorManager.addPreset(presetData);
      expect(presetId).toBeTruthy();
      expect(typeof presetId).toBe('string');
      
      const presets = multiMonitorManager.getPresets();
      expect(presets).toHaveLength(4); // 3 default + 1 new
      
      const newPreset = presets.find(p => p.id === presetId);
      expect(newPreset).toBeTruthy();
      expect(newPreset?.name).toBe('Test Preset');
    });

    test('should remove preset successfully', () => {
      const presetData = {
        name: 'Test Preset',
        monitorId: 'monitor-1',
        position: { x: 100, y: 100, width: 800, height: 600 },
        relativePosition: 'custom' as const,
      };
      
      const presetId = multiMonitorManager.addPreset(presetData);
      const initialCount = multiMonitorManager.getPresets().length;
      
      const removed = multiMonitorManager.removePreset(presetId);
      expect(removed).toBe(true);
      
      const finalPresets = multiMonitorManager.getPresets();
      expect(finalPresets).toHaveLength(initialCount - 1);
      
      const deletedPreset = finalPresets.find(p => p.id === presetId);
      expect(deletedPreset).toBeUndefined();
    });

    test('should return false when removing non-existent preset', () => {
      const removed = multiMonitorManager.removePreset('invalid-id');
      expect(removed).toBe(false);
    });

    test('should get default presets', () => {
      const presets = multiMonitorManager.getPresets();
      expect(presets.length).toBeGreaterThanOrEqual(3);
      
      const presetNames = presets.map(p => p.name);
      expect(presetNames).toContain('Top Left');
      expect(presetNames).toContain('Top Right');
      expect(presetNames).toContain('Center');
    });
  });

  describe('Settings Management', () => {
    test('should get default settings', () => {
      const settings = multiMonitorManager.getSettings();
      expect(settings).toHaveProperty('preferredMonitor');
      expect(settings).toHaveProperty('windowPresets');
      expect(settings).toHaveProperty('autoSwitchMonitor');
      expect(settings).toHaveProperty('rememberLastPosition');
      expect(settings).toHaveProperty('adaptToMonitorChanges');
    });

    test('should update settings', () => {
      const updates = {
        preferredMonitor: 'monitor-2',
        autoSwitchMonitor: false,
      };
      
      multiMonitorManager.updateSettings(updates);
      
      const settings = multiMonitorManager.getSettings();
      expect(settings.preferredMonitor).toBe('monitor-2');
      expect(settings.autoSwitchMonitor).toBe(false);
      expect(mockStore.set).toHaveBeenCalledWith('multiMonitorSettings', expect.objectContaining(updates));
    });
  });

  describe('Event Handling', () => {
    test('should emit events on monitor changes', (done) => {
      multiMonitorManager.on('monitors-changed', (monitors) => {
        expect(Array.isArray(monitors)).toBe(true);
        done();
      });
      
      // Simulate monitor change
      const mockCallback = mockScreen.on.mock.calls.find(call => call[0] === 'display-added')?.[1];
      if (mockCallback) {
        mockCallback();
      }
    });

    test('should emit events on settings changes', (done) => {
      multiMonitorManager.on('settings-changed', (settings) => {
        expect(settings).toHaveProperty('preferredMonitor');
        done();
      });
      
      multiMonitorManager.updateSettings({ preferredMonitor: 'monitor-2' });
    });
  });

  describe('Error Handling', () => {
    test('should handle screen API errors gracefully', () => {
      mockScreen.getAllDisplays.mockImplementation(() => {
        throw new Error('Screen API error');
      });
      
      // Should not throw
      expect(() => {
        const manager = new MultiMonitorManager();
        manager.destroy();
      }).not.toThrow();
    });

    test('should handle store errors gracefully', () => {
      mockStore.get.mockImplementation(() => {
        throw new Error('Store error');
      });
      
      // Should not throw
      expect(() => {
        const manager = new MultiMonitorManager();
        manager.destroy();
      }).not.toThrow();
    });
  });
});
