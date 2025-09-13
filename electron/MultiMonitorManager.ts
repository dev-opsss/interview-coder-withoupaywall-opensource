import { screen, Display, BrowserWindow } from "electron";
import { EventEmitter } from "events";
import { getStoreInstance } from "./store";
import { safeLog, safeError } from "./main";

export interface MonitorInfo {
  id: string;
  displayId: number;
  name: string;
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  workArea: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  scaleFactor: number;
  isPrimary: boolean;
  isInternal: boolean;
}

export interface WindowPositionPreset {
  id: string;
  name: string;
  monitorId: string;
  position: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  relativePosition: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center' | 'custom';
}

export interface MultiMonitorSettings {
  preferredMonitor: string | null;
  windowPresets: WindowPositionPreset[];
  autoSwitchMonitor: boolean;
  rememberLastPosition: boolean;
  adaptToMonitorChanges: boolean;
}

export class MultiMonitorManager extends EventEmitter {
  private monitors: Map<string, MonitorInfo> = new Map();
  private settings: MultiMonitorSettings;
  private isInitialized = false;

  constructor() {
    super();
    this.settings = this.getDefaultSettings();
    this.initializeMonitorDetection();
  }

  private getDefaultSettings(): MultiMonitorSettings {
    return {
      preferredMonitor: null,
      windowPresets: this.getDefaultPresets(),
      autoSwitchMonitor: true,
      rememberLastPosition: true,
      adaptToMonitorChanges: true,
    };
  }

  private getDefaultPresets(): WindowPositionPreset[] {
    return [
      {
        id: 'top-left',
        name: 'Top Left',
        monitorId: 'primary',
        position: { x: 0, y: 0, width: 800, height: 600 },
        relativePosition: 'top-left'
      },
      {
        id: 'top-right',
        name: 'Top Right',
        monitorId: 'primary',
        position: { x: 0, y: 0, width: 800, height: 600 },
        relativePosition: 'top-right'
      },
      {
        id: 'center',
        name: 'Center',
        monitorId: 'primary',
        position: { x: 0, y: 0, width: 800, height: 600 },
        relativePosition: 'center'
      }
    ];
  }

  private async initializeMonitorDetection(): Promise<void> {
    try {
      await this.loadSettings();
      this.detectMonitors();
      this.setupMonitorChangeListeners();
      this.isInitialized = true;
      safeLog("MultiMonitorManager initialized successfully");
      this.emit('initialized');
    } catch (error) {
      safeError("Failed to initialize MultiMonitorManager:", error);
    }
  }

  private async loadSettings(): Promise<void> {
    try {
      const store = getStoreInstance();
      if (store) {
        const savedSettings = store.get('multiMonitorSettings');
        if (savedSettings) {
          this.settings = { ...this.settings, ...savedSettings };
        }
      }
    } catch (error) {
      safeError("Failed to load multi-monitor settings:", error);
    }
  }

  private async saveSettings(): Promise<void> {
    try {
      const store = getStoreInstance();
      if (store) {
        store.set('multiMonitorSettings', this.settings);
      }
    } catch (error) {
      safeError("Failed to save multi-monitor settings:", error);
    }
  }

  private detectMonitors(): void {
    try {
      const displays = screen.getAllDisplays();
      const primaryDisplay = screen.getPrimaryDisplay();
      
      this.monitors.clear();
      
      displays.forEach((display, index) => {
        const monitorInfo: MonitorInfo = {
          id: `monitor-${display.id}`,
          displayId: display.id,
          name: this.generateMonitorName(display, index),
          bounds: display.bounds,
          workArea: display.workArea,
          scaleFactor: display.scaleFactor,
          isPrimary: display.id === primaryDisplay.id,
          isInternal: display.internal || false,
        };
        
        this.monitors.set(monitorInfo.id, monitorInfo);
      });

      safeLog(`Detected ${this.monitors.size} monitors:`, 
        Array.from(this.monitors.values()).map(m => `${m.name} (${m.bounds.width}x${m.bounds.height})`));
      
      this.emit('monitors-changed', Array.from(this.monitors.values()));
    } catch (error) {
      safeError("Failed to detect monitors:", error);
    }
  }

  private generateMonitorName(display: Display, index: number): string {
    if (display.internal) {
      return "Built-in Display";
    }
    
    // Try to get a meaningful name
    const resolution = `${display.bounds.width}x${display.bounds.height}`;
    return `External Monitor ${index + 1} (${resolution})`;
  }

  private setupMonitorChangeListeners(): void {
    screen.on('display-added', () => {
      safeLog("Display added - refreshing monitor list");
      this.detectMonitors();
    });

    screen.on('display-removed', () => {
      safeLog("Display removed - refreshing monitor list");
      this.detectMonitors();
    });

    screen.on('display-metrics-changed', () => {
      safeLog("Display metrics changed - refreshing monitor list");
      this.detectMonitors();
    });
  }

  // Public API methods
  public getMonitors(): MonitorInfo[] {
    return Array.from(this.monitors.values());
  }

  public getMonitorById(id: string): MonitorInfo | null {
    return this.monitors.get(id) || null;
  }

  public getPrimaryMonitor(): MonitorInfo | null {
    return Array.from(this.monitors.values()).find(m => m.isPrimary) || null;
  }

  public getMonitorContainingPoint(x: number, y: number): MonitorInfo | null {
    return Array.from(this.monitors.values()).find(monitor => {
      const { bounds } = monitor;
      return x >= bounds.x && 
             x < bounds.x + bounds.width && 
             y >= bounds.y && 
             y < bounds.y + bounds.height;
    }) || null;
  }

