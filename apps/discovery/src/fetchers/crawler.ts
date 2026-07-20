import { normalizeUrl } from "../dedupe";
import { type Fetcher, type FetcherDeps, type RawCandidate } from "./types";

/**
 * Bounded, polite breadth-first crawler. Starting from the configured seed URLs
 * it fetches each page, emits the page itself as a candidate ONLY when it looks
 * like real article content (not a homepage / section index / nav-utility /
 * social-profile page), then enqueues its article-like outbound links up to
 * `crawlDepth`. Bounded four ways so it can never run away:
 *   - a hard wall-clock deadline (cfg.crawlTimeMs),
 *   - a per-host visit cap,
 *   - the candidate `limit`, and
 *   - robots.txt (fetched + cached per host; disallowed paths are skipped).
 */

/** Identifies the crawler to servers and for robots.txt matching. */
const CRAWLER_UA = "LecternDiscoveryBot";
/** Max pages fetched from any single host in one run. */
const PER_HOST_CAP = 50;

/** Extensions that are clearly not article pages. */
const NON_ARTICLE_EXT =
  /\.(?:png|jpe?g|gif|webp|svg|ico|css|js|mjs|json|xml|rss|pdf|zip|gz|mp4|mp3|woff2?|ttf)(?:$|\?)/i;

/** Social networks / profile silos — never article content. */
const SOCIAL_HOST =
  /(?:^|\.)(?:bsky\.app|twitter\.com|x\.com|facebook\.com|instagram\.com|linkedin\.com|youtube\.com|youtu\.be|reddit\.com|tiktok\.com|threads\.net|t\.me|hachyderm\.io|mstdn\.social|mas\.to|mastodon\.social)$/i;

/**
 * First-path-segment names that denote a section index, profile, or site
 * utility rather than a single article. Reject these — there's no story there.
 */
const NAV_SEGMENTS = new Set([
  "about",
  "contact",
  "support",
  "privacy",
  "terms",
  "tos",
  "legal",
  "cookie",
  "cookies",
  "tag",
  "tags",
  "category",
  "categories",
  "topics",
  "archive",
  "archives",
  "page",
  "pages",
  "feed",
  "feeds",
  "rss",
  "atom",
  "search",
  "login",
  "logout",
  "signin",
  "signup",
  "register",
  "subscribe",
  "subscription",
  "newsletter",
  "social",
  "donate",
  "sponsor",
  "sponsors",
  "advertise",
  "index",
  "home",
  "account",
  "settings",
  "profile",
  "profiles",
  "user",
  "users",
  "author",
  "authors",
  "follow",
  "following",
  "followers",
  "mentions",
  "colophon",
  "uses",
  "now",
  "links",
  "shop",
  "store",
  "cart",
  "faq",
  "help",
  "careers",
  "jobs",
  "press",
]);

/**
 * True when a URL looks like real article content: not a social/profile silo,
 * not the site root, not a first-segment section/utility page, and not a bare
 * single-word section index (a real post slug carries a hyphen or a number).
 */
export function isContentUrl(u: URL): boolean {
  if (SOCIAL_HOST.test(u.host)) return false;
  const path = u.pathname.replace(/\/+$/, "");
  if (path.length <= 1) return false; // site root / homepage
  if (path.startsWith("/@")) return false; // mastodon-style handles
  const segs = path
    .split("/")
    .filter(Boolean)
    .map((s) => s.toLowerCase());
  if (segs.length === 0) return false;
  if (NAV_SEGMENTS.has(segs[0]!)) return false;
  // A lone bare word (e.g. /culture, /social) is a section index, not a post;
  // real article slugs are multi-segment or carry a hyphen/underscore/number.
  if (segs.length === 1 && !/[-_]|\d/.test(segs[0]!)) return false;
  return true;
}

// ---- robots.txt ------------------------------------------------------------

