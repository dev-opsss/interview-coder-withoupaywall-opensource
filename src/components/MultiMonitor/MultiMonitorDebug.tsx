import React, { useState, useEffect } from 'react';
import { Monitor, ArrowRight, RefreshCw, Eye } from 'lucide-react';

interface MonitorInfo {
  id: string;
  displayId: number;
  name: string;
  bounds: { x: number; y: number; width: number; height: number };
  workArea: { x: number; y: number; width: number; height: number };
  scaleFactor: number;
  isPrimary: boolean;
  isInternal: boolean;
}

const MultiMonitorDebug: React.FC = () => {
  const [monitors, setMonitors] = useState<MonitorInfo[]>([]);
  const [currentMonitor, setCurrentMonitor] = useState<MonitorInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadMonitorInfo();
  }, []);

  const loadMonitorInfo = async () => {
    try {
      const [monitorList, current] = await Promise.all([
        window.electronAPI.invoke('get-monitors'),
        window.electronAPI.invoke('get-current-monitor')
      ]);
      
      setMonitors(monitorList || []);
      setCurrentMonitor(current);
    } catch (error) {
      console.error('Failed to load monitor info:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const moveToNextMonitor = async () => {
    try {
      const result = await window.electronAPI.invoke('move-window-to-next-monitor');
      if (result.success) {
        setTimeout(loadMonitorInfo, 500);
      }
    } catch (error) {
      console.error('Error moving to next monitor:', error);
    }
  };

  if (isLoading) {
    return (
      <div className="p-4 bg-gray-900 text-white rounded-lg">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 border border-gray-400 border-t-blue-500 rounded-full animate-spin"></div>
          <span className="text-sm">Loading monitors...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 bg-gray-900 text-white rounded-lg max-w-2xl">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Monitor className="w-4 h-4 text-blue-400" />
          <h2 className="text-lg font-semibold">Multi-Monitor Debug</h2>
        </div>
        <div className="flex gap-2">
          <button
            onClick={loadMonitorInfo}
            className="flex items-center gap-1 px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded text-xs transition-colors"
          >
            <RefreshCw className="w-3 h-3" />
            Refresh
          </button>
          {monitors.length > 1 && (
            <button
              onClick={moveToNextMonitor}
              className="flex items-center gap-1 px-3 py-1 bg-blue-600 hover:bg-blue-500 rounded text-xs transition-colors"
            >
              <ArrowRight className="w-3 h-3" />
              Next Monitor
            </button>
          )}
        </div>
      </div>

      <div className="space-y-3">
        <div className="text-sm">
          <span className="text-gray-400">Status:</span>{' '}
          {monitors.length > 1 ? (
            <span className="text-green-400">✅ {monitors.length} monitors detected</span>
          ) : (
            <span className="text-yellow-400">⚠️ Single monitor only</span>
          )}
        </div>

        {monitors.length > 0 && (
          <div className="space-y-2">
            <div className="text-xs text-gray-400 uppercase tracking-wide">Detected Monitors:</div>
            {monitors.map((monitor) => (
              <div
                key={monitor.id}
                className={`p-2 rounded border text-xs ${
                  currentMonitor?.id === monitor.id
                    ? 'border-blue-500 bg-blue-900/20 text-blue-100'
                    : 'border-gray-600 bg-gray-800/50 text-gray-300'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Monitor className="w-3 h-3" />
                    <span className="font-medium">{monitor.name}</span>
                    {monitor.isPrimary && (
                      <span className="px-1 py-0.5 bg-blue-600 text-white rounded text-[10px]">
                        PRIMARY
                      </span>
                    )}
                    {currentMonitor?.id === monitor.id && (
                      <span className="px-1 py-0.5 bg-green-600 text-white rounded text-[10px]">
                        CURRENT
                      </span>
                    )}
                  </div>
                  <div className="text-right">
                    <div>{monitor.bounds.width} × {monitor.bounds.height}</div>
                    <div className="text-[10px] text-gray-500">
                      {monitor.isInternal ? 'Built-in' : 'External'}
                      {monitor.scaleFactor !== 1 && ` @ ${Math.round(monitor.scaleFactor * 100)}%`}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="pt-2 border-t border-gray-700">
          <div className="text-xs text-gray-400">
            💡 <strong>How to test:</strong> Connect an HDMI/USB-C monitor, set it to "Extended Display" in macOS, 
            then click "Refresh" to detect it.
          </div>
        </div>
      </div>
    </div>
  );
};

export default MultiMonitorDebug;
