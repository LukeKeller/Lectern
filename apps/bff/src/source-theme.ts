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
  /** Brand accent as `#rrggbb` (light-mode chrome), or null when none usable. */
  accent: string | null;
  /** Dark-mode brand accent as `#rrggbb`, or null when none usable. */
  accentDark: string | null;
  /** Reading-surface background, light (`#rrggbb`), or null. */
  background: string | null;
  /** Reading-surface background, dark (`#rrggbb`), or null. */
  backgroundDark: string | null;
  /** Body text colour (`#rrggbb`), or null. */
  text: string | null;
  /** Link colour (`#rrggbb`); the reader falls back to accent when null. */
  link: string | null;
  /** Body font family NAME (e.g. "Georgia"); null when unknown. */
  bodyFont: string | null;
  /** Heading / display font family name, or null. */
  displayFont: string | null;
  /** Absolute (https-preferred) URL of a favicon / touch icon, or null. */
  faviconUrl: string | null;
  /** The publication's own name, or null. */
  siteName: string | null;
  /** How the reading-surface palette was obtained. */
  derivation: "literal" | "derived" | null;
}

const EMPTY: SourceThemeTokens = {
  accent: null,
  accentDark: null,
  background: null,
  backgroundDark: null,
  text: null,
  link: null,
  bodyFont: null,
  displayFont: null,
  faviconUrl: null,
  siteName: null,
  derivation: null,
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

  return {
    themeColor,
    themeColorDark,
    faviconHref: touch ?? icon,
    manifestHref,
    displayFont,
    siteName,
  };
}

// ---- Pure palette mining from CSS (unit-tested) ----------------------------

