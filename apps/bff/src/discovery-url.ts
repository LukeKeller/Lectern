/**
 * Pure URL canonicalization for discovery dedup. Two links that differ only by
 * tracking params, a fragment, host case, or a trailing slash point at the same
 * article, so we key candidates (and the "already saved?" check) off this
 * normalized form rather than the raw URL. Kept dependency-free and side-effect
 * free so it's trivially unit-testable and reusable by both the store and tests.
 */
export function normalizeUrl(input: string): string {
  const raw = input.trim();
  try {
    const u = new URL(raw);
    // Host is case-insensitive (URL already lowercases it); the path is NOT, so
    // it's left untouched.
    u.hostname = u.hostname.toLowerCase();
    // Fragments never identify a distinct resource.
    u.hash = "";
    // Drop utm_* tracking params; keep every other query param (and its order).
    const kept = new URLSearchParams();
    for (const [key, value] of u.searchParams) {
      if (key.toLowerCase().startsWith("utm_")) continue;
      kept.append(key, value);
    }
    const query = kept.toString();
    u.search = query ? `?${query}` : "";
    // Strip a trailing slash from a non-root path ("/a/" and "/a" are the same).
    if (u.pathname.length > 1 && u.pathname.endsWith("/")) {
      u.pathname = u.pathname.replace(/\/+$/, "");
    }
    return u.toString();
  } catch {
    // Not a parseable URL (the worker should only ever send absolute URLs, but
    // be defensive): fall back to a trimmed, lowercased form.
    return raw.toLowerCase();
  }
}

/**
 * The registrable-ish host of a URL for domain grouping: the lowercased hostname
 * with a leading `www.` stripped (so `www.example.com` and `example.com` group
 * together). Returns '' for anything that doesn't parse as a URL, so callers can
 * cheaply skip non-hosts. Deliberately does NOT collapse other subdomains — a
 * follow suggestion should point at the exact host the user engaged with.
 */
export function hostOf(input: string): string {
  try {
    const host = new URL(input.trim()).hostname.toLowerCase();
    return host.startsWith("www.") ? host.slice(4) : host;
  } catch {
    return "";
  }
}
