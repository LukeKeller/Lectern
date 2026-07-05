import { describe, expect, it } from "vitest";
import {
  googleFontFamily,
  hostFromUrl,
  isVividAccent,
  normalizeHexColor,
  parseSourceHead,
} from "./source-theme";

describe("normalizeHexColor", () => {
  it("normalises 3- and 6-digit hex, with or without #", () => {
    expect(normalizeHexColor("#AABBCC")).toBe("#aabbcc");
    expect(normalizeHexColor("abc")).toBe("#aabbcc");
    expect(normalizeHexColor("  #1e90ff ")).toBe("#1e90ff");
  });
  it("rejects non-hex values", () => {
    expect(normalizeHexColor("rgb(1,2,3)")).toBeNull();
    expect(normalizeHexColor("blue")).toBeNull();
    expect(normalizeHexColor(null)).toBeNull();
  });
});

describe("isVividAccent", () => {
  it("accepts saturated mid-tones", () => {
    expect(isVividAccent("#1e90ff")).toBe(true);
    expect(isVividAccent("#b34a3a")).toBe(true);
  });
  it("rejects white, black and greys", () => {
    expect(isVividAccent("#ffffff")).toBe(false);
    expect(isVividAccent("#000000")).toBe(false);
    expect(isVividAccent("#808080")).toBe(false);
  });
});

describe("googleFontFamily", () => {
  it("extracts and unslugs the first family from a css2 link", () => {
    expect(
      googleFontFamily("https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700"),
    ).toBe("Playfair Display");
  });
  it("handles the legacy css endpoint", () => {
    expect(googleFontFamily("https://fonts.googleapis.com/css?family=Lora")).toBe("Lora");
  });
  it("ignores non-Google stylesheets", () => {
    expect(googleFontFamily("https://example.com/app.css")).toBeNull();
  });
});

describe("hostFromUrl", () => {
  it("lowercases and strips www", () => {
    expect(hostFromUrl("https://www.The-Verge.com/x/y")).toBe("the-verge.com");
  });
  it("returns null for junk", () => {
    expect(hostFromUrl("not a url")).toBeNull();
  });
});

describe("parseSourceHead", () => {
  it("picks a non-media theme-color over a media-scoped one", () => {
    const html = `<head>
      <meta name="theme-color" media="(prefers-color-scheme: dark)" content="#000000">
      <meta name="theme-color" content="#3a5e8c">
    </head><body>...</body>`;
    expect(parseSourceHead(html).themeColor).toBe("#3a5e8c");
  });

  it("falls back to a media theme-color when that's all there is", () => {
    const html = `<head><meta name="theme-color" media="(prefers-color-scheme: light)" content="#abc"></head>`;
    expect(parseSourceHead(html).themeColor).toBe("#aabbcc");
  });

  it("prefers apple-touch-icon over a plain icon, and finds the manifest + font", () => {
    const html = `<head>
      <link rel="icon" href="/favicon.ico">
      <link rel="apple-touch-icon" href="/touch.png">
      <link rel="manifest" href="/site.webmanifest">
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Merriweather:wght@700">
    </head>`;
    const p = parseSourceHead(html);
    expect(p.faviconHref).toBe("/touch.png");
    expect(p.manifestHref).toBe("/site.webmanifest");
    expect(p.displayFont).toBe("Merriweather");
  });

  it("returns nulls when the head has no signals", () => {
    const p = parseSourceHead(`<head><title>Nothing</title></head>`);
    expect(p).toEqual({
      themeColor: null,
      faviconHref: null,
      manifestHref: null,
      displayFont: null,
    });
  });

  it("handles single-quoted attributes and only scans the head", () => {
    const html = `<head><meta name='theme-color' content='#ff8800'></head><body><link rel="icon" href="/nope.png"></body>`;
    const p = parseSourceHead(html);
    expect(p.themeColor).toBe("#ff8800");
    expect(p.faviconHref).toBeNull();
  });
});
