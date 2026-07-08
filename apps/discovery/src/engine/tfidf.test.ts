import { describe, expect, it } from "vitest";
import { computeIdf, cosine, tfidfVector } from "./tfidf";

describe("cosine", () => {
  it("is 0 for orthogonal (disjoint) vectors", () => {
    expect(cosine({ a: 1, b: 2 }, { c: 3, d: 4 })).toBe(0);
  });

  it("is 1 for identical vectors", () => {
    expect(cosine({ a: 1, b: 2, c: 3 }, { a: 1, b: 2, c: 3 })).toBeCloseTo(1, 10);
  });

  it("is 1 for parallel vectors regardless of magnitude", () => {
    expect(cosine({ a: 1, b: 2 }, { a: 2, b: 4 })).toBeCloseTo(1, 10);
  });

  it("is between 0 and 1 for partially overlapping vectors", () => {
    const c = cosine({ a: 1, b: 1 }, { a: 1, c: 1 });
    expect(c).toBeGreaterThan(0);
    expect(c).toBeLessThan(1);
  });

  it("treats a zero vector as orthogonal to everything", () => {
    expect(cosine({}, { a: 1 })).toBe(0);
  });
});

describe("computeIdf", () => {
  it("weights rare terms above common ones", () => {
    // "common" appears in all 3 docs; "rare" in 1.
    const { idf, docCount } = computeIdf([
      { common: 1, rare: 1 },
      { common: 1 },
      { common: 1 },
    ]);
    expect(docCount).toBe(3);
    expect(idf.rare).toBeGreaterThan(idf.common!);
  });
});

describe("tfidfVector", () => {
  it("produces a unit-length vector", () => {
    const { idf } = computeIdf([{ a: 1, b: 1 }, { a: 1 }]);
    const vec = tfidfVector({ a: 2, b: 1 }, idf);
    const norm = Math.sqrt(Object.values(vec).reduce((s, v) => s + v * v, 0));
    expect(norm).toBeCloseTo(1, 10);
  });

  it("uses the default idf for unseen terms", () => {
    const vec = tfidfVector({ unseen: 5 }, {});
    // single term -> normalizes to 1
    expect(vec.unseen).toBeCloseTo(1, 10);
  });
});
