import React, { useState, useRef } from 'react';
import { configHelper } from '../../electron/ConfigHelper';
import './ServiceAccountSetup.css';

interface ServiceAccountSetupProps {
  onCredentialsSet?: () => void;
  onCancel?: () => void;
}

/**
 * Component for uploading and configuring Google Speech API service account credentials
 */
const ServiceAccountSetup: React.FC<ServiceAccountSetupProps> = ({ onCredentialsSet, onCancel }) => {
  const [credentialsType, setCredentialsType] = useState<'file' | 'paste'>('file');
  const [credentialsText, setCredentialsText] = useState('');
  const [fileName, setFileName] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleCredentialsTypeChange = (type: 'file' | 'paste') => {
    setCredentialsType(type);
    setError(null);
  };

  const handleCredentialsTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setCredentialsText(e.target.value);
    setError(null);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const content = event.target?.result as string;
        // Validate JSON format
        JSON.parse(content);
        setCredentialsText(content);
      } catch (err) {
        setError('Invalid JSON file. Please upload a valid service account key file.');
      }
    };
    reader.onerror = () => {
      setError('Error reading file. Please try again.');
    };
    reader.readAsText(file);
  };

  const validateCredentials = (json: string): boolean => {
    try {
      const credentials = JSON.parse(json);
      
      // Basic validation of service account JSON format
      if (!credentials.type || credentials.type !== 'service_account') {
        setError('Invalid service account format: Missing or incorrect "type" field.');
        return false;
      }
      
      if (!credentials.project_id) {
        setError('Invalid service account format: Missing "project_id" field.');
        return false;
      }
      
      if (!credentials.private_key) {
        setError('Invalid service account format: Missing "private_key" field.');
        return false;
      }
      
      if (!credentials.client_email) {
        setError('Invalid service account format: Missing "client_email" field.');
        return false;
      }
      
      return true;
    } catch (err) {
      setError('Invalid JSON format. Please check your credentials.');
      return false;
    }
  };

  const handleSubmit = async () => {
    setError(null);
    setIsUploading(true);
    
    try {
      if (!credentialsText.trim()) {
        setError('Please provide service account credentials.');
        setIsUploading(false);
        return;
      }
      
      // Validate credentials
      if (!validateCredentials(credentialsText)) {
        setIsUploading(false);
        return;
      }
      
      // Store credentials securely
      configHelper.storeServiceAccountKey(credentialsText);
      
      // Show success message
      setSuccess(true);
      
      // Notify parent component
      if (onCredentialsSet) {
        onCredentialsSet();
      }
    } catch (err: any) {
      setError(`Error saving credentials: ${err.message || 'Unknown error'}`);
    } finally {
      setIsUploading(false);
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    
    const file = e.dataTransfer.files[0];
    if (!file) return;
    
    // Update the file input
    if (fileInputRef.current) {
      // Create a new FileList object
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      fileInputRef.current.files = dataTransfer.files;
      
      setFileName(file.name);
      
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const content = event.target?.result as string;
          // Validate JSON format
          JSON.parse(content);
          setCredentialsText(content);
        } catch (err) {
          setError('Invalid JSON file. Please upload a valid service account key file.');
        }
      };
      reader.onerror = () => {
        setError('Error reading file. Please try again.');
      };
      reader.readAsText(file);
    }
  };

  return (
    <div className="service-account-setup">
      <h2>Google Speech API Credentials Setup</h2>
      
      <div className="setup-options">
        <div className="option-tabs">
          <button 
            className={`tab ${credentialsType === 'file' ? 'active' : ''}`}
            onClick={() => handleCredentialsTypeChange('file')}
          >
            Upload File
          </button>
          <button 
            className={`tab ${credentialsType === 'paste' ? 'active' : ''}`}
            onClick={() => handleCredentialsTypeChange('paste')}
          >
            Paste JSON
          </button>
        </div>
        
        <div className="setup-content">
          {credentialsType === 'file' ? (
            <div 
              className="file-upload-area"
              onDragOver={handleDragOver}
              onDrop={handleDrop}
            >
              <input 
                type="file"
                ref={fileInputRef}
                id="credentials-file" 
                accept=".json"
                onChange={handleFileChange}
                style={{ display: 'none' }}
              />
              <div className="upload-prompt">
                <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                  <polyline points="17 8 12 3 7 8"></polyline>
                  <line x1="12" y1="3" x2="12" y2="15"></line>
                </svg>
                <p>Drag & drop your service account JSON file here</p>
                <p className="or">- OR -</p>
                <button 
                  className="browse-button"
                  onClick={() => fileInputRef.current?.click()}
                >
                  Browse Files
                </button>
                {fileName && <p className="file-name">Selected: {fileName}</p>}
              </div>
            </div>
          ) : (
            <div className="json-paste-area">
              <p className="paste-instruction">Paste your service account JSON credentials below:</p>
              <textarea
                value={credentialsText}
                onChange={handleCredentialsTextChange}
                placeholder='{"type":"service_account","project_id":"your-project","private_key":"...",...}'
                rows={10}
              />
            </div>
          )}
          
          {error && <div className="error-message">{error}</div>}
          {success && <div className="success-message">Credentials successfully saved!</div>}
          
          <div className="action-buttons">
            <button 
              className="cancel-button" 
              onClick={onCancel}
            >
              Cancel
            </button>
            <button 
              className="submit-button" 
              onClick={handleSubmit}
              disabled={isUploading || !credentialsText.trim()}
            >
              {isUploading ? 'Saving...' : 'Save Credentials'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ServiceAccountSetup; 