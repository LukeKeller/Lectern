import { afterEach, describe, expect, it, vi } from "vitest";
import {
  brandFromTitle,
  googleFontFamily,
  googleFontFromImport,
  hostFromUrl,
  isVividAccent,
  normalizeHexColor,
  parseSourceHead,
  sourceThemeFromUrl,
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

describe("googleFontFromImport", () => {
  it("extracts the family from an @import url() with quotes", () => {
    expect(
      googleFontFromImport(`@import url('https://fonts.googleapis.com/css2?family=Lora:wght@400');`),
    ).toBe("Lora");
  });
  it("handles a bare @import url() without quotes", () => {
    expect(
      googleFontFromImport(`@import url(https://fonts.googleapis.com/css?family=Roboto+Slab);`),
    ).toBe("Roboto Slab");
  });
  it("handles @import with a bare quoted string (no url())", () => {
    expect(
      googleFontFromImport(`@import "https://fonts.googleapis.com/css2?family=Merriweather";`),
    ).toBe("Merriweather");
  });
  it("ignores non-Google @imports", () => {
    expect(googleFontFromImport(`@import url('https://example.com/app.css');`)).toBeNull();
  });
});

describe("brandFromTitle", () => {
  it("takes the last segment when a separator is present", () => {
    expect(brandFromTitle("Some Long Headline | The Verge")).toBe("The Verge");
    expect(brandFromTitle("Article – Ars Technica")).toBe("Ars Technica");
    expect(brandFromTitle("Story: NPR")).toBe("NPR");
  });
  it("returns the whole title when there's no separator", () => {
    expect(brandFromTitle("The Daily Bugle")).toBe("The Daily Bugle");
  });
  it("caps very long titles and trims", () => {
    const long = "x".repeat(200);
    expect(brandFromTitle(`  ${long}  `)?.length).toBe(80);
  });
  it("returns null for empty / whitespace", () => {
    expect(brandFromTitle("   ")).toBeNull();
    expect(brandFromTitle(null)).toBeNull();
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

  it("surfaces a dark-media theme-color separately as themeColorDark", () => {
    const html = `<head>
      <meta name="theme-color" content="#3a5e8c">
      <meta name="theme-color" media="(prefers-color-scheme: dark)" content="#0a84ff">
    </head>`;
    const p = parseSourceHead(html);
    expect(p.themeColor).toBe("#3a5e8c");
    expect(p.themeColorDark).toBe("#0a84ff");
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

  it("detects a Google font imported inside a <style> block", () => {
    const html = `<head>
      <style>
        @import url('https://fonts.googleapis.com/css2?family=Spectral:wght@400;600');
        body { margin: 0; }
      </style>
    </head>`;
    expect(parseSourceHead(html).displayFont).toBe("Spectral");
  });

  it("extracts siteName from og:site_name (preferred)", () => {
    const html = `<head>
      <meta property="og:site_name" content="The Verge">
      <meta name="application-name" content="verge-app">
      <title>Headline | Something Else</title>
    </head>`;
    expect(parseSourceHead(html).siteName).toBe("The Verge");
  });

  it("falls back to application-name, then to the title's brand segment", () => {
    const appOnly = `<head><meta name="application-name" content="Ars Technica"></head>`;
    expect(parseSourceHead(appOnly).siteName).toBe("Ars Technica");

    const titleOnly = `<head><title>Some Article Headline | NPR</title></head>`;
    expect(parseSourceHead(titleOnly).siteName).toBe("NPR");
  });

  it("returns nulls when the head has no signals", () => {
    const p = parseSourceHead(`<head><meta charset="utf-8"></head>`);
    expect(p).toEqual({
      themeColor: null,
      themeColorDark: null,
      faviconHref: null,
      manifestHref: null,
      displayFont: null,
      siteName: null,
    });
  });

  it("handles single-quoted attributes and only scans the head", () => {
    const html = `<head><meta name='theme-color' content='#ff8800'></head><body><link rel="icon" href="/nope.png"></body>`;
    const p = parseSourceHead(html);
    expect(p.themeColor).toBe("#ff8800");
    expect(p.faviconHref).toBeNull();
  });
});

describe("sourceThemeFromUrl", () => {
  afterEach(() => vi.restoreAllMocks());

  const htmlResponse = (body: string) =>
    ({
      ok: true,
      headers: { get: (h: string) => (h === "content-length" ? String(body.length) : null) },
      text: async () => body,
    }) as unknown as Response;

  it("upgrades an http favicon to https and returns the full token shape", async () => {
    const html = `<head>
      <meta name="theme-color" content="#3a5e8c">
      <meta name="theme-color" media="(prefers-color-scheme: dark)" content="#0a84ff">
      <meta property="og:site_name" content="Example News">
      <link rel="apple-touch-icon" href="http://example.com/touch.png">
    </head>`;
    vi.spyOn(globalThis, "fetch").mockResolvedValue(htmlResponse(html));

    const { ok, tokens } = await sourceThemeFromUrl("https://example.com/some/article");
    expect(ok).toBe(true);
    expect(tokens).toEqual({
      accent: "#3a5e8c",
      accentDark: "#0a84ff",
      faviconUrl: "https://example.com/touch.png",
      displayFont: null,
      siteName: "Example News",
    });
  });

  it("signals ok:false with all-null tokens when the origin fetch fails", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network"));
    const { ok, tokens } = await sourceThemeFromUrl("https://example.com/x");
    expect(ok).toBe(false);
    expect(tokens).toEqual({
      accent: null,
      accentDark: null,
      faviconUrl: null,
      displayFont: null,
      siteName: null,
    });
  });

  it("signals ok:false for a bad host", async () => {
    const { ok, tokens } = await sourceThemeFromUrl("not a url");
    expect(ok).toBe(false);
    expect(tokens.faviconUrl).toBeNull();
  });
});
