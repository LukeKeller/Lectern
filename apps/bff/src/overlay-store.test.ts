import { Card } from "@lectern/shared";
import { inArray } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { documents } from "./db/schema";
import {
  backendTruthSet,
  buildTagCentroids,
  cardFromRow,
  DrizzleOverlayStore,
  groupFollowSuggestions,
  OVERLAY_COLUMNS,
  rankRelated,
  rerankSearchHits,
  salientSurfaceTerms,
  suggestTagsFromCentroids,
  type RankableHit,
} from "./overlay-store";
import { termFrequencies, tokenize } from "@lectern/shared";
import { is, SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import type { DocumentRow } from "./db/schema";

/**
 * Build an index row whose stored backend card is `card`. The card is placed in
 * `metadata.card` verbatim so we can inject deliberately invalid cards (e.g. an
 * empty `url`) and assert the read-path guard drops them instead of throwing.
 */
function rowFromStoredCard(card: Record<string, unknown>): DocumentRow {
  return {
    id: String(card.id ?? "miniflux:1"),
    source: String(card.source ?? "miniflux"),
    sourceId: String(card.sourceId ?? "1"),
    category: String(card.category ?? "rss"),
    location: String(card.location ?? "feed"),
    readProgress: 0,
    readAnchor: null,
    tags: [],
    note: null,
    title: (card.title as string) ?? null,
    url: (card.url as string) ?? null,
    metadata: { card },
    savedAt: new Date("2026-06-03T00:00:00Z"),
    updatedAt: new Date("2026-06-03T00:00:00Z"),
    deletedAt: null,
  };
}

const validCard = {
  id: "miniflux:1",
  source: "miniflux",
  sourceId: "1",
  category: "rss",
  location: "feed",
  readState: "unopened",
  title: "Hello",
  author: null,
  siteName: "Blog",
  url: "https://example.com/post",
  wordCount: null,
  readingTimeMinutes: null,
  readingProgress: 0,
  readAnchor: null,
  tags: [],
  highlightCount: 0,
  note: null,
  savedAt: "2026-06-03T00:00:00Z",
  updatedAt: "2026-06-03T00:00:00Z",
};

describe("DrizzleOverlayStore.getTtsConfig", () => {
  // Minimal chainable stub for `db.select(...).from(...).where(...)` → rows.
  const store = (value: unknown) =>
    new DrizzleOverlayStore({
      select: () => ({
        from: () => ({ where: async () => (value === undefined ? [] : [{ value }]) }),
      }),
    } as never);

  it("preserves the piper provider on read (does not coerce to elevenlabs)", async () => {
    const cfg = await store({
      provider: "piper",
      voiceId: "en_US-lessac-medium",
      modelId: "",
      apiKey: null,
    }).getTtsConfig();
    expect(cfg.provider).toBe("piper");
    expect(cfg.voiceId).toBe("en_US-lessac-medium");
  });

  it("preserves kokoro", async () => {
    expect((await store({ provider: "kokoro" }).getTtsConfig()).provider).toBe("kokoro");
  });

  it("falls back to elevenlabs for an unknown/legacy provider", async () => {
    expect((await store({ provider: "bogus" }).getTtsConfig()).provider).toBe("elevenlabs");
  });
});

describe("DrizzleOverlayStore.findByAnyUrl", () => {
  // Minimal chainable stub for
  // `db.select(...).from(...).where(...).orderBy(...).limit(...)`, capturing the
  // built WHERE so the query shape can be asserted.
  //
  // The stub APPLIES the ordering rather than ignoring it: rows come back
  // live-first (deleted_at nulls first), newest id breaking ties, exactly as
  // Postgres would. Without that the "prefers a live row" test below would pass
  // against an unordered `limit 1`, which is the bug it exists to catch. Leaving
  // the `orderBy` off the query entirely also breaks the chain, so it cannot be
  // silently dropped.
  const store = (rows: unknown[], captured: unknown[] = []) =>
    new DrizzleOverlayStore({
      select: () => ({
        from: () => ({
          where: (w: unknown) => {
            captured.push(w);
            return {
              orderBy: () => ({
                limit: async (n: number) =>
                  [...(rows as { id: string; deletedAt: Date | null }[])]
                    .sort(
                      (a, b) =>
                        Number(a.deletedAt !== null) - Number(b.deletedAt !== null) ||
                        b.id.localeCompare(a.id),
                    )
                    .slice(0, n),
              }),
            };
          },
        }),
      }),
    } as never);

  const urls = ["https://newsletter.lectern.local/abc"];

  it("returns null when no document holds any of the urls", async () => {
    expect(await store([]).findByAnyUrl(urls)).toBeNull();
  });

  it("reports a live row as not deleted", async () => {
    expect(await store([{ id: "readeck:42", deletedAt: null }]).findByAnyUrl(urls)).toEqual({
      id: "readeck:42",
      deleted: false,
    });
  });

  it("still matches a soft-deleted row, flagged as deleted", async () => {
    // The delete must stay sticky: a tombstoned newsletter is still "already
    // seen", so ingestion skips it instead of resurrecting it on the next replay.
    expect(
      await store([{ id: "readeck:42", deletedAt: new Date("2026-07-01T00:00:00Z") }]).findByAnyUrl(
        urls,
      ),
    ).toEqual({ id: "readeck:42", deleted: true });
  });

  it("prefers a live row when a tombstoned duplicate shares the url", async () => {
    // Duplicates under one URL exist in production — that is the bug this whole
    // effort is fixing — and an unordered `limit 1` picked an arbitrary one. A
    // live document reported as `deleted: true` is not a cosmetic error: it is
    // the answer ingestion and the reader both act on.
    const rows = [
      { id: "readeck:9", deletedAt: new Date("2026-07-01T00:00:00Z") },
      { id: "readeck:42", deletedAt: null },
    ];

    expect(await store(rows).findByAnyUrl(urls)).toEqual({ id: "readeck:42", deleted: false });
    // Order of arrival must not matter.
    expect(await store([...rows].reverse()).findByAnyUrl(urls)).toEqual({
      id: "readeck:42",
      deleted: false,
    });
  });

  it("still reports deleted when every duplicate is tombstoned", async () => {
    const rows = [
      { id: "readeck:9", deletedAt: new Date("2026-07-01T00:00:00Z") },
      { id: "readeck:42", deletedAt: new Date("2026-07-02T00:00:00Z") },
    ];

    expect(await store(rows).findByAnyUrl(urls)).toEqual({ id: "readeck:9", deleted: true });
  });

  it("short-circuits on an empty url list instead of querying", async () => {
    const captured: unknown[] = [];
    expect(
      await store([{ id: "readeck:42", deletedAt: null }], captured).findByAnyUrl([]),
    ).toBeNull();
    expect(captured).toEqual([]);
  });

  it("builds one index-friendly IN (...) predicate for all candidate urls", async () => {
    // Not an OR-chain and not a LIKE: `url IN (...)` still rides documents_url_idx.
    const captured: unknown[] = [];
    await store([], captured).findByAnyUrl([
      "https://newsletter.lectern.local/a%40b.com",
      "https://newsletter.lectern.local/a@b.com",
    ]);
    expect(captured).toHaveLength(1);
    expect(captured[0]).toEqual(
      inArray(documents.url, [
        "https://newsletter.lectern.local/a%40b.com",
        "https://newsletter.lectern.local/a@b.com",
      ]),
    );
  });
});

describe("cardFromRow", () => {
  afterEach(() => vi.restoreAllMocks());

  it("reconstructs a valid card from an index row", () => {
    const card = cardFromRow(rowFromStoredCard(validCard), 0);
    expect(card).not.toBeNull();
    expect(() => Card.parse(card)).not.toThrow();
    expect(card?.url).toBe("https://example.com/post");
  });

  it("drops a poisoned row (empty url) instead of returning an invalid card", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const card = cardFromRow(rowFromStoredCard({ ...validCard, url: "" }), 0);
    // One bad upstream record must not surface (and, upstream of this, must not
    // 400 the whole /sync batch). It is dropped and logged.
    expect(card).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
  });

  it("returns null for a row with no indexed backend card", () => {
    const row = rowFromStoredCard(validCard);
    row.metadata = null;
    expect(cardFromRow(row, 0)).toBeNull();
  });
});

