import { describe, expect, it } from "vitest";
import type {
  CreateCandidatesRequest,
  CreateCandidatesResponse,
  CreateRunRequest,
  DiscoveryConfig,
  DiscoveryProfile,
  DiscoveryRun,
  DiscoverySeed,
  PutDiscoveryProfileRequest,
  UnprocessedVotesResponse,
  UpdateRunRequest,
} from "@lectern/shared";
import type { ExtractContentResponse } from "@lectern/shared";
import { runDiscovery, recency, whyThisTerms, hostMuted, type DiscoveryClient } from "./run";
import type { Fetcher, RawCandidate } from "./fetchers";

const baseConfig: DiscoveryConfig = {
  enabled: true,
  topics: ["rust", "databases"],
  seedUrls: [],
  fetchers: { searxng: true, brave: false, crawl: false },
  schedule: "0 */6 * * *",
  searxngUrl: "http://searx.local",
  crawlDepth: 1,
  crawlTimeMs: 30000,
  rocchio: { a: 1, b: 0.75, c: 0.25 },
  targetCount: 2,
  braveApiKey: "",
  freshnessHalfLifeDays: 14,
  // Default OFF so the base pipeline tests exercise the snippet-only path; the
  // full-text pass has its own dedicated test.
  fullText: false,
  fullTextCandidates: 12,
  mutedDomains: [],
  followDismissed: [],
};

function emptyProfile(): DiscoveryProfile {
  return {
    name: "default",
    vector: {},
    idf: {},
    docCount: 0,
    seededAt: null,
    updatedAt: null,
    lastVoteProcessedAt: null,
  };
}

const seed: DiscoverySeed = {
  docs: [
    { text: "rust programming memory safety systems", weight: 2 },
    { text: "postgres databases query planning indexes", weight: 1 },
  ],
  tags: [{ name: "rust", weight: 3 }],
};

/** In-memory Lectern client that records every call. */
class FakeClient implements DiscoveryClient {
  config: DiscoveryConfig;
  profile: DiscoveryProfile;
  seed: DiscoverySeed;
  votes: UnprocessedVotesResponse["votes"];

  stages: string[] = [];
  statuses: string[] = [];
  putProfiles: PutDiscoveryProfileRequest[] = [];
  created: CreateCandidatesRequest | null = null;
  /** The forensic trace from the last update that carried one. */
  lastTrace: UpdateRunRequest["trace"] | null = null;
  /** URL -> canned extraction result (null = extraction "failed"). */
  extracts: Record<string, ExtractContentResponse["result"]>;
  extractCalls: string[] = [];

  constructor(opts?: {
    config?: DiscoveryConfig;
    profile?: DiscoveryProfile;
    seed?: DiscoverySeed;
    votes?: UnprocessedVotesResponse["votes"];
    extracts?: Record<string, ExtractContentResponse["result"]>;
  }) {
    this.config = opts?.config ?? baseConfig;
    this.profile = opts?.profile ?? emptyProfile();
    this.seed = opts?.seed ?? seed;
    this.votes = opts?.votes ?? [];
    this.extracts = opts?.extracts ?? {};
  }

  private stubRun(id: string): DiscoveryRun {
    const now = new Date().toISOString();
    return {
      id,
      status: "running",
      stage: "",
      trigger: "manual",
      stats: { fetched: 0, deduped: 0, scored: 0, extracted: 0, inserted: 0, perFetcher: {} },
      error: null,
      startedAt: now,
      updatedAt: now,
      finishedAt: null,
      trace: null,
    };
  }

  async getDiscoveryConfig(): Promise<DiscoveryConfig> {
    return this.config;
  }
  async getDiscoveryProfile(): Promise<DiscoveryProfile> {
    return this.profile;
  }
  async putDiscoveryProfile(body: PutDiscoveryProfileRequest): Promise<DiscoveryProfile> {
    this.putProfiles.push(body);
    this.profile = body.profile;
    return body.profile;
  }
  async getDiscoverySeed(): Promise<DiscoverySeed> {
    return this.seed;
  }
  async listUnprocessedVotes(): Promise<UnprocessedVotesResponse> {
    return { votes: this.votes };
  }
  async createCandidates(body: CreateCandidatesRequest): Promise<CreateCandidatesResponse> {
    this.created = body;
    return { inserted: body.candidates.length, skipped: 0 };
  }
  async createDiscoveryRun(body: CreateRunRequest): Promise<DiscoveryRun> {
    this.stages.push(body.stage);
    return this.stubRun(body.id);
  }
  async updateDiscoveryRun(id: string, body: UpdateRunRequest): Promise<DiscoveryRun> {
    if (body.stage) this.stages.push(body.stage);
    if (body.status) this.statuses.push(body.status);
    if (body.trace) this.lastTrace = body.trace;
    return this.stubRun(id);
  }
  async extractContent(url: string): Promise<ExtractContentResponse["result"]> {
    this.extractCalls.push(url);
    return this.extracts[url] ?? null;
  }
}

