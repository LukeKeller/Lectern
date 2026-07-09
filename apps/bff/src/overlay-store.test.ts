import { Card } from "@lectern/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  backendTruthSet,
  cardFromRow,
  groupFollowSuggestions,
  OVERLAY_COLUMNS,
} from "./overlay-store";
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