describe("backendTruthSet (index-never-clobbers-overlay invariant)", () => {
  it("excludes every overlay column, so a backend poll cannot clobber it", () => {
    const row = rowFromStoredCard(validCard);
    // User-owned overlay state that a backend refresh must leave untouched.
    row.location = "archive";
    row.tags = ["mine"];
    row.note = "my note";
    row.readProgress = 0.7;
    row.readAnchor = "#n9";
    const set = backendTruthSet(row);
    for (const col of OVERLAY_COLUMNS) {
      expect(col in set).toBe(false);
    }
  });

  it("refreshes the backend-truth columns and clears the tombstone", () => {
    const row = rowFromStoredCard(validCard);
    expect(backendTruthSet(row)).toMatchObject({
      category: row.category,
      title: row.title,
      url: row.url,
      savedAt: row.savedAt,
      updatedAt: row.updatedAt,
      deletedAt: null,
    });
  });
});

describe("backendTruthSet email read-state backstop", () => {
  // The guard is a conflict-set expression, so assert on the SQL it renders.
  const renderMetadata = (row: DocumentRow) => {
    const { metadata } = backendTruthSet(row);
    expect(is(metadata, SQL)).toBe(true);
    return new PgDialect().sqlToQuery(metadata as SQL).sql;
  };

  it("does not let a poll downgrade a finished newsletter to unopened", () => {
    // Readeck reports is_archived=false/read_progress=0 for a newsletter the user
    // finished but never archived, so the re-derived readState is `unopened`. The
    // conflict set must pin the stored `finished` back onto the incoming card.
    const sql = renderMetadata(
      rowFromStoredCard({ ...validCard, source: "readeck", category: "email" }),
    );
    expect(sql).toContain("'card'->>'readState' = 'finished'");
    expect(sql).toContain("jsonb_set(excluded.metadata, '{card,readState}', '\"finished\"'::jsonb");
  });

  it("guards both metadata blobs so jsonb_set can never null out the stored card", () => {
    const sql = renderMetadata(
      rowFromStoredCard({ ...validCard, source: "readeck", category: "email" }),
    );
    expect(sql).toContain(`jsonb_exists("documents"."metadata", 'card')`);
    expect(sql).toContain("jsonb_exists(excluded.metadata, 'card')");
  });

  it("still writes the incoming metadata when the stored row is not finished", () => {
    // The else-branch of the guard: nothing to preserve, so backend truth applies.
    const sql = renderMetadata(
      rowFromStoredCard({ ...validCard, source: "readeck", category: "email" }),
    );
    expect(sql).toContain("else excluded.metadata");
  });

  it("is scoped to email: a MiniFlux re-index still applies an upstream unread", () => {
    // Un-reading in MiniFlux is a real user action, so the backend card is written
    // through verbatim with no sticky-finished branch at all.
    const row = rowFromStoredCard({ ...validCard, readState: "unopened" });
    const { metadata } = backendTruthSet(row);
    expect(is(metadata, SQL)).toBe(false);
    expect(metadata).toBe(row.metadata);
  });

  it("is scoped to email: a Readeck article re-index still applies an un-archive", () => {
    const row = rowFromStoredCard({
      ...validCard,
      source: "readeck",
      category: "article",
      readState: "unopened",
    });
    expect(backendTruthSet(row).metadata).toBe(row.metadata);
  });
});

