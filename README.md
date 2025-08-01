# Svelte-Gemini-Live

A quick-and-dirty prototype using Google Gemini's [Live API](https://ai.google.dev/gemini-api/docs/live) with live audio models (e.g. `gemini-live-2.5-flash-preview`) using Svelte.

### Features

- Uses browser's audio APIs to record and live stream bidirectional audio.
- Interrupt detection: Turn stops when the model detects speech.
- Use ephemeral token to not expose your api key