# Self-hosted text-to-speech with Piper

Lectern can read articles aloud. Three providers are supported:

- **ElevenLabs** — cloud, high quality. Just set an API key on the in-app
  **Settings > Listen** page. No server configuration needed.
- **Kokoro (self-hosted)** — free, runs on your own hardware via a Docker
  container. See [kokoro-tts.md](kokoro-tts.md).
- **Piper (self-hosted)** — free, lightweight, CPU-only. Much smaller and
  faster than Kokoro, which makes it a good fit for minimal VPS hardware. This
  document covers setting that up.

## What Piper is

[Piper](https://github.com/OHF-Voice/piper1-gpl) (OHF-Voice `piper1-gpl`) is a
fast, local neural TTS engine. It runs entirely on the CPU and is far lighter
than Kokoro — no GPU, no multi-gigabyte container — so it comfortably runs
alongside Lectern on a small server. Lectern's BFF talks to Piper's HTTP server
over HTTP, POSTing to `/synthesize` and reading `/voices` on the configured base
URL, then **transcodes Piper's WAV output to mp3**. It runs as a **separate
sibling HTTP service** — it is not bundled into the YunoHost package; you run it
yourself.

## Requirements

- **ffmpeg** must be installed on the server. The BFF shells out to it to
  transcode Piper's WAV output to mp3. On Debian/Ubuntu:

  ```bash
  sudo apt-get install -y ffmpeg
  ```

- **Python 3** with `pip`. A virtualenv is recommended so Piper's dependencies
  stay isolated from the system Python.

## Install Piper

Install into a virtualenv (recommended):

```bash
python3 -m venv /opt/piper/venv
/opt/piper/venv/bin/pip install piper-tts
```

Or install it directly for the current user:

```bash
pip install piper-tts
```

The commands below use `python3 -m piper...`; if you used the venv above,
substitute `/opt/piper/venv/bin/python3` for `python3`.

## Download a voice

Each voice is an `.onnx` model plus an `.onnx.json` config, fetched from
HuggingFace into a data directory. Download the default English voice:

```bash
python3 -m piper.download_voices en_US-lessac-medium --data-dir /opt/piper/voices
```

`en_US-lessac-medium` is a good, natural-sounding default. You can download
additional voices the same way — pass a different voice name.

## Run the HTTP server

Point the server at the voice and data directory, and bind it to localhost:

```bash
python3 -m piper.http_server \
  -m en_US-lessac-medium \
  --data-dir /opt/piper/voices \
  --host 127.0.0.1 \
  --port 5000
```

Binding to `127.0.0.1` keeps the service reachable only from the local host,
which is what Lectern expects with the default configuration.

### Run it as a systemd service (recommended)

So it starts on boot and restarts on failure, drop a unit at
`/etc/systemd/system/piper-tts.service`:

```ini
[Unit]
Description=Piper TTS HTTP server
After=network.target

[Service]
Type=simple
ExecStart=/opt/piper/venv/bin/python3 -m piper.http_server \
  -m en_US-lessac-medium \
  --data-dir /opt/piper/voices \
  --host 127.0.0.1 \
  --port 5000
Restart=on-failure
DynamicUser=yes
StateDirectory=piper

[Install]
WantedBy=multi-user.target
```

Then enable and start it:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now piper-tts
```

(Adjust `ExecStart` to plain `python3` if you installed Piper system-wide rather
than in a venv, and make sure `--data-dir` points at wherever you downloaded the
voice.)

If you'd rather not use systemd, you can run the server as a simple background
process instead:

```bash
nohup python3 -m piper.http_server -m en_US-lessac-medium \
  --data-dir /opt/piper/voices --host 127.0.0.1 --port 5000 \
  > /var/log/piper-tts.log 2>&1 &
```

## Verify it's up

List the available voices:

```bash
curl http://127.0.0.1:5000/voices
```

Synthesize a short clip:

```bash
curl -X POST -H 'Content-Type: application/json' \
  -d '{"text":"hello"}' \
  -o test.wav http://127.0.0.1:5000/synthesize
```

A JSON list of voices and a playable `test.wav` mean the service is running and
reachable.

## Resource expectations

- **Very lightweight** — Piper is CPU-only and uses far less memory than
  Kokoro's ~2GB. It's designed to run on modest hardware, which is the main
  reason to prefer it on a small VPS.
- **No GPU required.** Synthesis pegs a CPU core briefly, but Lectern caches
  generated audio, so a given article is only synthesized once; replays are
  served from cache.

## Point Lectern at it

The base URL is held in the `PIPER_BASE_URL` environment variable, rendered into
the app's `.env` from the `piper_base_url` YunoHost app setting. Default:
`http://127.0.0.1:5000`.

You normally don't need to change it. To override it (for example if Piper runs
on another host or port), set it in the YunoHost admin:

**Applications > Lectern > Config panel > Text-to-speech > Piper base URL.**

Saving the panel re-renders `.env` and restarts Lectern automatically — no
upgrade or SSH needed.

## Select it in the app

Finally, open the in-app **Settings > Listen** section and choose **Piper** as
the provider. Articles will then be read using your local Piper service.
