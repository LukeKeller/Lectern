/**
 * Source ("dress") theming: derive a small set of theming tokens from a
 * publication's own site — a brand accent (light + dark), a favicon, an optional
 * Google-hosted display font, and the publication's own name — so the reader can
 * wear a hint of each source's identity without becoming a webview. Everything is
 * extracted from the site's `<head>` (plus, at most, its web-app manifest and
 * favicon bytes) server-side, so there's no client CORS and no source CSS ever
 * reaches the page.
 *
 * The design boundary mirrors the cover-accent feature: we emit *tokens*, never
 * stylesheets. The accent is a plain hex the reader clamps for contrast; the
 * font is only ever a Google Fonts family name (web-embeddable + loadable),
 * never a scraped `font-family` or an injected `@font-face`.
 *
 * Best-effort throughout: any network/parse problem yields nulls so callers can
 * cache "no theme" and move on. Keyed by host — every article from a source
 * shares one theme. The one exception is a failed origin fetch, surfaced as
 * `ok: false` so a transient network blip doesn't poison a host's cache forever.
 */

import { accentFromImageBytes, isFetchableUrl, rgbToHsl } from "./palette";

export interface SourceThemeTokens {
  /** Brand accent as `#rrggbb` (light-mode), or null when none usable. */
  accent: string | null;
  /** Dark-mode brand accent as `#rrggbb`, or null when none usable. */
  accentDark: string | null;
  /** Absolute (https-preferred) URL of a favicon / touch icon, or null. */
  faviconUrl: string | null;
  /** A Google-hosted font family name for headline slots, or null. */
  displayFont: string | null;
  /** The publication's own name, or null. */
  siteName: string | null;
}

const EMPTY: SourceThemeTokens = {
  accent: null,
  accentDark: null,
  faviconUrl: null,
  displayFont: null,
  siteName: null,
};

// Browser-like request headers so bot-blocking CDNs don't 403 a bare Node fetch.
const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
const ACCEPT_HTML =
  "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8";
const ACCEPT_IMAGE = "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8";

// ---- Pure head parsing (unit-tested) ---------------------------------------

/** Value of an attribute on a single tag string (`<meta name="x" content="y">`). */
function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  if (!m) return null;
  return m[2] ?? m[3] ?? m[4] ?? null;
}

/** All tags of one kind (`meta` / `link`) within an HTML fragment. */
function tags(html: string, kind: string): string[] {
  return html.match(new RegExp(`<${kind}\\b[^>]*>`, "gi")) ?? [];
}

/** Trim, drop-if-empty, and cap a candidate site-name string. */
function cleanName(raw: string | null | undefined): string | null {
  const t = raw?.trim();
  return t && t.length > 0 ? t.slice(0, 80).trim() : null;
}

/**
 * Reduce a page `<title>` to its brand. Publications commonly format titles as
 * `Article Headline | The Verge` — the brand is the LAST segment when split on a
 * common separator. Falls back to the whole (trimmed, capped) title when there's
 * no separator. Pure so it's unit-tested.
 */
