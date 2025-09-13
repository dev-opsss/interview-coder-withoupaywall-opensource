import React, { useState, useEffect } from 'react';
import { Save, Trash2, Play, Plus, Monitor } from 'lucide-react';

interface WindowPositionPreset {
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

interface WindowPresetsProps {
  className?: string;
}

const WindowPresets: React.FC<WindowPresetsProps> = ({ className = '' }) => {
  const [presets, setPresets] = useState<WindowPositionPreset[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newPresetName, setNewPresetName] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  useEffect(() => {
    loadPresets();
  }, []);

  const loadPresets = async () => {
    try {
      const presetList = await window.electronAPI.invoke('get-window-presets');
      setPresets(presetList || []);
    } catch (error) {
      console.error('Failed to load presets:', error);
      setPresets([]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleApplyPreset = async (presetId: string) => {
    try {
      const result = await window.electronAPI.invoke('apply-window-preset', presetId);
      if (!result.success) {
        console.error('Failed to apply preset:', result.error);
      }
    } catch (error) {
      console.error('Failed to apply preset:', error);
    }
  };

  const handleCreatePreset = async () => {
    if (!newPresetName.trim()) return;

    setIsCreating(true);
    try {
      const result = await window.electronAPI.invoke('create-window-preset', newPresetName.trim());
      if (result.success) {
        setNewPresetName('');
        setShowCreateDialog(false);
        await loadPresets(); // Refresh the list
      } else {
        console.error('Failed to create preset:', result.error);
      }
    } catch (error) {
      console.error('Failed to create preset:', error);
    } finally {
      setIsCreating(false);
    }
  };

  const handleDeletePreset = async (presetId: string) => {
    if (!confirm('Are you sure you want to delete this preset?')) return;

    try {
      const result = await window.electronAPI.invoke('remove-window-preset', presetId);
      if (result.success) {
        await loadPresets(); // Refresh the list
      } else {
        console.error('Failed to delete preset:', result.error);
      }
    } catch (error) {
      console.error('Failed to delete preset:', error);
    }
  };

  const getPositionLabel = (relativePosition: string): string => {
    const labels: { [key: string]: string } = {
      'top-left': 'Top Left',
      'top-right': 'Top Right',
      'bottom-left': 'Bottom Left',
      'bottom-right': 'Bottom Right',
      'center': 'Center',
      'custom': 'Custom Position'
    };
    return labels[relativePosition] || relativePosition;
  };

  if (isLoading) {
    return (
      <div className={`flex items-center justify-center p-4 ${className}`}>
        <div className="w-6 h-6 border-2 border-gray-300 border-t-blue-600 rounded-full animate-spin"></div>
        <span className="ml-2 text-sm text-gray-600">Loading presets...</span>
      </div>
    );
  }

  return (
    <div className={`space-y-4 ${className}`}>
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">Window Presets</h3>
        <button
          onClick={() => setShowCreateDialog(true)}
          className="flex items-center gap-2 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        >
          <Plus className="w-4 h-4" />
          <span className="text-sm">Create Preset</span>
        </button>
      </div>

      {/* Create Preset Dialog */}
      {showCreateDialog && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 w-full max-w-md mx-4">
            <h4 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-4">
              Create Window Preset
            </h4>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              This will save the current window position and size as a preset.
            </p>
            <input
              type="text"
              value={newPresetName}
              onChange={(e) => setNewPresetName(e.target.value)}
              placeholder="Enter preset name"
              className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreatePreset();
                if (e.key === 'Escape') setShowCreateDialog(false);
              }}
              autoFocus
            />
            <div className="flex gap-2 mt-4">
              <button
                onClick={handleCreatePreset}
                disabled={!newPresetName.trim() || isCreating}
                className="flex-1 px-3 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
              >
                {isCreating ? (
                  <div className="flex items-center justify-center gap-2">
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    Creating...
                  </div>
                ) : (
                  'Create'
                )}
              </button>
              <button
                onClick={() => {
                  setShowCreateDialog(false);
                  setNewPresetName('');
                }}
                className="px-3 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-600 dark:hover:bg-gray-500 text-gray-800 dark:text-gray-200 rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Presets List */}
      {presets.length === 0 ? (
        <div className="text-center py-8">
          <Monitor className="w-12 h-12 text-gray-400 mx-auto mb-3" />
          <p className="text-sm text-gray-600 dark:text-gray-400">
            No window presets created yet.
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">
            Create a preset to quickly restore window positions.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {presets.map((preset) => (
            <div
              key={preset.id}
              className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-700 rounded-lg border border-gray-200 dark:border-gray-600"
            >
              <div className="flex-1 min-w-0">
                <div className="font-medium text-gray-900 dark:text-gray-100 truncate">
                  {preset.name}
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  {getPositionLabel(preset.relativePosition)} • {preset.position.width}×{preset.position.height}
                </div>
              </div>
              
              <div className="flex items-center gap-1">
                <button
                  onClick={() => handleApplyPreset(preset.id)}
                  className="p-2 text-blue-600 hover:bg-blue-100 dark:hover:bg-blue-900/20 rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500"
                  title="Apply preset"
                  aria-label={`Apply preset ${preset.name}`}
                >
                  <Play className="w-4 h-4" />
                </button>
                
                <button
                  onClick={() => handleDeletePreset(preset.id)}
                  className="p-2 text-red-600 hover:bg-red-100 dark:hover:bg-red-900/20 rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-red-500"
                  title="Delete preset"
                  aria-label={`Delete preset ${preset.name}`}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default WindowPresets;

