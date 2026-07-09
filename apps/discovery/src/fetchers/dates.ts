/**
 * Publish-date normalization for fetchers. Every `RawCandidate.publishedAt` must
 * be an ISO 8601 string (or undefined) so the scorer's freshness decay can parse
 * it uniformly. Fetchers hand back all sorts of shapes — SearXNG/crawler emit
 * ISO-ish dates, Brave emits relative "3 days ago" strings — so we funnel them
 * through here.
 */

/** Approximate milliseconds per relative-age unit (month/year are nominal). */
const UNIT_MS: Record<string, number> = {
  second: 1_000,
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
  week: 604_800_000,
  month: 2_592_000_000, // 30 days
  year: 31_536_000_000, // 365 days
};

/**
 * Normalize an absolute date string to ISO 8601, or undefined if unparseable.
 * Already-ISO calendar/date-time forms (`2026-01-02`, `2026-01-02T10:00:00Z`)
 * are kept verbatim — they're valid ISO 8601 and re-serializing would only churn
 * a date-only value into a spurious midnight-UTC timestamp.
 */
export function isoOrUndefined(s: string | null | undefined): string | undefined {
  if (!s) return undefined;
  const trimmed = s.trim();
  if (!trimmed) return undefined;
  const t = Date.parse(trimmed);
  if (Number.isNaN(t)) return undefined;
  if (/^\d{4}-\d{2}-\d{2}([T ].*)?$/.test(trimmed)) return trimmed;
  return new Date(t).toISOString();
}

/**
 * Convert a relative age ("3 days ago", "1 week ago") OR an absolute date to an
 * ISO 8601 string, relative to `now`. Returns undefined when nothing parses.
 */
export function parseRelativeAge(s: string, now: Date): string | undefined {
  const trimmed = s.trim();
  if (!trimmed) return undefined;
  const rel = /^(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago$/i.exec(trimmed);
  if (rel) {
    const n = Number(rel[1]);
    const ms = UNIT_MS[rel[2]!.toLowerCase()];
    if (ms === undefined || !Number.isFinite(n)) return undefined;
    return new Date(now.getTime() - n * ms).toISOString();
  }
  return isoOrUndefined(trimmed);
}