describe("DrizzleOverlayStore.markIndexedRead", () => {
  // Chainable stubs for `db.select().from().where()` and `db.update().set().where()`.
  type Written = { metadata: { card: { readState: string } }; updatedAt: Date };
  const store = (row: unknown) => {
    const set = vi.fn<(values: Written) => { where: () => Promise<void> }>(() => ({
      where: async () => {},
    }));
    const db = {
      select: () => ({ from: () => ({ where: async () => (row ? [row] : []) }) }),
      update: () => ({ set }),
    };
    return { store: new DrizzleOverlayStore(db as never), set };
  };

  it("writes an explicit local un-read straight to metadata, bypassing the backstop", async () => {
    // The email backstop lives in the poll's conflict set only; a deliberate
    // un-read from the UI must still be able to clear a finished newsletter.
    const row = rowFromStoredCard({ ...validCard, source: "readeck", category: "email" });
    row.metadata = { card: { ...validCard, readState: "finished" } };
    const { store: s, set } = store(row);
    await s.markIndexedRead("readeck:rd1", false);
    expect(set).toHaveBeenCalledOnce();
    const written = set.mock.calls[0]?.[0];
    expect(written?.metadata.card.readState).toBe("unopened");
  });

  it("marks a newsletter finished locally so it survives until the next poll", async () => {
    const row = rowFromStoredCard({ ...validCard, source: "readeck", category: "email" });
    const { store: s, set } = store(row);
    await s.markIndexedRead("readeck:rd1", true);
    const written = set.mock.calls[0]?.[0];
    expect(written?.metadata.card.readState).toBe("finished");
  });
});