function fakeFetcher(name: "searxng" | "brave" | "crawl", results: RawCandidate[]): Fetcher {
  return {
    name,
    enabled: () => true,
    fetch: async () => results,
  };
}

function throwingFetcher(name: "searxng" | "brave" | "crawl"): Fetcher {
  return {
    name,
    enabled: () => true,
    fetch: async () => {
      throw new Error("boom");
    },
  };
}

describe("runDiscovery", () => {
  it("progresses through the expected stage sequence and posts scored candidates", async () => {
    const client = new FakeClient();
    const searxng = fakeFetcher("searxng", [
      {
        url: "https://a.com/rust",
        title: "Rust memory safety",
        excerpt: "systems programming in rust",
        fetcher: "searxng",
      },
      {
        url: "https://b.com/db",
        title: "Postgres indexes",
        excerpt: "databases and query planning",
        fetcher: "searxng",
      },
      {
        url: "https://c.com/cooking",
        title: "Sourdough bread",
        excerpt: "baking recipes and dough",
        fetcher: "searxng",
      },
    ]);

    const res = await runDiscovery(client, { trigger: "manual", fetchers: [searxng] });

    expect(res.status).toBe("succeeded");
    // Seeded (empty profile) -> votes -> fetch -> dedupe -> score -> insert -> done.
    expect(client.stages).toEqual([
      "loading profile",
      "seeded",
      "applying votes",
      "fetching",
      "dedupe",
      "scoring",
      "inserting",
      "done",
    ]);
    expect(client.statuses).toEqual(["succeeded"]);

    // targetCount = 2, so only the two top-scored candidates are posted.
    expect(client.created?.candidates).toHaveLength(2);
    const urls = client.created?.candidates.map((c) => c.url) ?? [];
    // The cooking article is least relevant to a rust/databases profile and
    // must not be in the top 2.
    expect(urls).not.toContain("https://c.com/cooking");
    // Every posted candidate carries a runId, a score, and its term vector.
    for (const c of client.created?.candidates ?? []) {
      expect(c.runId).toMatch(/^run:/);
      expect(typeof c.score).toBe("number");
      expect(c.termVector).toBeTypeOf("object");
    }
  });

  it("does not abort when a fetcher throws", async () => {
    const client = new FakeClient();
    const good = fakeFetcher("searxng", [
      {
        url: "https://a.com/rust",
        title: "Rust safety",
        excerpt: "systems rust",
        fetcher: "searxng",
      },
    ]);
    const bad = throwingFetcher("brave");

    const res = await runDiscovery(client, { trigger: "manual", fetchers: [bad, good] });

    expect(res.status).toBe("succeeded");
    expect(client.statuses).toEqual(["succeeded"]);
    // The good fetcher's single candidate still made it through.
    expect(client.created?.candidates.map((c) => c.url)).toContain("https://a.com/rust");
  });

  it("short-circuits to succeeded/disabled when discovery is off", async () => {
    const client = new FakeClient({ config: { ...baseConfig, enabled: false } });
    const res = await runDiscovery(client, { trigger: "cron", fetchers: [] });
    expect(res.status).toBe("succeeded");
    expect(client.stages).toEqual(["loading profile", "disabled"]);
    expect(client.created).toBeNull();
  });

  it("folds votes into the profile and marks them processed", async () => {
    const client = new FakeClient({
      profile: { ...emptyProfile(), vector: { rust: 1 }, idf: { rust: 1 } },
      votes: [
        {
          id: 1,
          candidateId: "c1",
          value: "up",
          termVector: { rust: 1, safety: 1 },
          createdAt: "2026-01-01",
        },
        {
          id: 2,
          candidateId: "c2",
          value: "down",
          termVector: { spam: 1 },
          createdAt: "2026-01-01",
        },
      ],
    });

    await runDiscovery(client, { trigger: "manual", fetchers: [] });

    // A profile PUT recorded the processed vote ids.
    const votePut = client.putProfiles.find((p) => p.processedVoteIds.length > 0);
    expect(votePut?.processedVoteIds).toEqual([1, 2]);
  });

  it("attaches readable why-this terms to inserted candidates", async () => {
    const client = new FakeClient();
    const searxng = fakeFetcher("searxng", [
      {
        url: "https://a.com/rust",
        title: "Rust memory safety",
        excerpt: "systems programming in rust",
        fetcher: "searxng",
      },
      {
        url: "https://b.com/db",
        title: "Postgres indexes",
        excerpt: "databases and query planning",
        fetcher: "searxng",
      },
    ]);

    await runDiscovery(client, { trigger: "manual", fetchers: [searxng] });

    const rust = client.created?.candidates.find((c) => c.url === "https://a.com/rust");
    // "rust" overlaps the profile and maps back to its readable surface form.
    expect(rust?.matchedTerms).toContain("rust");
  });

  it("re-ranks the shortlist on extracted full text and counts extractions", async () => {
    const client = new FakeClient({
      config: { ...baseConfig, fullText: true, fullTextCandidates: 5, targetCount: 1 },
      extracts: {
        // The snippet looks off-topic, but the full body is squarely on-profile,
        // so extraction promotes it to the top.
        "https://a.com/sleeper": {
          url: "https://a.com/sleeper",
          text: "rust rust rust memory safety systems programming databases query",
          title: "The sleeper",
          siteName: "Sleeper Blog",
          author: null,
          publishedAt: null,
          imageUrl: null,
        },
      },
    });
    const searxng = fakeFetcher("searxng", [
      { url: "https://a.com/sleeper", excerpt: "a vague blurb", fetcher: "searxng" },
      {
        url: "https://b.com/db",
        title: "Postgres indexes",
        excerpt: "databases and query planning",
        fetcher: "searxng",
      },
    ]);

    await runDiscovery(client, { trigger: "manual", fetchers: [searxng] });

    expect(client.stages).toContain("extracting full text");
    // Both shortlisted URLs were offered to the extractor.
    expect(client.extractCalls).toContain("https://a.com/sleeper");
    // targetCount=1 and full text promoted the sleeper to the top.
    expect(client.created?.candidates).toHaveLength(1);
    expect(client.created?.candidates[0]?.url).toBe("https://a.com/sleeper");
    // Its title was backfilled from the extract, and termVector is the full-text tf.
    expect(client.created?.candidates[0]?.title).toBe("The sleeper");
    expect(client.created?.candidates[0]?.termVector).toHaveProperty("rust");
  });

  it("drops candidates from muted domains before scoring", async () => {
    const client = new FakeClient({
      config: { ...baseConfig, mutedDomains: ["spam.com"] },
    });
    const searxng = fakeFetcher("searxng", [
      {
        url: "https://a.com/rust",
        title: "Rust safety",
        excerpt: "systems rust",
        fetcher: "searxng",
      },
      {
        url: "https://spam.com/rust",
        title: "Rust safety",
        excerpt: "systems rust",
        fetcher: "searxng",
      },
      {
        url: "https://sub.spam.com/rust",
        title: "Rust safety",
        excerpt: "systems rust",
        fetcher: "searxng",
      },
    ]);

    await runDiscovery(client, { trigger: "manual", fetchers: [searxng] });

    const urls = client.created?.candidates.map((c) => c.url) ?? [];
    expect(urls).toContain("https://a.com/rust");
    expect(urls).not.toContain("https://spam.com/rust");
    expect(urls).not.toContain("https://sub.spam.com/rust");
  });

  it("captures a forensic trace: queries, per-source detail, crawl internals, scoring funnel", async () => {
    const client = new FakeClient({ config: { ...baseConfig, mutedDomains: ["spam.com"] } });
    const searxng = fakeFetcher("searxng", [
      { url: "https://a.com/rust", title: "Rust safety", excerpt: "systems rust", fetcher: "searxng" },
      { url: "https://a.com/rust", title: "Rust safety dup", excerpt: "dup", fetcher: "searxng" },
      { url: "https://spam.com/x", title: "Spam", excerpt: "muted", fetcher: "searxng" },
      { url: "https://c.com/cooking", title: "Sourdough", excerpt: "baking dough", fetcher: "searxng" },
    ]);
    const brave = throwingFetcher("brave");
    // A stand-in crawler that reports through the sink exactly as the real one does.
    const crawl: Fetcher = {
      name: "crawl",
      enabled: () => true,
      fetch: async (ctx) => {
        ctx.crawlTrace?.seeds(["https://blog.example/hub"]);
        ctx.crawlTrace?.visit("blog.example", "restricted");
        ctx.crawlTrace?.depth(1);
        ctx.crawlTrace?.fetched();
        ctx.crawlTrace?.emitted();
        ctx.crawlTrace?.reject("https://blog.example/about", "non-content");
        ctx.crawlTrace?.robotsBlocked("blog.example");
        ctx.crawlTrace?.stop("deadline");
        return [
          { url: "https://blog.example/post-1", title: "Rust async runtime", excerpt: "rust systems", fetcher: "crawl" },
        ];
      },
    };

    await runDiscovery(client, { trigger: "manual", fetchers: [searxng, brave, crawl] });

    const trace = client.lastTrace;
    expect(trace).toBeTruthy();
    if (!trace) throw new Error("no trace");

    // Queries + profile terms recorded.
    expect(trace.queries).toEqual(baseConfig.topics);
    expect(trace.profileTerms.length).toBeGreaterThan(0);

    // Per-source detail: searxng ok with results, brave errored, crawl ok.
    const byName = Object.fromEntries(trace.fetchers.map((f) => [f.name, f]));
    expect(byName.searxng?.ok).toBe(true);
    expect(byName.searxng?.results.length).toBeGreaterThan(0);
    expect(byName.brave?.ok).toBe(false);
    expect(byName.brave?.error).toContain("boom");
    expect(byName.crawl?.count).toBe(1);

    // Crawl internals threaded through the sink.
    expect(trace.crawl?.stopReason).toBe("deadline");
    expect(trace.crawl?.seeds).toEqual(["https://blog.example/hub"]);
    const host = trace.crawl?.hosts.find((h) => h.host === "blog.example");
    expect(host?.robots).toBe("restricted");
    expect(host?.robotsBlocked).toBe(1);
    expect(trace.crawl?.rejections.some((r) => r.reason === "non-content")).toBe(true);

    // Scoring funnel: dedupe + mute counted, candidates ranked, top ones selected.
    expect(trace.dedupeDropped).toBe(1); // the duplicate a.com/rust
    expect(trace.mutedDropped).toContain("spam.com");
    expect(trace.candidates.length).toBeGreaterThan(0);
    expect(trace.candidates[0]?.rank).toBe(1);
    expect(trace.candidates.some((c) => c.selected)).toBe(true);
    // A selected candidate carries its readable why-this terms.
    expect(trace.candidates.find((c) => c.selected)?.matchedTerms.length).toBeGreaterThan(0);
  });
});

