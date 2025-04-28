import axios from 'axios';

// Define interfaces for Google Speech API response
interface GoogleSpeechAlternative {
  transcript: string;
  confidence?: number;
}

interface GoogleSpeechResult {
  alternatives: GoogleSpeechAlternative[];
  isFinal?: boolean;
}

// This interface is now used for proper typing
interface GoogleSpeechResponse {
  results: GoogleSpeechResult[];
}

export class GoogleSpeechService {
  private apiKey: string | null = null;
  private googleApiEndpoint = 'https://speech.googleapis.com/v1/speech:recognize';

  // Generate a short unique ID for tracking requests
  private generateUniqueId(): string {
    return Math.random().toString(36).substring(2, 8);
  }

  // Convert Blob to Base64 string
  private async blobToBase64(blob: Blob): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = typeof reader.result === 'string' 
          ? reader.result.split(',')[1] 
          : '';
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  // Convert WebM audio to WAV/LINEAR16 format using Web Audio API
  async convertAudioForGoogleApi(audioBlob: Blob): Promise<Blob> {
    try {
      console.log(`Converting audio: size=${(audioBlob.size / 1024).toFixed(1)}KB, type=${audioBlob.type}`);
      
      // Create audio context
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      
      // Read the blob into an ArrayBuffer
      const arrayBuffer = await new Promise<ArrayBuffer>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.onerror = reject;
        reader.readAsArrayBuffer(audioBlob);
      });
      
      // Decode the audio data
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      console.log(`Decoded audio: duration=${audioBuffer.duration}s, channels=${audioBuffer.numberOfChannels}, sample rate=${audioBuffer.sampleRate}Hz`);
      
      // Convert to LINEAR16 WAV format (16-bit PCM)
      const wavBlob = await this.audioBufferToWav(audioBuffer);
      console.log(`Converted to WAV: size=${(wavBlob.size / 1024).toFixed(1)}KB`);
      
