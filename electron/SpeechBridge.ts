import { ipcMain, BrowserWindow, WebContents } from 'electron';
import { GoogleSpeechService } from './GoogleSpeechService';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { configHelper } from './ConfigHelper';

/**
 * SpeechBridge manages communication between renderer process (UI) and the
 * speech recognition service running in the main process.
 */
export class SpeechBridge {
  private speechService: GoogleSpeechService | null = null;
  private mainWindow: BrowserWindow | null = null;
  private streamingActive: boolean = false;
  private isPaused: boolean = false;
  private language: string = 'en-US';
  
  // Constants for IPC channels
  private readonly CHANNELS = {
    START: 'speech:start',
    STOP: 'speech:stop',
    PAUSE: 'speech:pause',
    RESUME: 'speech:resume',
    TRANSCRIPTION: 'speech:transcription',
    ERROR: 'speech:error',
    STATUS: 'speech:status',
    GET_STATUS: 'speech:getStatus'
  };

  /**
   * Creates a new SpeechBridge
   * @param speechService An instance of GoogleSpeechService
   * @param window The main application window
   */
  constructor(speechService: GoogleSpeechService, window: BrowserWindow) {
    this.mainWindow = window;
    this.speechService = speechService;

    // Ensure service is valid
    if (!this.speechService) {
       console.error('SpeechBridge initialized with null GoogleSpeechService!');
       // Potentially throw an error or handle this case
    }

    // Set up IPC listeners
    this.setupIpcListeners();
    
    // Log initialization
    console.log('SpeechBridge initialized');
  }
  
  /**
   * Set up IPC listeners for renderer process commands
   */
  private setupIpcListeners(): void {
    // Start streaming command
    ipcMain.on(this.CHANNELS.START, (event, options) => {
      console.log(`---> [SpeechBridge] Received IPC ${this.CHANNELS.START}`); // DEBUG
      try {
        // Extract options if provided
        if (options && options.language) {
          this.language = options.language;
        }
        
        this.startStreaming(event.sender);
      } catch (error) {
        this.sendError(`Failed to start streaming: ${error}`);
      }
    });
    
    // Stop streaming command
    ipcMain.on(this.CHANNELS.STOP, () => {
      console.log(`---> [SpeechBridge] Received IPC ${this.CHANNELS.STOP}`); // DEBUG
      try {
        this.stopStreaming();
      } catch (error) {
        this.sendError(`Failed to stop streaming: ${error}`);
      }
    });
    
    // Pause streaming command
    ipcMain.on(this.CHANNELS.PAUSE, () => {
      try {
        this.pauseStreaming();
      } catch (error) {
        this.sendError(`Failed to pause streaming: ${error}`);
      }
    });
    
    // Resume streaming command
    ipcMain.on(this.CHANNELS.RESUME, () => {
      try {
        this.resumeStreaming();
      } catch (error) {
        this.sendError(`Failed to resume streaming: ${error}`);
      }
    });
    
    // Get current status command
    ipcMain.handle(this.CHANNELS.GET_STATUS, () => {
      return {
        isStreaming: this.streamingActive,
        isPaused: this.isPaused,
        language: this.language,
        hasCredentials: this.speechService !== null
      };
    });

    // ----> ADD AUDIO CHUNK LISTENER <----
    ipcMain.on('audio:chunk', (event, audioData) => {
      // console.log(`---> [SpeechBridge] Received IPC audio:chunk, type: ${typeof audioData}, size: ${audioData?.byteLength ?? 'N/A'}`); // DEBUG
      if (this.streamingActive && !this.isPaused && audioData instanceof ArrayBuffer) {
        try {
          // Convert ArrayBuffer to Uint8Array for processAudioChunk
          const uint8ArrayData = new Uint8Array(audioData);
          this.processAudioChunk(uint8ArrayData);
        } catch (error) {
          this.sendError(`Error processing received audio chunk: ${error}`);
        }
      } else if (!this.streamingActive || this.isPaused) {
        // console.log('---> [SpeechBridge] Received audio:chunk but streaming is not active or paused. Ignoring.'); // DEBUG
      } else if (!(audioData instanceof ArrayBuffer)){
          console.warn(`---> [SpeechBridge] Received audio:chunk but data is not an ArrayBuffer. Type: ${typeof audioData}`);
      }
    });
    // ----> END AUDIO CHUNK LISTENER <----
  }
  
