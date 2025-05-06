import { SpeechClient, protos } from '@google-cloud/speech';
import path from 'path';
import fs from 'fs';
import os from 'os';
import crypto from 'crypto';
import { configHelper } from './ConfigHelper';
import { ipcMain, WebContents } from 'electron';
import { PassThrough } from 'stream';

// Type definitions to improve code clarity
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

// Interface for word-level transcription results
export interface WordTimestamp {
  word: string;
  startTime: number;
  endTime: number;
}

// Interface for complete transcription results
export interface TranscriptionResult {
  text: string;
  words?: WordTimestamp[];
  confidenceScore?: number;
}

// Token bucket for rate limiting
interface TokenBucket {
  tokens: number;
  lastRefill: number;
  capacity: number;
  refillRate: number; // tokens per second
  getToken(): boolean;
}

// Fix issue 1: Add interface for word in the speech response
interface SpeechRecognitionWord {
  word?: string;
  startTime?: any;
  endTime?: any;
}

// Fix issue 2: Add interface for speech recognition result
interface SpeechRecognitionResult {
  alternatives?: Array<{
    transcript?: string;
    confidence?: number;
  }>;
}

/**
 * GoogleSpeechService provides integration with Google Cloud Speech-to-Text API
 * using gRPC for efficient streaming and recognition capabilities.
 */
export class GoogleSpeechService {
  private client: SpeechClient | null = null;
  private language: string;
  private apiKey: string | null = null;
  private credentialsPath: string | null = null;
  private streamingRecognizeStream: any = null;
  private isStreaming: boolean = false;
  private audioBuffer: Buffer[] = [];
  private onTranscriptCallback: ((text: string, isFinal: boolean) => void) | null = null;
  private audioDataListenerRegistered: boolean = false;
  private chunkCounter: number = 0;
  private streamReadyForData: boolean = false;
  private audioInputStream: PassThrough | null = null;
  private targetWebContents: WebContents | null = null;

