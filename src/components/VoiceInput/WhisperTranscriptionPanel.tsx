import React, { memo } from 'react';
import { useWhisperTranscription, getStatusMessage } from '../../hooks/useWhisperTranscription';

// Interface for the component props
export interface WhisperTranscriptionPanelProps {
  status: ReturnType<typeof useWhisperTranscription>['status'];
  errorMessage: ReturnType<typeof useWhisperTranscription>['errorMessage'];
  transcription: ReturnType<typeof useWhisperTranscription>['transcription'];
  progress: ReturnType<typeof useWhisperTranscription>['progress'];
  loadMicAndPipeline: ReturnType<typeof useWhisperTranscription>['loadMicAndPipeline'];
  startMicrophone: ReturnType<typeof useWhisperTranscription>['startMicrophone'];
  stopMicrophone: ReturnType<typeof useWhisperTranscription>['stopMicrophone'];
}

// Component definition
export const WhisperTranscriptionPanel = memo(({
  status,
  errorMessage,
  transcription,
  progress,
  loadMicAndPipeline,
  startMicrophone,
  stopMicrophone
}: WhisperTranscriptionPanelProps) => {
  const isLoading = status === 'loadingLib' || status === 'loadingModel';
  const isListening = status === 'listening' || status === 'transcribing' || status === 'startingMic';
  const canStart = status === 'ready' && !isListening && !isLoading; 

  return (
    <div style={{ 
      border: '1px solid #ccc', 
      padding: '12px', 
      borderRadius: '8px', 
      backgroundColor: '#f9f9f9',
      boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)'
    }}>
      <div className="flex justify-between items-center mb-2">
        <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 'bold' }}>Voice Transcription</h3>
        {isListening && (
          <button 
            onClick={() => stopMicrophone()} 
            style={{ 
              backgroundColor: '#ef4444', 
              color: 'white', 
              border: 'none', 
              padding: '4px 8px', 
              borderRadius: '4px',
              fontSize: '12px'
            }}
          >
            Stop
          </button>
        )}
      </div>
      
      {!isListening && (
        <div style={{ marginBottom: '10px' }}>
          <button onClick={() => loadMicAndPipeline()} disabled={isLoading || status === 'ready' || isListening}>
            {status === 'ready' || isListening ? 'Model Loaded' : isLoading ? `Loading... (${progress.toFixed(1)}%)` : 'Load Model'}
          </button>
          <button onClick={() => startMicrophone()} disabled={!canStart} style={{ marginLeft: '8px' }}>
            Start Microphone
          </button>
        </div>
      )}
      
      {errorMessage && <p style={{ color: 'red', margin: '5px 0', fontSize: '12px' }}>Error: {errorMessage}</p>}
      
      <div style={{ marginTop: '8px', border: '1px solid #eee', padding: '8px', minHeight: '40px', maxHeight: '120px', overflowY: 'auto', background: '#fff', borderRadius: '4px' }}>
        {transcription ? transcription : <span style={{ color: '#888', fontStyle: 'italic', fontSize: '13px' }}>Listening... Speak now</span>}
      </div>
    </div>
  );
}); 