import React, { useRef, useCallback, useState, useEffect } from 'react';
import { AiPersonalitySettingsModal } from './AiPersonalitySettingsModal';
import { availablePersonalities, DEFAULT_PERSONALITY } from '../constants/aiConstants';

// Define types for props
interface VoiceTranscriptionPanelProps {
  isRecording: boolean;
  transcription: string;
  isTranscribing: boolean;
  speechService: 'whisper' | 'google';
  // --- Live Assistant Props ---
  generatedAssistance: string;
  isAssistantProcessing: boolean;
  jobContext: { jobTitle: string; keySkills: string; companyMission: string };
  resumeFileName: string;
  onResumeUpload: (file: File) => void;
  onContextChange: (contextUpdate: Partial<{ jobTitle: string; keySkills: string; companyMission: string }>) => void;
  onToggleMicrophone: () => void;
  onClose: () => void;
}

export const VoiceTranscriptionPanel: React.FC<VoiceTranscriptionPanelProps> = ({
  isRecording,
  transcription,
  isTranscribing,
  speechService,
  // --- Live Assistant Props ---
  generatedAssistance,
  isAssistantProcessing,
  jobContext,
  resumeFileName,
  onResumeUpload,
  onContextChange,
  onToggleMicrophone,
  onClose,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  // --- State for AI Personality Settings ---
  const [isPersonalitySettingsOpen, setIsPersonalitySettingsOpen] = useState(false);
  const [selectedPersonality, setSelectedPersonality] = useState(DEFAULT_PERSONALITY);
  const [resumeTextContent, setResumeTextContent] = useState<string | null>(null);
  const [interviewStage, setInterviewStage] = useState('Initial Screening');
  const [userPreferences, setUserPreferences] = useState('');

  // --- Fetch initial settings on mount ---
  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const settings = await window.electronAPI.invoke('get-ai-settings');
        if (settings) {
          setSelectedPersonality(settings.personality || DEFAULT_PERSONALITY);
          setInterviewStage(settings.interviewStage || 'Initial Screening');
          setUserPreferences(settings.userPreferences || '');
        }
      } catch (error) {
        console.error("Failed to fetch AI settings:", error);
        // Keep defaults if fetch fails
      }
    };
    fetchSettings();
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

  // --- Function that triggers the AI query needs modification ---
  const triggerAiQuery = async (detectedSpeech: string) => {
      try {
          const payload = {
              query: detectedSpeech,
              language: 'en',
              jobContext: jobContext,
              resumeTextContent: resumeTextContent
          };
          console.log("Sending AI Query with payload:", payload);
          const result = await window.electronAPI.invoke('handle-ai-query', payload);
          if (result && result.success) {
              console.log("AI Query Response:", result.data);
          } else {
              console.error("AI Query failed:", result?.error);
          }
      } catch (error) {
          console.error("Error invoking handle-ai-query:", error);
      }
  }
  // --- End AI Query Trigger Modification Example ---

  return (
    <>
      <div className="fixed bottom-4 left-1/2 transform -translate-x-1/2 w-11/12 max-w-4xl bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-indigo-100 dark:border-gray-700 z-50 overflow-hidden flex flex-col max-h-[60vh]">
        {/* Header */}
        <div className="p-3 bg-gradient-to-r from-purple-500 to-indigo-600 flex justify-between items-center flex-shrink-0">
          <div className="flex items-center space-x-2">
            {/* Microphone Toggle Button */} 
            <button 
              className={`flex items-center justify-center w-7 h-7 rounded-full transition-colors ${ 
                isRecording 
                  ? "bg-red-500 hover:bg-red-600 text-white"
                  : "bg-white/20 hover:bg-white/30 text-white/80"
              }`}
              onClick={onToggleMicrophone}
              title={isRecording ? "Stop Recording" : "Start Recording"}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                <line x1="12" y1="19" x2="12" y2="23"/>
                <line x1="8" y1="23" x2="16" y2="23"/>
              </svg>
            </button>

            {/* --- Personality Dropdown --- */}
            <select
              value={selectedPersonality}
              onChange={handlePersonalityChange}
              className="text-xs h-7 bg-white/20 text-white/90 rounded border-none focus:ring-1 focus:ring-white/50 pl-2 pr-6 appearance-none"
              aria-label="AI Personality"
              style={{ 
                backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3E%3Cpath stroke='%23ffffffbf' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3E%3C/svg%3E")`, 
                backgroundPosition: 'right 0.3rem center', 
                backgroundRepeat: 'no-repeat', 
                backgroundSize: '1.2em 1.2em' 
              }} // Minimal styling, adjust as needed
            >
              {availablePersonalities.map(p => (
                <option key={p} value={p} className="text-black dark:text-white bg-white dark:bg-gray-700">{p}</option>
              ))}
            </select>

            {/* Settings Button (Gear Icon) - Opens Modal for Stage/Prefs */}
            <button
              className="flex items-center justify-center w-7 h-7 rounded-full bg-white/20 hover:bg-white/30 text-white/80 transition-colors"
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
              {speechService && <span className="ml-2 text-xs bg-white/20 px-2 py-0.5 rounded-full">{speechService === 'whisper' ? 'OpenAI Whisper' : 'Google Speech'}</span>}
            </h3>
          </div>

          {/* Close Button */}
          <button 
            onClick={onClose} 
            className="text-white/70 hover:text-white transition-colors p-1 rounded-full hover:bg-white/10"
            aria-label="Close Assistant Panel"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>
        
        {/* Main Content Area (Scrollable) */}
        <div className="flex-1 overflow-y-auto p-4 grid grid-cols-3 gap-4">
          
          {/* Left Column: Context & Resume */}
          <div className="col-span-1 space-y-4">
            <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 border-b pb-1 mb-2">Context</h4>
            <div>
              <label htmlFor="jobTitle" className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Job Title</label>
              <input 
                type="text" 
                id="jobTitle"
                name="jobTitle"
                value={jobContext.jobTitle}
                onChange={handleInputChange}
                className="w-full p-1.5 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-black dark:text-white text-xs focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
                placeholder="e.g., Software Engineer"
              />
            </div>
            <div>
              <label htmlFor="keySkills" className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Key Skills</label>
              <textarea 
                id="keySkills"
                name="keySkills"
                rows={3}
                value={jobContext.keySkills}
                onChange={handleInputChange}
                className="w-full p-1.5 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-black dark:text-white text-xs focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
                placeholder="e.g., React, Node.js, Python"
              />
            </div>
            <div>
              <label htmlFor="companyMission" className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Company Mission/Values</label>
              <textarea 
                id="companyMission"
                name="companyMission"
                rows={3}
                value={jobContext.companyMission}
                onChange={handleInputChange}
                className="w-full p-1.5 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-black dark:text-white text-xs focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
                placeholder="e.g., Innovation, Customer Focus"
              />
            </div>
            
            <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 border-b pb-1 mb-2 pt-2">Resume</h4>
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
                 className="w-full text-xs px-3 py-1.5 border border-dashed border-indigo-400 dark:border-indigo-600 text-indigo-600 dark:text-indigo-400 rounded hover:bg-indigo-50 dark:hover:bg-indigo-900/30 transition-colors"
               >
                 {resumeFileName ? `Uploaded: ${resumeFileName}` : "Upload Resume (.txt, .pdf, .docx)"}
               </button>
            </div>
          </div>

          {/* Right Columns: Transcription & Assistance */}
          <div className="col-span-2 space-y-4">
            {/* Transcription Area */}
            <div>
              <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 border-b pb-1 mb-2">Detected Speech</h4>
              <div className="min-h-[80px] p-2 bg-gray-100 dark:bg-gray-900 rounded border border-gray-200 dark:border-gray-700">
                {isRecording && !transcription && (
                  <div className="flex items-center text-gray-500 dark:text-gray-400 italic text-sm">
                    <div className="animate-pulse mr-2 h-2 w-2 bg-red-500 rounded-full"></div>
                    Listening...
                  </div>
                )}
                {isTranscribing && !transcription && (
                  <div className="flex items-center text-gray-500 dark:text-gray-400 italic text-sm">
                    {/* Loading dots */}
                    <div className="flex space-x-1 mr-2">
                      <div className="animate-bounce h-2 w-2 bg-blue-500 rounded-full" style={{ animationDelay: '0ms' }}></div>
                      <div className="animate-bounce h-2 w-2 bg-blue-500 rounded-full" style={{ animationDelay: '150ms' }}></div>
                      <div className="animate-bounce h-2 w-2 bg-blue-500 rounded-full" style={{ animationDelay: '300ms' }}></div>
                    </div>
                    Transcribing...
                  </div>
                )}
                {transcription && (
                  <p className="text-black dark:text-white text-sm whitespace-pre-wrap">
                    {transcription}
                  </p>
                )}
                {/* Show placeholder if idle and no transcription */}
                {!isRecording && !isTranscribing && !transcription && (
                   <p className="text-gray-400 dark:text-gray-500 italic text-sm">Transcription will appear here.</p>
                )}
              </div>
            </div>

            {/* AI Assistance Area */}
            <div>
              <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 border-b pb-1 mb-2">AI Assistance</h4>
               <div className="min-h-[80px] p-2 bg-indigo-50 dark:bg-indigo-900/20 rounded border border-indigo-200 dark:border-indigo-800">
                {isAssistantProcessing && (
                   <div className="flex items-center text-indigo-600 dark:text-indigo-400 italic text-sm">
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
                   <div className="text-indigo-900 dark:text-indigo-200 text-sm whitespace-pre-wrap">
                     {generatedAssistance.split('\n').map((line, index) => (
                      <React.Fragment key={index}>
                        {/* Simple attempt to make bullet points look better */}
                        {line.trim().startsWith('*') || line.trim().startsWith('-') ? 
                          <span className="flex items-start"><span className="mr-1.5 mt-1 inline-block h-1 w-1 rounded-full bg-indigo-500 dark:bg-indigo-400 flex-shrink-0"></span><span>{line.trim().substring(1).trim()}</span></span>
                          : line}
                        <br />
                      </React.Fragment>
                    ))}
                  </div>
                 )}
                 {/* Show placeholder if idle and no assistance */}
                 {!isAssistantProcessing && !generatedAssistance && (
                   <p className="text-indigo-400 dark:text-indigo-600 italic text-sm">Talking points will appear here based on detected speech when assistant is active.</p>
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