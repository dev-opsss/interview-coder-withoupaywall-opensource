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
    <div className="space-y-2">
      <Toaster position="top-right" />
      <div className="setting-group">
        <h3 className="text-xs font-medium text-white mb-1">Google Cloud Speech API</h3>
        
        {/* API Key section */}
        <div className="mb-2">
          <label className="block mb-1 text-xs font-medium text-white/80">API Key</label>
          <div className="flex flex-col gap-1">
            <input 
              type="password" 
              value={apiKey} 
              onChange={handleApiKeyChange}
              className="flex-1 p-1.5 border border-white/20 rounded bg-black/50 text-white text-xs h-7"
              placeholder="Google Speech API Key" 
              disabled={isLoading}
            />
            <button 
              onClick={saveApiKey} 
              className="px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs h-7 disabled:opacity-50"
              disabled={isLoading}
            >
              {isLoading ? 'Saving...' : 'Save'}
            </button>
          </div>
          <p className="mt-0.5 text-[10px] text-white/50">
            Basic authentication key
          </p>
        </div>
        
        {/* Service Account section */}
        <div>
          <label className="block mb-1 text-xs font-medium text-white/80">
            Service Account (Recommended)
          </label>
          <p className="text-[10px] text-white/50 mb-1">
            Upload JSON file for enhanced security
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
          
          <div className="flex flex-col gap-1">
            <button 
              onClick={() => serviceAccountFileRef.current?.click()} 
              className="px-2 py-1 bg-white/10 text-white hover:bg-white/20 border border-white/10 rounded flex items-center justify-center gap-1 text-xs h-7 disabled:opacity-50"
              disabled={isLoading}
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-3 h-3">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 16.5V9.75m0 0l-3 3m3-3l3 3M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.338 0 4.5 4.5 0 01-1.41 8.775H6.75z" />
              </svg>
              Choose JSON
            </button>
            
            {serviceAccountFileName && (
              <button 
                onClick={clearServiceAccountFile}
                className="px-2 py-1 bg-red-600 hover:bg-red-700 text-white rounded flex items-center justify-center gap-1 text-xs h-7 disabled:opacity-50"
                disabled={isLoading}
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-3 h-3">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12.56 0c1.153 0 2.24.032 3.22.096M15 5.25a3 3 0 11-6 0 3 3 0 016 0zm6 3a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm-12.75 0a.75.75 0 11-1.5 0 .75.75 0 011.5 0z" />
                </svg>
                Clear
              </button>
            )}
          </div>
          
          {serviceAccountFileName && (
            <div className="mt-1 p-1 bg-green-900/20 border border-green-800 rounded">
              <span className="text-green-400 text-[10px] font-medium">
                ✓ {serviceAccountFileName}
              </span>
            </div>
          )}
          
          <div className="mt-1 p-1.5 bg-blue-900/20 border border-blue-800 rounded">
            <h4 className="text-[10px] font-medium text-blue-400 mb-1">Setup:</h4>
            <p className="text-[9px] text-blue-300">
              Get JSON from <a href="https://console.cloud.google.com/" target="_blank" rel="noopener noreferrer" className="underline">Google Cloud Console</a> → IAM & Admin → Service Accounts
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}; 