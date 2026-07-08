import { describe, expect, it } from "vitest";
import { normalizeUrl } from "./discovery-url";

describe("normalizeUrl", () => {
  it("lowercases the host but preserves the path case", () => {
    expect(normalizeUrl("https://EXAMPLE.com/Some/Path")).toBe("https://example.com/Some/Path");
  });

  it("strips utm_* tracking params but keeps the rest (in order)", () => {
    expect(normalizeUrl("https://ex.com/a?utm_source=x&b=1&utm_medium=y&c=2")).toBe(
      "https://ex.com/a?b=1&c=2",
    );
  });

  it("drops the fragment", () => {
    expect(normalizeUrl("https://ex.com/a#section-2")).toBe("https://ex.com/a");
  });

  it("removes a trailing slash from a non-root path", () => {
    expect(normalizeUrl("https://ex.com/a/b/")).toBe("https://ex.com/a/b");
  });

  it("keeps the root path slash", () => {
    expect(normalizeUrl("https://ex.com/")).toBe("https://ex.com/");
  });

  it("collapses tracking + fragment + trailing slash together and is idempotent", () => {
    const once = normalizeUrl("https://Ex.com/Post/?utm_campaign=z&q=1#top");
    expect(once).toBe("https://ex.com/Post?q=1");
    expect(normalizeUrl(once)).toBe(once);
  });

  it("falls back to a trimmed, lowercased form for a non-URL input", () => {
    expect(normalizeUrl("  NOT a url  ")).toBe("not a url");
  });
});
