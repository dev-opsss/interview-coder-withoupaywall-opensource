import { Buffer } from 'buffer';
import axios from 'axios';
import { safeLog, safeError } from '../../electron/main'; // Adjust path as needed

interface SpeechRecognitionResult {
  alternatives: {
  transcript: string;
    confidence: number;
  }[];
  isFinal: boolean;
}

export class GoogleSpeechService {
  private apiKey: string;
  private language: string;
  private audioChunks: Uint8Array[] = [];
  private totalBytesProcessed = 0;
  private streamingActive = false;
  private transcriptionCallback: ((text: string, isFinal: boolean) => void) | null = null;

  constructor(apiKey: string = '', language: string = 'en-US') {
    this.apiKey = apiKey;
    this.language = language;
  }

  /**
   * Set the API key for the service
   * @param apiKey Google Speech API key
   */
  public setApiKey(apiKey: string): void {
    this.apiKey = apiKey;
  }

  // Add audio chunk to the buffer
  public addAudioChunk(audioData: Uint8Array): void {
    this.audioChunks.push(audioData);
    this.totalBytesProcessed += audioData.length;
  }

  // Clear audio buffer
  public clearAudioBuffer(): void {
    this.audioChunks = [];
    this.totalBytesProcessed = 0;
  }
  
  // Test if the API key is valid
  public async testApiKey(): Promise<boolean> {
    try {
      console.log('Testing Google Speech API key validity');
      
      if (!this.apiKey || this.apiKey.trim() === '') {
        console.error('Cannot test API key: Key is empty');
        return false;
      }
      
      // Create a small audio buffer for testing
      const testBuffer = new Uint8Array(100).fill(0);
      const base64Audio = Buffer.from(testBuffer).toString('base64');

      console.log('Sending test request to Google Speech API');
      
      // Use a simpler configuration for the test
      const testRequestData = {
        config: {
          encoding: 'LINEAR16',
          sampleRateHertz: 16000,
          languageCode: 'en-US', // Hard-code en-US for testing
          model: 'command_and_search',
        },
        audio: {
          content: base64Audio,
        },
      };
    
      // Use a shorter timeout for testing
      const response = await axios.post(
        `https://speech.googleapis.com/v1/speech:recognize?key=${this.apiKey}`,
        testRequestData,
        { timeout: 5000 }
      );

      console.log(`Google Speech API test response status: ${response.status}`);
      
      // Even if we don't get results (since our test audio is just zeros),
      // a 200 response means the API key is valid
      return response.status === 200;
    } catch (error: any) {
      console.error('Error testing Google Speech API key:', error.message);
      
      // Log additional details if available
      if (error.response) {
        console.error('Response status:', error.response.status);
        console.error('Response data:', JSON.stringify(error.response.data || {}).substring(0, 500));
    
        // Check if error is related to invalid API key
        if (error.response.status === 400 && 
            (error.response.data?.error?.status === 'INVALID_ARGUMENT' || 
             error.response.data?.error?.message?.includes('Invalid audio'))) {
          console.log('API key might be valid but audio format is incorrect - this is expected in testing');
          return true; // If we get an error about the audio format, the API key is likely valid
        }
        
        if (error.response.status === 403) {
          console.error('API key is likely invalid or doesn\'t have proper permissions');
          return false;
        }
      }
      
      // Network or other errors mean we can't validate
      if (error.code === 'ECONNABORTED') {
        console.error('Request timed out - network issues or API not responding');
      }
      
      return false;
    }
  }

