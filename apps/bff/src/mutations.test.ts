import type { ReadLaterBackend, RssBackend } from "@lectern/shared";
import { describe, expect, it, vi } from "vitest";
import { MutationApplier } from "./mutations";
import type { OverlayStore } from "./unify";

/**
 * Direct tests of the write path. The route tests exercise mutations end-to-end
 * via `app.inject`; these assert the dual-write routing and failure ordering at
 * the seam, where the field-ownership map lives.
 */
function harness() {
  const rss = {
    setRead: vi.fn(async () => {}),
    setRemoved: vi.fn(async () => {}),
  };
  const readLater = {
    setArchived: vi.fn(async () => {}),
    setLabels: vi.fn(async () => {}),
    setReadingProgress: vi.fn(async () => {}),
    delete: vi.fn(async () => {}),
  };
  const overlay = {
    upsertOverlay: vi.fn(async () => {}),
    markIndexedRead: vi.fn(async () => {}),
    softDelete: vi.fn(async () => {}),
    addRssHighlight: vi.fn(async () => ({ id: "hl_1" })),
    removeRssHighlight: vi.fn(async () => true),
  };
  const applier = new MutationApplier({
    rss: rss as unknown as RssBackend,
    readLater: readLater as unknown as ReadLaterBackend,
    overlay: overlay as unknown as OverlayStore,
  });
  return { applier, rss, readLater, overlay };
}

describe("MutationApplier dual-write routing", () => {
  it("setLocation on a Readeck card writes the backend archive flag AND the overlay", async () => {
    const { applier, readLater, overlay } = harness();
    await applier.setLocation({ source: "readeck", sourceId: "rd1" }, "readeck:rd1", "archive");
    expect(readLater.setArchived).toHaveBeenCalledWith("rd1", true);
    expect(overlay.upsertOverlay).toHaveBeenCalledWith("readeck:rd1", { location: "archive" });
  });

  it("setLocation to a non-archive location clears the Readeck archive flag", async () => {
    const { applier, readLater } = harness();
    await applier.setLocation({ source: "readeck", sourceId: "rd1" }, "readeck:rd1", "later");
    expect(readLater.setArchived).toHaveBeenCalledWith("rd1", false);
  });

  it("setLocation on a MiniFlux card touches only the overlay (no backend home)", async () => {
    const { applier, readLater, rss, overlay } = harness();
    await applier.setLocation({ source: "miniflux", sourceId: "7" }, "miniflux:7", "archive");
    expect(readLater.setArchived).not.toHaveBeenCalled();
    expect(rss.setRead).not.toHaveBeenCalled();
    expect(overlay.upsertOverlay).toHaveBeenCalledWith("miniflux:7", { location: "archive" });
  });

  it("setTags mirrors to Readeck labels and the overlay", async () => {
    const { applier, readLater, overlay } = harness();
    await applier.setTags({ source: "readeck", sourceId: "rd1" }, "readeck:rd1", ["a", "b"]);
    expect(readLater.setLabels).toHaveBeenCalledWith("rd1", ["a", "b"]);
    expect(overlay.upsertOverlay).toHaveBeenCalledWith("readeck:rd1", { tags: ["a", "b"] });
  });

  it("setProgress mirrors to Readeck reading progress and the overlay", async () => {
    const { applier, readLater, overlay } = harness();
    await applier.setProgress({ source: "readeck", sourceId: "rd1" }, "readeck:rd1", 0.5, "#n3");
    expect(readLater.setReadingProgress).toHaveBeenCalledWith("rd1", 0.5, "#n3");
    expect(overlay.upsertOverlay).toHaveBeenCalledWith("readeck:rd1", {
      readProgress: 0.5,
      readAnchor: "#n3",
    });
  });

  it("setProgress past the finished threshold marks a MiniFlux entry read", async () => {
    const { applier, rss, overlay } = harness();
    await applier.setProgress({ source: "miniflux", sourceId: "7" }, "miniflux:7", 0.96, "#n3");
    expect(overlay.upsertOverlay).toHaveBeenCalledWith("miniflux:7", {
      readProgress: 0.96,
      readAnchor: "#n3",
    });
    expect(rss.setRead).toHaveBeenCalledWith("7", true);
    expect(overlay.markIndexedRead).toHaveBeenCalledWith("miniflux:7", true);
  });

  it("setProgress below the finished threshold leaves a MiniFlux entry unread", async () => {
    const { applier, rss, overlay } = harness();
    await applier.setProgress({ source: "miniflux", sourceId: "7" }, "miniflux:7", 0.5, "#n3");
    expect(rss.setRead).not.toHaveBeenCalled();
    expect(overlay.markIndexedRead).not.toHaveBeenCalled();
  });

  it("markRead writes MiniFlux read-state and mirrors it to the index", async () => {
    const { applier, rss, overlay } = harness();
    await applier.markRead({ source: "miniflux", sourceId: "7" }, "miniflux:7", true);
    expect(rss.setRead).toHaveBeenCalledWith("7", true);
    expect(overlay.markIndexedRead).toHaveBeenCalledWith("miniflux:7", true);
  });

  it("markRead on a Readeck card completes reading progress (its only read signal)", async () => {
    // Readeck has no read flag, so read-state must be pushed as progress=1 —
    // otherwise the backend keeps reporting progress 0 and the next poll
    // re-derives `unopened`, losing the read state (newsletters especially).
    const { applier, rss, readLater, overlay } = harness();
    await applier.markRead({ source: "readeck", sourceId: "rd1" }, "readeck:rd1", true);
    expect(rss.setRead).not.toHaveBeenCalled();
    expect(readLater.setReadingProgress).toHaveBeenCalledWith("rd1", 1, null);
    expect(overlay.markIndexedRead).toHaveBeenCalledWith("readeck:rd1", true);
  });

  it("markRead(false) on a Readeck card clears reading progress", async () => {
    const { applier, readLater, overlay } = harness();
    await applier.markRead({ source: "readeck", sourceId: "rd1" }, "readeck:rd1", false);
    expect(readLater.setReadingProgress).toHaveBeenCalledWith("rd1", 0, null);
    expect(overlay.markIndexedRead).toHaveBeenCalledWith("readeck:rd1", false);
  });

  it("a Readeck markRead push failure aborts before the index mirror", async () => {
    const { applier, readLater, overlay } = harness();
    readLater.setReadingProgress.mockRejectedValueOnce(new Error("Readeck 502"));
    await expect(
      applier.markRead({ source: "readeck", sourceId: "rd1" }, "readeck:rd1", true),
    ).rejects.toThrow("Readeck 502");
    expect(overlay.markIndexedRead).not.toHaveBeenCalled();
  });

  it("delete removes the Readeck bookmark then tombstones the index row", async () => {
    const { applier, readLater, overlay } = harness();
    await applier.delete({ source: "readeck", sourceId: "rd1" }, "readeck:rd1");
    expect(readLater.delete).toHaveBeenCalledWith("rd1");
    expect(overlay.softDelete).toHaveBeenCalledWith(["readeck:rd1"]);
  });

  it("delete removes the MiniFlux entry then tombstones the index row", async () => {
    const { applier, rss, overlay } = harness();
    await applier.delete({ source: "miniflux", sourceId: "7" }, "miniflux:7");
    expect(rss.setRemoved).toHaveBeenCalledWith(["7"]);
    expect(overlay.softDelete).toHaveBeenCalledWith(["miniflux:7"]);
  });
});

