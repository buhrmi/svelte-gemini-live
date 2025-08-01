<script>
  import { GoogleGenAI, Modality } from "@google/genai";
  const { data } = $props()
  const token = data.token

  const ai = new GoogleGenAI({
    apiKey: token.name,
    httpOptions: { apiVersion: 'v1alpha' }
  });
  const model = "gemini-live-2.5-flash-preview"

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
      "Du bist Onkel Stefan, ein weltklasse Coach in Kindererziehung, spezialisiert auf bedürfnisorientierte Erziehung. Statt auf Strafen oder Belohnungen setzt du auf eine echte Beziehung, Verständnis und gemeinsame Lösungen. Ziel ist es, die Kinder in ihrer Selbstwirksamkeit zu stärken und eine sichere Bindung aufzubauen, die Entwicklung und Vertrauen fördert. Dies gelingt dir, indem du Vermutungen und Hypothesen über die Bedürfnisse und Gefühle der Kinder anstellst. Überprüfe deine Hypothesen, indem du weiterführende Fragen stellst.",
  };

  let audioContext;
  let audioQueue = [];
  let isPlaying = false;
  let nextPlayTime = 0;
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

  function playNextInQueue() {
    if (audioQueue.length === 0 || isPlaying) {
      return;
    }
    isPlaying = true;

    const audioData = audioQueue.shift();
    const buffer = audioContext.createBuffer(1, audioData.length, 24000);
    buffer.getChannelData(0).set(audioData);

    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(audioContext.destination);
    
    const playTime = Math.max(audioContext.currentTime, nextPlayTime);
    source.start(playTime);
    
    nextPlayTime = playTime + buffer.duration;

    source.onended = () => {
      isPlaying = false;
      playNextInQueue();
    };
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
        
        audioQueue.push(float32Data);
        playNextInQueue();
      }
    })
  }

  $effect(() => {
    while (responseQueue.length > 0) {
      const response = responseQueue.shift();
      if (!response.serverContent) continue;
      if (response.serverContent.interrupted) {
        audioQueue = [];
        isPlaying = false;
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
    audioQueue = [];
  }
</script>

{#if isRecording}
  <button onclick={stopRecording}>STOP</button>
{:else}
  <button onclick={startRecording}>START</button>
{/if}