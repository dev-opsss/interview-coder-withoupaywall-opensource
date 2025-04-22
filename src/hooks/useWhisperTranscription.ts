import { useState, useRef, useCallback, useEffect } from 'react';

// Define the structure for the pipeline function if possible (can be simplified)
type PipelineFunction = (
  task: string,
  model: string,
  options?: { progress_callback?: (progress: any) => void, quantized?: boolean }
) => Promise<any>;

// Define the structure for the pipeline instance
interface RecognizerPipeline {
  (audio: Float32Array, options?: { chunk_length_s?: number; stride_length_s?: number | number[] }): Promise<{ text: string } | any>;
}

// Define the structure for the imported Transformers library module
interface TransformersModule {
  pipeline: PipelineFunction;
  env: any; // Simplify the type definition to avoid versioning issues
}

// Define Web Speech API interfaces for TypeScript
interface SpeechRecognitionErrorEvent extends Event {
  error: string;
}

interface SpeechRecognitionEvent extends Event {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: {
      isFinal: boolean;
      [index: number]: {
        transcript: string;
      };
    };
  };
}

interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: (event: SpeechRecognitionEvent) => void;
  onerror: (event: SpeechRecognitionErrorEvent) => void;
  onstart?: (event: Event) => void;
  onend?: (event: Event) => void;
}

declare global {
  interface Window {
    SpeechRecognition?: {
      new(): SpeechRecognition;
    };
    webkitSpeechRecognition?: {
      new(): SpeechRecognition;
    };
  }
}

// Models that work with Transformers.js for speech recognition
const MODELS = [
  'Xenova/whisper-tiny',     // Use with 'automatic-speech-recognition'
  'Xenova/whisper-small',    // Use with 'automatic-speech-recognition'
  'facebook/wav2vec2-base-960h', // Use with 'automatic-speech-recognition'
];

const TARGET_SAMPLE_RATE = 16000;

type TranscriptionStatus = 'idle' | 'loadingLib' | 'loadingModel' | 'ready' | 'startingMic' | 'listening' | 'transcribing' | 'stopping' | 'error' | 'using-web-speech';

// --- Reference to store the audio listener cleanup function ---
let audioListenerCleanup: (() => void) | null = null;

// Flag to track if we're using Web Speech API fallback
let isUsingWebSpeech = false;
let webSpeechRecognition: SpeechRecognition | null = null;

