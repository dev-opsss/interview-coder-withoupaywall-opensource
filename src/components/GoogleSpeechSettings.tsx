import React, { useRef, useState, useEffect } from 'react';
import { toast, Toaster } from 'react-hot-toast';

interface GoogleSpeechSettingsProps {
  onSettingsChanged?: () => void;
}

export const GoogleSpeechSettings: React.FC<GoogleSpeechSettingsProps> = ({ 
  onSettingsChanged 
}) => {
  const [apiKey, setApiKey] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [serviceAccountFileName, setServiceAccountFileName] = useState<string | null>(null);
  const serviceAccountFileRef = useRef<HTMLInputElement>(null);

  // Load initial values
  useEffect(() => {
    const loadApiKey = async () => {
      try {
        const key = await window.electronAPI.getGoogleSpeechApiKey();
        if (key) {
          // Mask the key for display (keep first 4 and last 4 chars)
          const maskedKey = key.length > 8 
            ? `${key.substring(0, 4)}${'*'.repeat(key.length - 8)}${key.substring(key.length - 4)}`
            : key;
          setApiKey(maskedKey);
        }
        
        // Check if we have a service account file
        const hasServiceAccount = await window.electronAPI.hasServiceAccountCredentials();
        if (hasServiceAccount) {
          setServiceAccountFileName('Service account credentials loaded');
        }
      } catch (error) {
        console.error("Failed to load Google Speech settings:", error);
      }
    };
    
    loadApiKey();
  }, []);

  const handleApiKeyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setApiKey(e.target.value);
  };

  const saveApiKey = async () => {
    if (!apiKey) {
      toast.error("Please enter an API key");
      return;
    }
    
    setIsLoading(true);
    try {
      const result = await window.electronAPI.setGoogleSpeechApiKey(apiKey);
      if (result?.success) {
        toast.success("API key saved successfully");
        if (onSettingsChanged) onSettingsChanged();
      } else {
        toast.error("Failed to save API key");
      }
    } catch (error) {
      console.error("Error saving API key:", error);
      toast.error("An error occurred while saving the API key");
    } finally {
      setIsLoading(false);
    }
  };

  const handleServiceAccountFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    setIsLoading(true);
    try {
      setServiceAccountFileName(file.name);
      
      // Call the Electron API to load the service account file
      const result = await window.electronAPI.setServiceAccountCredentialsFromFile(file.path);
      
      if (result.success) {
        toast.success("Service account credentials loaded successfully");
        if (onSettingsChanged) onSettingsChanged();
      } else {
        toast.error(result.error || "Failed to load service account credentials");
        setServiceAccountFileName(null);
      }
    } catch (error) {
      console.error("Error setting service account credentials:", error);
      toast.error("Failed to set service account credentials");
      setServiceAccountFileName(null);
    } finally {
      setIsLoading(false);
      
      // Clear the input
      if (serviceAccountFileRef.current) {
        serviceAccountFileRef.current.value = "";
      }
    }
  };

  const clearServiceAccountFile = async () => {
    setIsLoading(true);
    try {
      // Call API to clear credentials
      const result = await window.electronAPI.clearServiceAccountCredentials();
      if (result.success) {
        setServiceAccountFileName(null);
        toast.success("Service account credentials cleared");
        if (onSettingsChanged) onSettingsChanged();
      } else {
        toast.error(result.error || "Failed to clear service account credentials");
      }
    } catch (error) {
      console.error("Error clearing service account credentials:", error);
      toast.error("Failed to clear service account credentials");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <Toaster position="top-right" />
      <div className="setting-group">
        <h3 className="text-lg font-medium text-black-900 dark:text-gray-100 mb-4">Google Cloud Speech API Authentication</h3>
        
        {/* API Key section */}
        <div className="mb-6">
          <label className="block mb-2 text-sm font-medium text-black-700 dark:text-gray-300">API Key</label>
          <div className="flex flex-col sm:flex-row gap-2">
            <input 
              type="password" 
              value={apiKey} 
              onChange={handleApiKeyChange}
              className="flex-1 p-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200"
              placeholder="Enter your Google Speech API Key" 
              disabled={isLoading}
            />
            <button 
              onClick={saveApiKey} 
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={isLoading}
            >
              {isLoading ? 'Saving...' : 'Save API Key'}
            </button>
          </div>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Enter your Google Cloud Speech-to-Text API key for basic authentication.
          </p>
        </div>
        
        {/* Service Account section */}
        <div>
          <label className="block mb-2 text-sm font-medium text-black-700 dark:text-gray-300">
            Service Account (Recommended)
          </label>
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
            Upload a Google Cloud service account JSON file for enhanced security and features.
            This provides more capabilities than just an API key.
          </p>
          
          <input 
            type="file" 
            ref={serviceAccountFileRef}
            onChange={handleServiceAccountFileChange} 
            accept=".json" 
            className="hidden"
            id="service-account-upload"
            disabled={isLoading}
          />
          
          <div className="flex flex-col sm:flex-row gap-2">
            <button 
              onClick={() => serviceAccountFileRef.current?.click()} 
              className="px-2 py-2 bg-white/10 text-white hover:bg-white/20 border border-white/10 rounded-xl font-small flex items-center justify-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm"
              disabled={isLoading}
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 16.5V9.75m0 0l-3 3m3-3l3 3M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.338 0 4.5 4.5 0 01-1.41 8.775H6.75z" />
              </svg>
              Choose Service Account JSON File
            </button>
            
            {serviceAccountFileName && (
              <button 
                onClick={clearServiceAccountFile}
                className="px-2 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl font-small flex items-center justify-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                disabled={isLoading}
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12.56 0c1.153 0 2.24.032 3.22.096M15 5.25a3 3 0 11-6 0 3 3 0 016 0zm6 3a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm-12.75 0a.75.75 0 11-1.5 0 .75.75 0 011.5 0z" />
                </svg>
                Clear Credentials
              </button>
            )}
          </div>
          
          {serviceAccountFileName && (
            <div className="mt-3 p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded">
              <span className="text-green-800 dark:text-green-400 text-sm font-medium">
                ✓ {serviceAccountFileName}
              </span>
            </div>
          )}
          
          <div className="mt-4 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded">
            <h4 className="text-sm font-medium text-blue-800 dark:text-blue-400 mb-2">How to get a service account file:</h4>
            <ol className="list-decimal list-inside text-sm text-blue-700 dark:text-blue-300 space-y-1">
              <li>Go to the <a href="https://console.cloud.google.com/" target="_blank" rel="noopener noreferrer" className="underline">Google Cloud Console</a></li>
              <li>Create or select an existing project</li>
              <li>Enable the Speech-to-Text API for your project</li>
              <li>Navigate to "IAM & Admin" {'->'} "Service Accounts"</li>
              <li>Create a new service account or select an existing one</li>
              <li>Create and download a new key (JSON format)</li>
              <li>Upload the downloaded JSON file here</li>
            </ol>
          </div>
        </div>
      </div>
    </div>
  );
}; 