  public calculateOptimalPosition(
    monitorId: string, 
    relativePosition: WindowPositionPreset['relativePosition'],
    windowWidth: number = 800,
    windowHeight: number = 600
  ): { x: number; y: number } {
    const monitor = this.getMonitorById(monitorId);
    if (!monitor) {
      const primary = this.getPrimaryMonitor();
      if (!primary) return { x: 0, y: 0 };
      return this.calculateOptimalPosition(primary.id, relativePosition, windowWidth, windowHeight);
    }

    const { workArea } = monitor;
    const padding = 20; // Padding from screen edges

    switch (relativePosition) {
      case 'top-left':
        return {
          x: workArea.x + padding,
          y: workArea.y + padding
        };
      
      case 'top-right':
        return {
          x: workArea.x + workArea.width - windowWidth - padding,
          y: workArea.y + padding
        };
      
      case 'bottom-left':
        return {
          x: workArea.x + padding,
          y: workArea.y + workArea.height - windowHeight - padding
        };
      
      case 'bottom-right':
        return {
          x: workArea.x + workArea.width - windowWidth - padding,
          y: workArea.y + workArea.height - windowHeight - padding
        };
      
      case 'center':
        return {
          x: workArea.x + (workArea.width - windowWidth) / 2,
          y: workArea.y + (workArea.height - windowHeight) / 2
        };
      
      default:
        return {
          x: workArea.x + padding,
          y: workArea.y + padding
        };
    }
  }

  public positionWindowOnMonitor(
    window: BrowserWindow,
    monitorId: string,
    relativePosition: WindowPositionPreset['relativePosition'] = 'center'
  ): boolean {
    try {
      const monitor = this.getMonitorById(monitorId);
      if (!monitor) {
        safeError(`Monitor with id ${monitorId} not found`);
        return false;
      }

      const windowBounds = window.getBounds();
      const optimalPosition = this.calculateOptimalPosition(
        monitorId,
        relativePosition,
        windowBounds.width,
        windowBounds.height
      );

      window.setBounds({
        x: Math.round(optimalPosition.x),
        y: Math.round(optimalPosition.y),
        width: windowBounds.width,
        height: windowBounds.height
      });

      safeLog(`Positioned window on ${monitor.name} at ${optimalPosition.x}, ${optimalPosition.y}`);
      return true;
    } catch (error) {
      safeError("Failed to position window on monitor:", error);
      return false;
    }
  }

  public moveWindowToNextMonitor(window: BrowserWindow): boolean {
    try {
      const currentBounds = window.getBounds();
      const currentMonitor = this.getMonitorContainingPoint(
        currentBounds.x + currentBounds.width / 2,
        currentBounds.y + currentBounds.height / 2
      );

      if (!currentMonitor) {
        safeError("Could not determine current monitor");
        return false;
      }

      const monitors = this.getMonitors();
      const currentIndex = monitors.findIndex(m => m.id === currentMonitor.id);
      const nextIndex = (currentIndex + 1) % monitors.length;
      const nextMonitor = monitors[nextIndex];

      return this.positionWindowOnMonitor(window, nextMonitor.id, 'center');
    } catch (error) {
      safeError("Failed to move window to next monitor:", error);
      return false;
    }
  }

  // Preset management
  public getPresets(): WindowPositionPreset[] {
    return [...this.settings.windowPresets];
  }

  public addPreset(preset: Omit<WindowPositionPreset, 'id'>): string {
    const newPreset: WindowPositionPreset = {
      ...preset,
      id: `preset-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    };

    this.settings.windowPresets.push(newPreset);
    this.saveSettings();
    this.emit('presets-changed', this.settings.windowPresets);
    
    return newPreset.id;
  }

  public removePreset(presetId: string): boolean {
    const index = this.settings.windowPresets.findIndex(p => p.id === presetId);
    if (index === -1) return false;

    this.settings.windowPresets.splice(index, 1);
    this.saveSettings();
    this.emit('presets-changed', this.settings.windowPresets);
    
    return true;
  }

  public applyPreset(window: BrowserWindow, presetId: string): boolean {
    const preset = this.settings.windowPresets.find(p => p.id === presetId);
    if (!preset) {
      safeError(`Preset with id ${presetId} not found`);
      return false;
    }

    try {
      if (preset.relativePosition === 'custom') {
        window.setBounds(preset.position);
      } else {
        return this.positionWindowOnMonitor(window, preset.monitorId, preset.relativePosition);
      }
      return true;
    } catch (error) {
      safeError("Failed to apply preset:", error);
      return false;
    }
  }

  // Settings management
  public getSettings(): MultiMonitorSettings {
    return { ...this.settings };
  }

  public updateSettings(updates: Partial<MultiMonitorSettings>): void {
    this.settings = { ...this.settings, ...updates };
    this.saveSettings();
    this.emit('settings-changed', this.settings);
  }

  public isReady(): boolean {
    return this.isInitialized;
  }

  public destroy(): void {
    screen.removeAllListeners('display-added');
    screen.removeAllListeners('display-removed');
    screen.removeAllListeners('display-metrics-changed');
    this.removeAllListeners();
    this.monitors.clear();
  }
}

// Singleton instance
let multiMonitorManager: MultiMonitorManager | null = null;

export function getMultiMonitorManager(): MultiMonitorManager {
  if (!multiMonitorManager) {
    multiMonitorManager = new MultiMonitorManager();
  }
  return multiMonitorManager;
}

export function destroyMultiMonitorManager(): void {
  if (multiMonitorManager) {
    multiMonitorManager.destroy();
    multiMonitorManager = null;
  }
}

