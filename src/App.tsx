import SubscribedApp from "./_pages/SubscribedApp"
import { UpdateNotification } from "./components/UpdateNotification"
import {
  QueryClient,
  QueryClientProvider
} from "@tanstack/react-query"
import { useEffect, useState, useCallback, useRef } from "react"
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

  // NEW: Whisper-based voice transcription
  const startRecording = useCallback(async () => {
    try {
      console.log("Attempting to access microphone...");
      
      // Request microphone access with more specific constraints for better quality
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 44100,
          channelCount: 1
        }
      });
      
      console.log("Microphone access granted!");
      console.log("Audio tracks:", stream.getAudioTracks().length);
      
      // Check audio track settings
      const audioTrack = stream.getAudioTracks()[0];
      if (audioTrack) {
        console.log("Audio track settings:", JSON.stringify(audioTrack.getSettings()));
      }
      
      // Try to use a format directly supported by OpenAI
      let mimeType = 'audio/webm';
      
      // Check for format support
      if (MediaRecorder.isTypeSupported('audio/webm')) {
        mimeType = 'audio/webm';
      } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
        mimeType = 'audio/mp4';
      } else if (MediaRecorder.isTypeSupported('audio/ogg')) {
        mimeType = 'audio/ogg';
      }
      
      console.log(`Using audio format: ${mimeType}`);
      console.log("Available media recorder formats:", MediaRecorder.isTypeSupported);
      
      // Important: Reset audio chunks arrays before starting new recording
      setAudioChunks([]);
      audioChunksRef.current = [];
      
      // Create recorder with options
      const options = { mimeType, audioBitsPerSecond: 128000 };
      console.log("Creating MediaRecorder with options:", options);
      const recorder = new MediaRecorder(stream, options);
      
      console.log("MediaRecorder state:", recorder.state);
      
      // Set up event handlers with enhanced logging
      recorder.onstart = () => {
        console.log("MediaRecorder started, state:", recorder.state);
      };
      
      recorder.onerror = (e) => {
        console.error("MediaRecorder error:", e);
      };
      
      recorder.ondataavailable = (e) => {
        console.log(`Received audio chunk: size=${e.data.size} bytes, type=${e.data.type}`);
        if (e.data.size > 0) {
          // Update both state and ref
          audioChunksRef.current.push(e.data);
          setAudioChunks(prevChunks => [...prevChunks, e.data]);
        } else {
          console.warn("Received empty audio chunk");
        }
      };
      
      recorder.onstop = async () => {
        console.log("MediaRecorder stopped, state:", recorder.state);
        try {
          // Get chunks from ref instead of state for reliability
          const chunks = audioChunksRef.current;
          
          console.log(`Processing ${chunks.length} audio chunks`);
          chunks.forEach((chunk, index) => {
            console.log(`Chunk ${index}: size=${chunk.size} bytes, type=${chunk.type}`);
          });
          
          if (!chunks.length) {
            console.error("No audio chunks collected");
            showToast("Recording Error", "No audio data was captured. Please try again.", "error");
            return;
          }
          
          // Create blob with explicit format
          const audioBlob = new Blob(chunks, { type: mimeType });
          
          // Log blob details for debugging
          console.log(`Audio blob created: type=${audioBlob.type}, size=${audioBlob.size} bytes, chunks=${chunks.length}`);
          
          if (audioBlob.size < 50) {  // Lower threshold to be more lenient
            console.error("Audio blob is too small");
            showToast("Recording Error", "Audio recording is too short or empty. Please try again and speak clearly.", "error");
            return;
          }
          
          // Additional test - try playing the audio to confirm it's valid
          try {
            const audioUrl = URL.createObjectURL(audioBlob);
            const audio = new Audio(audioUrl);
            audio.onloadedmetadata = () => {
              console.log("Audio metadata loaded. Duration:", audio.duration, "seconds");
            };
            // Don't actually play it to avoid annoying the user
          } catch (e) {
            console.warn("Failed to create test audio element:", e);
          }
          
          // Show processing message
          showToast("Processing", "Converting speech to text...", "neutral");
          
          // Send to Whisper API via electron bridge
          console.log("Sending audio blob to transcription service:", 
                     `type=${audioBlob.type}, size=${audioBlob.size}`);
          const result = await window.electronAPI.transcribeAudio(audioBlob);
          
          if (result && result.success && result.text) {
            console.log("Transcription successful:", result.text);
            // Set as chat input
            setChatInputValue(result.text);
            
            // Open chat panel if closed
            if (!isChatPanelOpen) {
              setIsChatPanelOpen(true);
            }
          } else {
            console.error("Transcription failed:", result?.error);
            showToast("Transcription Error", result?.error || "Failed to transcribe audio", "error");
          }
        } catch (error: any) {
          console.error("Transcription error:", error);
          showToast("Transcription Error", error.message || "Failed to process audio", "error");
        }
        
        // Stop all tracks to release microphone
        stream.getTracks().forEach(track => {
          console.log("Stopping audio track:", track.label);
          track.stop();
        });
      };
      
      // Start recording with longer timeslices to get more substantial chunks
      console.log("Starting MediaRecorder...");
      recorder.start(300); // Collect data every 300ms
      setMediaRecorder(recorder);
      setIsRecording(true);
      showToast("Recording", "Listening... Click mic again to stop", "success");
      
    } catch (error: any) {
      console.error("Recording error:", error);
      showToast("Microphone Error", error.message || "Failed to access microphone", "error");
    }
  }, [showToast, isChatPanelOpen]);
  
  const stopRecording = useCallback(() => {
    console.log("Stop recording requested");
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      console.log("Stopping MediaRecorder, current state:", mediaRecorder.state);
      
      try {
        // Force a dataavailable event before stopping
        console.log("Requesting final data chunk");
        mediaRecorder.requestData();
        
        // Small delay to ensure the requestData completes
        setTimeout(() => {
          console.log("Stopping recorder after delay");
          try {
            mediaRecorder.stop();
            console.log("MediaRecorder stopped");
          } catch (e) {
            console.error("Error stopping MediaRecorder:", e);
          }
          setIsRecording(false);
        }, 500); // Increased delay for better reliability
      } catch (e) {
        console.error("Error in stopRecording:", e);
        setIsRecording(false);
      }
    } else {
      console.log("MediaRecorder not active, state:", mediaRecorder?.state || "no recorder");
    }
  }, [mediaRecorder]);

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

  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <ToastContext.Provider value={{ showToast }}>
          <div className="relative">
            {isInitialized ? (
              hasApiKey ? (
                <SubscribedApp
                  credits={credits}
                  currentLanguage={currentLanguage}
                  setLanguage={updateLanguage}
                  isMicActive={false}
                  onToggleVoice={onToggleVoiceInput}
                  onToggleChat={toggleChatPanel}
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