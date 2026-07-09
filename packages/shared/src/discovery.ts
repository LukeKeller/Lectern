import { z } from "zod";

/**
 * Content-discovery contract. A separate `apps/discovery` service finds new
 * web articles relevant to the user's interests, scores them locally with
 * classic IR (TF-IDF + Rocchio relevance feedback — no LLM), and posts the top
 * candidates back to the BFF. Lectern surfaces them in a Discover view where the
 * user votes up/down (signal only) or explicitly saves to Readeck. Votes train
 * the profile so later runs improve.
 *
 * Endpoints split into two audiences (both bearer-gated by `LECTERN_API_TOKEN`):
 * user-facing (called by the SPA) and service-facing (called by the discovery
 * worker). Secrets (Brave key) are write-only in the user-facing settings and
 * only ever returned to the worker via the service-facing config endpoint.
 */

// ---- Primitives -------------------------------------------------------------

export const DiscoveryFetcher = z.enum(["searxng", "brave", "crawl"]);
export type DiscoveryFetcher = z.infer<typeof DiscoveryFetcher>;

export const CandidateStatus = z.enum(["active", "dismissed", "saved"]);
export type CandidateStatus = z.infer<typeof CandidateStatus>;

export const VoteValue = z.enum(["up", "down"]);
export type VoteValue = z.infer<typeof VoteValue>;

/** A sparse term→weight map (TF, TF-IDF, IDF, or a profile vector). */
export const TermVector = z.record(z.string(), z.number());
export type TermVector = z.infer<typeof TermVector>;

// ---- Candidates -------------------------------------------------------------

/** A discovered article surfaced in the Discover view. */
export const DiscoveryCandidate = z.object({
  id: z.string(),
  url: z.url(),
  title: z.string().nullable().default(null),
  excerpt: z.string().nullable().default(null),
  fetcher: DiscoveryFetcher,
  /** Cosine similarity to the profile at insert time (higher = more relevant). */
  score: z.number(),
  status: CandidateStatus,
  /** The user's last vote on this candidate, or null. */
  vote: VoteValue.nullable().default(null),
  runId: z.string().nullable().default(null),
  author: z.string().nullable().default(null),
  siteName: z.string().nullable().default(null),
  imageUrl: z.string().nullable().default(null),
  publishedAt: z.string().nullable().default(null),
  /** Readable ("why this?") terms driving the match — top overlap between the
   * candidate and the interest profile, mapped back to surface forms. */
  matchedTerms: z.array(z.string()).default([]),
  firstSeenAt: z.string(),
});
export type DiscoveryCandidate = z.infer<typeof DiscoveryCandidate>;

export const DiscoveryCandidatesResponse = z.object({
  candidates: z.array(DiscoveryCandidate),
});
export type DiscoveryCandidatesResponse = z.infer<typeof DiscoveryCandidatesResponse>;

export const ListCandidatesQuery = z.object({
  status: CandidateStatus.optional(),
  limit: z.number().int().min(1).max(100).default(50),
});
export type ListCandidatesQuery = z.infer<typeof ListCandidatesQuery>;

/** Cast an up/down vote. `up` keeps the candidate visible (signal only); `down`
 * records the signal and dismisses the candidate. */
export const VoteRequest = z.object({ value: VoteValue });
export type VoteRequest = z.infer<typeof VoteRequest>;

/** Clear candidates off the list WITHOUT training the model (distinct from a
 * down-vote). Omit `ids` to clear every currently-active candidate. */
export const ClearCandidatesRequest = z.object({
  ids: z.array(z.string()).optional(),
});
export type ClearCandidatesRequest = z.infer<typeof ClearCandidatesRequest>;

export const ClearCandidatesResponse = z.object({
  cleared: z.number().int().nonnegative(),
});
export type ClearCandidatesResponse = z.infer<typeof ClearCandidatesResponse>;

/** One candidate the discovery worker wants to insert (deduped by normalized URL
 * server-side). `termVector` is persisted so a later vote can train the model
 * without re-fetching the page. */
export const CreateCandidateInput = z.object({
  url: z.url(),
  title: z.string().nullable().optional(),
  excerpt: z.string().nullable().optional(),
  fetcher: DiscoveryFetcher,
  score: z.number(),
  termVector: TermVector,
  runId: z.string().nullable().optional(),
  author: z.string().nullable().optional(),
  siteName: z.string().nullable().optional(),
  imageUrl: z.string().nullable().optional(),
  publishedAt: z.string().nullable().optional(),
  matchedTerms: z.array(z.string()).optional(),
});
export type CreateCandidateInput = z.infer<typeof CreateCandidateInput>;

export const CreateCandidatesRequest = z.object({
  candidates: z.array(CreateCandidateInput),
});
export type CreateCandidatesRequest = z.infer<typeof CreateCandidatesRequest>;

export const CreateCandidatesResponse = z.object({
  inserted: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
});
export type CreateCandidatesResponse = z.infer<typeof CreateCandidatesResponse>;

