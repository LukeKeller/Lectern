import type { BackendResource } from "@lectern/shared";
import type { Source } from "@lectern/shared";
import { BackendHttpError } from "./errors";

/**
 * Article image handling. Captured article HTML can't render its images directly
 * in the client: Readeck points at relative in-archive paths (and its server is
 * internal-only in production), while RSS bodies carry lazy-loaded, relative, or
 * hotlink/mixed-content URLs. So the BFF rewrites every `<img>` to a same-origin
 * proxy URL (`/media/documents/:id/image?u=<ref>`) and the proxy fetches the
 * bytes server-side — from the read-later backend (authed) for in-archive refs,
 * or directly for remote URLs (SSRF-guarded). Images then load same-origin, so
 * the service worker caches them offline for free.
 */

const LAZY_SRC_ATTRS = [
  "data-src",
  "data-original",
  "data-lazy-src",
  "data-url",
  "data-hi-res-src",
];

/** Read an attribute value from a single tag string (any quote style / order). */
function getAttr(tag: string, name: string): string | null {
  // A leading whitespace/`<` boundary keeps `src` from matching inside `data-src`.
  const re = new RegExp(`(?:^|[\\s])${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i");
  const m = tag.match(re);
  if (!m) return null;
  return (m[2] ?? m[3] ?? m[4] ?? "").trim();
}

/** Strip an attribute (all occurrences) from a tag string. */
function removeAttr(tag: string, name: string): string {
  return tag.replace(new RegExp(`\\s${name}\\s*=\\s*("[^"]*"|'[^']*'|[^\\s"'>]+)`, "ig"), "");
}

/** Decode the HTML entities that actually show up in URL attributes. */
function decodeRefEntities(ref: string): string {
  return ref.replace(/&amp;/gi, "&").replace(/&#3[89];/g, (m) => (m === "&#38;" ? "&" : "'"));
}

/** Highest-resolution candidate URL from a `srcset` (by `w`/`x` descriptor). */
function pickFromSrcset(srcset: string): string | null {
  const cands = srcset
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const sp = entry.search(/\s/);
      const url = sp === -1 ? entry : entry.slice(0, sp);
      const desc = sp === -1 ? "" : entry.slice(sp + 1).trim();
      const m = desc.match(/^(\d+(?:\.\d+)?)(w|x)$/);
      return { url, weight: m ? parseFloat(m[1]!) : 1 };
    })
    .filter((c) => c.url);
  if (cands.length === 0) return null;
  cands.sort((a, b) => b.weight - a.weight);
  return cands[0]!.url;
}

/**
 * The usable image reference for a tag: a real `src`, else a lazy-loading data
 * attribute, else the best `srcset` candidate. A placeholder `data:` `src` is
 * skipped in favour of the lazy/srcset source when one exists.
 */
function pickRef(tag: string): string | null {
  const src = getAttr(tag, "src");
  let lazy: string | null = null;
  for (const a of LAZY_SRC_ATTRS) {
    lazy = getAttr(tag, a);
    if (lazy) break;
  }
  const srcset = getAttr(tag, "srcset") ?? getAttr(tag, "data-srcset");
  if (src && !src.startsWith("data:")) return src;
  if (lazy) return lazy;
  if (srcset) return pickFromSrcset(srcset);
  return src; // only a `data:` src (or nothing) remains
}

function rewriteImgTag(tag: string, docId: string, base: string): string {
  const ref = pickRef(tag);
  // Nothing usable, or an inline data: image — leave the element untouched.
  if (!ref || ref.startsWith("data:")) return tag;
  const encodedRef = encodeURIComponent(decodeRefEntities(ref));
  const url = `${base}/media/documents/${encodeURIComponent(docId)}/image?u=${encodedRef}`;
  let out = tag;
  // Drop responsive/lazy attributes so the browser can't re-fetch an un-proxied
  // candidate; a single proxied `src` becomes the only source.
  for (const a of ["srcset", "sizes", "data-srcset", ...LAZY_SRC_ATTRS]) out = removeAttr(out, a);
  if (/(?:^|[\s])src\s*=/i.test(out)) {
    out = out.replace(
      /(\ssrc\s*=\s*)("[^"]*"|'[^']*'|[^\s"'>]+)/i,
      (_m, p1: string) => `${p1}"${url}"`,
    );
  } else {
    out = out.replace(/^<img/i, `<img src="${url}"`);
  }
  return out;
}

/**
 * Rewrite every `<img>` in captured article HTML to route through the BFF image
 * proxy, and drop `<picture><source srcset>` so the (rewritten) `<img>` fallback
 * is the only source. `base` is the deployment's public origin. Pure string
 * transform; leaves non-image markup untouched.
 */
