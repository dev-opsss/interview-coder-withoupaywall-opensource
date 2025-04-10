import React from 'react';
import { useVoiceTranscription } from '../hooks/useVoiceTranscription';

interface VoiceRecorderProps {
  onTranscription: (text: string) => void;
  autoPrompt?: boolean;
  className?: string;
}

export const VoiceRecorder: React.FC<VoiceRecorderProps> = ({
  onTranscription,
  autoPrompt = false,
  className = ''
}) => {
  const {
    isRecording,
    status,
    error,
    startRecording,
    stopRecording,
    transcribeAudio
  } = useVoiceTranscription({
    autoPrompt,
    onTranscriptionComplete: (text) => {
      onTranscription(text);
    }
  });

  const handleToggleRecording = async () => {
    if (isRecording) {
      await stopRecording();
      if (!autoPrompt) {
        // Show transcribe button
      }
    } else {
      await startRecording();
    }
  };

  return (
    <div className={`flex items-center ${className}`}>
      {error && (
        <div className="text-red-500 text-xs mr-2">{error}</div>
      )}
      
      <button
        onClick={handleToggleRecording}
        className={`p-2 rounded-full transition-colors ${
          isRecording 
            ? 'bg-red-500 hover:bg-red-600' 
            : 'bg-gray-700 hover:bg-gray-600'
        }`}
        title={isRecording ? "Stop recording" : "Start voice recording"}
      >
        {isRecording ? (
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-white" viewBox="0 0 20 20" fill="currentColor">
            <rect x="6" y="6" width="8" height="8" />
          </svg>
        ) : (
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-white" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z" clipRule="evenodd" />
          </svg>
        )}
      </button>
      
      {status === 'processing' && (
        <div className="ml-2 text-gray-400 text-sm flex items-center">
          <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          Processing...
        </div>
      )}
      
      {!autoPrompt && status === 'idle' && !isRecording && (
        <button
          onClick={transcribeAudio}
          className="ml-2 px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded"
        >
          Transcribe
        </button>
      )}
    </div>
  );
};