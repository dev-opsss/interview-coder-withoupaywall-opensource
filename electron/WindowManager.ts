import { BrowserWindow } from "electron";
import { getMultiMonitorManager, MonitorInfo, WindowPositionPreset } from "./MultiMonitorManager";
import { getStoreInstance } from "./store";
import { safeLog, safeError } from "./main";

export interface WindowState {
  x: number;
  y: number;
  width: number;
  height: number;
  monitorId: string;
  isMaximized: boolean;
  isMinimized: boolean;
  opacity: number;
}

export interface WindowManagerOptions {
  defaultWidth: number;
  defaultHeight: number;
  minWidth: number;
  minHeight: number;
  rememberPosition: boolean;
  rememberSize: boolean;
  adaptToMonitorChanges: boolean;
}

export class WindowManager {
  private window: BrowserWindow | null = null;
  private multiMonitorManager = getMultiMonitorManager();
  private options: WindowManagerOptions;
  private windowStateKey = 'windowState';
  private isInitialized = false;

  constructor(options: Partial<WindowManagerOptions> = {}) {
    this.options = {
      defaultWidth: 800,
      defaultHeight: 600,
      minWidth: 750,
      minHeight: 550,
      rememberPosition: true,
      rememberSize: true,
      adaptToMonitorChanges: true,
      ...options
    };

    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    // Listen for monitor changes
    this.multiMonitorManager.on('monitors-changed', (monitors: MonitorInfo[]) => {
      if (this.options.adaptToMonitorChanges && this.window && !this.window.isDestroyed()) {
        this.handleMonitorChanges(monitors);
      }
    });
  }

  private handleMonitorChanges(monitors: MonitorInfo[]): void {
    if (!this.window || this.window.isDestroyed()) return;

    const currentBounds = this.window.getBounds();
    const currentMonitor = this.multiMonitorManager.getMonitorContainingPoint(
      currentBounds.x + currentBounds.width / 2,
      currentBounds.y + currentBounds.height / 2
    );

    // If window is no longer on any monitor, move it to primary
    if (!currentMonitor) {
      const primaryMonitor = this.multiMonitorManager.getPrimaryMonitor();
      if (primaryMonitor) {
        safeLog("Window is off-screen, moving to primary monitor");
        this.multiMonitorManager.positionWindowOnMonitor(this.window, primaryMonitor.id, 'center');
      }
    }
  }

  public setWindow(window: BrowserWindow): void {
    this.window = window;
    this.setupWindowEventListeners();
    this.isInitialized = true;
  }

  private setupWindowEventListeners(): void {
    if (!this.window) return;

    // Save window state on move/resize
    this.window.on('moved', () => this.saveWindowState());
    this.window.on('resized', () => this.saveWindowState());
    this.window.on('maximize', () => this.saveWindowState());
    this.window.on('unmaximize', () => this.saveWindowState());
    this.window.on('minimize', () => this.saveWindowState());
    this.window.on('restore', () => this.saveWindowState());

    // Handle window close
    this.window.on('close', () => {
      this.saveWindowState();
    });
  }

  public restoreWindowState(): WindowState | null {
    try {
      const store = getStoreInstance();
      if (!store) return null;

      const savedState = store.get(this.windowStateKey) as WindowState;
      if (!savedState) return null;

      // Validate that the monitor still exists
      const monitor = this.multiMonitorManager.getMonitorById(savedState.monitorId);
      if (!monitor) {
        safeLog(`Saved monitor ${savedState.monitorId} no longer exists, using primary`);
        const primary = this.multiMonitorManager.getPrimaryMonitor();
        if (primary) {
          savedState.monitorId = primary.id;
          // Recalculate position for primary monitor
          const optimalPos = this.multiMonitorManager.calculateOptimalPosition(
            primary.id, 'center', savedState.width, savedState.height
          );
          savedState.x = optimalPos.x;
          savedState.y = optimalPos.y;
        }
      } else {
        // Validate position is still within monitor bounds
        const isValidPosition = this.isPositionValid(savedState, monitor);
        if (!isValidPosition) {
          safeLog("Saved position is invalid, recalculating");
          const optimalPos = this.multiMonitorManager.calculateOptimalPosition(
            monitor.id, 'center', savedState.width, savedState.height
          );
          savedState.x = optimalPos.x;
          savedState.y = optimalPos.y;
        }
      }

      return savedState;
    } catch (error) {
      safeError("Failed to restore window state:", error);
      return null;
    }
  }

