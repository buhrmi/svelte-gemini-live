class AudioPlayerProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = [];
    this.port.onmessage = (event) => {
      if (event.data.audio) {
        this.buffer.push(...event.data.audio);
      } else if (event.data.clear) {
        this.buffer = [];
      }
    };
  }

  process(inputs, outputs, parameters) {
    const output = outputs[0];
    const channel = output[0];
    
    const frameCount = channel.length;
    const bufferLength = this.buffer.length;

    const framesToCopy = Math.min(frameCount, bufferLength);

    for (let i = 0; i < framesToCopy; i++) {
      channel[i] = this.buffer[i];
    }
    
    // Fill rest of the buffer with silence if not enough data
    for (let i = framesToCopy; i < frameCount; i++) {
      channel[i] = 0;
    }

    this.buffer.splice(0, framesToCopy);

    return true;
  }
}

registerProcessor('audio-player-processor', AudioPlayerProcessor);
