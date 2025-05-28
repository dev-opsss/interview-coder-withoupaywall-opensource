import { ipcMain, BrowserWindow } from 'electron';
import { SpeechBridge } from './SpeechBridge';

/**
 * AudioCapture handles capturing audio from system in the main process
 * and sending it to the speech recognition service.
 */
export class AudioCapture {
  private speechBridge: SpeechBridge;
  private mainWindow: BrowserWindow | null = null;
  private isCapturing: boolean = false;
  
  /**
   * Creates a new AudioCapture instance
   * @param window Main application window
   * @param speechBridge SpeechBridge instance for sending audio data
   */
  constructor(window: BrowserWindow, speechBridge: SpeechBridge) {
    this.mainWindow = window;
    this.speechBridge = speechBridge;
    this.setupIpcListeners();
    
    console.log('AudioCapture initialized');
  }
  
  /**
   * Set up IPC listeners for capturing audio
   */
  private setupIpcListeners(): void {
    // Listen for audio data from renderer process
    ipcMain.on('speech:audio-data', (event, audioData) => {
      if (!this.isCapturing) return;
      
      try {
        // Process audio data - convert from format sent by renderer
        const buffer = Buffer.from(audioData);
        
        // Send to speech service via bridge
        this.speechBridge.processAudioChunk(buffer);
      } catch (error) {
        console.error('Error processing audio data:', error);
      }
    });
    
    // Start capturing
    ipcMain.on('speech:start-capture', () => {
      this.startCapturing();
    });
    
    // Stop capturing
    ipcMain.on('speech:stop-capture', () => {
      this.stopCapturing();
    });
  }
  
  /**
   * Start capturing audio
   */
  public startCapturing(): void {
    this.isCapturing = true;
    
    // Notify renderer to start sending audio data
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('speech:capture-started');
    }
    
    console.log('Audio capture started');
  }
  
  /**
   * Stop capturing audio
   */
  public stopCapturing(): void {
    this.isCapturing = false;
    
    // Notify renderer to stop sending audio data
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('speech:capture-stopped');
    }
    
    console.log('Audio capture stopped');
  }
  
  /**
   * Clean up resources
   */
  public cleanup(): void {
    if (this.isCapturing) {
      this.stopCapturing();
    }
    
    // Remove IPC listeners
    ipcMain.removeAllListeners('speech:audio-data');
    ipcMain.removeAllListeners('speech:start-capture');
    ipcMain.removeAllListeners('speech:stop-capture');
  }
} 