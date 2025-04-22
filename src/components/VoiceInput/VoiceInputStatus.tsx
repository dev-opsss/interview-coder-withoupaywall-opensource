import React from 'react';
import { Mic, MicOff, Loader2 } from 'lucide-react';

interface VoiceInputStatusProps {
  isActive: boolean;
  isProcessing: boolean;
  isSpeaking?: boolean;
  onClick: () => void;
}

export const VoiceInputStatus: React.FC<VoiceInputStatusProps> = ({ 
  isActive, 
  isProcessing,
  isSpeaking = false,
  onClick
}) => {
  // Get the correct modifier key based on platform
  const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
  const modifierKey = isMac ? '⌘' : 'Ctrl';
  
  return (
    <div className="fixed bottom-4 right-4 flex flex-col items-end z-20">
      {/* Keyboard shortcut hint */}
      <div className="mb-2 text-xs bg-black bg-opacity-60 text-white px-2 py-1 rounded">
        {modifierKey}+Shift+V
      </div>
      
      {/* Voice input button */}
      <div 
        className={`flex items-center justify-center p-3 rounded-full cursor-pointer transition-colors shadow-lg ${
          isActive 
            ? isSpeaking
              ? 'bg-green-500 hover:bg-green-600' 
              : 'bg-red-500 hover:bg-red-600'
            : 'bg-indigo-500 hover:bg-indigo-600'
        }`}
        onClick={onClick}
        title={
          isActive 
            ? isSpeaking 
              ? "Currently listening..."
              : "Stop voice input" 
            : "Start voice input"
        }
      >
        {/* Pulse animation when speaking */}
        {isActive && isSpeaking && (
          <span className="absolute w-full h-full rounded-full bg-green-400 opacity-75 animate-ping"></span>
        )}
        
        {isProcessing ? (
          <Loader2 className="h-6 w-6 text-white animate-spin" />
        ) : isActive ? (
          isSpeaking ? (
            <Mic className="h-6 w-6 text-white" />
          ) : (
            <MicOff className="h-6 w-6 text-white" />
          )
        ) : (
          <Mic className="h-6 w-6 text-white" />
        )}
      </div>
    </div>
  );
}; 