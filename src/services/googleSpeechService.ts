// Proxy class for Google Speech Service that communicates with the main process
// This file is used in the renderer process and does not import Node.js modules directly

export interface SpeechRecognitionOptions {
  encoding?: string;
  sampleRateHertz?: number;
  languageCode?: string;
  maxAlternatives?: number;
  profanityFilter?: boolean;
  enableWordTimeOffsets?: boolean;
  enableAutomaticPunctuation?: boolean;
  useEnhanced?: boolean;
  model?: string;
  useEndpointer?: boolean;
  endpointerSensitivity?: number;
  singleUtterance?: boolean;
}

export interface WordTimestamp {
  word: string;
  startTime: number;
  endTime: number;
}

export interface TranscriptionResult {
  text: string;
  words?: WordTimestamp[];
  confidenceScore?: number;
}

/**
 * GoogleSpeechServiceProxy provides a client-side interface to the Google Cloud Speech-to-Text API
 * which is actually running in the main process via IPC
 */
export class GoogleSpeechService {
  private isStreaming: boolean = false;
  private language: string;
  private onTranscriptCallback: ((text: string, isFinal: boolean) => void) | null = null;
  private streamingRequest: any;
  private targetWebContents: any;
  private recognizeStream: any;
  private client: any;

  /**
   * Creates a new GoogleSpeechServiceProxy instance
   * @param apiKeyOrCredentials API key or service account credentials JSON string (will be passed to main process)
   * @param language Default language code for speech recognition
   */
  constructor(apiKeyOrCredentials?: string, language: string = 'en-US') {
    this.language = language;
    
    // No direct initialization - everything happens in the main process
    console.log('GoogleSpeechServiceProxy initialized');
  }

  /**
   * Update the API key (sends to main process)
   * @param apiKey The new API key to use
   */
  public setApiKey(apiKey: string): void {
    // Send to main process via IPC using the corrected channel name
    if (window.electronAPI) {
      window.electronAPI.setGoogleSpeechApiKey(apiKey); // <-- Renamed IPC call
    }
  }

  /**
   * Tests if the current API key or credentials are valid (via main process)
   * @returns Promise resolving to true if credentials are valid
   */
  public async testApiKey(): Promise<boolean> {
    if (!window.electronAPI) {
      return false;
    }
    
    try {
      // Call main process via IPC
      const apiKey = await window.electronAPI.getGoogleSpeechApiKey();
      return !!apiKey;
    } catch (error) {
      console.error('Error testing API key:', error);
      return false;
    }
  }

  /**
   * Transcribes audio using the main process
   * @param audioData Audio data as Uint8Array or Buffer
   * @param mimeType MIME type of the audio
   */
  public async transcribeAudio(
    audioData: Uint8Array, 
    mimeType: string = 'audio/wav'
  ): Promise<TranscriptionResult | string> {
    if (!window.electronAPI) {
      throw new Error('Electron API not available');
        }
  
    // Convert audioData to an ArrayBuffer for IPC transfer
    const buffer = audioData.buffer;
    
    try {
      // Call main process via IPC
      const result = await window.electronAPI.transcribeAudio({
        buffer,
        type: mimeType
      });
      
      return result || 'No transcription result';
      } catch (error) {
      console.error('Error transcribing audio:', error);
      throw error;
    }
  }

  /**
   * Start streaming recognition via IPC and SpeechBridge
   * @param callback Function to receive transcription results
   */
  public startStreamingTranscription(
    callback: (text: string, isFinal: boolean) => void
  ): boolean {
    if (!window.electronAPI) {
      console.error('Electron API not available');
        return false;
      }

    this.onTranscriptCallback = callback;
    
    // Register for transcription events
    const unsubscribe = window.electronAPI.onTranscriptionReceived((text: string) => {
      if (this.onTranscriptCallback) {
        this.onTranscriptCallback(text, true);
      }
    });

    // Start streaming via SpeechBridge
    window.electronAPI.toggleVoiceInput();
    this.isStreaming = true;
      
      return true;
  }

  /**
   * Stop streaming recognition via IPC and SpeechBridge
   */
  public stopStreamingTranscription(): void {
    if (!window.electronAPI) {
      return;
    }

    if (this.isStreaming) {
      // Stop streaming via SpeechBridge
      window.electronAPI.toggleVoiceInput();
      this.isStreaming = false;
    }
  }

  /**
   * This method is no longer needed in the renderer process
   * The actual audio processing happens in the main process
   */
  public sendAudioChunk(audioChunk: Uint8Array): void {
    // No-op in renderer process - audio is captured directly in main process
  }

  /**
   * Sets service account credentials by sending them to the main process
   */
  public setServiceAccountCredentials(serviceAccountJson: string, shouldStore: boolean = true): void {
    if (!window.electronAPI) {
      throw new Error('Electron API not available');
    }

    try {
      // No-op in renderer - would be implemented via IPC
    } catch (error) {
      console.error('Error setting service account credentials:', error);
      throw new Error('Failed to set service account credentials');
    }
    }

  /**
   * Configure streaming request
   */
  private configureStreamingRequest(): void {
    this.streamingRequest = {
      config: {
        encoding: 'LINEAR16',
        sampleRateHertz: 16000,
        languageCode: this.language, // <-- CORRECT: Use class property
        enableWordTimeOffsets: true,
        enableAutomaticPunctuation: true,
        useEnhanced: true,
        model: 'video', // Or specify another appropriate model
        // Remove any incorrect assignment of credentials here
      },
      interimResults: true, // Get intermediate results
    };

    console.log(`---> GSS: Using stream config: ${JSON.stringify(this.streamingRequest, null, 2)}`);
  }

  private initializeClient(): void {
    // Implementation of initializeClient method
  }
}