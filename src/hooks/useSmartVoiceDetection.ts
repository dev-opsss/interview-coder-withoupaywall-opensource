import { useState, useRef, useEffect, useCallback } from 'react';
// --- NEW: Import MicVAD and related types ---
import { MicVAD, utils } from '@ricky0123/vad-web';

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
  onSpeechStart?: (speakerRole: 'user' | 'interviewer') => void;
  onSpeechEnd?: (audioBlob: Blob, speakerRole: 'user' | 'interviewer') => void;
  onSilenceAfterSpeech?: (audioBlob: Blob, speakerRole: 'user' | 'interviewer') => void;
  silenceDuration?: number;
  // vadThreshold?: number; // Removed
  autoSuggest?: boolean;
}

/**
 * Hook to provide smart voice detection with automatic suggestion generation
 * Manages separate streams for user microphone and speaker output (virtual device)
 * Uses @ricky0123/vad-web
 */
export function useSmartVoiceDetection({
  speakerDeviceId = null,
  microphoneDeviceId = null,
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

  // Update refs if callbacks/options change
  useEffect(() => {
    optionsRef.current = { onSpeechStart, onSpeechEnd, onSilenceAfterSpeech, autoSuggest, silenceDuration };
  }, [onSpeechStart, onSpeechEnd, onSilenceAfterSpeech, autoSuggest, silenceDuration]);

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
        vadRef.current = await MicVAD.new({
          stream: streamRef.current,
          // Add/adjust VAD options
          positiveSpeechThreshold: 0.5, // Try lowering threshold
          negativeSpeechThreshold: 0.35, // Adjust accordingly
          // minSilenceFrames: 3, // Remove incorrect option
          // Add frame processing callback for debugging
          onFrameProcessed: (probs, audioFrame) => {
             if (type === 'speaker') { // Only log for speaker/interviewer stream
                let rms = 0;
                if (audioFrame){
                   for (let i = 0; i < audioFrame.length; i++) {
                      rms += audioFrame[i] * audioFrame[i];
                   }
                   rms = Math.sqrt(rms / audioFrame.length);
                   // Log RMS occasionally
                   if (Math.random() < 0.05) { 
                      console.log(`[Interviewer Stream Debug] RMS: ${rms.toFixed(4)}, VAD Prob: ${probs?.isSpeech.toFixed(4)} (Threshold: ~0.5?)`);
                   }
                }
             }
          },
          onSpeechStart: () => {
            console.log(`---> ${role} VAD: onSpeechStart callback entered.`); // Log entry
            if (!speakingRef.current) { 
              speakingRef.current = true;
              speakingSetter(true);
              speechStartTimeRef.current[type] = Date.now();

              // Start the recorder only if inactive
              if (recorderRef.current && recorderRef.current.state === 'inactive') {
                 chunksRef.current = []; 
                 try {
                     console.log(`---> ${role} VAD: Attempting to start MediaRecorder.`); // Log recorder start attempt
                     recorderRef.current.start();
                     console.log(`---> ${role} MediaRecorder started successfully.`); // Log success
                 } catch (e) { 
                     console.error(`---> ${role} VAD: Error starting MediaRecorder:`, e); 
                 }
              } else {
                 console.log(`---> ${role} VAD: MediaRecorder not started (state: ${recorderRef.current?.state})`);
              }

              // Clear *other* stream's silence timeout
              const otherType = type === 'user' ? 'speaker' : 'user';
              if (silenceTimeoutRef.current[otherType]) {
                 clearTimeout(silenceTimeoutRef.current[otherType]!);
                 silenceTimeoutRef.current[otherType] = null;
                 console.log(`Cleared silence timeout for ${otherType} due to ${type} speech start.`);
              }
               // Clear this stream's own timeout (safety)
               if (silenceTimeoutRef.current[type]) {
                 clearTimeout(silenceTimeoutRef.current[type]!);
                 silenceTimeoutRef.current[type] = null;
              }

              if (optionsRef.current.onSpeechStart) { optionsRef.current.onSpeechStart(role); }
            } else {
               console.log(`---> ${role} VAD: onSpeechStart called, but already speaking.`);
            }
          },
          onSpeechEnd: (audio) => {
            console.log(`---> ${role} VAD: onSpeechEnd callback entered.`); // Log entry
            lastSpeechEndTimeRef.current[type] = Date.now(); 
            if (speakingRef.current) { 
              speakingRef.current = false;
              speakingSetter(false);
              if (recorderRef.current && recorderRef.current.state === 'recording') {
                 try {
                    console.log(`---> ${role} VAD: Attempting to stop MediaRecorder.`); // Log stop attempt
                    recorderRef.current.stop();
                    console.log(`---> ${role} VAD: MediaRecorder stopped via onSpeechEnd.`);
                 } catch (e) { console.error(`---> ${role} VAD: Error stopping MediaRecorder on VAD speech end:`, e); }
              }
            } else {
               console.log(`---> ${role} VAD: Speech End received, but was not marked as speaking.`);
               // If recorder is running, stop it anyway? Safety measure.
               if (recorderRef.current && recorderRef.current.state === 'recording') {
                  try { recorderRef.current.stop(); } catch (e) { /* ignore */ }
               }
            }
          },
        });

        vadRef.current.start();
        console.log(`${role} MicVAD started.`);
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
    cleanup('all');
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
    if (!isListening) {
      isUserSpeakingRef.current = false;
      isSpeakerSpeakingRef.current = false;
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