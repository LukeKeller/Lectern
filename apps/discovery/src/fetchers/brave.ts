import { DiscoveryHttpError, type Fetcher, type FetcherDeps, type RawCandidate } from "./types";

/**
 * Brave Search API fetcher. Queries the web-search endpoint once per keyword
 * query (bearer-style `X-Subscription-Token` header) and maps `web.results[]`.
 */

const BRAVE_ENDPOINT = "https://api.search.brave.com/res/v1/web/search";

interface BraveWebResult {
  url?: string;
  title?: string;
  description?: string;
  age?: string;
  profile?: { name?: string };
  thumbnail?: { src?: string };
}

interface BraveResponse {
  web?: { results?: BraveWebResult[] };
}

/** Construct a Brave fetcher, optionally with an injected `fetch` (tests). */
export function createBraveFetcher(deps: FetcherDeps = {}): Fetcher {
  const doFetch = deps.fetch ?? fetch;
  return {
    name: "brave",
    enabled: (cfg) => cfg.fetchers.brave && !!cfg.braveApiKey,
    async fetch(ctx) {
      const out: RawCandidate[] = [];
      for (const query of ctx.queries) {
        if (out.length >= ctx.limit) break;
        const url = `${BRAVE_ENDPOINT}?q=${encodeURIComponent(query)}`;
        const res = await doFetch(url, {
          headers: {
            accept: "application/json",
            "X-Subscription-Token": ctx.cfg.braveApiKey,
          },
        });
        if (!res.ok) {
          throw new DiscoveryHttpError("brave", res.status, `brave GET "${query}" -> ${res.status}`);
        }
        const body = (await res.json()) as BraveResponse;
        for (const r of body.web?.results ?? []) {
          if (!r.url) continue;
          out.push({
            url: r.url,
            title: r.title,
            excerpt: r.description,
            fetcher: "brave",
            siteName: r.profile?.name,
            imageUrl: r.thumbnail?.src,
            publishedAt: r.age,
          });
        }
      }
      return out.slice(0, ctx.limit);
    },
  };
}

/** Default instance used by the registry (real `fetch`). */
export const brave = createBraveFetcher();
