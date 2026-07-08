import { describe, expect, it } from "vitest";
import type { DiscoveryConfig } from "@lectern/shared";
import { createSearxngFetcher, parseSearxngTarget } from "./searxng";
import { DiscoveryHttpError, type FetchContext } from "./types";

const cfg: DiscoveryConfig = {
  enabled: true,
  topics: [],
  seedUrls: [],
  fetchers: { searxng: true, brave: false, crawl: false },
  schedule: "0 */6 * * *",
  searxngUrl: "http://searx.local",
  crawlDepth: 1,
  crawlTimeMs: 30000,
  rocchio: { a: 1, b: 0.75, c: 0.25 },
  targetCount: 5,
  braveApiKey: "",
};

const ctx: FetchContext = { queries: ["rust"], seedUrls: [], limit: 50, timeBudgetMs: 30000, cfg };

const FIXTURE = {
  results: [
    { url: "https://a.com/1", title: "One", content: "first result", engine: "duckduckgo" },
    { url: "https://b.com/2", title: "Two", content: "second result", publishedDate: "2026-01-01" },
    { title: "No URL — skipped", content: "ignored" },
  ],
};

describe("searxng fetcher", () => {
  it("is enabled only with the toggle on and a URL set", () => {
    const f = createSearxngFetcher();
    expect(f.enabled(cfg)).toBe(true);
    expect(f.enabled({ ...cfg, searxngUrl: "" })).toBe(false);
    expect(f.enabled({ ...cfg, fetchers: { ...cfg.fetchers, searxng: false } })).toBe(false);
  });

  it("parses the JSON fixture into RawCandidate[]", async () => {
    const fakeFetch = async () =>
      new Response(JSON.stringify(FIXTURE), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    const f = createSearxngFetcher({ fetch: fakeFetch as typeof fetch });
    const out = await f.fetch(ctx);
    expect(out).toEqual([
      { url: "https://a.com/1", title: "One", excerpt: "first result", fetcher: "searxng", publishedAt: undefined, siteName: "duckduckgo" },
      { url: "https://b.com/2", title: "Two", excerpt: "second result", fetcher: "searxng", publishedAt: "2026-01-01", siteName: undefined },
    ]);
  });

  it("throws DiscoveryHttpError on a non-2xx response", async () => {
    const fakeFetch = async () => new Response("nope", { status: 502 });
    const f = createSearxngFetcher({ fetch: fakeFetch as typeof fetch });
    await expect(f.fetch(ctx)).rejects.toBeInstanceOf(DiscoveryHttpError);
  });
});

describe("parseSearxngTarget", () => {
  it("treats http(s) URLs as an HTTP base (trailing slash trimmed)", () => {
    expect(parseSearxngTarget("http://searx.local/")).toEqual({
      mode: "http",
      base: "http://searx.local",
    });
    expect(parseSearxngTarget("https://s.example.com:8080")).toEqual({
      mode: "http",
      base: "https://s.example.com:8080",
    });
  });

  it("parses a unix socket target (with or without //)", () => {
    expect(parseSearxngTarget("unix:/run/searxng.sock")).toEqual({
      mode: "unix",
      socketPath: "/run/searxng.sock",
    });
    expect(parseSearxngTarget("unix:///run/searxng.sock")).toEqual({
      mode: "unix",
      socketPath: "/run/searxng.sock",
    });
  });
});