  /**
   * Start streaming audio to Google Speech API
   * @param webContents The WebContents object of the sender window
   * @returns True if started successfully
   */
  public startStreaming(webContents: WebContents): boolean {
    console.log(`---> [SpeechBridge] startStreaming called`); // DEBUG
    if (!this.speechService) {
      this.sendError('Speech service not initialized');
      return false;
    }
    
    if (this.streamingActive) {
      console.warn("---> [SpeechBridge] startStreaming called while already active. Ignoring."); // DEBUG
      return false; // Indicate that we didn't start a *new* stream
    }
    
    try {
      console.log(`---> [SpeechBridge] Calling googleSpeechService.startStreamingTranscription`); // DEBUG
      // Start streaming using the passed-in service and webContents
      // The callback within startStreamingTranscription in GoogleSpeechService now handles sending results via webContents
      this.streamingActive = this.speechService.startStreamingTranscription(webContents);

      console.log(`---> [SpeechBridge] startStreamingTranscription returned: ${this.streamingActive}`); // DEBUG
      if (!this.streamingActive) {
        throw new Error('GoogleSpeechService.startStreamingTranscription returned false.');
      }

      this.isPaused = false;
      
      // Send status update to renderer
      this.sendStatus('recording');
      
      return true;
    } catch (error) {
      this.sendError(`Failed to start streaming: ${error}`);
      this.streamingActive = false;
      return false;
    }
  }
  
  /**
   * Stop streaming audio to Google Speech API
   */
  public stopStreaming(): void {
    console.log(`---> [SpeechBridge] stopStreaming called`); // DEBUG
    if (!this.speechService || !this.streamingActive) {
      console.log(`---> [SpeechBridge] stopStreaming skipped (service null or not active)`); // DEBUG
      return;
    }
    
    try {
      console.log(`---> [SpeechBridge] Calling googleSpeechService.stopStreamingTranscription`); // DEBUG
      this.speechService.stopStreamingTranscription();
      this.streamingActive = false;
      this.isPaused = false;
      
      // Send status update to renderer
      this.sendStatus('stopped');
    } catch (error) {
      this.sendError(`Failed to stop streaming: ${error}`);
    }
  }
  
  /**
   * Pause streaming audio to Google Speech API
   */
  public pauseStreaming(): void {
    if (!this.streamingActive || this.isPaused) {
      return;
    }
    
    this.isPaused = true;
    
    // Send status update to renderer
    this.sendStatus('paused');
  }
  
  /**
   * Resume streaming audio to Google Speech API
   */
  public resumeStreaming(): void {
    if (!this.streamingActive || !this.isPaused) {
      return;
    }
    
    this.isPaused = false;
    
    // Send status update to renderer
    this.sendStatus('recording');
  }
  
  /**
   * Send audio data to the Google Speech API
   * @param audioData Audio data as Uint8Array
   */
  public processAudioChunk(audioData: Uint8Array): void {
    if (!this.speechService || !this.streamingActive || this.isPaused) {
      return;
    }
    
    try {
      // Convert Uint8Array to Buffer before sending
      const audioBuffer = Buffer.from(audioData.buffer, audioData.byteOffset, audioData.byteLength);
      this.speechService.sendAudioChunk(audioBuffer);
    } catch (error) {
      this.sendError(`Error processing audio: ${error}`);
    }
  }
  
