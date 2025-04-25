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

interface GoogleSpeechResponse {
  results: GoogleSpeechResult[];
}

export class GoogleSpeechService {
  private apiKey: string | null = null;
  private googleApiEndpoint = 'https://speech.googleapis.com/v1/speech:recognize';

  setApiKey(apiKey: string) {
    this.apiKey = apiKey;
    // Log a masked version of the API key
    const maskedKey = this.maskApiKey(apiKey);
    console.log(`Google Speech API key set: ${maskedKey}`);
    return true;
  }

  async transcribeAudio(audioBlob: Blob): Promise<string> {
    if (!this.apiKey) {
      throw new Error('Google Speech API key not set');
    }

    // Log that we're using the Google Speech API and a masked version of the key
    const maskedKey = this.maskApiKey(this.apiKey);
    console.log(`Using Google Speech API for transcription with key: ${maskedKey}`);

    try {
      // Convert Blob to base64 using browser APIs
      const buffer = await audioBlob.arrayBuffer();
      // Convert ArrayBuffer to base64 string using browser APIs
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

      // Make request to Google Speech API
      const response = await axios.post(
        `${this.googleApiEndpoint}?key=${this.apiKey}`, 
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
        throw new Error(`Google Speech API error: ${error.response.data?.error?.message || error.message}`);
      }
      throw error;
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
}