/** Clamp a number into [lo, hi]. */
function clampN(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** `#rrggbb` → [r,g,b] 0..255, or null when not a plain 6-digit hex. */
function hexToRgb(hex: string): [number, number, number] | null {
  const t = hex.trim().replace(/^#/, "");
  if (!/^[0-9a-f]{6}$/i.test(t)) return null;
  const n = parseInt(t, 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/** [r,g,b] 0..255 → `#rrggbb` (rounded + clamped). */
function rgbToHex(r: number, g: number, b: number): string {
  const to = (v: number) => clampN(Math.round(v), 0, 255).toString(16).padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

// A deliberately small map of CSS named colours we're likely to meet as a
// `background`/`color`/link value. `transparent` maps to null (unusable).
const NAMED_COLORS: Record<string, string | null> = {
  transparent: null,
  white: "#ffffff",
  black: "#000000",
  red: "#ff0000",
  green: "#008000",
  blue: "#0000ff",
  navy: "#000080",
  gray: "#808080",
  grey: "#808080",
  silver: "#c0c0c0",
  whitesmoke: "#f5f5f5",
  ghostwhite: "#f8f8ff",
  ivory: "#fffff0",
  snow: "#fffafa",
  darkslategray: "#2f4f4f",
  darkslategrey: "#2f4f4f",
};

/**
 * Convert a raw CSS colour token to `#rrggbb`, dropping any alpha. Handles
 * `#rgb`/`#rgba`/`#rrggbb`/`#rrggbbaa`, `rgb()`/`rgba()` (numbers or %), and a
 * small named-colour map. Returns null for anything else (gradients,
 * `currentColor`, `var()` that didn't resolve, …). Pure so it's unit-tested.
 */
export function cssColorToHex(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const t = raw.trim().toLowerCase();
  if (!t) return null;

  if (t[0] === "#") {
    const h = t.slice(1);
    if (/^[0-9a-f]{3}$/.test(h)) return `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`;
    if (/^[0-9a-f]{4}$/.test(h)) return `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`; // drop alpha
    if (/^[0-9a-f]{6}$/.test(h)) return `#${h}`;
    if (/^[0-9a-f]{8}$/.test(h)) return `#${h.slice(0, 6)}`; // drop alpha
    return null;
  }

  const fn = t.match(/^rgba?\(\s*([^)]+)\)$/);
  if (fn) {
    const parts = (fn[1] ?? "").split(/[,\s/]+/).filter(Boolean);
    if (parts.length < 3) return null;
    const toByte = (p: string): number | null => {
      const pct = p.endsWith("%");
      const v = parseFloat(p);
      if (Number.isNaN(v)) return null;
      return pct ? Math.round((clampN(v, 0, 100) / 100) * 255) : Math.round(clampN(v, 0, 255));
    };
    const r = toByte(parts[0] ?? "");
    const g = toByte(parts[1] ?? "");
    const b = toByte(parts[2] ?? "");
    if (r === null || g === null || b === null) return null;
    return rgbToHex(r, g, b);
  }

  if (Object.prototype.hasOwnProperty.call(NAMED_COLORS, t)) return NAMED_COLORS[t] ?? null;
  return null;
}

/** WCAG relative luminance of a `#rrggbb`. */
function relLuminance(hex: string): number {
  const rgb = hexToRgb(hex) ?? [0, 0, 0];
  const lin = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * (lin[0] ?? 0) + 0.7152 * (lin[1] ?? 0) + 0.0722 * (lin[2] ?? 0);
}

/** WCAG contrast ratio (1..21) between two `#rrggbb` colours. Pure + tested. */
export function contrastRatioHex(a: string, b: string): number {
  const la = relLuminance(a);
  const lb = relLuminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/** Linear-blend `#rrggbb` `a` toward `b` by fraction `t` in [0,1]. Pure. */
export function mixHex(a: string, b: string, t: number): string {
  const pa = hexToRgb(a);
  const pb = hexToRgb(b);
  if (!pa || !pb) return normalizeHexColor(a) ?? "#000000";
  const k = clampN(t, 0, 1);
  return rgbToHex(
    pa[0] + (pb[0] - pa[0]) * k,
    pa[1] + (pb[1] - pa[1]) * k,
    pa[2] + (pb[2] - pa[2]) * k,
  );
}

/** Iterate the innermost `selector { decls }` rules of a CSS string, in order. */
function* iterRules(css: string): Generator<{ sel: string; decls: string }> {
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) yield { sel: (m[1] ?? "").trim(), decls: m[2] ?? "" };
}

// Selector token matchers (a bare element name at a boundary in the selector).
const hasToken = (sel: string, token: string) =>
  new RegExp(`(^|[\\s,>+~])${token}(?=$|[\\s,>+~.:#\\[])`, "i").test(sel);
const isRootSel = (sel: string) =>
  hasToken(sel, ":root") || hasToken(sel, "html") || hasToken(sel, "body");
const isBodySel = (sel: string) => hasToken(sel, "body");
const isHtmlSel = (sel: string) => hasToken(sel, "html");
const isLinkSel = (sel: string) => hasToken(sel, "a") || /\.entry-content\s+a\b/i.test(sel);
const isHeadingSel = (sel: string) =>
  /(^|[\s,>+~])h[1-6](?=$|[\s,>+~.:#[])/i.test(sel) ||
  /\.(entry-title|post-title|article-title)\b/i.test(sel);

/**
 * Collect CSS custom properties declared in `:root`/`html`/`body` blocks into a
 * name → raw-value map (later declarations win). WordPress theme.json exposes
 * clean semantic vars here (`--wp--preset--color--base`, …). Pure + tested.
 */
export function collectCssVars(css: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const { sel, decls } of iterRules(css)) {
    if (!isRootSel(sel)) continue;
    const re = /(--[\w-]+)\s*:\s*([^;]+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(decls))) map.set((m[1] ?? "").trim(), (m[2] ?? "").trim());
  }
  return map;
}

/**
 * Resolve a CSS value that may contain `var(--x, fallback)` against a variable
 * map. Two passes handle one level of indirection; an unresolved `var()` with no
 * usable fallback yields null. Pure + tested.
 */
export function resolveCssValue(
  value: string | null | undefined,
  vars: Map<string, string>,
): string | null {
  if (value == null) return null;
  let v = value.trim();
  if (!v) return null;
  for (let pass = 0; pass < 2 && /var\(/i.test(v); pass++) {
    v = v
      .replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*))?\)/gi, (_full, name: string, fb?: string) => {
        const hit = vars.get(name);
        if (hit != null && hit.trim()) return hit.trim();
        return (fb ?? "").trim();
      })
      .trim();
  }
  if (!v || /var\(/i.test(v)) return null;
  return v;
}

/** The LAST value of a declaration `prop` in a block, or null. */
function lastDecl(decls: string, prop: string): string | null {
  const re = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, "gi");
  let last: string | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(decls))) last = (m[1] ?? "").trim();
  return last;
}

