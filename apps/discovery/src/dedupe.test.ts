import { describe, expect, it } from "vitest";
import { normalizeUrl, Seen } from "./dedupe";

describe("normalizeUrl", () => {
  const cases: Array<[string, string]> = [
    // strips utm_* params
    ["https://ex.com/a?utm_source=x&utm_medium=y", "https://ex.com/a"],
    // keeps meaningful params, drops only trackers
    ["https://ex.com/a?id=5&utm_source=x", "https://ex.com/a?id=5"],
    // drops the fragment
    ["https://ex.com/a#section", "https://ex.com/a"],
    // trailing slash on a non-root path is removed
    ["https://ex.com/a/", "https://ex.com/a"],
    // root slash is preserved
    ["https://ex.com/", "https://ex.com/"],
    // host is lowercased (path case is preserved)
    ["https://EX.COM/Foo", "https://ex.com/Foo"],
    // drops common click-id trackers
    ["https://ex.com/a?fbclid=abc&gclid=def", "https://ex.com/a"],
  ];

  for (const [input, expected] of cases) {
    it(`normalizes ${input}`, () => {
      expect(normalizeUrl(input)).toBe(expected);
    });
  }

  it("treats URLs differing only by tracking params as equal", () => {
    expect(normalizeUrl("https://ex.com/x?utm_source=a")).toBe(
      normalizeUrl("https://ex.com/x?utm_source=b"),
    );
  });
});

describe("Seen", () => {
  it("reports the first add as new and duplicates as seen", () => {
    const seen = new Seen();
    expect(seen.add("https://ex.com/a")).toBe(true);
    expect(seen.add("https://ex.com/a/")).toBe(false); // normalized duplicate
    expect(seen.add("https://ex.com/b?utm_source=x")).toBe(true);
    expect(seen.has("https://ex.com/b")).toBe(true);
    expect(seen.size).toBe(2);
  });
});
