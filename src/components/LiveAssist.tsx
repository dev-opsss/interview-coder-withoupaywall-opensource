import React, { useState, useEffect, useRef } from 'react';
import { Box, Button, Typography, CircularProgress, Stack, Switch, FormControlLabel, Alert } from '@mui/material';
import MicIcon from '@mui/icons-material/Mic';
import StopIcon from '@mui/icons-material/Stop';
import '../styles/LiveAssist.css';

interface LiveAssistProps {
  jobContext?: any;
  resumeText?: string | null;
}

const LiveAssist: React.FC<LiveAssistProps> = ({ jobContext, resumeText }) => {
  // State
  const [isActive, setIsActive] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [suggestion, setSuggestion] = useState('');
  const [isGeneratingSuggestion, setIsGeneratingSuggestion] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Refs
  const continuousProcessingRef = useRef<{ start: () => Promise<boolean>, stop: () => void } | null>(null);
  const transcriptContainerRef = useRef<HTMLDivElement>(null);
  
  // Effect to scroll to bottom when transcript updates
  useEffect(() => {
    if (transcriptContainerRef.current) {
      transcriptContainerRef.current.scrollTop = transcriptContainerRef.current.scrollHeight;
    }
  }, [transcript]);
  
  // Effect to cleanup on unmount
  useEffect(() => {
    return () => {
      if (continuousProcessingRef.current) {
        continuousProcessingRef.current.stop();
      }
    };
  }, []);
  
  // Handle toggle
  const handleToggle = async () => {
    try {
      if (isActive) {
        // Stop continuous processing
        if (continuousProcessingRef.current) {
          continuousProcessingRef.current.stop();
          continuousProcessingRef.current = null;
        }
        setIsActive(false);
        setError(null);
      } else {
        setIsActive(true);
        setIsProcessing(true);
        setError(null);
        
        // Request microphone permissions
        try {
          await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch (error) {
          console.error('Microphone access denied:', error);
          setError('Microphone access denied. Please allow microphone access and try again.');
          setIsActive(false);
          setIsProcessing(false);
          return;
        }
        
        // Initialize continuous processing
        try {
          // Call the preload API to get the processing helper
          const { start, stop } = await window.electronAPI.enableContinuousProcessing(
            // Transcript update callback
            (text: string, isFinal: boolean) => {
              setTranscript(text);
            },
            // Suggestion start callback
            () => {
              setIsGeneratingSuggestion(true);
            },
            // Suggestion ready callback
            (suggestion: string) => {
              setSuggestion(suggestion);
              setIsGeneratingSuggestion(false);
            },
            jobContext,
            resumeText
          );
          
          continuousProcessingRef.current = { start, stop };
          
          // Start processing
          const success = await start();
          if (!success) {
            throw new Error('Failed to start continuous processing');
          }
          
          setIsProcessing(false);
        } catch (error) {
          console.error('Error starting continuous processing:', error);
          setError('Error starting continuous processing. Please try again.');
          setIsActive(false);
          setIsProcessing(false);
        }
      }
    } catch (error) {
      console.error('Error toggling continuous processing:', error);
      setError('An unexpected error occurred. Please try again.');
      setIsActive(false);
      setIsProcessing(false);
    }
  };
  
  // Clear transcript and suggestion
  const handleClear = () => {
    setTranscript('');
    setSuggestion('');
  };
  
  return (
    <Box className="live-assist-container">
      <Box sx={{ mb: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="h6">Live Interview Assistant</Typography>
        <FormControlLabel
          control={
            <Switch
              checked={isActive}
              onChange={handleToggle}
              disabled={isProcessing}
              color="primary"
            />
          }
          label={isActive ? "Active" : "Inactive"}
        />
      </Box>
      
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}
      
      <Box sx={{ mb: 2 }}>
        <Typography variant="subtitle1" sx={{ mb: 1 }}>
          Your Speech
          {isActive && <span className="pulse-dot"></span>}
        </Typography>
        <Box 
          ref={transcriptContainerRef}
          className="transcript-container"
          sx={{ 
            bgcolor: 'background.paper', 
            borderRadius: 1,
            p: 2,
            minHeight: '100px',
            maxHeight: '200px',
            overflowY: 'auto'
          }}
        >
          {transcript ? (
            <Typography className="transcript-text">
              {transcript}
            </Typography>
          ) : (
            <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
              {isActive 
                ? "Speak, and your words will appear here..." 
                : "Turn on Live Assist to start voice-activated interviewing"}
            </Typography>
          )}
        </Box>
      </Box>
      
      <Box sx={{ mb: 2 }}>
        <Typography variant="subtitle1" sx={{ mb: 1 }}>
          AI Response
          {isGeneratingSuggestion && <CircularProgress size={16} sx={{ ml: 1 }} />}
        </Typography>
        <Box 
          className="suggestion-container"
          sx={{ 
            bgcolor: 'background.paper', 
            borderRadius: 1,
            p: 2,
            minHeight: '150px',
            maxHeight: '300px',
            overflowY: 'auto'
          }}
        >
          {suggestion ? (
            <Typography className="suggestion-text">
              {suggestion}
            </Typography>
          ) : (
            <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
              {isActive 
                ? isGeneratingSuggestion 
                  ? "Generating response..." 
                  : "Ask a question to get a response"
                : "Turn on Live Assist to get AI-powered responses"}
            </Typography>
          )}
        </Box>
      </Box>
      
      <Stack direction="row" spacing={2} justifyContent="flex-end">
        <Button 
          variant="outlined" 
          onClick={handleClear}
          disabled={!transcript && !suggestion}
        >
          Clear
        </Button>
      </Stack>
    </Box>
  );
};

export default LiveAssist; 