/** A compiled robots matcher: given a path, is our crawler allowed to fetch it? */
export type RobotsMatcher = (path: string) => boolean;

interface RobotsRule {
  path: string;
  allow: boolean;
}

/** Translate a robots path pattern (`*` wildcard, `$` end-anchor) to a tester. */
function ruleMatches(pattern: string, path: string): boolean {
  if (pattern === "") return false;
  if (!pattern.includes("*") && !pattern.endsWith("$")) return path.startsWith(pattern);
  let re = "^";
  for (const ch of pattern) {
    if (ch === "*") re += ".*";
    else if (ch === "$") re += "$";
    else re += ch.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  }
  try {
    return new RegExp(re).test(path);
  } catch {
    return path.startsWith(pattern.replace(/\*.*$/, ""));
  }
}

/**
 * Parse robots.txt into a matcher for `ua`. Merges the groups whose User-agent
 * is `*` or matches `ua`. Precedence: the longest matching rule wins; an Allow
 * beats a Disallow of equal length (per the de-facto Google spec). No matching
 * rule = allowed.
 */
export function parseRobots(text: string, ua: string): RobotsMatcher {
  const uaLower = ua.toLowerCase();
  const groups: { agents: string[]; rules: RobotsRule[] }[] = [];
  let cur: { agents: string[]; rules: RobotsRule[] } | null = null;
  let lastWasAgent = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (field === "user-agent") {
      if (!lastWasAgent || !cur) {
        cur = { agents: [], rules: [] };
        groups.push(cur);
      }
      cur.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (field === "disallow" || field === "allow") {
      if (!cur) {
        cur = { agents: ["*"], rules: [] };
        groups.push(cur);
      }
      // An empty Disallow value means "allow everything" — nothing to record.
      if (value) cur.rules.push({ path: value, allow: field === "allow" });
    }
  }
  const rules: RobotsRule[] = [];
  for (const g of groups) {
    if (g.agents.some((a) => a === "*" || uaLower.includes(a) || a.includes(uaLower))) {
      rules.push(...g.rules);
    }
  }
  return (path: string) => {
    let bestLen = -1;
    let allowed = true;
    for (const r of rules) {
      if (!ruleMatches(r.path, path)) continue;
      if (r.path.length > bestLen || (r.path.length === bestLen && r.allow)) {
        bestLen = r.path.length;
        allowed = r.allow;
      }
    }
    return allowed;
  };
}

/** How a host's robots.txt constrains us, for the run trace. */
export type RobotsPosture = "allow-all" | "restricted" | "unreachable";

/** Fetches + caches a per-origin robots matcher. Unreachable robots = allow all. */
class RobotsCache {
  private readonly cache = new Map<string, { matcher: RobotsMatcher; posture: RobotsPosture }>();
  constructor(private readonly doFetch: typeof fetch) {}

  async allowed(url: URL): Promise<boolean> {
    const entry = await this.entry(url.origin);
    return entry.matcher(url.pathname || "/");
  }

  /** The cached posture for an origin (call after `allowed` has populated it). */
  postureFor(origin: string): RobotsPosture {
    return this.cache.get(origin)?.posture ?? "allow-all";
  }

  private async entry(origin: string): Promise<{ matcher: RobotsMatcher; posture: RobotsPosture }> {
    let entry = this.cache.get(origin);
    if (!entry) {
      entry = await this.load(origin);
      this.cache.set(origin, entry);
    }
    return entry;
  }

  private async load(origin: string): Promise<{ matcher: RobotsMatcher; posture: RobotsPosture }> {
    try {
      const res = await this.doFetch(`${origin}/robots.txt`, {
        headers: { "user-agent": `${CRAWLER_UA}/1.0` },
      });
      // 4xx (incl. 404 "no robots") or any non-2xx => no restrictions.
      if (!res.ok) return { matcher: () => true, posture: "allow-all" };
      const text = await res.text();
      // "restricted" is a forensic label: the file publishes at least one
      // non-empty Disallow. (It may not apply to our UA, but it signals the host
      // does gate crawlers.) An empty/absent file is "allow-all".
      const posture: RobotsPosture = /(?:^|\n)\s*disallow\s*:\s*\S/i.test(text)
        ? "restricted"
        : "allow-all";
      return { matcher: parseRobots(text, CRAWLER_UA), posture };
    } catch {
      return { matcher: () => true, posture: "unreachable" };
    }
  }
}

