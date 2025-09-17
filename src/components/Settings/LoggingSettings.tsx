import React, { useState, useEffect, useImperativeHandle, forwardRef } from 'react';

interface LoggingSettingsProps {
  onClose?: () => void;
}

export interface LoggingSettingsRef {
  save: () => Promise<boolean>;
}

type LogCategory = 
  | 'speech'
  | 'ui'
  | 'ipc'
  | 'auth'
  | 'file'
  | 'network'
  | 'window'
  | 'system'
  | 'performance'
  | 'general';

type LogLevel = 'ERROR' | 'WARN' | 'INFO' | 'DEBUG' | 'TRACE';

interface LoggingConfig {
  globalLevel: LogLevel;
  categoryLevels: Partial<Record<LogCategory, LogLevel>>;
  enabledCategories: LogCategory[];
  fileLogging: {
    enabled: boolean;
    directory: string;
  };
  consoleLogging: {
    enabled: boolean;
  };
}

const LOG_LEVELS: LogLevel[] = ['ERROR', 'WARN', 'INFO', 'DEBUG', 'TRACE'];
const LOG_CATEGORIES: LogCategory[] = [
  'speech', 'ui', 'ipc', 'auth', 'file', 
  'network', 'window', 'system', 'performance', 'general'
];

const CATEGORY_DESCRIPTIONS: Record<LogCategory, string> = {
  speech: 'Audio processing, STT, TTS',
  ui: 'UI interactions, component lifecycle',
  ipc: 'Inter-process communication',
  auth: 'Authentication, API keys',
  file: 'File operations, I/O',
  network: 'HTTP requests, API calls',
  window: 'Window management, multi-monitor',
  system: 'System events, app lifecycle',
  performance: 'Timing, memory, metrics',
  general: 'Default category'
};