  // Rate limiting implementation
  private tokenBucket: TokenBucket = {
    tokens: 100,
    lastRefill: Date.now(),
    capacity: 100,
    refillRate: 1, // tokens per second
    
    getToken(): boolean {
      const now = Date.now();
      const elapsed = (now - this.lastRefill) / 1000;
      this.lastRefill = now;
      
      this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillRate);
      
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return true;
      }
      return false;
    }
  };

  /**
   * Creates a new GoogleSpeechService instance
   * @param apiKeyOrCredentials API key or service account credentials JSON string
   * @param language Default language code for speech recognition
   */
  constructor(apiKeyOrCredentials?: string, language: string = 'en-US') {
    this.language = language;
    this.streamReadyForData = false;
    this.audioInputStream = new PassThrough();
    
    // Attempt to initialize with provided credentials
    if (apiKeyOrCredentials) {
      this.initializeClient(apiKeyOrCredentials);
    } else {
      // Look for credentials from ConfigHelper, then environment variables
      this.loadCredentialsFromConfig();
    }
    
    // Register IPC listener for audio data
    this.registerAudioDataListener();
  }

  /**
   * Loads credentials from ConfigHelper
   */
  private loadCredentialsFromConfig(): void {
    try {
      // First try to load service account credentials
      if (configHelper.hasServiceAccountCredentials()) {
        const serviceAccountJson = configHelper.loadServiceAccountKey();
        if (serviceAccountJson) {
          this.initializeClient(serviceAccountJson);
          return;
        }
      }
      
      // Fall back to API key if available
      const apiKey = configHelper.getGoogleSpeechApiKey();
      if (apiKey && apiKey.trim() !== '') {
        this.initializeClient(apiKey);
        return;
      }
      
      // Finally, try environment variables
      this.tryEnvironmentCredentials();
    } catch (error) {
      console.error('Failed to load credentials from config:', error);
      this.tryEnvironmentCredentials();
    }
  }

  /**
   * Initializes the speech client based on the provided credentials
   * @param apiKeyOrCredentials API key or service account JSON
   */
  private initializeClient(apiKeyOrCredentials: string): void {
    try {
      // Check if it looks like a service account JSON
      if (apiKeyOrCredentials.includes('"type":"service_account"') || 
          apiKeyOrCredentials.includes('"private_key"')) {
        // It's a service account JSON string
        const credentials = JSON.parse(apiKeyOrCredentials);
        this.client = new SpeechClient({ credentials });
        console.log('Initialized Google Speech client with service account credentials');
      } else if (apiKeyOrCredentials.includes('.json')) {
        // It's a path to a credentials file
        this.credentialsPath = apiKeyOrCredentials;
        this.client = new SpeechClient({ keyFilename: apiKeyOrCredentials });
        console.log(`Initialized Google Speech client with credentials file: ${apiKeyOrCredentials}`);
      } else {
        // Assume it's an API key
        this.apiKey = apiKeyOrCredentials;
        this.client = new SpeechClient({ key: apiKeyOrCredentials });
        console.log('Initialized Google Speech client with API key');
      }
    } catch (error) {
      console.error('Failed to initialize Google Speech client:', error);
      this.client = null;
    }
  }

  /**
   * Attempts to initialize client from environment variables or application default credentials
   */
  private tryEnvironmentCredentials(): void {
    try {
      // Try environment variable GOOGLE_APPLICATION_CREDENTIALS
      if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        this.credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
        this.client = new SpeechClient({ keyFilename: this.credentialsPath });
        console.log(`Initialized Google Speech client with GOOGLE_APPLICATION_CREDENTIALS`);
        return;
      }
      
      // Try GOOGLE_API_KEY environment variable
      if (process.env.GOOGLE_API_KEY) {
        this.apiKey = process.env.GOOGLE_API_KEY;
        this.client = new SpeechClient({ key: this.apiKey });
        console.log('Initialized Google Speech client with GOOGLE_API_KEY');
        return;
      }
      
      // Try Application Default Credentials (ADC)
      this.client = new SpeechClient();
      console.log('Initialized Google Speech client with Application Default Credentials');
    } catch (error) {
      console.error('Failed to initialize Google Speech client from environment:', error);
      this.client = null;
    }
  }

  /**
   * Registers the IPC listener for incoming audio data chunks from the renderer.
   * Ensures the listener is only registered once.
   */
  private registerAudioDataListener(): void {
    if (this.audioDataListenerRegistered) {
      return; // Already registered
    }

    ipcMain.on('speech:audio-data', (event, audioData) => {
      console.log('---> GSS: Received IPC speech:audio-data'); // <-- ADD LOG
      if (!this.isStreaming || !this.streamingRecognizeStream) {
        // Don't process if not actively streaming
        // console.warn("GSS: Received audio data while not streaming."); // DEBUG
        return;
      }
      // console.log("---> GSS: Received speech:audio-data IPC"); // DEBUG - Can be very noisy
      
      // Convert the incoming data (assuming Int16Array buffer-like) to Buffer
      // The data sent from AudioCaptureHelper is an Int16Array.
      // We need to ensure it's treated correctly here. ipcMain usually passes
      // ArrayBuffers or Buffers directly if they are sent.
      let audioBuffer: Buffer;
      if (Buffer.isBuffer(audioData)) {
        audioBuffer = audioData;
      } else if (audioData instanceof ArrayBuffer) {
        audioBuffer = Buffer.from(audioData);
      } else if (audioData instanceof Int16Array) {
         // If it's somehow still an Int16Array, convert its underlying ArrayBuffer
         audioBuffer = Buffer.from(audioData.buffer, audioData.byteOffset, audioData.byteLength);
      } else {
         console.warn('Received unexpected audio data format:', typeof audioData);
         return; // Cannot process
      }

      // ---> MODIFIED: Convert Float32Array (from ArrayBuffer) to LINEAR16
      let pcmBuffer: Buffer | null = null;
      if (audioBuffer) { // audioBuffer here is actually the ArrayBuffer/Buffer representation
        try {
          // Assuming the ArrayBuffer contains Float32 data
          // Sample rate from VAD library is usually 16000, but confirm if different
          const float32Array = new Float32Array(audioBuffer.buffer, audioBuffer.byteOffset, audioBuffer.byteLength / Float32Array.BYTES_PER_ELEMENT);
          pcmBuffer = this.convertFloat32ToLinear16(float32Array, 16000, 16000);
        } catch(conversionError) {
           console.error("Error converting audio data to LINEAR16:", conversionError);
           pcmBuffer = null; // Ensure it's null on error
        }
      }
      
      // Write the *converted* buffer to the PassThrough stream
      if (this.audioInputStream && pcmBuffer) {
        console.log(`---> GSS Listener: Writing CONVERTED audio buffer (Size: ${pcmBuffer.length}) to input stream`); // <-- ADD/UNCOMMENT LOG
        this.audioInputStream.write(pcmBuffer);
      } else if (!pcmBuffer) {
         console.warn("GSS Listener: PCM Buffer is null after conversion attempt, skipping write.");
      } else {
         console.warn("GSS Listener: audioInputStream is null, cannot process audio data.");
      }
    });

    this.audioDataListenerRegistered = true;
    console.log("Registered 'speech:audio-data' IPC listener.");
  }

  /**
   * Update the API key
   * @param apiKey The new API key to use
   */
  public setApiKey(apiKey: string): void {
    this.apiKey = apiKey;
    this.initializeClient(apiKey);
  }
  
  /**
   * Tests if the current API key or credentials are valid
   * @returns Promise resolving to true if credentials are valid
   */
  public async testApiKey(): Promise<boolean> {
    try {
      if (!this.client) {
        console.error('Speech client not initialized');
        return false;
      }
      
      // Make a minimal recognition request to test credentials
      const request = {
        config: {
          encoding: 'LINEAR16' as const,
          sampleRateHertz: 16000,
          languageCode: this.language,
        },
        audio: {
          content: Buffer.from([0, 0, 0, 0]).toString('base64'),
        },
      };
    
      // We expect this to fail with an "empty audio" error, but that means auth worked
      await this.client.recognize(request);
      return true;
    } catch (error: any) {
      // Check if it's an authentication error (usually 401/403) or expected empty audio error
      if (error.code === 7 || error.message?.includes('empty audio')) {
        // This is actually good - it means our credentials worked but the audio was invalid
        return true;
      }
      
      if (error.code === 16 || error.code === 'UNAUTHENTICATED' || 
          error.message?.includes('API key')) {
        console.error('API key validation failed:', error.message);
          return false;
        }
      
      console.error('Unexpected error testing API key:', error);
      return false;
    }
  }

  /**
   * Transcribes audio data
   * @param audioData Audio buffer to transcribe
   * @param mimeType MIME type of the audio (default: 'audio/wav')
   * @returns Promise resolving to transcription result
   */
  public async transcribeAudio(
    audioData: Buffer | Uint8Array, 
    mimeType: string = 'audio/wav'
  ): Promise<TranscriptionResult | string> {
    // Add detailed credential debugging
    console.log('Transcription request received. Credential state:');
    console.log('- Client initialized:', !!this.client);
    console.log('- API Key present:', !!this.apiKey);
    console.log('- Credentials path:', this.credentialsPath || 'none');
    console.log('- Service account in use:', this.client && !this.apiKey && (!!this.credentialsPath || process.env.GOOGLE_APPLICATION_CREDENTIALS));
    console.log('- Environment variables:', {
      GOOGLE_APPLICATION_CREDENTIALS: process.env.GOOGLE_APPLICATION_CREDENTIALS || 'not set',
      GOOGLE_API_KEY: process.env.GOOGLE_API_KEY ? 'set (hidden)' : 'not set'
    });
    
    if (!this.client) {
      console.error('Speech client not initialized. Attempting to initialize from config...');
      this.loadCredentialsFromConfig();
      
      if (!this.client) {
        throw new Error('Speech client not initialized. Please check your credentials.');
      }
    }
    
    // Rate limiting check
    if (!this.tokenBucket.getToken()) {
      throw new Error('Rate limit exceeded. Please try again later.');
    }

    try {
      const encoding = this.determineEncoding(mimeType);
      const sampleRate = this.determineSampleRate(mimeType);
      
      const request = {
        config: {
          encoding,
          sampleRateHertz: sampleRate,
          languageCode: this.language,
          enableWordTimeOffsets: true,
          enableAutomaticPunctuation: true,
          useEnhanced: true,
          model: 'video', // Better for general transcription including interviews
        },
        audio: {
          content: Buffer.from(audioData).toString('base64'),
        },
      };
      
      const [response] = await this.recognizeWithRetry(request);
      
      // Process results into our standardized format
      if (response.results && response.results.length > 0) {
        const result = response.results[0];
        const alternative = result.alternatives && result.alternatives[0];
        
        if (alternative) {
          // Check if word timestamps are available
          if (alternative.words && alternative.words.length > 0) {
            // Return detailed result with word timestamps
          return { 
              text: alternative.transcript || '',
              words: alternative.words.map((word: SpeechRecognitionWord) => ({
                word: word.word || '',
                startTime: this.timestampToSeconds(word.startTime),
                endTime: this.timestampToSeconds(word.endTime)
              })),
              confidenceScore: alternative.confidence || 0
          };
        } else {
            // Return just the text with confidence
            return {
              text: alternative.transcript || '',
              confidenceScore: alternative.confidence || 0
            };
          }
        }
      }
      
      // Combine all results if multiple were returned
      const text = response.results
        ?.map((result: SpeechRecognitionResult) => result.alternatives?.[0]?.transcript || '')
        .join(' ') || '';
        
      return { text };
    } catch (error: any) {
      console.error('Transcription error:', error);
      
      // Provide useful error messages based on common error codes
      if (error.code === 'RESOURCE_EXHAUSTED') {
        throw new Error('Google Speech API quota exceeded. Please try again later.');
      } else if (error.code === 'INVALID_ARGUMENT') {
        throw new Error(`Audio format error: ${error.message}`);
      } else if (error.code === 'PERMISSION_DENIED') {
        throw new Error('Authentication error. Please check your API key or credentials.');
      }
      
      throw error;
    }
  }

  /**
   * Starts streaming transcription mode
   * @param webContents The Electron WebContents object to send updates to
   * @param callback Function to call with transcript updates (kept for potential internal use or logging)
   * @returns boolean indicating if streaming started successfully
   */
  public startStreamingTranscription(
    webContents: WebContents,
    callback?: (text: string, isFinal: boolean) => void
  ): boolean {
    console.log("---> GSS: startStreamingTranscription called"); // DEBUG
    if (!this.client || !this.audioInputStream) { // Check for audioInputStream too
      console.error('Speech client or audioInputStream not initialized');
      return false;
    }
    
    if (this.isStreaming) {
      console.log('Streaming already active, stopping previous stream');
      this.stopStreamingTranscription(); // Stop first to ensure clean state
    }

    // this.streamReadyForData = false; // <-- REMOVE: No longer needed
    this.chunkCounter = 0; // Reset chunk counter
    this.onTranscriptCallback = callback || null;
    this.targetWebContents = webContents;

    try {
      console.log('---> GSS: Initializing Google StreamingRecognize stream object...');
      
      // ----> ADD LOGGING HERE <----
      console.log(`---> GSS: Value of this.language before creating request: ${this.language}`); 

      // Define the streaming configuration - THIS IS WHERE THE FIX IS NEEDED
      const streamingRequest = {
        config: {
          encoding: 'LINEAR16' as const,
          sampleRateHertz: 16000, // Or determine dynamically if needed
          languageCode: this.language, // <-- CORRECT: Use the class property
          enableWordTimeOffsets: true,
          enableAutomaticPunctuation: true,
          useEnhanced: true,
          model: 'video', // Or specify another appropriate model
        },
        interimResults: true, // Get intermediate results
      };

      console.log(`---> GSS: Using stream config: ${JSON.stringify(streamingRequest, null, 2)}`);

      // Create a new stream
      this.streamingRecognizeStream = this.client.streamingRecognize(streamingRequest);
      
      console.log("---> GSS: Attaching listeners and piping audioInputStream..."); // DEBUG
      // ---> MODIFIED: Attach listeners directly
      this.streamingRecognizeStream
        .on('data', (data: any) => {
            console.log('---> GSS: Received .on(\'data\') from Google Stream:', JSON.stringify(data)); // <-- ADD LOG
            // Existing data handling logic...
            if (data.results && data.results[0]) {
               const transcript = data.results[0].alternatives[0]?.transcript || '';
               const isFinal = data.results[0].isFinal || false;
               if (webContents && !webContents.isDestroyed()) {
                 this.sendTranscriptionUpdate(transcript, isFinal);
               }
               if (this.onTranscriptCallback) {
                 this.onTranscriptCallback(transcript, isFinal);
               }
            }
          })
          .on('error', (error: any) => {
             console.error('Streaming recognition error:', error); // Keep original error log
             console.log(`---> GSS: Stream error event (code: ${error.code})`); // DEBUG
             // Existing error handling logic...
             if (webContents && !webContents.isDestroyed()) {
                this.sendError(error.message, error.code);
             }
             // Attempting to restart might cause loops, better to report error and stop.
             this.stopStreamingTranscription();
          })
          .on('end', () => {
             console.log('---> GSS: Stream end event'); // DEBUG
             console.log('Streaming recognition ended');
             // Don't set isStreaming false here, let stopStreamingTranscription handle it
             // If the stream ends naturally, we should probably reflect that state
             if (this.isStreaming) {
                this.stopStreamingTranscription(); // Ensure cleanup if ended externally
             }
          });
      
      // ---> MODIFIED: Pipe the input stream to the Google stream
      this.audioInputStream.pipe(this.streamingRecognizeStream);

      this.isStreaming = true; // Mark as streaming now that pipe is set up
      console.log('---> GSS: Streaming transcription initiated and streams piped.'); // DEBUG
      
      // ---> REMOVE: Delayed listener attachment logic
      /*
      setTimeout(() => {
        if (!this.streamingRecognizeStream || !this.isStreaming) {
           console.log("---> GSS: Stream was stopped before listeners could be attached. Aborting attachment.");
           return; // Stream might have been stopped during the delay
        }
        console.log("---> GSS: Attaching .on('data'), .on('error'), .on('end') listeners...");
        this.streamingRecognizeStream
          .on('data', ...)
          .on('error', ...)
          .on('end', ...);
          
         console.log("---> GSS: Listeners attached. Setting streamReadyForData = true."); 
         // this.streamReadyForData = true; // Now ready for audio data // <-- REMOVE
      }, 100); // 100ms delay
      */
      
      // console.log('---> GSS: Streaming transcription initiated (listeners pending attachment).'); // <-- REMOVE old log
      return true;
    } catch (error) {
      console.error('Failed to start streaming transcription:', error);
      this.stopStreamingTranscription(); // Ensure cleanup on error
      return false;
    }
  }

  /**
   * Stops streaming transcription
   */
  public stopStreamingTranscription(): void {
    console.log("---> GSS: stopStreamingTranscription called"); // DEBUG
    // this.streamReadyForData = false; // <-- REMOVE: No longer needed
    
    // ---> NEW: Unpipe the input stream
    if (this.audioInputStream && this.streamingRecognizeStream) {
      console.log("---> GSS: Unpiping audio input stream...");
      this.audioInputStream.unpipe(this.streamingRecognizeStream);
    }

    if (this.streamingRecognizeStream) {
      try {
        console.log("---> GSS: Ending Google streaming stream..."); // DEBUG
        this.streamingRecognizeStream.end();
      } catch (error: any) { // Added type annotation
         // Ignore errors like "Cannot call end after a stream was destroyed"
         if (error.code !== 'ERR_STREAM_DESTROYED') {
           console.error('Error ending streaming transcription stream:', error);
         }
      } finally {
         this.streamingRecognizeStream = null;
      }
    }
    // Check if already false to avoid redundant logs/state changes
    if (this.isStreaming) { 
      this.isStreaming = false;
      this.onTranscriptCallback = null;
      this.chunkCounter = 0; // Reset counter
      console.log("GSS: Streaming stopped and state reset.");
    } else {
       console.log("GSS: stopStreamingTranscription called, but already stopped.");
    }
    
    // ---> NEW: Clean up and recreate the input stream for next time?
    if (this.audioInputStream) {
      this.audioInputStream.removeAllListeners(); // Remove any potential lingering listeners
      this.audioInputStream.destroy(); // Destroy the old stream
    }
    this.audioInputStream = new PassThrough(); // Create a fresh one
    console.log("---> GSS: Recreated audio input stream.");
  }

  /**
   * Sends an audio chunk to the streaming recognition API
   * @param audioChunk Audio buffer chunk to send
   */
  public sendAudioChunk(audioChunk: Buffer): void {
    this.chunkCounter++; // Increment chunk counter
    // console.log(`---> GSS: sendAudioChunk called (Size: ${audioChunk.length})`); // DEBUG - Very noisy
    
    // ---> MOVED & REFINED CHECK: Ensure stream object exists, is conceptually streaming, AND is ready for data
    if (!this.streamingRecognizeStream || !this.isStreaming || !this.streamReadyForData) {
      if (!this.streamReadyForData && this.isStreaming) {
         console.warn(`---> GSS: Skipping audio chunk #${this.chunkCounter} because stream is not ready for data yet.`);
      } else {
         // console.warn('Attempted to send audio chunk while not streaming or stream object missing.');
      }
      // Do not reset chunk counter here, just skip sending
      return; 
    }

    // Apply rate limiting
    if (!this.tokenBucket.getToken()) {
       console.warn('Rate limit exceeded. Skipping audio chunk.');
       this.chunkCounter = 0; // Reset counter
       return;
    }
    
    // ---> REMOVED Redundant Conversion Logic
    /*
    let audioBuffer: Buffer;
    if (Buffer.isBuffer(audioChunk)) {
      audioBuffer = audioChunk;
    } else if (audioChunk instanceof ArrayBuffer) { 
      audioBuffer = Buffer.from(audioChunk);
    } else if (audioChunk instanceof Int16Array) {
       audioBuffer = Buffer.from(audioChunk.buffer, audioChunk.byteOffset, audioChunk.byteLength);
    } else {
       console.warn('Received unexpected audio data format:', typeof audioChunk);
       return; // Cannot process
    }
    */
    // audioChunk is already guaranteed to be a Buffer here by the caller (handleAudioData)
    const bufferToSend = audioChunk; 

    try {
      // ---> NEW: Log first few chunks
      if (this.chunkCounter <= 5) {
        console.log(`---> GSS: Writing audio chunk #${this.chunkCounter}. Size: ${bufferToSend.length}, Type: ${bufferToSend.constructor.name}`);
        if (bufferToSend.length === 0) {
          console.warn(`---> GSS: Attempting to send EMPTY audio chunk #${this.chunkCounter}!`);
        }
      }
      // ---> END: Log first few chunks

      // console.log(`---> GSS: Writing audio chunk to stream...`); // DEBUG - Very noisy
      this.streamingRecognizeStream.write({ audioContent: bufferToSend });
    } catch (error) {
      console.error('Error writing audio chunk to stream:', error);
      // Consider stopping the stream or notifying the user on write errors
      this.stopStreamingTranscription();
      // Optionally send an error back to the renderer
    }
  }

  /**
   * Clears the audio buffer
   */
  public clearAudioBuffer(): void {
    this.audioBuffer = [];
  }

  /**
   * Converts Float32Array audio data to LINEAR16 format
   * @param float32Audio Float32Array containing audio data
   * @param sourceSampleRate Original sample rate of the audio
   * @param targetSampleRate Target sample rate (default: 16000)
   * @returns Buffer containing LINEAR16 audio data
   */
  public convertFloat32ToLinear16(
    float32Audio: Float32Array,
    sourceSampleRate: number,
    targetSampleRate: number = 16000
  ): Buffer | null {
    try {
      // Resample audio if necessary
      let resampledAudio = float32Audio;
      if (sourceSampleRate !== targetSampleRate) {
        resampledAudio = this.resampleAudio(float32Audio, sourceSampleRate, targetSampleRate);
      }
      
      // Convert to LINEAR16 (16-bit signed PCM)
      const pcmBuffer = Buffer.alloc(resampledAudio.length * 2);
      for (let i = 0; i < resampledAudio.length; i++) {
        const sample = Math.max(-1, Math.min(1, resampledAudio[i]));
        const value = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
        pcmBuffer.writeInt16LE(Math.floor(value), i * 2);
      }
      
      return pcmBuffer;
    } catch (error) {
      console.error('Error converting audio format:', error);
      return null;
    }
  }

  /**
   * Resamples audio to a different sample rate
   * Note: This is a simple implementation; for production use consider using a proper resampling library
   * @param audio Audio data as Float32Array
   * @param fromSampleRate Source sample rate
   * @param toSampleRate Target sample rate
   * @returns Resampled audio as Float32Array
   */
  private resampleAudio(
    audio: Float32Array,
    fromSampleRate: number,
    toSampleRate: number
  ): Float32Array {
    if (fromSampleRate === toSampleRate) {
      return audio;
    }
    
    const ratio = fromSampleRate / toSampleRate;
    const newLength = Math.round(audio.length / ratio);
    const result = new Float32Array(newLength);
    
    for (let i = 0; i < newLength; i++) {
      // Simple linear interpolation
      const position = i * ratio;
      const index = Math.floor(position);
      const fraction = position - index;
      
      if (index >= audio.length - 1) {
        result[i] = audio[audio.length - 1];
      } else {
        result[i] = audio[index] * (1 - fraction) + audio[index + 1] * fraction;
      }
    }
    
    return result;
  }

  /**
   * Performs recognition with retry logic for better reliability
   * @param request Recognition request
   * @param maxRetries Maximum number of retry attempts
   * @returns Promise with recognition response
   */
  private async recognizeWithRetry(request: any, maxRetries = 3): Promise<any> {
    if (!this.client) {
      throw new Error('Speech client not initialized');
    }
    
    let retries = 0;
    while (retries < maxRetries) {
      try {
        return await this.client.recognize(request);
      } catch (error: any) {
        // Don't retry auth errors
        if (error.code === 16 || error.code === 'UNAUTHENTICATED') {
          throw error;
    }

        // Retry certain transient errors
        if ((error.code === 'RESOURCE_EXHAUSTED' || 
             error.code === 'UNAVAILABLE' || 
             error.code === 'DEADLINE_EXCEEDED') && 
            retries < maxRetries - 1) {
          
          // Exponential backoff with jitter
          const delay = (2 ** retries * 1000) + (Math.random() * 1000);
          console.log(`Retrying speech recognition after ${delay}ms (attempt ${retries + 1}/${maxRetries})`);
          await new Promise(resolve => setTimeout(resolve, delay));
          retries++;
          continue;
        }
        throw error;
      }
    }
    throw new Error('Max retries exceeded');
  }

  /**
   * Determines the appropriate encoding based on MIME type
   * @param mimeType MIME type of the audio
   * @returns Encoding value for Google Speech API
   */
  private determineEncoding(mimeType: string): any {
    switch (mimeType.toLowerCase()) {
      case 'audio/wav':
      case 'audio/wave':
      case 'audio/x-wav':
      case 'audio/pcm':
        return 'LINEAR16';
      case 'audio/ogg':
      case 'audio/ogg; codecs=opus':
        return 'OGG_OPUS';
      case 'audio/mpeg':
      case 'audio/mp3':
        return 'MP3';
      case 'audio/flac':
        return 'FLAC';
      case 'audio/webm':
      case 'audio/webm;codecs=opus':
        return 'WEBM_OPUS';
      default:
        console.warn(`Unknown MIME type: ${mimeType}, defaulting to LINEAR16`);
        return 'LINEAR16';
    }
  }

  /**
   * Determines the appropriate sample rate based on MIME type
   * @param mimeType MIME type of the audio
   * @returns Sample rate in Hz
   */
  private determineSampleRate(mimeType: string): number {
    // Most web audio is 44.1kHz or 48kHz, but Google prefers 16kHz
    // Ideally, the actual sample rate would be provided
    switch (mimeType.toLowerCase()) {
      case 'audio/webm':
      case 'audio/webm;codecs=opus':  
        return 48000;
      case 'audio/mp3':
      case 'audio/mpeg':
        return 44100;
      default:
        return 16000;
    }
    }

  /**
   * Converts a timestamp from the API to seconds
   * @param timestamp Timestamp from the API
   * @returns Time in seconds
   */
  private timestampToSeconds(timestamp: any): number {
    if (!timestamp) return 0;
    
    if (typeof timestamp === 'number') {
      return timestamp;
    }
    
    if (typeof timestamp === 'string') {
      // Try to parse "1.500s" format
      const match = timestamp.match(/^(\d+\.\d+)s$/);
      if (match) {
        return parseFloat(match[1]);
      }
      return 0;
    }
    
    // Handle google.protobuf.Duration objects
    if (timestamp.seconds !== undefined) {
      const seconds = parseInt(timestamp.seconds, 10) || 0;
      const nanos = parseInt(timestamp.nanos, 10) || 0;
      return seconds + (nanos / 1e9);
    }
    
    return 0;
  }

  /**
   * Generates a secure temporary file path for credential storage
   * @returns Path to temporary file
   */
  private getTempCredentialsPath(): string {
    const tempDir = path.join(os.tmpdir(), 'google-speech-credentials');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true, mode: 0o700 });
    }
    
    const filename = `credentials-${crypto.randomBytes(8).toString('hex')}.json`;
    return path.join(tempDir, filename);
  }

  /**
   * Sets service account credentials from JSON string
   * @param serviceAccountJson The service account JSON string
   * @param shouldStore Whether to store the credentials in ConfigHelper
   */
  public setServiceAccountCredentials(serviceAccountJson: string, shouldStore: boolean = true): void {
    try {
      if (shouldStore) {
        // Store credentials securely
        configHelper.storeServiceAccountKey(serviceAccountJson);
      }
      
      // Initialize client with credentials
      this.initializeClient(serviceAccountJson);
    } catch (error) {
      console.error('Failed to set service account credentials:', error);
      throw new Error('Failed to set service account credentials');
    }
  }

  /**
   * Sets service account credentials from a file path
   * @param filePath Path to the service account JSON file
   * @param shouldStore Whether to store the credentials in ConfigHelper
   */
  public async setServiceAccountCredentialsFromFile(filePath: string, shouldStore: boolean = true): Promise<void> {
    try {
      console.log(`Loading service account from file: ${filePath}`);
      // Read file
      const serviceAccountJson = fs.readFileSync(filePath, 'utf8');
      console.log(`Service account JSON loaded, length: ${serviceAccountJson.length}`);
      
      // Make sure it's valid JSON
      const parsed = JSON.parse(serviceAccountJson);
      console.log(`Service account parsed successfully. Contains required fields:`, {
        hasType: !!parsed.type,
        hasProjectId: !!parsed.project_id,
        hasPrivateKey: !!parsed.private_key,
        hasClientEmail: !!parsed.client_email
      });
      
      // Set environment variable to help Google libraries find the credentials
      if (shouldStore) {
        // Store credentials securely using ConfigHelper
        console.log(`Storing service account credentials via ConfigHelper`);
        configHelper.storeServiceAccountKey(serviceAccountJson);
        
        // For additional reliability, also set the environment variable
        process.env.GOOGLE_APPLICATION_CREDENTIALS = filePath;
        console.log(`Set GOOGLE_APPLICATION_CREDENTIALS to: ${filePath}`);
      }
      
      // Initialize client with credentials
      this.initializeClient(serviceAccountJson);
      console.log(`Client initialized with service account`);
    } catch (error: any) {
      console.error('Failed to load service account from file:', error);
      throw new Error(`Invalid service account file: ${error.message || 'Unknown error'}`);
    }
  }

  /**
   * Cleans up resources, like closing the gRPC stream if active
   */
  public cleanup(): void {
    console.log('Cleaning up GoogleSpeechService...');
    this.stopStreamingTranscription(); // Ensure stream is closed
    
    // Remove the specific listener we added
    ipcMain.removeListener('speech:audio-data', this.handleAudioData);
    this.audioDataListenerRegistered = false; // Reset flag

    this.client = null; // Allow client to be garbage collected
  }
  
  // Define the handler separately to allow removal
  private handleAudioData = (event: Electron.IpcMainEvent, audioData: any): void => {
     if (!this.isStreaming || !this.streamingRecognizeStream) {
       return;
     }

     let audioBuffer: Buffer;
     if (Buffer.isBuffer(audioData)) {
       audioBuffer = audioData;
     } else if (audioData instanceof ArrayBuffer) {
       audioBuffer = Buffer.from(audioData);
     } else if (audioData instanceof Int16Array) {
       audioBuffer = Buffer.from(audioData.buffer, audioData.byteOffset, audioData.byteLength);
     } else {
       console.warn('Received unexpected audio data format:', typeof audioData);
       return;
     }

     // ---> MODIFIED: Convert Float32Array (from ArrayBuffer) to LINEAR16
     let pcmBuffer: Buffer | null = null;
     if (audioBuffer) { // audioBuffer here is actually the ArrayBuffer/Buffer representation
       try {
         // Assuming the ArrayBuffer contains Float32 data
         // Sample rate from VAD library is usually 16000, but confirm if different
         const float32Array = new Float32Array(audioBuffer.buffer, audioBuffer.byteOffset, audioBuffer.byteLength / Float32Array.BYTES_PER_ELEMENT);
         pcmBuffer = this.convertFloat32ToLinear16(float32Array, 16000, 16000);
       } catch(conversionError) {
          console.error("Error converting audio data to LINEAR16:", conversionError);
          pcmBuffer = null; // Ensure it's null on error
       }
     }
     
     // Write the *converted* buffer to the PassThrough stream
     if (this.audioInputStream && pcmBuffer) {
       // console.log("---> GSS Handler: Writing CONVERTED audio buffer to input stream"); // DEBUG - Very noisy
       this.audioInputStream.write(pcmBuffer);
     } else if (!pcmBuffer) {
       console.warn("GSS Handler: PCM Buffer is null after conversion attempt, skipping write.");
     } else {
        console.warn("GSS Handler: audioInputStream is null, cannot process audio data.");
     }
   };

  private sendTranscriptionUpdate(transcript: string, isFinal: boolean): void {
    if (this.targetWebContents && !this.targetWebContents.isDestroyed()) {
      const data = { transcript, isFinal };
      console.log(`---> GSS: Sending speech:transcript-update to renderer: ${JSON.stringify(data)}`); // <-- ADD LOG
      this.targetWebContents.send('speech:transcript-update', data);
    } else {
      // console.warn('GSS: Target webContents not available or destroyed for sending transcript update.'); // DEBUG
    }
  }

  private sendError(message: string, code?: number): void {
    if (this.targetWebContents && !this.targetWebContents.isDestroyed()) {
      const errorData = { message, code: code ?? -1 }; // Use -1 if code is undefined
      console.log(`---> GSS: Sending speech:stream-error to renderer: ${JSON.stringify(errorData)}`); // <-- ADD LOG
      this.targetWebContents.send('speech:stream-error', errorData);
      // Optionally, stop streaming on error
      this.stopStreamingTranscription();
    } else {
      // console.warn('GSS: Target webContents not available or destroyed for sending error.'); // DEBUG
    }
  }
} 