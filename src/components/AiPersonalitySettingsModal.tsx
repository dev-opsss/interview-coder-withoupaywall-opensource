import React, { useState, useEffect } from 'react';

interface AiPersonalitySettingsModalProps {
  isOpen: boolean;
  initialInterviewStage: string;
  initialUserPreferences: string;
  onSave: (interviewStage: string, userPreferences: string) => void;
  onClose: () => void;
}

export const AiPersonalitySettingsModal: React.FC<AiPersonalitySettingsModalProps> = ({
  isOpen,
  initialInterviewStage,
  initialUserPreferences,
  onSave,
  onClose,
}) => {
  const [interviewStage, setInterviewStage] = useState(initialInterviewStage);
  const [userPreferences, setUserPreferences] = useState(initialUserPreferences);

  useEffect(() => {
    setInterviewStage(initialInterviewStage);
  }, [initialInterviewStage]);

  useEffect(() => {
    setUserPreferences(initialUserPreferences);
  }, [initialUserPreferences]);

  if (!isOpen) {
    return null;
  }

  const handleSave = () => {
    onSave(interviewStage, userPreferences);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 dark:bg-opacity-70 z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md border border-indigo-100 dark:border-gray-700 overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-3 bg-gradient-to-r from-purple-500 to-indigo-600 flex justify-between items-center flex-shrink-0">
          <h3 className="font-medium text-white text-sm">AI Personality Settings</h3>
          <button
            onClick={onClose}
            className="text-white/70 hover:text-white transition-colors p-1 rounded-full hover:bg-white/10"
            aria-label="Close Settings"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4 overflow-y-auto">
          <div>
            <label htmlFor="interviewStage" className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Interview Stage</label>
            <select
              id="interviewStage"
              value={interviewStage}
              onChange={(e) => setInterviewStage(e.target.value)}
              className="w-full p-1.5 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-black dark:text-white text-xs focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
            >
              <option>Initial Screening</option>
              <option>Technical Round</option>
              <option>Behavioral Interview</option>
              <option>System Design</option>
              <option>Final Round</option>
              <option>Other</option>
            </select>
          </div>
          <div>
            <label htmlFor="userPreferences" className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Your Preferences (Tone, Focus)</label>
            <textarea
              id="userPreferences"
              rows={3}
              value={userPreferences}
              onChange={(e) => setUserPreferences(e.target.value)}
              className="w-full p-1.5 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-black dark:text-white text-xs focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
              placeholder="e.g., Keep answers concise. Sound more confident. Focus on scalability."
            />
          </div>
        </div>

        {/* Footer */}
        <div className="p-3 bg-gray-50 dark:bg-gray-900 flex justify-end space-x-2 flex-shrink-0 border-t border-gray-200 dark:border-gray-700">
           <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs font-medium rounded border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-3 py-1.5 text-xs font-medium rounded bg-indigo-600 hover:bg-indigo-700 text-white transition-colors"
          >
            Save Settings
          </button>
        </div>
      </div>
    </div>
  );
}; 