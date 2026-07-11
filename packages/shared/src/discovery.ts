import { z } from "zod";
import { Feed } from "./feeds";

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
  /** Domains the user has dismissed from the "follow this source" suggestions. */
  followDismissed: z.array(z.string()).default([]),
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
  followDismissed: z.array(z.string()).optional(),
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

// ---- Run trace (deep, post-hoc forensic detail) -----------------------------
//
// The `stats` counters answer "how many"; the trace answers "what exactly did
// the crawler and searchers do". It is assembled by the worker as the pipeline
// runs and persisted once at the end (or on failure). Every field defaults, so a
// partial trace from a run that died mid-pipeline still parses. It is only ever
// returned by the single-run detail endpoint — never the list/latest views,
// which stay lean.

/** A single raw result a search fetcher returned, before dedupe/scoring. */
export const TraceResult = z.object({
  url: z.string(),
  title: z.string().nullable().default(null),
});
export type TraceResult = z.infer<typeof TraceResult>;

/** What one searcher (searxng/brave) or the crawler did, at a glance. */
export const FetcherTrace = z.object({
  name: z.string(),
  enabled: z.boolean().default(true),
  ok: z.boolean().default(true),
  error: z.string().nullable().default(null),
  count: z.number().int().nonnegative().default(0),
  durationMs: z.number().nonnegative().nullable().default(null),
  /** The raw results this source returned (capped for storage). */
  results: z.array(TraceResult).default([]),
});
export type FetcherTrace = z.infer<typeof FetcherTrace>;

/** How the crawler treated one host it touched. */
export const CrawlHostTrace = z.object({
  host: z.string(),
  /** Pages actually fetched from this host. */
  visited: z.number().int().nonnegative().default(0),
  /** robots.txt posture: no restrictions, some paths blocked, or unreachable. */
  robots: z.enum(["allow-all", "restricted", "unreachable"]).default("allow-all"),
  /** Paths this host's robots.txt disallowed us from fetching. */
  robotsBlocked: z.number().int().nonnegative().default(0),
  /** Whether the per-host visit cap was reached. */
  capHit: z.boolean().default(false),
});
export type CrawlHostTrace = z.infer<typeof CrawlHostTrace>;

/** Why the crawler declined a URL. */
export const CrawlRejectReason = z.enum([
  "robots", // disallowed by robots.txt
  "non-content", // failed isContentUrl (homepage / section / nav / profile)
  "http-error", // non-2xx response
  "fetch-error", // network/parse failure
  "host-cap", // per-host visit cap already reached
]);
export type CrawlRejectReason = z.infer<typeof CrawlRejectReason>;

/** A URL the crawler declined to emit or follow, with the reason. */
export const CrawlRejection = z.object({
  url: z.string(),
  reason: CrawlRejectReason,
});
export type CrawlRejection = z.infer<typeof CrawlRejection>;

/** The crawler's forensic detail for a run. */
export const CrawlTrace = z.object({
  seeds: z.array(z.string()).default([]),
  /** Which of the four bounds ended the walk. */
  stopReason: z.enum(["drained", "deadline", "limit"]).default("drained"),
  depthReached: z.number().int().nonnegative().default(0),
  pagesFetched: z.number().int().nonnegative().default(0),
  /** Pages skipped on a non-2xx / network error. */
  pagesSkipped: z.number().int().nonnegative().default(0),
  linksEnqueued: z.number().int().nonnegative().default(0),
  /** Pages emitted as candidates. */
  emitted: z.number().int().nonnegative().default(0),
  hosts: z.array(CrawlHostTrace).default([]),
  /** A capped sample of declined URLs. */
  rejections: z.array(CrawlRejection).default([]),
});
export type CrawlTrace = z.infer<typeof CrawlTrace>;

/** One candidate's journey through dedupe → scoring → extraction → selection. */
export const CandidateTrace = z.object({
  url: z.string(),
  title: z.string().nullable().default(null),
  fetcher: z.string(),
  /** Raw TF-IDF cosine to the interest profile (the stored, UI-visible score). */
  cosine: z.number().default(0),
  /** Freshness multiplier applied on top of cosine. */
  recency: z.number().default(1),
  /** cosine × recency — the value the pipeline actually ranks by. */
  finalScore: z.number().default(0),
  /** 1-based rank after the final sort. */
  rank: z.number().int().nonnegative().default(0),
  /** Whether it made the top `targetCount` and was inserted. */
  selected: z.boolean().default(false),
  /** Full-text extraction outcome for the shortlist (else "skipped"). */
  extracted: z.enum(["ok", "failed", "skipped"]).default("skipped"),
  /** Cosine on title+excerpt, before any full-text re-rank. */
  snippetCosine: z.number().nullable().default(null),
  /** Cosine on the extracted article body, after re-rank (if extracted). */
  fullTextCosine: z.number().nullable().default(null),
  /** Readable "why this?" overlap terms (selected candidates only). */
  matchedTerms: z.array(z.string()).default([]),
});
export type CandidateTrace = z.infer<typeof CandidateTrace>;