  // Process partial audio for real-time feedback
  public async transcribePartialAudio(): Promise<string> {
    if (this.audioChunks.length === 0) {
      return '';
    }

    try {
      // Concat all chunks into a single audio buffer
      const audioBuffer = this.concatAudioChunks();
      const base64Audio = Buffer.from(audioBuffer).toString('base64');

      const response = await axios.post(
        `https://speech.googleapis.com/v1/speech:recognize?key=${this.apiKey}`,
        {
        config: {
            encoding: 'LINEAR16',
            sampleRateHertz: 16000,
            languageCode: this.language,
            model: 'command_and_search', // Use a faster model for real-time
          enableAutomaticPunctuation: true,
        },
        audio: {
            content: base64Audio,
          },
        }
      );

      if (
        response.data &&
        response.data.results &&
        response.data.results.length > 0
      ) {
        return response.data.results[0].alternatives[0].transcript;
      }

      return '';
    } catch (error) {
      console.error('Error transcribing partial audio:', error);
      return '';
    }
  }

  // Process complete audio for final transcription
  public async transcribeAudio(mimeType: string = 'audio/mpeg'): Promise<string | { text: string, words: { word: string, startTime: number, endTime: number }[] }> {
    if (this.audioChunks.length === 0) {
      console.error('No audio chunks available for transcription');
      return '';
    }

    try {
      const audioBuffer = this.concatAudioChunks();
      console.log(`Transcribing audio with ${audioBuffer.length} bytes, MIME type: ${mimeType}`);
      
      // For larger audio files, we should split and process in chunks
      if (audioBuffer.length > 1_000_000) { // ~ 1MB
        console.log('Large audio file detected, processing in chunks');
        return this.processLargeAudioInChunks(audioBuffer, mimeType);
      }
      
      if (!this.apiKey || this.apiKey.trim() === '') {
        console.error('Google Speech API key is missing or empty');
        throw new Error('Google Speech API key not configured');
      }

      const base64Audio = Buffer.from(audioBuffer).toString('base64');
      console.log(`Audio converted to base64, sending to Google Speech API (length: ${base64Audio.length})`);
      
      // Log the first few bytes of the audio for debugging
      const previewBytes = Array.from(audioBuffer.slice(0, 20)).map(b => b.toString(16).padStart(2, '0')).join(' ');
      console.log(`Audio data preview (first 20 bytes): ${previewBytes}`);
      
      // --- Determine encoding and sample rate based on MIME type --- 
      let encoding: string;
      let sampleRateHertz: number;
      
      if (mimeType.includes('webm') && mimeType.includes('opus')) {
        encoding = 'WEBM_OPUS';
        sampleRateHertz = 48000; // Opus typically uses 48kHz
        console.log(`Detected WEBM_OPUS format, using encoding: ${encoding}, sampleRate: ${sampleRateHertz}Hz`);
      } else if (mimeType.includes('wav')) {
        encoding = 'LINEAR16'; // Assuming WAV is LINEAR16
        // Ideally, read sample rate from WAV header, but default to 16000 for now
        sampleRateHertz = 16000; 
        console.log(`Detected WAV format, assuming encoding: ${encoding}, sampleRate: ${sampleRateHertz}Hz`);
      } else {
        // Default to LINEAR16 for other types (like audio/mpeg, etc.)
        // This might still fail if the format is actually different
        encoding = 'LINEAR16';
        sampleRateHertz = 16000;
        console.warn(`Unknown or possibly unsupported format ${mimeType}, defaulting to encoding: ${encoding}, sampleRate: ${sampleRateHertz}Hz`);
      }
      // --- End encoding/rate determination ---
      
      // Create a request with detailed configuration
      const requestData = {
        config: {
          encoding: encoding, // Use determined encoding
          sampleRateHertz: sampleRateHertz, // Use determined sample rate
          languageCode: this.language,
          model: 'latest_long', // Use more accurate model for final transcription
          enableAutomaticPunctuation: true,
          audioChannelCount: 1, // Mono audio
          enableWordTimeOffsets: true, // Enable word-level timestamps
        },
        audio: {
          content: base64Audio,
        },
      };

      console.log(`Sending request to Google Speech API with language: ${this.language}`);
      
      try {
        const response = await axios.post(
          `https://speech.googleapis.com/v1/speech:recognize?key=${this.apiKey}`,
          requestData
        );
  
        console.log(`Google Speech API response status: ${response.status}`);
        
        if (response.status !== 200) {
          console.error('Non-200 response from Google Speech API:', response.status, response.statusText);
          throw new Error(`API error: ${response.status} ${response.statusText}`);
        }
  
        console.log('Google Speech API response data:', JSON.stringify(response.data || {}).substring(0, 200) + '...');
        
        // Check for missing or empty results
        if (!response.data || !response.data.results || response.data.results.length === 0) {
          console.warn('Google Speech API returned no results. Audio might be silent or unclear.');
          return '';
        }
  
        // Check if the first result has alternatives
        if (!response.data.results[0].alternatives || response.data.results[0].alternatives.length === 0) {
          console.warn('Google Speech API returned a result but no transcript alternatives.');
          return '';
        }
  
        // Combine all transcriptions for the text
        const transcription = response.data.results
          .map((result: any) => {
            if (result.alternatives && result.alternatives[0] && result.alternatives[0].transcript) {
              return result.alternatives[0].transcript;
            }
            return '';
          })
          .join(' ');
        
        console.log(`Transcription successful: "${transcription.substring(0, 100)}${transcription.length > 100 ? '...' : ''}"`);
        
        // Extract word information with timestamps if available
        const words: { word: string, startTime: number, endTime: number }[] = [];
        let hasWordTimings = false;
        
        response.data.results.forEach((result: any) => {
          if (result.alternatives && result.alternatives[0] && result.alternatives[0].words && result.alternatives[0].words.length > 0) {
            hasWordTimings = true;
            result.alternatives[0].words.forEach((wordInfo: any) => {
              // Convert "1.500s" format to milliseconds, handling potential format issues
              try {
                const startSecs = parseFloat(wordInfo.startTime?.replace('s', '') || '0');
                const endSecs = parseFloat(wordInfo.endTime?.replace('s', '') || '0');
                
                words.push({
                  word: wordInfo.word || '',
                  startTime: startSecs * 1000, // convert to ms
                  endTime: endSecs * 1000      // convert to ms
                });
              } catch (e) {
                console.warn('Error parsing word timing:', e);
              }
            });
          }
        });
        
        if (hasWordTimings) {
          console.log(`Extracted ${words.length} words with timestamps`);
          // Return both the text and the word timestamps
          return { 
            text: transcription,
            words
          };
        } else {
          // Return just the text if no word timings
          return transcription;
        }
      } catch (error: any) {
        // Handle network or API errors
        console.error('Error in Google Speech API request:', error.message);
        
        // Check for API-specific errors
        if (error.response) {
          console.error('Google API returned error:', error.response.status);
          console.error('Response data:', JSON.stringify(error.response.data || {}).substring(0, 500));
          
          if (error.response.status === 403) {
            throw new Error('Google Speech API error - check API key in settings');
          } else if (error.response.data && error.response.data.error) {
            throw new Error(`Google Speech API error: ${error.response.data.error.message || 'Unknown API error'}`);
          }
        }
        
        throw error; // Re-throw to let caller handle it
      }
    } catch (error: any) {
      console.error('Error transcribing audio:', error.message);
      // Provide a more helpful error message 
      if (error.message.includes('Network Error')) {
        throw new Error('Network error connecting to Google Speech API - check your internet connection');
      }
      throw error; // Re-throw to let the caller handle it
    }
  }

