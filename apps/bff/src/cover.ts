/**
 * Best-effort cover-image extraction for cards that lack a native thumbnail
 * (MiniFlux entries, and any backend without an image field). We pull the
 * `og:image` meta or the first `<img>` from the item's HTML and resolve it to an
 * absolute http(s) URL. Returns null when there's nothing usable — the UI then
 * falls back to the source avatar. Regex-based to stay dependency-free; this is a
 * cosmetic hint, not a correctness-critical parse, and must never throw.
 */

/** Return `value` resolved against `base` iff it is an absolute http(s) URL. */
export function safeHttpUrl(value: string | null | undefined, base?: string): string | null {
  if (!value) return null;
  try {
    const u = new URL(value, base || undefined);
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : null;
  } catch {
    return null;
  }
}

const OG_IMAGE = /<meta[^>]+(?:property|name)\s*=\s*["']og:image(?::url)?["'][^>]*>/i;
const CONTENT_ATTR = /content\s*=\s*["']([^"']+)["']/i;
const FIRST_IMG = /<img[^>]+\bsrc\s*=\s*["']([^"']+)["']/i;

/** og:image (preferred) or the first inline image, as an absolute http(s) URL. */
export function extractCoverImage(html: string | undefined, base: string): string | null {
  if (!html) return null;
  const ogTag = html.match(OG_IMAGE);
  if (ogTag) {
    const content = ogTag[0].match(CONTENT_ATTR);
    const url = safeHttpUrl(content?.[1], base);
    if (url) return url;
  }
  const img = html.match(FIRST_IMG);
  return safeHttpUrl(img?.[1], base);
}
