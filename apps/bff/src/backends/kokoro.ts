import type { TtsVoice } from "@lectern/shared";
import { BackendHttpError } from "../errors";
import { chunkText } from "./chunk";
import type { SynthesizeOptions, TtsBackend } from "./elevenlabs";

/**
 * Self-hosted Kokoro-FastAPI backend. Kokoro is a small open-weight TTS model the
 * operator runs as a sibling service (Docker), reachable at `baseUrl`. The server
 * speaks the OpenAI audio API (`POST /v1/audio/speech`, `GET /v1/audio/voices`),
 * so this adapter is a thin HTTP client. No API key, no quota — `opts.apiKey` is
 * ignored; the service URL is server config (`KOKORO_BASE_URL`), never the SPA.
 */

/** Per-request character ceiling. Kokoro has no hard limit, but bounding the
 * request keeps each synth quick and the whole-response read responsive. */
const CHUNK_LIMIT = 2_000;
/** Hard ceiling on total characters per document, to bound synthesis time. */
const MAX_TOTAL_CHARS = 200_000;

export class KokoroBackend implements TtsBackend {
  private readonly baseUrl: string;
  private readonly doFetch: typeof fetch;

  constructor(opts: { baseUrl: string; fetch?: typeof fetch }) {
    // Trim a trailing slash so `${baseUrl}/v1/...` never doubles up.
    this.baseUrl = opts.baseUrl.replace(/\/$/, "");
    this.doFetch = opts.fetch ?? fetch;
  }

  async synthesize(text: string, opts: SynthesizeOptions): Promise<Buffer> {
    const chunks = chunkText(text.slice(0, MAX_TOTAL_CHARS), CHUNK_LIMIT);
    if (chunks.length === 0)
      throw new BackendHttpError("kokoro", 422, null, "nothing to synthesize");
    const buffers: Buffer[] = [];
    // Sequential: bounds load on the local service and preserves chunk order.
    for (const chunk of chunks) buffers.push(await this.synthChunk(chunk, opts));
    return Buffer.concat(buffers);
  }

  private async synthChunk(text: string, opts: SynthesizeOptions): Promise<Buffer> {
    const res = await this.doFetch(`${this.baseUrl}/v1/audio/speech`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "audio/mpeg" },
      body: JSON.stringify({
        model: "kokoro",
        input: text,
        voice: opts.voiceId,
        response_format: "mp3",
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new BackendHttpError(
        "kokoro",
        res.status,
        res.headers.get("retry-after"),
        `text-to-speech failed: ${res.status} ${body.slice(0, 200)}`,
      );
    }
    return Buffer.from(await res.arrayBuffer());
  }

  async listVoices(): Promise<TtsVoice[]> {
    const res = await this.doFetch(`${this.baseUrl}/v1/audio/voices`);
    if (!res.ok) {
      throw new BackendHttpError(
        "kokoro",
        res.status,
        res.headers.get("retry-after"),
        `list voices failed: ${res.status}`,
      );
    }
    const data = (await res.json()) as { voices?: string[] };
    return (data.voices ?? []).map((v) => ({ id: v, name: v }));
  }
}