  // Handle large audio files by splitting into chunks
  private async processLargeAudioInChunks(audioBuffer: Uint8Array, mimeType: string): Promise<string> {
    const chunkSize = 750_000; // ~750KB per chunk (safe limit for API)
    const chunks: Uint8Array[] = [];

    // Split the buffer into chunks
    for (let i = 0; i < audioBuffer.length; i += chunkSize) {
      const chunk = audioBuffer.slice(i, i + chunkSize);
      chunks.push(chunk);
    }

    // Determine encoding and sample rate once
    let encoding: string;
    let sampleRateHertz: number;
    if (mimeType.includes('webm') && mimeType.includes('opus')) {
      encoding = 'WEBM_OPUS';
      sampleRateHertz = 48000;
    } else {
      encoding = 'LINEAR16'; // Default assumption
      sampleRateHertz = 16000;
    }
    console.log(`Processing large file (${chunks.length} chunks) with encoding: ${encoding}, sampleRate: ${sampleRateHertz}Hz`);

    // Process each chunk and collect results
    const transcriptions: string[] = [];
      
    for (let i = 0; i < chunks.length; i++) {
      try {
        const base64Audio = Buffer.from(chunks[i]).toString('base64');
        
        const response = await axios.post(
          `https://speech.googleapis.com/v1/speech:recognize?key=${this.apiKey}`,
          {
            config: {
              encoding: encoding, // Use determined encoding
              sampleRateHertz: sampleRateHertz, // Use determined sample rate
              languageCode: this.language,
              model: 'latest_long',
              enableAutomaticPunctuation: true,
            },
            audio: {
              content: base64Audio,
            },
          }
        );

        if (
          response.data &&
          response.data.results &&
          response.data.results.length > 0
        ) {
          const text = response.data.results
            .map((result: any) => result.alternatives[0].transcript)
            .join(' ');
          
          transcriptions.push(text);
        }
      } catch (error) {
        console.error(`Error processing audio chunk ${i}:`, error);
      }
    }

    return transcriptions.join(' ');
  }
  
