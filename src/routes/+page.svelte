<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { GoogleGenAI, type LiveServerMessage, Modality, type Session } from '@google/genai';
  import { createBlob, decode, decodeAudioData } from '$lib/utils';
  // import Visual3D from '$lib/Visual3D.svelte';

  export let data;

  let isRecording = false;
  let status = '';
  let error = '';

  let client: GoogleGenAI;
  let session: Session;
  let inputAudioContext: AudioContext;
  let outputAudioContext: AudioContext;
  let inputNode: GainNode;
  let outputNode: GainNode;
  let nextStartTime = 0;
  let mediaStream: MediaStream;
  let sourceNode: MediaStreamAudioSourceNode;
  let workletNode: AudioWorkletNode;
  const sources = new Set<AudioBufferSourceNode>();
  const BUFFER_DURATION = 0.1; // 1s buffer for smoother playback

  function initAudio() {
    outputAudioContext = new (window.AudioContext || window.webkitAudioContext)();
    outputNode = outputAudioContext.createGain();
    // Add a small initial delay to prevent immediate playback issues
    nextStartTime = outputAudioContext.currentTime + BUFFER_DURATION;
  }

  async function initClient() {
    initAudio();

    client = new GoogleGenAI({
      apiKey: data.token.name,
      httpOptions: { apiVersion: 'v1alpha' },
    });

    outputNode.connect(outputAudioContext.destination);

    initSession();
    startRecording();
  }

  async function initSession() {
    const model = 'gemini-2.5-flash-preview-native-audio-dialog';

    try {
      session = await client.live.connect({
        model: model,
        callbacks: {
          onopen: () => {
            updateStatus('Opened');
          },
          onmessage: async (message: LiveServerMessage) => {
            const audio = message.serverContent?.modelTurn?.parts[0]?.inlineData;
            if (audio) {
              // Ensure we're always scheduling slightly ahead
              nextStartTime = Math.max(
                nextStartTime,
                outputAudioContext.currentTime + BUFFER_DURATION / 2,
              );

              const audioBuffer = await decodeAudioData(
                decode(audio.data),
                outputAudioContext,
                24000,
                1,
              );
              const source = outputAudioContext.createBufferSource();
              source.buffer = audioBuffer;
              source.connect(outputNode);
              source.addEventListener('ended', () => {
                sources.delete(source);
              });
              source.start(nextStartTime);
              // Add a small overlap to prevent gaps
              nextStartTime = nextStartTime + audioBuffer.duration;
              sources.add(source);
  
            }

            const interrupted = message.serverContent?.interrupted;
            if (interrupted) {
              for (const source of sources.values()) {
                source.stop();
                sources.delete(source);
              }
              // Instead of resetting to 0, set nextStartTime to a safe value in the future
              nextStartTime = outputAudioContext.currentTime + BUFFER_DURATION;
            }
          },
          onerror: (e: ErrorEvent) => {
            updateError(e.message);
          },
          onclose: (e: CloseEvent) => {
            updateStatus('Close:' + e.reason);
          },
        },
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction:
            "Du bist Herr Stranzberg, ein weltklasse Familiencoach. Du sprichst gleichzeitig mit Eltern und Kindern, und hilfst dabei, die Kinder in ihrer Selbstwirksamkeit zu stärken und eine sichere Bindung aufzubauen, die Entwicklung und Vertrauen fördert. Solltest du keine Informationen über die Kinder vorliegen haben (z.B. Alter, Geschlecht, Name), dann frage die Kinder danach.",  
          speechConfig: {
                languageCode: "de-DE",
                voiceConfig: {
                  prebuiltVoiceConfig: {
                    voiceName: "Charon"
                  }
                }
              },
        },
      });
    } catch (e) {
      console.error(e);
    }
  }

  function updateStatus(msg: string) {
    status = msg;
  }

  function updateError(msg: string) {
    error = msg;
  }

  async function startRecording() {
    if (isRecording) {
      return;
    }

    updateStatus('Requesting microphone access...');

    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });

      updateStatus('Microphone access granted. Starting capture...');

      const track = mediaStream.getAudioTracks()[0];
      const settings = track.getSettings();

      // Create AudioContext without specifying sample rate to avoid mismatch
      inputAudioContext = new (window.AudioContext || window.webkitAudioContext)();
      
      // Load the AudioWorklet module
      await inputAudioContext.audioWorklet.addModule('/src/lib/pcm-processor.js');
      
      inputNode = inputAudioContext.createGain();

      sourceNode = inputAudioContext.createMediaStreamSource(mediaStream);
      sourceNode.connect(inputNode);

      // Create AudioWorklet node
      workletNode = new AudioWorkletNode(inputAudioContext, 'pcm-processor');
      
      // Handle messages from the worklet
      workletNode.port.onmessage = (event) => {
        if (event.data.type === 'pcm-data') {
          const pcmData = new Int16Array(event.data.data);
          const base64Audio = btoa(String.fromCharCode.apply(null, new Uint8Array(pcmData.buffer)));
          
          if (session && isRecording) {
            session.sendRealtimeInput({
              audio: {
                data: base64Audio,
                mimeType: "audio/pcm;rate=16000"
              }
            });
          }
        }
      };

      inputNode.connect(workletNode);
      workletNode.connect(inputAudioContext.destination);

      isRecording = true;
      updateStatus('🔴 Recording... Capturing PCM chunks.');
    } catch (err) {
      console.error('Error starting recording:', err);
      updateStatus(`Error: ${err.message}`);
      stopRecording();
    }
  }

  function stopRecording() {
    if (!isRecording && !mediaStream && !inputAudioContext) return;

    updateStatus('Stopping recording...');

    isRecording = false;

    if (workletNode && sourceNode && inputAudioContext) {
      workletNode.disconnect();
      sourceNode.disconnect();
    }

    workletNode = null;
    sourceNode = null;

    if (mediaStream) {
      mediaStream.getTracks().forEach((track) => track.stop());
      mediaStream = null;
    }

    updateStatus('Recording stopped. Click Start to begin again.');
  }

  function reset() {
    session?.close();
    initSession();
    updateStatus('Session cleared.');
  }

  onMount(() => {
    initClient();
  });

  onDestroy(() => {
    stopRecording();
    session?.close();
    inputAudioContext?.close();
    outputAudioContext?.close();
  });
