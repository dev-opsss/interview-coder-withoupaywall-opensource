import SubscribedApp from "./_pages/SubscribedApp"
import { UpdateNotification } from "./components/UpdateNotification"
import {
  QueryClient,
  QueryClientProvider
} from "@tanstack/react-query"
import { useEffect, useState, useCallback, useRef } from "react"
import { MicVAD, utils } from "@ricky0123/vad-web"
import {
  Toast,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport
} from "./components/ui/toast"
import { ToastContext } from "./contexts/toast"
import { WelcomeScreen } from "./components/WelcomeScreen"
import { SettingsDialog } from "./components/Settings/SettingsDialog"
import { GoogleSpeechService } from './services/googleSpeechService'
import { VoiceTranscriptionPanel } from './components/VoiceTranscriptionPanel'

// Utility function to convert Float32Array PCM audio data to a WAV Blob
// (Adapted from GoogleSpeechService or could be moved to a shared utils file)
async function pcmToWavBlob(audioData: Float32Array, sampleRate: number): Promise<Blob> {
  const writeString = (view: DataView, offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  const targetSampleRate = 16000; // Target for Google Speech
  const channels = 1; // Mono

  // Resample if necessary (using basic linear interpolation for simplicity here)
  // A proper resampling library might be better for quality
  let resampledData = audioData;
  if (sampleRate !== targetSampleRate) {
      const ratio = targetSampleRate / sampleRate;
      const newLength = Math.round(audioData.length * ratio);
      resampledData = new Float32Array(newLength);
      for (let i = 0; i < newLength; i++) {
          const index = i / ratio;
          const lower = Math.floor(index);
          const upper = Math.ceil(index);
          const weight = index - lower;
          resampledData[i] = (1 - weight) * (audioData[lower] || 0) + weight * (audioData[upper] || 0);
      }
      console.log(`Resampled audio from ${sampleRate}Hz to ${targetSampleRate}Hz`);
  }


  const wavLength = resampledData.length * channels * 2; // 2 bytes per sample (16-bit)
  const buffer = new ArrayBuffer(44 + wavLength); // 44 bytes for WAV header
  const view = new DataView(buffer);

  // RIFF chunk descriptor
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + wavLength, true); // file length - 8
  writeString(view, 8, 'WAVE');

  // FMT sub-chunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // chunk size = 16
  view.setUint16(20, 1, true); // audio format = 1 (PCM)
  view.setUint16(22, channels, true); // num channels = 1
  view.setUint32(24, targetSampleRate, true); // sample rate
  view.setUint32(28, targetSampleRate * channels * 2, true); // byte rate
  view.setUint16(32, channels * 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample = 16

  // Data sub-chunk
  writeString(view, 36, 'data');
  view.setUint32(40, wavLength, true); // chunk size (audio data length)

  // Write PCM samples
  let offset = 44;
  for (let i = 0; i < resampledData.length; i++) {
    const sample = Math.max(-1, Math.min(1, resampledData[i])); // Clamp value
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true); // Convert to 16-bit signed int
    offset += 2;
  }

  return new Blob([view], { type: 'audio/wav' });
}

// Create a React Query client
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 0,
      gcTime: Infinity,
      retry: 1,
      refetchOnWindowFocus: false
    },
    mutations: {
      retry: 1
    }
  }
})

// Helper function to mask API key for secure logging
const maskApiKey = (apiKey: string): string => {
  if (!apiKey) return '[NONE]';
  if (apiKey.length <= 8) return '****' + apiKey.slice(-4);
  
  // Show first 4 and last 4 characters, mask the rest
  return apiKey.slice(0, 4) + '****' + apiKey.slice(-4);
};

interface SubscribedAppProps {
  credits: number
  currentLanguage: string
  setLanguage: (language: string) => void
  onToggleChat: () => void
  onToggleLiveAssistant: () => void
  isLiveAssistantActive: boolean
  isChatPanelOpen: boolean
}

