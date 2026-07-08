import type { DiscoveryConfig, DiscoveryFetcher } from "@lectern/shared";

/**
 * A raw article discovered by a fetcher, before dedupe/scoring. Metadata fields
 * are optional; the scorer only requires a URL and works from title + excerpt.
 */
export interface RawCandidate {
  url: string;
  title?: string;
  excerpt?: string;
  fetcher: DiscoveryFetcher;
  author?: string;
  siteName?: string;
  imageUrl?: string;
  publishedAt?: string;
}

/** Everything a fetcher needs for one run. */
export interface FetchContext {
  /** Keyword queries built from the top profile terms + configured topics. */
  queries: string[];
  /** Seed URLs (crawler entry points). */
  seedUrls: string[];
  /** Soft cap on candidates a single fetcher should return. */
  limit: number;
  /** Hard wall-clock budget (ms) for fetchers that loop (e.g. the crawler). */
  timeBudgetMs: number;
  /** The full worker-facing config (fetcher toggles, keys, crawl depth, ...). */
  cfg: DiscoveryConfig;
}

/** A pluggable candidate source. */
export interface Fetcher {
  name: DiscoveryFetcher;
  /** Whether this fetcher is switched on AND has the config it needs. */
  enabled(cfg: DiscoveryConfig): boolean;
  fetch(ctx: FetchContext): Promise<RawCandidate[]>;
}

/**
 * Raised by a fetcher on a non-2xx HTTP response. Mirrors the BFF's
 * `BackendHttpError` style (carries the source + upstream status). The run
 * orchestrator catches this per-fetcher so one bad source never fails the run.
 */
export class DiscoveryHttpError extends Error {
  constructor(
    readonly fetcher: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "DiscoveryHttpError";
  }
}

/** Optional injection point so tests can supply a fake `fetch`. */
export interface FetcherDeps {
  fetch?: typeof fetch;
}
