import React, { useRef, useCallback, useState, useEffect } from 'react';
import { AiPersonalitySettingsModal } from './AiPersonalitySettingsModal';
import { useSmartVoiceDetection } from '../hooks/useSmartVoiceDetection';
import { TranscriptDisplay } from './TranscriptDisplay';
import { toast } from 'react-hot-toast';
import { DEFAULT_PERSONALITY } from '../constants/aiConstants';

// --- NEW: Language Constants ---
const englishLanguageVariants = [
  { code: 'en-US', name: 'English (US)' },
  { code: 'en-GB', name: 'English (UK)' },
  { code: 'en-AU', name: 'English (Australia)' },
  { code: 'en-IN', name: 'English (India)' },
  { code: 'en-CA', name: 'English (Canada)' },
  { code: 'en-ZA', name: 'English (South Africa)' },
];
const DEFAULT_SPEECH_LANGUAGE = 'en-US';
// --- END: Language Constants ---

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
  onSpeakerChange?: (speaker: 'user' | 'interviewer') => void;
  // NEW PROP for App.tsx to hook into for its AI Assistance
  onInterviewerTranscriptFinal?: (transcript: string) => void;
  // NEW PROP for App.tsx to request clearing its live assistance display
  onClearLiveAssistance?: () => void;
}

// Interface for transcript entries
interface TranscriptEntry {
  id: string;
  speaker: 'user' | 'interviewer';
  text: string;
  timestamp: number;
  isFinal: boolean;
  words?: Array<{ word: string; startTime: number; endTime: number }>;
}

// Update VoiceStatus type to include 'error'
type VoiceStatus = 'idle' | 'listening' | 'speaking' | 'processing' | 'error';

