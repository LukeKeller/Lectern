import { Card, Highlight } from "@lectern/shared";
import { describe, expect, it } from "vitest";
import {
  annotationToHighlight,
  readeckBookmarkToCard,
  type ReadeckAnnotation,
  type ReadeckBookmark,
} from "./readeck";

const baseBookmark: ReadeckBookmark = {
  id: "abc123",
  url: "https://danluu.com/web-bloat/",
  title: "How web bloat impacts users",
  site_name: "danluu.com",
  authors: ["Dan Luu"],
  created: "2026-06-03T02:38:57Z",
  updated: "2026-06-03T02:39:01Z",
  state: 0,
  loaded: true,
  has_article: true,
  is_archived: false,
  is_marked: false,
  labels: ["lectern"],
  read_progress: 42,
  read_anchor: "#node-5",
  word_count: 4314,
  reading_time: 21,
};

describe("readeckBookmarkToCard", () => {
  it("normalizes a bookmark into a Card with progress scaled to 0..1", () => {
    const card = readeckBookmarkToCard(baseBookmark, 3);
    expect(card).toMatchObject({
      id: "readeck:abc123",
      source: "readeck",
      sourceId: "abc123",
      category: "article",
      location: "later",
      readState: "reading",
      title: "How web bloat impacts users",
      author: "Dan Luu",
      siteName: "danluu.com",
      url: "https://danluu.com/web-bloat/",
      wordCount: 4314,
      readingTimeMinutes: 21,
      readingProgress: 0.42,
      readAnchor: "#node-5",
      tags: ["lectern"],
      highlightCount: 3,
    });
    expect(() => Card.parse(card)).not.toThrow();
  });

  it("maps archived bookmarks to the archive location and finished state", () => {
    const card = readeckBookmarkToCard({ ...baseBookmark, is_archived: true, read_progress: 10 });
    expect(card.location).toBe("archive");
    expect(card.readState).toBe("finished");
  });

  it("treats zero progress as unopened", () => {
    const card = readeckBookmarkToCard({ ...baseBookmark, read_progress: 0 });
    expect(card.readState).toBe("unopened");
    expect(card.readingProgress).toBe(0);
  });

  it("defaults missing author/anchor to null", () => {
    const card = readeckBookmarkToCard({ ...baseBookmark, authors: [], read_anchor: null });
    expect(card.author).toBeNull();
    expect(card.readAnchor).toBeNull();
  });
});

describe("annotationToHighlight", () => {
  const annotation: ReadeckAnnotation = {
    id: "anno1",
    start_selector: "/section/main/p[1]",
    start_offset: 0,
    end_selector: "/section/main/p[1]",
    end_offset: 10,
    color: "yellow",
    note: "",
    text: "A couple y",
    created: "2026-06-03T03:08:29Z",
  };

  it("maps an annotation into a Highlight", () => {
    const highlight = annotationToHighlight(annotation, "abc123");
    expect(highlight).toMatchObject({
      id: "anno1",
      documentId: "readeck:abc123",
      text: "A couple y",
      note: null,
      color: "yellow",
      startSelector: "/section/main/p[1]",
      startOffset: 0,
      endSelector: "/section/main/p[1]",
      endOffset: 10,
      createdAt: "2026-06-03T03:08:29Z",
    });
    expect(() => Highlight.parse(highlight)).not.toThrow();
  });

  it("falls back to yellow for unknown colors", () => {
    expect(annotationToHighlight({ ...annotation, color: "magenta" }, "x").color).toBe("yellow");
  });
});
