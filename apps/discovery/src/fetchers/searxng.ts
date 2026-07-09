import http from "node:http";
import { isoOrUndefined } from "./dates";
import { DiscoveryHttpError, type Fetcher, type FetcherDeps, type RawCandidate } from "./types";

/**
 * SearXNG metasearch fetcher. Queries a self-hosted SearXNG instance's JSON API
 * once per keyword query and maps the flat `results[]` array to candidates.
 *
 * The instance can be addressed two ways via `cfg.searxngUrl`:
 *  - a normal `http(s)://host[:port]` base URL, or
 *  - `unix:/path/to/socket` (e.g. `unix:/run/searxng.sock`) to talk to a
 *    unix-socket instance over loopback — used when SearXNG runs as a sibling
 *    service that binds a socket (e.g. the YunoHost package's gunicorn socket),
 *    so we bypass the public, SSO-gated vhost entirely.
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

export type SearxngTarget = { mode: "http"; base: string } | { mode: "unix"; socketPath: string };

/** Classify a `searxngUrl` setting into an HTTP base URL or a unix socket path. */
export function parseSearxngTarget(searxngUrl: string): SearxngTarget {
  const trimmed = searxngUrl.trim();
  // unix:/run/searxng.sock  or  unix:///run/searxng.sock
  const m = /^unix:(?:\/\/)?(\/.*)$/.exec(trimmed);
  if (m?.[1]) return { mode: "unix", socketPath: m[1] };
  return { mode: "http", base: trimmed.replace(/\/+$/, "") };
}

/** GET JSON from a SearXNG instance over a unix socket (built-in http). */
function getJsonOverSocket(socketPath: string, path: string): Promise<SearxngResponse> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        socketPath,
        path,
        method: "GET",
        headers: { accept: "application/json", host: "localhost" },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          if (status < 200 || status >= 300) {
            reject(new DiscoveryHttpError("searxng", status, `searxng (unix) -> ${status}`));
            return;
          }
          try {
            resolve(JSON.parse(data) as SearxngResponse);
          } catch {
            reject(new DiscoveryHttpError("searxng", status, "searxng (unix) returned non-JSON"));
          }
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

/** Construct a SearXNG fetcher, optionally with an injected `fetch` (tests). */
export function createSearxngFetcher(deps: FetcherDeps = {}): Fetcher {
  const doFetch = deps.fetch ?? fetch;
  return {
    name: "searxng",
    enabled: (cfg) => cfg.fetchers.searxng && !!cfg.searxngUrl,
    async fetch(ctx) {
      const out: RawCandidate[] = [];
      const target = parseSearxngTarget(ctx.cfg.searxngUrl);
      for (const query of ctx.queries) {
        if (out.length >= ctx.limit) break;
        const path = `/search?format=json&q=${encodeURIComponent(query)}`;
        let body: SearxngResponse;
        if (target.mode === "unix") {
          body = await getJsonOverSocket(target.socketPath, path);
        } else {
          const res = await doFetch(`${target.base}${path}`, {
            headers: { accept: "application/json" },
          });
          if (!res.ok) {
            throw new DiscoveryHttpError(
              "searxng",
              res.status,
              `searxng GET "${query}" -> ${res.status}`,
            );
          }
          body = (await res.json()) as SearxngResponse;
        }
        for (const r of body.results ?? []) {
          if (!r.url) continue;
          out.push({
            url: r.url,
            title: r.title,
            excerpt: r.content,
            fetcher: "searxng",
            // Keep only parseable ISO dates; drop anything else so the scorer's
            // freshness decay never chokes on a bad string.
            publishedAt: isoOrUndefined(r.publishedDate),
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
