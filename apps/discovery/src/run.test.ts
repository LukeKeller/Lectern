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
import { runDiscovery, type DiscoveryClient } from "./run";
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

  constructor(opts?: {
    config?: DiscoveryConfig;
    profile?: DiscoveryProfile;
    seed?: DiscoverySeed;
    votes?: UnprocessedVotesResponse["votes"];
  }) {
    this.config = opts?.config ?? baseConfig;
    this.profile = opts?.profile ?? emptyProfile();
    this.seed = opts?.seed ?? seed;
    this.votes = opts?.votes ?? [];
  }

  private stubRun(id: string): DiscoveryRun {
    const now = new Date().toISOString();
    return {
      id,
      status: "running",
      stage: "",
      trigger: "manual",
      stats: { fetched: 0, deduped: 0, scored: 0, inserted: 0, perFetcher: {} },
      error: null,
      startedAt: now,
      updatedAt: now,
      finishedAt: null,
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
    return this.stubRun(id);
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
      { url: "https://a.com/rust", title: "Rust memory safety", excerpt: "systems programming in rust", fetcher: "searxng" },
      { url: "https://b.com/db", title: "Postgres indexes", excerpt: "databases and query planning", fetcher: "searxng" },
      { url: "https://c.com/cooking", title: "Sourdough bread", excerpt: "baking recipes and dough", fetcher: "searxng" },
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
      { url: "https://a.com/rust", title: "Rust safety", excerpt: "systems rust", fetcher: "searxng" },
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
        { id: 1, candidateId: "c1", value: "up", termVector: { rust: 1, safety: 1 }, createdAt: "2026-01-01" },
        { id: 2, candidateId: "c2", value: "down", termVector: { spam: 1 }, createdAt: "2026-01-01" },
      ],
    });

    await runDiscovery(client, { trigger: "manual", fetchers: [] });

    // A profile PUT recorded the processed vote ids.
    const votePut = client.putProfiles.find((p) => p.processedVoteIds.length > 0);
    expect(votePut?.processedVoteIds).toEqual([1, 2]);
  });
});
