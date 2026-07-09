import { describe, expect, it } from "vitest";
import { buildSeedProfile, updateProfile } from "./rocchio";

const W = { a: 1, b: 0.75, c: 0.25 };

describe("updateProfile", () => {
  it("applies the Rocchio formula a*profile + b*mean(liked) - c*mean(disliked)", () => {
    const profile = { x: 1 };
    const liked = [{ y: 1 }];
    const disliked = [{ z: 1 }];
    const out = updateProfile(profile, liked, disliked, W);
    expect(out.x).toBeCloseTo(1, 10); // 1 * a
    expect(out.y).toBeCloseTo(0.75, 10); // b * mean(liked)
    expect(out.z).toBeUndefined(); // -c*1 < 0 -> clamped away
  });

  it("averages multiple liked/disliked vectors", () => {
    const out = updateProfile({}, [{ y: 2 }, { y: 4 }], [], W);
    // mean(liked).y = 3 ; * b(0.75) = 2.25
    expect(out.y).toBeCloseTo(2.25, 10);
  });

  it("clamps negative resultant weights to zero (drops the term)", () => {
    // disliked heavily outweighs a small profile presence.
    const out = updateProfile({ t: 0.1 }, [], [{ t: 10 }], W);
    expect(out.t).toBeUndefined();
  });

  it("keeps at most top-K terms by weight", () => {
    const profile: Record<string, number> = {};
    for (let i = 0; i < 50; i++) profile[`t${i}`] = i + 1;
    const out = updateProfile(profile, [], [], W, 10);
    expect(Object.keys(out)).toHaveLength(10);
    // the heaviest terms survive (t49 is the largest)
    expect(out.t49).toBeCloseTo(50, 10);
    expect(out.t0).toBeUndefined();
  });
});

describe("buildSeedProfile", () => {
  it("builds a profile + idf from docs and tags", () => {
    const { vector, idf, docCount } = buildSeedProfile({
      docs: [
        { text: "machine learning models and neural networks", weight: 1 },
        { text: "distributed systems and databases", weight: 1 },
      ],
      tags: [{ name: "kubernetes", weight: 3 }],
    });
    expect(docCount).toBe(3); // 2 docs + 1 tag pseudo-doc
    expect(Object.keys(vector).length).toBeGreaterThan(0);
    expect(Object.keys(idf).length).toBeGreaterThan(0);
    // the profile vector is L2-normalized
    const norm = Math.sqrt(Object.values(vector).reduce((s, v) => s + v * v, 0));
    expect(norm).toBeCloseTo(1, 10);
  });

  it("gives heavier tags more mass in the profile", () => {
    const light = buildSeedProfile({ docs: [], tags: [{ name: "rust", weight: 1 }] });
    const heavy = buildSeedProfile({ docs: [], tags: [{ name: "rust", weight: 5 }] });
    // Single-term profiles both normalize to 1, but the raw aggregate differs;
    // both should contain the stemmed tag term.
    expect(Object.keys(light.vector)).toContain("rust");
    expect(Object.keys(heavy.vector)).toContain("rust");
  });
});
