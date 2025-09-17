import React, { useState } from 'react';
import { Monitor, X } from 'lucide-react';
import MultiMonitorDebug from './MultiMonitorDebug';

const MultiMonitorDebugDialog: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);

  // Listen for Cmd+Shift+M (Mac) or Ctrl+Shift+M (Windows/Linux) to open debug panel
  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key === 'M') {
        event.preventDefault();
        setIsOpen(true);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="relative max-w-3xl w-full mx-4">
        <div className="absolute top-2 right-2 z-10">
          <button
            onClick={() => setIsOpen(false)}
            className="p-1 bg-gray-800 hover:bg-gray-700 rounded-full text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <MultiMonitorDebug />
        <div className="mt-2 text-center">
          <div className="text-xs text-gray-400 bg-gray-800 rounded px-2 py-1 inline-block">
            Press <kbd className="bg-gray-700 px-1 rounded">⌘⇧M</kbd> (Mac) or <kbd className="bg-gray-700 px-1 rounded">Ctrl⇧M</kbd> (Windows) to open this debug panel
          </div>
        </div>
      </div>
    </div>
  );
};

export default MultiMonitorDebugDialog;