</script>

<div>
  <!-- <div class="controls">
    <button
      id="resetButton"
      on:click={reset}
      disabled={isRecording}>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        height="40px"
        viewBox="0 -960 960 960"
        width="40px"
        fill="#ffffff">
        <path
          d="M480-160q-134 0-227-93t-93-227q0-134 93-227t227-93q69 0 132 28.5T720-690v-110h80v280H520v-80h168q-32-56-87.5-88T480-720q-100 0-170 70t-70 170q0 100 70 170t170 70q77 0 139-44t87-116h84q-28 106-114 173t-196 67Z" />
      </svg>
    </button>
    <button
      id="startButton"
      on:click={startRecording}
      disabled={isRecording}>
      <svg
        viewBox="0 0 100 100"
        width="32px"
        height="32px"
        fill="#c80000"
        xmlns="http://www.w3.org/2000/svg">
        <circle cx="50" cy="50" r="50" />
      </svg>
    </button>
    <button
      id="stopButton"
      on:click={stopRecording}
      disabled={!isRecording}>
      <svg
        viewBox="0 0 100 100"
        width="32px"
        height="32px"
        fill="#000000"
        xmlns="http://www.w3.org/2000/svg">
        <rect x="0" y="0" width="100" height="100" rx="15" />
      </svg>
    </button>
  </div> -->

  <div id="status"> {error || status} </div>
  <h1 class="title">
    <div class="smiley">🥸</div><br>
    HERR STRANZBERG
  </h1>
  {#if inputNode && outputNode}
    <!-- <Visual3D
      bind:inputNode
      bind:outputNode /> -->
  {/if}
</div>

<style>

  .title {

    text-align: center;
  }
  .smiley {
    font-size: 192px;
    display: inline-block;
    margin-right: 10px;
  }
  #status {
    position: absolute;
    bottom: 5vh;
    left: 0;
    right: 0;
    z-index: 10;
    text-align: center;
  }

  .controls {
    z-index: 10;
    position: absolute;
    bottom: 10vh;
    left: 0;
    right: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-direction: column;
    gap: 10px;
  }

  .controls button {
    outline: none;
    border: 1px solid rgba(255, 255, 255, 0.2);
    color: white;
    border-radius: 12px;
    background: rgba(255, 255, 255, 0.1);
    width: 64px;
    height: 64px;
    cursor: pointer;
    font-size: 24px;
    padding: 0;
    margin: 0;
  }

  .controls button:hover {
    background: rgba(255, 255, 255, 0.2);
  }

  .controls button[disabled] {
    display: none;
  }
</style>