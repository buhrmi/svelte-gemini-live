<script>
  import { GoogleGenAI, Modality } from "@google/genai";
  const { data } = $props()
  const token = data.token

  const ai = new GoogleGenAI({
    apiKey: token.name,
    httpOptions: { apiVersion: 'v1alpha' }
  });
  // const model = "gemini-live-2.5-flash-preview"
  const model = "gemini-2.5-flash-preview-native-audio-dialog"
  const config = {
    responseModalities: [Modality.AUDIO],
    outputAudioTranscription: {},
    speechConfig: {
      languageCode: "de-DE",
      voiceConfig: {
        prebuiltVoiceConfig: {
          voiceName: "Charon"
        }
      }
    },
    systemInstruction:
      "Du bist Herr Stranzberg, ein weltklasse Familiencoach. Du hilfst Eltern dabei, ihre Kinder in ihrer Selbstwirksamkeit zu stärken und eine sichere Bindung aufzubauen, die Entwicklung und Vertrauen fördert. Solltest du mehr Informationen über die Kinder benötigen (z.B. Alter, Geschlecht, Name), frage danach.",
  };

  let audioContext;
  let audioPlayerNode = null;
  let session = null;

  // for microphone input
  let isRecording = $state(false);
  let stream;
  let audioProcessor;
  let source;

  const responseQueue = $state([]);
  async function start() {
    if (!audioContext) {
      audioContext = new AudioContext();
      try {
        await audioContext.audioWorklet.addModule('audio-player-processor.js');
        audioPlayerNode = new AudioWorkletNode(audioContext, 'audio-player-processor');
        audioPlayerNode.connect(audioContext.destination);
      } catch (e) {
        console.error('Error loading audio worklet:', e);
      }
    }
    session = await ai.live.connect({
      model: model,
      callbacks: {
        onopen: function () {
          console.debug("Opened");
        },
        onmessage: function (message) {
          responseQueue.push(message);
        },
        onerror: function (e) {
          console.debug("Error:", e.message);
        },
        onclose: function (e) {
          console.debug("Close:", e.reason);
        },
      },
      config: config,
    });

  }

  function handleTurn(modelTurn) {
    modelTurn.parts.forEach((part) => {
      if (part.inlineData) {
        const base64Audio = part.inlineData.data;
        // data is base64 encoded audio/pcm;rate=24000
        const binaryString = atob(base64Audio);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        
        // Assuming 16-bit signed PCM
        const pcmData = new Int16Array(bytes.buffer);
        const float32Data = new Float32Array(pcmData.length);
        for (let i = 0; i < pcmData.length; i++) {
          float32Data[i] = pcmData[i] / 32768.0; // Convert to Float32 range [-1, 1]
        }
        
        if (audioPlayerNode) {
          const sourceSampleRate = 24000;
          const targetSampleRate = audioContext.sampleRate;

          if (sourceSampleRate === targetSampleRate) {
            audioPlayerNode.port.postMessage({ audio: float32Data });
          } else {
            // Resample audio to match AudioContext's sample rate
            const ratio = targetSampleRate / sourceSampleRate;
            const resampledLength = Math.floor(float32Data.length * ratio);
            const resampledData = new Float32Array(resampledLength);
            for (let i = 0; i < resampledLength; i++) {
              const srcIndex = i / ratio;
              const index1 = Math.floor(srcIndex);
              const index2 = Math.min(index1 + 1, float32Data.length - 1);
              const frac = srcIndex - index1;
              resampledData[i] = float32Data[index1] * (1 - frac) + float32Data[index2] * frac;
            }
            audioPlayerNode.port.postMessage({ audio: resampledData });
          }
        }
      }
    })
  }

  $effect(() => {
    while (responseQueue.length > 0) {
      const response = responseQueue.shift();
      if (!response.serverContent) continue;
      if (response.serverContent.interrupted) {
        if (audioPlayerNode) {
          audioPlayerNode.port.postMessage({ clear: true });
        }
        console.log("INTEERRUPTED")
      }
      const modelTurn = response.serverContent.modelTurn;
      if (modelTurn) handleTurn(modelTurn);
    }
  })

  async function startRecording() {
    if (isRecording) return;
    isRecording = true;
    
    if (!session) {
      await start();
    }
    
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    if (!audioContext) {
      audioContext = new AudioContext();
      try {
        await audioContext.audioWorklet.addModule('audio-player-processor.js');
        audioPlayerNode = new AudioWorkletNode(audioContext, 'audio-player-processor');
        audioPlayerNode.connect(audioContext.destination);
      } catch (e) {
        console.error('Error loading audio worklet:', e);
      }
    }
    // Resume AudioContext on user gesture
    if (audioContext.state === 'suspended') {
      audioContext.resume();
    }
    source = audioContext.createMediaStreamSource(stream);
    audioProcessor = audioContext.createScriptProcessor(4096, 1, 1);

    const targetSampleRate = 16000;
    const resampleRatio = audioContext.sampleRate / targetSampleRate;

    audioProcessor.onaudioprocess = (e) => {
      const inputData = e.inputBuffer.getChannelData(0);
      const outputLength = Math.floor(inputData.length / resampleRatio);
      const outputData = new Int16Array(outputLength);

      for (let i = 0; i < outputLength; i++) {
        const index = Math.floor(i * resampleRatio);
        let sample = inputData[index];
        sample = Math.max(-1, Math.min(1, sample)); // clamp
        outputData[i] = sample * 32767;
      }

      const base64Audio = btoa(String.fromCharCode.apply(null, new Uint8Array(outputData.buffer)));
      
      if (session && isRecording) {
        session.sendRealtimeInput({
          audio: {
            data: base64Audio,
            mimeType: "audio/pcm;rate=16000"
          }
        });
      }
    };

    source.connect(audioProcessor);
    audioProcessor.connect(audioContext.destination); // Connect to destination to keep the process running.
  }

  function stopRecording() {
    if (!isRecording) return;
    isRecording = false;

    if (stream) {
      stream.getTracks().forEach(track => track.stop());
    }
    if (source) {
      source.disconnect();
    }
    if (audioProcessor) {
      audioProcessor.disconnect();
    }
    if (audioPlayerNode) {
      audioPlayerNode.port.postMessage({ clear: true });
    }
  }
</script>

{#if isRecording}
  <button onclick={stopRecording}>STOP</button>
{:else}
  <button onclick={startRecording}>START</button>
{/if}
