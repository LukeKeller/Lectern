import type {
  BackendListParams,
  BackendPage,
  Card,
  ReadLaterBackend,
  RssBackend,
} from "@lectern/shared";
import { describe, expect, it, vi } from "vitest";
import {
  decodeCombinedCursor,
  deriveReadeckReadState,
  encodeCombinedCursor,
  locationToMinifluxRead,
  locationToReadeckArchived,
  mergeOverlay,
  progressFromReadeck,
  progressToReadeck,
  readeckLocationFromArchived,
  UnificationService,
  type Overlay,
  type OverlayStore,
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

describe("combined cursor", () => {
  it("round-trips both per-backend cursors", () => {
    const encoded = encodeCombinedCursor("10", "20");
    expect(encoded).not.toBeNull();
    expect(decodeCombinedCursor(encoded ?? undefined)).toEqual({ rss: "10", readLater: "20" });
  });

  it("is null when both backends are exhausted", () => {
    expect(encodeCombinedCursor(null, null)).toBeNull();
  });

  it("decodes an absent cursor to undefined parts", () => {
    expect(decodeCombinedCursor(undefined)).toEqual({ rss: undefined, readLater: undefined });
  });

  it("preserves an exhausted backend as null (skip), distinct from a fresh undefined", () => {
    const encoded = encodeCombinedCursor(null, "20");
    expect(decodeCombinedCursor(encoded ?? undefined)).toEqual({ rss: null, readLater: "20" });
  });
});

describe("UnificationService", () => {
  const overlayStore = {
    getOverlays: vi.fn(
      async (): Promise<Record<string, Overlay>> => ({
        "miniflux:1": { location: "shortlist", readProgress: 0.5 },
      }),
    ),
    getRssHighlightCounts: vi.fn(async () => ({ "miniflux:1": 2 })),
  } as unknown as OverlayStore;

  it("merges both backends, overlays glue state, and combines cursors", async () => {
    const rss: RssBackend = {
      listEntries: vi.fn(
        async (): Promise<BackendPage<Card>> => ({ items: [rssCard()], nextCursor: "50" }),
      ),
      getEntryContent: vi.fn(),
      setRead: vi.fn(),
      setStarred: vi.fn(),
      refresh: vi.fn(),
      exportOpml: vi.fn(),
    } as unknown as RssBackend;
    const readLater: ReadLaterBackend = {
      list: vi.fn(
        async (): Promise<BackendPage<Card>> => ({ items: [readeckCard()], nextCursor: null }),
      ),
    } as unknown as ReadLaterBackend;

    const service = new UnificationService(rss, readLater, overlayStore);
    const page = await service.list({ pageSize: 50 } satisfies BackendListParams);

    expect(page.items).toHaveLength(2);
    const rssResult = page.items.find((c) => c.source === "miniflux");
    expect(rssResult?.location).toBe("shortlist");
    expect(rssResult?.readingProgress).toBe(0.5);
    expect(rssResult?.highlightCount).toBe(2);
    expect(page.nextCursor).toBe(encodeCombinedCursor("50", null));
  });

  it("skips an exhausted backend instead of restarting it", async () => {
    const rss = {
      listEntries: vi.fn(),
      getEntryContent: vi.fn(),
      setRead: vi.fn(),
      setStarred: vi.fn(),
      refresh: vi.fn(),
      exportOpml: vi.fn(),
    } as unknown as RssBackend;
    const readLater = {
      list: vi.fn(
        async (): Promise<BackendPage<Card>> => ({ items: [readeckCard()], nextCursor: "200" }),
      ),
    } as unknown as ReadLaterBackend;
    const store = {
      getOverlays: vi.fn(async () => ({})),
      getRssHighlightCounts: vi.fn(async () => ({})),
    } as unknown as OverlayStore;
    const service = new UnificationService(rss, readLater, store);

    // rss is exhausted (null); read-later is mid-pagination at offset 100.
    const cursor = encodeCombinedCursor(null, "100") ?? undefined;
    const page = await service.list({ pageSize: 100, cursor } satisfies BackendListParams);

    expect(rss.listEntries).not.toHaveBeenCalled();
    expect(readLater.list).toHaveBeenCalledOnce();
    expect(page.items).toHaveLength(1);
    // rss stays exhausted; read-later advances -> not yet terminal.
    expect(page.nextCursor).toBe(encodeCombinedCursor(null, "200"));
  });

  it("returns cards untouched when none are passed to applyOverlays", async () => {
    const service = new UnificationService({} as RssBackend, {} as ReadLaterBackend, overlayStore);
    expect(await service.applyOverlays([])).toEqual([]);
  });

  it("still serves read-later items when the rss backend fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const rss: RssBackend = {
      listEntries: vi.fn(async () => {
        throw new Error("MiniFlux GET /v1/entries -> 404");
      }),
    } as unknown as RssBackend;
    const readLater: ReadLaterBackend = {
      list: vi.fn(
        async (): Promise<BackendPage<Card>> => ({ items: [readeckCard()], nextCursor: null }),
      ),
    } as unknown as ReadLaterBackend;

    const service = new UnificationService(rss, readLater, overlayStore);
    const page = await service.list({ pageSize: 50 } satisfies BackendListParams);

    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.source).toBe("readeck");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("still serves rss items when the read-later backend fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const rss: RssBackend = {
      listEntries: vi.fn(
        async (): Promise<BackendPage<Card>> => ({ items: [rssCard()], nextCursor: null }),
      ),
    } as unknown as RssBackend;
    const readLater: ReadLaterBackend = {
      list: vi.fn(async () => {
        throw new Error("Readeck GET /api/bookmarks -> 404");
      }),
    } as unknown as ReadLaterBackend;

    const service = new UnificationService(rss, readLater, overlayStore);
    const page = await service.list({ pageSize: 50 } satisfies BackendListParams);

    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.source).toBe("miniflux");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("throws when both backends fail (a real outage is not masked)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const rss: RssBackend = {
      listEntries: vi.fn(async () => {
        throw new Error("MiniFlux down");
      }),
    } as unknown as RssBackend;
    const readLater: ReadLaterBackend = {
      list: vi.fn(async () => {
        throw new Error("Readeck down");
      }),
    } as unknown as ReadLaterBackend;

    const service = new UnificationService(rss, readLater, overlayStore);
    await expect(service.list({ pageSize: 50 } satisfies BackendListParams)).rejects.toThrow(
      "MiniFlux down",
    );
    warn.mockRestore();
  });
});
