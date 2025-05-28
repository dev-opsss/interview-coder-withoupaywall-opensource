/**
 * Helper class for capturing audio in the renderer process and sending it to the main process
 */
export class AudioCaptureHelper {
  private audioContext: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private processorNode: ScriptProcessorNode | null = null;
  private isCapturing: boolean = false;
  
  /**
   * Start capturing audio from the user's microphone
   * @returns Promise that resolves when capturing starts or rejects on error
   */
  public async startCapturing(): Promise<void> {
    if (this.isCapturing) return;
    
    try {
      // Request microphone access
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        },
        video: false
      });
      
      this.stream = stream;
      
      // Create audio context
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      this.audioContext = new AudioContextClass();
      
      // Create audio nodes
      this.sourceNode = this.audioContext.createMediaStreamSource(stream);
      this.processorNode = this.audioContext.createScriptProcessor(4096, 1, 1);
      
      // Connect nodes
      this.sourceNode.connect(this.processorNode);
      this.processorNode.connect(this.audioContext.destination);
      
      // Process audio data
      this.processorNode.onaudioprocess = (event) => {
        if (!this.isCapturing) return;
        
        const inputData = event.inputBuffer.getChannelData(0);
        this.processAudioData(inputData);
      };
      
      this.isCapturing = true;
      
      // Setup listener for capture-stopped event from main process
      if (window.electron) {
        window.electron.on('speech:capture-stopped', this.stopCapturing.bind(this));
      }
      
      console.log('Audio capture started in renderer');
    } catch (error) {
      console.error('Error starting audio capture:', error);
      throw error;
    }
  }
  
  /**
   * Stop capturing audio
   */
  public stopCapturing(): void {
    if (!this.isCapturing) return;
    
    // Disconnect nodes
    if (this.processorNode) {
      this.processorNode.disconnect();
      this.processorNode = null;
    }
    
    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }
    
    // Stop all tracks in the stream
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
    
    // Close audio context
    if (this.audioContext) {
      this.audioContext.close().catch(console.error);
      this.audioContext = null;
    }
    
    this.isCapturing = false;
    console.log('Audio capture stopped in renderer');
  }
  
  /**
   * Process audio data and send to main process
   * @param float32Data Audio data as Float32Array
   */
  private processAudioData(float32Data: Float32Array): void {
    if (!window.electron) return;
    
    try {
      // Convert to format suitable for Google Speech API (LINEAR16)
      const pcmData = this.convertFloat32ToInt16(float32Data);
      
      // Send to main process
      (window.electron as any).send('speech:audio-data', pcmData);
    } catch (error) {
      console.error('Error processing audio data:', error);
    }
  }
  
  /**
   * Convert Float32Array to Int16Array (LINEAR16 format required by Google Speech API)
   * @param float32Array Audio data as Float32Array
   * @returns Int16Array containing audio data
   */
  private convertFloat32ToInt16(float32Array: Float32Array): Int16Array {
    const int16Array = new Int16Array(float32Array.length);
    
    for (let i = 0; i < float32Array.length; i++) {
      // Convert from [-1.0, 1.0] to [-32768, 32767]
      const s = Math.max(-1, Math.min(1, float32Array[i]));
      int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    
    return int16Array;
  }
  
  /**
   * Check if the browser supports audio capture
   * @returns True if audio capture is supported
   */
  public static isSupported(): boolean {
    return !!(navigator && navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  }
} 