describe("groupFollowSuggestions", () => {
  it("groups saved/upvoted candidate rows by host and keeps those at threshold", () => {
    // aeon.co has 3 distinct signals; example.com has 2. Threshold 3 keeps only aeon.
    const rows = [
      { url: "https://aeon.co/essays/one", title: "One" },
      { url: "https://www.aeon.co/essays/two", title: "Two" }, // www. collapses onto aeon.co
      { url: "https://aeon.co/essays/three", title: "Three" },
      { url: "https://example.com/a", title: "A" },
      { url: "https://example.com/b", title: "B" },
    ];
    const out = groupFollowSuggestions(rows, 3);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ domain: "aeon.co", signalCount: 3 });
    expect(out[0]!.sampleTitles).toEqual(["One", "Two", "Three"]);
  });

  it("caps sample titles at 3, skips null/blank titles and unparseable urls, sorts desc", () => {
    const rows = [
      { url: "https://a.com/1", title: "t1" },
      { url: "https://a.com/2", title: null },
      { url: "https://a.com/3", title: "  " },
      { url: "https://a.com/4", title: "t4" },
      { url: "https://a.com/5", title: "t5" },
      { url: "https://a.com/6", title: "t6" },
      { url: "not-a-url", title: "skip" },
      { url: "https://b.com/1", title: "b1" },
      { url: "https://b.com/2", title: "b2" },
      { url: "https://b.com/3", title: "b3" },
      { url: "https://b.com/4", title: "b4" },
    ];
    const out = groupFollowSuggestions(rows, 3);
    expect(out.map((s) => s.domain)).toEqual(["a.com", "b.com"]); // 6 vs 4, desc
    const a = out.find((s) => s.domain === "a.com")!;
    expect(a.signalCount).toBe(6);
    expect(a.sampleTitles).toEqual(["t1", "t4", "t5"]); // 3 non-blank, capped
  });
});

const tf = (text: string) => termFrequencies(tokenize(text));

describe("salientSurfaceTerms", () => {
  it("returns the top-k most frequent terms as readable surface words, not stems", () => {
    // "connections"/"connection" both stem to "connect"; the surface form of the
    // FIRST occurrence ("connections") is kept so an FTS query uses a real word.
    const text = "Connections connection connection intelligence intelligence systems";
    const terms = salientSurfaceTerms(text, 2);
    expect(terms).toEqual(["connections", "intelligence"]);
  });

  it("is deterministic on ties (alphabetical) and caps at k", () => {
    const terms = salientSurfaceTerms("alpha beta gamma", 2);
    expect(terms).toEqual(["alpha", "beta"]); // all freq 1 -> alpha order
  });

  it("returns [] for text with no salient tokens", () => {
    expect(salientSurfaceTerms("the a of to", 5)).toEqual([]);
  });
});

