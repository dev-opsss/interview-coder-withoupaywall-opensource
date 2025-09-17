import React, { useState, useEffect } from 'react';
import { Monitor, Settings, ChevronDown } from 'lucide-react';

interface MonitorInfo {
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

interface MonitorSelectorProps {
  onMonitorSelect: (monitorId: string, position?: string) => void;
  className?: string;
}

const MonitorSelector: React.FC<MonitorSelectorProps> = ({ onMonitorSelect, className = '' }) => {
  const [monitors, setMonitors] = useState<MonitorInfo[]>([]);
  const [currentMonitor, setCurrentMonitor] = useState<MonitorInfo | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadMonitors();
    loadCurrentMonitor();
  }, []);

  const loadMonitors = async () => {
    try {
      const monitorList = await window.electronAPI.invoke('get-monitors');
      setMonitors(monitorList || []);
    } catch (error) {
      console.error('Failed to load monitors:', error);
      setMonitors([]);
    } finally {
      setIsLoading(false);
    }
  };

  const loadCurrentMonitor = async () => {
    try {
      const current = await window.electronAPI.invoke('get-current-monitor');
      setCurrentMonitor(current);
    } catch (error) {
      console.error('Failed to get current monitor:', error);
    }
  };

  const handleMonitorSelect = async (monitorId: string) => {
    try {
      onMonitorSelect(monitorId, 'center');
      setIsOpen(false);
      // Refresh current monitor after a short delay
      setTimeout(loadCurrentMonitor, 500);
    } catch (error) {
      console.error('Failed to select monitor:', error);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      setIsOpen(!isOpen);
    } else if (event.key === 'Escape' && isOpen) {
      event.preventDefault();
      setIsOpen(false);
    }
  };

  const getMonitorDisplayText = (monitor: MonitorInfo): string => {
    const resolution = `${monitor.bounds.width}×${monitor.bounds.height}`;
    let displayText = monitor.name;
    
    if (monitor.isPrimary) {
      displayText += ' (Primary)';
    }
    
    return `${displayText} - ${resolution}`;
  };

  if (isLoading) {
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        <div className="w-4 h-4 border-2 border-gray-300 border-t-blue-600 rounded-full animate-spin"></div>
        <span className="text-sm text-gray-600">Loading monitors...</span>
      </div>
    );
  }

  if (monitors.length <= 1) {
    return (
      <div className={`flex items-center gap-2 text-gray-500 ${className}`}>
        <Monitor className="w-4 h-4" />
        <span className="text-sm">Single monitor detected</span>
      </div>
    );
  }

  return (
    <div className={`relative ${className}`}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        onKeyDown={handleKeyDown}
        className="flex items-center gap-2 px-3 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent min-w-[200px]"
        aria-label="Select monitor"
        aria-expanded={isOpen}
        aria-haspopup="listbox"
      >
        <Monitor className="w-4 h-4 text-gray-600 dark:text-gray-400" />
        <span className="flex-1 text-left text-sm text-gray-900 dark:text-gray-100 truncate">
          {currentMonitor ? getMonitorDisplayText(currentMonitor) : 'Select Monitor'}
        </span>
        <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-10"
            onClick={() => setIsOpen(false)}
            aria-hidden="true"
          />
          
          {/* Dropdown */}
          <div className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg z-20 max-h-60 overflow-y-auto">
            <div className="py-1" role="listbox">
              {monitors.map((monitor) => (
                <button
                  key={monitor.id}
                  onClick={() => handleMonitorSelect(monitor.id)}
                  className={`w-full px-3 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors focus:outline-none focus:bg-gray-100 dark:focus:bg-gray-700 ${
                    currentMonitor?.id === monitor.id
                      ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300'
                      : 'text-gray-900 dark:text-gray-100'
                  }`}
                  role="option"
                  aria-selected={currentMonitor?.id === monitor.id}
                >
                  <div className="flex items-center gap-2">
                    <Monitor className="w-4 h-4 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">
                        {monitor.name}
                        {monitor.isPrimary && (
                          <span className="ml-2 px-1.5 py-0.5 text-xs bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 rounded">
                            Primary
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                        {monitor.bounds.width}×{monitor.bounds.height}
                        {monitor.scaleFactor !== 1 && ` @ ${Math.round(monitor.scaleFactor * 100)}%`}
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default MonitorSelector;

