import React, { useEffect, useRef } from 'react';

interface TranscriptionDisplayProps {
  isActive: boolean;
  currentTranscript: string;
  finalTranscript: string;
  isProcessingAI: boolean;
  isSpeaking?: boolean;
}

export const TranscriptionDisplay: React.FC<TranscriptionDisplayProps> = ({
  isActive,
  currentTranscript,
  finalTranscript,
  isProcessingAI,
  isSpeaking = false
}) => {
  const currentRef = useRef<HTMLDivElement>(null);
  const finalRef = useRef<HTMLDivElement>(null);

  // Auto-scroll when content changes
  useEffect(() => {
    if (currentRef.current) {
      currentRef.current.scrollTop = currentRef.current.scrollHeight;
    }
  }, [currentTranscript]);
  
  useEffect(() => {
    if (finalRef.current) {
      finalRef.current.scrollTop = finalRef.current.scrollHeight;
    }
  }, [finalTranscript]);

  if (!isActive && !finalTranscript) {
    return null;
  }

  return (
    <div className="fixed left-1/2 transform -translate-x-1/2 bottom-20 w-3/4 max-w-3xl shadow-lg rounded-lg overflow-hidden bg-white bg-opacity-95 border border-gray-200">
      {/* Live transcription */}
      {isActive && (
        <div className="p-3 border-b border-gray-200">
          <div className="flex items-center mb-1">
            <div 
              className={`w-2 h-2 rounded-full mr-2 ${
                isSpeaking 
                  ? 'bg-green-500 animate-pulse' 
                  : currentTranscript 
                    ? 'bg-yellow-500'
                    : 'bg-gray-300'
              }`}
            ></div>
            <h3 className="text-sm font-semibold text-gray-700">
              {isSpeaking 
                ? "Listening..." 
                : currentTranscript 
                  ? "Paused..." 
                  : "Waiting for speech..."}
            </h3>
          </div>
          <div 
            ref={currentRef}
            className="max-h-20 overflow-y-auto text-gray-800 text-sm"
          >
            {currentTranscript || <span className="text-gray-400 italic">Waiting for speech...</span>}
          </div>
        </div>
      )}
      
      {/* Final transcript */}
      {finalTranscript && (
        <div className="p-3">
          <div className="flex items-center mb-1">
            <div className={`w-2 h-2 rounded-full mr-2 ${isProcessingAI ? 'bg-blue-500 animate-pulse' : 'bg-blue-500'}`}></div>
            <h3 className="text-sm font-semibold text-gray-700">
              {isProcessingAI ? "Processing..." : "Transcription"}
            </h3>
          </div>
          <div 
            ref={finalRef}
            className="max-h-40 overflow-y-auto text-gray-800 text-sm"
          >
            {finalTranscript}
          </div>
        </div>
      )}
    </div>
  );
}; 