      return wavBlob;
    } catch (error) {
      console.error(`Error converting audio for Google API:`, error);
      // If conversion fails, return original blob
      return audioBlob;
    }
  }
  
  // Convert AudioBuffer to WAV format
  async audioBufferToWav(inputBuffer: AudioBuffer): Promise<Blob> {
    // We'll downsample to 16000Hz for Google Speech API
    const targetSampleRate = 16000;
    
    // Resample if needed
    let audioData: AudioBuffer;
    if (inputBuffer.sampleRate !== targetSampleRate) {
      audioData = await this.resampleAudio(inputBuffer, targetSampleRate);
    } else {
      audioData = inputBuffer;
    }
    
    // Get the raw PCM data
    const numOfChannels = 1; // Convert to mono
    const length = audioData.length * numOfChannels * 2; // 2 bytes per sample for 16-bit
    const sampleRate = targetSampleRate;
    
    // Create the WAV header
    const wavBuffer = new ArrayBuffer(44 + length);
    const view = new DataView(wavBuffer);
    
    // Write WAV header (RIFF format)
    this.writeString(view, 0, 'RIFF');              // RIFF header
    view.setUint32(4, 36 + length, true);           // File size
    this.writeString(view, 8, 'WAVE');              // WAVE format
    this.writeString(view, 12, 'fmt ');             // Format chunk identifier
    view.setUint32(16, 16, true);                   // Format chunk length
    view.setUint16(20, 1, true);                    // PCM format (1)
    view.setUint16(22, numOfChannels, true);        // Number of channels
    view.setUint32(24, sampleRate, true);           // Sample rate
    view.setUint32(28, sampleRate * numOfChannels * 2, true); // Byte rate
    view.setUint16(32, numOfChannels * 2, true);    // Block align
    view.setUint16(34, 16, true);                   // Bits per sample
    this.writeString(view, 36, 'data');             // Data chunk identifier
    view.setUint32(40, length, true);               // Data chunk length
    
    // Get mono channel data
    let offset = 44;
    const channelData = this.convertToMono(audioData);
    
    // Write audio data as 16-bit PCM
    for (let i = 0; i < channelData.length; i++) {
      // Convert to 16-bit sample (-32768 to 32767)
      const sample = Math.max(-1, Math.min(1, channelData[i]));
      const value = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
      view.setInt16(offset, value, true);
      offset += 2;
    }
    
    return new Blob([wavBuffer], { type: 'audio/wav' });
  }
  
  // Helper function to write strings to DataView
  writeString(view: DataView, offset: number, string: string): void {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  }
  
  // Convert AudioBuffer to mono channel
  convertToMono(input: AudioBuffer): Float32Array {
    const channels = input.numberOfChannels;
    const samples = input.length;
    const monoData = new Float32Array(samples);
    
    // Mix all channels to mono
    for (let i = 0; i < samples; i++) {
      let sum = 0;
      for (let channel = 0; channel < channels; channel++) {
        sum += input.getChannelData(channel)[i];
      }
      monoData[i] = sum / channels;
    }
    
    return monoData;
  }
  
  // Resample audio to target sample rate
  async resampleAudio(audioBuffer: AudioBuffer, targetSampleRate: number): Promise<AudioBuffer> {
    const channels = audioBuffer.numberOfChannels;
    const originalSampleRate = audioBuffer.sampleRate;
    const ratio = targetSampleRate / originalSampleRate;
    const newLength = Math.round(audioBuffer.length * ratio);
    
    // Create off-screen canvas for OfflineAudioContext
    const offlineCtx = new OfflineAudioContext(channels, newLength, targetSampleRate);
    
    // Create buffer source
    const source = offlineCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(offlineCtx.destination);
    source.start(0);
    
    // Process and return the resampled buffer
    return await offlineCtx.startRendering();
  }

  setApiKey(apiKey: string): void {
    // Mask part of the API key for logging (show only first 5 chars)
    const maskedKey = apiKey.substring(0, 5) + '...' + apiKey.substring(apiKey.length - 4);
    console.log(`Google Speech API key set: ${maskedKey}`);
    this.apiKey = apiKey;
    
    // Test the API key
    this.testApiKey().then(isValid => {
      if (isValid) {
        console.log('Google Speech API key is valid and properly configured.');
      } else {
        console.error('Google Speech API key validation failed. Check your API key and permissions.');
      }
    });
  }

  async transcribeAudio(audioBlob: Blob): Promise<string> {
    if (!this.apiKey) {
      throw new Error('Google Speech API key not set');
    }

    // Log the masked API key and request size
    const maskedKey = this.maskApiKey(this.apiKey);
    console.log(`Using Google Speech API for transcription with key: ${maskedKey}`);

    try {
      // Check if audio is too large for synchronous API (>60 seconds/~500KB)
      if (audioBlob.size > 500000) {
        console.log(`Audio size (${Math.round(audioBlob.size/1024)} KB) exceeds recommended limit for sync API`);
        console.log(`Splitting audio into smaller chunks for processing...`);
        
        // Split into smaller chunks for processing
        return await this.processLargeAudioInChunks(audioBlob);
      }
      
      // For smaller audio, process normally
      const buffer = await audioBlob.arrayBuffer();
      const base64Audio = this.arrayBufferToBase64(buffer);

      // Prepare request body for REST API
      const requestData = {
        config: {
          encoding: 'WEBM_OPUS',
          sampleRateHertz: 48000,
          languageCode: 'en-US',
          model: 'default',
          enableAutomaticPunctuation: true,
        },
        audio: {
          content: base64Audio
        }
      };

      console.log(`Sending audio to Google Speech API (audio size: ${Math.round(buffer.byteLength/1024)} KB)`);

      // Construct the URL with the API key properly embedded
      const apiUrl = `${this.googleApiEndpoint}?key=${encodeURIComponent(this.apiKey)}`;
      
      // Make request to Google Speech API
      const response = await axios.post<GoogleSpeechResponse>(
        apiUrl, 
        requestData,
        {
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );

      // Extract transcription text
      const transcription = response.data.results
        ?.map((result: GoogleSpeechResult) => result.alternatives[0].transcript)
        .join(' ') || '';

      return transcription;
    } catch (error) {
      console.error('Google Speech API error:', error);
      if (axios.isAxiosError(error) && error.response) {
        const errorData = error.response.data;
        const errorMsg = errorData?.error?.message || error.message;
        
        // If this is an API key issue, provide clearer error
        if (errorMsg.includes('API Key not found') || errorMsg.includes('API_KEY_INVALID')) {
          console.error('API KEY ERROR: Your Google Speech API key is invalid or not properly configured.');
          console.error('Make sure you have enabled the Speech-to-Text API in your Google Cloud Console.');
          throw new Error('Google Speech API key is invalid or not properly configured');
        }
        
        // If the error is "input too long," try processing in chunks
        if (errorMsg.includes('too long') || errorMsg.includes('LongRunningRecognize')) {
          console.log('Audio too long for sync API - trying to process in chunks');
          return await this.processLargeAudioInChunks(audioBlob);
        }
        
        throw new Error(`Google Speech API error: ${errorMsg}`);
      }
      throw error;
    }
  }

  // Add a specialized method for partial/streaming transcription
  async transcribePartialAudio(audioBlob: Blob): Promise<string | null> {
    try {
      const requestId = this.generateUniqueId();
      console.log(`[${requestId}] Starting transcription with Google Speech API`);
      console.log(`[${requestId}] Audio info: size=${(audioBlob.size / 1024).toFixed(1)}KB, type=${audioBlob.type}`);
      
      // Check if we have audio data
      if (!audioBlob || audioBlob.size === 0) {
        console.warn(`[${requestId}] Empty audio blob received, skipping transcription`);
        return null;
      }
      
      if (!this.apiKey) {
        console.error(`[${requestId}] Google Speech API key is not set`);
        return null;
      }

      // Debug log the API key (masked for security)
      const maskedKey = this.maskApiKey(this.apiKey);
      console.log(`[${requestId}] Using Google Speech API key: ${maskedKey}`);
      
      // Convert audio format if needed
      const processedAudio = await this.convertAudioForGoogleApi(audioBlob);
      console.log(`[${requestId}] Processed audio: size=${(processedAudio.size / 1024).toFixed(1)}KB, type=${processedAudio.type}`);
      
      // Convert audio to base64
      const base64Audio = await this.blobToBase64(processedAudio);
      console.log(`[${requestId}] Converted audio to base64, length: ${base64Audio.length}`);
      
      // Prepare the request data
      const requestData = {
        config: {
          encoding: 'LINEAR16', // Changed from WEBM_OPUS to LINEAR16
          sampleRateHertz: 16000,
          languageCode: 'en-US',
          model: 'default',
          enableAutomaticPunctuation: true
        },
        audio: {
          content: base64Audio
        }
      };
      
      // Construct the URL with the API key properly embedded
      const apiUrl = `${this.googleApiEndpoint}?key=${encodeURIComponent(this.apiKey)}`;
      console.log(`[${requestId}] Sending request to Google Speech API at ${this.googleApiEndpoint}`);
      
      // Send the transcription request
      const response = await axios.post<GoogleSpeechResponse>(
        apiUrl,
        requestData,
        {
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );
      
      if (response.data && response.data.results && response.data.results.length > 0) {
        const transcript = response.data.results
          .map((result: GoogleSpeechResult) => result.alternatives[0].transcript)
          .join(' ');
        
        console.log(`[${requestId}] Transcription successful: "${transcript}"`);
        return transcript;
      } else {
        console.log(`[${requestId}] No transcription results returned`);
        return '';
      }
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        const errorData = error.response?.data;
        
        if (status === 400) {
          console.error(`[Audio Format Error] Status 400: Invalid request format. This usually indicates an issue with the audio format.`);
          console.error(`Error details:`, JSON.stringify(errorData, null, 2));
          console.error(`Audio MIME type: ${audioBlob.type}, size: ${(audioBlob.size / 1024).toFixed(1)}KB`);
          
          // Check if this is actually an API key issue
          if (errorData?.error?.message?.includes('API Key not found')) {
            console.error(`[API Key Error] The Google API key appears to be invalid or not properly configured for Speech-to-Text API.`);
            console.error(`Make sure you've enabled the Speech-to-Text API in your Google Cloud Console for this API key.`);
            return null;
          }
          
          return null;
        } else if (status === 403) {
          console.error(`[Auth Error] Status 403: Authentication failed. Check your API key and ensure it has Speech-to-Text permissions.`);
          return null;
        } else {
          console.error(`[API Error] Google Speech API request failed: ${error.message}`, error.response?.data);
        }
      } else {
        console.error(`[Error] Unexpected error during transcription:`, error);
      }
      return null;
    }
  }

  // Helper function to convert ArrayBuffer to base64 string in browser
  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    // Convert ArrayBuffer to Uint8Array
    const uint8Array = new Uint8Array(buffer);
    
    // Convert Uint8Array to a binary string
    let binaryString = '';
    for (let i = 0; i < uint8Array.length; i++) {
      binaryString += String.fromCharCode(uint8Array[i]);
    }
    
    // Convert binary string to base64
    return btoa(binaryString);
  }

  // Helper function to mask API key for secure logging
  private maskApiKey(apiKey: string): string {
    if (!apiKey) return '[NONE]';
    if (apiKey.length <= 8) return '****' + apiKey.slice(-4);
    
    // Show first 4 and last 4 characters, mask the rest
    return apiKey.slice(0, 4) + '****' + apiKey.slice(-4);
  }

  // Helper method to process large audio files by splitting them into chunks
  private async processLargeAudioInChunks(audioBlob: Blob): Promise<string> {
    try {
      // Convert the ENTIRE blob to WAV first for reliable slicing
      console.log('Converting large audio blob to WAV before chunking...');
      const wavBlob = await this.convertAudioForGoogleApi(audioBlob);
      if (!wavBlob || wavBlob.type !== 'audio/wav') {
        console.error('Failed to convert large audio blob to WAV. Cannot process in chunks.');
        throw new Error('Failed to convert large audio to WAV for chunking');
      }
      console.log(`Large blob converted to WAV: size=${(wavBlob.size / 1024).toFixed(1)}KB`);

      // Calculate chunk size based on the WAV blob size
      // Target chunk duration ~15-20 seconds (LINEAR16 = 16000Hz * 1 channel * 2 bytes/sample = 32000 bytes/sec)
      const bytesPerSecond = 32000;
      const targetChunkSeconds = 15;
      const chunkSize = bytesPerSecond * targetChunkSeconds; 
      const numChunks = Math.ceil(wavBlob.size / chunkSize);
      // Use wavBlob.size for calculations now
      const actualChunkSize = Math.ceil(wavBlob.size / numChunks); 
      
      console.log(`Processing WAV audio in ${numChunks} chunks of ~${Math.round(actualChunkSize/1024)}KB each`);
      
      let allTranscriptions: string[] = [];
      
      // Process chunks
      for (let i = 0; i < numChunks; i++) {
        // Slice the WAV blob
        const start = i * actualChunkSize;
        const end = Math.min((i + 1) * actualChunkSize, wavBlob.size);
        const chunkBlob = wavBlob.slice(start, end, 'audio/wav'); 
        
        console.log(`Processing chunk ${i+1}/${numChunks} (${Math.round(chunkBlob.size/1024)}KB)`);
        
        try {
          // Convert WAV chunk to base64
          const base64Audio = await this.blobToBase64(chunkBlob);

          // Prepare request (config is already correct: LINEAR16, 16000Hz)
          const requestData = {
            config: {
              encoding: 'LINEAR16',
              sampleRateHertz: 16000,
              languageCode: 'en-US',
              model: 'default',
              enableAutomaticPunctuation: true,
            },
            audio: {
              content: base64Audio
            }
          };
          
          // Construct URL with properly encoded API key
          const apiUrl = `${this.googleApiEndpoint}?key=${encodeURIComponent(this.apiKey || '')}`;
          
          // Send request with slightly longer timeout for chunks
          const chunkResponse = await axios.post<GoogleSpeechResponse>(
            apiUrl,
            requestData,
            {
              headers: {
                'Content-Type': 'application/json'
              },
              timeout: 20000 // 20 seconds for chunk processing
            }
          );
          
          // Extract text from response
          const chunkText = chunkResponse.data.results
            ?.map((result: GoogleSpeechResult) => result.alternatives[0].transcript)
            .join(' ') || '';
          
          if (chunkText) {
            allTranscriptions.push(chunkText);
            console.log(`Chunk ${i+1} transcription: "${chunkText.substring(0, 30)}${chunkText.length > 30 ? '...' : ''}"`);
          }
          
          // Add a small delay between chunk requests to avoid rate limiting
          if (i < numChunks - 1) {
            await new Promise(resolve => setTimeout(resolve, 200));
          }
        } catch (error) {
          console.error(`Error processing chunk ${i+1}:`, error);
          // Continue with next chunk instead of failing completely
        }
      }
      
      // Combine all chunk transcriptions
      const fullTranscription = allTranscriptions.join(' ');
      console.log(`Complete transcription assembled from ${allTranscriptions.length} chunks`);
      
      return fullTranscription;
    } catch (error) {
      console.error('Error in chunk processing:', error);
      throw new Error('Failed to process audio in chunks');
    }
  }

  /**
   * Test if the Google Speech API key is valid and properly configured
   */
  async testApiKey(): Promise<boolean> {
    try {
      if (!this.apiKey) {
        console.error('No API key provided for testing');
        return false;
      }
      
      // Create a simple test request with minimal data
      const testData = {
        config: {
          encoding: 'LINEAR16',
          sampleRateHertz: 16000,
          languageCode: 'en-US',
        },
        audio: {
          // This is a tiny base64-encoded audio sample (almost empty)
          content: 'UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA='
        }
      };
      
      console.log('Testing Google Speech API key configuration...');
      const maskedKey = this.maskApiKey(this.apiKey);
      console.log(`Using API key: ${maskedKey}`);
      
      // Construct the URL with the API key properly embedded
      const apiUrl = `${this.googleApiEndpoint}?key=${encodeURIComponent(this.apiKey)}`;
      
      // Send the test request
      await axios.post(
        apiUrl,
        testData,
        {
          headers: {
            'Content-Type': 'application/json'
          },
          timeout: 5000
        }
      );
      
      // If we get here, the API key works (even if there's no transcription)
      console.log('API key test successful - Speech API is accessible');
      return true;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        const errorData = error.response?.data;
        
        if (status === 403) {
          console.error('ERROR: Authentication failed (403). Please check that your Google API key has Speech-to-Text API enabled.');
          return false;
        } else if (status === 400) {
          // Check if it's actually an API key issue
          if (errorData?.error?.message?.includes('API Key not found') || 
              errorData?.error?.message?.includes('API_KEY_INVALID')) {
            console.error('ERROR: API Key invalid or not configured for Speech-to-Text API.');
            console.error('Details:', JSON.stringify(errorData?.error || {}, null, 2));
            return false;
          }
          
          // A 400 error with the test data likely means the API is accessible but there was an issue with the test audio
          // This is actually a good sign - it means the key itself is valid for Speech API
          return true;
        } else {
          console.error(`API test failed with status ${status}: ${error.message}`);
          console.error('Error details:', JSON.stringify(errorData || {}, null, 2));
          return false;
        }
      }
      
      console.error(`Unknown error testing API key: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }
}
