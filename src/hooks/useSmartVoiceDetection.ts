import { useState, useRef, useEffect, useCallback } from 'react';
// --- NEW: Import MicVAD and related types ---
import { MicVAD, utils } from '@ricky0123/vad-web';
// --- Attempt to import ort directly for wasmPaths, or check if utils exposes it ---
// @ts-ignore - Suppress TS error about missing declaration file resolved via exports
import ort from 'onnxruntime-web'; // Added direct import for ort
// --- NEW: Import ipcRenderer for communication --- 
// import { ipcRenderer } from 'electron'; // <-- REMOVE direct import

// Remove old VAD imports and types
/*
import VAD from 'voice-activity-detection';
// ... (old VAD interfaces) ...
const vadCreateFunction = ...;
const vadModule = ...;
*/

// Silence thresholds for speech detection
const SILENCE_DURATION_THRESHOLD = 2000; // 2 seconds of silence to trigger suggestion
const MIN_SPEECH_DURATION = 1000; // Minimum speech duration to consider valid input (1 second)
// const VAD_THRESHOLD = 0.75; // Removed - new library uses different config

interface UseSmartVoiceDetectionOptions {
  speakerDeviceId?: string | null;
  microphoneDeviceId?: string | null;
  selectedLanguage?: string;
  onSpeechStart?: (speakerRole: 'user' | 'interviewer') => void;
  onSpeechEnd?: (audioBlob: Blob, speakerRole: 'user' | 'interviewer') => void;
  onSilenceAfterSpeech?: (audioBlob: Blob, speakerRole: 'user' | 'interviewer') => void;
  silenceDuration?: number;
  // vadThreshold?: number; // Removed
  autoSuggest?: boolean;
}

// --- NEW: IPC Channel Constants (match SpeechBridge) --- 
const IPC_CHANNELS = {
  START: 'speech:start', // Matches SpeechBridge
  STOP: 'speech:stop',   // Matches SpeechBridge
  AUDIO_DATA: 'speech:audio-data' // Matches GoogleSpeechService listener
};

// --- NEW: Type for stream command state ---
type StreamCommand = 'start' | 'stop' | 'idle';

// --- NEW: Configure ONNX Runtime WASM paths ---
// This should be set before any VAD initialization that uses ONNX Runtime.
// Using a CDN for testing; for production Electron, copy assets locally and use file paths.
if (ort && ort.env && ort.env.wasm) {
  ort.env.wasm.wasmPaths = 'https://unpkg.com/onnxruntime-web@latest/dist/';
  // For @ricky0123/vad-web, the model silero_vad.onnx also needs to be accessible.
  // MicVAD.new has options like `modelURL` and `workletURL` if those also need explicit paths.
  console.log('Set ONNX Runtime WASM paths to CDN for testing.');
} else {
  console.warn('Could not set ONNX Runtime WASM paths. ort object or env.wasm not available.');
}
// --- END: Configure ONNX Runtime WASM paths ---

/**
 * Hook to provide smart voice detection with automatic suggestion generation
 * Manages separate streams for user microphone and speaker output (virtual device)
 * Uses @ricky0123/vad-web
 */
