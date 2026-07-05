/**
 * Source ("dress") theming: derive a small set of theming tokens from a
 * publication's own site — a brand accent, a favicon, and an optional
 * Google-hosted display font — so the reader can wear a hint of each source's
 * identity without becoming a webview. Everything is extracted from the site's
 * `<head>` (plus, at most, its web-app manifest and favicon bytes) server-side,
 * so there's no client CORS and no source CSS ever reaches the page.
 *
 * The design boundary mirrors the cover-accent feature: we emit *tokens*, never
 * stylesheets. The accent is a plain hex the reader clamps for contrast; the
 * font is only ever a Google Fonts family name (web-embeddable + loadable),
 * never a scraped `font-family` or an injected `@font-face`.
 *
 * Best-effort throughout: any network/parse problem yields nulls so callers can
 * cache "no theme" and move on. Keyed by host — every article from a source
 * shares one theme.
 */

import { accentFromImageBytes, isFetchableUrl, rgbToHsl } from "./palette";

export interface SourceThemeTokens {
  /** Brand accent as `#rrggbb`, or null when the source exposes none usable. */
  accent: string | null;
  /** Absolute URL of a favicon / touch icon, or null. */
  faviconUrl: string | null;
  /** A Google-hosted font family name for headline slots, or null. */
  displayFont: string | null;
}

const EMPTY: SourceThemeTokens = { accent: null, faviconUrl: null, displayFont: null };

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

interface ParsedHead {
  themeColor: string | null;
  faviconHref: string | null;
  manifestHref: string | null;
  displayFont: string | null;
}

/**
 * Extract the raw theming signals from a page's `<head>` (or the whole document
 * if no head marker is present). Pure string → data, so it's fully unit-tested;
 * the fetching/resolution wrapper lives below.
 */
export function parseSourceHead(html: string): ParsedHead {
  const headEnd = html.search(/<\/head>/i);
  const head = headEnd >= 0 ? html.slice(0, headEnd) : html;

  // theme-color: prefer a plain <meta> without a media query (light default).
  let themeColor: string | null = null;
  let themeColorFallback: string | null = null;
  for (const tag of tags(head, "meta")) {
    if (attr(tag, "name")?.toLowerCase() !== "theme-color") continue;
    const color = normalizeHexColor(attr(tag, "content"));
    if (!color) continue;
    if (attr(tag, "media")) themeColorFallback ??= color;
    else {
      themeColor = color;
      break;
    }
  }
  themeColor ??= themeColorFallback;

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

  return { themeColor, faviconHref: touch ?? icon, manifestHref, displayFont };
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
    const res = await fetch(url, { signal: ctrl.signal, redirect: "follow" });
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
    const res = await fetch(url, { signal: ctrl.signal, redirect: "follow" });
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
 * colour. Best-effort: returns all-null tokens on any failure.
 */
export async function sourceThemeFromUrl(url: string): Promise<SourceThemeTokens> {
  const host = hostFromUrl(url);
  if (!host) return EMPTY;
  const origin = `https://${host}/`;
  const html = await fetchText(origin, MAX_HTML_BYTES);
  if (!html) return EMPTY;

  const head = parseSourceHead(html);
  const resolve = (href: string | null): string | null => {
    if (!href) return null;
    try {
      return new URL(href, origin).href;
    } catch {
      return null;
    }
  };

  const faviconUrl = resolve(head.faviconHref) ?? `${origin}favicon.ico`;

  // Accent: vivid theme-color → manifest theme_color → favicon dominant colour.
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

  return { accent, faviconUrl, displayFont: head.displayFont };
}
