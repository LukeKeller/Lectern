import type {
  CandidateTrace,
  CrawlHostTrace,
  CrawlRejectReason,
  CrawlRejection,
  CrawlTrace,
  CreateCandidateInput,
  CreateCandidatesRequest,
  CreateCandidatesResponse,
  CreateRunRequest,
  DiscoveryConfig,
  DiscoveryProfile,
  DiscoveryRun,
  DiscoveryRunStats,
  DiscoverySeed,
  ExtractContentResponse,
  FetcherTrace,
  PutDiscoveryProfileRequest,
  RunStatus,
  RunTrace,
  RunTrigger,
  TermVector,
  UnprocessedVotesResponse,
  UpdateRunRequest,
} from "@lectern/shared";
import {
  buildSeedProfile,
  cosine,
  surfaceForms,
  termFrequencies,
  tfidfVector,
  tokenize,
  updateProfile,
} from "@lectern/shared";
import { normalizeUrl, Seen } from "./dedupe";
import { isoOrUndefined } from "./fetchers/dates";
import {
  allFetchers,
  type CrawlTraceSink,
  type Fetcher,
  type FetchContext,
  type RawCandidate,
} from "./fetchers";

/**
 * The subset of the Lectern API the discovery worker uses. `LecternClient`
 * satisfies this structurally; tests pass an in-memory fake.
 */
export interface DiscoveryClient {
  getDiscoveryConfig(): Promise<DiscoveryConfig>;
  getDiscoveryProfile(): Promise<DiscoveryProfile>;
  putDiscoveryProfile(body: PutDiscoveryProfileRequest): Promise<DiscoveryProfile>;
  getDiscoverySeed(): Promise<DiscoverySeed>;
  listUnprocessedVotes(): Promise<UnprocessedVotesResponse>;
  createCandidates(body: CreateCandidatesRequest): Promise<CreateCandidatesResponse>;
  createDiscoveryRun(body: CreateRunRequest): Promise<DiscoveryRun>;
  updateDiscoveryRun(id: string, body: UpdateRunRequest): Promise<DiscoveryRun>;
  extractContent(url: string): Promise<ExtractContentResponse["result"]>;
}

export interface RunOptions {
  trigger: RunTrigger;
  /** Override the fetcher set (tests). Defaults to the real registry. */
  fetchers?: Fetcher[];
}

export interface RunResult {
  runId: string;
  status: RunStatus;
}

/** How many top profile terms seed the keyword queries. */
const QUERY_TERM_COUNT = 8;
/** Soft per-fetcher candidate cap (a wider pool for ranking; deeper crawls fill it). */
const FETCH_LIMIT = 120;
/** Concurrent full-text extractions in flight (polite to the BFF/Readeck). */
const EXTRACT_CONCURRENCY = 4;
/** Per-URL full-text extraction budget; a slow page falls back to its snippet. */
const EXTRACT_TIMEOUT_MS = 15_000;
/** How many readable "why this?" terms to surface per candidate. */
const WHY_TERM_COUNT = 5;
/** How many raw results per source to keep in the trace (storage bound). */
const TRACE_RESULT_CAP = 50;
/** How many crawler rejections / muted hosts to keep in the trace. */
const TRACE_REJECT_CAP = 300;
/** How many top interest-profile terms to record in the trace. */
const TRACE_PROFILE_TERMS = 20;

/** A scored candidate carried through ranking (and possibly re-scored on full text). */
interface Scored {
  candidate: RawCandidate;
  /** Term-frequency map persisted as the candidate's `termVector` (trains votes). */
  tf: TermVector;
  /** L2-normalized TF-IDF vector, used for the "why this?" overlap. */
  vec: TermVector;
  /** Raw cosine similarity to the profile (the STORED, UI-visible score). */
  score: number;
  /** Freshness multiplier applied to `score` (captured for the trace). */
  recency: number;
  /** cosine × recency — the value we actually rank/truncate by. */
  finalScore: number;
  /** The text scored (title + excerpt, or the full article once extracted). */
  text: string;
}

/**
 * Accumulates the crawler's forensic detail (via the `CrawlTraceSink` it's
 * handed on the FetchContext) into a `CrawlTrace`. Host stats collapse into one
 * row per host; rejections and depth are capped/maxed so a long crawl can't
 * bloat the run record.
 */
