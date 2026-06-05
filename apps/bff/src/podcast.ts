import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AppDeps } from "./app";
import type { PodcastEpisodeRecord } from "./unify";
import { config } from "./config";

/**
 * Public, tokenized podcast feed. Podcast clients fetch enclosures over plain
 * HTTP and can't send an Authorization header, so these routes live OUTSIDE the
 * bearer-gated `/api/v1` prefix and are protected by an opaque, revocable token
 * baked into the URL. Audio is streamed straight from the existing TTS cache.
 */

/** First value of a (possibly comma-joined / array) header. */
function firstHeader(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return (value ?? "").split(",")[0]?.trim() ?? "";
}

/**
 * The deployment's public origin (scheme + host, no path). Honours
 * `LECTERN_PUBLIC_URL` when set, else derives from the reverse-proxy forwarded
 * headers (YunoHost) and finally the request host. Feeds need absolute URLs.
 */
export function publicBaseUrl(req: FastifyRequest): string {
  if (config.LECTERN_PUBLIC_URL) return config.LECTERN_PUBLIC_URL.replace(/\/+$/, "");
  const proto = firstHeader(req.headers["x-forwarded-proto"]) || req.protocol || "https";
  const host =
    firstHeader(req.headers["x-forwarded-host"]) || firstHeader(req.headers.host) || "localhost";
  return `${proto}://${host}`;
}

/** Absolute subscribe URL for the feed (token baked in). */
export function podcastFeedUrl(req: FastifyRequest, token: string): string {
  return `${publicBaseUrl(req)}/podcast/${token}/feed.xml`;
}

/** Constant-time token compare (the feed token is the only gate on this route). */
function tokenMatches(expected: string, given: string): boolean {
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(given, "utf8");
  if (a.length !== b.length) {
    timingSafeEqual(a, a);
    return false;
  }
  return timingSafeEqual(a, b);
}

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Seconds → H:MM:SS (or M:SS) for <itunes:duration>. */
function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return hh > 0 ? `${hh}:${pad(mm)}:${pad(ss)}` : `${mm}:${pad(ss)}`;
}

/** Render the RSS 2.0 + iTunes feed for the published episodes. */
export function buildPodcastFeed(opts: {
  baseUrl: string;
  token: string;
  episodes: PodcastEpisodeRecord[];
}): string {
  const { baseUrl, token, episodes } = opts;
  const feedUrl = `${baseUrl}/podcast/${token}/feed.xml`;
  const cover = episodes.find((e) => e.coverImage)?.coverImage ?? null;
  const items = episodes
    .map((ep) => {
      const audioUrl = `${baseUrl}/podcast/${token}/ep/${encodeURIComponent(ep.documentId)}.mp3`;
      const parts = [
        `      <title>${xmlEscape(ep.title)}</title>`,
        ep.sourceUrl ? `      <link>${xmlEscape(ep.sourceUrl)}</link>` : "",
        `      <guid isPermaLink="false">${xmlEscape(ep.documentId)}</guid>`,
        `      <pubDate>${ep.addedAt.toUTCString()}</pubDate>`,
        ep.excerpt ? `      <description>${xmlEscape(ep.excerpt)}</description>` : "",
        ep.author ? `      <itunes:author>${xmlEscape(ep.author)}</itunes:author>` : "",
        `      <itunes:duration>${formatDuration(ep.durationSeconds)}</itunes:duration>`,
        ep.coverImage
          ? `      <itunes:image href="${xmlEscape(ep.coverImage)}" />`
          : "",
        `      <enclosure url="${xmlEscape(audioUrl)}" length="${ep.byteLength}" type="${xmlEscape(ep.mime)}" />`,
      ].filter(Boolean);
      return `    <item>\n${parts.join("\n")}\n    </item>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Lectern</title>
    <link>${xmlEscape(baseUrl)}</link>
    <atom:link href="${xmlEscape(feedUrl)}" rel="self" type="application/rss+xml" />
    <language>en</language>
    <description>Articles saved to Lectern, read aloud.</description>
    <itunes:author>Lectern</itunes:author>
    <itunes:explicit>false</itunes:explicit>
    <itunes:category text="News" />
${cover ? `    <itunes:image href="${xmlEscape(cover)}" />\n` : ""}${items}
  </channel>
</rss>
`;
}

/** Parse a single-range `Range` header against a known size, or null. */
function parseRange(header: string | undefined, size: number): { start: number; end: number } | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  let start = m[1] ? Number.parseInt(m[1], 10) : Number.NaN;
  let end = m[2] ? Number.parseInt(m[2], 10) : Number.NaN;
  if (Number.isNaN(start) && Number.isNaN(end)) return null;
  if (Number.isNaN(start)) {
    // Suffix form: bytes=-N → final N bytes.
    start = Math.max(0, size - end);
    end = size - 1;
  } else if (Number.isNaN(end)) {
    end = size - 1;
  }
  end = Math.min(end, size - 1);
  if (start < 0 || start > end) return null;
  return { start, end };
}

/** Stream audio bytes, honouring a Range request (Apple Podcasts requires it). */
function sendAudio(reply: FastifyReply, req: FastifyRequest, bytes: Buffer, mime: string) {
  const total = bytes.length;
  reply.header("content-type", mime);
  reply.header("accept-ranges", "bytes");
  reply.header("cache-control", "public, max-age=31536000, immutable");
  const range = parseRange(req.headers.range, total);
  if (range) {
    reply.code(206);
    reply.header("content-range", `bytes ${range.start}-${range.end}/${total}`);
    reply.header("content-length", String(range.end - range.start + 1));
    return reply.send(bytes.subarray(range.start, range.end + 1));
  }
  reply.header("content-length", String(total));
  return reply.send(bytes);
}

/** Register the public feed + episode-audio routes (no auth; token-gated). */
export function registerPodcastRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get<{ Params: { token: string } }>("/podcast/:token/feed.xml", async (req, reply) => {
    const expected = await deps.overlay.getPodcastToken();
    if (!expected || !tokenMatches(expected, req.params.token)) {
      return reply.code(404).type("text/plain").send("Not found");
    }
    const episodes = await deps.overlay.listPodcastEpisodes();
    const xml = buildPodcastFeed({ baseUrl: publicBaseUrl(req), token: expected, episodes });
    reply.header("content-type", "application/rss+xml; charset=utf-8");
    reply.header("cache-control", "no-cache");
    return reply.send(xml);
  });

  app.get<{ Params: { token: string; id: string } }>(
    "/podcast/:token/ep/:id",
    async (req, reply) => {
      const expected = await deps.overlay.getPodcastToken();
      if (!expected || !tokenMatches(expected, req.params.token)) {
        return reply.code(404).type("text/plain").send("Not found");
      }
      const id = req.params.id.replace(/\.mp3$/, "");
      const episode = await deps.overlay.getPodcastEpisode(id);
      if (!episode) return reply.code(404).type("text/plain").send("Not found");
      const audio = await deps.overlay.getCachedAudio(episode.contentHash);
      if (!audio) return reply.code(404).type("text/plain").send("Not found");
      return sendAudio(reply, req, audio.bytes, episode.mime);
    },
  );
}
