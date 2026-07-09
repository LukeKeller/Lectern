import type {
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
  PutDiscoveryProfileRequest,
  RunStatus,
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
import { Seen } from "./dedupe";
import { isoOrUndefined } from "./fetchers/dates";
import { allFetchers, type Fetcher, type FetchContext, type RawCandidate } from "./fetchers";

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

/** A scored candidate carried through ranking (and possibly re-scored on full text). */
interface Scored {
  candidate: RawCandidate;
  /** Term-frequency map persisted as the candidate's `termVector` (trains votes). */
  tf: TermVector;
  /** L2-normalized TF-IDF vector, used for the "why this?" overlap. */
  vec: TermVector;
  /** Raw cosine similarity to the profile (the STORED, UI-visible score). */
  score: number;
  /** cosine × recency — the value we actually rank/truncate by. */
  finalScore: number;
  /** The text scored (title + excerpt, or the full article once extracted). */
  text: string;
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
    const fetchers = (opts.fetchers ?? allFetchers).filter((f) => f.enabled(cfg));
    const ctx: FetchContext = {
      queries,
      seedUrls: cfg.seedUrls,
      limit: FETCH_LIMIT,
      timeBudgetMs: cfg.crawlTimeMs,
      cfg,
    };
    const raw: RawCandidate[] = [];
    for (const fetcher of fetchers) {
      try {
        const results = await fetcher.fetch(ctx);
        raw.push(...results);
        stats.perFetcher[fetcher.name] = results.length;
      } catch (err) {
        // A failing fetcher must NOT fail the run: record 0 and continue.
        stats.perFetcher[fetcher.name] = 0;
        console.error(`[discovery] fetcher "${fetcher.name}" failed:`, err);
      }
    }
    stats.fetched = raw.length;
    await client.updateDiscoveryRun(runId, { stats });

    // 6. Dedupe by normalized URL, then drop muted domains BEFORE any scoring.
    await client.updateDiscoveryRun(runId, { stage: "dedupe" });
    const seen = new Seen();
    const unique = raw.filter((c) => seen.add(c.url));
    stats.deduped = unique.length;
    const muted = cfg.mutedDomains ?? [];
    const kept =
      muted.length === 0
        ? unique
        : unique.filter((c) => {
            try {
              return !hostMuted(new URL(c.url).host, muted);
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
      const finalScore = score * recency(candidate.publishedAt, halfLife, now);
      return { candidate, tf, vec, score, finalScore, text };
    });
    ranked.sort((a, b) => b.finalScore - a.finalScore);
    stats.scored = ranked.length;
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
        if (!ex || !ex.text) return item; // fallback: keep the snippet result
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
        const finalScore = score * recency(candidate.publishedAt, halfLife, now);
        // termVector = FULL-TEXT tf so a later vote trains on the real article.
        return { candidate, tf, vec, score, finalScore, text: ex.text };
      });
      rescored.sort((a, b) => b.finalScore - a.finalScore);
      ranked = rescored;
      stats.extracted = extractedCount;
      await client.updateDiscoveryRun(runId, { stats });
    }

    const top = ranked.slice(0, cfg.targetCount);
    const candidates: CreateCandidateInput[] = top.map((s) => {
      // Readable "why this?" terms from whatever text we scored on (full article
      // when extracted, else title + excerpt).
      const matchedTerms = whyThisTerms(s.vec, profile.vector, surfaceForms(s.text));
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

    // 9. Done.
    await client.updateDiscoveryRun(runId, { status: "succeeded", stage: "done" });
    return { runId, status: "succeeded" };
  } catch (err) {
    // Best-effort failure report; never rethrow (a cron tick must not crash).
    try {
      await client.updateDiscoveryRun(runId, {
        status: "failed",
        stage: "error",
        error: String(err),
      });
    } catch {
      // ignore — the run record is unreachable
    }
    return { runId, status: "failed" };
  }
}
