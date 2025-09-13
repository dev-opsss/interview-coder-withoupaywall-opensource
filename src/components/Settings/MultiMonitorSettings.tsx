import React, { useState, useEffect } from 'react';
import { Monitor, Settings, Save, RefreshCw } from 'lucide-react';
import MonitorSelector from '../MultiMonitor/MonitorSelector';
import WindowPresets from '../MultiMonitor/WindowPresets';
import PositionControls from '../MultiMonitor/PositionControls';

interface MultiMonitorSettings {
  preferredMonitor: string | null;
  windowPresets: any[];
  autoSwitchMonitor: boolean;
  rememberLastPosition: boolean;
  adaptToMonitorChanges: boolean;
}

interface MultiMonitorSettingsProps {
  className?: string;
}

const MultiMonitorSettingsComponent: React.FC<MultiMonitorSettingsProps> = ({ className = '' }) => {
  const [settings, setSettings] = useState<MultiMonitorSettings>({
    preferredMonitor: null,
    windowPresets: [],
    autoSwitchMonitor: true,
    rememberLastPosition: true,
    adaptToMonitorChanges: true,
  });
  const [monitors, setMonitors] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    loadSettings();
    loadMonitors();
  }, []);

  const loadSettings = async () => {
    try {
      const multiMonitorSettings = await window.electronAPI.invoke('get-multi-monitor-settings');
      setSettings(multiMonitorSettings);
    } catch (error) {
      console.error('Failed to load multi-monitor settings:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const loadMonitors = async () => {
    try {
      const monitorList = await window.electronAPI.invoke('get-monitors');
      setMonitors(monitorList || []);
    } catch (error) {
      console.error('Failed to load monitors:', error);
    }
  };

  const handleSettingChange = (key: keyof MultiMonitorSettings, value: any) => {
    setSettings(prev => ({ ...prev, [key]: value }));
    setHasChanges(true);
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const result = await window.electronAPI.invoke('update-multi-monitor-settings', settings);
      if (result.success) {
        setHasChanges(false);
        // Show success feedback
        console.log('Multi-monitor settings saved successfully');
      } else {
        console.error('Failed to save settings:', result.error);
      }
    } catch (error) {
      console.error('Failed to save multi-monitor settings:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleMonitorSelect = async (monitorId: string, position?: string) => {
    try {
      const result = await window.electronAPI.invoke('move-window-to-monitor', monitorId, position);
      if (!result.success) {
        console.error('Failed to move window:', result.error);
      }
    } catch (error) {
      console.error('Failed to move window to monitor:', error);
    }
  };

  const handleMoveToNextMonitor = async () => {
    try {
      const result = await window.electronAPI.invoke('move-window-to-next-monitor');
      if (!result.success) {
        console.error('Failed to move to next monitor:', result.error);
      }
    } catch (error) {
      console.error('Failed to move to next monitor:', error);
    }
  };

  if (isLoading) {
    return (
      <div className={`flex items-center justify-center p-8 ${className}`}>
        <div className="w-8 h-8 border-2 border-gray-300 border-t-blue-600 rounded-full animate-spin"></div>
        <span className="ml-3 text-gray-600">Loading multi-monitor settings...</span>
      </div>
    );
  }

  if (monitors.length <= 1) {
    return (
      <div className={`text-center p-8 ${className}`}>
        <Monitor className="w-16 h-16 text-gray-400 mx-auto mb-4" />
        <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-2">
          Single Monitor Setup
        </h3>
        <p className="text-gray-600 dark:text-gray-400">
          Multi-monitor features are available when multiple displays are connected.
        </p>
        <button
          onClick={loadMonitors}
          className="mt-4 flex items-center gap-2 mx-auto px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        >
          <RefreshCw className="w-4 h-4" />
          <span className="text-sm">Refresh</span>
        </button>
      </div>
    );
  }

  return (
    <div className={`space-y-6 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Monitor className="w-6 h-6 text-blue-600 dark:text-blue-400" />
          <div>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
              Multi-Monitor Support
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Manage window positioning across {monitors.length} displays
            </p>
          </div>
        </div>
        
        {hasChanges && (
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2"
          >
            {isSaving ? (
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            <span className="text-sm">{isSaving ? 'Saving...' : 'Save Changes'}</span>
          </button>
        )}
      </div>

      {/* Monitor Selection */}
      <div className="bg-white dark:bg-gray-800 rounded-lg p-6 border border-gray-200 dark:border-gray-600">
        <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-4">
          Monitor Selection
        </h3>
        <MonitorSelector onMonitorSelect={handleMonitorSelect} />
      </div>

      {/* Position Controls */}
      <div className="bg-white dark:bg-gray-800 rounded-lg p-6 border border-gray-200 dark:border-gray-600">
        <PositionControls
          onPositionChange={handleMonitorSelect}
          onMoveToNextMonitor={handleMoveToNextMonitor}
        />
      </div>

      {/* Window Presets */}
      <div className="bg-white dark:bg-gray-800 rounded-lg p-6 border border-gray-200 dark:border-gray-600">
        <WindowPresets />
      </div>

      {/* Settings */}
      <div className="bg-white dark:bg-gray-800 rounded-lg p-6 border border-gray-200 dark:border-gray-600">
        <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-4">
          Behavior Settings
        </h3>
        
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <label className="text-sm font-medium text-gray-900 dark:text-gray-100">
                Remember Last Position
              </label>
              <p className="text-xs text-gray-600 dark:text-gray-400">
                Restore window position when app starts
              </p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={settings.rememberLastPosition}
                onChange={(e) => handleSettingChange('rememberLastPosition', e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-blue-600"></div>
            </label>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <label className="text-sm font-medium text-gray-900 dark:text-gray-100">
                Adapt to Monitor Changes
              </label>
              <p className="text-xs text-gray-600 dark:text-gray-400">
                Automatically adjust when monitors are added or removed
              </p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={settings.adaptToMonitorChanges}
                onChange={(e) => handleSettingChange('adaptToMonitorChanges', e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-blue-600"></div>
            </label>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <label className="text-sm font-medium text-gray-900 dark:text-gray-100">
                Auto Switch Monitor
              </label>
              <p className="text-xs text-gray-600 dark:text-gray-400">
                Automatically move window to preferred monitor
              </p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={settings.autoSwitchMonitor}
                onChange={(e) => handleSettingChange('autoSwitchMonitor', e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-blue-600"></div>
            </label>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MultiMonitorSettingsComponent;

