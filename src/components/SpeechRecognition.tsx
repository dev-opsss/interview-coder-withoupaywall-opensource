import React, { useState, useEffect, useCallback, useRef } from 'react';
import { AudioCaptureHelper } from './AudioCaptureHelper';
import './SpeechRecognition.css';
import { useSmartVoiceDetection } from '../hooks/useSmartVoiceDetection';
import { ipcRenderer } from 'electron'; // Import ipcRenderer

// Interface definitions for communication with main process
interface SpeechBridgeApi {
  startRecording: () => void;
  stopRecording: () => void;
  pauseRecording: () => void;
}

// Type definitions for component props
interface SpeechRecognitionProps {
  onTranscription?: (text: string, isFinal: boolean) => void;
  onError?: (message: string) => void;
  language?: string;
  autoStart?: boolean;
  maxDuration?: number; // Max recording time in seconds
}

// Fallback message for when Electron IPC is not available
const ELECTRON_UNAVAILABLE = 'Speech recognition requires Electron environment.';

/**
 * SpeechRecognition component provides UI and functionality for 
 * recording and transcribing speech using Google Speech API via Electron IPC.
 */
const SpeechRecognition: React.FC<SpeechRecognitionProps> = ({ 
  onTranscription, 
  onError, 
  language = 'en-US',
  autoStart = false,
  maxDuration = 300 // 5 minutes default
}) => {
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [committedTranscript, setCommittedTranscript] = useState<string>('');
  const [liveInterimTranscript, setLiveInterimTranscript] = useState<string>('');
  const [isBrowserEnv, setIsBrowserEnv] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const recordingTimeout = useRef<number | null>(null);
  const audioCaptureHelper = useRef<AudioCaptureHelper | null>(null);
  const [selectedMic, setSelectedMic] = useState<string | null>(null);
  const [selectedSpeaker, setSelectedSpeaker] = useState<string | null>(null);
  const [micDevices, setMicDevices] = useState<MediaDeviceInfo[]>([]);
  const [speakerDevices, setSpeakerDevices] = useState<MediaDeviceInfo[]>([]);

  // --- IPC Channel Constants (match SpeechBridge/GoogleSpeechService) ---
  const IPC_TRANSCRIPT_UPDATE = 'speech:transcript-update';
  const IPC_STREAM_ERROR = 'speech:stream-error';

  // --- Define Callbacks BEFORE using them in the hook --- 
  const handleSpeechStart = useCallback((speakerRole: 'user' | 'interviewer') => {
    console.log(`${speakerRole} started speaking`);
    setError(null); // Clear previous errors on new speech start
  }, []);

  // REMOVED: handleSpeechEnd no longer sends blob

  // Initialize VAD hook (NOW uses defined handleSpeechStart)
  const { startListening, stopListening, isListening, isSpeaking } = useSmartVoiceDetection({
    microphoneDeviceId: selectedMic,
    speakerDeviceId: selectedSpeaker,
    onSpeechStart: handleSpeechStart,
    // onSpeechEnd is no longer needed here
  });

  // Check if we're in the Electron environment
  useEffect(() => {
    const isElectron = window.electron !== undefined;
    setIsBrowserEnv(!isElectron);
    
    if (!isElectron && onError) {
      onError(ELECTRON_UNAVAILABLE);
      setError(ELECTRON_UNAVAILABLE);
    }
    
    // Create audio capture helper
    if (isElectron && !audioCaptureHelper.current) {
      audioCaptureHelper.current = new AudioCaptureHelper();
    }
    
    // Setup IPC listeners for transcription results
    if (isElectron) {
      // Listen for transcription results from the main process
      window.electron?.on('speech:transcription', (text: string, isFinal: boolean) => {
        setCommittedTranscript(prevText => isFinal ? text : prevText + ' ' + text);
        
        if (onTranscription) {
          onTranscription(text, isFinal);
        }
      });
      
      // Listen for errors
      window.electron?.on('speech:error', (error: string) => {
        setError(error);
        if (onError) {
          onError(error);
        }
      });
    }
    
    return () => {
      // Clean up listeners
      if (window.electron) {
        window.electron?.removeAllListeners('speech:transcription');
        window.electron?.removeAllListeners('speech:error');
      }
      
      // Stop any ongoing recording on component unmount
      if (isRecording) {
        handleStopRecording();
      }
      
      // Clean up audio capture
      if (audioCaptureHelper.current) {
        audioCaptureHelper.current.stopCapturing();
        audioCaptureHelper.current = null;
      }
      
      // Clear any timeout
      if (recordingTimeout.current) {
        window.clearTimeout(recordingTimeout.current);
      }
    };
  }, [onTranscription, onError, isRecording]);
  
  // Handle auto-start if enabled
  useEffect(() => {
    if (autoStart && !isBrowserEnv && !isRecording) {
      handleStartRecording();
    }
  }, [autoStart, isBrowserEnv]);
  
  // Function to start recording
  const handleStartRecording = useCallback(async () => {
    if (isBrowserEnv) {
      setError(ELECTRON_UNAVAILABLE);
      return;
    }
    
    try {
      // Clear any previous transcript
      setCommittedTranscript('');
      setLiveInterimTranscript('');
      setError(null);
      
      // Send start recording command to main process
      (window.electron as any).send('speech:start', { language });
      
      // Start capturing audio
      if (audioCaptureHelper.current) {
        try {
          await audioCaptureHelper.current.startCapturing();
        } catch (captureError) {
          throw new Error(`Microphone access error: ${captureError}`);
        }
      }
      
      setIsRecording(true);
      setIsPaused(false);
      
      // Set a timeout to stop recording after maxDuration
      if (maxDuration && maxDuration > 0) {
        if (recordingTimeout.current) {
          window.clearTimeout(recordingTimeout.current);
        }
        
        recordingTimeout.current = window.setTimeout(() => {
          handleStopRecording();
        }, maxDuration * 1000);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      setError(errorMsg);
      if (onError) onError(errorMsg);
    }
  }, [isBrowserEnv, language, maxDuration, onError]);
  
  // Function to stop recording
  const handleStopRecording = useCallback(() => {
    if (isBrowserEnv) return;
    
    try {
      // Send stop recording command to main process
      (window.electron as any).send('speech:stop');
      
      // Stop capturing audio
      if (audioCaptureHelper.current) {
        audioCaptureHelper.current.stopCapturing();
      }
      
      setIsRecording(false);
      setIsPaused(false);
      
      // Clear timeout if exists
      if (recordingTimeout.current) {
        window.clearTimeout(recordingTimeout.current);
        recordingTimeout.current = null;
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      setError(errorMsg);
      if (onError) onError(errorMsg);
    }
  }, [isBrowserEnv, onError]);
  
  // Function to pause/resume recording
  const handlePauseRecording = useCallback(() => {
    if (isBrowserEnv || !isRecording) return;
    
    try {
      if (isPaused) {
        // Resume recording
        (window.electron as any).send('speech:resume');
        setIsPaused(false);
      } else {
        // Pause recording
        (window.electron as any).send('speech:pause');
        setIsPaused(true);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      setError(errorMsg);
      if (onError) onError(errorMsg);
    }
  }, [isBrowserEnv, isRecording, isPaused, onError]);
  
  // Function to clear transcript
  const handleClearTranscript = useCallback(() => {
    setCommittedTranscript('');
    setLiveInterimTranscript('');
  }, []);

  // Effect to fetch audio devices
  useEffect(() => {
    const getDevices = async () => {
      try {
        // Request permission first (needed for device enumeration)
        await navigator.mediaDevices.getUserMedia({ audio: true });
        const devices = await navigator.mediaDevices.enumerateDevices();
        setMicDevices(devices.filter(d => d.kind === 'audioinput'));
        setSpeakerDevices(devices.filter(d => d.kind === 'audiooutput'));
        // Set default devices if not already set
        if (!selectedMic && micDevices.length > 0) {
            setSelectedMic(micDevices.find(d => d.deviceId === 'default')?.deviceId || micDevices[0].deviceId);
        }
        if (!selectedSpeaker && speakerDevices.length > 0) {
            setSelectedSpeaker(speakerDevices.find(d => d.deviceId === 'default')?.deviceId || speakerDevices[0].deviceId);
        }
      } catch (err: any) { // Catch specific error types if needed
        console.error('Error fetching media devices:', err);
        setError(`Error accessing audio devices: ${err.message || err}. Please grant permissions.`);
      }
    };
    getDevices();
  }, []); // Run once on mount

  // --- Effect to handle IPC messages for transcription --- 
  useEffect(() => {
    const handleTranscriptUpdate = (
      event: Electron.IpcRendererEvent,
      data: { transcript: string; isFinal: boolean }
    ) => {
      console.log('IPC transcript update in SpeechRecognition.tsx:', data); // Added component name for clarity
      // MODIFIED LOGIC: Properly handle final and interim transcripts
      if (data.isFinal) {
        // Append the final transcript to the committed string.
        // Add a space if there's existing committed text.
        setCommittedTranscript(prev => prev + (prev ? ' ' : '') + data.transcript);
        setLiveInterimTranscript(''); // Clear interim part as this utterance is now final
      } else {
        // Interim result: this is the current best guess for the ongoing utterance.
        // It typically replaces the previous interim result for this utterance.
        setLiveInterimTranscript(data.transcript);
      }
    };

    const handleStreamError = (
        event: Electron.IpcRendererEvent,
        errorData: { code: number | string; message: string }
      ) => {
        console.error('IPC stream error:', errorData);
        setError(`Transcription Error (${errorData.code}): ${errorData.message}`);
        // Optionally stop recording or show a specific UI state
        stopListening(); // Stop VAD if the stream errored
        setIsRecording(false);
      };

    // Register listeners
    ipcRenderer.on(IPC_TRANSCRIPT_UPDATE, handleTranscriptUpdate);
    ipcRenderer.on(IPC_STREAM_ERROR, handleStreamError);

    // Cleanup function
    return () => {
      ipcRenderer.removeListener(IPC_TRANSCRIPT_UPDATE, handleTranscriptUpdate);
      ipcRenderer.removeListener(IPC_STREAM_ERROR, handleStreamError);
    };
  }, [stopListening]); // Add stopListening as dependency

  // Toggle recording state
  const toggleRecording = () => {
    if (isListening) {
      stopListening();
      setIsRecording(false);
      // MODIFIED: Clear new transcript states on stop
      setCommittedTranscript('');
      setLiveInterimTranscript('');
      setError(null); // Clear errors on stop
    } else {
      if (selectedMic && selectedSpeaker) {
        startListening();
        setIsRecording(true);
        // MODIFIED: Clear new transcript states on start
        setCommittedTranscript('');
        setLiveInterimTranscript('');
        setError(null);
      } else {
          setError('Please select both a microphone and speaker device.');
      }
    }
  };

  return (
    <div className="speech-recognition">
      <div className="controls">
        <button 
          className="start-button" 
          onClick={toggleRecording}
          disabled={isRecording || isBrowserEnv}
        >
          {isListening ? 'Stop Recording' : 'Start Recording'}
        </button>
        
        <button 
          className="clear-button" 
          onClick={handleClearTranscript}
          disabled={committedTranscript.length === 0 && liveInterimTranscript.length === 0}
        >
          Clear
        </button>
      </div>
      
      {error && (
        <div className="error-message">{error}</div>
      )}
      
      <div className="status-indicator">
        {isRecording && !isPaused && (
          <span className="recording-indicator">Recording...</span>
        )}
        {isRecording && isPaused && (
          <span className="paused-indicator">Paused</span>
        )}
      </div>
      
      <div className="device-selector">
        <label>
          Microphone:
          <select 
             value={selectedMic || ''} 
             onChange={e => setSelectedMic(e.target.value)} 
             disabled={isListening}
           >
            {micDevices.map(device => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label || `Mic ${micDevices.indexOf(device) + 1}`}
              </option>
            ))}
          </select>
        </label>
        <label>
          Speaker (Output for VAD): 
          <select 
             value={selectedSpeaker || ''} 
             onChange={e => setSelectedSpeaker(e.target.value)} 
             disabled={isListening}
          >
            {speakerDevices.map(device => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label || `Speaker ${speakerDevices.indexOf(device) + 1}`}
              </option>
            ))}
          </select>
        </label>
      </div>
      
      <div className="status">
        Status: {isListening ? (isSpeaking ? 'Speaking...' : 'Listening...') : 'Idle'}
      </div>
      
      <div className="transcript-container">
        <h3>Transcript</h3>
        <div className="transcript">
          {(committedTranscript + (liveInterimTranscript ? (committedTranscript ? ' ' : '') + liveInterimTranscript : '')).trim() || <span className="placeholder">Transcription will appear here...</span>}
        </div>
      </div>
    </div>
  );
};

export default SpeechRecognition; 