describe("recency", () => {
  const now = new Date("2026-07-09T00:00:00Z");

  it("returns ~1 for a just-published item", () => {
    expect(recency(now.toISOString(), 14, now)).toBeCloseTo(1, 5);
  });

  it("halves at one half-life", () => {
    const twoWeeksAgo = new Date(now.getTime() - 14 * 86_400_000).toISOString();
    expect(recency(twoWeeksAgo, 14, now)).toBeCloseTo(0.5, 5);
  });

  it("floors old items at 0.3", () => {
    const ancient = new Date(now.getTime() - 365 * 86_400_000).toISOString();
    expect(recency(ancient, 14, now)).toBe(0.3);
  });

  it("gives undated and unparseable items a neutral 0.6", () => {
    expect(recency(null, 14, now)).toBe(0.6);
    expect(recency(undefined, 14, now)).toBe(0.6);
    expect(recency("not a date", 14, now)).toBe(0.6);
  });
});

describe("whyThisTerms", () => {
  it("ranks profile-overlapping terms by weight product and maps to surface forms", () => {
    const candidate = { rust: 0.5, connect: 0.4, spam: 0.9 };
    const profile = { rust: 0.8, connect: 0.3 }; // spam not in profile -> excluded
    const surface = { rust: "rust", connect: "connection" };
    const out = whyThisTerms(candidate, profile, surface, 5);
    // rust (0.5*0.8=0.40) outranks connect (0.4*0.3=0.12); spam is dropped.
    expect(out).toEqual(["rust", "connection"]);
  });

  it("dedupes surface forms and honors the limit", () => {
    const candidate = { run: 0.5, runn: 0.4, jump: 0.2 };
    const profile = { run: 1, runn: 1, jump: 1 };
    const surface = { run: "running", runn: "running", jump: "jump" };
    expect(whyThisTerms(candidate, profile, surface, 5)).toEqual(["running", "jump"]);
    expect(whyThisTerms(candidate, profile, surface, 1)).toEqual(["running"]);
  });
});

describe("hostMuted", () => {
  it("matches exact host and subdomains, case-insensitively", () => {
    expect(hostMuted("spam.com", ["spam.com"])).toBe(true);
    expect(hostMuted("sub.spam.com", ["spam.com"])).toBe(true);
    expect(hostMuted("SPAM.COM", ["spam.com"])).toBe(true);
    expect(hostMuted("notspam.com", ["spam.com"])).toBe(false);
    expect(hostMuted("spam.com.evil.com", ["spam.com"])).toBe(false);
    expect(hostMuted("a.com", [])).toBe(false);
  });
});
