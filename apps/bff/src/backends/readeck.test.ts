import { Card, Highlight } from "@lectern/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  annotationToHighlight,
  readeckBookmarkToCard,
  ReadeckBackend,
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

  it("maps a cover image from Readeck resources, else null", () => {
    expect(readeckBookmarkToCard(baseBookmark).coverImage).toBeNull();
    const withImg = readeckBookmarkToCard({
      ...baseBookmark,
      resources: { image: { src: "https://danluu.com/cover.jpg" } },
    });
    expect(withImg.coverImage).toBe("https://danluu.com/cover.jpg");
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

describe("reserved label namespace", () => {
  const emailBookmark: ReadeckBookmark = {
    ...baseBookmark,
    labels: ["lectern:email", "Ed Zitron", "lectern:from:wheresyoured.at", "ai"],
  };

  it("derives the email category and sender domain, hiding both sentinels", () => {
    const card = readeckBookmarkToCard(emailBookmark);
    expect(card.category).toBe("email");
    expect(card.senderDomain).toBe("wheresyoured.at");
    expect(card.tags).toEqual(["Ed Zitron", "ai"]);
  });

  it("hides reserved labels on a non-email bookmark too", () => {
    // Otherwise a client echoing the tags it was given would write the reserved
    // label back — and a full-replacement PATCH would be the only thing left.
    const card = readeckBookmarkToCard({
      ...baseBookmark,
      labels: ["lectern:discover", "rust"],
    });
    expect(card.category).toBe("article");
    expect(card.tags).toEqual(["rust"]);
  });
});

describe("ReadeckBackend.setLabels", () => {
  afterEach(() => vi.unstubAllGlobals());

  /** Stub a GET of `labels` followed by the PATCH; returns the PATCHed body. */
  function stubLabels(current: string[]): () => { labels: string[] } | null {
    let patched: { labels: string[] } | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: { method?: string; body?: string }) => {
        if ((init?.method ?? "GET") === "PATCH") {
          patched = JSON.parse(init?.body ?? "{}") as { labels: string[] };
        }
        return {
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({ ...baseBookmark, labels: current }),
          text: async () => "",
        } as unknown as Response;
      }),
    );
    return () => patched;
  }

  function backend(): ReadeckBackend {
    return new ReadeckBackend({ baseUrl: "https://readeck.test", apiToken: "t" });
  }

  it("preserves the email sentinels when a user adds a tag", async () => {
    // The data-destroying bug: Readeck's label PATCH is a full replacement, so
    // writing back the user-facing tags erased `lectern:email` and
    // `lectern:from:*` and the next poll demoted the newsletter to an article.
    const body = stubLabels(["lectern:email", "lectern:from:wheresyoured.at", "Ed Zitron"]);
    await backend().setLabels("abc123", ["Ed Zitron", "ai"]);
    expect(body()?.labels).toEqual([
      "lectern:email",
      "lectern:from:wheresyoured.at",
      "Ed Zitron",
      "ai",
    ]);
  });

  it("preserves the sentinels when the user clears every tag", async () => {
    const body = stubLabels(["lectern:email", "lectern:from:404media.co", "Joseph Cox"]);
    await backend().setLabels("abc123", []);
    expect(body()?.labels).toEqual(["lectern:email", "lectern:from:404media.co"]);
  });

  it("leaves a non-email bookmark's labels alone", async () => {
    const body = stubLabels(["rust"]);
    await backend().setLabels("abc123", ["rust", "systems"]);
    expect(body()?.labels).toEqual(["rust", "systems"]);
  });

  it("refuses a user-supplied tag in the reserved namespace, in any casing", async () => {
    // A forged `lectern:email` would silently re-categorize a plain article.
    const body = stubLabels(["rust"]);
    await backend().setLabels("abc123", ["rust", "lectern:email", "Lectern:from:evil.example"]);
    expect(body()?.labels).toEqual(["rust"]);
  });
});

