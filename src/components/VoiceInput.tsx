import React, { useState, useEffect } from 'react';
import { Button, Switch, FormControlLabel, Box, Typography } from '@mui/material';
import MicIcon from '@mui/icons-material/Mic';
import StopIcon from '@mui/icons-material/Stop';

const VoiceInput: React.FC = () => {
  const [isRecording, setIsRecording] = useState(false);
  const [autoPrompt, setAutoPrompt] = useState(false);
  const [transcription, setTranscription] = useState('');
  
  useEffect(() => {
    // Listen for transcription results from main process
    window.electron.on('transcription-result', (data: any) => {
      setTranscription(data.text);
      
      // If autoPrompt is enabled, automatically send to model
      if (data.autoPrompt) {
        window.electron.send('send-message', data.text);
      }
    });
    
    return () => {
      // Clean up listeners
      window.electron.removeAllListeners('transcription-result');
    };
  }, []);
  
  const handleStartRecording = async () => {
    const result = await window.electron.invoke('start-recording');
    if (result.success) {
      setIsRecording(true);
    } else {
      console.error(result.message);
    }
  };
  
  const handleStopRecording = async () => {
    const result = await window.electron.invoke('stop-recording');
    if (result.success) {
      setIsRecording(false);
      
      // Transcribe the audio
      await window.electron.invoke('transcribe-audio', autoPrompt);
    } else {
      console.error(result.message);
    }
  };
  
  const handleSendTranscription = () => {
    if (transcription) {
      window.electron.send('send-message', transcription);
      setTranscription('');
    }
  };
  
  return (
    <Box sx={{ mt: 2, p: 2, border: '1px solid #ddd', borderRadius: 2 }}>
      <Typography variant="h6">Voice Input</Typography>
      
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
        {!isRecording ? (
          <Button 
            variant="contained" 
            color="primary" 
            startIcon={<MicIcon />}
            onClick={handleStartRecording}
          >
            Start Recording
          </Button>
        ) : (
          <Button 
            variant="contained" 
            color="secondary" 
            startIcon={<StopIcon />}
            onClick={handleStopRecording}
          >
            Stop Recording
          </Button>
        )}
        
        <FormControlLabel
          control={
            <Switch
              checked={autoPrompt}
              onChange={(e) => setAutoPrompt(e.target.checked)}
            />
          }
          label="Auto-send to model"
          sx={{ ml: 2 }}
        />
      </Box>
      
      {transcription && (
        <Box sx={{ mt: 2 }}>
          <Typography variant="body1" sx={{ mb: 1 }}>Transcription:</Typography>
          <Box sx={{ p: 2, bgcolor: '#f5f5f5', borderRadius: 1 }}>
            {transcription}
          </Box>
          
          {!autoPrompt && (
            <Button 
              variant="outlined" 
              sx={{ mt: 1 }}
              onClick={handleSendTranscription}
            >
              Send to Model
            </Button>
          )}
        </Box>
      )}
    </Box>
  );
};

export default VoiceInput;