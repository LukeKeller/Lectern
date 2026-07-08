import { DiscoveryHttpError, type Fetcher, type FetcherDeps, type RawCandidate } from "./types";

/**
 * SearXNG metasearch fetcher. Queries a self-hosted SearXNG instance's JSON API
 * once per keyword query and maps the flat `results[]` array to candidates.
 */

interface SearxngResult {
  url?: string;
  title?: string;
  content?: string;
  publishedDate?: string | null;
  engine?: string;
}

interface SearxngResponse {
  results?: SearxngResult[];
}

/** Construct a SearXNG fetcher, optionally with an injected `fetch` (tests). */
export function createSearxngFetcher(deps: FetcherDeps = {}): Fetcher {
  const doFetch = deps.fetch ?? fetch;
  return {
    name: "searxng",
    enabled: (cfg) => cfg.fetchers.searxng && !!cfg.searxngUrl,
    async fetch(ctx) {
      const out: RawCandidate[] = [];
      const base = ctx.cfg.searxngUrl.replace(/\/+$/, "");
      for (const query of ctx.queries) {
        if (out.length >= ctx.limit) break;
        const url = `${base}/search?format=json&q=${encodeURIComponent(query)}`;
        const res = await doFetch(url, { headers: { accept: "application/json" } });
        if (!res.ok) {
          throw new DiscoveryHttpError("searxng", res.status, `searxng GET "${query}" -> ${res.status}`);
        }
        const body = (await res.json()) as SearxngResponse;
        for (const r of body.results ?? []) {
          if (!r.url) continue;
          out.push({
            url: r.url,
            title: r.title,
            excerpt: r.content,
            fetcher: "searxng",
            publishedAt: r.publishedDate ?? undefined,
            siteName: r.engine,
          });
        }
      }
      return out.slice(0, ctx.limit);
    },
  };
}

/** Default instance used by the registry (real `fetch`). */
export const searxng = createSearxngFetcher();
