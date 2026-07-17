import { describe, expect, it, vi } from "vitest";
import { BackendHttpError } from "../errors";
import { PiperBackend } from "./piper";

// Injected transcode stub: encodes the WAV byte length so tests can assert the
// per-chunk WAV → mp3 path ran and the mp3 parts were concatenated in order.
const fakeTranscode = async (wav: Buffer) => Buffer.from(`mp3:${wav.length};`);

describe("PiperBackend", () => {
  it("posts to the root synth route per chunk and concatenates transcoded mp3 parts", async () => {
    const seen: { url: string; body: Record<string, unknown> }[] = [];
    const fetchMock = vi.fn(async (url: unknown, init?: { body?: string }) => {
      const body = JSON.parse(init!.body!) as Record<string, unknown>;
      seen.push({ url: String(url), body });
      // Fake WAV bytes whose length reflects the chunk text length.
      return new Response(new Uint8Array((body.text as string).length), { status: 200 });
    });
    const tts = new PiperBackend({
      baseUrl: "http://piper:5000/",
      fetch: fetchMock as unknown as typeof fetch,
      transcode: fakeTranscode,
    });
    // Two 1,500-char paragraphs exceed the 2,000-char chunk limit → 2 requests.
    const out = await tts.synthesize(`${"a".repeat(1500)}\n\n${"b".repeat(1500)}`, {
      apiKey: "",
      voiceId: "en_US-lessac-medium",
      modelId: "",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // Each 1500-byte WAV is transcoded individually then concatenated.
    expect(out.toString()).toBe("mp3:1500;mp3:1500;");
    // Trailing slash on baseUrl is trimmed; posts to the root synth route.
    expect(seen[0]!.url).toBe("http://piper:5000/");
    expect(seen[0]!.body).toMatchObject({
      voice: "en_US-lessac-medium",
      text: "a".repeat(1500),
    });
  });

  it("maps an object-keyed /voices response to the contract shape", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            "en_US-lessac-medium": {
              key: "en_US-lessac-medium",
              name: "Lessac (medium)",
              language: "en_US",
            },
            "en_GB-alan-low": { key: "en_GB-alan-low", language: "en_GB" },
          }),
          { status: 200 },
        ),
    );
    const tts = new PiperBackend({
      baseUrl: "http://piper:5000",
      fetch: fetchMock as unknown as typeof fetch,
      transcode: fakeTranscode,
    });
    expect(await tts.listVoices()).toEqual([
      { id: "en_US-lessac-medium", name: "Lessac (medium)" },
      // No name field → key used as both id and name.
      { id: "en_GB-alan-low", name: "en_GB-alan-low" },
    ]);
  });

  it("maps a plain-array /voices response", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify(["en_US-lessac-medium"]), { status: 200 }),
    );
    const tts = new PiperBackend({
      baseUrl: "http://piper:5000",
      fetch: fetchMock as unknown as typeof fetch,
      transcode: fakeTranscode,
    });
    expect(await tts.listVoices()).toEqual([
      { id: "en_US-lessac-medium", name: "en_US-lessac-medium" },
    ]);
  });

  it("throws BackendHttpError on a non-2xx synth response", async () => {
    const fetchMock = vi.fn(async () => new Response("down", { status: 503 }));
    const tts = new PiperBackend({
      baseUrl: "http://piper:5000",
      fetch: fetchMock as unknown as typeof fetch,
      transcode: fakeTranscode,
    });
    await expect(
      tts.synthesize("hello", { apiKey: "", voiceId: "en_US-lessac-medium", modelId: "" }),
    ).rejects.toMatchObject({ status: 503 });
  });

  it("surfaces a rejecting transcode as a BackendHttpError", async () => {
    const fetchMock = vi.fn(
      async () => new Response(new Uint8Array(10), { status: 200 }),
    );
    const failingTranscode = async () => {
      throw new BackendHttpError(
        "piper",
        500,
        null,
        "ffmpeg transcode failed to start (is ffmpeg installed?)",
      );
    };
    const tts = new PiperBackend({
      baseUrl: "http://piper:5000",
      fetch: fetchMock as unknown as typeof fetch,
      transcode: failingTranscode,
    });
    await expect(
      tts.synthesize("hello", { apiKey: "", voiceId: "en_US-lessac-medium", modelId: "" }),
    ).rejects.toMatchObject({ backend: "piper", status: 500 });
  });
});
