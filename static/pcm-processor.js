class PCMProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.inputBuffer = [];
    this.accumulatedSamples = [];
    this.targetSampleRate = 16000;
    this.samplesPerChunk = 1600; // 100ms at 16kHz
    this.resampleRatio = sampleRate / this.targetSampleRate;
    this.inputBufferOffset = 0;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (!input || !input[0]) return true;

    // Accumulate input samples as Float32
    this.inputBuffer.push(...input[0]);

    // Only resample when enough input samples are available for at least one output chunk
    const totalInputSamples = this.inputBuffer.length;
    const neededInputSamples = Math.ceil(this.samplesPerChunk * this.resampleRatio);

    while (totalInputSamples - this.inputBufferOffset >= neededInputSamples) {
      // Resample a chunk
      const outputData = new Float32Array(this.samplesPerChunk);
      for (let i = 0; i < this.samplesPerChunk; i++) {
        const exactIndex = (this.inputBufferOffset + i * this.resampleRatio);
        const index = Math.floor(exactIndex);
        const fraction = exactIndex - index;
        let sample = this.inputBuffer[index] || 0;
        if (index + 1 < this.inputBuffer.length) {
          const nextSample = this.inputBuffer[index + 1];
          sample = sample * (1 - fraction) + nextSample * fraction;
        }
        outputData[i] = Math.max(-1, Math.min(1, sample));
      }
      // Convert to Int16Array for sending
      const int16Chunk = new Int16Array(this.samplesPerChunk);
      for (let i = 0; i < this.samplesPerChunk; i++) {
        int16Chunk[i] = Math.round(outputData[i] * 32767);
      }
      this.port.postMessage({
        type: 'pcm-data',
        data: int16Chunk.buffer
      }, [int16Chunk.buffer]);
      this.inputBufferOffset += neededInputSamples;
    }

    // Remove processed samples from inputBuffer to avoid unbounded growth
    if (this.inputBufferOffset > 0) {
      this.inputBuffer = this.inputBuffer.slice(this.inputBufferOffset);
      this.inputBufferOffset = 0;
    }

    return true;
  }
}

registerProcessor('pcm-processor', PCMProcessor);