function createCrawlAccumulator(): { sink: CrawlTraceSink; build(): CrawlTrace } {
  const hosts = new Map<string, CrawlHostTrace>();
  const rejections: CrawlRejection[] = [];
  const t: Omit<CrawlTrace, "hosts" | "rejections"> = {
    seeds: [],
    stopReason: "drained",
    depthReached: 0,
    pagesFetched: 0,
    pagesSkipped: 0,
    linksEnqueued: 0,
    emitted: 0,
  };
  const host = (h: string): CrawlHostTrace => {
    let e = hosts.get(h);
    if (!e) {
      e = { host: h, visited: 0, robots: "allow-all", robotsBlocked: 0, capHit: false };
      hosts.set(h, e);
    }
    return e;
  };
  const sink: CrawlTraceSink = {
    seeds: (urls) => {
      t.seeds = urls;
    },
    visit: (h, posture) => {
      const e = host(h);
      e.visited++;
      e.robots = posture;
    },
    robotsBlocked: (h) => {
      host(h).robotsBlocked++;
    },
    hostCapHit: (h) => {
      host(h).capHit = true;
    },
    reject: (url, reason: CrawlRejectReason) => {
      if (rejections.length < TRACE_REJECT_CAP) rejections.push({ url, reason });
    },
    enqueued: (n) => {
      t.linksEnqueued += n;
    },
    fetched: () => {
      t.pagesFetched++;
    },
    skipped: () => {
      t.pagesSkipped++;
    },
    emitted: () => {
      t.emitted++;
    },
    depth: (d) => {
      if (d > t.depthReached) t.depthReached = d;
    },
    stop: (r) => {
      t.stopReason = r;
    },
  };
  return { sink, build: () => ({ ...t, hosts: [...hosts.values()], rejections }) };
}

/** The heaviest `n` terms of a sparse vector, as bare strings. */
function topTerms(vec: TermVector, n: number): string[] {
  return Object.entries(vec)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([term]) => term);
}

/**
 * Freshness multiplier: exponential decay `0.5 ** (ageDays / halfLifeDays)`,
 * floored at 0.3 so an old-but-highly-relevant article still surfaces. Undated
 * items get a neutral 0.6 — better than provably stale, worse than fresh.
 */
export function recency(
  publishedAt: string | null | undefined,
  halfLifeDays: number,
  now: Date = new Date(),
): number {
  if (!publishedAt) return 0.6;
  const t = Date.parse(publishedAt);
  if (Number.isNaN(t)) return 0.6;
  const ageDays = Math.max(0, (now.getTime() - t) / 86_400_000);
  const decay = 0.5 ** (ageDays / halfLifeDays);
  return Math.max(0.3, decay);
}

/**
 * The readable "why this?" terms: the heaviest terms present in BOTH the
 * candidate's TF-IDF vector and the interest profile, ranked by the product of
 * their weights and mapped from Porter stems back to surface forms. Deduped,
 * capped at `limit`.
 */
export function whyThisTerms(
  candidateVec: TermVector,
  profileVec: TermVector,
  surface: Record<string, string>,
  limit = WHY_TERM_COUNT,
): string[] {
  const scored: { stem: string; weight: number }[] = [];
  for (const [stem, w] of Object.entries(candidateVec)) {
    const p = profileVec[stem];
    if (p === undefined) continue;
    scored.push({ stem, weight: w * p });
  }
  scored.sort((a, b) => b.weight - a.weight);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const { stem } of scored) {
    const word = surface[stem] ?? stem;
    if (seen.has(word)) continue;
    seen.add(word);
    out.push(word);
    if (out.length >= limit) break;
  }
  return out;
}

/** True when `host` is `domain` or a subdomain of it (case-insensitive). */
export function hostMuted(host: string, muted: string[]): boolean {
  const h = host.toLowerCase();
  return muted.some((raw) => {
    const dom = raw.trim().toLowerCase().replace(/^\.+/, "").replace(/\.+$/, "");
    if (!dom) return false;
    return h === dom || h.endsWith(`.${dom}`);
  });
}

/** Run `fn` over `items` with at most `limit` in flight, preserving order. */
async function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (let i = next++; i < items.length; i = next++) {
      results[i] = await fn(items[i]!, i);
    }
  });
  await Promise.all(workers);
  return results;
}

/** Resolve `p`, or null if it rejects or doesn't settle within `ms`. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise<T | null>((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    const t = timer as unknown as { unref?: () => void };
    if (typeof t.unref === "function") t.unref();
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

/**
 * The full discovery pipeline. Reports live progress by creating a run record
 * up front and patching its stage/stats/status at every step, so Lectern's
 * Activity page can watch. A single fetcher failing is recorded and skipped —
 * it never aborts the run. Any other thrown error marks the run failed
 * (best-effort) and is swallowed so a cron tick can't crash the process.
 */