  private isPositionValid(state: WindowState, monitor: MonitorInfo): boolean {
    const { workArea } = monitor;
    const windowRight = state.x + state.width;
    const windowBottom = state.y + state.height;
    const workAreaRight = workArea.x + workArea.width;
    const workAreaBottom = workArea.y + workArea.height;

    // Check if at least 50% of the window is within the work area
    const overlapWidth = Math.max(0, Math.min(windowRight, workAreaRight) - Math.max(state.x, workArea.x));
    const overlapHeight = Math.max(0, Math.min(windowBottom, workAreaBottom) - Math.max(state.y, workArea.y));
    const overlapArea = overlapWidth * overlapHeight;
    const windowArea = state.width * state.height;

    return overlapArea >= windowArea * 0.5;
  }

  private saveWindowState(): void {
    if (!this.window || this.window.isDestroyed()) return;

    try {
      const bounds = this.window.getBounds();
      const currentMonitor = this.multiMonitorManager.getMonitorContainingPoint(
        bounds.x + bounds.width / 2,
        bounds.y + bounds.height / 2
      );

      const windowState: WindowState = {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        monitorId: currentMonitor?.id || 'primary',
        isMaximized: this.window.isMaximized(),
        isMinimized: this.window.isMinimized(),
        opacity: this.window.getOpacity()
      };

      const store = getStoreInstance();
      if (store) {
        store.set(this.windowStateKey, windowState);
      }
    } catch (error) {
      safeError("Failed to save window state:", error);
    }
  }

  public applyWindowState(state: WindowState): boolean {
    if (!this.window || this.window.isDestroyed()) return false;

    try {
      // Apply position and size
      this.window.setBounds({
        x: Math.round(state.x),
        y: Math.round(state.y),
        width: Math.max(state.width, this.options.minWidth),
        height: Math.max(state.height, this.options.minHeight)
      });

      // Apply window state
      if (state.isMaximized) {
        this.window.maximize();
      } else if (state.isMinimized) {
        this.window.minimize();
      }

      // Apply opacity
      if (state.opacity !== undefined && state.opacity >= 0 && state.opacity <= 1) {
        this.window.setOpacity(state.opacity);
      }

      return true;
    } catch (error) {
      safeError("Failed to apply window state:", error);
      return false;
    }
  }

  public getDefaultPosition(): { x: number; y: number; width: number; height: number } {
    const primaryMonitor = this.multiMonitorManager.getPrimaryMonitor();
    if (!primaryMonitor) {
      return {
        x: 0,
        y: 50,
        width: this.options.defaultWidth,
        height: this.options.defaultHeight
      };
    }

    const optimalPos = this.multiMonitorManager.calculateOptimalPosition(
      primaryMonitor.id,
      'center',
      this.options.defaultWidth,
      this.options.defaultHeight
    );

    return {
      x: optimalPos.x,
      y: optimalPos.y,
      width: this.options.defaultWidth,
      height: this.options.defaultHeight
    };
  }

  // Public API methods for window management
  public moveToMonitor(monitorId: string, relativePosition: WindowPositionPreset['relativePosition'] = 'center'): boolean {
    if (!this.window || this.window.isDestroyed()) return false;
    return this.multiMonitorManager.positionWindowOnMonitor(this.window, monitorId, relativePosition);
  }

  public moveToNextMonitor(): boolean {
    if (!this.window || this.window.isDestroyed()) return false;
    return this.multiMonitorManager.moveWindowToNextMonitor(this.window);
  }

  public applyPreset(presetId: string): boolean {
    if (!this.window || this.window.isDestroyed()) return false;
    return this.multiMonitorManager.applyPreset(this.window, presetId);
  }

  public getCurrentMonitor(): MonitorInfo | null {
    if (!this.window || this.window.isDestroyed()) return null;
    
    const bounds = this.window.getBounds();
    return this.multiMonitorManager.getMonitorContainingPoint(
      bounds.x + bounds.width / 2,
      bounds.y + bounds.height / 2
    );
  }

  public getAvailableMonitors(): MonitorInfo[] {
    return this.multiMonitorManager.getMonitors();
  }

  public createPresetFromCurrentPosition(name: string): string | null {
    if (!this.window || this.window.isDestroyed()) return null;

    const bounds = this.window.getBounds();
    const currentMonitor = this.getCurrentMonitor();
    
    if (!currentMonitor) return null;

    return this.multiMonitorManager.addPreset({
      name,
      monitorId: currentMonitor.id,
      position: bounds,
      relativePosition: 'custom'
    });
  }

  public isReady(): boolean {
    return this.isInitialized && this.multiMonitorManager.isReady();
  }

  public destroy(): void {
    this.multiMonitorManager.removeAllListeners();
    this.window = null;
    this.isInitialized = false;
  }
}

// Singleton instance for the main window
let mainWindowManager: WindowManager | null = null;

export function getMainWindowManager(): WindowManager {
  if (!mainWindowManager) {
    mainWindowManager = new WindowManager();
  }
  return mainWindowManager;
}

export function destroyMainWindowManager(): void {
  if (mainWindowManager) {
    mainWindowManager.destroy();
    mainWindowManager = null;
  }
}