describe("ReadeckBackend.saveWithStatus", () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubSave(bookmark: Partial<ReadeckBookmark>): void {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: { method?: string }) => {
        const isCreate = init?.method === "POST";
        return {
          ok: true,
          status: isCreate ? 201 : 200,
          headers: new Headers(isCreate ? { "bookmark-id": "new1" } : {}),
          json: async () => ({ ...baseBookmark, ...bookmark }),
          text: async () => "",
        } as unknown as Response;
      }),
    );
  }

  function backend(): ReadeckBackend {
    return new ReadeckBackend({
      baseUrl: "https://readeck.test",
      apiToken: "t",
      pollIntervalMs: 0,
      pollTries: 2,
    });
  }

  it("reports the article as loaded when Readeck finishes extracting", async () => {
    stubSave({ loaded: true, state: 0 });
    expect(await backend().saveWithStatus({ url: "https://example.com/a" })).toEqual({
      sourceId: "new1",
      loaded: true,
    });
  });

  it("reports loaded:false when the bounded wait gives up, without failing the save", async () => {
    // Exhausting the tries used to be indistinguishable from success: the loop
    // fell out and `save()` returned the id as though the article had loaded.
    stubSave({ loaded: false, state: 1 });
    expect(await backend().saveWithStatus({ url: "https://example.com/a" })).toEqual({
      sourceId: "new1",
      loaded: false,
    });
  });

  it("save() still returns just the id, so a slow extraction is not a failure", async () => {
    stubSave({ loaded: false, state: 1 });
    await expect(backend().save({ url: "https://example.com/a" })).resolves.toBe("new1");
  });
});

describe("ReadeckBackend.list", () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubFetch(): () => string {
    let captured = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        captured = String(url);
        return {
          ok: true,
          status: 200,
          headers: new Headers({ "total-count": "0" }),
          json: async () => [],
          text: async () => "",
        } as unknown as Response;
      }),
    );
    return () => captured;
  }

  it("clamps the page size to Readeck's max of 100 (limit > 100 -> 404)", async () => {
    const url = stubFetch();
    const backend = new ReadeckBackend({ baseUrl: "https://readeck.test", apiToken: "t" });
    await backend.list({ pageSize: 200 });
    expect(new URL(url()).searchParams.get("limit")).toBe("100");
  });

  it("passes a page size at or under the cap through unchanged", async () => {
    const url = stubFetch();
    const backend = new ReadeckBackend({ baseUrl: "https://readeck.test", apiToken: "t" });
    await backend.list({ pageSize: 50 });
    expect(new URL(url()).searchParams.get("limit")).toBe("50");
  });

  /** Stub a page of `count` bookmarks alongside a chosen total-count header. */
  function stubPage(count: number, totalCount: string | null) {
    const headers = new Headers();
    if (totalCount !== null) headers.set("total-count", totalCount);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          ({
            ok: true,
            status: 200,
            headers,
            json: async () =>
              Array.from({ length: count }, (_, i) => ({ id: `b${i}`, labels: [] })),
            text: async () => "",
          }) as unknown as Response,
      ),
    );
  }

  // `Number("abc")` is NaN and `n < NaN` is false, so a malformed header used to
  // end pagination after page one. reconcileDeletions enumerates through this,
  // and a truncated enumeration means "everything past page one looks deleted".
  it("keeps paginating when total-count is malformed rather than truncating", async () => {
    stubPage(100, "not-a-number");
    const backend = new ReadeckBackend({ baseUrl: "https://readeck.test", apiToken: "t" });
    const page = await backend.list({ pageSize: 100 });
    expect(page.nextCursor).toBe("100");
  });

  it("keeps paginating when total-count is absent entirely", async () => {
    stubPage(100, null);
    const backend = new ReadeckBackend({ baseUrl: "https://readeck.test", apiToken: "t" });
    const page = await backend.list({ pageSize: 100 });
    expect(page.nextCursor).toBe("100");
  });

  // An empty page cannot advance the offset, so a cursor here would hand every
  // `do { } while (cursor)` caller the same offset forever.
  it("stops on an empty page even when total-count claims there is more", async () => {
    stubPage(0, "9999");
    const backend = new ReadeckBackend({ baseUrl: "https://readeck.test", apiToken: "t" });
    const page = await backend.list({ pageSize: 100 });
    expect(page.nextCursor).toBeNull();
  });
});