export function brandFromTitle(raw: string | null | undefined): string | null {
  const title = raw?.trim();
  if (!title) return null;
  // Separators: pipe, en/em dash, middle dot, colon. (Plain hyphen excluded —
  // it appears inside real brand names too often.)
  const parts = title
    .split(/\s*[|–—·:]\s*/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  const last = parts.length > 0 ? parts[parts.length - 1] : title;
  return cleanName(last);
}

/** Normalise a colour string to `#rrggbb`, or null if not a plain hex colour. */
export function normalizeHexColor(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const t = raw.trim().replace(/^#/, "");
  if (/^[0-9a-f]{6}$/i.test(t)) return `#${t.toLowerCase()}`;
  if (/^[0-9a-f]{3}$/i.test(t)) {
    return `#${t[0]}${t[0]}${t[1]}${t[1]}${t[2]}${t[2]}`.toLowerCase();
  }
  return null;
}

/**
 * True when a hex colour is too grey / near-white / near-black to read as a
 * brand accent — the same reject rule the cover-image sampler applies, so a
 * source whose `theme-color` is `#ffffff` or `#111` falls through to favicon
 * sampling rather than tinting the reader with a non-colour.
 */
export function isVividAccent(hex: string): boolean {
  const t = hex.replace(/^#/, "");
  const n = parseInt(t, 16);
  const [h, s, l] = rgbToHsl((n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff);
  void h;
  return s >= 0.18 && l >= 0.12 && l <= 0.9;
}

/** The first Google Fonts family named in a stylesheet `<link href>`, unslugged. */
export function googleFontFamily(href: string): string | null {
  if (!/fonts\.googleapis\.com\/css/i.test(href)) return null;
  // css2?family=Foo+Bar:wght@400 | css?family=Foo+Bar:400 — take the first
  // family, drop the axis/weight spec after ':', turn '+' back into spaces.
  const m = href.match(/[?&]family=([^&:]+)/i);
  if (!m?.[1]) return null;
  const raw = decodeURIComponent(m[1].replace(/\+/g, " ")).trim();
  return raw.length > 0 && raw.length <= 64 ? raw : null;
}

/**
 * The first Google Fonts family pulled in via an `@import` inside a `<style>`
 * block — e.g. `@import url('https://fonts.googleapis.com/css2?family=Lora');`.
 * Many publications embed fonts this way rather than with a `<link>`. Pure so
 * it's unit-tested.
 */
export function googleFontFromImport(css: string): string | null {
  const m = css.match(
    /@import\s+(?:url\(\s*)?['"]?([^'")\s]*fonts\.googleapis\.com\/css[^'")\s]*)['"]?\s*\)?/i,
  );
  if (!m?.[1]) return null;
  return googleFontFamily(m[1]);
}

interface ParsedHead {
  themeColor: string | null;
  themeColorDark: string | null;
  faviconHref: string | null;
  manifestHref: string | null;
  displayFont: string | null;
  siteName: string | null;
}

/**
 * Extract the raw theming signals from a page's `<head>` (or the whole document
 * if no head marker is present). Pure string → data, so it's fully unit-tested;
 * the fetching/resolution wrapper lives below.
 */
export function parseSourceHead(html: string): ParsedHead {
  const headEnd = html.search(/<\/head>/i);
  const head = headEnd >= 0 ? html.slice(0, headEnd) : html;

  // theme-color: a plain <meta> (no media) is the light default; a
  // `prefers-color-scheme: dark` media-scoped one is the dark accent; any other
  // media-scoped one backs up the light default.
  let themeColor: string | null = null;
  let themeColorLightMedia: string | null = null;
  let themeColorDark: string | null = null;
  let ogSiteName: string | null = null;
  let applicationName: string | null = null;
  for (const tag of tags(head, "meta")) {
    const name = attr(tag, "name")?.toLowerCase();
    const property = attr(tag, "property")?.toLowerCase();

    if (name === "theme-color") {
      const color = normalizeHexColor(attr(tag, "content"));
      if (color) {
        const media = attr(tag, "media");
        if (media) {
          if (/dark/i.test(media)) themeColorDark ??= color;
          else themeColorLightMedia ??= color;
        } else themeColor ??= color;
      }
    }

    if (property === "og:site_name" || name === "og:site_name")
      ogSiteName ??= cleanName(attr(tag, "content"));
    if (name === "application-name") applicationName ??= cleanName(attr(tag, "content"));
  }
  themeColor ??= themeColorLightMedia;

  // Favicon: prefer an apple-touch-icon (usually a rich PNG), then any icon.
  let touch: string | null = null;
  let icon: string | null = null;
  let manifestHref: string | null = null;
  let displayFont: string | null = null;
  for (const tag of tags(head, "link")) {
    const rel = attr(tag, "rel")?.toLowerCase() ?? "";
    const href = attr(tag, "href");
    if (!href) continue;
    if (rel.includes("apple-touch-icon")) touch ??= href;
    else if (rel.split(/\s+/).includes("icon") || rel.includes("shortcut icon")) icon ??= href;
    else if (rel.includes("manifest")) manifestHref ??= href;
    if (!displayFont) displayFont = googleFontFamily(href);
  }
  // Fall back to a Google font pulled in via @import inside a <style> block.
  if (!displayFont) {
    for (const style of head.match(/<style\b[^>]*>[\s\S]*?<\/style>/gi) ?? []) {
      displayFont = googleFontFromImport(style);
      if (displayFont) break;
    }
  }

  // Site name: og:site_name → application-name → the title's brand segment.
  const titleMatch = head.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const siteName = ogSiteName ?? applicationName ?? brandFromTitle(titleMatch?.[1]);

  return { themeColor, themeColorDark, faviconHref: touch ?? icon, manifestHref, displayFont, siteName };
}

// ---- Fetch + resolve (impure) ----------------------------------------------

const MAX_HTML_BYTES = 2 * 1024 * 1024; // enough for any real <head>
const MAX_ICON_BYTES = 1 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 6000;

/** Lowercased hostname with a leading `www.` stripped, or null for a bad URL. */
export function hostFromUrl(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** GET a URL with a timeout + byte cap; returns the body text or null. */
async function fetchText(url: string, maxBytes: number): Promise<string | null> {
  if (!isFetchableUrl(url)) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: { "user-agent": CHROME_UA, accept: ACCEPT_HTML },
    });
    if (!res.ok) return null;
    const len = Number(res.headers.get("content-length") ?? "0");
    if (len && len > maxBytes) return null;
    const text = await res.text();
    return text.length > maxBytes * 2 ? text.slice(0, maxBytes * 2) : text;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch a favicon and sample its dominant accent (PNG/JPEG only). */
async function accentFromIcon(url: string): Promise<string | null> {
  if (!isFetchableUrl(url)) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: { "user-agent": CHROME_UA, accept: ACCEPT_IMAGE },
    });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") ?? "";
    if (!/image\/(png|jpeg|jpg)/i.test(ct)) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength > MAX_ICON_BYTES) return null;
    return accentFromImageBytes(buf, ct);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Compute a source's theme from any article URL on it. Fetches the site origin
 * (`https://host/`), reads its `<head>`, and — for the accent — prefers a vivid
 * `theme-color`, then the manifest's `theme_color`, then the favicon's dominant
 * colour.
 *
 * Returns `{ ok, tokens }`. `ok` is false only when the origin HTML fetch itself
 * fails (bad host, network error, timeout, non-2xx) — the caller should NOT
 * cache that, so a transient failure doesn't poison the host forever. `ok: true`
 * means the `<head>` was read; the tokens may still be all-null ("checked,
 * none"), which is a legitimate cacheable result. Best-effort throughout: any
 * parse/sub-fetch problem yields nulls, never throws.
 */
export async function sourceThemeFromUrl(
  url: string,
): Promise<{ ok: boolean; tokens: SourceThemeTokens }> {
  const host = hostFromUrl(url);
  if (!host) return { ok: false, tokens: EMPTY };
  const origin = `https://${host}/`;
  const html = await fetchText(origin, MAX_HTML_BYTES);
  if (!html) return { ok: false, tokens: EMPTY };

  const head = parseSourceHead(html);
  const resolve = (href: string | null): string | null => {
    if (!href) return null;
    try {
      const u = new URL(href, origin);
      // The reader page is https; upgrade http assets to dodge mixed-content blocks.
      if (u.protocol === "http:") u.protocol = "https:";
      return u.href;
    } catch {
      return null;
    }
  };

  const faviconUrl = resolve(head.faviconHref) ?? `${origin}favicon.ico`;

  // Light accent: vivid theme-color → manifest theme_color → favicon colour.
  let accent: string | null =
    head.themeColor && isVividAccent(head.themeColor) ? head.themeColor : null;
  if (!accent && head.manifestHref) {
    const manifest = await fetchText(resolve(head.manifestHref) ?? "", MAX_HTML_BYTES);
    if (manifest) {
      try {
        const color = normalizeHexColor(
          (JSON.parse(manifest) as { theme_color?: string }).theme_color,
        );
        if (color && isVividAccent(color)) accent = color;
      } catch {
        // malformed manifest — ignore
      }
    }
  }
  if (!accent) accent = await accentFromIcon(faviconUrl);

  // Dark accent: the media-scoped `prefers-color-scheme: dark` theme-color.
  const accentDark =
    head.themeColorDark && isVividAccent(head.themeColorDark) ? head.themeColorDark : null;

  return {
    ok: true,
    tokens: { accent, accentDark, faviconUrl, displayFont: head.displayFont, siteName: head.siteName },
  };
}
