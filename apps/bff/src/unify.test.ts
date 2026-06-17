import type { Card } from "@lectern/shared";
import { describe, expect, it, vi } from "vitest";
import {
  deriveReadeckReadState,
  locationToMinifluxRead,
  locationToReadeckArchived,
  mergeOverlay,
  progressFromReadeck,
  progressToReadeck,
  readeckLocationFromArchived,
  UnificationService,
  type Overlay,
  type OverlayReader,
} from "./unify";

function rssCard(over: Partial<Card> = {}): Card {
  return {
    id: "miniflux:1",
    source: "miniflux",
    sourceId: "1",
    category: "rss",
    location: "feed",
    readState: "unopened",
    title: "t",
    excerpt: null,
    author: null,
    siteName: null,
    url: "https://example.com/a",
    coverImage: null,
    wordCount: null,
    readingTimeMinutes: 3,
    readingProgress: 0,
    readAnchor: null,
    tags: [],
    highlightCount: 0,
    note: null,
    savedAt: "2026-06-01T00:00:00Z",
    updatedAt: "2026-06-01T00:00:00Z",
    publishedAt: null,
    ...over,
  };
}

function readeckCard(over: Partial<Card> = {}): Card {
  return {
    ...rssCard(),
    id: "readeck:x",
    source: "readeck",
    sourceId: "x",
    category: "article",
    location: "later",
    ...over,
  };
}

describe("progress scaling", () => {
  it("scales 0..1 to integer 0..100 and back", () => {
    expect(progressToReadeck(0.42)).toBe(42);
    expect(progressToReadeck(0)).toBe(0);
    expect(progressToReadeck(1)).toBe(100);
    expect(progressFromReadeck(42)).toBeCloseTo(0.42);
    expect(progressFromReadeck(100)).toBe(1);
  });

  it("clamps out-of-range values", () => {
    expect(progressToReadeck(1.5)).toBe(100);
    expect(progressToReadeck(-0.2)).toBe(0);
    expect(progressFromReadeck(250)).toBe(1);
    expect(progressFromReadeck(-5)).toBe(0);
  });
});

describe("location <-> backend state", () => {
  it("derives Readeck read state from archive + progress", () => {
    expect(deriveReadeckReadState(true, 0)).toBe("finished");
    expect(deriveReadeckReadState(false, 100)).toBe("finished");
    expect(deriveReadeckReadState(false, 95)).toBe("finished");
    expect(deriveReadeckReadState(false, 94)).toBe("reading");
    expect(deriveReadeckReadState(false, 30)).toBe("reading");
    expect(deriveReadeckReadState(false, 0)).toBe("unopened");
  });

  it("maps archive flag to location and back", () => {
    expect(readeckLocationFromArchived(true)).toBe("archive");
    expect(readeckLocationFromArchived(false)).toBe("later");
    expect(locationToReadeckArchived("archive")).toBe(true);
    expect(locationToReadeckArchived("later")).toBe(false);
    expect(locationToReadeckArchived("shortlist")).toBe(false);
  });

  it("maps location to MiniFlux read flag", () => {
    expect(locationToMinifluxRead("archive")).toBe(true);
    expect(locationToMinifluxRead("feed")).toBe(false);
    expect(locationToMinifluxRead("inbox")).toBe(false);
  });
});

describe("mergeOverlay", () => {
  it("overlays BFF reading progress + highlight count onto RSS cards", () => {
    const overlay: Overlay = { readProgress: 0.5, readAnchor: "#n3", location: "shortlist" };
    const merged = mergeOverlay(rssCard(), overlay, 4);
    expect(merged.readingProgress).toBe(0.5);
    expect(merged.readAnchor).toBe("#n3");
    expect(merged.highlightCount).toBe(4);
    expect(merged.location).toBe("shortlist");
  });

  it("does not touch readeck progress but applies unified location/tags/note", () => {
    const card = readeckCard({ readingProgress: 0.42, tags: ["old"] });
    const merged = mergeOverlay(card, { location: "shortlist", tags: ["unified"], note: "hi" });
    expect(merged.readingProgress).toBe(0.42);
    expect(merged.location).toBe("shortlist");
    expect(merged.tags).toEqual(["unified"]);
    expect(merged.note).toBe("hi");
  });

  it("returns the card unchanged when no overlay exists", () => {
    const card = rssCard();
    expect(mergeOverlay(card, undefined, 0)).toEqual(card);
  });
});

describe("UnificationService.applyOverlays", () => {
  function store(overlays: Record<string, Overlay>, counts: Record<string, number>): OverlayReader {
    return {
      getOverlays: vi.fn(async () => overlays),
      getRssHighlightCounts: vi.fn(async () => counts),
    };
  }

  it("returns an empty array untouched without querying the store", async () => {
    const overlays = store({}, {});
    const service = new UnificationService(overlays);
    expect(await service.applyOverlays([])).toEqual([]);
    expect(overlays.getOverlays).not.toHaveBeenCalled();
  });

  it("overlays glue state and RSS highlight counts onto fetched cards", async () => {
    const service = new UnificationService(
      store({ "miniflux:1": { location: "shortlist", readProgress: 0.5 } }, { "miniflux:1": 2 }),
    );

    const [rss, readeck] = await service.applyOverlays([rssCard(), readeckCard()]);

    expect(rss?.location).toBe("shortlist");
    expect(rss?.readingProgress).toBe(0.5);
    expect(rss?.highlightCount).toBe(2);
    // A card with no overlay row keeps its backend-derived state.
    expect(readeck?.location).toBe(readeckCard().location);
  });
});
