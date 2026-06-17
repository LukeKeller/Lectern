/**
 * Bluesky post enrichment via the public AT-Protocol AppView (no auth).
 *
 * Bluesky's RSS feed carries only a post's plain text, and replaces any image
 * or quoted post with the literal placeholder "[contains quote post or other
 * embedded content]". The reader otherwise loses the whole point of those posts.
 * Given the post permalink from the feed entry, we re-fetch the post from the
 * public AppView (`getPostThread`, depth 0) and rebuild clean HTML — images,
 * link cards, and one level of quoted post — so the reader shows the real thing.
 *
 * Everything here is best-effort: the AppView shapes are permissive and any
 * failure (network, non-2xx, parse, unexpected shape) falls back to the original
 * feed body. The render is a pure function so it's easy to test against fixtures.
 */

/** A Bluesky blob view (image/thumb). `fullsize`/`thumb` are CDN https URLs. */
interface BskyImageView {
  thumb?: string;
  fullsize?: string;
  alt?: string;
}

/** `app.bsky.embed.external#view` payload: a link-card preview. */
interface BskyExternalView {
  uri?: string;
  title?: string;
  description?: string;
  thumb?: string;
}

/** A quoted post as embedded in another post (`app.bsky.embed.record#viewRecord`). */
interface BskyViewRecord {
  $type?: string;
  author?: { handle?: string; displayName?: string };
  value?: { text?: string };
  /** Nested embeds on the quoted post (images/external), rendered one level deep. */
  embeds?: BskyEmbed[];
}

/**
 * Any of the embed views we understand. Kept permissive (all optional) because
 * the AppView omits absent variants and we only read fields we recognize.
 */
interface BskyEmbed {
  $type?: string;
  /** images#view */
  images?: BskyImageView[];
  /** external#view */
  external?: BskyExternalView;
  /** record#view — the quoted post */
  record?: BskyViewRecord | { record?: BskyViewRecord };
  /** recordWithMedia#view — the media half (an images or external view) */
  media?: BskyEmbed;
}

/** A post as returned by the AppView feed endpoints. */
export interface BskyPostView {
  uri?: string;
  record?: { text?: string };
  embed?: BskyEmbed;
}

/** `getPostThread` response: `thread.post` is the requested post's view. */
interface BskyThreadResponse {
  thread?: { post?: BskyPostView };
}

const APPVIEW_BASE = "https://public.api.bsky.app";

/** Escape the five characters that are unsafe in HTML text/attribute context. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Parse a Bluesky post permalink into the repo (handle or DID) and record key.
 * Returns null for anything that isn't a `bsky.app/profile/<x>/post/<rkey>` URL,
 * which is how the caller decides whether to attempt enrichment at all.
 */
