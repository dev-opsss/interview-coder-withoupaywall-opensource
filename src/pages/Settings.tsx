import React from 'react';
import { GoogleSpeechSettings } from '../components/GoogleSpeechSettings';

const Settings = () => {
  return (
    <div className="container mx-auto px-4 py-6">
      <h1 className="text-2xl font-bold mb-6">Settings</h1>
      
      {/* API Settings Section */}
      <div className="mb-8 bg-white dark:bg-gray-800 shadow-md rounded-lg p-6">
        <h2 className="text-xl font-semibold mb-4">API Settings</h2>
        
        {/* Google Speech Settings */}
        <div className="mt-8 pt-6 border-t border-gray-200 dark:border-gray-700">
          <GoogleSpeechSettings 
            onSettingsChanged={() => {
              // Handle settings changed event, e.g., show a notification or refresh data
              console.log('Google Speech settings updated');
            }} 
          />
        </div>
      </div>
      
      {/* ... other settings sections ... */}
    </div>
  );
};

export default Settings; 