export async function runDiscovery(client: DiscoveryClient, opts: RunOptions): Promise<RunResult> {
  const runId = `run:${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const trigger = opts.trigger;
  const stats: DiscoveryRunStats = {
    fetched: 0,
    deduped: 0,
    scored: 0,
    extracted: 0,
    inserted: 0,
    perFetcher: {},
  };

  // Forensic trace, accumulated as the pipeline runs and persisted once at the
  // terminal (or failure) update. Held at function scope so the catch can save
  // whatever detail a run gathered before it died. `buildTrace` snapshots it.
  const crawlAcc = createCrawlAccumulator();
  const fetcherTraces: FetcherTrace[] = [];
  const candidateTrace = new Map<string, CandidateTrace>();
  const mutedDropped: string[] = [];
  let traceQueries: string[] = [];
  let profileTerms: RunTrace["profileTerms"] = [];
  let dedupeDropped = 0;
  let crawlEnabled = false;
  const buildTrace = (): RunTrace => ({
    queries: traceQueries,
    profileTerms,
    fetchers: fetcherTraces,
    crawl: crawlEnabled ? crawlAcc.build() : null,
    dedupeDropped,
    mutedDropped,
    candidates: [...candidateTrace.values()].sort((a, b) => a.rank - b.rank),
  });

  // 1. Announce the run.
  await client.createDiscoveryRun({ id: runId, trigger, stage: "loading profile" });

  try {
    // 2. Config gate.
    const cfg = await client.getDiscoveryConfig();
    if (!cfg.enabled) {
      await client.updateDiscoveryRun(runId, { status: "succeeded", stage: "disabled" });
      return { runId, status: "succeeded" };
    }

    // 3. Load (or seed) the interest profile.
    let profile = await client.getDiscoveryProfile();
    if (Object.keys(profile.vector).length === 0) {
      const seed = await client.getDiscoverySeed();
      const built = buildSeedProfile(seed);
      const now = new Date().toISOString();
      profile = {
        ...profile,
        vector: built.vector,
        idf: built.idf,
        docCount: built.docCount,
        seededAt: now,
        updatedAt: now,
      };
      await client.putDiscoveryProfile({ profile, processedVoteIds: [] });
      await client.updateDiscoveryRun(runId, { stage: "seeded" });
    }

    // 4. Fold unprocessed votes into the profile (Rocchio).
    await client.updateDiscoveryRun(runId, { stage: "applying votes" });
    const { votes } = await client.listUnprocessedVotes();
    if (votes.length > 0) {
      const liked = votes.filter((v) => v.value === "up").map((v) => v.termVector);
      const disliked = votes.filter((v) => v.value === "down").map((v) => v.termVector);
      const updatedVector = updateProfile(profile.vector, liked, disliked, cfg.rocchio);
      const now = new Date().toISOString();
      profile = { ...profile, vector: updatedVector, updatedAt: now, lastVoteProcessedAt: now };
      await client.putDiscoveryProfile({ profile, processedVoteIds: votes.map((v) => v.id) });
    }

    // 5. Fetch candidates from every enabled fetcher.
    await client.updateDiscoveryRun(runId, { stage: "fetching" });
    // Prefer the user's topics as queries: they are clean multi-word phrases that
    // make good searches. Only fall back to profile terms when NO topics are set
    // — bare stemmed profile terms ("issu", "vol", "cultur") make terrible
    // single-word queries (they return dictionary/disambiguation pages), so we
    // never mix them in alongside real topics.
    const queries = (
      cfg.topics.length > 0 ? cfg.topics : topTerms(profile.vector, QUERY_TERM_COUNT)
    ).filter((q) => q.trim().length > 0);
    traceQueries = queries;
    profileTerms = Object.entries(profile.vector)
      .sort((a, b) => b[1] - a[1])
      .slice(0, TRACE_PROFILE_TERMS)
      .map(([term, weight]) => ({ term, weight }));
    const registry = opts.fetchers ?? allFetchers;
    crawlEnabled = registry.some((f) => f.name === "crawl" && f.enabled(cfg));
    const ctx: FetchContext = {
      queries,
      seedUrls: cfg.seedUrls,
      limit: FETCH_LIMIT,
      timeBudgetMs: cfg.crawlTimeMs,
      cfg,
      crawlTrace: crawlAcc.sink,
    };
    const raw: RawCandidate[] = [];
    // Iterate the whole registry so the trace records disabled sources too; only
    // enabled ones actually fetch.
    for (const fetcher of registry) {
      if (!fetcher.enabled(cfg)) {
        fetcherTraces.push({
          name: fetcher.name,
          enabled: false,
          ok: true,
          error: null,
          count: 0,
          durationMs: null,
          results: [],
        });
        continue;
      }
      const startedAt = Date.now();
      try {
        const results = await fetcher.fetch(ctx);
        raw.push(...results);
        stats.perFetcher[fetcher.name] = results.length;
        fetcherTraces.push({
          name: fetcher.name,
          enabled: true,
          ok: true,
          error: null,
          count: results.length,
          durationMs: Date.now() - startedAt,
          results: results
            .slice(0, TRACE_RESULT_CAP)
            .map((r) => ({ url: r.url, title: r.title ?? null })),
        });
      } catch (err) {
        // A failing fetcher must NOT fail the run: record 0 and continue.
        stats.perFetcher[fetcher.name] = 0;
        console.error(`[discovery] fetcher "${fetcher.name}" failed:`, err);
        fetcherTraces.push({
          name: fetcher.name,
          enabled: true,
          ok: false,
          error: String(err),
          count: 0,
          durationMs: Date.now() - startedAt,
          results: [],
        });
      }
    }
    stats.fetched = raw.length;
    await client.updateDiscoveryRun(runId, { stats });

    // 6. Dedupe by normalized URL, then drop muted domains BEFORE any scoring.
    await client.updateDiscoveryRun(runId, { stage: "dedupe" });
    const seen = new Seen();
    const unique = raw.filter((c) => seen.add(c.url));
    stats.deduped = unique.length;
    dedupeDropped = raw.length - unique.length;
    const muted = cfg.mutedDomains ?? [];
    const kept =
      muted.length === 0
        ? unique
        : unique.filter((c) => {
            try {
              const host = new URL(c.url).host;
              if (hostMuted(host, muted)) {
                if (mutedDropped.length < TRACE_REJECT_CAP) mutedDropped.push(host);
                return false;
              }
              return true;
            } catch {
              return true; // unparseable URL: leave it for the scorer to handle
            }
          });
    await client.updateDiscoveryRun(runId, { stats });

    // 7. Score every survivor by TF-IDF cosine to the profile, then rank by
    // `cosine * recency` (topical relevance discounted by staleness). The STORED
    // `score` stays the raw cosine — the UI badge shows pure relevance.
    await client.updateDiscoveryRun(runId, { stage: "scoring" });
    const halfLife = cfg.freshnessHalfLifeDays;
    const now = new Date();
    let ranked: Scored[] = kept.map((candidate) => {
      const text = `${candidate.title ?? ""} ${candidate.excerpt ?? ""}`;
      const tf = termFrequencies(tokenize(text));
      const vec = tfidfVector(tf, profile.idf);
      const score = cosine(vec, profile.vector);
      const rec = recency(candidate.publishedAt, halfLife, now);
      return { candidate, tf, vec, score, recency: rec, finalScore: score * rec, text };
    });
    ranked.sort((a, b) => b.finalScore - a.finalScore);
    stats.scored = ranked.length;
    // Snapshot the funnel: one trace row per scored candidate, ranked. The
    // full-text pass (7b) and selection (below) mutate these rows in place.
    ranked.forEach((s, i) => {
      candidateTrace.set(normalizeUrl(s.candidate.url), {
        url: s.candidate.url,
        title: s.candidate.title ?? null,
        fetcher: s.candidate.fetcher,
        cosine: s.score,
        recency: s.recency,
        finalScore: s.finalScore,
        rank: i + 1,
        selected: false,
        extracted: "skipped",
        snippetCosine: s.score,
        fullTextCosine: null,
        matchedTerms: [],
      });
    });
    await client.updateDiscoveryRun(runId, { stats });

    // 7b. Full-text pass: re-rank the pre-ranked shortlist on the extracted
    // article body (a much stronger signal than a search snippet). Only the
    // shortlist is extracted — never every candidate. Extraction failures fall
    // back to the snippet-based result, so this can only improve the ranking.
    if (cfg.fullText && ranked.length > 0) {
      await client.updateDiscoveryRun(runId, { stage: "extracting full text" });
      const shortlist = ranked.slice(0, cfg.fullTextCandidates);
      const extracted = await mapPool(shortlist, EXTRACT_CONCURRENCY, (item) =>
        withTimeout(client.extractContent(item.candidate.url), EXTRACT_TIMEOUT_MS),
      );
      let extractedCount = 0;
      const rescored = shortlist.map((item, i) => {
        const ex = extracted[i];
        if (!ex || !ex.text) {
          // fallback: keep the snippet result, but note the extraction failed.
          const tr = candidateTrace.get(normalizeUrl(item.candidate.url));
          if (tr) tr.extracted = "failed";
          return item;
        }
        extractedCount++;
        const tf = termFrequencies(tokenize(ex.text));
        const vec = tfidfVector(tf, profile.idf);
        const score = cosine(vec, profile.vector);
        // Merge any richer metadata the extractor recovered (candidate wins when
        // it already has a value).
        const candidate: RawCandidate = {
          ...item.candidate,
          title: item.candidate.title ?? ex.title ?? undefined,
          excerpt: item.candidate.excerpt ?? ex.text.slice(0, 280),
          siteName: item.candidate.siteName ?? ex.siteName ?? undefined,
          author: item.candidate.author ?? ex.author ?? undefined,
          imageUrl: item.candidate.imageUrl ?? ex.imageUrl ?? undefined,
          publishedAt: item.candidate.publishedAt ?? isoOrUndefined(ex.publishedAt),
        };
        const rec = recency(candidate.publishedAt, halfLife, now);
        const finalScore = score * rec;
        // The full-text cosine replaces the snippet one as the STORED score;
        // snippetCosine on the trace preserves what the snippet alone scored.
        const tr = candidateTrace.get(normalizeUrl(item.candidate.url));
        if (tr) {
          tr.extracted = "ok";
          tr.fullTextCosine = score;
          tr.cosine = score;
          tr.recency = rec;
          tr.finalScore = finalScore;
        }
        // termVector = FULL-TEXT tf so a later vote trains on the real article.
        return { candidate, tf, vec, score, recency: rec, finalScore, text: ex.text };
      });
      rescored.sort((a, b) => b.finalScore - a.finalScore);
      ranked = rescored;
      // Re-number the shortlist's trace ranks to the post-extract order (1..K).
      // Non-shortlist candidates keep their snapshot ranks, which are all > K.
      rescored.forEach((s, i) => {
        const tr = candidateTrace.get(normalizeUrl(s.candidate.url));
        if (tr) tr.rank = i + 1;
      });
      stats.extracted = extractedCount;
      await client.updateDiscoveryRun(runId, { stats });
    }

    const top = ranked.slice(0, cfg.targetCount);
    const candidates: CreateCandidateInput[] = top.map((s) => {
      // Readable "why this?" terms from whatever text we scored on (full article
      // when extracted, else title + excerpt).
      const matchedTerms = whyThisTerms(s.vec, profile.vector, surfaceForms(s.text));
      // Mark this candidate as selected/inserted in the trace, with its terms.
      const tr = candidateTrace.get(normalizeUrl(s.candidate.url));
      if (tr) {
        tr.selected = true;
        tr.matchedTerms = matchedTerms;
      }
      return {
        url: s.candidate.url,
        title: s.candidate.title ?? null,
        excerpt: s.candidate.excerpt ?? null,
        fetcher: s.candidate.fetcher,
        score: s.score,
        // Persist the candidate's TF map so a later vote can train the profile
        // without re-fetching the page.
        termVector: s.tf,
        runId,
        author: s.candidate.author ?? null,
        siteName: s.candidate.siteName ?? null,
        imageUrl: s.candidate.imageUrl ?? null,
        publishedAt: s.candidate.publishedAt ?? null,
        matchedTerms,
      };
    });

    // 8. Post the top candidates back to the BFF.
    await client.updateDiscoveryRun(runId, { stage: "inserting" });
    const res = await client.createCandidates({ candidates });
    stats.inserted = res.inserted;
    await client.updateDiscoveryRun(runId, { stats });

    // 9. Done — persist the full forensic trace alongside the terminal status.
    await client.updateDiscoveryRun(runId, {
      status: "succeeded",
      stage: "done",
      trace: buildTrace(),
    });
    return { runId, status: "succeeded" };
  } catch (err) {
    // Best-effort failure report; never rethrow (a cron tick must not crash).
    // Save whatever trace the run gathered before it died.
    try {
      await client.updateDiscoveryRun(runId, {
        status: "failed",
        stage: "error",
        error: String(err),
        trace: buildTrace(),
      });
    } catch {
      // ignore — the run record is unreachable
    }
    return { runId, status: "failed" };
  }
}
