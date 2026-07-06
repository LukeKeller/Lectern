import { afterEach, describe, expect, it, vi } from "vitest";
import {
  brandFromTitle,
  collectCssVars,
  contrastRatioHex,
  cssColorToHex,
  deriveReskin,
  extractLiteralPalette,
  googleFontFamily,
  googleFontFromImport,
  hostFromUrl,
  isVividAccent,
  mixHex,
  normalizeHexColor,
  parseSourceHead,
  resolveCssValue,
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

describe("cssColorToHex", () => {
  it("normalises #rgb, #rrggbb and drops alpha from #rgba / #rrggbbaa", () => {
    expect(cssColorToHex("#abc")).toBe("#aabbcc");
    expect(cssColorToHex("#1E90FF")).toBe("#1e90ff");
    expect(cssColorToHex("#12345678")).toBe("#123456");
    expect(cssColorToHex("#abcf")).toBe("#aabbcc");
  });
  it("parses rgb() / rgba() with numbers, percentages and modern slash syntax", () => {
    expect(cssColorToHex("rgb(30, 144, 255)")).toBe("#1e90ff");
    expect(cssColorToHex("rgba(0, 0, 0, 0.5)")).toBe("#000000");
    expect(cssColorToHex("rgb(100%, 0%, 0%)")).toBe("#ff0000");
    expect(cssColorToHex("rgb(255 0 0 / 50%)")).toBe("#ff0000");
  });
  it("maps a handful of named colours, with transparent → null", () => {
    expect(cssColorToHex("white")).toBe("#ffffff");
    expect(cssColorToHex("Black")).toBe("#000000");
    expect(cssColorToHex("transparent")).toBeNull();
  });
  it("returns null for gradients, currentColor and junk", () => {
    expect(cssColorToHex("linear-gradient(#fff,#000)")).toBeNull();
    expect(cssColorToHex("currentColor")).toBeNull();
    expect(cssColorToHex("var(--x)")).toBeNull();
    expect(cssColorToHex(null)).toBeNull();
  });
});

describe("resolveCssValue + collectCssVars", () => {
  it("resolves WordPress preset vars declared in :root", () => {
    const vars = collectCssVars(`:root {
      --wp--preset--color--base: #ffffff;
      --wp--preset--color--contrast: #1a1a1a;
    }`);
    expect(resolveCssValue("var(--wp--preset--color--base)", vars)).toBe("#ffffff");
    expect(resolveCssValue("var(--wp--preset--color--contrast)", vars)).toBe("#1a1a1a");
  });
  it("uses the fallback when the var is undeclared, else null", () => {
    const vars = collectCssVars(`body { --x: #123456; }`);
    expect(resolveCssValue("var(--x)", vars)).toBe("#123456");
    expect(resolveCssValue("var(--missing, #654321)", vars)).toBe("#654321");
    expect(resolveCssValue("var(--missing)", vars)).toBeNull();
  });
  it("resolves one level of indirection in two passes", () => {
    const vars = collectCssVars(`:root { --a: var(--b, #abcabc); --b: #010203; }`);
    expect(resolveCssValue("var(--a)", vars)).toBe("#010203");
  });
});

describe("contrastRatioHex", () => {
  it("computes WCAG contrast (black/white = 21)", () => {
    expect(contrastRatioHex("#000000", "#ffffff")).toBeCloseTo(21, 1);
    expect(contrastRatioHex("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
  });
  it("flags a low-contrast pair as < 3", () => {
    expect(contrastRatioHex("#777777", "#888888")).toBeLessThan(3);
  });
});

describe("extractLiteralPalette", () => {
  it("reads a plain body { background; color; font-family } rule + link + heading", () => {
    const css = `
      body { background-color: #ffffff; color: #222222; font-family: "Georgia", serif; }
      a { color: #c0392b; }
      h1 { font-family: "Playfair Display", serif; }
    `;
    expect(extractLiteralPalette(css)).toEqual({
      background: "#ffffff",
      backgroundDark: null,
      text: "#222222",
      link: "#c0392b",
      bodyFont: "Georgia",
      headingFont: "Playfair Display",
    });
  });

  it("resolves a WordPress-style var-based palette + a dark @media background", () => {
    const css = `
      :root {
        --wp--preset--color--base: #fefefe;
        --wp--preset--color--contrast: #1a1a1a;
        --wp--preset--font-family--body: "Source Serif Pro";
        --wp--preset--font-family--heading: "Poppins";
      }
      body {
        background: var(--wp--preset--color--base);
        color: var(--wp--preset--color--contrast);
        font-family: var(--wp--preset--font-family--body);
      }
      .entry-content a { color: #0073aa; }
      h1, h2 { font-family: var(--wp--preset--font-family--heading); }
      @media (prefers-color-scheme: dark) {
        body { background-color: #121212; color: #eeeeee; }
      }
    `;
    expect(extractLiteralPalette(css)).toEqual({
      background: "#fefefe",
      backgroundDark: "#121212",
      text: "#1a1a1a",
      link: "#0073aa",
      bodyFont: "Source Serif Pro",
      headingFont: "Poppins",
    });
  });

  it("returns nulls when body styling is absent", () => {
    const css = `.header { color: red } p { margin: 0 }`;
    expect(extractLiteralPalette(css)).toEqual({
      background: null,
      backgroundDark: null,
      text: null,
      link: null,
      bodyFont: null,
      headingFont: null,
    });
  });

  it("rejects a low-contrast background/text pair (nulls both)", () => {
    const css = `body { background: #777777; color: #888888; }`;
    const p = extractLiteralPalette(css);
    expect(p.background).toBeNull();
    expect(p.text).toBeNull();
  });
});

describe("deriveReskin", () => {
  it("synthesizes a tinted surface from the accent", () => {
    const d = deriveReskin({ accent: "#3a5e8c", accentDark: "#0a84ff" });
    expect(d.background).toBe(mixHex("#faf9f5", "#3a5e8c", 0.06));
    expect(d.backgroundDark).toBe(mixHex("#14120f", "#0a84ff", 0.12));
    expect(d.text).toBe("#241f1b");
    expect(d.link).toBe("#3a5e8c");
    // The light surface is a near-white tint, the dark surface a near-black one.
    expect(contrastRatioHex(d.background!, d.text!)).toBeGreaterThan(3);
    expect(contrastRatioHex(d.backgroundDark!, "#f0eee9")).toBeGreaterThan(3);
  });
  it("falls back to accent for the dark ground when accentDark is null", () => {
    const d = deriveReskin({ accent: "#3a5e8c", accentDark: null });
    expect(d.backgroundDark).toBe(mixHex("#14120f", "#3a5e8c", 0.12));
  });
  it("returns all-null with no accent", () => {
    expect(deriveReskin({ accent: null, accentDark: null })).toEqual({
      background: null,
      backgroundDark: null,
      text: null,
      link: null,
    });
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

  it("uses a source's REAL palette from inline CSS (literal)", async () => {
    const html = `<head>
      <meta property="og:site_name" content="Lit News">
      <style>
        :root { --brand: #c0392b; }
        body { background-color: #fffdf7; color: #21201c; font-family: "Georgia", serif; }
        a { color: var(--brand); }
        h1 { font-family: "Playfair Display", serif; }
      </style>
    </head>`;
    vi.spyOn(globalThis, "fetch").mockResolvedValue(htmlResponse(html));

    const { ok, tokens } = await sourceThemeFromUrl("https://litnews.example/some/article");
    expect(ok).toBe(true);
    expect(tokens.derivation).toBe("literal");
    expect(tokens.background).toBe("#fffdf7");
    expect(tokens.text).toBe("#21201c");
    expect(tokens.link).toBe("#c0392b");
    expect(tokens.bodyFont).toBe("Georgia");
    expect(tokens.displayFont).toBe("Playfair Display");
    expect(tokens.siteName).toBe("Lit News");
    expect(Object.keys(tokens).sort()).toEqual(
      [
        "accent",
        "accentDark",
        "background",
        "backgroundDark",
        "bodyFont",
        "derivation",
        "displayFont",
        "faviconUrl",
        "link",
        "siteName",
        "text",
      ].sort(),
    );
  });

  it("synthesizes a re-skin from the brand accent when CSS is unreadable (derived)", async () => {
    const html = `<head>
      <meta name="theme-color" content="#1e7a46">
      <meta property="og:site_name" content="Derive Co">
    </head>`;
    vi.spyOn(globalThis, "fetch").mockResolvedValue(htmlResponse(html));

    const { ok, tokens } = await sourceThemeFromUrl("https://derive.example/x");
    expect(ok).toBe(true);
    expect(tokens.derivation).toBe("derived");
    expect(tokens.accent).toBe("#1e7a46");
    expect(tokens.background).toBe(mixHex("#faf9f5", "#1e7a46", 0.06));
    expect(tokens.backgroundDark).toBe(mixHex("#14120f", "#1e7a46", 0.12));
    expect(tokens.text).toBe("#241f1b");
    expect(tokens.link).toBeNull(); // reader falls back to accent
    expect(tokens.bodyFont).toBeNull();
  });

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
      background: mixHex("#faf9f5", "#3a5e8c", 0.06),
      backgroundDark: mixHex("#14120f", "#0a84ff", 0.12),
      text: "#241f1b",
      link: null,
      bodyFont: null,
      displayFont: null,
      faviconUrl: "https://example.com/touch.png",
      siteName: "Example News",
      derivation: "derived",
    });
  });

  it("signals ok:false with all-null tokens when the origin fetch fails", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network"));
    const { ok, tokens } = await sourceThemeFromUrl("https://example.com/x");
    expect(ok).toBe(false);
    expect(tokens).toEqual({
      accent: null,
      accentDark: null,
      background: null,
      backgroundDark: null,
      text: null,
      link: null,
      bodyFont: null,
      displayFont: null,
      faviconUrl: null,
      siteName: null,
      derivation: null,
    });
  });

  it("signals ok:false for a bad host", async () => {
    const { ok, tokens } = await sourceThemeFromUrl("not a url");
    expect(ok).toBe(false);
    expect(tokens.faviconUrl).toBeNull();
  });
});
