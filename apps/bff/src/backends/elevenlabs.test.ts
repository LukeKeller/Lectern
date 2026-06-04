import { describe, expect, it, vi } from "vitest";
import { ElevenLabsBackend, chunkText } from "./elevenlabs";

describe("chunkText", () => {
  it("keeps short text as a single chunk", () => {
    expect(chunkText("One para.\n\nTwo para.", 1000)).toEqual(["One para.\n\nTwo para."]);
  });

  it("splits on paragraph boundaries to stay under the limit", () => {
    const a = "a".repeat(30);
    const b = "b".repeat(30);
    const c = "c".repeat(30);
    const chunks = chunkText(`${a}\n\n${b}\n\n${c}`, 70);
    expect(chunks.every((ch) => ch.length <= 70)).toBe(true);
    expect(chunks.join("")).toContain(a);
    expect(chunks.join("")).toContain(c);
  });

  it("hard-splits a single paragraph longer than the limit", () => {
    const chunks = chunkText("x".repeat(250), 100);
    expect(chunks.length).toBe(3);
    expect(chunks.every((ch) => ch.length <= 100)).toBe(true);
    expect(chunks.join("").length).toBe(250);
  });
});

describe("ElevenLabsBackend", () => {
  it("synthesizes each chunk and concatenates the audio in order", async () => {
    const fetchMock = vi.fn(async (_url: unknown, init?: { body?: string }) => {
      const text = JSON.parse(init!.body!).text as string;
      return new Response(new TextEncoder().encode(`[${text.length}]`), { status: 200 });
    });
    const tts = new ElevenLabsBackend({ fetch: fetchMock as unknown as typeof fetch });
    // eleven_v3's 4,800-char limit forces two paragraphs of 3,000 into 2 requests.
    const out = await tts.synthesize(`${"a".repeat(3000)}\n\n${"b".repeat(3000)}`, {
      apiKey: "k",
      voiceId: "v",
      modelId: "eleven_v3",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(out.toString()).toBe("[3000][3000]");
  });

  it("maps ElevenLabs voices to the contract shape", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ voices: [{ voice_id: "abc", name: "Rachel" }] }), {
          status: 200,
        }),
    );
    const tts = new ElevenLabsBackend({ fetch: fetchMock as unknown as typeof fetch });
    expect(await tts.listVoices("k")).toEqual([{ id: "abc", name: "Rachel" }]);
  });

  it("throws BackendHttpError on a non-2xx synth response", async () => {
    const fetchMock = vi.fn(async () => new Response("nope", { status: 401 }));
    const tts = new ElevenLabsBackend({ fetch: fetchMock as unknown as typeof fetch });
    await expect(
      tts.synthesize("hello", { apiKey: "bad", voiceId: "v", modelId: "eleven_flash_v2_5" }),
    ).rejects.toMatchObject({ status: 401 });
  });
});