// Root component that provides the QueryClient
function App() {
  const [toastState, setToastState] = useState({
    open: false,
    title: "",
    description: "",
    variant: "neutral" as "neutral" | "success" | "error"
  })
  const [credits, setCredits] = useState<number>(999) // Unlimited credits
  const [currentLanguage, setCurrentLanguage] = useState<string>("python")
  const [isInitialized, setIsInitialized] = useState(false)
  const [hasApiKey, setHasApiKey] = useState(false)
  const [apiKeyDialogOpen, setApiKeyDialogOpen] = useState(false)
  // Note: Model selection is now handled via separate extraction/solution/debugging model settings

  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [isChatPanelOpen, setIsChatPanelOpen] = useState(false);
  const [chatHistory, setChatHistory] = useState<any[]>([]);
  const [chatInputValue, setChatInputValue] = useState("");

  // Voice recording state
  const [isRecording, setIsRecording] = useState(false);
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null);
  const [audioChunks, setAudioChunks] = useState<Blob[]>([]);
  const audioChunksRef = useRef<Blob[]>([]);
  
  // Transcription state
  const [currentTranscription, setCurrentTranscription] = useState('');
  const [isTranscribing, setIsTranscribing] = useState(false);

  // Speech service state
  const [speechService, setSpeechService] = useState<'whisper' | 'google'>('whisper');
  const googleSpeechRef = useRef<GoogleSpeechService | null>(null);

  // --- START: Live Assistant State ---
  const [isLiveAssistantActive, setIsLiveAssistantActive] = useState(false);
  const [interviewContext, setInterviewContext] = useState({ jobTitle: '', keySkills: '', companyMission: '' });
  const [resumeText, setResumeText] = useState<string>('');
  const [generatedInterviewAnswer, setGeneratedInterviewAnswer] = useState<string>('');
  const [isAssistantProcessing, setIsAssistantProcessing] = useState<boolean>(false);
  const [resumeFileName, setResumeFileName] = useState<string>('');
  // --- END: Live Assistant State ---

  // --- NEW: Callback to clear live assistance display from panel ---
  const handleClearLiveAssistanceDisplay = useCallback(() => {
    setGeneratedInterviewAnswer('');
    // No need to set isAssistantProcessing to false here, as this is about clearing display
    console.log("---> App.tsx: Cleared generatedInterviewAnswer (Talking Points) via panel request.");
  }, []);
  // --- END: Callback to clear live assistance ---

  const [vad, setVad] = useState<MicVAD | null>(null); // VAD State
  const vadSpeakingRef = useRef(false); // Ref to track VAD speaking status
  const speechAudioBufferRef = useRef<Float32Array[]>([]); // Ref to store speech audio frames

  // Show toast method
  const showToast = useCallback(
    (
      title: string,
      description: string,
      variant: "neutral" | "success" | "error"
    ) => {
      setToastState({
        open: true,
        title,
        description,
        variant
      })
    },
    []
  )

  // Modified startRecording with VAD
  const startRecording = useCallback(async () => {
    if (isRecording) return; // Prevent starting if already recording

    try {
      console.log("Starting recording with VAD...");
      setIsRecording(true);
      setCurrentTranscription('');
      setIsTranscribing(false); // Reset transcribing state
      audioChunksRef.current = []; // Clear full recording buffer
      speechAudioBufferRef.current = []; // Clear VAD speech buffer
      vadSpeakingRef.current = false;

      // Ensure API keys are ready (same checks as before)
      if (speechService === 'whisper') {
         const apiKey = await window.electronAPI.getOpenAIApiKey();
         if (!apiKey) throw new Error("OpenAI API key not configured");
      } else if (speechService === 'google') {
         const apiKey = await window.electronAPI.getGoogleSpeechApiKey();
         if (!googleSpeechRef.current || !apiKey) throw new Error("Google Speech API key not configured");
         // Re-set key in case it was changed in settings while not recording
         googleSpeechRef.current.setApiKey(apiKey);
      }

      // Keep MediaRecorder for full recording (needed for Whisper fallback/primary)
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = 'audio/webm';
      const recorder = new MediaRecorder(stream, { mimeType });
      setMediaRecorder(recorder);

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };
      
      recorder.onerror = (e) => {
        console.error("MediaRecorder error:", e);
        // Stop VAD if MediaRecorder fails
         if (vad) {
           vad.destroy();
           setVad(null);
         }
        setIsRecording(false);
        setIsTranscribing(false);
      };

      // Process audio when recording stops (for final transcription)
      recorder.onstop = async () => {
          console.log("MediaRecorder stopped (final processing)");
          // VAD should already be stopped by stopRecording function, but ensure cleanup
          if (vad) {
              try {
                console.log("Ensuring VAD is stopped in onstop...");
                vad.pause(); // Use pause instead of destroy if you might restart
                setVad(null); // Clear state
              } catch (vadError) {
                console.error("Error stopping VAD in onstop:", vadError);
              }
          } else {
             console.log("VAD instance not found in onstop.")
          }

          if (audioChunksRef.current.length > 0) {
              try {
                  const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
                  console.log(`Final audio blob: size=${audioBlob.size} bytes, type=${audioBlob.type}`);
                  showToast("Transcribing", "Converting final speech to text...", "neutral");
                  setIsTranscribing(true);

                  let transcriptionText = '';
                  // --- Remove the explicit Google transcription attempt ---
                  // The streaming service in ProcessingHelper should handle this.
                  // We'll rely solely on Whisper for the final blob transcription here if needed,
                  // or assume the streaming service already provided the final result elsewhere.
                  try {
                      // If Google Speech isn't used, or as a fallback, use Whisper
                      console.log("Using Whisper API for FINAL transcription...");
                      const result = await processAudioWithWhisper(audioChunksRef.current); // Pass chunks to helper
                      transcriptionText = result?.text || '';
                      console.log("Whisper FINAL transcription successful.");
                      if (transcriptionText) {
                        console.log("Final transcription obtained via Whisper.");
                      }
                    } catch (whisperError) {
                      console.error("Whisper FINAL transcription failed:", whisperError);
                      throw whisperError; // Re-throw to be caught by the outer catch
                    }
                  // --- End of modified transcription logic ---

                  setCurrentTranscription(transcriptionText);
                  setIsTranscribing(false);

                  if (transcriptionText) {
                    showToast("Transcription Complete", "Your speech has been converted to text", "success");
                  } else {
                     console.log("Final transcription resulted in empty text.");
                     showToast("Transcription Complete", "No speech detected in the recording.", "neutral");
                  }
              } catch (error) {
                  console.error("Error in final audio processing:", error);
                  showToast("Transcription Failed", error instanceof Error ? error.message : "Failed to transcribe final audio", "error");
                  setIsTranscribing(false);
                  setCurrentTranscription('');
              }
          } else {
             console.log("No audio chunks recorded for final processing.");
             setIsTranscribing(false);
             setCurrentTranscription('');
          }
      };

      // --- VAD Setup ---
      console.log("Initializing VAD...");
      const myVad = await MicVAD.new({
        stream: stream, // Use the same stream as MediaRecorder
        positiveSpeechThreshold: 0.85, // Adjust sensitivity as needed
        negativeSpeechThreshold: 0.75,
        redemptionFrames: 3, // Replaced minSilenceFrames with redemptionFrames for silence detection after speech
        // Pre-speech buffer can help catch start of words
        // preSpeechPadFrames: 5,

        onSpeechStart: () => {
          console.log("VAD: Speech started");
          vadSpeakingRef.current = true;
          speechAudioBufferRef.current = []; // Start collecting new speech segment
        },

        onSpeechEnd: async (audio: Float32Array) => {
          console.log(`VAD: Speech ended. Audio duration: ${(audio.length / 16000).toFixed(2)}s`);
          vadSpeakingRef.current = false;
          speechAudioBufferRef.current = [];

          // --- Remove Google partial transcription logic ---
          // This is now handled by ProcessingHelper's streaming flow.
          // The VAD here might still be useful for non-Google services or UI feedback.
          console.log("VAD: Speech ended (Google partial transcription logic removed).");
                     
          // Optionally, trigger Whisper transcription here if speechService !== 'google'
          // if (speechService === 'whisper') { ... process audio chunk ... }
        },
        // Optional: Collect raw audio frames while speaking
        // onFrameProcessed: (frame) => {
        //  if (vadSpeakingRef.current) {
        //    // frame is Float32Array
        //    speechAudioBufferRef.current.push(frame.slice()); // Store a copy
        //  }
        // }
      });

      if (!myVad) {
         throw new Error("Failed to initialize VAD");
      }
      
      setVad(myVad); // Store VAD instance
      myVad.start(); // Start VAD listening
      recorder.start(1000); // Start MediaRecorder in parallel
      console.log("VAD and MediaRecorder started.");
      showToast('Recording', 'Listening for speech...', 'success');

    } catch (error: unknown) {
      console.error('Recording start error:', error);
      const errorMsg = error instanceof Error ? error.message : 'Failed to start recording';
      showToast('Error', errorMsg, 'error');
      setIsRecording(false);
      setIsTranscribing(false);
       // Ensure VAD is cleaned up on error
       if (vad) {
          try { vad.destroy(); } catch (e) {}
          setVad(null);
       }
       // Ensure MediaRecorder stream tracks are stopped
       if (mediaRecorder && mediaRecorder.stream) {
           mediaRecorder.stream.getTracks().forEach(track => track.stop());
       }
       setMediaRecorder(null);
    }
  }, [showToast, speechService, isRecording, vad, mediaRecorder, isLiveAssistantActive]); // Removed handleGenerateLiveAssistance dependency


  // Modified stopRecording with VAD cleanup
  const stopRecording = useCallback(() => {
    console.log("Stop recording requested...");
    if (vad) {
      try {
        console.log("Stopping VAD...");
        vad.destroy(); // Fully stop and release VAD resources
        setVad(null);
         vadSpeakingRef.current = false; // Ensure speaking ref is false
      } catch (e) {
        console.error("Error destroying VAD:", e);
      }
    } else {
       console.log("VAD instance not found during stopRecording.")
    }

    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      console.log("Stopping MediaRecorder...");
      // Let the recorder.onstop handler manage setIsTranscribing(true)
      // setIsTranscribing(true); // Moved to recorder.onstop

      try {
         mediaRecorder.stop(); // This will trigger recorder.onstop asynchronously
      } catch(e) {
            console.error("Error stopping MediaRecorder:", e);
          // Force state reset if stop fails
          setIsRecording(false);
         setIsTranscribing(false);
      } finally {
        // Don't stop stream tracks here immediately, let onstop handle final blob creation
        // if (mediaRecorder.stream) {
        //   mediaRecorder.stream.getTracks().forEach(track => track.stop());
        // }
         setIsRecording(false); // Set recording state false immediately
        // Don't setMediaRecorder(null) here, onstop needs it temporarily
      }
    } else {
       console.log("MediaRecorder not active or already stopped.");
        // If recorder wasn't active, ensure UI state is correct
       setIsRecording(false);
       setIsTranscribing(false);
    }
  }, [mediaRecorder, vad]); // Added VAD dependency

  // Set unlimited credits
  const updateCredits = useCallback(() => {
    setCredits(999) // No credit limit in this version
    window.__CREDITS__ = 999
  }, [])

  // Helper function to safely update language
  const updateLanguage = useCallback((newLanguage: string) => {
    setCurrentLanguage(newLanguage)
    window.__LANGUAGE__ = newLanguage
  }, [])

  // Helper function to mark initialization complete
  const markInitialized = useCallback(() => {
    setIsInitialized(true)
    window.__IS_INITIALIZED__ = true
  }, [])

  // Check for OpenAI API key and prompt if not found
  useEffect(() => {
    const checkApiKey = async () => {
      try {
        const hasKey = await window.electronAPI.checkApiKey()
        setHasApiKey(hasKey)
        
        // If no API key is found, show the settings dialog after a short delay
        if (!hasKey) {
          setTimeout(() => {
            setIsSettingsOpen(true)
          }, 1000)
        }
      } catch (error) {
        console.error("Failed to check API key:", error)
      }
    }
    
    if (isInitialized) {
      checkApiKey()
    }
  }, [isInitialized])

  // Initialize dropdown handler
  useEffect(() => {
    if (isInitialized) {
      // Process all types of dropdown elements with a shorter delay
      const timer = setTimeout(() => {
        // Find both native select elements and custom dropdowns
        const selectElements = document.querySelectorAll('select');
        const customDropdowns = document.querySelectorAll('.dropdown-trigger, [role="combobox"], button:has(.dropdown)');
        
        // Enable native selects
        selectElements.forEach(dropdown => {
          dropdown.disabled = false;
        });
        
        // Enable custom dropdowns by removing any disabled attributes
        customDropdowns.forEach(dropdown => {
          if (dropdown instanceof HTMLElement) {
            dropdown.removeAttribute('disabled');
            dropdown.setAttribute('aria-disabled', 'false');
          }
        });
        
        console.log(`Enabled ${selectElements.length} select elements and ${customDropdowns.length} custom dropdowns`);
      }, 1000);
      
      return () => clearTimeout(timer);
    }
  }, [isInitialized]);

  // Listen for settings dialog open requests
  useEffect(() => {
    const unsubscribeSettings = window.electronAPI.onShowSettings(() => {
      console.log("Show settings dialog requested");
      setIsSettingsOpen(true);
    });
    
    return () => {
      unsubscribeSettings();
    };
  }, []);

  // Initialize basic app state
  useEffect(() => {
    // Load config and set values
    const initializeApp = async () => {
      try {
        // Set unlimited credits
        updateCredits()
        
        // Load config including language and model settings
        const config = await window.electronAPI.getConfig()
        
        // Load language preference
        if (config && config.language) {
          updateLanguage(config.language)
        } else {
          updateLanguage("python")
        }
        
        // Model settings are now managed through the settings dialog
        // and stored in config as extractionModel, solutionModel, and debuggingModel
        
        markInitialized()
      } catch (error) {
        console.error("Failed to initialize app:", error)
        // Fallback to defaults
        updateLanguage("python")
        markInitialized()
      }
    }
    
    initializeApp()

    // Event listeners for process events
    const onApiKeyInvalid = () => {
      showToast(
        "API Key Invalid",
        "Your OpenAI API key appears to be invalid or has insufficient credits",
        "error"
      )
      setApiKeyDialogOpen(true)
    }

    // Setup API key invalid listener
    window.electronAPI.onApiKeyInvalid(onApiKeyInvalid)

    // Define a no-op handler for solution success
    const unsubscribeSolutionSuccess = window.electronAPI.onSolutionSuccess(
      () => {
        console.log("Solution success - no credits deducted in this version")
        // No credit deduction in this version
      }
    )

    // Cleanup function
    return () => {
      window.electronAPI.removeListener("API_KEY_INVALID", onApiKeyInvalid)
      unsubscribeSolutionSuccess()
      window.__IS_INITIALIZED__ = false
      setIsInitialized(false)
    }
  }, [updateCredits, updateLanguage, markInitialized, showToast])

  // API Key dialog management
  const handleOpenSettings = useCallback(() => {
    console.log('Opening settings dialog');
    setIsSettingsOpen(true);
  }, []);
  
  const handleCloseSettings = useCallback((open: boolean) => {
    console.log('Settings dialog state changed:', open);
    setIsSettingsOpen(open);
  }, []);

  const handleApiKeySave = useCallback(async (apiKey: string) => {
    try {
      await window.electronAPI.updateConfig({ apiKey })
      setHasApiKey(true)
      showToast("Success", "API key saved successfully", "success")
      
      // Reload app after a short delay to reinitialize with the new API key
      setTimeout(() => {
        window.location.reload()
      }, 1500)
    } catch (error) {
      console.error("Failed to save API key:", error)
      showToast("Error", "Failed to save API key", "error")
    }
  }, [showToast])

  // Chat panel toggle
  const toggleChatPanel = useCallback(() => {
    setIsChatPanelOpen(prev => !prev);
  }, []);

  // --- START: Live Assistant Toggle (Reverted to simple toggle) ---
  const toggleLiveAssistant = useCallback(() => {
    setIsLiveAssistantActive(prev => !prev);
    // Recording is now handled independently by the panel's mic button and close button
  }, []);
  // --- END: Live Assistant Toggle ---

  // --- START: Dedicated Deactivation Function (Still needed for Panel Close) ---
  const deactivateLiveAssistant = useCallback(() => {
    if (isLiveAssistantActive) { 
      console.log("Live Assistant Deactivated via Close Button - Stopping Recording");
      stopRecording(); // Stop recording when panel is closed
      setIsLiveAssistantActive(false);
    }
  }, [isLiveAssistantActive, stopRecording]);
  // --- END: Dedicated Deactivation Function ---

  // NEW: Direct Web Speech API implementation - MOVED ABOVE onToggleVoiceInput
  const toggleWebSpeech = useCallback(() => {
    // Disable speech recognition but keep the interface working
    showToast("Info", "Voice recognition is currently disabled in this version", "neutral");
    console.log("Voice recognition is disabled in this version");
    return;
  }, [showToast]);
  
  // --- Update onToggleVoiceInput to use the new recording functions --- 
  const onToggleVoiceInput = useCallback(() => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  }, [isRecording, startRecording, stopRecording]);

  // Chat message handler
  const handleSendMessage = async (messageContent: string) => {
    if (!messageContent.trim()) return;
        
    const newUserMessage = { role: 'user', content: messageContent };
    setChatHistory(prev => [...prev, newUserMessage]);
    setChatInputValue(""); // Clear input immediately

    try {
      // Call the backend API for AI response
      const result = await window.electronAPI.handleAiQuery({ 
        query: messageContent, 
        language: currentLanguage 
      });

      if (result && result.success && typeof result.data === 'string') {
        const newAssistantMessage = { role: 'assistant', content: result.data };
        setChatHistory(prev => [...prev, newAssistantMessage]);
      } else {
        showToast("AI Query Error", `Error: ${result?.error || "Failed to get response."}`, "error");
        const errorMessage = { role: 'assistant', content: `Error: ${result?.error || "Failed to get response."}` };
        setChatHistory(prev => [...prev, errorMessage]);
      }
    } catch (error: any) {
      showToast("Communication Error", `Error: ${error.message || "Could not reach AI service."}`, "error");
      const errorMessage = { role: 'assistant', content: `Error: ${error.message || "Could not reach AI service."}` };
      setChatHistory(prev => [...prev, errorMessage]);
    }
  };

  // Function to process audio with Whisper REST API
  const processAudioWithWhisper = async (audioChunks: Blob[]): Promise<{ text: string } | undefined> => {
    try {
      // Create a blob from all audio chunks
      const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
      console.log(`Created audio blob: size=${audioBlob.size} bytes, type=${audioBlob.type}`);

      // Get OpenAI API key
      const apiKey = await window.electronAPI.getOpenAIApiKey();
      if (!apiKey) {
        console.error("OpenAI API key not found");
        showToast("API Key Missing", "OpenAI API key is not configured", "error");
        return undefined;
      }

      // Log that we're using Whisper API with a masked version of the key
      const maskedKey = maskApiKey(apiKey);
      console.log(`Using OpenAI Whisper API for transcription with key: ${maskedKey}`);

      // Create FormData and append the file
      const formData = new FormData();
      const file = new File([audioBlob], "audio.webm", { type: 'audio/webm' });
      formData.append("file", file);
      formData.append("model", "whisper-1");
      formData.append("language", "en");

      // Show transcribing toast
      showToast("Transcribing", "Converting your speech to text...", "neutral");

      console.log(`Sending audio to Whisper API (audio size: ${Math.round(audioBlob.size/1024)} KB)`);

      // Make request to Whisper API
      const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`
        },
        body: formData
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        throw new Error(errorData?.error?.message || `API returned ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      console.log("Transcription result:", data);

      if (data.text) {
        // Update chat input with transcription
        setChatInputValue(prev => prev + (prev ? ' ' : '') + data.text);
        showToast("Transcription Complete", "Your speech has been converted to text", "success");
        
        // Return the transcription result
        return { text: data.text };
      } else {
        throw new Error("No transcription returned");
      }
    } catch (error) {
      console.error("Error in Whisper API processing:", error);
      showToast("Transcription Failed", error instanceof Error ? error.message : "Failed to transcribe audio", "error");
      return undefined;
    }
  };

  // Load speech service preference
  useEffect(() => {
    const loadSpeechService = async () => {
      try {
        // Initialize Google Speech service
        if (!googleSpeechRef.current) {
          googleSpeechRef.current = new GoogleSpeechService();
          console.log("Google Speech Service initialized");
        }
        
        // Load selected speech service
        const service = await window.electronAPI.getSpeechService() || 'whisper';
        console.log(`Selected speech service: ${service}`);
        setSpeechService(service as 'whisper' | 'google');
        
        // If Google is selected, load API key
        if (service === 'google') {
          const apiKey = await window.electronAPI.getGoogleSpeechApiKey();
          console.log(`Google API key retrieved: ${apiKey ? 'Yes (length: ' + apiKey.length + ')' : 'No'}`);
          
          if (apiKey && googleSpeechRef.current) {
            // Mask the API key for logging
            const maskedKey = maskApiKey(apiKey);
            console.log(`Setting Google Speech API key: ${maskedKey}`);
            
            // Set the API key in the service
            googleSpeechRef.current.setApiKey(apiKey);
          } else {
            // Fall back to whisper if no API key
            console.error("No Google Speech API key found, falling back to Whisper");
            setSpeechService('whisper');
            showToast('Warning', 'Google Speech API key not found, using Whisper instead', 'neutral');
          }
        }
      } catch (error) {
        console.error('Failed to load speech service:', error);
        setSpeechService('whisper'); // Fall back to whisper
      }
    };
    
    if (isInitialized) {
      loadSpeechService();
    }
  }, [isInitialized, showToast]);

  // --- START: Live Assistance Logic ---
  // Function to handle fetching AI assistance based on transcribed text
  const handleGenerateLiveAssistance = useCallback(async (transcribedQuestion: string) => {
    if (!transcribedQuestion.trim()) return;
    console.log("Generating live assistance for transcription:", transcribedQuestion);
    console.log("Context:", interviewContext);
    console.log("Resume Snippet:", resumeText.substring(0, 100) + "...");
    setGeneratedInterviewAnswer(''); // Clear previous assistance
    setIsAssistantProcessing(true);

    // Construct prompt for talking points/keywords
    const prompt = `Act as a helpful interview assistant providing concise talking points. Based ONLY on the provided resume text and job context, generate 2-3 brief bullet points or keywords relevant to answering the following transcribed potential interview question:

[Transcribed Question/Statement]:
${transcribedQuestion}

[Job Context]:
Title: ${interviewContext.jobTitle || 'N/A'}
Key Skills: ${interviewContext.keySkills || 'N/A'}
Company Mission/Values: ${interviewContext.companyMission || 'N/A'}

[Resume Text]:
${resumeText || 'N/A'}

Provide only the key talking points/keywords as bullet points, without any introductory or concluding remarks. If the resume or context is irrelevant, state that. Keep the points very brief.`;

    try {
      // Call the backend API for AI response
      const result = await window.electronAPI.handleAiQuery({ 
        query: prompt, // Use the structured prompt
        language: currentLanguage // Keep language context if needed, though prompt is English
      });

      if (result && result.success && typeof result.data === 'string') {
        setGeneratedInterviewAnswer(result.data);
      } else {
        console.error("AI Assistance Error:", result?.error || "Failed to get response.");
        setGeneratedInterviewAnswer("Error generating assistance."); // Show error in panel
      }
    } catch (error: any) {
      console.error("AI Communication Error:", error);
      setGeneratedInterviewAnswer("Error communicating with AI service."); // Show error in panel
    } finally {
      setIsAssistantProcessing(false);
    }
  }, [interviewContext, resumeText, currentLanguage]); // Dependencies: context, resume, language

  // Function to handle resume upload and text extraction
  const handleResumeUpload = useCallback(async (file: File) => {
    if (!file) return;
    console.log("Processing resume:", file.name);
    setResumeText('Processing...'); // Indicate processing
    setResumeFileName(file.name);
    try {
      // Assuming 'uploadResume' is set up in preload to call main process text extraction
      const extractedText = await window.electronAPI.uploadResume(file.path); 
      if (extractedText) {
        setResumeText(extractedText);
        showToast("Success", "Resume processed successfully.", "success");
      } else {
        setResumeText('');
        setResumeFileName('');
        showToast("Error", "Failed to extract text from resume.", "error");
      }
    } catch (error) {
        console.error("Error processing resume:", error);
        setResumeText('');
        setResumeFileName('');
        showToast("Error", "Failed to process resume.", "error");
    }
  }, [showToast]);

  // Update context state - passed down to panel
  const handleContextChange = useCallback((contextUpdate: Partial<typeof interviewContext>) => {
    setInterviewContext(prev => ({ ...prev, ...contextUpdate }));
  }, []);

  // --- END: Live Assistance Logic ---

  // --- Microphone Toggle --- // NEW
  const toggleMicrophone = useCallback(() => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  }, [isRecording, startRecording, stopRecording]);

  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <ToastContext.Provider value={{ showToast }}>
          <div className="relative bg-transparent">
            {isInitialized ? (
              hasApiKey ? (
                <SubscribedApp
                  credits={credits}
                  currentLanguage={currentLanguage}
                  setLanguage={updateLanguage}
                  onToggleChat={toggleChatPanel}
                  onToggleLiveAssistant={toggleLiveAssistant}
                  isLiveAssistantActive={isLiveAssistantActive}
                  isChatPanelOpen={isChatPanelOpen}
                />
              ) : (
                <WelcomeScreen onOpenSettings={handleOpenSettings} />
              )
            ) : (
              <div className="min-h-screen bg-black flex items-center justify-center">
                <div className="flex flex-col items-center gap-3">
                  <div className="w-6 h-6 border-2 border-white/20 border-t-white/80 rounded-full animate-spin"></div>
                  <p className="text-white/60 text-sm">
                    Initializing...
                  </p>
                </div>
              </div>
            )}
            <UpdateNotification />
          </div>
          
          {/* Settings Dialog */}
          <SettingsDialog 
            open={isSettingsOpen} 
            onOpenChange={handleCloseSettings} 
          />
          
          <Toast
            open={toastState.open}
            onOpenChange={(open) =>
              setToastState((prev) => ({ ...prev, open }))
            }
            variant={toastState.variant}
            duration={1500}
          >
            <ToastTitle>{toastState.title}</ToastTitle>
            <ToastDescription>{toastState.description}</ToastDescription>
          </Toast>
          <ToastViewport />
          
          {/* Live Assistant Panel - Rendered based on state */}
          {isLiveAssistantActive && (
            <VoiceTranscriptionPanel
              speechService={speechService}
              generatedAssistance={generatedInterviewAnswer}
              isAssistantProcessing={isAssistantProcessing}
              jobContext={interviewContext}
              resumeFileName={resumeFileName}
              onResumeUpload={handleResumeUpload}
              onContextChange={handleContextChange}
              onClose={deactivateLiveAssistant}
              onInterviewerTranscriptFinal={handleGenerateLiveAssistance}
              onClearLiveAssistance={handleClearLiveAssistanceDisplay}
            />
          )}
          
          {isChatPanelOpen && (
            <div className="fixed top-20 right-4 bottom-20 z-50 w-80 bg-white dark:bg-gray-800 shadow-2xl rounded-xl overflow-hidden flex flex-col border border-indigo-100 dark:border-gray-700">
              <div className="p-3 bg-gradient-to-r from-violet-600 to-indigo-700 flex justify-between items-center">
                <h3 className="font-medium text-white flex items-center text-sm">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="mr-1">
                    <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" fill="white"/>
                  </svg>
                  AI Assistant
                </h3>
                <button onClick={toggleChatPanel} className="text-white hover:text-gray-200 transition-colors">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>
              </div>
              
              <div className="flex-1 overflow-y-auto p-3 space-y-3 bg-gray-50 dark:bg-gray-900">
                {chatHistory.length === 0 && (
                  <div className="flex items-center justify-center h-full opacity-60">
                    <div className="text-center">
                      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="mx-auto mb-2 text-indigo-500">
                        <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" fill="currentColor"/>
                      </svg>
                      <p className="text-gray-500 dark:text-gray-400 text-sm">Ask a question</p>
                    </div>
                  </div>
                )}
                {chatHistory.map((msg, i) => (
                  <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[85%] p-2 rounded-lg text-sm ${
                      msg.role === 'user' 
                        ? 'bg-indigo-600 text-white rounded-tr-none shadow-sm' 
                        : 'bg-white dark:bg-gray-800 text-black dark:text-white rounded-tl-none shadow-md border border-gray-100 dark:border-gray-700'
                    }`}>
                      {msg.content}
                    </div>
                  </div>
                ))}
              </div>
              
              <div className="p-3 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
                <form 
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (chatInputValue.trim()) {
                      handleSendMessage(chatInputValue);
                    }
                  }}
                  className="flex space-x-2"
                >
                  <input
                    type="text"
                    value={chatInputValue}
                    onChange={(e) => setChatInputValue(e.target.value)}
                    className="flex-1 p-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-black dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm"
                    placeholder="Type your message..."
                  />
                  <button
                    type="submit"
                    disabled={!chatInputValue.trim()}
                    className="p-2 bg-gradient-to-r from-violet-600 to-indigo-700 hover:from-violet-500 hover:to-indigo-600 text-white rounded-lg disabled:opacity-50 transition-colors"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M22 2L11 13" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      <path d="M22 2L15 22L11 13L2 9L22 2Z" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </button>
                </form>
              </div>
            </div>
          )}
        </ToastContext.Provider>
      </ToastProvider>
    </QueryClientProvider>
  )
}

export default App