export function rewriteArticleImages(html: string, docId: string, base: string): string {
  if (!html) return html;
  return html
    .replace(/<source\b[^>]*>/gi, (t) => (/(?:^|[\s])srcset\s*=/i.test(t) ? "" : t))
    .replace(/<img\b[^>]*>/gi, (t) => rewriteImgTag(t, docId, base));
}

/** Where the proxy should fetch a referenced image from. */
export type ImageTarget =
  | { kind: "resource"; sourceId: string; ref: string }
  | { kind: "remote"; url: string; referer: string | null };

/** True for hosts that must never be fetched on a user's behalf (SSRF guard). */
export function isBlockedHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local")) return true;
  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    if (a === 0 || a === 10 || a === 127) return true; // this-host, private, loopback
    if (a === 169 && b === 254) return true; // link-local (incl. cloud metadata)
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && b === 168) return true; // private
    if (a >= 224) return true; // multicast / reserved
    return false;
  }
  if (h === "::1" || h === "::") return true;
  if (h.startsWith("fe80") || h.startsWith("fc") || h.startsWith("fd")) return true; // link-local / ULA
  if (h.startsWith("::ffff:")) return isBlockedHost(h.slice("::ffff:".length));
  return false;
}

/** Parse an absolute http(s) URL, or null when `ref` isn't one. */
function absoluteHttpUrl(ref: string): URL | null {
  try {
    const u = ref.startsWith("//") ? new URL(`https:${ref}`) : new URL(ref);
    return u.protocol === "http:" || u.protocol === "https:" ? u : null;
  } catch {
    return null;
  }
}

/**
 * Resolve a rewritten image reference to a concrete fetch target. In-archive
 * Readeck refs go to the backend (authed); remote URLs are fetched directly,
 * with private/loopback hosts rejected. MiniFlux relative refs resolve against
 * the original article URL.
 */
export function resolveImageTarget(
  source: Source,
  sourceId: string,
  ref: string,
  cardUrl: string | null,
): ImageTarget | null {
  const trimmed = ref.trim();
  if (!trimmed || trimmed.startsWith("data:")) return null;

  // A newsletter's synthetic URL (`newsletter.lectern.local`) is a meaningless
  // Referer to a real image CDN and can trip hotlink protection that expects the
  // sender's domain (or none), so drop it for email images.
  const referer =
    cardUrl && !cardUrl.startsWith("https://newsletter.lectern.local/") ? cardUrl : null;

  const abs = absoluteHttpUrl(trimmed);
  if (abs)
    return isBlockedHost(abs.hostname) ? null : { kind: "remote", url: abs.href, referer };

  // Relative reference.
  if (source === "readeck") {
    if (trimmed.split("/").includes("..")) return null; // no archive traversal
    return { kind: "resource", sourceId, ref: trimmed };
  }
  // RSS: the body's relative URLs are relative to the original article.
  if (!cardUrl) return null;
  let resolved: URL;
  try {
    resolved = new URL(trimmed, cardUrl);
  } catch {
    return null;
  }
  if (resolved.protocol !== "http:" && resolved.protocol !== "https:") return null;
  return isBlockedHost(resolved.hostname)
    ? null
    : { kind: "remote", url: resolved.href, referer };
}

const IMAGE_FETCH_TIMEOUT_MS = 20_000;
const IMAGE_FETCH_UA =
  "Mozilla/5.0 (compatible; Lectern/1.0; +https://codeberg.org/readeck/readeck)";

/**
 * Fetch a remote image server-side (bypasses CORS/mixed-content/hotlink rules the
 * browser would trip on). Sends a desktop UA and the article URL as `Referer` to
 * defeat referrer-based hotlink protection. Rejects non-image HTML responses.
 */
export async function fetchRemoteImage(
  url: string,
  referer: string | null,
): Promise<BackendResource> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), IMAGE_FETCH_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        "user-agent": IMAGE_FETCH_UA,
        accept: "image/*,*/*;q=0.8",
        ...(referer ? { referer } : {}),
      },
      redirect: "follow",
      signal: ctrl.signal,
    });
  } catch {
    throw new BackendHttpError("image", 502, null, `image fetch failed: ${url}`);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok || !res.body) {
    throw new BackendHttpError("image", 502, null, `image upstream ${res.status}: ${url}`);
  }
  const contentType = res.headers.get("content-type") ?? "application/octet-stream";
  if (/^\s*text\/html/i.test(contentType)) {
    throw new BackendHttpError("image", 502, null, `non-image upstream (${contentType}): ${url}`);
  }
  const len = res.headers.get("content-length");
  return {
    contentType,
    contentLength: len ? Number(len) || null : null,
    body: res.body as AsyncIterable<Uint8Array>,
  };
}
