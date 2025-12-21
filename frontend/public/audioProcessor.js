class AudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.bufferSize = 4096;
    this.buffer = new Float32Array(this.bufferSize);
    this.bufferIndex = 0;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (!input || !input.length) return true;
    
    const channelData = input[0]; // Mono channel

    // Process audio inputs
    for (let i = 0; i < channelData.length; i++) {
      this.buffer[this.bufferIndex++] = channelData[i];

      // When buffer is full, process and send
      if (this.bufferIndex >= this.bufferSize) {
        this.flush();
      }
    }

    return true; // Keep processor alive
  }

  flush() {
    // 1. Convert to Int16 PCM (Moved from App.js)
    const pcmData = new Int16Array(this.bufferSize);
    let sum = 0;

    for (let i = 0; i < this.bufferSize; i++) {
      const s = Math.max(-1, Math.min(1, this.buffer[i]));
      // Convert Float32 (-1.0 to 1.0) to Int16 (-32768 to 32767)
      pcmData[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
      
      // Calculate sum for volume metering
      sum += Math.abs(s);
    }

    // 2. Calculate average volume level (0-100 scale rough approx)
    const avgLevel = (sum / this.bufferSize) * 100 * 3;

    // 3. Send data to main thread
    this.port.postMessage({
      type: 'audio_data',
      buffer: pcmData.buffer,
      volume: Math.min(100, avgLevel)
    }, [pcmData.buffer]); // Transfer buffer to avoid copy

    // Reset buffer
    this.bufferIndex = 0;
  }
}

registerProcessor('audio-processor', AudioProcessor);
