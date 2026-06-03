import { Card, Feed, FeedFolder } from "@lectern/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MinifluxBackend,
  minifluxCategoryToFolder,
  minifluxEntryToCard,
  minifluxFeedToFeed,
  minifluxReadState,
  type MinifluxEntry,
  type MinifluxFeed,
} from "./miniflux";

const baseEntry: MinifluxEntry = {
  id: 42,
  feed_id: 7,
  status: "unread",
  title: "Things I learned",
  url: "https://example.com/post",
  author: "Ada",
  published_at: "2026-06-02T22:21:52Z",
  created_at: "2026-06-03T02:37:59Z",
  changed_at: "2026-06-03T02:38:01Z",
  content: "<p>hi</p>",
  starred: false,
  reading_time: 5,
  tags: ["ai", "llms"],
  feed: { id: 7, title: "Simon's Weblog", site_url: "https://simonwillison.net/", feed_url: "x" },
};

describe("minifluxEntryToCard", () => {
  it("normalizes an entry into a Card", () => {
    const card = minifluxEntryToCard(baseEntry);
    expect(card).toMatchObject({
      id: "miniflux:42",
      source: "miniflux",
      sourceId: "42",
      category: "rss",
      location: "feed",
      readState: "unopened",
      title: "Things I learned",
      author: "Ada",
      siteName: "Simon's Weblog",
      url: "https://example.com/post",
      readingTimeMinutes: 5,
      readingProgress: 0,
      readAnchor: null,
      tags: ["ai", "llms"],
      highlightCount: 0,
      savedAt: "2026-06-02T22:21:52Z",
      updatedAt: "2026-06-03T02:38:01Z",
    });
    expect(() => Card.parse(card)).not.toThrow();
  });

  it("maps read status to finished", () => {
    const card = minifluxEntryToCard({ ...baseEntry, status: "read" });
    expect(card.readState).toBe("finished");
  });

  it("tolerates missing tags, author, and feed", () => {
    const card = minifluxEntryToCard({ ...baseEntry, tags: null, author: "", feed: undefined });
    expect(card.tags).toEqual([]);
    expect(card.author).toBeNull();
    expect(card.siteName).toBeNull();
  });

  it("falls back to the feed link when the entry url is empty", () => {
    const card = minifluxEntryToCard({ ...baseEntry, url: "" });
    expect(card.url).toBe("https://simonwillison.net/");
    expect(() => Card.parse(card)).not.toThrow();
  });

  it("yields a droppable (invalid) card only when no link exists at all", () => {
    // No entry url and no feed: nothing to fall back to. The card is invalid and
    // is dropped on the read path (see overlay-store cardFromRow), never crashing.
    const card = minifluxEntryToCard({ ...baseEntry, url: "", feed: undefined });
    expect(card.url).toBe("");
    expect(Card.safeParse(card).success).toBe(false);
  });
});

describe("minifluxReadState", () => {
  it("maps the binary read flag", () => {
    expect(minifluxReadState(true)).toBe("finished");
    expect(minifluxReadState(false)).toBe("unopened");
  });
});

const baseFeed: MinifluxFeed = {
  id: 1,
  title: "Simon Willison's Weblog",
  site_url: "http://simonwillison.net/",
  feed_url: "https://simonwillison.net/atom/everything/",
  category: { id: 2, title: "Lectern Spike" },
};

describe("minifluxFeedToFeed", () => {
  it("normalizes a feed into a Feed with stringified ids and folder fields", () => {
    const feed = minifluxFeedToFeed(baseFeed, 29);
    expect(feed).toEqual({
      id: "1",
      title: "Simon Willison's Weblog",
      feedUrl: "https://simonwillison.net/atom/everything/",
      siteUrl: "http://simonwillison.net/",
      folderId: "2",
      folderTitle: "Lectern Spike",
      unreadCount: 29,
    });
    expect(() => Feed.parse(feed)).not.toThrow();
  });

  it("defaults unread to 0 and collapses a blank site_url / missing category to null", () => {
    const feed = minifluxFeedToFeed({ ...baseFeed, site_url: "", category: undefined });
    expect(feed.unreadCount).toBe(0);
    expect(feed.siteUrl).toBeNull();
    expect(feed.folderId).toBeNull();
    expect(feed.folderTitle).toBeNull();
    expect(() => Feed.parse(feed)).not.toThrow();
  });
});

describe("minifluxCategoryToFolder", () => {
  it("normalizes a category into a FeedFolder", () => {
    const folder = minifluxCategoryToFolder({ id: 2, title: "Lectern Spike" }, 29);
    expect(folder).toEqual({ id: "2", title: "Lectern Spike", unreadCount: 29 });
    expect(() => FeedFolder.parse(folder)).not.toThrow();
  });

  it("defaults unread to 0", () => {
    expect(minifluxCategoryToFolder({ id: 1, title: "All" }).unreadCount).toBe(0);
  });
});

describe("MinifluxBackend.listEntries", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("paginates by the unique id for stable, gap-free pages", async () => {
    let captured = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        captured = String(url);
        return {
          ok: true,
          status: 200,
          json: async () => ({ entries: [], total: 0 }),
        } as unknown as Response;
      }),
    );
    const backend = new MinifluxBackend({ baseUrl: "https://mf.test", apiToken: "t" });
    await backend.listEntries({ pageSize: 100 });
    const params = new URL(captured).searchParams;
    expect(params.get("order")).toBe("id");
    expect(params.get("direction")).toBe("desc");
  });
});
