import { describe, expect, it } from "vitest";
import { termFrequencies, tokenize } from "./tokenize";

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

  it("Porter-stems tokens (running -> run)", () => {
    expect(tokenize("running")).toEqual(["run"]);
    // Different surface forms collapse to a shared stem.
    expect(tokenize("connection connections connective")).toEqual(["connect", "connect", "connect"]);
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