/** Resolve a colour-ish value to `#rrggbb`: var-resolve, then take a colour token. */
function valueToHex(raw: string | null, vars: Map<string, string>): string | null {
  const resolved = resolveCssValue(raw, vars);
  if (!resolved) return null;
  const whole = cssColorToHex(resolved);
  if (whole) return whole;
  for (const tok of resolved.split(/\s+/)) {
    const h = cssColorToHex(tok);
    if (h) return h;
  }
  return null;
}

/** A plain font-family name: letters/digits/space/hyphen, ≤ 64 chars. */
function isValidFontName(name: string): boolean {
  return name.length <= 64 && /^[A-Za-z0-9][A-Za-z0-9 -]*$/.test(name);
}

/** Resolve a `font-family` value to its first, validated family name, or null. */
function fontName(raw: string | null, vars: Map<string, string>): string | null {
  const resolved = resolveCssValue(raw, vars);
  if (!resolved) return null;
  const first = (resolved.split(",")[0] ?? "")
    .trim()
    .replace(/^['"]|['"]$/g, "")
    .trim();
  if (!first) return null;
  const lower = first.toLowerCase();
  if (["inherit", "initial", "unset", "revert"].includes(lower)) return null;
  if (/^var\(/i.test(first)) return null;
  return isValidFontName(first) ? first : null;
}

/** Extract the inner text of every `@media (... prefers-color-scheme: dark ...)` block. */
function darkMediaBlocks(css: string): string {
  const out: string[] = [];
  const re = /@media[^{]*prefers-color-scheme\s*:\s*dark[^{]*\{/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) {
    const start = m.index + m[0].length;
    let depth = 1;
    let i = start;
    for (; i < css.length && depth > 0; i++) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}") depth--;
    }
    out.push(css.slice(start, i - 1));
    re.lastIndex = i;
  }
  return out.join("\n");
}

/** Remove every dark-scheme `@media` block so light extraction doesn't see it. */
function stripDarkMedia(css: string): string {
  let out = "";
  let last = 0;
  const re = /@media[^{]*prefers-color-scheme\s*:\s*dark[^{]*\{/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) {
    out += css.slice(last, m.index);
    let depth = 1;
    let i = m.index + m[0].length;
    for (; i < css.length && depth > 0; i++) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}") depth--;
    }
    last = i;
    re.lastIndex = i;
  }
  return out + css.slice(last);
}

/** Best-effort dark reading-surface background: a dark media block, then a `.dark`/`[data-theme=dark]` rule. */
function extractDarkBackground(css: string, vars: Map<string, string>): string | null {
  let bg: string | null = null;
  for (const { sel, decls } of iterRules(darkMediaBlocks(css))) {
    if (isBodySel(sel) || isHtmlSel(sel)) {
      const b =
        valueToHex(lastDecl(decls, "background-color"), vars) ??
        valueToHex(lastDecl(decls, "background"), vars);
      if (b) bg = b;
    }
  }
  if (bg) return bg;
  for (const { sel, decls } of iterRules(css)) {
    const darkScoped =
      /\.dark\b/i.test(sel) || /\[data-theme\s*=\s*['"]?dark/i.test(sel) || /html\.dark/i.test(sel);
    if (!darkScoped) continue;
    const b =
      valueToHex(lastDecl(decls, "background-color"), vars) ??
      valueToHex(lastDecl(decls, "background"), vars);
    if (b) bg = b;
  }
  return bg;
}

export interface LiteralPalette {
  background: string | null;
  backgroundDark: string | null;
  text: string | null;
  link: string | null;
  bodyFont: string | null;
  headingFont: string | null;
}

/**
 * Mine a source's REAL reading-surface palette from its collected CSS. Parses
 * the last matching declaration for each token (later rules win), resolving CSS
 * variables and normalising colours. The `background`/`text` pair is nulled when
 * either is missing or their WCAG contrast is < 3:1 (literal-unusable — the
 * caller then falls back to a derived re-skin). Pure so it's unit-tested.
 */
export function extractLiteralPalette(css: string): LiteralPalette {
  const vars = collectCssVars(css);
  const lightCss = stripDarkMedia(css);

  let background: string | null = null;
  let htmlBg: string | null = null;
  let text: string | null = null;
  let htmlText: string | null = null;
  let link: string | null = null;
  let bodyFont: string | null = null;
  let headingFont: string | null = null;

  for (const { sel, decls } of iterRules(lightCss)) {
    const body = isBodySel(sel);
    const html = isHtmlSel(sel);
    if ((body || html) && !/dark/i.test(sel)) {
      const bg =
        valueToHex(lastDecl(decls, "background-color"), vars) ??
        valueToHex(lastDecl(decls, "background"), vars);
      const col = valueToHex(lastDecl(decls, "color"), vars);
      if (body) {
        if (bg) background = bg;
        if (col) text = col;
        const f = fontName(lastDecl(decls, "font-family"), vars);
        if (f) bodyFont = f;
      } else {
        if (bg) htmlBg = bg;
        if (col) htmlText = col;
      }
    }
    if (isLinkSel(sel)) {
      const col = valueToHex(lastDecl(decls, "color"), vars);
      if (col) link = col;
    }
    if (isHeadingSel(sel)) {
      const f = fontName(lastDecl(decls, "font-family"), vars);
      if (f) headingFont = f;
    }
  }

  background ??= htmlBg;
  text ??= htmlText;

  // Literal-usability gate: a usable surface needs both a bg and text with real
  // contrast. Reject the pair (null both) otherwise so the caller derives one.
  if (!background || !text || contrastRatioHex(background, text) < 3) {
    background = null;
    text = null;
  }

  return {
    background,
    backgroundDark: extractDarkBackground(css, vars),
    text,
    link,
    bodyFont,
    headingFont,
  };
}

/**
 * Synthesize a coherent reading-surface re-skin from a brand accent when the
 * source's real palette is unreadable. The surface is the accent barely tinted
 * into warm paper (light) / a dark ground (dark); text is a warm near-ink the
 * reader clamps for contrast; link is the accent. Null-out entirely with no
 * accent. Pure so it's unit-tested.
 */
export function deriveReskin(input: { accent: string | null; accentDark: string | null }): {
  background: string | null;
  backgroundDark: string | null;
  text: string | null;
  link: string | null;
} {
  const accent = input.accent;
  if (!accent) return { background: null, backgroundDark: null, text: null, link: null };
  const accentDark = input.accentDark ?? accent;
  return {
    background: mixHex("#faf9f5", accent, 0.06), // barely-tinted warm paper
    backgroundDark: mixHex("#14120f", accentDark, 0.12), // tinted dark ground
    text: "#241f1b", // warm near-ink (reader clamps contrast anyway)
    link: accent,
  };
}

// ---- Fetch + resolve (impure) ----------------------------------------------

const MAX_HTML_BYTES = 2 * 1024 * 1024; // enough for any real <head>
const MAX_ICON_BYTES = 1 * 1024 * 1024;
const MAX_CSS_BYTES = 1 * 1024 * 1024; // per stylesheet
const MAX_CSS_TOTAL = 3 * 1024 * 1024; // concatenated cap
const MAX_STYLESHEETS = 4;
const ACCEPT_CSS = "text/css,*/*;q=0.1";
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
async function fetchText(
  url: string,
  maxBytes: number,
  accept: string = ACCEPT_HTML,
): Promise<string | null> {
  if (!isFetchableUrl(url)) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: { "user-agent": CHROME_UA, accept },
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
 * Gather CSS to mine for the literal palette: every inline `<style>` block, plus
 * up to {@link MAX_STYLESHEETS} external stylesheets (absolute + https-upgraded,
 * SSRF-guarded, byte-capped). Google-Fonts stylesheets are skipped (they carry
 * no palette). Best-effort: a failed stylesheet fetch is skipped, never throws;
 * the concatenation is capped at {@link MAX_CSS_TOTAL}.
 */
async function collectCss(
  html: string,
  resolve: (href: string | null) => string | null,
): Promise<string> {
  let total = "";
  const cap = (extra: string): boolean => {
    total += extra + "\n";
    return total.length >= MAX_CSS_TOTAL;
  };

  for (const block of html.match(/<style\b[^>]*>[\s\S]*?<\/style>/gi) ?? []) {
    const inner = block.replace(/^<style\b[^>]*>/i, "").replace(/<\/style>\s*$/i, "");
    if (cap(inner)) return total.slice(0, MAX_CSS_TOTAL);
  }

  const hrefs: string[] = [];
  for (const tag of tags(html, "link")) {
    if (hrefs.length >= MAX_STYLESHEETS) break;
    const rel = attr(tag, "rel")?.toLowerCase() ?? "";
    if (!rel.split(/\s+/).includes("stylesheet")) continue;
    const href = attr(tag, "href");
    if (!href || /fonts\.googleapis\.com\/css/i.test(href)) continue;
    const abs = resolve(href);
    if (abs && isFetchableUrl(abs)) hrefs.push(abs);
  }
  for (const url of hrefs) {
    const css = await fetchText(url, MAX_CSS_BYTES, ACCEPT_CSS);
    if (css && cap(css)) return total.slice(0, MAX_CSS_TOTAL);
  }
  return total;
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

  // Reading-surface re-skin: mine the source's REAL palette from its CSS
  // ("literal"); where that's unreadable but there's a brand accent, synthesize
  // one ("derived"); otherwise leave the surface untouched.
  const css = await collectCss(html, resolve);
  const lit = extractLiteralPalette(css);

  let background: string | null = null;
  let backgroundDark: string | null = null;
  let text: string | null = null;
  let link: string | null = null;
  let bodyFont: string | null = null;
  let displayFont: string | null = head.displayFont;
  let derivation: "literal" | "derived" | null = null;

  if (lit.background && lit.text) {
    // extractLiteralPalette already applied the WCAG contrast gate.
    derivation = "literal";
    background = lit.background;
    backgroundDark = lit.backgroundDark;
    text = lit.text;
    link = lit.link;
    bodyFont = lit.bodyFont;
    if (!displayFont && lit.headingFont) displayFont = lit.headingFont;
  } else if (accent) {
    const d = deriveReskin({ accent, accentDark });
    derivation = "derived";
    background = d.background;
    backgroundDark = d.backgroundDark;
    text = d.text;
    // link stays null — the reader falls back to accent for a derived surface.
    // bodyFont stays null — the real body font is unknown; keep head displayFont.
  }

  return {
    ok: true,
    tokens: {
      accent,
      accentDark,
      background,
      backgroundDark,
      text,
      link,
      bodyFont,
      displayFont,
      faviconUrl,
      siteName: head.siteName,
      derivation,
    },
  };
}
