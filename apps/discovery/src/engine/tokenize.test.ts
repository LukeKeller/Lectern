import { describe, expect, it } from "vitest";
import { surfaceForms, termFrequencies, tokenize } from "./tokenize";

describe("tokenize", () => {
  it("is deterministic for the same input", () => {
    const a = tokenize("The quick brown fox jumps over the lazy dog");
    const b = tokenize("The quick brown fox jumps over the lazy dog");
    expect(a).toEqual(b);
  });

  it("lowercases and strips punctuation/non-alpha", () => {
    const tokens = tokenize("Hello, WORLD! 123 test-case");
    // digits dropped, punctuation split; stems returned.
    expect(tokens).not.toContain("123");
    expect(tokens).toContain("hello");
    expect(tokens).toContain("world");
  });

  it("removes stopwords", () => {
    const tokens = tokenize("the and of a to in is it");
    expect(tokens).toEqual([]);
  });

  it("drops publication/web boilerplate but keeps real interest terms", () => {
    // Newsletter/nav boilerplate that otherwise dominates the profile.
    const boiler = tokenize("Issue Vol New Subscribe Newsletter Read More Home Page Weekly");
    expect(boiler).toEqual([]);
    // Genuine interest terms survive (stemmed).
    const real = tokenize("artificial intelligence video games photography poetry");
    expect(real).toContain("intellig");
    expect(real).toContain("game");
    expect(real).not.toContain("issue");
    expect(real).not.toContain("new");
  });

  it("Porter-stems tokens (running -> run)", () => {
    expect(tokenize("running")).toEqual(["run"]);
    // Different surface forms collapse to a shared stem.
    expect(tokenize("connection connections connective")).toEqual([
      "connect",
      "connect",
      "connect",
    ]);
  });
});

describe("surfaceForms", () => {
  it("maps each stem to the first surface word that produced it", () => {
    const map = surfaceForms("Connection connections connective running");
    expect(map.connect).toBe("connection"); // first occurrence wins
    expect(map.run).toBe("running");
  });

  it("uses the same stopword/strip pipeline as tokenize so stems line up", () => {
    const map = surfaceForms("The intelligent systems");
    // stopword "the" dropped; stems match tokenize's output.
    expect(map).not.toHaveProperty("the");
    expect(Object.keys(map).sort()).toEqual(tokenize("intelligent systems").sort());
    expect(map.intellig).toBe("intelligent");
  });

  it("returns an empty map for empty text", () => {
    expect(surfaceForms("")).toEqual({});
  });
});

describe("termFrequencies", () => {
  it("counts occurrences", () => {
    expect(termFrequencies(["run", "run", "jump"])).toEqual({ run: 2, jump: 1 });
  });

  it("scales by weight", () => {
    expect(termFrequencies(["run", "jump"], 3)).toEqual({ run: 3, jump: 3 });
  });

  it("returns an empty vector for no tokens", () => {
    expect(termFrequencies([])).toEqual({});
  });
});
