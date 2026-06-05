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

- **Memory: give it ~4GB.** The Kokoro-82M model plus the PyTorch runtime
  comfortably fits in about 4GB; 2GB is the bare floor and leaves no headroom
  for longer texts. The published image sets **no memory limit**, so if the
  host runs short of RAM mid-synthesis the kernel's OOM-killer terminates the
  container — and `--restart unless-stopped` immediately brings it back, so it
  looks like a silent restart loop rather than an out-of-memory error. Size the
  host (or a `--memory` limit you set deliberately, only if the host can back
  it) so 4GB is genuinely available.
- **CPU: 4 cores is a comfortable reference** (the upstream project's example
  deployment is 4 vCPU / 8GB). On the CPU image the cores peg during synthesis.
  Generation is roughly real-time per chunk on a modern CPU — it is not the
  bottleneck for a single chunk.
- **GPU is optional but much faster.** If you have an NVIDIA GPU, the GPU image
  synthesizes far quicker; the model needs ~2–3GB VRAM.
- **Audio is cached** — a given article+voice is only synthesized once;
  replays are served from Lectern's cache and never re-render.

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

## Troubleshooting

### The container keeps restarting (and listening fails partway)

This is almost always the **OOM-killer**, not a Kokoro bug. Lectern renders a
whole article in one request (chunk by chunk), so a restart mid-render aborts
the in-flight synthesis and the listen fails. Confirm and fix:

```bash
# "true" here means the kernel killed it for running out of memory:
docker inspect kokoro-tts --format '{{.State.OOMKilled}}'
# Recent restart history + exit codes:
docker inspect kokoro-tts --format '{{json .RestartCount}} {{json .State}}'
```

If it was OOM-killed, give the host more RAM (target ~4GB free for the
container), add swap, or move Kokoro to a bigger box / the GPU image. Because
`--restart unless-stopped` relaunches it instantly, the only outward symptom is
the restart — so check `OOMKilled` rather than assuming the model crashed.

### `Could not initialize NNPACK! Reason: Unsupported hardware.`

**Harmless — ignore it.** NNPACK is an optional CPU convolution accelerator.
It fails to initialize on CPUs missing certain instruction extensions or inside
some VMs; PyTorch then falls back to a slower code path and synthesis still
succeeds. In the container logs you'll see a `Got audio chunk ...` line right
after the warning, which is the proof it worked. It is not why TTS fails.

### The first listen takes a long time

Lectern synthesizes the **entire article up front** before playback starts (so
the audio can be cached, scrubbed, and replayed offline). A long article is
therefore minutes of speech rendered before the first second plays. The CPU
image generates at roughly real-time, so a 20-minute read takes on the order of
20 minutes to render the first time; after that it's cached and instant. To
speed up the initial render, use the **GPU image** or a CPU with more cores.
