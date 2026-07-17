import { spawn } from "node:child_process";
import type { TtsVoice } from "@lectern/shared";
import { BackendHttpError } from "../errors";
import { chunkText } from "./chunk";
import type { SynthesizeOptions, TtsBackend } from "./elevenlabs";

/**
 * Self-hosted Piper backend. Piper (OHF-Voice piper1-gpl) is a fast open-weight
 * TTS engine the operator runs as a sibling HTTP service, reachable at `baseUrl`
 * (`python3 -m piper.http_server -m <voice> --data-dir <dir> --host 127.0.0.1
 * --port 5000`). No API key, no quota — `opts.apiKey`/`opts.modelId` are ignored;
 * the service URL is server config (`PIPER_BASE_URL`), never the SPA.
 *
 * Piper's synth endpoint (`POST /`) returns WAV, but the rest of the pipeline
 * (cache, podcast feed) assumes mp3. So each chunk's WAV is transcoded via `ffmpeg`
 * before
 * the parts are joined. WAV files carry a 44-byte header and can't be naively
 * concatenated; mp3 frames join cleanly, so we transcode per chunk then concat
 * the mp3 parts (mirroring how the other backends concatenate mp3 responses).
 */

/** Per-request character ceiling. Piper has no hard limit, but bounding the
 * request keeps each synth quick and the whole-response read responsive. */
const CHUNK_LIMIT = 2_000;
/** Hard ceiling on total characters per document, to bound synthesis time. */
const MAX_TOTAL_CHARS = 200_000;

/**
 * Default transcoder: spawns the system `ffmpeg`, pipes WAV bytes to stdin and
 * reads mp3 from stdout. A non-zero exit or a spawn error (ffmpeg missing)
 * rejects with a `BackendHttpError` naming ffmpeg.
 */
function ffmpegTranscode(wav: Buffer): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const proc = spawn("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      "pipe:0",
      "-f",
      "mp3",
      "-codec:a",
      "libmp3lame",
      "-b:a",
      "128k",
      "pipe:1",
    ]);
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    proc.stdout.on("data", (d: Buffer) => out.push(d));
    proc.stderr.on("data", (d: Buffer) => err.push(d));
    proc.on("error", (e) =>
      reject(
        new BackendHttpError(
          "piper",
          500,
          null,
          `ffmpeg transcode failed to start (is ffmpeg installed?): ${e.message}`,
        ),
      ),
    );
    proc.on("close", (code) => {
      if (code === 0) resolve(Buffer.concat(out));
      else
        reject(
          new BackendHttpError(
            "piper",
            500,
            null,
            `ffmpeg transcode exited ${code}: ${Buffer.concat(err).toString().slice(0, 200)}`,
          ),
        );
    });
    proc.stdin.on("error", () => {
      /* ffmpeg may close stdin early on error; the close handler reports it. */
    });
    proc.stdin.end(wav);
  });
}

export class PiperBackend implements TtsBackend {
  private readonly baseUrl: string;
  private readonly doFetch: typeof fetch;
  private readonly transcode: (wav: Buffer) => Promise<Buffer>;

  constructor(opts: {
    baseUrl: string;
    fetch?: typeof fetch;
    transcode?: (wav: Buffer) => Promise<Buffer>;
  }) {
    // Trim a trailing slash so the request paths below never double up.
    this.baseUrl = opts.baseUrl.replace(/\/$/, "");
    this.doFetch = opts.fetch ?? fetch;
    this.transcode = opts.transcode ?? ffmpegTranscode;
  }

  async synthesize(text: string, opts: SynthesizeOptions): Promise<Buffer> {
    const chunks = chunkText(text.slice(0, MAX_TOTAL_CHARS), CHUNK_LIMIT);
    if (chunks.length === 0)
      throw new BackendHttpError("piper", 422, null, "nothing to synthesize");
    const buffers: Buffer[] = [];
    // Sequential: bounds load on the local service and preserves chunk order.
    // Each WAV is transcoded to mp3 before joining (WAV headers don't concat).
    for (const chunk of chunks) buffers.push(await this.synthChunk(chunk, opts));
    return Buffer.concat(buffers);
  }

  private async synthChunk(text: string, opts: SynthesizeOptions): Promise<Buffer> {
    // piper.http_server synthesizes on the root route (`POST /`), returning a WAV.
    const res = await this.doFetch(`${this.baseUrl}/`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "audio/wav" },
      body: JSON.stringify({ text, voice: opts.voiceId }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new BackendHttpError(
        "piper",
        res.status,
        res.headers.get("retry-after"),
        `text-to-speech failed: ${res.status} ${body.slice(0, 200)}`,
      );
    }
    const wav = Buffer.from(await res.arrayBuffer());
    // Transcode WAV → mp3 so downstream (cache, podcast feed) gets mp3 bytes.
    return this.transcode(wav);
  }

  async listVoices(): Promise<TtsVoice[]> {
    const res = await this.doFetch(`${this.baseUrl}/voices`);
    if (!res.ok) {
      throw new BackendHttpError(
        "piper",
        res.status,
        res.headers.get("retry-after"),
        `list voices failed: ${res.status}`,
      );
    }
    const data = (await res.json()) as unknown;
    return mapVoices(data);
  }
}

/**
 * Map Piper's `/voices` response to the contract shape defensively — the
 * installed-voice listing shape can vary. Handles: a plain array of ids/objects,
 * and the documented object keyed by voice id (each value carrying `key`/`name`/
 * `language`). If a value can't be confidently mapped, the object key is used as
 * both id and name.
 */
function mapVoices(data: unknown): TtsVoice[] {
  if (Array.isArray(data)) {
    return data.map((v) => {
      if (typeof v === "string") return { id: v, name: v };
      const o = (v ?? {}) as Record<string, unknown>;
      const id = pickString(o.key) ?? pickString(o.id) ?? pickString(o.name) ?? "";
      return { id, name: pickString(o.name) ?? id };
    });
  }
  if (data && typeof data === "object") {
    return Object.entries(data as Record<string, unknown>).map(([key, val]) => {
      const o = (val ?? {}) as Record<string, unknown>;
      const name =
        (typeof val === "object" && val !== null ? pickString(o.name) : undefined) ?? key;
      const id =
        (typeof val === "object" && val !== null
          ? (pickString(o.key) ?? pickString(o.id))
          : undefined) ?? key;
      return { id, name };
    });
  }
  return [];
}

function pickString(v: unknown): string | undefined {
  return typeof v === "string" && v ? v : undefined;
}
