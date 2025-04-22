// public/recognizer-processor.js

class RecognizerProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.sampleRate = options?.processorOptions?.sampleRate || sampleRate; // sampleRate is global in AudioWorkletGlobalScope
    this.bufferSize = options?.processorOptions?.bufferSize || 16384; // Increase buffer size (e.g., ~1 second worth of samples at 16kHz)
    this._buffer = new Float32Array(this.bufferSize);
    this._bufferPos = 0;
    
    // Let the main thread know the processor is ready
    this.port.postMessage({ type: 'processorReady' });
    console.log(`RecognizerProcessor created. Sample Rate: ${this.sampleRate}, Buffer Size: ${this.bufferSize}`);
  }

  process(inputs, outputs, parameters) {
    // Assuming mono input
    const inputChannel = inputs[0]?.[0];

    if (inputChannel) {
      // Append new data to the buffer
      const remainingSpace = this._buffer.length - this._bufferPos;
      const amountToCopy = Math.min(inputChannel.length, remainingSpace);
      
      if (amountToCopy > 0) {
          this._buffer.set(inputChannel.subarray(0, amountToCopy), this._bufferPos);
          this._bufferPos += amountToCopy;
      }

      // If the buffer is full, send it to the main thread
      if (this._bufferPos >= this.bufferSize) {
        // Post the buffer (transferable object for efficiency)
        this.port.postMessage({
           type: 'audioData',
           audio: this._buffer.buffer // Send the underlying ArrayBuffer
        }, [this._buffer.buffer]); // Transfer ownership

        // Create a new buffer for the next chunk
        this._buffer = new Float32Array(this.bufferSize);
        
        // Handle leftover data from the input channel
        const leftover = inputChannel.length - amountToCopy;
        if (leftover > 0) {
            this._buffer.set(inputChannel.subarray(amountToCopy), 0);
            this._bufferPos = leftover;
        } else {
             this._bufferPos = 0;
        }
      }
    }

    // Keep the processor alive
    return true;
  }
}

registerProcessor('recognizer-processor', RecognizerProcessor); 