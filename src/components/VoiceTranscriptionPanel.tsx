import React, { useRef, useCallback, useState, useEffect } from 'react';
import { AiPersonalitySettingsModal } from './AiPersonalitySettingsModal';
import { availablePersonalities, DEFAULT_PERSONALITY } from '../constants/aiConstants';
import { useSmartVoiceDetection } from '../hooks/useSmartVoiceDetection';
import { TranscriptDisplay } from './TranscriptDisplay';
import { toast } from 'react-hot-toast';

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
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus>('idle');
  const [lastError, setLastError] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);

  // --- Speaker Detection ---
  const [speakerRole, setSpeakerRole] = useState<'user' | 'interviewer'>('user');
  const [audioInputDevices, setAudioInputDevices] = useState<MediaDeviceInfo[]>([]);
  const [speakerAudioInputDevices, setSpeakerAudioInputDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedSpeakerDeviceId, setSelectedSpeakerDeviceId] = useState<string | null>(null);
  const [selectedMicrophoneDeviceId, setSelectedMicrophoneDeviceId] = useState<string | null>(null);
  
  // --- State for transcript entries (primary transcript state) ---
  const [transcriptEntries, setTranscriptEntries] = useState<TranscriptEntry[]>([]);
  const [lastSpeaker, setLastSpeaker] = useState<'user' | 'interviewer' | null>(null);

  // --- Ref to track if devices are loaded ---
  const devicesLoadedRef = useRef<boolean>(false);

  // --- Function to fetch AI personality settings ---
  const fetchSettings = useCallback(async () => {
    try {
      console.log("Fetching AI settings...");
      const settings = await window.electronAPI?.getAISettings();
      if (settings) {
        console.log("Loaded AI settings:", settings);
        setSelectedPersonality(settings.personality || DEFAULT_PERSONALITY);
        setInterviewStage(settings.interviewStage || 'Initial Screening');
        setUserPreferences(settings.userPreferences || '');
      } else {
         console.log("No saved AI settings found, using defaults.");
         setSelectedPersonality(DEFAULT_PERSONALITY);
      }
    } catch (error) {
      console.error("Failed to fetch AI settings:", error);
      toast.error('Could not load AI settings.');
    }
  }, []); // Empty dependency array, fetch once concept

  // --- END: Audio Device Handling ---

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

  // --- Handlers for VAD events (passed to the hook) ---
  const handleDetectedSpeechStart = useCallback((role: 'user' | 'interviewer') => {
    console.log(`VoiceTranscriptionPanel: Detected speech start from: ${role}`);
    setVoiceStatus('speaking');
    setLastSpeaker(role); // Set who started speaking
    setSpeakerRole(role); // Automatically update speaker role based on active device
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
      
      // Send audio data to main process via the SpeechBridge channel
      console.log(`---> VTP: Sending audio:chunk (size: ${arrayBuffer.byteLength})`);
      window.electronAPI?.send('speech:audio-data', arrayBuffer);
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
      await window.electronAPI.saveAISettings({ autoMode: newAutoMode });
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

    const handleTranscriptionUpdate = (data: { transcript: string, isFinal: boolean }) => {
      console.log(`---> VTP: Received speech:transcript-update:`, data);
      setVoiceStatus('processing'); // Indicate processing when transcript comes in
      setTranscriptEntries(prevEntries => {
        const lastEntry = prevEntries[prevEntries.length - 1];
        
        // Update last interim entry (only if speaker is the same as current speakerRole)
        if (lastEntry && lastEntry.speaker === speakerRole) {
          // Speaker is the same as the last entry
          if (!data.isFinal) {
             // Interim result: Update the last entry's text (overwrite, as Google sends full interim)
             if (!lastEntry.isFinal) {
                 // Update existing interim entry - CREATE NEW OBJECT
                 console.log(`---> VTP: Updating interim entry ${lastEntry.id} for ${speakerRole}`);
                 const updatedEntry = { ...lastEntry, text: data.transcript, timestamp: Date.now() };
                 // Replace the last element with the updated one
                 return [...prevEntries.slice(0, -1), updatedEntry];
             } else {
                 // Last entry was final, but now we get an interim? Start new.
                 console.log(`---> VTP: Adding NEW interim entry for ${speakerRole} after final`);
                 const newEntry: TranscriptEntry = {
                   id: Date.now().toString(),
                   speaker: speakerRole,
                   text: data.transcript,
                   timestamp: Date.now(),
                   isFinal: false,
                 };
                 return [...prevEntries, newEntry];
             }
          } else {
             // Final result: Update the last entry if it was interim, otherwise add new final
              if (!lastEntry.isFinal) {
                 console.log(`---> VTP: Finalizing entry ${lastEntry.id} for ${speakerRole}`);
                 // Update existing interim entry to final - CREATE NEW OBJECT
                 const updatedEntry = { ...lastEntry, text: data.transcript, isFinal: true, timestamp: Date.now() };
                 return [...prevEntries.slice(0, -1), updatedEntry];
              } else {
                 // Last entry was already final. Add a new final entry.
                 // Avoid adding duplicate empty final results if they come rapidly
                 if (!data.transcript.trim() && !lastEntry.text.trim()) {
                    return prevEntries; // Don't add consecutive empty finals
                 }
                 console.log(`---> VTP: Adding NEW final entry for ${speakerRole} after previous final`);
                 const newEntry: TranscriptEntry = {
                   id: Date.now().toString(),
                   speaker: speakerRole,
                   text: data.transcript,
                   timestamp: Date.now(),
                   isFinal: true,
                 };
                 return [...prevEntries, newEntry];
              }
          }
        } else {
          // Speaker has changed, or it's the very first entry
          console.log(`---> VTP: Adding first entry or speaker changed to ${speakerRole}`);
          const newEntry: TranscriptEntry = {
             id: Date.now().toString(),
             speaker: speakerRole,
             text: data.transcript,
             timestamp: Date.now(),
             isFinal: data.isFinal,
          };
          return [...prevEntries, newEntry];
        }
      });
       // If it is the final transcript, maybe change status back to listening?
       if (data.isFinal) {
         setVoiceStatus('listening');
         // Trigger suggestion generation if it was the interviewer finishing
         if (autoMode && speakerRole === 'interviewer' && data.transcript.trim()) {
             console.log('---> VTP: Triggering suggestion after final interviewer transcript:', data.transcript);
             // Use a timeout to slightly delay suggestion generation, 
             // allowing UI to potentially settle and ensuring latest state is used if needed.
             // Also prevents potential rapid-fire calls if final events come too close.
             setTimeout(() => {
                generateSuggestion(data.transcript, 'interviewer');
             }, 100); // 100ms delay
         }
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
  }, [stopListening, speakerRole]); // Add speakerRole as dependency
  // ----> END Listener Setup <----

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

            {/* Speaker Role Indicator (replaced toggle with indicator) */}
            <div className="flex items-center ml-2">
              <div
                className={`flex items-center text-xs px-2 py-1 rounded-full transition-colors shadow-sm ${
                  speakerRole === 'user' 
                    ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300 border border-blue-200/50 dark:border-blue-800/50'
                    : 'bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-300 border border-purple-200/50 dark:border-purple-800/50'
                }`}
              >
                <span className="mr-1">
                  {speakerRole === 'user' ? 'You' : 'Interviewer'}
                </span>
                {isUserSpeaking && speakerRole === 'user' && (
                  <span className="ml-1 inline-block w-2 h-2 bg-red-500 rounded-full animate-pulse shadow-red-500/50 shadow-sm"></span>
                )}
                {isSpeakerSpeaking && speakerRole === 'interviewer' && (
                  <span className="ml-1 inline-block w-2 h-2 bg-red-500 rounded-full animate-pulse shadow-red-500/50 shadow-sm"></span>
                )}
              </div>
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
            {/* Transcription Area - Use transcriptEntries */}
            <div>
              <div className="flex justify-between items-center mb-2">
                 <h4 className="text-sm font-medium text-gray-200 dark:text-gray-200 border-b border-gray-700 dark:border-gray-700 pb-1">Detected Speech / Question</h4>
                 {/* Removed button */}
              </div>

              {/* New TranscriptDisplay for YouTube-like captions */}
              {speechService === 'google' ? (
                <TranscriptDisplay
                  entries={transcriptEntries} // <-- Pass all entries
                  className="min-h-[60px] max-h-[200px] bg-gray-800/70 dark:bg-gray-800/70 rounded-lg border border-gray-700 dark:border-gray-700 shadow-sm p-2 overflow-y-auto"
                />
              ) : (
                /* Legacy transcript display for Whisper - now uses transcriptEntries */
              <div className="min-h-[60px] max-h-[200px] overflow-y-auto p-3 bg-gray-800/70 dark:bg-gray-800/70 rounded-lg border border-gray-700 dark:border-gray-700 shadow-sm">
                  {transcriptEntries.length > 0 ? ( // <-- Check full length
                      <div className="text-gray-200 dark:text-gray-200 whitespace-pre-line text-sm">
                          {transcriptEntries
                            .map((entry) => (
                              // Differentiate speaker text color
                              <div key={entry.id} className={`py-0.5 ${entry.speaker === 'user' ? 'text-blue-300' : 'text-purple-300'}`}>
                                {/* Optionally add speaker label back if needed for clarity */} 
                                {/* {entry.speaker === 'user' ? 'You:' : 'Interviewer:'} */}
                                {entry.text} {entry.isFinal ? '' : '(interim)'}
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
        initialInterviewStage={interviewStage} 
        initialUserPreferences={userPreferences}
        onSave={handleSaveModalSettings}
        onClose={() => setIsPersonalitySettingsOpen(false)}
      />
    </>
  );
}; 