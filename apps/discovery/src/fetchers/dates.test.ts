import { describe, expect, it } from "vitest";
import { isoOrUndefined, parseRelativeAge } from "./dates";

const now = new Date("2026-07-09T12:00:00Z");

describe("parseRelativeAge", () => {
  it("converts relative ages to ISO relative to now", () => {
    expect(parseRelativeAge("3 days ago", now)).toBe(
      new Date("2026-07-06T12:00:00Z").toISOString(),
    );
    expect(parseRelativeAge("1 week ago", now)).toBe(
      new Date("2026-07-02T12:00:00Z").toISOString(),
    );
    expect(parseRelativeAge("2 hours ago", now)).toBe(
      new Date("2026-07-09T10:00:00Z").toISOString(),
    );
  });

  it("handles singular/plural units case-insensitively", () => {
    expect(parseRelativeAge("1 Day Ago", now)).toBe(new Date("2026-07-08T12:00:00Z").toISOString());
  });

  it("keeps an already-ISO date verbatim", () => {
    expect(parseRelativeAge("2026-01-02", now)).toBe("2026-01-02");
    expect(parseRelativeAge("2026-01-02T10:00:00Z", now)).toBe("2026-01-02T10:00:00Z");
  });

  it("normalizes other absolute formats to ISO", () => {
    expect(parseRelativeAge("January 2, 2026", now)).toBe(
      new Date("January 2, 2026").toISOString(),
    );
  });

  it("returns undefined for unparseable input", () => {
    expect(parseRelativeAge("whenever", now)).toBeUndefined();
    expect(parseRelativeAge("", now)).toBeUndefined();
    expect(parseRelativeAge("some time ago", now)).toBeUndefined();
  });
});

describe("isoOrUndefined", () => {
  it("passes through ISO dates and drops junk", () => {
    expect(isoOrUndefined("2026-01-01")).toBe("2026-01-01");
    expect(isoOrUndefined(null)).toBeUndefined();
    expect(isoOrUndefined(undefined)).toBeUndefined();
    expect(isoOrUndefined("not a date")).toBeUndefined();
    expect(isoOrUndefined("")).toBeUndefined();
  });
});