/** The full forensic record of one discovery run. */
export const RunTrace = z.object({
  /** The exact queries issued to the searchers. */
  queries: z.array(z.string()).default([]),
  /** Top interest-profile terms (readable surface form + weight) driving the run. */
  profileTerms: z.array(z.object({ term: z.string(), weight: z.number() })).default([]),
  /** Per-source diagnostics (searxng, brave, crawl). */
  fetchers: z.array(FetcherTrace).default([]),
  /** Crawler internals, or null when the crawler was disabled. */
  crawl: CrawlTrace.nullable().default(null),
  /** Candidates dropped as duplicate URLs before scoring. */
  dedupeDropped: z.number().int().nonnegative().default(0),
  /** Hosts dropped because their domain is muted. */
  mutedDropped: z.array(z.string()).default([]),
  /** Every scored candidate's journey, ranked. */
  candidates: z.array(CandidateTrace).default([]),
});
export type RunTrace = z.infer<typeof RunTrace>;

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
  /** Deep forensic detail. Only populated by the single-run detail endpoint. */
  trace: RunTrace.nullable().default(null),
});
export type DiscoveryRun = z.infer<typeof DiscoveryRun>;

export const DiscoveryRunsResponse = z.object({ runs: z.array(DiscoveryRun) });
export type DiscoveryRunsResponse = z.infer<typeof DiscoveryRunsResponse>;

/** `GET /discovery/runs/latest` — the current/most-recent run, or null if none. */
export const LatestRunResponse = z.object({ run: DiscoveryRun.nullable() });
export type LatestRunResponse = z.infer<typeof LatestRunResponse>;

/** `GET /discovery/runs/:id` — one run WITH its full forensic `trace`, or null. */
export const RunDetailResponse = z.object({ run: DiscoveryRun.nullable() });
export type RunDetailResponse = z.infer<typeof RunDetailResponse>;

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
  /** Full forensic trace, sent once at the terminal (or failure) update. */
  trace: RunTrace.optional(),
});
export type UpdateRunRequest = z.infer<typeof UpdateRunRequest>;

/** Result of the user-facing "Discover now" trigger. `runId` is the run the
 * worker started (for routing to the Activity page), null if it couldn't start. */
export const TriggerRunResponse = z.object({
  triggered: z.boolean(),
  runId: z.string().nullable().default(null),
});
export type TriggerRunResponse = z.infer<typeof TriggerRunResponse>;

// ---- Auto-follow suggestions (user-facing) ---------------------------------

/** A domain the user keeps engaging with (saving/upvoting candidates from) that
 * isn't yet a followed feed — a candidate to subscribe to. */
export const FollowSuggestion = z.object({
  domain: z.string(),
  /** Combined positive signal: #saved + #upvoted candidates from this domain. */
  signalCount: z.number().int().nonnegative(),
  sampleTitles: z.array(z.string()).default([]),
});
export type FollowSuggestion = z.infer<typeof FollowSuggestion>;

export const FollowSuggestionsResponse = z.object({
  suggestions: z.array(FollowSuggestion),
});
export type FollowSuggestionsResponse = z.infer<typeof FollowSuggestionsResponse>;

/** Follow a suggested domain: resolve its feed (MiniFlux autodiscovery from the
 * site URL) and subscribe. */
export const FollowDomainRequest = z.object({ domain: z.string() });
export type FollowDomainRequest = z.infer<typeof FollowDomainRequest>;

export const FollowDomainResponse = z.object({ feed: Feed });
export type FollowDomainResponse = z.infer<typeof FollowDomainResponse>;

/** Dismiss a follow suggestion so it stops being offered. */
export const DismissFollowRequest = z.object({ domain: z.string() });
export type DismissFollowRequest = z.infer<typeof DismissFollowRequest>;

export const DismissFollowResponse = z.object({ dismissed: z.boolean() });
export type DismissFollowResponse = z.infer<typeof DismissFollowResponse>;
