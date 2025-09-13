import { WindowManager, WindowState } from '../../electron/WindowManager';
import { BrowserWindow } from 'electron';

// Mock dependencies
const mockMultiMonitorManager = {
  getMonitorById: jest.fn(),
  getPrimaryMonitor: jest.fn(),
  getMonitorContainingPoint: jest.fn(),
  calculateOptimalPosition: jest.fn(),
  positionWindowOnMonitor: jest.fn(),
  moveWindowToNextMonitor: jest.fn(),
  applyPreset: jest.fn(),
  addPreset: jest.fn(),
  on: jest.fn(),
  removeAllListeners: jest.fn(),
};

const mockStore = {
  get: jest.fn(),
  set: jest.fn(),
};

jest.mock('../../electron/MultiMonitorManager', () => ({
  getMultiMonitorManager: () => mockMultiMonitorManager,
}));

jest.mock('../../electron/store', () => ({
  getStoreInstance: () => mockStore,
}));

// Mock BrowserWindow
const mockWindow = {
  getBounds: jest.fn(),
  setBounds: jest.fn(),
  setPosition: jest.fn(),
  getPosition: jest.fn(),
  isDestroyed: jest.fn(() => false),
  isMaximized: jest.fn(() => false),
  isMinimized: jest.fn(() => false),
  getOpacity: jest.fn(() => 1),
  setOpacity: jest.fn(),
  maximize: jest.fn(),
  minimize: jest.fn(),
  restore: jest.fn(),
  on: jest.fn(),
  once: jest.fn(),
  removeListener: jest.fn(),
};