describe("MutationApplier failure semantics", () => {
  it("a backend failure aborts before the overlay write, so the overlay never gets ahead", async () => {
    const { applier, readLater, overlay } = harness();
    readLater.setArchived.mockRejectedValueOnce(new Error("Readeck 502"));
    await expect(
      applier.setLocation({ source: "readeck", sourceId: "rd1" }, "readeck:rd1", "archive"),
    ).rejects.toThrow("Readeck 502");
    expect(overlay.upsertOverlay).not.toHaveBeenCalled();
  });

  it("removeHighlight throws when the highlight does not exist", async () => {
    const { applier, overlay } = harness();
    overlay.removeRssHighlight.mockResolvedValueOnce(false);
    await expect(applier.removeHighlight("hl_missing")).rejects.toThrow("highlight not found");
  });
});

describe("MutationApplier.apply dispatch", () => {
  it("routes a queued mutation through parseId to its owning store", async () => {
    const { applier, rss, overlay } = harness();
    await applier.apply({ type: "markRead", id: "miniflux:7", read: false });
    expect(rss.setRead).toHaveBeenCalledWith("7", false);
    expect(overlay.markIndexedRead).toHaveBeenCalledWith("miniflux:7", false);
  });

  it("rejects a mutation whose id has no parseable source", async () => {
    const { applier } = harness();
    await expect(applier.apply({ type: "setNote", id: "no-source", note: "x" })).rejects.toThrow(
      "invalid document id",
    );
  });
});
