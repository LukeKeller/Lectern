import { Card } from "@lectern/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { backendTruthSet, cardFromRow, OVERLAY_COLUMNS } from "./overlay-store";
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
