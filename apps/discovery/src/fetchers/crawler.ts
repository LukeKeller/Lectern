import { normalizeUrl } from "../dedupe";
import { type Fetcher, type FetcherDeps, type RawCandidate } from "./types";

/**
 * Bounded breadth-first crawler. Starting from the configured seed URLs it
 * fetches each page, emits the page itself as a candidate (title from <title>,
 * excerpt from the meta description), then enqueues its article-like outbound
 * links up to `crawlDepth`. Bounded three ways so it can never run away:
 *   - a hard wall-clock deadline (min of the run budget and cfg.crawlTimeMs),
 *   - a per-host visit cap, and
 *   - the candidate `limit`.
 */

/** Max pages fetched from any single host in one run. */
const PER_HOST_CAP = 15;

/** Extensions that are clearly not article pages. */
const NON_ARTICLE_EXT = /\.(?:png|jpe?g|gif|webp|svg|ico|css|js|mjs|json|xml|rss|pdf|zip|gz|mp4|mp3|woff2?|ttf)(?:$|\?)/i;

/** Social networks / profile silos — never article content. */
const SOCIAL_HOST = /(?:^|\.)(?:bsky\.app|twitter\.com|x\.com|facebook\.com|instagram\.com|linkedin\.com|youtube\.com|youtu\.be|reddit\.com|tiktok\.com|threads\.net|t\.me|hachyderm\.io|mstdn\.social)$/i;

/** Profile/user paths (mastodon @handles, /profile/, /user/, /author/). */
const PROFILE_PATH = /\/(?:@|profile|profiles|user|users|author|authors)(?:\/|$)/i;

/** True when a URL looks like real article content (not a social/profile page). */
function isArticleLike(u: URL): boolean {
  if (SOCIAL_HOST.test(u.host)) return false;
  if (u.pathname.startsWith("/@")) return false;
  if (PROFILE_PATH.test(u.pathname)) return false;
  return true;
}

function extractTitle(html: string): string | undefined {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m?.[1] ? decodeEntities(m[1].trim()) : undefined;
}

function extractMetaDescription(html: string): string | undefined {
  // Match name="description" OR property="og:description" in either attr order.
  const patterns = [
    /<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i,
    /<meta[^>]+content=["']([^"']*)["'][^>]*name=["']description["']/i,
    /<meta[^>]+property=["']og:description["'][^>]*content=["']([^"']*)["']/i,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]) return decodeEntities(m[1].trim());
  }
  return undefined;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

/** Absolute, article-like links found in `<a href>` on the page. */
function extractLinks(html: string, base: string): string[] {
  const out: string[] = [];
  const re = /<a\s[^>]*href=["']([^"'#]+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const href = m[1];
    if (!href) continue;
    try {
      const absUrl = new URL(href, base);
      const abs = absUrl.toString();
      if (!/^https?:/i.test(abs)) continue;
      if (NON_ARTICLE_EXT.test(abs)) continue;
      // Skip social/profile pages (bsky, mastodon @handles, /user/, …).
      if (!isArticleLike(absUrl)) continue;
      // Article-like: has a non-trivial path (more than just "/").
      if (absUrl.pathname.replace(/\/+$/, "").length <= 1) continue;
      out.push(abs);
    } catch {
      // ignore malformed hrefs
    }
  }
  return out;
}

interface QueueItem {
  url: string;
  depth: number;
}

/** Construct a crawler fetcher, optionally with an injected `fetch` (tests). */
export function createCrawlerFetcher(deps: FetcherDeps = {}): Fetcher {
  const doFetch = deps.fetch ?? fetch;
  return {
    name: "crawl",
    enabled: (cfg) => cfg.fetchers.crawl && cfg.seedUrls.length > 0,
    async fetch(ctx) {
      const deadline = Date.now() + Math.min(ctx.timeBudgetMs, ctx.cfg.crawlTimeMs);
      const maxDepth = ctx.cfg.crawlDepth;
      const hostVisits = new Map<string, number>();
      const seen = new Set<string>();
      const out: RawCandidate[] = [];
      const queue: QueueItem[] = ctx.seedUrls.map((url) => ({ url, depth: 0 }));

      while (queue.length > 0) {
        if (Date.now() >= deadline || out.length >= ctx.limit) break;
        const item = queue.shift();
        if (!item) break;

        const key = normalizeUrl(item.url);
        if (seen.has(key)) continue;
        seen.add(key);

        let host: string;
        try {
          host = new URL(item.url).host;
        } catch {
          continue;
        }
        const visits = hostVisits.get(host) ?? 0;
        if (visits >= PER_HOST_CAP) continue;
        hostVisits.set(host, visits + 1);

        let html: string;
        try {
          const res = await doFetch(item.url, { headers: { accept: "text/html" } });
          if (!res.ok) continue;
          html = await res.text();
        } catch {
          continue;
        }

        out.push({
          url: item.url,
          title: extractTitle(html),
          excerpt: extractMetaDescription(html),
          fetcher: "crawl",
        });

        if (item.depth < maxDepth) {
          for (const link of extractLinks(html, item.url)) {
            if (!seen.has(normalizeUrl(link))) queue.push({ url: link, depth: item.depth + 1 });
          }
        }
      }

      return out.slice(0, ctx.limit);
    },
  };
}

/** Default instance used by the registry (real `fetch`). */
export const crawler = createCrawlerFetcher();