describe("rankRelated", () => {
  it("orders candidates by TF-IDF cosine to the source, closest first", () => {
    const source = tf("machine learning neural networks deep learning");
    const candidates = [
      { id: "far", tf: tf("cooking recipes kitchen food") },
      { id: "near", tf: tf("deep learning neural networks training") },
      { id: "mid", tf: tf("learning statistics regression") },
    ];
    expect(rankRelated(source, candidates, 3)).toEqual(["near", "mid", "far"]);
  });

  it("respects the limit and breaks score ties by id asc", () => {
    const source = tf("apple banana");
    const candidates = [
      { id: "b", tf: tf("apple banana") },
      { id: "a", tf: tf("apple banana") },
    ];
    expect(rankRelated(source, candidates, 1)).toEqual(["a"]);
  });

  it("returns [] with no candidates", () => {
    expect(rankRelated(tf("x y z"), [], 3)).toEqual([]);
  });
});

describe("rerankSearchHits", () => {
  const hit = (id: string, title: string, snippet: string, rank: number): RankableHit => ({
    id,
    title,
    snippet,
    rank,
  });

  it("never drops a hit and preserves the exact set (only reorders)", () => {
    const hits = [
      hit("a", "Gardening basics", "how to plant tomatoes", 0.9),
      hit("b", "Machine learning", "neural networks and deep learning models", 0.8),
    ];
    const out = rerankSearchHits("deep learning models", hits);
    expect(new Set(out.map((h) => h.id))).toEqual(new Set(["a", "b"]));
    // The lower-ts_rank but on-topic hit is lifted above the off-topic top hit.
    expect(out[0]!.id).toBe("b");
  });

  it("returns the input unchanged when the query tokenizes to nothing", () => {
    const hits = [hit("a", "T", "s", 0.5), hit("b", "T2", "s2", 0.4)];
    expect(rerankSearchHits("the of a", hits)).toBe(hits);
  });

  it("keeps original order when cosine is uninformative (stable tie-break)", () => {
    const hits = [hit("a", "", "unrelated one", 0.9), hit("b", "", "unrelated two", 0.5)];
    const out = rerankSearchHits("xyzzy quux", hits);
    expect(out.map((h) => h.id)).toEqual(["a", "b"]);
  });

  it("leaves hits beyond the window in place", () => {
    const hits = [
      hit("a", "off topic", "nothing here", 0.9),
      hit("b", "space rockets", "rockets to orbit", 0.8),
      hit("c", "tail one", "tail", 0.7),
    ];
    const out = rerankSearchHits("rockets orbit", hits, 2);
    // window=2: a,b reorder (b lifted); c stays appended last.
    expect(out.map((h) => h.id)).toEqual(["b", "a", "c"]);
  });
});

describe("buildTagCentroids + suggestTagsFromCentroids", () => {
  const samples = [
    {
      tag: "tech",
      texts: ["machine learning neural networks", "software engineering compilers systems"],
    },
    { tag: "cooking", texts: ["recipes baking bread", "kitchen knives cooking food"] },
  ];

  it("suggests the closest tag for an on-topic doc, above threshold", () => {
    const centroids = buildTagCentroids(samples);
    const out = suggestTagsFromCentroids(
      "deep neural networks and machine learning systems",
      [],
      centroids,
    );
    expect(out[0]!.tag).toBe("tech");
    expect(out[0]!.score).toBeGreaterThan(0.05);
    expect(out.some((s) => s.tag === "cooking" && s.score > 0.05)).toBe(false);
  });

  it("excludes tags the doc already carries", () => {
    const centroids = buildTagCentroids(samples);
    const out = suggestTagsFromCentroids("machine learning neural networks", ["tech"], centroids);
    expect(out.some((s) => s.tag === "tech")).toBe(false);
  });

  it("returns [] for an empty doc and drops tags with no usable sample", () => {
    const centroids = buildTagCentroids([{ tag: "empty", texts: ["the a of"] }, ...samples]);
    expect(centroids.centroids.some((c) => c.tag === "empty")).toBe(false);
    expect(suggestTagsFromCentroids("", [], centroids)).toEqual([]);
  });

  it("honours topN and threshold", () => {
    const centroids = buildTagCentroids(samples);
    const out = suggestTagsFromCentroids("machine learning recipes", [], centroids, {
      topN: 1,
      threshold: 0,
    });
    expect(out).toHaveLength(1);
  });
});