// ---- page parsing ----------------------------------------------------------

function extractTitle(html: string): string | undefined {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m?.[1] ? decodeEntities(m[1].trim()) : undefined;
}

function extractMetaDescription(html: string): string | undefined {
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
      if (!isContentUrl(absUrl)) continue;
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
      const trace = ctx.crawlTrace;
      const deadline = Date.now() + Math.min(ctx.timeBudgetMs, ctx.cfg.crawlTimeMs);
      const maxDepth = ctx.cfg.crawlDepth;
      const robots = new RobotsCache(doFetch);
      const hostVisits = new Map<string, number>();
      const seen = new Set<string>();
      const out: RawCandidate[] = [];
      // Seeds are enqueued verbatim (they're deliberately chosen link hubs); their
      // outbound links are what we actually harvest as articles.
      const queue: QueueItem[] = ctx.seedUrls.map((url) => ({ url, depth: 0 }));
      trace?.seeds(ctx.seedUrls);

      let stopReason: "drained" | "deadline" | "limit" = "drained";
      while (queue.length > 0) {
        if (Date.now() >= deadline) {
          stopReason = "deadline";
          break;
        }
        if (out.length >= ctx.limit) {
          stopReason = "limit";
          break;
        }
        const item = queue.shift();
        if (!item) break;

        const key = normalizeUrl(item.url);
        if (seen.has(key)) continue;
        seen.add(key);

        let target: URL;
        try {
          target = new URL(item.url);
        } catch {
          continue;
        }
        const host = target.host;
        const visits = hostVisits.get(host) ?? 0;
        if (visits >= PER_HOST_CAP) {
          trace?.hostCapHit(host);
          trace?.reject(item.url, "host-cap");
          continue;
        }

        // Politeness: obey robots.txt before fetching anything.
        if (!(await robots.allowed(target))) {
          trace?.robotsBlocked(host);
          trace?.reject(item.url, "robots");
          continue;
        }
        hostVisits.set(host, visits + 1);
        trace?.visit(host, robots.postureFor(target.origin));
        trace?.depth(item.depth);

        let html: string;
        try {
          const res = await doFetch(item.url, {
            headers: { accept: "text/html", "user-agent": `${CRAWLER_UA}/1.0` },
          });
          if (!res.ok) {
            trace?.skipped();
            trace?.reject(item.url, "http-error");
            continue;
          }
          html = await res.text();
          trace?.fetched();
        } catch {
          trace?.skipped();
          trace?.reject(item.url, "fetch-error");
          continue;
        }

        // Emit the page as a candidate only when it's real article content —
        // never a seed homepage / section index / nav-utility / profile page.
        if (isContentUrl(target)) {
          out.push({
            url: item.url,
            title: extractTitle(html),
            excerpt: extractMetaDescription(html),
            fetcher: "crawl",
          });
          trace?.emitted();
        } else {
          trace?.reject(item.url, "non-content");
        }

        if (item.depth < maxDepth) {
          let enqueued = 0;
          for (const link of extractLinks(html, item.url)) {
            if (!seen.has(normalizeUrl(link))) {
              queue.push({ url: link, depth: item.depth + 1 });
              enqueued++;
            }
          }
          if (enqueued > 0) trace?.enqueued(enqueued);
        }
      }
      trace?.stop(stopReason);

      return out.slice(0, ctx.limit);
    },
  };
}

/** Default instance used by the registry (real `fetch`). */
export const crawler = createCrawlerFetcher();
