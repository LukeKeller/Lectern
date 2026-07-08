/**
 * URL normalization + an in-run "seen" set for deduping candidates. Pure and
 * unit-tested. The BFF dedupes authoritatively by normalized URL server-side;
 * this just avoids sending obvious in-run duplicates.
 */

/**
 * Canonicalize a URL for equality comparison:
 *   - lowercase scheme + host (host is already lowercased by the URL parser),
 *   - drop the fragment,
 *   - strip `utm_*` (and a few common tracking) query params,
 *   - remove a trailing slash from non-root paths.
 * Unparseable input is returned trimmed + lowercased as a last resort.
 */
export function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw.trim());
    u.protocol = u.protocol.toLowerCase();
    u.hash = "";

    const kept = new URLSearchParams();
    for (const [k, v] of u.searchParams) {
      const key = k.toLowerCase();
      if (key.startsWith("utm_")) continue;
      if (key === "fbclid" || key === "gclid" || key === "mc_cid" || key === "mc_eid") continue;
      kept.append(k, v);
    }
    u.search = kept.toString();

    if (u.pathname.length > 1 && u.pathname.endsWith("/")) {
      u.pathname = u.pathname.replace(/\/+$/, "");
    }

    return u.toString();
  } catch {
    return raw.trim().toLowerCase();
  }
}

/** A dedupe set keyed by normalized URL. */
export class Seen {
  private readonly seen = new Set<string>();

  /** True if `url` (normalized) has been added before. */
  has(url: string): boolean {
    return this.seen.has(normalizeUrl(url));
  }

  /** Add `url`; returns false if it was already present (a duplicate). */
  add(url: string): boolean {
    const key = normalizeUrl(url);
    if (this.seen.has(key)) return false;
    this.seen.add(key);
    return true;
  }

  get size(): number {
    return this.seen.size;
  }
}