export function parseBlueskyPostUrl(url: string): { repo: string; rkey: string } | null {
  const m = /^https?:\/\/bsky\.app\/profile\/([^/]+)\/post\/([^/?#]+)/i.exec(url);
  const repo = m?.[1];
  const rkey = m?.[2];
  if (!repo || !rkey) return null;
  return { repo, rkey };
}

/**
 * Render a post's text as `<p>` blocks: split on blank lines into paragraphs,
 * escape, and turn single newlines into `<br>`. Empty text yields no markup.
 */
function renderText(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  return trimmed
    .split(/\n\s*\n/)
    .map((para) => `<p>${escapeHtml(para).replace(/\n/g, "<br/>")}</p>`)
    .join("");
}

/** Render an `images#view` embed as a `<figure>` per image (caption from alt). */
function renderImages(images: BskyImageView[]): string {
  return images
    .map((img) => {
      const src = img.fullsize ?? img.thumb;
      if (!src) return "";
      const alt = escapeHtml(img.alt ?? "");
      const caption = img.alt ? `<figcaption>${alt}</figcaption>` : "";
      return `<figure><img src="${escapeHtml(src)}" alt="${alt}" loading="lazy"/>${caption}</figure>`;
    })
    .join("");
}

/** Render an `external#view` embed as a simple titled link card. */
function renderExternal(external: BskyExternalView): string {
  const uri = external.uri;
  if (!uri) return "";
  const title = escapeHtml(external.title || uri);
  const desc = external.description ? `<br/>${escapeHtml(external.description)}` : "";
  return `<p><a href="${escapeHtml(uri)}">${title}</a>${desc}</p>`;
}

/**
 * Render whatever media half a quote or recordWithMedia carries (images or an
 * external card). Used both for top-level media and inside a quoted blockquote.
 */
function renderMedia(embed: BskyEmbed | undefined): string {
  if (!embed) return "";
  if (embed.$type === "app.bsky.embed.images#view" && Array.isArray(embed.images)) {
    return renderImages(embed.images);
  }
  if (embed.$type === "app.bsky.embed.external#view" && embed.external) {
    return renderExternal(embed.external);
  }
  return "";
}

/**
 * Render a quoted post (viewRecord) as a `<blockquote>`: an author line, the
 * quoted text, and one level of the quoted post's own images/external embeds.
 * Deeper nesting is intentionally not followed (keeps output bounded and clean).
 */
function renderQuote(record: BskyViewRecord | undefined): string {
  if (!record) return "";
  const handle = record.author?.handle ?? "";
  const displayName = record.author?.displayName ?? "";
  const authorLine =
    handle || displayName
      ? `<p><strong>${escapeHtml(displayName)}</strong> @${escapeHtml(handle)}</p>`
      : "";
  const text = renderText(record.value?.text ?? "");
  const nested = Array.isArray(record.embeds) ? record.embeds.map(renderMedia).join("") : "";
  const inner = `${authorLine}${text}${nested}`;
  if (!inner) return "";
  return `<blockquote>${inner}</blockquote>`;
}

/** Pull the `viewRecord` out of a `record#view` embed (`embed.record`). */
function viewRecordOf(record: BskyEmbed["record"]): BskyViewRecord | undefined {
  if (!record) return undefined;
  // `record#view` wraps the quoted post directly under `record`. We accept a
  // permissive shape, so detect the viewRecord by its fields.
  if ("author" in record || "value" in record) return record as BskyViewRecord;
  return undefined;
}

/**
 * Build clean HTML from a post view: the post text followed by whatever the
 * embed carries (images, link card, quoted post, or media+quote). Pure — all
 * the network sits in `enrichBlueskyContent`. Unknown embeds and missing fields
 * are ignored rather than throwing.
 */
export function renderBlueskyPost(post: BskyPostView): string {
  const parts: string[] = [];
  parts.push(renderText(post.record?.text ?? ""));

  const embed = post.embed;
  switch (embed?.$type) {
    case "app.bsky.embed.images#view":
      if (Array.isArray(embed.images)) parts.push(renderImages(embed.images));
      break;
    case "app.bsky.embed.external#view":
      if (embed.external) parts.push(renderExternal(embed.external));
      break;
    case "app.bsky.embed.record#view":
      parts.push(renderQuote(viewRecordOf(embed.record)));
      break;
    case "app.bsky.embed.recordWithMedia#view": {
      parts.push(renderMedia(embed.media));
      // The record half nests the viewRecord under `record.record`.
      const wrapper = embed.record as { record?: BskyViewRecord } | undefined;
      parts.push(renderQuote(wrapper?.record));
      break;
    }
    default:
      // Unknown / absent embed type — text only.
      break;
  }

  return parts.filter(Boolean).join("");
}

// --- in-memory cache -------------------------------------------------------
// Re-opening a post (or a list refresh hitting the same entry) shouldn't hammer
// the AppView. Cache successful renders by at-uri with a short TTL and a hard
// cap so memory stays bounded; on overflow we evict the oldest insertion.

interface CacheEntry {
  html: string;
  expires: number;
}

const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const CACHE_MAX = 500;
const cache = new Map<string, CacheEntry>();

function cacheGet(key: string): string | undefined {
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (hit.expires <= Date.now()) {
    cache.delete(key);
    return undefined;
  }
  return hit.html;
}

function cacheSet(key: string, html: string): void {
  if (cache.size >= CACHE_MAX) {
    // Map preserves insertion order; the first key is the oldest.
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { html, expires: Date.now() + CACHE_TTL_MS });
}

/**
 * Enrich a Bluesky post permalink into full HTML, or return `fallback` for
 * non-Bluesky URLs and on any failure. Fetches the post from the public AppView
 * (`getPostThread`, depth 0) and renders it. `fetchImpl` is injectable for tests.
 */
export async function enrichBlueskyContent(
  url: string,
  fallback: string,
  fetchImpl?: typeof fetch,
): Promise<string> {
  const parsed = parseBlueskyPostUrl(url);
  if (!parsed) return fallback;

  const atUri = `at://${parsed.repo}/app.bsky.feed.post/${parsed.rkey}`;
  const cached = cacheGet(atUri);
  if (cached !== undefined) return cached;

  const doFetch = fetchImpl ?? fetch;
  try {
    const endpoint =
      `${APPVIEW_BASE}/xrpc/app.bsky.feed.getPostThread` +
      `?depth=0&parentHeight=0&uri=${encodeURIComponent(atUri)}`;
    const res = await doFetch(endpoint);
    if (!res.ok) return fallback;
    const body = (await res.json()) as BskyThreadResponse;
    const post = body.thread?.post;
    if (!post) return fallback;
    const html = renderBlueskyPost(post);
    if (!html) return fallback;
    cacheSet(atUri, html);
    return html;
  } catch {
    // Network/parse error or unexpected shape — keep the original feed body.
    return fallback;
  }
}