export const LoggingSettings = forwardRef<LoggingSettingsRef, LoggingSettingsProps>(({ onClose }, ref) => {
  const [config, setConfig] = useState<LoggingConfig>({
    globalLevel: 'INFO',
    categoryLevels: {},
    enabledCategories: LOG_CATEGORIES,
    fileLogging: { enabled: true, directory: '' },
    consoleLogging: { enabled: true }
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadLoggingConfig();
  }, []);

  const loadLoggingConfig = async () => {
    try {
      // Get current logging configuration from main process
      const currentConfig = await window.electronAPI?.invoke('get-logging-config');
      if (currentConfig) {
        setConfig(currentConfig);
      }
    } catch (error) {
      console.error('Failed to load logging config:', error);
    } finally {
      setLoading(false);
    }
  };

  const saveLoggingConfig = async (): Promise<boolean> => {
    try {
      const result = await window.electronAPI?.invoke('set-logging-config', config);
      return result?.success !== false; // Return true unless explicitly failed
    } catch (error) {
      console.error('Failed to save logging config:', error);
      return false;
    }
  };

  // Expose save method via ref
  useImperativeHandle(ref, () => ({
    save: saveLoggingConfig
  }));

  const handleGlobalLevelChange = (level: LogLevel) => {
    setConfig(prev => ({ ...prev, globalLevel: level }));
  };

  const handleCategoryLevelChange = (category: LogCategory, level: LogLevel | 'DEFAULT') => {
    setConfig(prev => ({
      ...prev,
      categoryLevels: level === 'DEFAULT' 
        ? { ...prev.categoryLevels, [category]: undefined }
        : { ...prev.categoryLevels, [category]: level }
    }));
  };

  const handleCategoryToggle = (category: LogCategory, enabled: boolean) => {
    setConfig(prev => ({
      ...prev,
      enabledCategories: enabled
        ? [...prev.enabledCategories, category]
        : prev.enabledCategories.filter(c => c !== category)
    }));
  };

  const handleFileLoggingToggle = (enabled: boolean) => {
    setConfig(prev => ({
      ...prev,
      fileLogging: { ...prev.fileLogging, enabled }
    }));
  };

  const handleConsoleLoggingToggle = (enabled: boolean) => {
    setConfig(prev => ({
      ...prev,
      consoleLogging: { enabled }
    }));
  };

  const resetToDefaults = () => {
    setConfig({
      globalLevel: 'INFO',
      categoryLevels: {},
      enabledCategories: LOG_CATEGORIES,
      fileLogging: { enabled: true, directory: '' },
      consoleLogging: { enabled: true }
    });
  };

  if (loading) {
    return (
      <div className="p-6 bg-white rounded-lg shadow-lg max-w-4xl mx-auto">
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600"></div>
          <span className="ml-3 text-gray-600">Loading logging settings...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="max-h-[40vh] overflow-y-auto">
      {/* Remove header when embedded in SettingsDialog */}
      {onClose && (
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-[10px] font-medium text-white">Logging Settings</h2>
          <button
            onClick={onClose}
            className="text-white/70 hover:text-white text-sm font-bold"
            aria-label="Close"
          >
            ×
          </button>
        </div>
      )}

      {/* Global Settings */}
      <div className="mb-2">
        <h3 className="text-xs font-medium text-white mb-1">Global Settings</h3>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {/* Global Log Level */}
          <div>
            <label className="block text-xs font-medium text-white/80 mb-1">
              Global Log Level
            </label>
            <select
              value={config.globalLevel}
              onChange={(e) => handleGlobalLevelChange(e.target.value as LogLevel)}
              className="w-full px-2 py-1 bg-black/50 border border-white/20 rounded text-white text-xs h-7 focus:outline-none focus:ring-1 focus:ring-white/30"
            >
              {LOG_LEVELS.map(level => (
                <option key={level} value={level} className="bg-black text-white">{level}</option>
              ))}
            </select>
            <p className="text-[10px] text-white/60 mt-0.5">
              Minimum level for all categories (unless overridden)
            </p>
          </div>

          {/* Output Options */}
          <div>
            <label className="block text-xs font-medium text-white/80 mb-1">
              Output Options
            </label>
            <div className="space-y-1">
              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={config.consoleLogging.enabled}
                  onChange={(e) => handleConsoleLoggingToggle(e.target.checked)}
                  className="mr-1.5 rounded border-white/30 text-white bg-black/50 focus:ring-white/30 w-3 h-3"
                />
                <span className="text-xs text-white/80">Console Logging</span>
              </label>
              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={config.fileLogging.enabled}
                  onChange={(e) => handleFileLoggingToggle(e.target.checked)}
                  className="mr-1.5 rounded border-white/30 text-white bg-black/50 focus:ring-white/30 w-3 h-3"
                />
                <span className="text-xs text-white/80">File Logging</span>
              </label>
            </div>
          </div>
        </div>
      </div>

      {/* Category Settings */}
      <div className="mb-2">
        <h3 className="text-xs font-medium text-white mb-1">Category Settings</h3>
        
        <div className="bg-black/20 rounded p-2">
          <div className="grid gap-1">
            {LOG_CATEGORIES.map(category => {
              const isEnabled = config.enabledCategories.includes(category);
              const categoryLevel = config.categoryLevels[category];
              
              return (
                <div key={category} className="flex items-center justify-between py-1 border-b border-white/10 last:border-b-0">
                  <div className="flex items-center space-x-2 flex-1">
                    <input
                      type="checkbox"
                      checked={isEnabled}
                      onChange={(e) => handleCategoryToggle(category, e.target.checked)}
                      className="rounded border-white/30 text-white bg-black/50 focus:ring-white/30 w-3 h-3"
                    />
                    <div className="flex-1">
                      <div className="font-medium text-white capitalize text-xs">{category}</div>
                      <div className="text-[10px] text-white/60">{CATEGORY_DESCRIPTIONS[category]}</div>
                    </div>
                  </div>
                  
                  <div className="w-24">
                    <select
                      value={categoryLevel || 'DEFAULT'}
                      onChange={(e) => handleCategoryLevelChange(category, e.target.value as LogLevel | 'DEFAULT')}
                      disabled={!isEnabled}
                      className="w-full px-1 py-0.5 text-[10px] bg-black/50 border border-white/20 rounded text-white focus:outline-none focus:ring-1 focus:ring-white/30 disabled:bg-black/20 disabled:text-white/40 h-6"
                    >
                      <option value="DEFAULT" className="bg-black text-white">Default ({config.globalLevel})</option>
                      {LOG_LEVELS.map(level => (
                        <option key={level} value={level} className="bg-black text-white">{level}</option>
                      ))}
                    </select>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Info Panel */}
      <div className="mt-1 p-1.5 bg-black/20 border border-white/10 rounded">
        <h4 className="font-medium text-white mb-1 text-xs">Log Levels</h4>
        <div className="text-[10px] text-white/80 space-y-0.5">
          <div><strong>ERROR:</strong> Critical errors</div>
          <div><strong>WARN:</strong> Warnings</div>
          <div><strong>INFO:</strong> General info</div>
          <div><strong>DEBUG:</strong> Debug details</div>
          <div><strong>TRACE:</strong> Trace info</div>
        </div>
        <p className="text-[9px] text-white/60 mt-1">
          Higher levels include lower levels
        </p>
      </div>
    </div>
  );
});

LoggingSettings.displayName = 'LoggingSettings';