// ---- Settings (user-facing) -------------------------------------------------

export const DiscoveryFetcherToggles = z.object({
  searxng: z.boolean().default(true),
  brave: z.boolean().default(false),
  crawl: z.boolean().default(false),
});
export type DiscoveryFetcherToggles = z.infer<typeof DiscoveryFetcherToggles>;

/** Rocchio relevance-feedback weights: profile' = a·profile + b·mean(liked) − c·mean(disliked). */
export const RocchioWeights = z.object({
  a: z.number().default(1),
  b: z.number().default(0.75),
  c: z.number().default(0.25),
});
export type RocchioWeights = z.infer<typeof RocchioWeights>;

/** Discovery settings as seen by the SPA. The Brave API key is write-only and
 * NEVER read back — only whether one is configured (`braveConfigured`). */
export const DiscoverySettings = z.object({
  enabled: z.boolean().default(false),
  topics: z.array(z.string()).default([]),
  seedUrls: z.array(z.string()).default([]),
  fetchers: DiscoveryFetcherToggles.default({ searxng: true, brave: false, crawl: false }),
  schedule: z.string().default("0 */6 * * *"),
  searxngUrl: z.string().default(""),
  braveConfigured: z.boolean().default(false),
  crawlDepth: z.number().int().min(0).max(3).default(1),
  crawlTimeMs: z.number().int().positive().default(30000),
  rocchio: RocchioWeights.default({ a: 1, b: 0.75, c: 0.25 }),
  targetCount: z.number().int().min(1).max(20).default(5),
  /** Recency half-life in days for the freshness decay applied to scores. */
  freshnessHalfLifeDays: z.number().int().positive().default(14),
  /** Re-rank the pre-ranked shortlist on Readeck-extracted full text. */
  fullText: z.boolean().default(true),
  /** How many top snippet-scored candidates to extract full text for (the pre-rank K). */
  fullTextCandidates: z.number().int().min(1).max(50).default(12),
  /** Hosts to never surface candidates from (domain-level mute). */
  mutedDomains: z.array(z.string()).default([]),
});
export type DiscoverySettings = z.infer<typeof DiscoverySettings>;

/** Partial update. `braveApiKey` omitted = leave unchanged; null/"" = clear it. */
export const UpdateDiscoverySettingsRequest = z.object({
  enabled: z.boolean().optional(),
  topics: z.array(z.string()).optional(),
  seedUrls: z.array(z.string()).optional(),
  fetchers: DiscoveryFetcherToggles.optional(),
  schedule: z.string().optional(),
  searxngUrl: z.string().optional(),
  braveApiKey: z.string().nullable().optional(),
  crawlDepth: z.number().int().min(0).max(3).optional(),
  crawlTimeMs: z.number().int().positive().optional(),
  rocchio: RocchioWeights.optional(),
  targetCount: z.number().int().min(1).max(20).optional(),
  freshnessHalfLifeDays: z.number().int().positive().optional(),
  fullText: z.boolean().optional(),
  fullTextCandidates: z.number().int().min(1).max(50).optional(),
  mutedDomains: z.array(z.string()).optional(),
});
export type UpdateDiscoverySettingsRequest = z.infer<typeof UpdateDiscoverySettingsRequest>;

/** Full config as seen by the discovery worker — includes the Brave key. Only
 * ever returned over the service-facing endpoint. */
export const DiscoveryConfig = DiscoverySettings.omit({ braveConfigured: true }).extend({
  braveApiKey: z.string().default(""),
});
export type DiscoveryConfig = z.infer<typeof DiscoveryConfig>;

// ---- Profile + votes (service-facing) --------------------------------------

/** The persisted Rocchio model. */
export const DiscoveryProfile = z.object({
  name: z.string().default("default"),
  vector: TermVector.default({}),
  idf: TermVector.default({}),
  docCount: z.number().int().nonnegative().default(0),
  seededAt: z.string().nullable().default(null),
  updatedAt: z.string().nullable().default(null),
  lastVoteProcessedAt: z.string().nullable().default(null),
});
export type DiscoveryProfile = z.infer<typeof DiscoveryProfile>;

/** Persist the profile AND atomically mark the folded-in votes processed. */
export const PutDiscoveryProfileRequest = z.object({
  profile: DiscoveryProfile,
  processedVoteIds: z.array(z.number().int()).default([]),
});
export type PutDiscoveryProfileRequest = z.infer<typeof PutDiscoveryProfileRequest>;

export const DiscoveryVote = z.object({
  id: z.number().int(),
  candidateId: z.string(),
  value: VoteValue,
  termVector: TermVector,
  createdAt: z.string(),
});
export type DiscoveryVote = z.infer<typeof DiscoveryVote>;

export const UnprocessedVotesResponse = z.object({ votes: z.array(DiscoveryVote) });
export type UnprocessedVotesResponse = z.infer<typeof UnprocessedVotesResponse>;