export const VoiceTranscriptionPanel: React.FC<VoiceTranscriptionPanelProps> = ({
  speechService,
  generatedAssistance,
  isAssistantProcessing,
  jobContext,
  resumeFileName,
  onResumeUpload,
  onContextChange,
  onClose,
  onSpeakerChange,
  onInterviewerTranscriptFinal,
  onClearLiveAssistance,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  // --- State for AI Personality Settings ---
  const [isPersonalitySettingsOpen, setIsPersonalitySettingsOpen] = useState(false);
  const [selectedAiPersonality, setSelectedAiPersonality] = useState<string>(DEFAULT_PERSONALITY);
  const [resumeTextContent, setResumeTextContent] = useState<string | null>(null);
  const [interviewStage, setInterviewStage] = useState('Initial Screening');
  const [userPreferences, setUserPreferences] = useState('');

  // --- NEW: State for Speech Language Selection ---
  const [selectedSpeechLanguage, setSelectedSpeechLanguage] = useState<string>(DEFAULT_SPEECH_LANGUAGE);

  // --- State for Response Suggestion ---
  const [suggestedResponse, setSuggestedResponse] = useState<string | null>(null);
  const [isGeneratingResponse, setIsGeneratingResponse] = useState<boolean>(false);
  
  // --- Auto Mode States ---
  const [autoMode, setAutoMode] = useState<boolean>(false);
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus>('idle');
  const [lastError, setLastError] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);

  // --- Speaker Detection (Local Role Removed) ---
  const [audioInputDevices, setAudioInputDevices] = useState<MediaDeviceInfo[]>([]);
  const [speakerAudioInputDevices, setSpeakerAudioInputDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedSpeakerDeviceId, setSelectedSpeakerDeviceId] = useState<string | null>(null);
  const [selectedMicrophoneDeviceId, setSelectedMicrophoneDeviceId] = useState<string | null>(null);
  
  // --- State for transcript entries (primary transcript state) ---
  const [transcriptEntries, setTranscriptEntries] = useState<TranscriptEntry[]>([]);
  // --- NEW: State for backend logging control ---
  const [isTranscriptLoggingActive, setIsTranscriptLoggingActive] = useState<boolean>(false);

  // --- Ref to track if devices are loaded ---
  const devicesLoadedRef = useRef<boolean>(false);

  // --- NEW State for interviewer's last transcript ---
  const [lastInterviewerTranscript, setLastInterviewerTranscript] = useState<string>('');

  // Generate suggestions for responses
  const generateSuggestion = useCallback(async (text: string, role: 'user' | 'interviewer') => {
    console.log(`Generating suggestion for ${role} speech: ${text}`);
    setIsGeneratingResponse(true);
    setSuggestedResponse(''); // Clear previous
    
    try {
      // Create the payload for suggestion generation
      const payload = {
        question: text, 
        jobContext: jobContext,
        resumeTextContent: resumeTextContent,
        speakerRole: role 
      };
      
      console.log("Requesting response suggestion with payload:", payload);
      const suggestionResult = await window.electronAPI.generateResponseSuggestion(payload);

      if (suggestionResult && suggestionResult.success && suggestionResult.data) {
        setSuggestedResponse(suggestionResult.data);
        if (window.electronAPI.autoResponseGenerated) {
          window.electronAPI.autoResponseGenerated(suggestionResult.data);
        }
        console.log("Response suggestion generated successfully");
      } else {
        console.error("Response suggestion generation failed:", suggestionResult?.error);
        setSuggestedResponse(`Error: ${suggestionResult?.error || 'Unknown error'}`);
      }
    } catch (error: any) {
      console.error("Error generating suggestion:", error);
      setSuggestedResponse(`Error: ${error.message || error}`);
    } finally {
      setIsGeneratingResponse(false);
    }
  }, [jobContext, resumeTextContent]);

  // Helper function to trigger suggestion on manual stop
  const triggerSuggestionOnManualStop = useCallback(() => {
    // Use the full interviewer transcript for interviewer suggestions
    const fullInterviewerTranscript = getFullInterviewerTranscript();
    if (fullInterviewerTranscript) {
      console.log(`---> VTP: Manual stop detected. Generating suggestion for interviewer's full transcript: "${fullInterviewerTranscript}"`);
      generateSuggestion(fullInterviewerTranscript, 'interviewer');
    }
  }, [transcriptEntries, generateSuggestion]);

  // --- Function to fetch AI personality settings ---
  const fetchSettings = useCallback(async () => {
    try {
      console.log("Fetching AI settings (including personality trait) and language...");
      const settings = await window.electronAPI?.getAISettings(); 
      if (settings) {
        console.log("Loaded AI settings:", settings);
        setSelectedAiPersonality(settings.personality || DEFAULT_PERSONALITY); // Load saved personality trait
        setInterviewStage(settings.interviewStage || 'Initial Screening');
        setUserPreferences(settings.userPreferences || '');
      } else {
        // If no settings found, apply defaults for all
        setSelectedAiPersonality(DEFAULT_PERSONALITY);
        setInterviewStage('Initial Screening');
        setUserPreferences('');
        console.log("No saved AI settings found, using defaults for personality, stage, and preferences.");
      }
      
      // Load speech language separately
      const savedLanguage = await window.electronAPI?.loadSetting('selectedSpeechLanguage');
      if (savedLanguage && typeof savedLanguage === 'string') {
        // Validate if savedLanguage is one of the allowed codes
        if (englishLanguageVariants.some(variant => variant.code === savedLanguage)) {
          setSelectedSpeechLanguage(savedLanguage);
          console.log("Loaded speech language:", savedLanguage);
        } else {
          console.warn(`Loaded speech language '${savedLanguage}' is not a valid option. Using default.`);
          setSelectedSpeechLanguage(DEFAULT_SPEECH_LANGUAGE);
          // Optionally save the default back if an invalid one was stored
          await window.electronAPI?.saveSetting('selectedSpeechLanguage', DEFAULT_SPEECH_LANGUAGE);
        }
      } else {
        console.log("No saved speech language found, using default.");
        setSelectedSpeechLanguage(DEFAULT_SPEECH_LANGUAGE);
      }

    } catch (error) {
      console.error("Failed to fetch AI settings or speech language:", error);
      toast.error('Could not load initial settings.');
    }
  }, []); // Empty dependency array, fetch once concept

  // --- END: Audio Device Handling ---

  // --- Handlers for VAD events (passed to the hook) ---
  const handleDetectedSpeechStart = useCallback((role: 'user' | 'interviewer') => {
    // Only update voice status, no local role tracking
    console.log(`VoiceTranscriptionPanel: Detected speech start from: ${role}`);
    setVoiceStatus('speaking');
  }, []);

  const handleDetectedSpeechEnd = useCallback(() => {
    console.log('VoiceTranscriptionPanel: Detected speech end');
    setVoiceStatus('listening');
  }, []);

  // Handle a speech segment (audio blob) from the voice detection hook
  const handleSpeechSegment = useCallback(async (audioBlob: Blob, role: 'user' | 'interviewer') => {
    console.log(`---> VTP: handleSpeechSegment called for ${role}, size: ${audioBlob.size}`);
    setVoiceStatus('processing');
    setLastError(null); 
    try {
      // Convert Blob to ArrayBuffer for sending over IPC
      const arrayBuffer = await audioBlob.arrayBuffer();
      // ---> Convert to Uint8Array before sending <---
      const uint8Array = new Uint8Array(arrayBuffer);
      
      // Send audio data AND role to main process via the SpeechBridge channel
      console.log(`---> VTP: Sending speech:audio-data (Uint8Array size: ${uint8Array.byteLength}, role: ${role})`);
      window.electronAPI?.send('speech:audio-data', { audio: uint8Array, role: role }); // <-- Send Uint8Array
      // Note: We no longer expect a direct response here. Updates come via onTranscriptionReceived.
      setVoiceStatus('idle'); // Reset status after sending

    } catch (error) {
      console.error("Error handling speech segment:", error);
      setVoiceStatus('error');
      toast.error("Error processing audio segment.");
    }
  }, []);

  // Helper function to calculate text similarity (Levenshtein distance based)
  const calculateTextSimilarity = (text1: string, text2: string): number => {
    // Simple normalization: lowercase and remove punctuation
    const normalize = (text: string) => text.toLowerCase().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, "").trim();
    
    const s1 = normalize(text1);
    const s2 = normalize(text2);
    
    // If either string is empty, return 0 similarity
    if (!s1.length || !s2.length) return 0;
    
    // If strings are identical after normalization, return 1 (100% similar)
    if (s1 === s2) return 1;
    
    // If one is a substring of the other, calculate partial match
    if (s1.includes(s2) || s2.includes(s1)) {
      const ratio = Math.min(s1.length, s2.length) / Math.max(s1.length, s2.length);
      return 0.5 + (ratio * 0.5); // Range between 0.5 and 1.0 for substring matches
    }
    
    // For different strings, do word-level comparison
    const words1 = s1.split(/\s+/);
    const words2 = s2.split(/\s+/);
    
    // Count matching words
    const commonWords = words1.filter(word => words2.includes(word));
    const matchRatio = 2 * commonWords.length / (words1.length + words2.length);
    
    return matchRatio;
  };

  // Handle silence after speech (used for final segments and suggestions)
  const handleSilenceAfterSpeech = useCallback(async (audioBlob: Blob, role: 'user' | 'interviewer') => {
    console.log(`---> VTP: handleSilenceAfterSpeech called for ${role}, size: ${audioBlob.size}`);
  }, []); // No dependencies needed anymore

  // Combined speaking state to expose from the hook
  const {
    isListening,
    isSpeaking, // Combined state reflects if *either* mic is active
    isUserSpeaking, // Add these states to use for UI indicators
    isSpeakerSpeaking,
    startListening,
    stopListening,
  } = useSmartVoiceDetection({
    speakerDeviceId: selectedSpeakerDeviceId,
    microphoneDeviceId: selectedMicrophoneDeviceId,
    selectedLanguage: selectedSpeechLanguage,
    onSpeechStart: handleDetectedSpeechStart,
    onSpeechEnd: handleSpeechSegment, // Call handler for each speech segment end
    onSilenceAfterSpeech: handleSilenceAfterSpeech, // Call handler after silence
    autoSuggest: autoMode 
  });

  // Automatically start listening if auto mode is enabled
  useEffect(() => {
    // Only run if auto mode is enabled AND devices have been loaded
    if (autoMode && devicesLoadedRef.current && !isListening) {
      console.log("Auto mode is enabled and devices are loaded, starting listening...");
      startListening();
      setVoiceStatus('listening');
    }
    // Add isListening to dependencies to restart if it stops unexpectedly
  }, [autoMode, isListening, startListening]); 

  // --- Fetch Audio Devices and Load Settings ---
  useEffect(() => {
    const fetchAudioDevicesAndSettings = async () => {
      console.log("Fetching audio devices and settings...");
      setLastError(null);
      try {
        // Request permissions early
        await navigator.mediaDevices.getUserMedia({ audio: true });
        const devices = await navigator.mediaDevices.enumerateDevices();
        console.log(`Found ${devices.length} media devices`);
        
        const inputDevices = devices.filter(d => d.kind === 'audioinput');
        setAudioInputDevices(inputDevices);
        setSpeakerAudioInputDevices(inputDevices); // Use input devices for speaker VAD too
        
        // Load saved device IDs from config
        const savedMicId = await window.electronAPI?.loadSetting('selectedMicrophoneDeviceId');
        const savedSpeakerId = await window.electronAPI?.loadSetting('selectedSpeakerDeviceId');
        console.log(`Loaded device IDs - Mic: ${savedMicId}, Speaker: ${savedSpeakerId}`);

        // Set selected devices, falling back to default or first available
        const defaultMic = inputDevices.find(d => d.deviceId === 'default');
        const defaultSpeaker = inputDevices.find(d => d.deviceId === 'default');
        
        const micToSet = inputDevices.some(d => d.deviceId === savedMicId) ? savedMicId 
                       : defaultMic?.deviceId || inputDevices[0]?.deviceId || null;
        const speakerToSet = inputDevices.some(d => d.deviceId === savedSpeakerId) ? savedSpeakerId 
                           : defaultSpeaker?.deviceId || inputDevices[0]?.deviceId || null;

        setSelectedMicrophoneDeviceId(micToSet);
        setSelectedSpeakerDeviceId(speakerToSet);
        console.log(`Set selected devices - Mic: ${micToSet}, Speaker: ${speakerToSet}`);

        // --- Mark devices as loaded --- 
        devicesLoadedRef.current = true; 
        console.log("Audio devices loaded and set.");

      } catch (error: any) {
        console.error("Error fetching audio devices or settings:", error);
        toast.error(`Failed to access audio devices: ${error.message}`);
        setVoiceStatus('error');
      }
      
      // Fetch AI settings after devices are potentially loaded
      await fetchSettings();

    };

    fetchAudioDevicesAndSettings();
  }, [fetchSettings]); // Make sure fetchSettings is stable or included if needed

  // --- Handler to save specific settings from Modal ---
  const handleSaveModalSettings = async (personality: string, stage: string, prefs: string) => {
    try {
      // Save personality, stage, and prefs
      await window.electronAPI.invoke('save-ai-settings', { 
        personality: personality,
        interviewStage: stage, 
        userPreferences: prefs 
      });
      // Update local state
      setSelectedAiPersonality(personality);
      setInterviewStage(stage);
      setUserPreferences(prefs);
      setIsPersonalitySettingsOpen(false); 
      console.log('AI personality, stage, & prefs saved successfully:', { personality, stage, prefs });
    } catch (error) {
      console.error("Failed to save AI modal settings:", error);
      toast.error("Failed to save AI settings from modal.");
    }
  };

  // --- Handler for Speech Language (was personality) change from Header Dropdown ---
  const handleSpeechLanguageChange = async (event: React.ChangeEvent<HTMLSelectElement>) => {
    const newLanguage = event.target.value;
    setSelectedSpeechLanguage(newLanguage); // Update UI immediately
    try {
      // Save the selected speech language
      await window.electronAPI?.saveSetting('selectedSpeechLanguage', newLanguage);
      console.log(`Speech language saved: ${newLanguage}`);
      // TODO: If a transcription is active, it might need to be restarted for the change to take effect.
      // This typically involves sending a 'speech:stop' then 'speech:start' with the new language.
      // For now, it only saves the setting for the *next* transcription.
    } catch (error) {
      console.error("Failed to save speech language setting:", error);
      toast.error('Could not save language preference.');
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
    const newAutoModeState = !autoMode;
    setAutoMode(newAutoModeState); // Update state first
    console.log(`Auto mode toggled: ${newAutoModeState}`);
    try {
      await window.electronAPI.saveAISettings({ autoMode: newAutoModeState });
      if (newAutoModeState) { // Turning Auto ON
        console.log('Auto mode ON, calling startListening()');
        startListening(); // Start hook's listening process
        setVoiceStatus('listening');
      } else { // Turning Auto OFF
        console.log('Auto mode OFF, triggering suggestion (if applicable) and calling stopListening()');
        triggerSuggestionOnManualStop(); // Call before stopListening
        stopListening(); // Stop hook's listening process
        setVoiceStatus('idle');
      }
    } catch (error) {
      console.error("Failed to save auto mode setting or toggle listening:", error);
      // Revert state if save failed?
      setAutoMode(autoMode); // Revert to previous state on error
      // Optionally, inform the user via toast
      toast.error("Failed to update auto mode settings.");
    }
  }, [autoMode, startListening, stopListening, triggerSuggestionOnManualStop]); // Removed setSelectedPersonality

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

  // ----> Setup IPC Listeners for Transcription/Errors <----
  useEffect(() => {
    console.log("---> VTP: Setting up IPC listeners for transcription and errors.");

    const handleTranscriptionUpdate = (data: { transcript: string, isFinal: boolean, speaker: 'user' | 'interviewer', words?: { word: string, startTime: number, endTime: number }[] }) => {
      // console.log(`---> VTP: Received speech:transcript-update:`, data);
      setVoiceStatus('processing'); 
      setTranscriptEntries(prevEntries => {
        // console.log(`---> VTP: Updating entries. Prev count: ${prevEntries.length}. Last entry:`, prevEntries[prevEntries.length - 1]);
        
        const lastEntry = prevEntries[prevEntries.length - 1];
        
        // Use speaker from the DATA, not local state
        const currentSpeaker = data.speaker;

        // Logic for adding/updating entries based on incoming data speaker
        if (lastEntry && lastEntry.speaker === currentSpeaker && !lastEntry.isFinal) {
          // Last entry exists, is from the same speaker, and is interim
          if (!data.isFinal) {
             // Update existing interim entry
             // console.log(`---> VTP: Updating interim entry ${lastEntry.id} for ${currentSpeaker}`);
             const updatedEntry = { ...lastEntry, text: data.transcript, timestamp: Date.now() };
             return [...prevEntries.slice(0, -1), updatedEntry];
          } else {
             // Finalize existing interim entry
             // console.log(`---> VTP: Finalizing entry ${lastEntry.id} for ${currentSpeaker}`);
             const updatedEntry = { ...lastEntry, text: data.transcript, isFinal: true, timestamp: Date.now() };
             return [...prevEntries.slice(0, -1), updatedEntry];
          }
        } else {
          // Add a new entry because:
          // - It's the first entry
          // - The speaker has changed
          // - The last entry was already final
          
          // Avoid adding empty final entries if the previous was also empty final
          if (data.isFinal && !data.transcript.trim() && lastEntry?.isFinal && !lastEntry.text.trim()) {
             return prevEntries;
          }

          console.log(`---> VTP: Adding new entry for ${currentSpeaker} (isFinal: ${data.isFinal})`);
          const newEntry: TranscriptEntry = {
             id: Date.now().toString() + Math.random(), // Add random number for better key uniqueness
             speaker: currentSpeaker, // Use speaker from data
             text: data.transcript,
             timestamp: Date.now(),
             isFinal: data.isFinal,
          };
          return [...prevEntries, newEntry];
        }
      });

       // If it is the final transcript, change status back to listening
       if (data.isFinal) {
         setVoiceStatus('listening');
       }
    };

    const handleStreamError = (error: { code: number, message: string }) => {
      console.error(`---> VTP: Received speech:stream-error:`, error);
      const errorMessage = `Speech recognition error: ${error.message} (Code: ${error.code})`;
      toast.error(errorMessage);
      setVoiceStatus('error'); // <-- Set status to error literal
      // Maybe stop recording visually
      setIsRecording(false); 
      stopListening(); // Ensure VAD stops
    };

    let unsubscribeTranscription: (() => void) | undefined;
    let unsubscribeError: (() => void) | undefined;

    if (window.electronAPI) {
       try {
          unsubscribeTranscription = window.electronAPI.onTranscriptionReceived(handleTranscriptionUpdate);
          unsubscribeError = window.electronAPI.onSpeechStreamError(handleStreamError);
          console.log("---> VTP: Successfully subscribed to transcription and error events.");
       } catch (err: any) {
          const setupError = `Error setting up transcription listeners: ${err.message}`;
          console.error("---> VTP:", setupError, err)
          toast.error(setupError)
          setVoiceStatus('error'); // Set status to error on setup failure
       }
    }

    // Cleanup function
    return () => {
      console.log("---> VTP: Cleaning up IPC listeners for transcription and errors.");
      unsubscribeTranscription?.();
      unsubscribeError?.();
    };
  }, [stopListening, autoMode, generateSuggestion, onInterviewerTranscriptFinal]); 
  // ----> END Listener Setup <----

  // --- NEW: Listener for Status Updates from Main Process ---
  useEffect(() => {
    console.log("---> VTP: Setting up IPC listener for speech status updates.");

    const handleStatusUpdate = (status: string) => {
      console.log(`---> VTP: Received speech:status-update: ${status}`);
      // Update voiceStatus based on backend state
      switch (status) {
        case 'recording':
        case 'listening': // Treat listening and recording similarly for status
          setVoiceStatus('listening');
          setLastError(null); // Clear error on successful start
          break;
        case 'speaking': // Might be sent by VAD, map to listening for now
          setVoiceStatus('speaking'); 
          break;
        case 'processing':
          setVoiceStatus('processing');
          break;
        case 'stopped':
        case 'idle':
          setVoiceStatus('idle');
          break;
        case 'paused': // Handle pause if implemented
          setVoiceStatus('idle'); // Or a dedicated 'paused' status if needed
          break;
        case 'error':
           setVoiceStatus('error');
           // Error message might be sent separately via speech:stream-error
           break;
        default:
          console.warn(`---> VTP: Received unknown status update: ${status}`);
          setVoiceStatus('idle'); // Default to idle on unknown status
      }
    };

    let unsubscribeStatus: (() => void) | undefined;
    if (window.electronAPI && window.electronAPI.onSpeechStatusUpdate) { // Check if function exists
      try {
        unsubscribeStatus = window.electronAPI.onSpeechStatusUpdate(handleStatusUpdate);
        console.log("---> VTP: Successfully subscribed to speech status updates.");
      } catch (err: any) {
        console.error("---> VTP: Error subscribing to speech status updates:", err.message);
        toast.error('Failed to listen for speech status.');
      }
    } else {
      console.warn("---> VTP: window.electronAPI.onSpeechStatusUpdate not found in preload.");
    }

    // Cleanup function
    return () => {
      console.log("---> VTP: Cleaning up IPC listener for speech status updates.");
      unsubscribeStatus?.();
    };
  }, []); // Run once on mount
  // --- END: Status Update Listener ---

  // --- NEW: Handlers for Backend Logging ---
  const handleStartLogging = async () => {
    try {
      // Optionally prompt user for file path or use default
      // For now, we use the default path generated by the backend
      const result = await window.electronAPI?.invoke('transcript:start-log');
      if (result?.success) {
        setIsTranscriptLoggingActive(true);
        toast.success('Transcript logging started.');
      } else {
        throw new Error(result?.error || 'Failed to start logging');
      }
    } catch (error: any) {
      console.error('Error starting transcript logging:', error);
      toast.error(`Could not start logging: ${error.message}`);
      setIsTranscriptLoggingActive(false); // Ensure state is false on error
    }
  };

  const handleStopLogging = async () => {
    try {
      const result = await window.electronAPI?.invoke('transcript:stop-log');
      if (result?.success) {
        setIsTranscriptLoggingActive(false);
        toast.success('Transcript logging stopped.');
      } else {
        throw new Error(result?.error || 'Failed to stop logging');
      }
    } catch (error: any) {
      console.error('Error stopping transcript logging:', error);
      toast.error(`Could not stop logging: ${error.message}`);
      // Keep state true? Or force false? Let's force false on error.
      setIsTranscriptLoggingActive(false); 
    }
  };
  // --- END: Handlers for Backend Logging ---

  // --- NEW: Handler to clear transcript and suggestions ---
  const handleClearTranscript = useCallback(() => {
    setTranscriptEntries([]);
    setSuggestedResponse('');
    // If generatedAssistance (talking points) should also be cleared,
    // a mechanism to clear it in App.tsx would be needed here,
    // e.g., by calling a prop passed from App.tsx.
    // For now, it only clears what's local to this panel.
    
    // Call the callback from App.tsx to clear its state if provided
    if (onClearLiveAssistance) {
      onClearLiveAssistance();
    }

    console.log("---> VTP: Transcript and suggestions cleared manually.");
  }, [onClearLiveAssistance]); // Add onClearLiveAssistance to dependency array
  // --- END: Handler to clear transcript ---

  // --- NEW: Function to request suggestion for interviewer's last turn ---
  const requestSuggestionForLastInterviewerTurn = useCallback(() => {
    if (lastInterviewerTranscript.trim()) {
      console.log('[VTP] Requesting AI suggestion for LAST INTERVIEWER turn:', lastInterviewerTranscript);
      setIsGeneratingResponse(true);
      setSuggestedResponse(null);
      window.electron.ipcRenderer.sendMessage('REQUEST_INTERVIEWER_TURN_SUGGESTION', {
        question: lastInterviewerTranscript,
        jobContext,
        resumeTextContent,
        settings: {
          personality: selectedAiPersonality,
          interviewStage: interviewStage,
          userPreferences: userPreferences,
        }
        // speakerRole is implicitly 'interviewer' on the main side for this message
      });
    } else {
      console.log('[VTP] No last interviewer transcript to request suggestion for.');
    }
  }, [lastInterviewerTranscript, jobContext, resumeTextContent, selectedAiPersonality, interviewStage, userPreferences]);

  // Helper to get full interviewer transcript
  const getFullInterviewerTranscript = () => transcriptEntries
    .filter(entry => entry.speaker === 'interviewer')
    .map(entry => entry.text)
    .join(' ')
    .trim();

  // Add this useEffect after transcriptEntries is defined:
  useEffect(() => {
    if (!autoMode) return;
    const lastEntry = transcriptEntries[transcriptEntries.length - 1];
    if (
      lastEntry &&
      lastEntry.speaker === 'interviewer' &&
      lastEntry.isFinal &&
      lastEntry.text.trim()
    ) {
      generateSuggestion(getFullInterviewerTranscript(), 'interviewer');
    }
  }, [transcriptEntries, autoMode]);

  // ... rest of the component ...

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
                onClick={async () => { // Made async to align if generateSuggestion becomes truly async
                  if (isListening) {
                    console.log("---> VTP: Manual mic button clicked to STOP listening.");
                    triggerSuggestionOnManualStop();
                    stopListening();
                  } else {
                    console.log("---> VTP: Manual mic button clicked to START listening.");
                    startListening();
                  }
                }}
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

            {/* --- Transcript Logging Buttons --- */}
            <div className="flex items-center space-x-1 ml-2">
              {!isTranscriptLoggingActive ? (
                <button
                  onClick={handleStartLogging}
                  className="flex items-center justify-center px-2 py-1 h-7 rounded bg-white/30 hover:bg-white/40 text-white text-xs transition-colors shadow-sm"
                  title="Start Backend Transcript Log"
                >
                  {/* Simple Log Icon */} 
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-1"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
                  Start Log
                </button>
              ) : (
                <button
                  onClick={handleStopLogging}
                  className="flex items-center justify-center px-2 py-1 h-7 rounded bg-red-500 hover:bg-red-600 text-white text-xs transition-colors shadow-sm"
                  title="Stop Backend Transcript Log"
                >
                  {/* Stop Icon */} 
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" className="mr-1"><rect x="6" y="6" width="12" height="12" /></svg>
                  Stop Log
                </button>
              )}
            </div>
            {/* --- End Transcript Logging Buttons --- */}

            {/* --- Personality Dropdown --- */}
            <select
              value={selectedSpeechLanguage}
              onChange={handleSpeechLanguageChange}
              className="text-xs h-7 bg-white/30 text-white rounded border-none focus:ring-1 focus:ring-white/50 pl-2 pr-6 appearance-none shadow-sm"
              aria-label="Speech Language"
              style={{ 
                backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3E%3Cpath stroke='%23ffffff' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3E%3C/svg%3E")`, 
                backgroundPosition: 'right 0.3rem center', 
                backgroundRepeat: 'no-repeat', 
                backgroundSize: '1.2em 1.2em' 
              }}
            >
              {englishLanguageVariants.map(lang => (
                <option key={lang.code} value={lang.code} className="text-black dark:text-white bg-white dark:bg-gray-700">
                  {lang.name}
                </option>
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
            {/* Transcription Area - Use transcriptEntries */}
            <div>
              <div className="flex justify-between items-center mb-2">
                 <h4 className="text-sm font-medium text-gray-200 dark:text-gray-200 border-b border-gray-700 dark:border-gray-700 pb-1">Detected Speech / Question</h4>
                 {/* --- NEW: Clear Transcript Button --- */}
                 <button
                    onClick={handleClearTranscript}
                    disabled={transcriptEntries.length === 0}
                    className="px-2 py-0.5 text-xs text-indigo-300 hover:text-indigo-100 bg-indigo-700/50 hover:bg-indigo-600/50 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
                    title="Clear current transcript"
                  >
                    Clear
                  </button>
                 {/* --- END: Clear Transcript Button --- */}
              </div>

              {/* New TranscriptDisplay for YouTube-like captions - Keep using it, but it should render entries neutrally */}
              {speechService === 'google' ? (
                <TranscriptDisplay
                  entries={transcriptEntries} // <-- Pass all entries
                  className="min-h-[60px] max-h-[200px] bg-gray-800/70 dark:bg-gray-800/70 rounded-lg border border-gray-700 dark:border-gray-700 shadow-sm p-2 overflow-y-auto"
                />
              ) : (
                /* Legacy transcript display for Whisper - now uses transcriptEntries - REMOVE speaker styling */
              <div className="min-h-[60px] max-h-[200px] overflow-y-auto p-3 bg-gray-800/70 dark:bg-gray-800/70 rounded-lg border border-gray-700 dark:border-gray-700 shadow-sm">
                  {transcriptEntries.length > 0 ? ( // <-- Check full length
                      <div className="text-gray-200 dark:text-gray-200 whitespace-pre-line text-sm space-y-1"> {/* Add space-y-1 for slight spacing */} 
                          {transcriptEntries
                            .map((entry) => (
                              // REMOVE speaker-based styling and labels
                              <div key={entry.id} className="py-0.5">
                                {entry.text} {/* Only display text */}
                                {/* Optionally keep interim indicator if desired 
                                {entry.isFinal ? '' : ' (interim)'} 
                                */} 
                              </div>
                          ))}
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
                   <p className="text-gray-400 dark:text-gray-400 italic text-sm">AI suggestions will appear here automatically after the interviewer finishes speaking.</p>
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
        initialPersonality={selectedAiPersonality}
        initialInterviewStage={interviewStage} 
        initialUserPreferences={userPreferences}
        onSave={handleSaveModalSettings}
        onClose={() => setIsPersonalitySettingsOpen(false)}
      />
    </>
  );
}; 