  // Utility to combine all audio chunks
  private concatAudioChunks(): Uint8Array {
    // Calculate total length
    let totalLength = 0;
    for (const chunk of this.audioChunks) {
      totalLength += chunk.length;
    }

    // Create a new buffer with the total length
    const result = new Uint8Array(totalLength);
    let offset = 0;

    // Copy each chunk into the result buffer
    for (const chunk of this.audioChunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }

    return result;
  }

  /**
   * Start streaming transcription with a callback for real-time results
   * @param callback Function to receive transcription updates
   * @returns boolean indicating if streaming was started successfully
   */
  public startStreamingTranscription(
    callback: (text: string, isFinal: boolean) => void
  ): boolean {
    try {
      if (this.streamingActive) {
        return false;
      }

      if (!this.apiKey) {
        console.error('Cannot start streaming without API key');
        return false;
      }

      this.transcriptionCallback = callback;
      this.streamingActive = true;
      this.clearAudioBuffer();

      // Start a periodic polling to send partial transcriptions
      this.pollForPartialTranscriptions();
      
      return true;
    } catch (error) {
      console.error('Error starting streaming transcription:', error);
      return false;
    }
  }

  /**
   * Stop streaming transcription
   */
  public stopStreamingTranscription(): void {
    this.streamingActive = false;
    this.transcriptionCallback = null;
    this.clearAudioBuffer();
  }

  /**
   * Send audio chunk for streaming transcription
   * @param audioData Audio data in LINEAR16 format
   */
  public sendAudioChunk(audioData: Uint8Array): void {
    if (!this.streamingActive) {
      return;
    }

    this.addAudioChunk(audioData);
  }

