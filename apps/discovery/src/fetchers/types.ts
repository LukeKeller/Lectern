import type { CrawlRejectReason, DiscoveryConfig, DiscoveryFetcher } from "@lectern/shared";

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

/**
 * Optional per-run diagnostics collector the crawler writes into, so the run can
 * persist a forensic trace of what it fetched, skipped, and why. Only the crawler
 * reports through this — the searchers' raw results and errors are already visible
 * to the run orchestrator (it holds their returned arrays and catches their errors).
 * All methods are best-effort side-channels; a missing sink is a no-op.
 */
export interface CrawlTraceSink {
  /** The seed URLs the walk began from. */
  seeds(urls: string[]): void;
  /** A page was fetched from `host`, whose robots.txt had `posture`. */
  visit(host: string, posture: "allow-all" | "restricted" | "unreachable"): void;
  /** A path on `host` was disallowed by robots.txt. */
  robotsBlocked(host: string): void;
  /** The per-host visit cap was reached on `host`. */
  hostCapHit(host: string): void;
  /** A URL was declined (not emitted / not followed), with the reason. */
  reject(url: string, reason: CrawlRejectReason): void;
  /** `count` article-like links were enqueued from a page. */
  enqueued(count: number): void;
  /** A page fetch succeeded (2xx). */
  fetched(): void;
  /** A page was skipped on a non-2xx / network error. */
  skipped(): void;
  /** A page was emitted as a candidate. */
  emitted(): void;
  /** A page at `reached` depth was processed (tracks the deepest reached). */
  depth(reached: number): void;
  /** Which of the four bounds ended the walk. */
  stop(reason: "drained" | "deadline" | "limit"): void;
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
  /** Optional forensic sink; the crawler records robots/host/reject detail here. */
  crawlTrace?: CrawlTraceSink;
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
