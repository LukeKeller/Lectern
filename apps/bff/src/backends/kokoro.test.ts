import { describe, expect, it, vi } from "vitest";
import { KokoroBackend } from "./kokoro";

describe("KokoroBackend", () => {
  it("posts OpenAI-shaped speech requests and concatenates chunk audio", async () => {
    const seen: { url: string; body: Record<string, unknown> }[] = [];
    const fetchMock = vi.fn(async (url: unknown, init?: { body?: string }) => {
      const body = JSON.parse(init!.body!) as Record<string, unknown>;
      seen.push({ url: String(url), body });
      return new Response(new TextEncoder().encode(`[${(body.input as string).length}]`), {
        status: 200,
      });
    });
    const tts = new KokoroBackend({
      baseUrl: "http://kokoro:8880/",
      fetch: fetchMock as unknown as typeof fetch,
    });
    // Two 1,500-char paragraphs exceed the 2,000-char chunk limit → 2 requests.
    const out = await tts.synthesize(`${"a".repeat(1500)}\n\n${"b".repeat(1500)}`, {
      apiKey: "",
      voiceId: "af_heart",
      modelId: "kokoro",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(out.toString()).toBe("[1500][1500]");
    // Trailing slash on baseUrl is trimmed; OpenAI path + voice are forwarded.
    expect(seen[0]!.url).toBe("http://kokoro:8880/v1/audio/speech");
    expect(seen[0]!.body).toMatchObject({
      model: "kokoro",
      voice: "af_heart",
      response_format: "mp3",
    });
  });

  it("maps the Kokoro voices list to the contract shape", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ voices: ["af_heart", "am_adam"] }), { status: 200 }),
    );
    const tts = new KokoroBackend({
      baseUrl: "http://kokoro:8880",
      fetch: fetchMock as unknown as typeof fetch,
    });
    expect(await tts.listVoices()).toEqual([
      { id: "af_heart", name: "af_heart" },
      { id: "am_adam", name: "am_adam" },
    ]);
  });

  it("throws BackendHttpError on a non-2xx synth response", async () => {
    const fetchMock = vi.fn(async () => new Response("down", { status: 503 }));
    const tts = new KokoroBackend({
      baseUrl: "http://kokoro:8880",
      fetch: fetchMock as unknown as typeof fetch,
    });
    await expect(
      tts.synthesize("hello", { apiKey: "", voiceId: "af_heart", modelId: "kokoro" }),
    ).rejects.toMatchObject({ status: 503 });
  });
});