// ---- Seed corpus (service-facing) ------------------------------------------

export const DiscoverySeedDoc = z.object({ text: z.string(), weight: z.number() });
export type DiscoverySeedDoc = z.infer<typeof DiscoverySeedDoc>;

export const DiscoverySeedTag = z.object({ name: z.string(), weight: z.number() });
export type DiscoverySeedTag = z.infer<typeof DiscoverySeedTag>;

/** The weighted seed corpus the BFF assembles from existing library signals
 * (shortlist, highlights, read items, tags). The worker tokenizes it to build
 * the initial profile, so tokenization stays in one place (the worker). */
export const DiscoverySeed = z.object({
  docs: z.array(DiscoverySeedDoc),
  tags: z.array(DiscoverySeedTag),
});
export type DiscoverySeed = z.infer<typeof DiscoverySeed>;

// ---- Full-text extraction (service-facing) ---------------------------------

/** Ask the BFF to fetch a URL's readable full text. The BFF saves it to Readeck
 * transiently (label `lectern:discover`), pulls the extracted article, and
 * deletes the bookmark — Readeck creds never leave the BFF. */
export const ExtractContentRequest = z.object({ url: z.url() });
export type ExtractContentRequest = z.infer<typeof ExtractContentRequest>;

/** The extracted article, or null if extraction failed (worker falls back to
 * the search snippet). `text` is plain text (HTML stripped). */
export const ExtractContentResponse = z.object({
  result: z
    .object({
      url: z.string(),
      text: z.string(),
      title: z.string().nullable().default(null),
      siteName: z.string().nullable().default(null),
      author: z.string().nullable().default(null),
      publishedAt: z.string().nullable().default(null),
      imageUrl: z.string().nullable().default(null),
    })
    .nullable(),
});
export type ExtractContentResponse = z.infer<typeof ExtractContentResponse>;

// ---- Runs (live progress) ---------------------------------------------------

export const RunStatus = z.enum(["running", "succeeded", "failed"]);
export type RunStatus = z.infer<typeof RunStatus>;

export const RunTrigger = z.enum(["cron", "manual"]);
export type RunTrigger = z.infer<typeof RunTrigger>;

export const DiscoveryRunStats = z.object({
  fetched: z.number().int().nonnegative().default(0),
  deduped: z.number().int().nonnegative().default(0),
  scored: z.number().int().nonnegative().default(0),
  /** Candidates for which full text was extracted and re-scored. */
  extracted: z.number().int().nonnegative().default(0),
  inserted: z.number().int().nonnegative().default(0),
  /** Per-fetcher raw candidate counts, e.g. { searxng: 40, brave: 0 }. */
  perFetcher: z.record(z.string(), z.number()).default({}),
});
export type DiscoveryRunStats = z.infer<typeof DiscoveryRunStats>;

/** One discovery run, updated live by the worker as it progresses. */
export const DiscoveryRun = z.object({
  id: z.string(),
  status: RunStatus,
  /** Human label of the current step (e.g. "querying searxng", "scoring"). */
  stage: z.string(),
  trigger: RunTrigger,
  stats: DiscoveryRunStats,
  error: z.string().nullable().default(null),
  startedAt: z.string(),
  updatedAt: z.string(),
  finishedAt: z.string().nullable().default(null),
});
export type DiscoveryRun = z.infer<typeof DiscoveryRun>;

export const DiscoveryRunsResponse = z.object({ runs: z.array(DiscoveryRun) });
export type DiscoveryRunsResponse = z.infer<typeof DiscoveryRunsResponse>;

/** `GET /discovery/runs/latest` — the current/most-recent run, or null if none. */
export const LatestRunResponse = z.object({ run: DiscoveryRun.nullable() });
export type LatestRunResponse = z.infer<typeof LatestRunResponse>;

export const ListRunsQuery = z.object({
  limit: z.number().int().min(1).max(100).default(20),
});
export type ListRunsQuery = z.infer<typeof ListRunsQuery>;

export const CreateRunRequest = z.object({
  id: z.string(),
  trigger: RunTrigger.default("manual"),
  stage: z.string().default("starting"),
});
export type CreateRunRequest = z.infer<typeof CreateRunRequest>;

export const UpdateRunRequest = z.object({
  stage: z.string().optional(),
  status: RunStatus.optional(),
  stats: DiscoveryRunStats.partial().optional(),
  error: z.string().nullable().optional(),
});
export type UpdateRunRequest = z.infer<typeof UpdateRunRequest>;

/** Result of the user-facing "Discover now" trigger. `runId` is the run the
 * worker started (for routing to the Activity page), null if it couldn't start. */
export const TriggerRunResponse = z.object({
  triggered: z.boolean(),
  runId: z.string().nullable().default(null),
});
export type TriggerRunResponse = z.infer<typeof TriggerRunResponse>;
