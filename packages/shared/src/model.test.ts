import { describe, expect, it } from "vitest";
import { Card, Highlight, Location } from "./model";

const base = {
  id: "c1",
  source: "readeck" as const,
  sourceId: "abc",
  category: "article" as const,
  location: "later" as const,
  title: "Hello",
  url: "https://example.com/post",
  savedAt: "2026-06-03T00:00:00Z",
  updatedAt: "2026-06-03T00:00:00Z",
};

describe("Card schema", () => {
  it("applies defaults for omitted optional fields", () => {
    const card = Card.parse(base);
    expect(card.tags).toEqual([]);
    expect(card.readingProgress).toBe(0);
    expect(card.readState).toBe("unopened");
    expect(card.highlightCount).toBe(0);
    expect(card.author).toBeNull();
    expect(card.readingTimeMinutes).toBeNull();
  });

  it("clamps reading progress to the 0..1 range", () => {
    expect(() => Card.parse({ ...base, readingProgress: 1.5 })).toThrow();
    expect(Card.parse({ ...base, readingProgress: 0.42 }).readingProgress).toBe(0.42);
  });

  it("rejects a non-URL source link", () => {
    expect(() => Card.parse({ ...base, url: "not-a-url" })).toThrow();
  });

  it("rejects an unknown location", () => {
    expect(() => Location.parse("nowhere")).toThrow();
  });
});

describe("Highlight schema", () => {
  it("requires DOM range anchors and defaults color/note", () => {
    const h = Highlight.parse({
      id: "h1",
      documentId: "c1",
      text: "selected text",
      startSelector: "main>p:nth-child(2)",
      startOffset: 4,
      endSelector: "main>p:nth-child(2)",
      endOffset: 17,
      createdAt: "2026-06-03T00:00:00Z",
    });
    expect(h.color).toBe("yellow");
    expect(h.note).toBeNull();
  });

  it("rejects a highlight missing range selectors", () => {
    expect(() =>
      Highlight.parse({ id: "h", documentId: "c", text: "x", createdAt: "t" }),
    ).toThrow();
  });
});