  /**
   * Send error message to renderer process
   * @param message Error message
   */
  private sendError(message: string): void {
    console.error(message);
    
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(this.CHANNELS.ERROR, message);
    }
  }
  
  /**
   * Send status update to renderer process
   * @param status Current status
   */
  private sendStatus(status: string): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(this.CHANNELS.STATUS, status);
    }
  }
  
  /**
   * Clean up resources when application is shutting down
   */
  public cleanup(): void {
    console.log('Cleaning up SpeechBridge listeners...');
    // Remove listeners for the channels used
    ipcMain.removeListener(this.CHANNELS.START, this.handleStartEvent); // Need named handlers to remove
    ipcMain.removeListener(this.CHANNELS.STOP, this.handleStopEvent);   // Need named handlers to remove
    ipcMain.removeListener(this.CHANNELS.PAUSE, this.handlePauseEvent); // Need named handlers to remove
    ipcMain.removeListener(this.CHANNELS.RESUME, this.handleResumeEvent); // Need named handlers to remove
    ipcMain.removeHandler(this.CHANNELS.GET_STATUS); // removeHandler for handle

    // Nullify references
    this.speechService = null;
    this.mainWindow = null;
  }

  // --- Named handlers for IPC listeners to allow removal ---
  private handleStartEvent = (event: Electron.IpcMainEvent, options: any): void => {
      try {
        if (options && options.language) {
          this.language = options.language;
        }
        this.startStreaming(event.sender);
      } catch (error: any) {
        this.sendError(`Failed to start streaming: ${error?.message || error}`);
      }
  }

  private handleStopEvent = (): void => {
      try {
        this.stopStreaming();
      } catch (error: any) {
        this.sendError(`Failed to stop streaming: ${error?.message || error}`);
      }
  }

  private handlePauseEvent = (): void => {
     try {
        this.pauseStreaming();
      } catch (error: any) {
        this.sendError(`Failed to pause streaming: ${error?.message || error}`);
      }
  }

  private handleResumeEvent = (): void => {
      try {
        this.resumeStreaming();
      } catch (error: any) {
        this.sendError(`Failed to resume streaming: ${error?.message || error}`);
      }
  }

  private handleGetStatus = (): any => {
     return {
        isStreaming: this.streamingActive,
        isPaused: this.isPaused,
        language: this.language,
        hasCredentials: this.speechService !== null
      };
  }
}

// Also export a renderer-side interface for use in the renderer process
export class SpeechBridgeRenderer {
  // These methods are intended to be used in the browser renderer process, 
  // where the window.electron object is provided by the Electron preload script
  
  static startStreaming(language?: string): void {
    if (typeof window !== 'undefined' && window.electron) {
      // Use type assertion to tell TypeScript this method exists
      (window.electron as any).send('speech:start', { language });
    }
  }
  
  static stopStreaming(): void {
    if (typeof window !== 'undefined' && window.electron) {
      (window.electron as any).send('speech:stop');
    }
  }
  
  static pauseStreaming(): void {
    if (typeof window !== 'undefined' && window.electron) {
      (window.electron as any).send('speech:pause');
    }
  }
  
  static resumeStreaming(): void {
    if (typeof window !== 'undefined' && window.electron) {
      (window.electron as any).send('speech:resume');
    }
  }
  
  static async getStatus(): Promise<any> {
    if (typeof window !== 'undefined' && window.electron) {
      return await (window.electron as any).invoke('speech:getStatus');
    }
    return null;
  }
  
  static onTranscription(callback: (text: string, isFinal: boolean) => void): () => void {
    if (typeof window !== 'undefined' && window.electron) {
      return (window.electron as any).on('speech:transcription', callback);
    }
    return () => {};
  }
  
  static onError(callback: (message: string) => void): () => void {
    if (typeof window !== 'undefined' && window.electron) {
      return (window.electron as any).on('speech:error', callback);
    }
    return () => {};
  }
  
  static onStatus(callback: (status: string) => void): () => void {
    if (typeof window !== 'undefined' && window.electron) {
      return (window.electron as any).on('speech:status', callback);
    }
    return () => {};
  }
}