export function useWhisperTranscription() {
  const [status, setStatus] = useState<TranscriptionStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [transcription, setTranscription] = useState<string>('');
  const [progress, setProgress] = useState<number>(0);
  const [modelAttempt, setModelAttempt] = useState<number>(0);

  const pipelineRef = useRef<PipelineFunction | null>(null);
  const recognizerPipelineRef = useRef<RecognizerPipeline | null>(null);
  const isMicActiveRef = useRef<boolean>(false);

  const log = useCallback((message: string, type: 'info' | 'error' | 'success' = 'info') => {
    console[type === 'error' ? 'error' : 'log'](`[useWhisperTranscription] ${message}`);
    if (type === 'error') {
      setErrorMessage(message);
    } else if (type === 'success') {
      setErrorMessage(null);
    }
  }, []);

  // Initialize and set up Web Speech API as a fallback
  const initWebSpeech = useCallback(() => {
    if (typeof window === 'undefined') return false;
    
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      log('Web Speech API not supported in this browser', 'error');
      return false;
    }

    try {
      webSpeechRecognition = new SpeechRecognition();
      webSpeechRecognition.continuous = true;
      webSpeechRecognition.interimResults = true;
      webSpeechRecognition.lang = 'en-US';
      
      webSpeechRecognition.onresult = (event: SpeechRecognitionEvent) => {
        let transcript = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          if (event.results[i].isFinal) {
            transcript += event.results[i][0].transcript + ' ';
          }
        }
        if (transcript) {
          setTranscription(prev => prev + transcript);
        }
      };
      
      webSpeechRecognition.onerror = (event: SpeechRecognitionErrorEvent) => {
        log(`Web Speech API error: ${event.error}`, 'error');
      };
      
      isUsingWebSpeech = true;
      log('Using Web Speech API as fallback', 'success');
      setStatus('using-web-speech');
      return true;
    } catch (error: any) {
      log(`Failed to initialize Web Speech API: ${error.message}`, 'error');
      return false;
    }
  }, [log]);

  // --- Simplified Library and Model Loading ---
  const loadLibraryAndPipeline = useCallback(async () => {
    if (recognizerPipelineRef.current) {
      log('Pipeline already loaded.', 'info');
      setStatus('ready');
      return;
    }
    
    if (status === 'loadingLib' || status === 'loadingModel') {
      log('Load already in progress.', 'info');
      return;
    }

    setStatus('loadingLib');
    setErrorMessage(null);
    setTranscription('');
    setProgress(0);

    try {
      // Load library
      if (!pipelineRef.current) {
        log('Loading Transformers.js library...');
        
        // Dynamic import with retry mechanism
        const transformers = await import('@xenova/transformers') as TransformersModule;
        
        // Minimal configuration - avoid excessive options
        if (transformers.env) {
          // Just set the most critical options
          transformers.env.useBrowserCache = true;
        }
        
        if (typeof transformers.pipeline !== 'function') {
          throw new Error('Pipeline function not found in the imported module.');
        }
        
        pipelineRef.current = transformers.pipeline;
        log('Transformers.js library loaded successfully.', 'success');
      }

      // Choose model based on current attempt
      const modelToLoad = MODELS[modelAttempt] || MODELS[0];
      setStatus('loadingModel');
      log(`Loading pipeline: ${modelToLoad}... (Attempt ${modelAttempt + 1}/${MODELS.length})`);

      // Simple progress tracking
      const progressTracker = (p: any) => {
        if (p && typeof p.progress === 'number') {
          setProgress(p.progress);
        }
      };

      // All speech recognition models should use 'automatic-speech-recognition' task
      if (pipelineRef.current) {
        recognizerPipelineRef.current = await pipelineRef.current(
          'automatic-speech-recognition', 
          modelToLoad,
          { progress_callback: progressTracker }
        );
      } else {
        throw new Error("Pipeline function is not available");
      }

      if (!recognizerPipelineRef.current) {
        throw new Error("Pipeline creation returned null");
      }

      log(`Pipeline ${modelToLoad} loaded successfully.`, 'success');
      setStatus('ready');
      setModelAttempt(0); // Reset for next time

    } catch (error: any) {
      log(`Error loading library or pipeline: ${error.message || error}`, 'error');
      
      // If we've tried all models, fall back to Web Speech API
      if (modelAttempt >= MODELS.length - 1) {
        log('All models failed. Trying Web Speech API fallback...', 'info');
        setModelAttempt(0); // Reset for next attempt
        
        // Try to initialize Web Speech right away
        const webSpeechInitialized = initWebSpeech();
        
        if (webSpeechInitialized) {
          // Successfully using web speech instead
          log('Successfully initialized Web Speech API as fallback', 'success');
          return;
        }
        
        // Everything failed
        setStatus('error');
        setErrorMessage("Speech recognition unavailable. Please check your browser permissions.");
        recognizerPipelineRef.current = null;
        pipelineRef.current = null;
      } else {
        // Try the next model
        const nextAttempt = modelAttempt + 1;
        log(`Trying next model: ${MODELS[nextAttempt]}`, 'info');
        setModelAttempt(nextAttempt);
        
        // Retry with a short delay
        setTimeout(() => {
          loadLibraryAndPipeline();
        }, 1000);
      }
    }
  }, [log, status, modelAttempt, initWebSpeech]);

  // Handler for incoming audio data chunks from main process
  const handleAudioChunk = useCallback(async (audioBuffer: ArrayBuffer) => {
    // Skip if we're using Web Speech API
    if (isUsingWebSpeech) return;
    
    if (!recognizerPipelineRef.current || status !== 'listening') {
      return;
    }
    // Convert ArrayBuffer to Float32Array (assuming correct format from main)
    const audio = new Float32Array(audioBuffer);
    
    setStatus('transcribing');
    try {
      const output = await recognizerPipelineRef.current(audio, {
         chunk_length_s: 5,
      });

      // Handle different output formats between models
      let recognizedText = '';
      if (typeof output === 'object') {
        if (output.text) {
          // Whisper-style output
          recognizedText = output.text;
        } else if (Array.isArray(output) && output.length > 0) {
          // wav2vec2-style output (most likely scenario)
          // Sort by score if available
          const sorted = [...output].sort((a, b) => (b.score || 0) - (a.score || 0));
          recognizedText = sorted[0].label || '';
        }
      } else if (typeof output === 'string') {
        // Direct string output
        recognizedText = output;
      }

      if (recognizedText && !recognizedText.includes('[BLANK_AUDIO]')) {
          setTranscription(prev => prev + recognizedText + ' ');
      }
      setStatus('listening'); // Go back to listening

    } catch (transcriptionError: any) {
       log(`Transcription error: ${transcriptionError.message || transcriptionError}`, 'error');
       setStatus('listening'); // Continue listening even after error?
    }
  }, [log, status]); // Depends on log and status

  const startMicrophone = useCallback(async () => {
    if (isMicActiveRef.current) {
      log('Audio capture already requested.', 'info');
      return;
    }
    
    // Handle Web Speech API differently
    if (isUsingWebSpeech || status === 'error') {
      // Try Web Speech API if we're already using it or if there was an error
      if (!webSpeechRecognition) {
        const initialized = initWebSpeech();
        if (!initialized) {
          log('Failed to initialize Web Speech API', 'error');
          return;
        }
      }
      
      try {
        setStatus('startingMic');
        setTranscription(''); // Clear previous transcription
        webSpeechRecognition?.start();
        setStatus('listening');
        isMicActiveRef.current = true;
        log('Web Speech API listening started.', 'success');
      } catch (error: any) {
        log(`Error starting Web Speech API: ${error.message}`, 'error');
        setStatus('error');
      }
      return;
    }
    
    // Handle Transformers.js pipeline - only proceed if ready
    if (status === 'ready') {
      if (!recognizerPipelineRef.current) {
        log('Recognizer pipeline is not available.', 'error');
        setStatus('error');
        return;
      }

      setStatus('startingMic');
      setErrorMessage(null);
      setTranscription('');
      isMicActiveRef.current = true; // Mark as active immediately

      try {
        log('Requesting audio capture via IPC...');
        const result = await window.electronAPI.invoke('start-audio-capture');
        log(`IPC start result: ${JSON.stringify(result)}`);

        if (!result?.success) {
          throw new Error(result?.error || 'Failed to start capture via IPC');
        }

        // --- Setup listener for audio data from main process ---
        log('Setting up IPC listener for audio data...');
        if (audioListenerCleanup) {
          audioListenerCleanup();
        }
        audioListenerCleanup = window.electronAPI.onAudioDataChunk(handleAudioChunk);

        setStatus('listening');
        log('IPC capture started. Listening for audio data...');

      } catch (error: any) {
        log(`Error starting IPC audio capture: ${error.message || error}`, 'error');
        setStatus('error');
        isMicActiveRef.current = false; // Reset on error
        await window.electronAPI.invoke('stop-audio-capture').catch((e: any) => log(`Error stopping capture after failed start: ${e.message || e}`, 'info'));
        if (audioListenerCleanup) {
          audioListenerCleanup();
          audioListenerCleanup = null;
        }
      }
    } else {
      // Not ready - inform the user
      log(`Cannot start microphone in status: ${status}`, 'info');
    }
  }, [log, status, handleAudioChunk, initWebSpeech]);

  const stopMicrophone = useCallback(async () => {
    if (!isMicActiveRef.current) {
      return;
    }
    
    // Handle Web Speech API differently
    if (isUsingWebSpeech && webSpeechRecognition) {
      try {
        webSpeechRecognition.stop();
        log('Web Speech API listening stopped.', 'success');
        setStatus('using-web-speech');
      } catch (error: any) {
        log(`Error stopping Web Speech API: ${error.message}`, 'error');
      }
      isMicActiveRef.current = false;
      return;
    }

    log('Stopping IPC audio capture...');
    setStatus('stopping');
    isMicActiveRef.current = false; // Mark as inactive

    // --- Remove IPC listener ---
    if (audioListenerCleanup) {
      log('Removing IPC audio listener...');
      audioListenerCleanup();
      audioListenerCleanup = null;
    }

    try {
      log('Sending stop request via IPC...');
      const result = await window.electronAPI.invoke('stop-audio-capture');
      log(`IPC stop result: ${JSON.stringify(result)}`);
      if (!result?.success) {
        log(`IPC stop command failed: ${result?.error || 'Unknown reason'}`, 'error');
      }
    } catch (error: any) {
      log(`Error sending stop IPC command: ${error.message || error}`, 'error');
    }

    setStatus('ready');
    log('IPC audio capture stopped.');

  }, [log]);

  // Cleanup function on component unmount
  useEffect(() => {
    return () => {
      log('Cleaning up Whisper hook...');
      if (isMicActiveRef.current) {
        if (isUsingWebSpeech && webSpeechRecognition) {
          try {
            webSpeechRecognition.stop();
          } catch (e) {
            // Ignore errors on cleanup
          }
        } else {
          window.electronAPI.invoke('stop-audio-capture').catch((e:any) => log(`Error stopping capture on unmount: ${e.message || e}`, 'info'));
        }
      }
      if (audioListenerCleanup) {
        audioListenerCleanup();
        audioListenerCleanup = null;
      }
      isUsingWebSpeech = false;
      webSpeechRecognition = null;
      log('Whisper hook cleanup complete.');
    };
  }, [log]);

  return {
    status,
    errorMessage,
    transcription,
    progress,
    loadMicAndPipeline: loadLibraryAndPipeline,
    startMicrophone,
    stopMicrophone,
  };
}

// Helper function to format status messages
export function getStatusMessage(status: TranscriptionStatus): string {
  switch (status) {
    case 'idle': return 'Idle. Load pipeline to start.';
    case 'loadingLib': return 'Loading speech recognition library...';
    case 'loadingModel': return 'Loading model... (This may take time)';
    case 'ready': return 'Ready. Start microphone to transcribe.';
    case 'startingMic': return 'Starting microphone...';
    case 'listening': return 'Listening... Speak now.';
    case 'transcribing': return 'Transcribing...';
    case 'stopping': return 'Stopping microphone...';
    case 'error': return 'An error occurred. Check logs.';
    case 'using-web-speech': return 'Using browser speech recognition.';
    default: return 'Unknown status';
  }
} 