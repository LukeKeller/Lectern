import { describe, expect, it } from "vitest";
import { SYNC_CURSOR_LAG_MS, nextSyncCursor } from "./sync-cursor";

const NOW = new Date("2026-07-19T12:00:00.000Z");
const lagBound = new Date(NOW.getTime() - SYNC_CURSOR_LAG_MS).toISOString();

function card(updatedAt: string) {
  return { updatedAt };
}

describe("nextSyncCursor", () => {
  it("returns `since` unchanged for an empty delta", () => {
    const since = "2026-07-19T11:59:59.500Z";
    expect(nextSyncCursor({ since, cards: [], now: NOW })).toBe(since);
  });

  it("returns `since` unchanged for an empty delta even when it is ancient", () => {
    const since = "2020-01-01T00:00:00.000Z";
    expect(nextSyncCursor({ since, cards: [], now: NOW })).toBe(since);
  });

  it("anchors a first-ever pull that delivered nothing at the lag bound", () => {
    expect(nextSyncCursor({ since: undefined, cards: [], now: NOW })).toBe(lagBound);
  });

  it("never advances past the newest delivered row", () => {
    const cursor = nextSyncCursor({
      since: "2026-01-01T00:00:00.000Z",
      cards: [card("2026-03-01T00:00:00.000Z"), card("2026-02-01T00:00:00.000Z")],
      now: NOW,
    });
    expect(cursor).toBe("2026-03-01T00:00:00.000Z");
  });

  it("holds the cursor a lag window behind now when the newest row is recent", () => {
    // Rows written seconds ago: another writer's row may still be landing with a
    // timestamp interleaved among these, so the cursor must stay below them.
    const cursor = nextSyncCursor({
      since: "2026-07-19T11:00:00.000Z",
      cards: [card("2026-07-19T11:59:58.000Z"), card("2026-07-19T11:59:30.000Z")],
      now: NOW,
    });
    expect(cursor).toBe(lagBound);
    expect(Date.parse(cursor)).toBeLessThan(Date.parse("2026-07-19T11:59:58.000Z"));
  });

  it("re-delivers a row written concurrently with the previous pull", () => {
    // The production race: the pull's response clock was 12:00:00, a row landed
    // afterwards carrying updatedAt 11:59:50. A wall-clock cursor buried it.
    const cursor = nextSyncCursor({
      since: "2026-07-19T11:00:00.000Z",
      cards: [card("2026-07-19T11:59:55.000Z")],
      now: NOW,
    });
    expect(Date.parse(cursor)).toBeLessThan(Date.parse("2026-07-19T11:59:50.000Z"));
  });

  it("takes the tombstone watermark into account", () => {
    const cursor = nextSyncCursor({
      since: "2026-01-01T00:00:00.000Z",
      cards: [card("2026-02-01T00:00:00.000Z")],
      maxDeletedAt: "2026-04-01T00:00:00.000Z",
      now: NOW,
    });
    expect(cursor).toBe("2026-04-01T00:00:00.000Z");
  });

  it("ignores a null tombstone watermark", () => {
    const cursor = nextSyncCursor({
      since: "2026-01-01T00:00:00.000Z",
      cards: [card("2026-02-01T00:00:00.000Z")],
      maxDeletedAt: null,
      now: NOW,
    });
    expect(cursor).toBe("2026-02-01T00:00:00.000Z");
  });

  it("never moves the cursor backwards past `since`", () => {
    // `since` already sits inside the lag window; the cap must not rewind it.
    const since = "2026-07-19T11:59:50.000Z";
    const cursor = nextSyncCursor({
      since,
      cards: [card("2026-07-19T11:59:59.000Z")],
      now: NOW,
    });
    expect(cursor).toBe(since);
  });

  it("truncates sub-millisecond precision downwards, toward re-delivery", () => {
    // Postgres timestamptz is microsecond; the emitted cursor is millisecond, so
    // the boundary row still satisfies a strict `updatedAt > cursor`.
    const cursor = nextSyncCursor({
      since: "2026-01-01T00:00:00.000Z",
      cards: [card("2026-03-01T00:00:00.123456Z")],
      now: NOW,
    });
    // Truncated DOWN: the cursor instant is strictly earlier than the row's, so
    // Postgres re-includes the row. (Compared as instants — the ISO strings are
    // NOT lexically ordered across differing precisions.)
    expect(cursor).toBe("2026-03-01T00:00:00.123Z");
    expect(Date.parse(cursor)).toBeLessThanOrEqual(Date.parse("2026-03-01T00:00:00.123456Z"));
  });

  it("normalises a non-canonical timestamp rather than comparing it lexically", () => {
    const cursor = nextSyncCursor({
      since: "2026-01-01T00:00:00.000Z",
      cards: [card("2026-03-01T00:00:00+00:00"), card("2026-02-01T00:00:00.000Z")],
      now: NOW,
    });
    expect(cursor).toBe("2026-03-01T00:00:00.000Z");
  });

  it("ignores unparseable row timestamps instead of poisoning the watermark", () => {
    const cursor = nextSyncCursor({
      since: "2026-01-01T00:00:00.000Z",
      cards: [card("not a date"), card("2026-02-01T00:00:00.000Z")],
      now: NOW,
    });
    expect(cursor).toBe("2026-02-01T00:00:00.000Z");
  });
});
