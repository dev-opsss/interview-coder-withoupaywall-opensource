import React, { useState } from 'react';
import { 
  Monitor, 
  ArrowUp, 
  ArrowDown, 
  ArrowLeft, 
  ArrowRight,
  CornerUpLeft,
  CornerUpRight,
  CornerDownLeft,
  CornerDownRight,
  Square,
  RotateCcw
} from 'lucide-react';

interface PositionControlsProps {
  onPositionChange: (monitorId: string, position: string) => void;
  onMoveToNextMonitor: () => void;
  className?: string;
}

const PositionControls: React.FC<PositionControlsProps> = ({ 
  onPositionChange, 
  onMoveToNextMonitor, 
  className = '' 
}) => {
  const [currentMonitor, setCurrentMonitor] = useState<any>(null);
  const [monitors, setMonitors] = useState<any[]>([]);

  React.useEffect(() => {
    loadCurrentMonitor();
    loadMonitors();
  }, []);

  const loadCurrentMonitor = async () => {
    try {
      const monitor = await window.electronAPI.invoke('get-current-monitor');
      setCurrentMonitor(monitor);
    } catch (error) {
      console.error('Failed to get current monitor:', error);
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

  const handlePositionClick = async (position: string) => {
    if (!currentMonitor) return;
    
    try {
      await onPositionChange(currentMonitor.id, position);
      // Refresh current monitor after position change
      setTimeout(loadCurrentMonitor, 300);
    } catch (error) {
      console.error('Failed to change position:', error);
    }
  };

  const handleNextMonitor = async () => {
    try {
      await onMoveToNextMonitor();
      // Refresh current monitor after move
      setTimeout(loadCurrentMonitor, 300);
    } catch (error) {
      console.error('Failed to move to next monitor:', error);
    }
  };

  const positionButtons = [
    { position: 'top-left', icon: CornerUpLeft, label: 'Top Left', gridArea: 'a' },
    { position: 'center', icon: Square, label: 'Center', gridArea: 'b' },
    { position: 'top-right', icon: CornerUpRight, label: 'Top Right', gridArea: 'c' },
    { position: 'bottom-left', icon: CornerDownLeft, label: 'Bottom Left', gridArea: 'd' },
    { position: 'bottom-right', icon: CornerDownRight, label: 'Bottom Right', gridArea: 'e' }
  ];

  return (
    <div className={`space-y-4 ${className}`}>
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">
          Window Position
        </h3>
        {monitors.length > 1 && (
          <button
            onClick={handleNextMonitor}
            className="flex items-center gap-2 px-3 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2"
            title="Move to next monitor"
          >
            <RotateCcw className="w-4 h-4" />
            <span className="text-sm">Next Monitor</span>
          </button>
        )}
      </div>

      {currentMonitor && (
        <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
          <div className="flex items-center gap-2 mb-2">
            <Monitor className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            <span className="text-sm font-medium text-blue-800 dark:text-blue-200">
              Current Monitor: {currentMonitor.name}
            </span>
            {currentMonitor.isPrimary && (
              <span className="px-2 py-0.5 text-xs bg-blue-200 dark:bg-blue-800 text-blue-800 dark:text-blue-200 rounded">
                Primary
              </span>
            )}
          </div>
          <div className="text-xs text-blue-600 dark:text-blue-400">
            Resolution: {currentMonitor.bounds.width}×{currentMonitor.bounds.height}
            {currentMonitor.scaleFactor !== 1 && (
              <span className="ml-2">
                Scale: {Math.round(currentMonitor.scaleFactor * 100)}%
              </span>
            )}
          </div>
        </div>
      )}

      {/* Position Grid */}
      <div className="bg-gray-100 dark:bg-gray-700 rounded-lg p-4">
        <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
          Quick Positions
        </div>
        
        {/* 3x2 Grid Layout */}
        <div 
          className="grid gap-2 max-w-xs mx-auto"
          style={{
            gridTemplateColumns: 'repeat(3, 1fr)',
            gridTemplateRows: 'repeat(2, 1fr)',
            gridTemplateAreas: '"a b c" "d b e"'
          }}
        >
          {positionButtons.map(({ position, icon: Icon, label, gridArea }) => (
            <button
              key={position}
              onClick={() => handlePositionClick(position)}
              className="flex flex-col items-center justify-center p-3 bg-white dark:bg-gray-600 hover:bg-gray-50 dark:hover:bg-gray-500 rounded-lg border border-gray-200 dark:border-gray-500 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              style={{ gridArea }}
              title={`Move window to ${label.toLowerCase()}`}
              aria-label={`Move window to ${label.toLowerCase()}`}
            >
              <Icon className="w-5 h-5 text-gray-600 dark:text-gray-300 mb-1" />
              <span className="text-xs text-gray-600 dark:text-gray-300 text-center">
                {label}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Monitor Info */}
      {monitors.length > 1 && (
        <div className="text-xs text-gray-500 dark:text-gray-400 text-center">
          {monitors.length} monitors detected • Use "Next Monitor" to cycle between them
        </div>
      )}
    </div>
  );
};

export default PositionControls;

