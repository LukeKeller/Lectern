/**
 * Adaptive reader accent: derive a single, pleasing accent colour from an
 * article's cover image, server-side (no client CORS, no native deps). The
 * dominant *vivid* hue is picked — backgrounds (near-white/black/grey) are
 * ignored — then clamped to a saturation/lightness band that stays legible as an
 * accent on both light and dark reading surfaces. Returns null for greyscale or
 * undecodable images; callers then fall back to the theme's own accent.
 *
 * Decoders are pure-JS (jpeg-js, pngjs) so the bundle stays cross-platform — the
 * deploy artifact is built on one OS and run on another, which rules out native
 * image libraries. WebP/AVIF/GIF/SVG covers are skipped (null).
 */

import jpeg from "jpeg-js";
import { PNG } from "pngjs";

// ---- Pure colour maths (unit-tested) ---------------------------------------

/** sRGB 0..255 → HSL with h in [0,360), s/l in [0,1]. */
export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
  else if (max === g) h = ((b - r) / d + 2) * 60;
  else h = ((r - g) / d + 4) * 60;
  return [h, s, l];
}

/** HSL (h in [0,360), s/l in [0,1]) → `#rrggbb`. */
export function hslToHex(h: number, s: number, l: number): string {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r: number, g: number, b: number;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const to = (v: number) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

/** Clamp = number → [lo,hi]. */
function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/**
 * Pick a dominant vivid accent from raw RGBA pixels. Greyish, near-white and
 * near-black pixels are excluded so the image's *colour* wins over its
 * background. The chosen hue is averaged circularly and clamped to an
 * accent-friendly band. Returns null when nothing colourful is present.
 */
export function dominantAccent(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
): string | null {
  const total = width * height;
  if (total === 0) return null;
  // Sample ~4k pixels regardless of source size.
  const step = Math.max(1, Math.floor(Math.sqrt(total / 4000)));
  // 24 hue buckets (15° each); accumulate vividness-weighted sin/cos/s/l.
  const N = 24;
  const weight = new Float64Array(N);
  const sumSin = new Float64Array(N);
  const sumCos = new Float64Array(N);
  const sumS = new Float64Array(N);
  const sumL = new Float64Array(N);

  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4;
      if ((rgba[i + 3] ?? 0) < 200) continue;
      const [h, s, l] = rgbToHsl(rgba[i] ?? 0, rgba[i + 1] ?? 0, rgba[i + 2] ?? 0);
      // Skip backgrounds: too grey, too dark, or too light.
      if (s < 0.18 || l < 0.12 || l > 0.9) continue;
      const w = s * (1 - Math.abs(l - 0.5)); // favour vivid mid-tones
      const b = Math.min(N - 1, Math.floor(h / (360 / N)));
      const rad = (h * Math.PI) / 180;
      weight[b] = (weight[b] ?? 0) + w;
      sumSin[b] = (sumSin[b] ?? 0) + Math.sin(rad) * w;
      sumCos[b] = (sumCos[b] ?? 0) + Math.cos(rad) * w;
      sumS[b] = (sumS[b] ?? 0) + s * w;
      sumL[b] = (sumL[b] ?? 0) + l * w;
    }
  }

  let best = -1;
  let bestW = 0;
  for (let b = 0; b < N; b++) {
    if ((weight[b] ?? 0) > bestW) {
      bestW = weight[b] ?? 0;
      best = b;
    }
  }
  if (best < 0 || bestW <= 0) return null;

  let hue = (Math.atan2(sumSin[best] ?? 0, sumCos[best] ?? 0) * 180) / Math.PI;
  if (hue < 0) hue += 360;
  const s = (sumS[best] ?? 0) / bestW;
  const l = (sumL[best] ?? 0) / bestW;
  // Clamp into a band that reads as an accent on both light and dark surfaces.
  return hslToHex(hue, clamp(s, 0.4, 0.72), clamp(l, 0.45, 0.6));
}

// ---- Decode + fetch (impure) -----------------------------------------------

/** Decode JPEG/PNG bytes and extract the accent. Other formats / errors → null. */
export function accentFromImageBytes(bytes: Uint8Array, contentType: string): string | null {
  try {
    const ct = contentType.toLowerCase();
    if (ct.includes("jpeg") || ct.includes("jpg")) {
      const img = jpeg.decode(bytes, {
        useTArray: true,
        maxResolutionInMP: 64,
        maxMemoryUsageInMB: 256,
      });
      return dominantAccent(img.data, img.width, img.height);
    }
    if (ct.includes("png")) {
      const png = PNG.sync.read(Buffer.from(bytes));
      return dominantAccent(png.data, png.width, png.height);
    }
    return null;
  } catch {
    return null;
  }
}

const MAX_BYTES = 8 * 1024 * 1024; // cap downloads so a huge cover can't stall ingest
const FETCH_TIMEOUT_MS = 6000;

/** Whether a URL is a public http(s) target (basic SSRF guard). */
function isFetchableUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    const host = u.hostname.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1" || host === "::1") return false;
    // Block obvious private ranges (best-effort; not a full SSRF defence).
    if (/^(10\.|192\.168\.|169\.254\.|::1$|fc00:|fe80:)/.test(host)) return false;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * Fetch a cover image and compute its accent. Best-effort: returns null on any
 * network/size/format problem so callers can cache "no colour" and move on.
 */
export async function accentFromUrl(url: string): Promise<string | null> {
  if (!isFetchableUrl(url)) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: "follow" });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") ?? "";
    if (!/image\/(jpeg|jpg|png)/i.test(ct)) return null;
    const len = Number(res.headers.get("content-length") ?? "0");
    if (len && len > MAX_BYTES) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength > MAX_BYTES) return null;
    return accentFromImageBytes(buf, ct);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
