import { describe, expect, it } from "vitest";
import type { DiscoveryConfig } from "@lectern/shared";
import { createBraveFetcher } from "./brave";
import { DiscoveryHttpError, type FetchContext } from "./types";

const cfg: DiscoveryConfig = {
  enabled: true,
  topics: [],
  seedUrls: [],
  fetchers: { searxng: false, brave: true, crawl: false },
  schedule: "0 */6 * * *",
  searxngUrl: "",
  crawlDepth: 1,
  crawlTimeMs: 30000,
  rocchio: { a: 1, b: 0.75, c: 0.25 },
  targetCount: 5,
  braveApiKey: "secret-key",
  freshnessHalfLifeDays: 14,
  fullText: true,
  fullTextCandidates: 12,
  mutedDomains: [],
  followDismissed: [],
};

const ctx: FetchContext = { queries: ["rust"], seedUrls: [], limit: 50, timeBudgetMs: 30000, cfg };

const FIXTURE = {
  web: {
    results: [
      {
        url: "https://a.com/1",
        title: "One",
        description: "first",
        age: "2026-01-02",
        profile: { name: "A Site" },
        thumbnail: { src: "https://img/1.png" },
      },
      { title: "No URL — skipped" },
    ],
  },
};

describe("brave fetcher", () => {
  it("is enabled only with the toggle on and an api key set", () => {
    const f = createBraveFetcher();
    expect(f.enabled(cfg)).toBe(true);
    expect(f.enabled({ ...cfg, braveApiKey: "" })).toBe(false);
    expect(f.enabled({ ...cfg, fetchers: { ...cfg.fetchers, brave: false } })).toBe(false);
  });

  it("sends the subscription-token header and parses web.results", async () => {
    let sawToken = "";
    const fakeFetch = async (_url: string | URL | Request, init?: RequestInit) => {
      sawToken = new Headers(init?.headers).get("x-subscription-token") ?? "";
      return new Response(JSON.stringify(FIXTURE), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    const f = createBraveFetcher({ fetch: fakeFetch as unknown as typeof fetch });
    const out = await f.fetch(ctx);
    expect(sawToken).toBe("secret-key");
    expect(out).toEqual([
      {
        url: "https://a.com/1",
        title: "One",
        excerpt: "first",
        fetcher: "brave",
        siteName: "A Site",
        imageUrl: "https://img/1.png",
        publishedAt: "2026-01-02",
      },
    ]);
  });

  it("throws DiscoveryHttpError on a non-2xx response", async () => {
    const fakeFetch = async () => new Response("quota", { status: 429 });
    const f = createBraveFetcher({ fetch: fakeFetch as typeof fetch });
    await expect(f.fetch(ctx)).rejects.toBeInstanceOf(DiscoveryHttpError);
  });
});