export function useSmartVoiceDetection({
  speakerDeviceId = null,
  microphoneDeviceId = null,
  selectedLanguage = 'en-US',
  onSpeechStart,
  onSpeechEnd,
  onSilenceAfterSpeech,
  silenceDuration = SILENCE_DURATION_THRESHOLD,
  // vadThreshold = VAD_THRESHOLD, // Removed
  autoSuggest = true
}: UseSmartVoiceDetectionOptions = {}) {
  // State variables
  const [isListening, setIsListening] = useState(false);
  const [isUserSpeaking, setIsUserSpeaking] = useState(false);
  const [isSpeakerSpeaking, setIsSpeakerSpeaking] = useState(false);
  const [googleStreamCommand, setGoogleStreamCommand] = useState<StreamCommand>('idle'); // <-- NEW STATE

  // Refs to manage audio resources for both streams
  const userStreamRef = useRef<MediaStream | null>(null);
  const userVadRef = useRef<MicVAD | null>(null); // <-- Changed type to MicVAD
  const userMediaRecorderRef = useRef<MediaRecorder | null>(null);
  const userAudioChunksRef = useRef<Blob[]>([]);

  const speakerStreamRef = useRef<MediaStream | null>(null);
  const speakerVadRef = useRef<MicVAD | null>(null); // <-- Changed type to MicVAD
  const speakerMediaRecorderRef = useRef<MediaRecorder | null>(null);
  const speakerAudioChunksRef = useRef<Blob[]>([]);

  // Timing refs
  const speechStartTimeRef = useRef<Record<string, number | null>>({ user: null, speaker: null });
  const lastSpeechEndTimeRef = useRef<Record<string, number | null>>({ user: null, speaker: null });
  const silenceTimeoutRef = useRef<Record<string, NodeJS.Timeout | null>>({ user: null, speaker: null });

  // Combined speaking state for external use
  const isSpeaking = isUserSpeaking || isSpeakerSpeaking;

  // Refs for callbacks and speaking state checks
  const isUserSpeakingRef = useRef(false);
  const isSpeakerSpeakingRef = useRef(false);
  const optionsRef = useRef({ onSpeechStart, onSpeechEnd, onSilenceAfterSpeech, autoSuggest, silenceDuration });

  // --- NEW: Arbitration Refs ---
  const arbitrationTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isArbitratingRef = useRef<boolean>(false);
  const pendingSpeechStartRoleRef = useRef<'user' | 'interviewer' | null>(null);
  // --- END: Arbitration Refs ---
  
  // Ref to track current audio levels to determine true speaker
  const audioLevelsRef = useRef<{user: number, interviewer: number}>({user: 0, interviewer: 0});
  const lastActiveSpeakerRef = useRef<'user' | 'interviewer' | null>(null);
  // New: hard lock of which role is currently allowed to stream frames into STT
  const activeRoleRef = useRef<'user' | 'interviewer' | null>(null);
  // New: track whether we've already started the Google stream to avoid redundant start commands
  const hasStartedStreamRef = useRef<boolean>(false);
  
  // Function to determine which speaker is truly active based on audio levels
  const determineActiveSpeaker = useCallback(() => {
    const {user, interviewer} = audioLevelsRef.current;
    console.log(`Audio levels - User: ${user.toFixed(4)}, Interviewer: ${interviewer.toFixed(4)}`);
    
    // Use a ratio and absolute thresholds to determine which speaker is active
    const ratio = Math.max(user, 0.0001) / Math.max(interviewer, 0.0001);
    const MIN_AUDIO_LEVEL = 0.005; // Minimum level to consider as actual speech
    const SIGNIFICANT_RATIO_USER = 10.0; // User needs to be 10x louder
    const SIGNIFICANT_RATIO_INTERVIEWER = 0.1; // Interviewer needs to be 10x louder (1/10)
    
    // If neither has significant audio, keep the last active speaker
    if (user < MIN_AUDIO_LEVEL && interviewer < MIN_AUDIO_LEVEL) {
      console.log(`Neither input has significant audio levels, keeping last active speaker: ${lastActiveSpeakerRef.current || 'none'}`);
      return lastActiveSpeakerRef.current || 'user';
    }
    
    // If user has much louder audio
    if (ratio > SIGNIFICANT_RATIO_USER && user > MIN_AUDIO_LEVEL) {
      console.log(`User audio is significantly louder (ratio: ${ratio.toFixed(2)}), setting active speaker to user`);
      return 'user';
    } 
    // If interviewer has much louder audio
    else if (ratio < SIGNIFICANT_RATIO_INTERVIEWER && interviewer > MIN_AUDIO_LEVEL) {
      console.log(`Interviewer audio is significantly louder (ratio: ${ratio.toFixed(2)}), setting active speaker to interviewer`);
      return 'interviewer';
    } 
    // If levels are similar but above threshold
    else if (user > MIN_AUDIO_LEVEL || interviewer > MIN_AUDIO_LEVEL) {
      // Return the input with the higher absolute level
      const speaker = user > interviewer ? 'user' : 'interviewer';
      console.log(`Audio levels are similar, choosing ${speaker} based on higher absolute level`);
      return speaker;
    }
    
    // Default fallback - maintain last active speaker
    console.log(`Using fallback: keeping last active speaker: ${lastActiveSpeakerRef.current || 'user'}`);
    return lastActiveSpeakerRef.current || 'user';
  }, []);

  // Update refs if callbacks/options change
  useEffect(() => {
    optionsRef.current = { onSpeechStart, onSpeechEnd, onSilenceAfterSpeech, autoSuggest, silenceDuration };
  }, [onSpeechStart, onSpeechEnd, onSilenceAfterSpeech, autoSuggest, silenceDuration]);

  // --- NEW: useEffect to handle IPC stream commands ---
  useEffect(() => {
    if (googleStreamCommand === 'start') {
      console.log(`---> [VAD Hook useEffect] Sending IPC ${IPC_CHANNELS.START} with language: ${selectedLanguage}`);
      if (window.electronAPI) {
        window.electronAPI.send(IPC_CHANNELS.START, { language: selectedLanguage });
      } else {
        console.warn('window.electronAPI not available when trying to send start command.');
      }
      // Reset command after sending
      setGoogleStreamCommand('idle'); 
    } else if (googleStreamCommand === 'stop') {
      console.log(`---> [VAD Hook useEffect] Sending IPC ${IPC_CHANNELS.STOP}`);
      if (window.electronAPI) {
        window.electronAPI.send(IPC_CHANNELS.STOP);
      } else {
        console.warn('window.electronAPI not available when trying to send stop command.');
      }
      // Reset command after sending
      setGoogleStreamCommand('idle');
    }
  }, [googleStreamCommand, selectedLanguage]);
  // --- END: useEffect for IPC ---

  // Clean up resources and stop listening
  const cleanup = useCallback((streamType: 'user' | 'speaker' | 'all') => {
    console.log(`Cleanup called for: ${streamType}`);
    const cleanupStream = (type: 'user' | 'speaker') => {
      console.log(`Cleaning up ${type} stream...`);
      const streamRef = type === 'user' ? userStreamRef : speakerStreamRef;
      const vadRef = type === 'user' ? userVadRef : speakerVadRef;
      const recorderRef = type === 'user' ? userMediaRecorderRef : speakerMediaRecorderRef;
      const chunksRef = type === 'user' ? userAudioChunksRef : speakerAudioChunksRef;
      const timeoutRef = silenceTimeoutRef.current[type];

      if (timeoutRef) {
        clearTimeout(timeoutRef);
        silenceTimeoutRef.current[type] = null;
        console.log(`Cleared silence timeout for ${type}`);
      }
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
         try {
           recorderRef.current.stop();
           console.log(`Stopped ${type} MediaRecorder`);
          } catch (e) { console.error(`Error stopping ${type} recorder:`, e); }
      }
      recorderRef.current = null;
      chunksRef.current = [];

      if (vadRef.current) {
        try {
          vadRef.current.destroy(); // <-- Use MicVAD destroy method
          console.log(`Destroyed ${type} VAD`);
        } catch (e) { console.error(`Error destroying ${type} VAD:`, e); }
        vadRef.current = null;
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        console.log(`Stopped ${type} MediaStream tracks`);
        streamRef.current = null;
      }
      // No AudioContext to close directly with MicVAD manage streams internally
      if (type === 'user') { isUserSpeakingRef.current = false; setIsUserSpeaking(false); }
      if (type === 'speaker') { isSpeakerSpeakingRef.current = false; setIsSpeakerSpeaking(false); }
      speechStartTimeRef.current[type] = null;
      lastSpeechEndTimeRef.current[type] = null;
      console.log(`Finished cleaning ${type} stream.`);

      // --- NEW: Clear arbitration timeout on stream cleanup ---
      if (arbitrationTimeoutRef.current) {
        clearTimeout(arbitrationTimeoutRef.current);
        arbitrationTimeoutRef.current = null;
        isArbitratingRef.current = false;
        pendingSpeechStartRoleRef.current = null;
        console.log(`Cleared arbitration timeout during ${type} cleanup`);
      }
      // --- END: Clear arbitration timeout ---
    };

    if (streamType === 'all' || streamType === 'user') {
      cleanupStream('user');
    }
    if (streamType === 'all' || streamType === 'speaker') {
      cleanupStream('speaker');
    }

    if (streamType === 'all') {
      setIsListening(false);
      console.log("Full cleanup complete, isListening set to false.");
    }
  }, []); // Keep dependencies empty for stable cleanup function

  // Start listening for voice
  const startListening = useCallback(async () => {
    // Use ref check to prevent multiple calls
    if (isListeningRef.current) { 
      console.log('startListening called again while already listening/starting, exiting.');
      return;
    }
    isListeningRef.current = true; // Mark as starting
    console.log('Attempting to start dual stream listening with @ricky0123/vad-web...');
    setIsListening(true); // Update public state

    let userStreamStarted = false;
    let speakerStreamStarted = false;

    // Function to set up VAD and MediaRecorder for a given stream using MicVAD
    const setupMicVAD = async (type: 'user' | 'speaker') => {
      const role = type === 'user' ? 'user' : 'interviewer';
      const deviceId = type === 'user' ? microphoneDeviceId : speakerDeviceId;
      const vadRef = type === 'user' ? userVadRef : speakerVadRef;
      const streamRef = type === 'user' ? userStreamRef : speakerStreamRef;
      const recorderRef = type === 'user' ? userMediaRecorderRef : speakerMediaRecorderRef;
      const chunksRef = type === 'user' ? userAudioChunksRef : speakerAudioChunksRef;
      const speakingRef = type === 'user' ? isUserSpeakingRef : isSpeakerSpeakingRef;
      const speakingSetter = type === 'user' ? setIsUserSpeaking : setIsSpeakerSpeaking;

      if (!deviceId) {
        console.warn(`No device ID provided for ${role}, skipping VAD setup.`);
        return false; // Indicate failure
      }

      // Ensure previous instance is destroyed
      if (vadRef.current) {
        try { vadRef.current.destroy(); } catch(e) { console.warn(`Minor error destroying previous ${role} VAD:`, e); }
        vadRef.current = null;
      }

      console.log(`Setting up MicVAD for ${role} with deviceId: ${deviceId}`);

      try {
        // Use utils.getMicStream to handle device selection potentially
        // Note: MicVAD can also take a stream directly if we manage it
        // For simplicity, let MicVAD handle stream creation if possible,
        // but we need the stream for MediaRecorder too. Let's get the stream first.

        console.log(`Requesting ${role} media with deviceId: ${deviceId}`);
        const stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: deviceId } } });
        streamRef.current = stream;
        console.log(`${role} MediaStream acquired.`);

        // --- Setup Media Recorder ---
        try {
          recorderRef.current = new MediaRecorder(streamRef.current, { mimeType: 'audio/webm' });
          console.log(`${role} MediaRecorder created.`);

          recorderRef.current.ondataavailable = (event) => {
            if (event.data.size > 0) {
              chunksRef.current.push(event.data);
            }
          };

          recorderRef.current.onstop = () => {
            console.log(`${role} MediaRecorder stopped. Chunks: ${chunksRef.current.length}`);
            const recordedChunks = [...chunksRef.current];
            chunksRef.current = []; // Clear immediately

            if (recordedChunks.length > 0) {
              const audioBlob = new Blob(recordedChunks, { type: recorderRef.current?.mimeType });
              console.log(`${role} Blob created: size ${audioBlob.size}`);

              const startTime = speechStartTimeRef.current[type];
              // Check minimum speech duration using start time
              if (startTime && Date.now() - startTime >= MIN_SPEECH_DURATION) {
                 if (optionsRef.current.onSpeechEnd) {
                    optionsRef.current.onSpeechEnd(audioBlob, role);
                    console.log(`${role} onSpeechEnd called with blob.`);
                 }

                 // ---> DEBUG LOGGING FOR SILENCE CHECK
                 const vadStopTime = lastSpeechEndTimeRef.current[type];
                 const timeSinceVadStop = vadStopTime ? Date.now() - vadStopTime : -1;
                 console.log(`[${role} Silence Check] autoSuggest: ${optionsRef.current.autoSuggest}, onSilenceAfterSpeech: ${!!optionsRef.current.onSilenceAfterSpeech}, vadStopTime: ${vadStopTime}, timeSinceVadStop: ${timeSinceVadStop}ms, silenceDuration: ${optionsRef.current.silenceDuration}ms`);
                 // <--- END DEBUG LOGGING

                 // Check if silence duration met AFTER speech end
                 if (optionsRef.current.autoSuggest && optionsRef.current.onSilenceAfterSpeech && vadStopTime && (timeSinceVadStop >= optionsRef.current.silenceDuration)) {
                    console.log(`---> [${role} Silence Check PASSED] Calling onSilenceAfterSpeech.`); // Log success
                    optionsRef.current.onSilenceAfterSpeech(audioBlob, role);
                 } else if (optionsRef.current.autoSuggest) {
                    console.log(`---> [${role} Silence Check FAILED] Conditions not met (timeSinceVadStop: ${timeSinceVadStop}ms < silenceDuration: ${optionsRef.current.silenceDuration}ms?)`); // Log failure
                 }
              } else {
                 console.log(`${role} speech duration too short (${startTime ? Date.now() - startTime : '?'}ms), not processing blob.`);
              }
            } else {
              console.log(`${role} MediaRecorder stopped, no chunks recorded.`);
            }
          };

          recorderRef.current.onerror = (event) => {
            console.error(`${role} MediaRecorder error:`, event);
          };

        } catch (recorderError) {
          console.error(`Failed to create ${role} MediaRecorder:`, recorderError);
          alert(`Could not initialize audio recorder for ${role}. Transcription might fail.`);
          recorderRef.current = null;
          // Should we stop VAD setup here too? Yes.
          streamRef.current?.getTracks().forEach(track => track.stop());
          streamRef.current = null;
          return false;
        }
        // --- End Media Recorder Setup ---


        // --- Setup MicVAD ---
        const newVad = await MicVAD.new({
          stream: streamRef.current,
          positiveSpeechThreshold: 0.6, // Adjust threshold as needed
          negativeSpeechThreshold: 0.5,
          preSpeechPadFrames: 1,
          // Use onFrameProcessed instead of onSpeechData
          onFrameProcessed: (probabilities: any, audioFrame?: Float32Array) => { // <-- Try onFrameProcessed
            // Check if audioFrame is provided and we are speaking
            // console.log(`[VAD ${role}] Frame processed. Speaking: ${speakingRef.current}`); // DEBUG - Can be very noisy
            
            // ---> NEW: Log probabilities
            if (probabilities && probabilities.isSpeech !== undefined) {
              // Log only occasionally to avoid flooding console
              if (Math.random() < 0.05) { // Log ~5% of frames
                 console.log(`[VAD ${role}] Speech Probability: ${probabilities.isSpeech.toFixed(4)}`);
              }
            }
            // ---> END: Log probabilities

            if (audioFrame && speakingRef.current) { 
              // Only allow frames from the current active role into the STT stream
              if (activeRoleRef.current && activeRoleRef.current !== role) {
                return; // Gate other role frames while a role is active
              }
              // console.log(`[VAD ${role}] Sending audio frame, size: ${audioFrame.length}`); // DEBUG
              // const buffer = Buffer.from(audioFrame.buffer); // <-- Error: Buffer unavailable here
              // Use specific channel for raw audio data - send ArrayBuffer directly
              if (window.electronAPI) {
                // Attach speaker role to each audio frame for downstream labeling
                window.electronAPI.send(IPC_CHANNELS.AUDIO_DATA, { audio: audioFrame.buffer, role });
              } else {
                // Add a warning if the API is not available
                console.warn('window.electronAPI not available when trying to send audio frame data.');
                // Optionally, stop VAD or log more details if this happens frequently
                }
             }
          },
          onSpeechStart: () => {
            console.log(`---> [VAD ${role}] onSpeechStart FIRED`); // DEBUG
            speakingSetter(true); // Use speakingSetter
            speakingRef.current = true; // Use speakingRef
            speechStartTimeRef.current[role] = Date.now();
            lastSpeechEndTimeRef.current[role] = null; // Clear last end time
            clearTimeout(silenceTimeoutRef.current[role]!);
            silenceTimeoutRef.current[role] = null;

            // Determine active speaker and start stream via IPC
            lastActiveSpeakerRef.current = role;
            // If no active role, lock this role as the active one
            if (!activeRoleRef.current) {
              activeRoleRef.current = role;
            }
            console.log(`---> [VAD ${role}] Setting googleStreamCommand to 'start'`); // DEBUG
            // Only send start once per listening session
            if (!hasStartedStreamRef.current) {
              setGoogleStreamCommand('start'); // <-- Trigger useEffect for IPC
              hasStartedStreamRef.current = true;
            }
            // ipcRenderer.send(IPC_CHANNELS.START, { language: 'en-US' /* Or get lang dynamically */ }); // <-- Error: ipcRenderer unavailable here

            // Call the provided callback
            optionsRef.current.onSpeechStart?.(role);
          },
          onSpeechEnd: (/* audio */) => {
            // audio is Uint8Array containing a WAV file
            // We no longer need to process the full blob here
            console.log(`${role} speech end detected`);
            const startTime = speechStartTimeRef.current[role];
            const endTime = Date.now();
            speechStartTimeRef.current[role] = null; // Reset start time
            lastSpeechEndTimeRef.current[role] = endTime;
            isUserSpeakingRef.current = false;
            isSpeakerSpeakingRef.current = false;

            // Release the active role lock shortly after end to allow other role to take over
            if (activeRoleRef.current === role) {
              if (silenceTimeoutRef.current[role]) {
                clearTimeout(silenceTimeoutRef.current[role]!);
              }
              // Small grace period to avoid flapping between roles mid-phrase
              silenceTimeoutRef.current[role] = setTimeout(() => {
                activeRoleRef.current = null;
              }, 250);
            }
          },
          onVADMisfire: () => {
            console.log(`${role} VAD misfire detected`);
            // Can add logic here if needed, e.g., reset state
          }
        });

        vadRef.current = newVad; // Assign the correctly created VAD instance
        // newVad.start(); // MicVAD starts automatically - Let's try explicitly starting
        console.log(`---> [VAD ${role}] Explicitly calling start()`); // DEBUG
        vadRef.current.start(); // <-- Explicitly start
        console.log(`---> [VAD ${role}] Called start().`); // DEBUG
        
        // ---> NEW: Check stream state after start
        if (streamRef.current && streamRef.current.getAudioTracks().length > 0) {
          const trackState = streamRef.current.getAudioTracks()[0].readyState;
          console.log(`---> [VAD ${role}] Audio track state after start(): ${trackState}`); // DEBUG
          if (trackState !== 'live') {
            console.warn(`---> [VAD ${role}] Audio track is not live after starting VAD! State: ${trackState}`);
          }
        } else {
           console.warn(`---> [VAD ${role}] No audio track found after starting VAD!`);
        }
        // ---> END: Check stream state

        console.log(`MicVAD setup complete for ${role}`);
        return true; // Indicate success

      } catch (error: any) {
        console.error(`Error setting up MicVAD for ${role} (Device ID: ${deviceId}):`, error);
        if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
            alert(`${role} device not found: ${deviceId}. Please check selection.`);
        } else if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
             alert(`${role} permission denied. Please allow access in browser/system settings.`);
        } else {
             alert(`Error accessing ${role} device: ${error.message}`);
        }
        // Cleanup if VAD setup fails
        streamRef.current?.getTracks().forEach(track => track.stop());
        streamRef.current = null;
        if (recorderRef.current?.state === 'recording') { recorderRef.current.stop(); }
        recorderRef.current = null;
        vadRef.current = null; // Ensure ref is cleared
        speakingRef.current = false; // Reset ref on error
        speakingSetter(false); // Reset state on error
        return false; // Indicate failure
      }
    };

    // --- Start streams ---
    userStreamStarted = await setupMicVAD('user');
    speakerStreamStarted = await setupMicVAD('speaker');

    // If neither stream started, stop listening fully
    if (!userStreamStarted && !speakerStreamStarted) {
      console.error('Failed to start any audio stream with MicVAD.');
      cleanup('all');
    } else {
      console.log('Dual stream listening setup initiated with MicVAD.');
    }

  }, [microphoneDeviceId, speakerDeviceId, cleanup]); // Only device IDs and cleanup


  // Stop listening
  const stopListening = useCallback(() => {
    // Use ref check to prevent multiple cleanup calls
    if (!isListeningRef.current) return;
    console.log('Stopping dual stream listening (MicVAD)');
    isListeningRef.current = false; // Mark as stopping

    // --- ADDED: Stop the Google stream explicitly ---
    console.log('---> [VAD Hook] Explicitly stopping Google stream via IPC');
    setGoogleStreamCommand('stop'); // <-- Trigger useEffect for IPC
    // --- END ADDED ---

    cleanup('all');
    // Reset stream/session locks
    hasStartedStreamRef.current = false;
    activeRoleRef.current = null;
  }, [cleanup]); // Dependency is only stable cleanup

  // Effect to automatically stop when component unmounts
  useEffect(() => {
    return () => {
      console.log('Component unmounting, cleaning up VAD resources...');
      cleanup('all');
    };
  }, [cleanup]); // Important: Ensure cleanup is stable or included

  // Ref to manage the isListening state reliably within async callbacks
  const isListeningRef = useRef(isListening);
  useEffect(() => { 
    isListeningRef.current = isListening; 
    // Also update speaking refs when isListening changes to false (for cleanup edge cases)
    if (!isListening) { // Also clear arbitration state if listening stops externally
      isUserSpeakingRef.current = false;
      isSpeakerSpeakingRef.current = false;
      if (arbitrationTimeoutRef.current) { 
        clearTimeout(arbitrationTimeoutRef.current);
        arbitrationTimeoutRef.current = null;
      }
      isArbitratingRef.current = false;
      pendingSpeechStartRoleRef.current = null;
    }
  }, [isListening]);

  return {
    isListening,
    isSpeaking, // Combined state
    isUserSpeaking,
    isSpeakerSpeaking,
    startListening,
    stopListening
  };
} 