  /**
   * Convert Float32Array to LINEAR16 (Int16Array) format
   * @param floatArray Input Float32Array
   * @param inputSampleRate Sample rate of input
   * @param outputSampleRate Desired output sample rate
   * @returns Uint8Array containing LINEAR16 audio data
   */
  public async convertFloat32ToLinear16(
    floatArray: Float32Array,
    inputSampleRate: number,
    outputSampleRate: number = 16000
  ): Promise<Uint8Array | null> {
    try {
      console.log(`Converting Float32Array to LINEAR16: input length ${floatArray.length}, input rate ${inputSampleRate}Hz, output rate ${outputSampleRate}Hz`);
      
      // Validate input array
      if (!floatArray || floatArray.length === 0) {
        console.error('Cannot convert empty Float32Array to LINEAR16');
        return null;
      }
      
      // Log audio signal statistics
      let minSample = 1.0;
      let maxSample = -1.0;
      let sumSquares = 0;
      for (let i = 0; i < Math.min(floatArray.length, 10000); i++) {
        const sample = floatArray[i];
        if (sample < minSample) minSample = sample;
        if (sample > maxSample) maxSample = sample;
        sumSquares += sample * sample;
      }
      const rms = Math.sqrt(sumSquares / Math.min(floatArray.length, 10000));
      console.log(`Audio stats: min=${minSample.toFixed(4)}, max=${maxSample.toFixed(4)}, RMS=${rms.toFixed(4)}`);
      
      // Resample if needed
      let resampledFloat32: Float32Array = floatArray;
      
      if (inputSampleRate !== outputSampleRate) {
        console.log(`Resampling from ${inputSampleRate}Hz to ${outputSampleRate}Hz`);
        resampledFloat32 = this.resampleAudio(floatArray, inputSampleRate, outputSampleRate);
        console.log(`Resampling complete: new length ${resampledFloat32.length}`);
      }
      
      // Convert to Int16 format
      const int16Array = new Int16Array(resampledFloat32.length);
      
      // Scale to 16-bit signed integer range (-32768 to 32767)
      for (let i = 0; i < resampledFloat32.length; i++) {
        // Clamp to range [-1, 1]
        const sample = Math.max(-1, Math.min(1, resampledFloat32[i]));
        
        // Convert to 16-bit int
        int16Array[i] = sample < 0 
          ? Math.floor(sample * 0x8000) 
          : Math.floor(sample * 0x7FFF);
      }
      
      // Check for all-zero or very quiet audio
      let nonZeroCount = 0;
      for (let i = 0; i < Math.min(int16Array.length, 1000); i++) {
        if (Math.abs(int16Array[i]) > 10) nonZeroCount++;
      }
      
      const percentNonZero = (nonZeroCount / Math.min(int16Array.length, 1000)) * 100;
      console.log(`LINEAR16 conversion complete: ${int16Array.length} samples, ${percentNonZero.toFixed(1)}% non-zero`);
      
      // If the audio is mostly silence, log a warning
      if (percentNonZero < 1.0) {
        console.warn('Converted audio contains mostly silence or very low volume');
      }
      
      return new Uint8Array(int16Array.buffer);
    } catch (error) {
      console.error('Error converting audio format:', error);
      return null;
    }
  }

  /**
   * Simple audio resampler (linear interpolation)
   */
  private resampleAudio(
    audioData: Float32Array,
    inputSampleRate: number,
    outputSampleRate: number
  ): Float32Array {
    if (inputSampleRate === outputSampleRate) {
      return audioData;
    }
    
    const ratio = inputSampleRate / outputSampleRate;
    const outputLength = Math.round(audioData.length / ratio);
    const result = new Float32Array(outputLength);
    
    for (let i = 0; i < outputLength; i++) {
      const index = i * ratio;
      const indexFloor = Math.floor(index);
      const indexCeil = Math.min(indexFloor + 1, audioData.length - 1);
      const fraction = index - indexFloor;
      
      // Linear interpolation
      result[i] = audioData[indexFloor] * (1 - fraction) + audioData[indexCeil] * fraction;
    }
    
    return result;
  }

  /**
   * Poll for partial transcriptions while streaming is active
   */
  private async pollForPartialTranscriptions(): Promise<void> {
    if (!this.streamingActive || !this.transcriptionCallback) {
      return;
    }

    try {
      if (this.audioChunks.length > 0) {
        const partialText = await this.transcribePartialAudio();
        if (partialText) {
          this.transcriptionCallback(partialText, false);
        }
      }
    } catch (error) {
      console.error('Error polling for partial transcription:', error);
    }

    // Continue polling if still active
    if (this.streamingActive) {
      setTimeout(() => this.pollForPartialTranscriptions(), 1000);
    }
  }
}

// Export a singleton instance (optional, depends on usage pattern)
// export const googleSpeechService = new GoogleSpeechService();