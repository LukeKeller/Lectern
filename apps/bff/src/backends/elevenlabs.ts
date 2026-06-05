import type { TtsVoice } from "@lectern/shared";
import { BackendHttpError } from "../errors";
import { chunkText } from "./chunk";

/**
 * ElevenLabs text-to-speech backend. Stateless w.r.t. credentials: the API key
 * is passed per call (it lives in the glue DB, never in the SPA). Synthesis is
 * only ever invoked from an explicit Listen action upstream — this adapter does
 * no caching or speculative work of its own.
 */

export interface SynthesizeOptions {
  apiKey: string;
  voiceId: string;
  modelId: string;
}

/** Account usage/quota for a key, normalized from ElevenLabs' subscription shape. */
export interface TtsUsageInfo {
  tier: string;
  status: string | null;
  characterCount: number;
  characterLimit: number;
  /** Epoch seconds when the period counter resets, or null if not reported. */
  nextResetUnix: number | null;
}

export interface TtsBackend {
  /** Synthesize speech for plain text, returning mp3 bytes (chunked + joined). */
  synthesize(text: string, opts: SynthesizeOptions): Promise<Buffer>;
  /** Voices available to the account/service behind `apiKey`. */
  listVoices(apiKey: string): Promise<TtsVoice[]>;
  /** Usage and quota for the account behind `apiKey`. Optional: only hosted
   * providers with a billed quota implement it (ElevenLabs); self-hosted
   * engines like Kokoro have none. */
  getUsage?(apiKey: string): Promise<TtsUsageInfo>;
}

const API = "https://api.elevenlabs.io/v1";

/** Per-request character ceiling by model (ElevenLabs limits, minus a margin). */
const MODEL_CHAR_LIMIT: Record<string, number> = {
  eleven_flash_v2_5: 38_000,
  eleven_flash_v2: 28_000,
  eleven_multilingual_v2: 9_500,
  eleven_v3: 4_800,
};
const DEFAULT_CHUNK = 9_000;
/** Hard ceiling on total characters per document, to bound runaway spend. */
const MAX_TOTAL_CHARS = 200_000;

export class ElevenLabsBackend implements TtsBackend {
  private readonly doFetch: typeof fetch;

  constructor(opts: { fetch?: typeof fetch } = {}) {
    this.doFetch = opts.fetch ?? fetch;
  }

  async synthesize(text: string, opts: SynthesizeOptions): Promise<Buffer> {
    const limit = MODEL_CHAR_LIMIT[opts.modelId] ?? DEFAULT_CHUNK;
    const chunks = chunkText(text.slice(0, MAX_TOTAL_CHARS), limit);
    if (chunks.length === 0)
      throw new BackendHttpError("elevenlabs", 422, null, "nothing to synthesize");
    const buffers: Buffer[] = [];
    // Sequential: bounds concurrent spend and preserves chunk order for joining.
    for (const chunk of chunks) buffers.push(await this.synthChunk(chunk, opts));
    return Buffer.concat(buffers);
  }

  private async synthChunk(text: string, opts: SynthesizeOptions): Promise<Buffer> {
    const url = `${API}/text-to-speech/${encodeURIComponent(opts.voiceId)}?output_format=mp3_44100_128`;
    const res = await this.doFetch(url, {
      method: "POST",
      headers: {
        "xi-api-key": opts.apiKey,
        "content-type": "application/json",
        accept: "audio/mpeg",
      },
      body: JSON.stringify({ text, model_id: opts.modelId }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new BackendHttpError(
        "elevenlabs",
        res.status,
        res.headers.get("retry-after"),
        `text-to-speech failed: ${res.status} ${body.slice(0, 200)}`,
      );
    }
    return Buffer.from(await res.arrayBuffer());
  }

  async listVoices(apiKey: string): Promise<TtsVoice[]> {
    const res = await this.doFetch(`${API}/voices`, { headers: { "xi-api-key": apiKey } });
    if (!res.ok) {
      throw new BackendHttpError(
        "elevenlabs",
        res.status,
        res.headers.get("retry-after"),
        `list voices failed: ${res.status}`,
      );
    }
    const data = (await res.json()) as { voices?: { voice_id: string; name?: string }[] };
    return (data.voices ?? []).map((v) => ({ id: v.voice_id, name: v.name ?? v.voice_id }));
  }

  async getUsage(apiKey: string): Promise<TtsUsageInfo> {
    const res = await this.doFetch(`${API}/user/subscription`, {
      headers: { "xi-api-key": apiKey },
    });
    if (!res.ok) {
      throw new BackendHttpError(
        "elevenlabs",
        res.status,
        res.headers.get("retry-after"),
        `get usage failed: ${res.status}`,
      );
    }
    const data = (await res.json()) as {
      tier?: string;
      status?: string;
      character_count?: number;
      character_limit?: number;
      next_character_count_reset_unix?: number;
    };
    return {
      tier: data.tier ?? "unknown",
      status: data.status ?? null,
      characterCount: data.character_count ?? 0,
      characterLimit: data.character_limit ?? 0,
      nextResetUnix: data.next_character_count_reset_unix ?? null,
    };
  }
}