describe('WindowManager', () => {
  let windowManager: WindowManager;
  
  const mockMonitor = {
    id: 'monitor-1',
    displayId: 1,
    name: 'Built-in Display',
    bounds: { x: 0, y: 0, width: 1920, height: 1080 },
    workArea: { x: 0, y: 25, width: 1920, height: 1055 },
    scaleFactor: 1,
    isPrimary: true,
    isInternal: true,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    
    mockMultiMonitorManager.getPrimaryMonitor.mockReturnValue(mockMonitor);
    mockMultiMonitorManager.getMonitorContainingPoint.mockReturnValue(mockMonitor);
    mockMultiMonitorManager.calculateOptimalPosition.mockReturnValue({ x: 100, y: 100 });
    
    mockWindow.getBounds.mockReturnValue({
      x: 100,
      y: 100,
      width: 800,
      height: 600,
    });
    
    mockStore.get.mockReturnValue(null);
    
    windowManager = new WindowManager();
  });

  afterEach(() => {
    windowManager.destroy();
  });

  describe('Initialization', () => {
    test('should initialize with default options', () => {
      expect(windowManager.isReady()).toBe(false); // Not ready until window is set
    });

    test('should initialize with custom options', () => {
      const customOptions = {
        defaultWidth: 1000,
        defaultHeight: 700,
        minWidth: 800,
        minHeight: 500,
      };
      
      const customManager = new WindowManager(customOptions);
      expect(customManager).toBeDefined();
      customManager.destroy();
    });
  });

  describe('Window Management', () => {
    beforeEach(() => {
      windowManager.setWindow(mockWindow as any);
    });

    test('should set window and become ready', () => {
      expect(windowManager.isReady()).toBe(true);
      expect(mockWindow.on).toHaveBeenCalledWith('moved', expect.any(Function));
      expect(mockWindow.on).toHaveBeenCalledWith('resized', expect.any(Function));
    });

    test('should get default position', () => {
      const position = windowManager.getDefaultPosition();
      
      expect(position).toHaveProperty('x');
      expect(position).toHaveProperty('y');
      expect(position).toHaveProperty('width');
      expect(position).toHaveProperty('height');
      expect(position.width).toBe(800); // default width
      expect(position.height).toBe(600); // default height
    });

    test('should get current monitor', () => {
      const monitor = windowManager.getCurrentMonitor();
      expect(monitor).toEqual(mockMonitor);
      expect(mockMultiMonitorManager.getMonitorContainingPoint).toHaveBeenCalled();
    });

    test('should return null for current monitor when window not set', () => {
      const noWindowManager = new WindowManager();
      const monitor = noWindowManager.getCurrentMonitor();
      expect(monitor).toBeNull();
      noWindowManager.destroy();
    });
  });

  describe('Window State Management', () => {
    beforeEach(() => {
      windowManager.setWindow(mockWindow as any);
    });

    test('should restore window state successfully', () => {
      const mockState: WindowState = {
        x: 200,
        y: 200,
        width: 1000,
        height: 700,
        monitorId: 'monitor-1',
        isMaximized: false,
        isMinimized: false,
        opacity: 1,
      };
      
      mockStore.get.mockReturnValue(mockState);
      mockMultiMonitorManager.getMonitorById.mockReturnValue(mockMonitor);
      
      const restoredState = windowManager.restoreWindowState();
      
      expect(restoredState).toEqual(mockState);
    });

    test('should handle invalid saved monitor gracefully', () => {
      const mockState: WindowState = {
        x: 200,
        y: 200,
        width: 1000,
        height: 700,
        monitorId: 'invalid-monitor',
        isMaximized: false,
        isMinimized: false,
        opacity: 1,
      };
      
      mockStore.get.mockReturnValue(mockState);
      mockMultiMonitorManager.getMonitorById.mockReturnValue(null); // Invalid monitor
      mockMultiMonitorManager.getPrimaryMonitor.mockReturnValue(mockMonitor);
      
      const restoredState = windowManager.restoreWindowState();
      
      expect(restoredState?.monitorId).toBe('monitor-1'); // Should use primary
    });

    test('should apply window state successfully', () => {
      const state: WindowState = {
        x: 300,
        y: 300,
        width: 900,
        height: 650,
        monitorId: 'monitor-1',
        isMaximized: true,
        isMinimized: false,
        opacity: 0.8,
      };
      
      const success = windowManager.applyWindowState(state);
      
      expect(success).toBe(true);
      expect(mockWindow.setBounds).toHaveBeenCalledWith({
        x: 300,
        y: 300,
        width: 900,
        height: 650,
      });
      expect(mockWindow.maximize).toHaveBeenCalled();
      expect(mockWindow.setOpacity).toHaveBeenCalledWith(0.8);
    });

    test('should handle minimized state', () => {
      const state: WindowState = {
        x: 300,
        y: 300,
        width: 900,
        height: 650,
        monitorId: 'monitor-1',
        isMaximized: false,
        isMinimized: true,
        opacity: 1,
      };
      
      windowManager.applyWindowState(state);
      expect(mockWindow.minimize).toHaveBeenCalled();
    });

    test('should enforce minimum dimensions', () => {
      const state: WindowState = {
        x: 300,
        y: 300,
        width: 500, // Below minimum
        height: 400, // Below minimum
        monitorId: 'monitor-1',
        isMaximized: false,
        isMinimized: false,
        opacity: 1,
      };
      
      windowManager.applyWindowState(state);
      
      expect(mockWindow.setBounds).toHaveBeenCalledWith({
        x: 300,
        y: 300,
        width: 750, // Enforced minimum
        height: 550, // Enforced minimum
      });
    });
  });

  describe('Monitor Operations', () => {
    beforeEach(() => {
      windowManager.setWindow(mockWindow as any);
    });

    test('should move to monitor successfully', () => {
      mockMultiMonitorManager.positionWindowOnMonitor.mockReturnValue(true);
      
      const success = windowManager.moveToMonitor('monitor-2', 'center');
      
      expect(success).toBe(true);
      expect(mockMultiMonitorManager.positionWindowOnMonitor).toHaveBeenCalledWith(
        mockWindow,
        'monitor-2',
        'center'
      );
    });

    test('should move to next monitor successfully', () => {
      mockMultiMonitorManager.moveWindowToNextMonitor.mockReturnValue(true);
      
      const success = windowManager.moveToNextMonitor();
      
      expect(success).toBe(true);
      expect(mockMultiMonitorManager.moveWindowToNextMonitor).toHaveBeenCalledWith(mockWindow);
    });

    test('should apply preset successfully', () => {
      mockMultiMonitorManager.applyPreset.mockReturnValue(true);
      
      const success = windowManager.applyPreset('preset-1');
      
      expect(success).toBe(true);
      expect(mockMultiMonitorManager.applyPreset).toHaveBeenCalledWith(mockWindow, 'preset-1');
    });

    test('should create preset from current position', () => {
      mockMultiMonitorManager.addPreset.mockReturnValue('new-preset-id');
      
      const presetId = windowManager.createPresetFromCurrentPosition('My Preset');
      
      expect(presetId).toBe('new-preset-id');
      expect(mockMultiMonitorManager.addPreset).toHaveBeenCalledWith({
        name: 'My Preset',
        monitorId: mockMonitor.id,
        position: mockWindow.getBounds(),
        relativePosition: 'custom',
      });
    });

    test('should return null when creating preset without window', () => {
      const noWindowManager = new WindowManager();
      const presetId = noWindowManager.createPresetFromCurrentPosition('Test');
      
      expect(presetId).toBeNull();
      noWindowManager.destroy();
    });
  });

  describe('Monitor Change Handling', () => {
    beforeEach(() => {
      windowManager.setWindow(mockWindow as any);
    });

    test('should handle monitor changes when window is off-screen', () => {
      // Simulate window being off-screen (no monitor contains it)
      mockMultiMonitorManager.getMonitorContainingPoint.mockReturnValue(null);
      mockMultiMonitorManager.getPrimaryMonitor.mockReturnValue(mockMonitor);
      mockMultiMonitorManager.positionWindowOnMonitor.mockReturnValue(true);
      
      // Trigger monitor change event
      const monitorChangeCallback = mockMultiMonitorManager.on.mock.calls
        .find(call => call[0] === 'monitors-changed')?.[1];
      
      if (monitorChangeCallback) {
        monitorChangeCallback([mockMonitor]);
      }
      
      expect(mockMultiMonitorManager.positionWindowOnMonitor).toHaveBeenCalledWith(
        mockWindow,
        mockMonitor.id,
        'center'
      );
    });
  });

  describe('Error Handling', () => {
    test('should handle destroyed window gracefully', () => {
      mockWindow.isDestroyed.mockReturnValue(true);
      windowManager.setWindow(mockWindow as any);
      
      const success = windowManager.moveToMonitor('monitor-1');
      expect(success).toBe(false);
    });

    test('should handle window state errors gracefully', () => {
      windowManager.setWindow(mockWindow as any);
      mockWindow.setBounds.mockImplementation(() => {
        throw new Error('Window error');
      });
      
      const state: WindowState = {
        x: 100,
        y: 100,
        width: 800,
        height: 600,
        monitorId: 'monitor-1',
        isMaximized: false,
        isMinimized: false,
        opacity: 1,
      };
      
      const success = windowManager.applyWindowState(state);
      expect(success).toBe(false);
    });

    test('should handle store errors gracefully', () => {
      mockStore.get.mockImplementation(() => {
        throw new Error('Store error');
      });
      
      const state = windowManager.restoreWindowState();
      expect(state).toBeNull();
    });
  });

  describe('Position Validation', () => {
    beforeEach(() => {
      windowManager.setWindow(mockWindow as any);
    });

    test('should validate position is within monitor bounds', () => {
      const validState: WindowState = {
        x: 100,
        y: 100,
        width: 800,
        height: 600,
        monitorId: 'monitor-1',
        isMaximized: false,
        isMinimized: false,
        opacity: 1,
      };
      
      mockStore.get.mockReturnValue(validState);
      mockMultiMonitorManager.getMonitorById.mockReturnValue(mockMonitor);
      
      const restoredState = windowManager.restoreWindowState();
      expect(restoredState).toEqual(validState);
    });

    test('should recalculate position when outside monitor bounds', () => {
      const invalidState: WindowState = {
        x: 3000, // Outside monitor bounds
        y: 3000,
        width: 800,
        height: 600,
        monitorId: 'monitor-1',
        isMaximized: false,
        isMinimized: false,
        opacity: 1,
      };
      
      mockStore.get.mockReturnValue(invalidState);
      mockMultiMonitorManager.getMonitorById.mockReturnValue(mockMonitor);
      mockMultiMonitorManager.calculateOptimalPosition.mockReturnValue({ x: 200, y: 200 });
      
      const restoredState = windowManager.restoreWindowState();
      expect(restoredState?.x).toBe(200);
      expect(restoredState?.y).toBe(200);
    });
  });
});
