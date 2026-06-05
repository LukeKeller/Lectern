# Self-hosted text-to-speech with Kokoro-FastAPI

Lectern can read articles aloud. Two providers are supported:

- **ElevenLabs** — cloud, high quality. Just set an API key on the in-app
  **Settings > Listen** page. No server configuration needed.
- **Kokoro (self-hosted)** — free, runs on your own hardware via a Docker
  container. This document covers setting that up.

## What Kokoro-FastAPI is

[Kokoro-FastAPI](https://github.com/remsky/Kokoro-FastAPI) wraps the open
Kokoro TTS model in an OpenAI-compatible HTTP API. Lectern's BFF talks to it
over HTTP, appending the OpenAI-compatible paths `/v1/audio/speech` and
`/v1/audio/voices` to the configured base URL. It runs as a **separate Docker
sibling container** — it is not bundled into the YunoHost package.

## Run the container

CPU image (works on any machine):

```bash
docker run -d --name kokoro-tts --restart unless-stopped \
  -p 127.0.0.1:8880:8880 ghcr.io/remsky/kokoro-fastapi-cpu:latest
```

GPU image (machines with an NVIDIA GPU + the NVIDIA container toolkit):

```bash
docker run -d --name kokoro-tts --restart unless-stopped --gpus all \
  -p 127.0.0.1:8880:8880 ghcr.io/remsky/kokoro-fastapi-gpu:latest
```

Binding to `127.0.0.1` keeps the service reachable only from the local host,
which is what Lectern expects with the default configuration.

## Verify it's up

```bash
curl http://127.0.0.1:8880/v1/audio/voices
```

A JSON list of available voices means the service is running and reachable.

## Resource expectations

- **~2GB RAM** while synthesizing.
- **CPU-capable** — no GPU required. On the CPU image the CPU pegs during
  synthesis, but Lectern caches generated audio, so a given article is only
  synthesized once; replays are served from cache.

## Point Lectern at it

The base URL is held in the `KOKORO_BASE_URL` environment variable, rendered
into the app's `.env` from the `kokoro_base_url` YunoHost app setting. Default:
`http://127.0.0.1:8880`.

You normally don't need to change it. To override it (for example if Kokoro
runs on another host or port), set it in the YunoHost admin:

**Applications > Lectern > Config panel > Text-to-speech > Kokoro-FastAPI base
URL.**

Saving the panel re-renders `.env` and restarts Lectern automatically — no
upgrade or SSH needed.

## Select it in the app

Finally, open the in-app **Settings > Listen** section and choose
**Kokoro (self-hosted)** as the provider. Articles will then be read using your
local Kokoro container.
