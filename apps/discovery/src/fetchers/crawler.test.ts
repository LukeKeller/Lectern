import { describe, expect, it } from "vitest";
import { isContentUrl, parseRobots } from "./crawler";

describe("isContentUrl", () => {
  const ok = (u: string) => isContentUrl(new URL(u));

  it("rejects site roots / homepages", () => {
    expect(ok("https://example.com/")).toBe(false);
    expect(ok("https://example.com")).toBe(false);
  });

  it("rejects social / profile silos and handles", () => {
    expect(ok("https://bsky.app/profile/molly.wiki")).toBe(false);
    expect(ok("https://hachyderm.io/@molly0xfff")).toBe(false);
    expect(ok("https://example.com/@someone")).toBe(false);
    expect(ok("https://example.com/author/jane")).toBe(false);
  });

  it("rejects section-index / nav-utility pages", () => {
    expect(ok("https://mollywhite.net/social")).toBe(false);
    expect(ok("https://mollywhite.net/support")).toBe(false);
    expect(ok("https://example.com/about")).toBe(false);
    expect(ok("https://example.com/tags/ai")).toBe(false);
    expect(ok("https://example.com/culture")).toBe(false); // bare section word
  });

  it("accepts real article slugs", () => {
    expect(ok("https://jilltxt.net/genre-glitches-and-ai-writing/")).toBe(true);
    expect(ok("https://newyorker.com/culture/progress-report/why-book-shaming")).toBe(true);
    expect(ok("https://example.com/2026/01/my-post")).toBe(true);
  });
});

describe("parseRobots", () => {
  it("allows everything when there are no rules", () => {
    const m = parseRobots("", "LecternDiscoveryBot");
    expect(m("/anything")).toBe(true);
  });

  it("honours a wildcard Disallow", () => {
    const m = parseRobots("User-agent: *\nDisallow: /private", "LecternDiscoveryBot");
    expect(m("/private/x")).toBe(false);
    expect(m("/public/x")).toBe(true);
  });

  it("lets a more specific Allow override a Disallow", () => {
    const txt = "User-agent: *\nDisallow: /docs\nAllow: /docs/public";
    const m = parseRobots(txt, "LecternDiscoveryBot");
    expect(m("/docs/secret")).toBe(false);
    expect(m("/docs/public/page")).toBe(true);
  });

  it("applies a bot-specific group that matches our UA", () => {
    const txt = [
      "User-agent: Googlebot",
      "Disallow: /",
      "User-agent: LecternDiscoveryBot",
      "Disallow: /no",
    ].join("\n");
    const m = parseRobots(txt, "LecternDiscoveryBot");
    expect(m("/no/thing")).toBe(false);
    expect(m("/yes")).toBe(true);
  });

  it("treats an empty Disallow as allow-all", () => {
    const m = parseRobots("User-agent: *\nDisallow:", "LecternDiscoveryBot");
    expect(m("/whatever")).toBe(true);
  });
});
