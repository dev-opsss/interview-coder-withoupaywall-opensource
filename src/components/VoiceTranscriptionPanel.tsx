import React, { useRef, useCallback, useState, useEffect } from 'react';
import { AiPersonalitySettingsModal } from './AiPersonalitySettingsModal';
import { availablePersonalities, DEFAULT_PERSONALITY } from '../constants/aiConstants';
import { useSmartVoiceDetection } from '../hooks/useSmartVoiceDetection';
import { TranscriptDisplay } from './TranscriptDisplay';

// Define types for props
interface VoiceTranscriptionPanelProps {
  speechService: 'whisper' | 'google';
  // --- Live Assistant Props ---
  generatedAssistance: string;
  isAssistantProcessing: boolean;
  jobContext: { jobTitle: string; keySkills: string; companyMission: string };
  resumeFileName: string;
  onResumeUpload: (file: File) => void;
  onContextChange: (contextUpdate: Partial<{ jobTitle: string; keySkills: string; companyMission: string }>) => void;
  onClose: () => void;
}

// Interface for transcript entries
interface TranscriptEntry {
  speaker: 'user' | 'interviewer';
  text: string;
  timestamp: number;
  words?: { word: string, startTime: number, endTime: number }[];
}

export const VoiceTranscriptionPanel: React.FC<VoiceTranscriptionPanelProps> = ({
  speechService,
  generatedAssistance,
  isAssistantProcessing,
  jobContext,
  resumeFileName,
  onResumeUpload,
  onContextChange,
  onClose,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  // --- State for AI Personality Settings ---
  const [isPersonalitySettingsOpen, setIsPersonalitySettingsOpen] = useState(false);
  const [selectedPersonality, setSelectedPersonality] = useState(DEFAULT_PERSONALITY);
  const [resumeTextContent, setResumeTextContent] = useState<string | null>(null);
  const [interviewStage, setInterviewStage] = useState('Initial Screening');
  const [userPreferences, setUserPreferences] = useState('');

  // --- State for Response Suggestion ---
  const [suggestedResponse, setSuggestedResponse] = useState<string>('');
  const [isGeneratingResponse, setIsGeneratingResponse] = useState<boolean>(false);
  
  // --- Auto Mode States ---
  const [autoMode, setAutoMode] = useState<boolean>(false);
  const [voiceStatus, setVoiceStatus] = useState<'idle' | 'listening' | 'speaking' | 'processing'>('idle');

  // --- Speaker Detection ---
  const [speakerRole, setSpeakerRole] = useState<'user' | 'interviewer'>('user');
  const [audioInputDevices, setAudioInputDevices] = useState<MediaDeviceInfo[]>([]);
  const [speakerAudioInputDevices, setSpeakerAudioInputDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedSpeakerDeviceId, setSelectedSpeakerDeviceId] = useState<string | null>(null);
  const [selectedMicrophoneDeviceId, setSelectedMicrophoneDeviceId] = useState<string | null>(null);
  
  // --- State for displaying transcript --- 
  const [displayTranscript, setDisplayTranscript] = useState('');
  const [transcriptEntries, setTranscriptEntries] = useState<TranscriptEntry[]>([]);
  const [lastSpeaker, setLastSpeaker] = useState<'user' | 'interviewer' | null>(null);

  // --- Handlers for VAD events (passed to the hook) ---
  const handleDetectedSpeechStart = useCallback((role: 'user' | 'interviewer') => {
    console.log(`VoiceTranscriptionPanel: Detected speech start from: ${role}`);
    setVoiceStatus('speaking');
    setLastSpeaker(role); // Set who started speaking
  }, []);

  const handleSpeechSegment = useCallback(async (audioBlob: Blob, role: 'user' | 'interviewer') => {
    console.log(`VoiceTranscriptionPanel: Received speech segment from ${role}, size: ${audioBlob.size}`);
    setVoiceStatus('processing');
    try {
      // Convert Blob to ArrayBuffer for sending over IPC
      const arrayBuffer = await audioBlob.arrayBuffer();
      
      // Create transcription payload with MIME type to help with format detection
      const transcribePayload = {
        buffer: arrayBuffer,
        mimeType: audioBlob.type || 'audio/mpeg' // Default to mp3 if not set
      };
      
      // Call the transcription API
      const result = await window.electronAPI.transcribeAudio(transcribePayload);
      
      if (result && result.success && result.text) {
        const transcribedText = result.text;
        console.log(`${role} Transcription: "${transcribedText}"`);
        
        // Create a new transcript entry
        const newEntry: TranscriptEntry = {
          speaker: role,
          text: transcribedText,
          timestamp: Date.now()
        };
        
        // Add word timing information if available
        if (result.words && Array.isArray(result.words)) {
          console.log(`Adding ${result.words.length} words with timing information`);
          newEntry.words = result.words;
        }
        
        // Update transcript entries
        setTranscriptEntries(prev => [...prev, newEntry]);
        
        // Also update text-only transcript for backward compatibility
        setDisplayTranscript(prev => `${prev}${role === 'user' ? 'You' : 'Interviewer'}: ${transcribedText}\n`); 
      } else {
        console.error(`${role} Transcription failed:`, result?.error);
        // Show error in transcript to alert user
        const errorText = result?.error || 'Unknown transcription error';
        const errorShortened = errorText.includes('Google Speech API') 
          ? 'Google Speech API error - check API key in settings' 
          : errorText;
        
        // Add error to transcript entries
        setTranscriptEntries(prev => [
          ...prev, 
          {
            speaker: role,
            text: `[Error: ${errorShortened}]`,
            timestamp: Date.now()
          }
        ]);
        
        // Also update text-only transcript
        setDisplayTranscript(prev => `${prev}[Error: ${errorShortened}]\n`);
        
        // Show alert for major errors that require user action
        if (errorText.includes('API key')) {
          alert(`Speech-to-text error: ${errorText}\n\nPlease check your speech service settings and API key.`);
        }
      }
    } catch (error) {
      console.error(`Error during ${role} transcription IPC:`, error);
      
      // Add error to transcript entries
      setTranscriptEntries(prev => [
        ...prev, 
        {
          speaker: role,
          text: `[IPC Error: Transcription service unavailable]`,
          timestamp: Date.now()
        }
      ]);
      
      // Also update text-only transcript
      setDisplayTranscript(prev => `${prev}[IPC Error: Transcription service unavailable]\n`);
    } finally {
      // Go back to listening state unless generating suggestion
      if (!isGeneratingResponse) {
          setVoiceStatus('listening');
      }
    }
  }, [isGeneratingResponse]);

  const handleSilenceAfterSpeech = useCallback(async (audioBlob: Blob, role: 'user' | 'interviewer') => {
    console.log(`VoiceTranscriptionPanel: Silence detected after ${role} speech. Blob size: ${audioBlob.size}`);
    if (!autoMode) return; // Only trigger auto-suggestions in auto mode

    setIsGeneratingResponse(true);
    setVoiceStatus('processing');
    setSuggestedResponse(''); // Clear previous

    try {
      // Convert Blob to ArrayBuffer for sending over IPC
      const arrayBuffer = await audioBlob.arrayBuffer();
      
      // Create transcription payload with MIME type to help with format detection
      const transcribePayload = {
        buffer: arrayBuffer,
        mimeType: audioBlob.type || 'audio/mpeg' // Default to mp3 if not set
      };
      
      // Transcribe the final blob first (might be redundant if handleSpeechSegment did it)
      const transcriptionResult = await window.electronAPI.transcribeAudio(transcribePayload);
      
      if (transcriptionResult && transcriptionResult.success && transcriptionResult.text) {
         const transcribedText = transcriptionResult.text;
         console.log(`${role} Final Transcription (after silence): "${transcribedText}"`);
         
         // Create a new transcript entry
         const newEntry: TranscriptEntry = {
           speaker: role,
           text: transcribedText,
           timestamp: Date.now()
         };
         
         // Add word timing information if available
         if (transcriptionResult.words && Array.isArray(transcriptionResult.words)) {
           console.log(`Adding ${transcriptionResult.words.length} words with timing information to final transcription`);
           newEntry.words = transcriptionResult.words;
         }
         
         // Update transcript entries
         setTranscriptEntries(prev => [...prev, newEntry]);
         
         // Update display transcript one last time for this segment
         setDisplayTranscript(prev => `${prev}${role === 'user' ? 'You' : 'Interviewer'}: ${transcribedText}\n`); 

         // Now request the suggestion
         const payload = {
           question: transcribedText, 
           jobContext: jobContext,
           resumeTextContent: resumeTextContent,
           speakerRole: role 
         };
         console.log("Auto-requesting response suggestion with payload:", payload);
         const suggestionResult = await window.electronAPI.generateResponseSuggestion(payload);

         if (suggestionResult && suggestionResult.success && suggestionResult.data) {
           setSuggestedResponse(suggestionResult.data);
           if (window.electronAPI.updateAssistanceDisplay) {
             window.electronAPI.updateAssistanceDisplay(suggestionResult.data);
           }
           console.log("Auto-response generated successfully");
         } else {
           console.error("Auto-response generation failed:", suggestionResult?.error);
           setSuggestedResponse(`Error: ${suggestionResult?.error || 'Unknown error'}`);
         }
      } else {
         console.error(`${role} Transcription failed (after silence):`, transcriptionResult?.error);
         setSuggestedResponse(`Transcription Error: ${transcriptionResult?.error}`);
      }
    } catch (error: any) {
      console.error("Error in auto-suggestion processing:", error);
      setSuggestedResponse(`Error: ${error.message || error}`);
    } finally {
      setIsGeneratingResponse(false);
      setVoiceStatus('listening'); // Go back to listening after processing
    }
  }, [autoMode, jobContext, resumeTextContent]);

  // --- Instantiate the hook directly --- 
  const {
    isListening,
    isSpeaking, // Combined state reflects if *either* mic is active
    startListening,
    stopListening,
  } = useSmartVoiceDetection({
    speakerDeviceId: selectedSpeakerDeviceId,
    microphoneDeviceId: selectedMicrophoneDeviceId,
    onSpeechStart: handleDetectedSpeechStart,
    onSpeechEnd: handleSpeechSegment, // Call handler for each speech segment end
    onSilenceAfterSpeech: handleSilenceAfterSpeech, // Call handler after silence
    autoSuggest: true 
  });

  // --- Fetch initial settings on mount ---
  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const settings = await window.electronAPI.invoke('get-ai-settings');
        if (settings) {
          setSelectedPersonality(settings.personality || DEFAULT_PERSONALITY);
          setInterviewStage(settings.interviewStage || 'Initial Screening');
          setUserPreferences(settings.userPreferences || '');
          // Initialize auto mode from settings if available
          if (settings.autoMode !== undefined) {
            setAutoMode(settings.autoMode);
          }
        }
      } catch (error) {
        console.error("Failed to fetch AI settings:", error);
        // Keep defaults if fetch fails
      }
    };
    fetchSettings();

    // --- NEW: Fetch Audio Devices & Settings ---
    const fetchAudioDevicesAndSettings = async () => {
      try {
        // Request permission first (needed for device labels)
        await navigator.mediaDevices.getUserMedia({ audio: true }); 
        // Enumerate devices
        const devices = await navigator.mediaDevices.enumerateDevices();
        const audioInputs = devices.filter(device => device.kind === 'audioinput');
        setAudioInputDevices(audioInputs);
        setSpeakerAudioInputDevices(audioInputs);
        console.log('Available audio input devices (for both dropdowns):', audioInputs);

        // Load saved settings
        const savedSettings = await window.electronAPI.getAudioDeviceSettings();
        if (savedSettings) {
          console.log('Loaded audio device settings:', savedSettings);
          // Validate saved IDs against current list
          const isValidSpeaker = audioInputs.some(d => d.deviceId === savedSettings.speakerDeviceId);
          const isValidMic = audioInputs.some(d => d.deviceId === savedSettings.microphoneDeviceId);
          setSelectedSpeakerDeviceId(isValidSpeaker ? savedSettings.speakerDeviceId : (audioInputs[0]?.deviceId || null));
          setSelectedMicrophoneDeviceId(isValidMic ? savedSettings.microphoneDeviceId : (audioInputs[0]?.deviceId || null));
        } else {
          // Set defaults if no settings saved (e.g., first device for both initially)
          if (audioInputs.length > 0) {
             setSelectedSpeakerDeviceId(audioInputs[0].deviceId);
             setSelectedMicrophoneDeviceId(audioInputs[0].deviceId);
             console.log('Setting default audio devices to first available for both speaker and mic.');
          }
        }
      } catch (error) {
        console.error("Failed to fetch audio devices or settings:", error);
        // Handle error - maybe show a message to the user
      }
    };
    fetchAudioDevicesAndSettings();

    // Listener for device changes (optional but recommended)
    const handleDeviceChange = async () => {
      console.log('Audio devices changed, re-fetching...');
      // Re-run the fetch logic
      await fetchAudioDevicesAndSettings();
    };
    navigator.mediaDevices.addEventListener('devicechange', handleDeviceChange);

    // Cleanup listener
    return () => {
      navigator.mediaDevices.removeEventListener('devicechange', handleDeviceChange);
    };
    // --- END: Fetch Audio Devices & Settings ---

  }, []); // Empty dependency array means run once on mount

  // --- Handler to save specific settings from Modal ---
  const handleSaveModalSettings = async (stage: string, prefs: string) => {
    try {
      // Save only stage and prefs
      await window.electronAPI.invoke('save-ai-settings', { 
        interviewStage: stage, 
        userPreferences: prefs 
      });
      // Update local state
      setInterviewStage(stage);
      setUserPreferences(prefs);
      setIsPersonalitySettingsOpen(false); 
      console.log('AI stage/prefs saved successfully.');
    } catch (error) {
      console.error("Failed to save AI modal settings:", error);
    }
  };

  // --- Handler for direct personality change from Header Dropdown ---
  const handlePersonalityChange = async (event: React.ChangeEvent<HTMLSelectElement>) => {
    const newPersonality = event.target.value;
    setSelectedPersonality(newPersonality); // Update UI immediately
    try {
      // Save just the personality
      await window.electronAPI.invoke('save-ai-settings', { personality: newPersonality });
      console.log(`AI personality saved: ${newPersonality}`);
    } catch (error) {
      console.error("Failed to save AI personality setting:", error);
      // Optionally revert UI or show error
    }
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      try {
        const extractedText = await window.electronAPI.invoke('extract-resume-text', file.path);
        if (extractedText !== null) {
          setResumeTextContent(extractedText);
          onResumeUpload(file);
          console.log(`Resume text extracted successfully (length: ${extractedText.length})`);
        } else {
          setResumeTextContent(null);
          console.error("Failed to extract resume text.");
        }
      } catch (error) {
        setResumeTextContent(null);
        console.error("Error calling extract-resume-text:", error);
      }
    }
    if (fileInputRef.current) {
        fileInputRef.current.value = "";
    }
  };

  // Helper for context input changes
  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = event.target;
    onContextChange({ [name]: value });
  };

  // --- Toggle automatic mode ---
  const toggleAutoMode = useCallback(async () => {
    const newAutoMode = !autoMode;
    setAutoMode(newAutoMode);
    console.log(`Auto mode toggled: ${newAutoMode}`);
    try {
      await window.electronAPI.saveAiSettings({ autoMode: newAutoMode });
      if (newAutoMode) {
        console.log('Auto mode ON, calling startListening()');
        startListening(); // Start hook's listening process
        setVoiceStatus('listening');
      } else {
        console.log('Auto mode OFF, calling stopListening()');
        stopListening(); // Stop hook's listening process
        setVoiceStatus('idle');
      }
    } catch (error) {
      console.error("Failed to save auto mode setting:", error);
      // Revert state if save failed?
      setAutoMode(!newAutoMode);
    }
  }, [autoMode, startListening, stopListening]);

  // --- Toggle speaker role ---
  const toggleSpeakerRole = useCallback(() => {
    setSpeakerRole(prevRole => prevRole === 'user' ? 'interviewer' : 'user');
  }, []);

  // --- Transcript scroll effect ---
  const transcriptContainerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (transcriptContainerRef.current) {
      transcriptContainerRef.current.scrollTop = transcriptContainerRef.current.scrollHeight;
    }
  }, [displayTranscript]); // Scroll when display transcript changes

  // --- NEW: Handlers for Audio Device Selection Change ---
  const handleSpeakerDeviceChange = async (event: React.ChangeEvent<HTMLSelectElement>) => {
    const deviceId = event.target.value;
    setSelectedSpeakerDeviceId(deviceId);
    try {
      await window.electronAPI.saveAudioDeviceSettings({ speakerDeviceId: deviceId });
      console.log(`Speaker device saved: ${deviceId}`);
    } catch (error) {
      console.error("Failed to save speaker device setting:", error);
      // Optionally show error to user
    }
  };

  const handleMicrophoneDeviceChange = async (event: React.ChangeEvent<HTMLSelectElement>) => {
    const deviceId = event.target.value;
    setSelectedMicrophoneDeviceId(deviceId);
    try {
      await window.electronAPI.saveAudioDeviceSettings({ microphoneDeviceId: deviceId });
      console.log(`Microphone device saved: ${deviceId}`);
    } catch (error) {
      console.error("Failed to save microphone device setting:", error);
      // Optionally show error to user
    }
  };
  // --- END: Handlers for Audio Device Selection Change ---

  return (
    <>
      <div className="fixed bottom-4 left-1/2 transform -translate-x-1/2 w-11/12 max-w-4xl bg-black/95 dark:bg-gray-900/95 rounded-lg shadow-2xl border border-indigo-200/50 dark:border-indigo-500/30 z-[800] overflow-hidden flex flex-col max-h-[80vh] motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-500">
        {/* Header */}
        <div className="p-3 bg-gradient-to-r from-purple-600 to-indigo-700 flex justify-between items-center flex-shrink-0 border-b border-indigo-300/20">
          <div className="flex items-center space-x-2">
            {/* --- Hide Manual Mic Button in Auto Mode --- */} 
            {!autoMode && (
              <button 
                className={`flex items-center justify-center w-7 h-7 rounded-full transition-colors ${ 
                  isListening // Use hook's isListening state for visual
                    ? "bg-red-500 hover:bg-red-600 text-white shadow-md"
                    : "bg-white/30 hover:bg-white/40 text-white shadow-sm"
                }`}
                onClick={isListening ? stopListening : startListening} // Use hook functions
                title={isListening ? "Stop Listening" : "Start Listening"}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                  <line x1="12" y1="19" x2="12" y2="23"/>
                  <line x1="8" y1="23" x2="16" y2="23"/>
                </svg>
              </button>
            )}

            {/* Auto Mode Toggle */}
            <div className="flex items-center">
              <label className="inline-flex items-center cursor-pointer">
                <input 
                  type="checkbox" 
                  checked={autoMode} 
                  onChange={toggleAutoMode} 
                  className="sr-only peer"
                />
                <div className="relative w-9 h-5 bg-white/30 rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-white after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-500 shadow-inner"></div>
                <span className="ms-1 text-xs font-medium text-white">
                  Auto
                  {/* Use combined isSpeaking from hook for pulse */} 
                  {isSpeaking && <span className="ml-1 inline-block w-2 h-2 bg-red-500 rounded-full animate-pulse shadow-red-500/50 shadow-sm"></span>}
                </span>
              </label>
            </div>

            {/* Speaker Role Toggle */}
            <div className="flex items-center ml-2">
              <button
                onClick={toggleSpeakerRole}
                className={`flex items-center text-xs px-2 py-1 rounded-full transition-colors shadow-sm ${
                  speakerRole === 'user' 
                    ? 'bg-blue-100 text-blue-700 hover:bg-blue-200 dark:bg-blue-900/50 dark:text-blue-300 border border-blue-200/50 dark:border-blue-800/50'
                    : 'bg-purple-100 text-purple-700 hover:bg-purple-200 dark:bg-purple-900/50 dark:text-purple-300 border border-purple-200/50 dark:border-purple-800/50'
                }`}
              >
                <span className="mr-1">
                  {speakerRole === 'user' ? 'You' : 'Interviewer'}
                </span>
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M8 12h.01M12 12h.01M16 12h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z"/>
                </svg>
              </button>
            </div>

            {/* --- Personality Dropdown --- */}
            <select
              value={selectedPersonality}
              onChange={handlePersonalityChange}
              className="text-xs h-7 bg-white/30 text-white rounded border-none focus:ring-1 focus:ring-white/50 pl-2 pr-6 appearance-none shadow-sm"
              aria-label="AI Personality"
              style={{ 
                backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3E%3Cpath stroke='%23ffffff' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3E%3C/svg%3E")`, 
                backgroundPosition: 'right 0.3rem center', 
                backgroundRepeat: 'no-repeat', 
                backgroundSize: '1.2em 1.2em' 
              }} // Minimal styling, adjust as needed
            >
              {availablePersonalities.map(p => (
                <option key={p} value={p} className="text-black dark:text-white bg-transparent dark:bg-gray-700">{p}</option>
              ))}
            </select>

            {/* Settings Button (Gear Icon) - Opens Modal for Stage/Prefs */}
            <button
              className="flex items-center justify-center w-7 h-7 rounded-full bg-white/30 hover:bg-white/40 text-white transition-colors shadow-sm"
              onClick={() => setIsPersonalitySettingsOpen(true)}
              title="AI Context Settings (Interview Stage, Preferences)"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                {/* Gear Icon Path */}
                <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.09a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>
                <circle cx="12" cy="12" r="3"/>
              </svg>
            </button>

            {/* Title */}
            <h3 className="font-medium text-white flex items-center text-sm">
              {/* Removed icon from here */}
              {/* {isRecording ? "Recording..." : isTranscribing ? "Transcribing..." : "Live Assistant"} - Title simplified */}
              Live Assistant
              {speechService && <span className="ml-2 text-xs bg-white/30 px-2 py-0.5 rounded-full shadow-sm">{speechService === 'whisper' ? 'OpenAI Whisper' : 'Google Speech'}</span>}
            </h3>
          </div>

          {/* Close Button */}
          <button 
            onClick={onClose} 
            className="text-white hover:text-white/80 transition-colors p-1 rounded-full hover:bg-white/20 shadow-sm focus:outline-none focus:ring-1 focus:ring-white/30"
            aria-label="Close Assistant Panel"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>
        
        {/* Main Content Area (Scrollable) */}
        <div className="flex-1 overflow-y-auto p-4 grid grid-cols-3 gap-4 bg-black dark:bg-gray-900">
          
          {/* Left Column: Context, Resume & Audio Settings */} 
          <div className="col-span-1 space-y-4">
            <h4 className="text-sm font-medium text-gray-200 dark:text-gray-200 border-b border-gray-700 dark:border-gray-700 pb-1 mb-2">Context</h4>
            <div>
              <label htmlFor="jobTitle" className="block text-xs font-medium text-gray-300 dark:text-gray-300 mb-1">Job Title</label>
              <input 
                type="text" 
                id="jobTitle"
                name="jobTitle"
                value={jobContext.jobTitle}
                onChange={handleInputChange}
                className="w-full p-1.5 border border-gray-700 dark:border-gray-700 rounded bg-gray-800/70 dark:bg-gray-800/70 text-white dark:text-white text-xs focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
                placeholder="e.g., Software Engineer"
              />
            </div>
            <div>
              <label htmlFor="keySkills" className="block text-xs font-medium text-gray-300 dark:text-gray-300 mb-1">Key Skills</label>
              <textarea 
                id="keySkills"
                name="keySkills"
                rows={3}
                value={jobContext.keySkills}
                onChange={handleInputChange}
                className="w-full p-1.5 border border-gray-700 dark:border-gray-700 rounded bg-gray-800/70 dark:bg-gray-800/70 text-white dark:text-white text-xs focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
                placeholder="e.g., React, Node.js, Python"
              />
            </div>
            <div>
              <label htmlFor="companyMission" className="block text-xs font-medium text-gray-300 dark:text-gray-300 mb-1">Company Mission/Values</label>
              <textarea 
                id="companyMission"
                name="companyMission"
                rows={3}
                value={jobContext.companyMission}
                onChange={handleInputChange}
                className="w-full p-1.5 border border-gray-700 dark:border-gray-700 rounded bg-gray-800/70 dark:bg-gray-800/70 text-white dark:text-white text-xs focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
                placeholder="e.g., Innovation, Customer Focus"
              />
            </div>
            
            <h4 className="text-sm font-medium text-gray-200 dark:text-gray-200 border-b border-gray-700 dark:border-gray-700 pb-1 mb-2 pt-2">Resume</h4>
            <div>
               <input 
                 type="file" 
                 ref={fileInputRef}
                 onChange={handleFileChange} 
                 accept=".txt,.pdf,.docx" 
                 className="hidden" // Hide default input
                 id="resume-upload"
               />
               <button 
                 onClick={() => fileInputRef.current?.click()} 
                 className="w-full text-xs px-3 py-1.5 border border-dashed border-indigo-500 dark:border-indigo-500 text-indigo-400 dark:text-indigo-400 rounded bg-gray-800/70 dark:bg-gray-800/70 hover:bg-gray-700/70 dark:hover:bg-gray-700/70 transition-colors"
               >
                 {resumeFileName ? `Uploaded: ${resumeFileName}` : "Upload Resume (.txt, .pdf, .docx)"}
               </button>
            </div>

            {/* --- NEW: Audio Settings Section --- */} 
            <h4 className="text-sm font-medium text-gray-200 dark:text-gray-200 border-b border-gray-700 dark:border-gray-700 pb-1 mb-2 pt-2">Audio Settings</h4>
            
            {/* Speaker Device Dropdown */} 
            <div>
              <label htmlFor="speakerDevice" className="block text-xs font-medium text-gray-300 dark:text-gray-300 mb-1">Speaker Audio (Virtual Device)</label>
              <select 
                id="speakerDevice"
                value={selectedSpeakerDeviceId || ''} 
                onChange={handleSpeakerDeviceChange}
                className="w-full p-1.5 border border-gray-700 dark:border-gray-700 rounded bg-gray-800/70 text-white text-xs focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
                disabled={speakerAudioInputDevices.length === 0}
              >
                <option value="" disabled>-- Select Virtual Device Output --</option>
                {speakerAudioInputDevices.map(device => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label || `Device ${device.deviceId.substring(0, 8)}`}
                  </option>
                ))}
              </select>
               {/* <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Select the output of your virtual audio device (e.g., BlackHole, VB-Cable) that receives audio from your meeting app.</p> */}
            </div>
            
            {/* Microphone Device Dropdown */} 
             <div>
              <label htmlFor="microphoneDevice" className="block text-xs font-medium text-gray-300 dark:text-gray-300 mb-1">Microphone Input</label>
              <select 
                id="microphoneDevice"
                value={selectedMicrophoneDeviceId || ''} 
                onChange={handleMicrophoneDeviceChange}
                className="w-full p-1.5 border border-gray-700 dark:border-gray-700 rounded bg-gray-800/70 text-white text-xs focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
                disabled={audioInputDevices.length === 0}
              >
                 <option value="" disabled>-- Select Your Microphone --</option>
                {audioInputDevices.map(device => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label || `Device ${device.deviceId.substring(0, 8)}`}
                  </option>
                ))}
              </select>
               {/* <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Select your primary microphone.</p> */}
            </div>

            {/* --- NEW: Detailed Instructions --- */} 
            <div className="mt-3 p-3 bg-gray-800/70 dark:bg-gray-800/70 rounded-lg border border-gray-700 dark:border-gray-700 shadow-sm text-xs text-gray-300 dark:text-gray-300 space-y-2">
                <p><strong>Why Virtual Audio Device?</strong> To capture the interviewer's audio (from Zoom, Teams, etc.), this app needs a virtual audio device. Standard microphone access only captures your voice.</p>
                <p><strong>Recommended Tools:</strong></p>
                <ul className="list-disc list-inside pl-2">
                    <li>macOS: <a href="https://github.com/ExistentialAudio/BlackHole" target="_blank" rel="noopener noreferrer" className="text-indigo-400 dark:text-indigo-400 hover:underline font-medium">BlackHole</a> (Free, Open Source)</li>
                    <li>Windows/macOS: <a href="https://vb-audio.com/Cable/" target="_blank" rel="noopener noreferrer" className="text-indigo-400 dark:text-indigo-400 hover:underline font-medium">VB-CABLE</a> (Free)</li>
                    <li>Windows: <a href="https://vb-audio.com/Voicemeeter/" target="_blank" rel="noopener noreferrer" className="text-indigo-400 dark:text-indigo-400 hover:underline font-medium">VoiceMeeter</a> (More advanced, Free)</li>
                </ul>
                 <p><strong>Setup Steps:</strong></p>
                 <ol className="list-decimal list-inside pl-2 space-y-1">
                     <li>Install a virtual audio device from the links above.</li>
                     <li>In your <strong>System Settings</strong> or your <strong>Meeting App (Zoom/Teams)</strong>, set the <strong>Audio Output / Speaker</strong> to the virtual device's <strong>INPUT</strong> (e.g., "BlackHole Input", "VB-Cable Input").</li>
                     <li>In <strong>this app</strong> (above), select the virtual device's <strong>OUTPUT</strong> (e.g., "BlackHole Output", "VB-Cable Output") as the "Speaker Audio" source.</li>
                     <li>Select your actual microphone under "Microphone Input".</li>
                 </ol>
                 <p>This routes the interviewer's audio through the virtual device so the app can hear it separately from your microphone.</p>
             </div>
            {/* --- END: Detailed Instructions --- */} 

            {/* --- END: Audio Settings Section --- */}
          </div>

          {/* Right Columns: Transcription & Assistance & RESPONSE SUGGESTION */} 
          <div className="col-span-2 space-y-3"> {/* Reduced gap slightly */} 
            {/* Transcription Area - Use displayTranscript */}
            <div>
              <div className="flex justify-between items-center mb-2">
                 <h4 className="text-sm font-medium text-gray-200 dark:text-gray-200 border-b border-gray-700 dark:border-gray-700 pb-1">Detected Speech / Question</h4>
                 {/* Removed button */}
              </div>
              
              {/* New TranscriptDisplay for YouTube-like captions */}
              {speechService === 'google' ? (
                <TranscriptDisplay 
                  entries={transcriptEntries}
                  className="min-h-[60px] max-h-[200px] bg-gray-800/70 dark:bg-gray-800/70 rounded-lg border border-gray-700 dark:border-gray-700 shadow-sm p-2"
                />
              ) : (
                /* Legacy transcript display for Whisper */
              <div ref={transcriptContainerRef} className="min-h-[60px] max-h-[200px] overflow-y-auto p-3 bg-gray-800/70 dark:bg-gray-800/70 rounded-lg border border-gray-700 dark:border-gray-700 shadow-sm">
                  {displayTranscript ? (
                      <div className="text-gray-200 dark:text-gray-200 whitespace-pre-line text-sm">
                          {displayTranscript.split('\n').map((line, index) => <div key={index} className="py-0.5">{line}</div>)}
                      </div>
                  ) : (
                      <p className="text-gray-400 dark:text-gray-400 italic text-sm">
                          {isListening ? 'Listening...' : (autoMode ? 'Auto mode enabled. Waiting for speech...' : 'Turn on Auto mode or click Mic to start.')}
                      </p>
                  )}
              </div>
              )}
            </div>
            
            {/* --- AI Response Suggestion Area --- */}
            <div>
              <h4 className="text-sm font-medium text-gray-200 dark:text-gray-200 border-b border-gray-700 dark:border-gray-700 pb-1 mb-2">AI Response Suggestion</h4>
               <div className="min-h-[80px] p-3 bg-gray-800/70 dark:bg-gray-800/70 rounded-lg border border-gray-700 dark:border-gray-700 shadow-sm">
                {isGeneratingResponse && (
                   <div className="flex items-center text-green-400 dark:text-green-400 italic text-sm">
                     {/* Loading dots */}
                      <div className="flex space-x-1 mr-2">
                        <div className="animate-bounce h-2 w-2 bg-green-500 rounded-full" style={{ animationDelay: '0ms' }}></div>
                        <div className="animate-bounce h-2 w-2 bg-green-500 rounded-full" style={{ animationDelay: '150ms' }}></div>
                        <div className="animate-bounce h-2 w-2 bg-green-500 rounded-full" style={{ animationDelay: '300ms' }}></div>
                      </div>
                      Generating response suggestion...
                   </div>
                 )}
                {!isGeneratingResponse && suggestedResponse && (
                  <div className="bg-gray-700/90 dark:bg-gray-700/90 rounded-lg p-4 border border-gray-600 dark:border-gray-600 shadow-sm animate-fade-in relative">
                    <div className="absolute top-2 right-2 bg-green-800/90 dark:bg-green-800/90 text-green-300 dark:text-green-300 text-xs px-2 py-1 rounded-full font-medium">Auto-generated</div>
                    <div className="text-gray-200 dark:text-gray-200 whitespace-pre-line font-medium">
                      {suggestedResponse.split('\n').map((line, index) => (
                        <React.Fragment key={index}>
                          {line}
                          {index < suggestedResponse.split('\n').length - 1 && <br />}
                        </React.Fragment>
                      ))}
                    </div>
                  </div>
                 )}
                 {/* Show placeholder if idle and no response */} 
                 {!isGeneratingResponse && !suggestedResponse && (
                   <p className="text-gray-400 dark:text-gray-400 italic text-sm">AI suggestions will appear here automatically after you stop recording (if speech was detected).</p>
                 )}
               </div>
            </div>
            
            {/* AI Assistance Area (Talking Points) - Kept for now */}
            <div>
              <h4 className="text-sm font-medium text-gray-200 dark:text-gray-200 border-b border-gray-700 dark:border-gray-700 pb-1 mb-2">AI Assistance (Talking Points)</h4>
               <div className="min-h-[60px] p-3 bg-gray-800/70 dark:bg-gray-800/70 rounded-lg border border-gray-700 dark:border-gray-700 shadow-sm">
                {isAssistantProcessing && (
                   <div className="flex items-center text-indigo-400 dark:text-indigo-400 italic text-sm">
                     {/* Loading dots */}
                      <div className="flex space-x-1 mr-2">
                        <div className="animate-bounce h-2 w-2 bg-indigo-500 rounded-full" style={{ animationDelay: '0ms' }}></div>
                        <div className="animate-bounce h-2 w-2 bg-indigo-500 rounded-full" style={{ animationDelay: '150ms' }}></div>
                        <div className="animate-bounce h-2 w-2 bg-indigo-500 rounded-full" style={{ animationDelay: '300ms' }}></div>
                      </div>
                      Generating talking points...
                   </div>
                 )}
                {!isAssistantProcessing && generatedAssistance && (
                  <div className="bg-gray-700/90 dark:bg-gray-700/90 rounded-lg p-4 border border-gray-600 dark:border-gray-600 shadow-sm animate-fade-in relative">
                    <div className="absolute top-2 right-2 bg-indigo-800/90 dark:bg-indigo-800/90 text-indigo-300 dark:text-indigo-300 text-xs px-2 py-1 rounded-full font-medium">AI Assistant</div>
                    <div className="text-gray-200 dark:text-gray-200 whitespace-pre-line font-medium">
                      {generatedAssistance.split('\n').map((line, index) => (
                        <React.Fragment key={index}>
                          {line}
                          {index < generatedAssistance.split('\n').length - 1 && <br />}
                        </React.Fragment>
                      ))}
                    </div>
                  </div>
                 )}
                 {/* Show placeholder if idle and no assistance */}
                 {!isAssistantProcessing && !generatedAssistance && (
                   <p className="text-gray-400 dark:text-gray-400 italic text-sm">Talking points will appear here based on detected speech when assistant is active.</p>
                 )}
               </div>
            </div>
          </div>

        </div>
      </div>

      {/* Render Settings Modal (Update props) */}
      <AiPersonalitySettingsModal
        isOpen={isPersonalitySettingsOpen}
        initialInterviewStage={interviewStage} 
        initialUserPreferences={userPreferences}
        onSave={handleSaveModalSettings}
        onClose={() => setIsPersonalitySettingsOpen(false)}
      />
    </>
  );
}; 