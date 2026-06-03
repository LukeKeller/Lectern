import { describe, expect, it } from "vitest";
import { parseCsv, parseReadwiseCsv } from "./csv";

describe("parseCsv", () => {
  it("handles quoted fields with embedded commas and newlines", () => {
    const rows = parseCsv('a,b\n"x,y","line1\nline2"\n');
    expect(rows[0]).toEqual(["a", "b"]);
    expect(rows[1]).toEqual(["x,y", "line1\nline2"]);
  });

  it("handles escaped quotes", () => {
    expect(parseCsv('"He said ""hi"""')[0]).toEqual(['He said "hi"']);
  });
});

describe("parseReadwiseCsv", () => {
  const csv = [
    "Title,URL,Source URL,Document tags,Location",
    'Hello,https://reader/abc,https://example.com/post,"ai, longread",Archive',
    "No url row,,,,later",
    "Feed item,https://reader/x,https://blog.test/x,,later",
  ].join("\n");

  it("prefers Source URL, splits tags, lowercases location, skips rows without an http url", () => {
    const rows = parseReadwiseCsv(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      url: "https://example.com/post",
      title: "Hello",
      tags: ["ai", "longread"],
      location: "archive",
    });
    expect(rows[1]!.url).toBe("https://blog.test/x");
    expect(rows[1]!.tags).toEqual([]);
  });

  it("returns [] when there is no url column", () => {
    expect(parseReadwiseCsv("Title,Author\nx,y")).toEqual([]);
  });
});
