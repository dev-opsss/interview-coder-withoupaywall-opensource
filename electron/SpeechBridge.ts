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

    // --- MODIFIED: Pass the stream termination handler to the speech service ---
    if (this.speechService && typeof this.speechService.setOnStreamTerminatedUnexpectedlyCallback === 'function') {
      this.speechService.setOnStreamTerminatedUnexpectedlyCallback(this.handleStreamTerminationByService.bind(this));
    } else {
      console.warn("---> [SpeechBridge] GoogleSpeechService does not have setOnStreamTerminatedUnexpectedlyCallback method. State might not reset correctly on unexpected stream ends.");
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

    // ----> CORRECTED AUDIO DATA LISTENER (Expects Uint8Array) <----
    ipcMain.on('speech:audio-data', (event, payload: any) => {
      // console.log(`---> [SpeechBridge] Received IPC speech:audio-data, role: ${payload?.role}, size: ${payload?.audio?.byteLength ?? 'N/A'}`); // DEBUG
      
      // Check if audio is a Uint8Array and role exists (expected format)
      // ---> MODIFICATION: Comment out this block to let GoogleSpeechService.handleAudioData take precedence for the main streaming flow.
      /*
      if (this.streamingActive && !this.isPaused && payload?.audio instanceof Uint8Array && typeof payload?.role === 'string') { 
        try {
          // No need to convert from ArrayBuffer, it's already Uint8Array
          this.processAudioChunk(payload.audio, payload.role); // Pass Uint8Array directly
        } catch (error) {
          this.sendError(`Error processing received audio chunk: ${error}`);
        }
      } else if (!this.streamingActive || this.isPaused) {
        // console.log('---> [SpeechBridge] Received audio data while inactive/paused, ignoring.'); // DEBUG
      } else if (payload instanceof ArrayBuffer || Buffer.isBuffer(payload)) {
        // If it's a raw ArrayBuffer or Buffer, assume GoogleSpeechService's direct listener is handling it.
        // Silently ignore to prevent error logs, as GSS has its own more lenient handler.
        // console.log('---> [SpeechBridge] Received raw Buffer/ArrayBuffer, assuming GSS direct handling. Ignoring.'); // Optional debug log
      } else {
         // Log if payload format is unexpected and not a raw buffer
         console.error(`---> [SpeechBridge] Invalid payload received for speech:audio-data. Expected { audio: Uint8Array, role: string }, Got:`, payload);
         this.sendError('Received invalid audio data format from renderer.');
      }
      */
      // Let GoogleSpeechService.handleAudioData (registered by GSS itself) handle this.
      // This SpeechBridge listener for 'speech:audio-data' can be removed or kept minimal
      // if other non-GSS stream consumers might use it. For now, we assume GSS is primary.
      // console.log("---> [SpeechBridge] 'speech:audio-data' received. Allowing GoogleSpeechService.handleAudioData to process.");
    });
    // ----> END AUDIO DATA LISTENER <----
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
      console.log(`---> [SpeechBridge] Calling googleSpeechService.startStreamingTranscription with language: ${this.language}`); // DEBUG
      // Start streaming using the passed-in service and webContents
      // The callback within startStreamingTranscription in GoogleSpeechService now handles sending results via webContents
      this.streamingActive = this.speechService.startStreamingTranscription(webContents, this.language);

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
   * Send audio data to the Google Speech API, now including the speaker role
   * @param audioData Audio data as Uint8Array
   * @param role The speaker role ('user' | 'interviewer')
   */
  public processAudioChunk(audioData: Uint8Array, role: string): void {
    if (!this.speechService || !this.streamingActive || this.isPaused) {
      return;
    }
    
    try {
      // Convert Uint8Array to Buffer before sending
      const audioBuffer = Buffer.from(audioData.buffer, audioData.byteOffset, audioData.byteLength);
      // Pass the role to the speech service method, asserting the type
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

  // --- NEW: Handler for when the stream is terminated by GoogleSpeechService ---
  private handleStreamTerminationByService(): void {
    if (this.streamingActive) { // Only act if SpeechBridge thought it was active
      console.log("---> [SpeechBridge] Stream terminated by GoogleSpeechService (e.g., 'end' or 'error' event). Restarting Google stream.");
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.startStreaming(this.mainWindow.webContents);
      }
    } else {
      console.log("---> [SpeechBridge] handleStreamTerminationByService called, but SpeechBridge was not active. No state change needed.");
    }
  }
}