import { useState, useEffect, useCallback } from 'react';

type RecordingStatus = 'idle' | 'recording' | 'processing' | 'error';

interface UseVoiceTranscriptionProps {
  autoPrompt?: boolean;
  onTranscriptionComplete?: (text: string) => void;
  onError?: (error: string) => void;
}

export function useVoiceTranscription({
  autoPrompt = false,
  onTranscriptionComplete,
  onError
}: UseVoiceTranscriptionProps = {}) {
  const [isRecording, setIsRecording] = useState(false);
  const [status, setStatus] = useState<RecordingStatus>('idle');
  const [transcription, setTranscription] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Set up listeners for transcription results
  useEffect(() => {
    if (!window.voiceAPI) {
      console.error('Voice API not available');
      return () => {};
    }

    const unsubscribe = window.voiceAPI.on('transcription-result', (result: { text: string; error?: string }) => {
      setStatus('idle');
      setIsRecording(false);
      
      if (result.error) {
        setError(result.error);
        onError?.(result.error);
        return;
      }
      
      setTranscription(result.text);
      if (onTranscriptionComplete) {
        onTranscriptionComplete(result.text);
      }
    });

    const statusUnsubscribe = window.voiceAPI.on('recording-status', (status: RecordingStatus) => {
      setStatus(status);
    });

    return () => {
      unsubscribe();
      statusUnsubscribe();
    };
  }, [onTranscriptionComplete, onError]);

  const startRecording = useCallback(async () => {
    if (!window.voiceAPI) {
      const errorMessage = 'Voice API not available';
      setError(errorMessage);
      onError?.(errorMessage);
      return;
    }

    try {
      setError(null);
      setStatus('recording');
      setIsRecording(true);
      await window.voiceAPI.invoke('start-recording');
    } catch (err) {
      setStatus('error');
      setIsRecording(false);
      const errorMessage = err instanceof Error ? err.message : 'Failed to start recording';
      setError(errorMessage);
      onError?.(errorMessage);
    }
  }, [onError]);

  const stopRecording = useCallback(async () => {
    if (!isRecording || !window.voiceAPI) return;
    
    try {
      setStatus('processing');
      await window.voiceAPI.invoke('stop-recording');
      
      // If autoPrompt is enabled, immediately transcribe
      if (autoPrompt) {
        await window.voiceAPI.invoke('transcribe-audio');
      }
    } catch (err) {
      setStatus('error');
      const errorMessage = err instanceof Error ? err.message : 'Failed to stop recording';
      setError(errorMessage);
      onError?.(errorMessage);
    } finally {
      setIsRecording(false);
    }
  }, [isRecording, autoPrompt, onError]);

  const transcribeAudio = useCallback(async () => {
    if (!window.voiceAPI) {
      const errorMessage = 'Voice API not available';
      setError(errorMessage);
      onError?.(errorMessage);
      return;
    }

    try {
      setStatus('processing');
      await window.voiceAPI.invoke('transcribe-audio');
    } catch (err) {
      setStatus('error');
      const errorMessage = err instanceof Error ? err.message : 'Failed to transcribe audio';
      setError(errorMessage);
      onError?.(errorMessage);
    }
  }, [onError]);

  return {
    isRecording,
    status,
    transcription,
    error,
    startRecording,
    stopRecording,
    transcribeAudio
  };
}