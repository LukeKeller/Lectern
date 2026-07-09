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
  PutDiscoveryProfileRequest,
  RunStatus,
  RunTrigger,
  TermVector,
  UnprocessedVotesResponse,
  UpdateRunRequest,
} from "@lectern/shared";
import { buildSeedProfile, cosine, termFrequencies, tfidfVector, tokenize, updateProfile } from "./engine";
import { Seen } from "./dedupe";
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

/** The heaviest `n` terms of a sparse vector, as bare strings. */
function topTerms(vec: TermVector, n: number): string[] {
  return Object.entries(vec)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([term]) => term);
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
  const stats: DiscoveryRunStats = { fetched: 0, deduped: 0, scored: 0, inserted: 0, perFetcher: {} };

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

    // 6. Dedupe by normalized URL.
    await client.updateDiscoveryRun(runId, { stage: "dedupe" });
    const seen = new Seen();
    const unique = raw.filter((c) => seen.add(c.url));
    stats.deduped = unique.length;
    await client.updateDiscoveryRun(runId, { stats });

    // 7. Score each survivor by TF-IDF cosine similarity to the profile.
    await client.updateDiscoveryRun(runId, { stage: "scoring" });
    const scored = unique.map((candidate) => {
      const text = `${candidate.title ?? ""} ${candidate.excerpt ?? ""}`;
      const tf = termFrequencies(tokenize(text));
      const vec = tfidfVector(tf, profile.idf);
      const score = cosine(vec, profile.vector);
      return { candidate, tf, score };
    });
    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, cfg.targetCount);
    stats.scored = scored.length;
    await client.updateDiscoveryRun(runId, { stats });

    const candidates: CreateCandidateInput[] = top.map((s) => ({
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
    }));

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
