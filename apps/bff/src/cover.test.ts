import { describe, expect, it } from "vitest";
import { extractCoverImage, safeHttpUrl } from "./cover";

describe("safeHttpUrl", () => {
  it("accepts absolute http(s) and resolves relative against a base", () => {
    expect(safeHttpUrl("https://x.com/a.jpg")).toBe("https://x.com/a.jpg");
    expect(safeHttpUrl("/a.jpg", "https://x.com/post")).toBe("https://x.com/a.jpg");
  });

  it("rejects non-http(s) schemes and junk", () => {
    expect(safeHttpUrl("data:image/png;base64,AAAA")).toBeNull();
    expect(safeHttpUrl("not a url")).toBeNull();
    expect(safeHttpUrl(null)).toBeNull();
    expect(safeHttpUrl(undefined)).toBeNull();
  });
});

describe("extractCoverImage", () => {
  it("prefers og:image over inline images", () => {
    const html = `<head><meta property="og:image" content="https://x.com/og.jpg"></head><body><img src="https://x.com/inline.jpg"></body>`;
    expect(extractCoverImage(html, "https://x.com/post")).toBe("https://x.com/og.jpg");
  });

  it("falls back to the first <img>, resolving a relative src", () => {
    const html = `<p>hi</p><img src="/media/first.png"><img src="/media/second.png">`;
    expect(extractCoverImage(html, "https://x.com/post")).toBe("https://x.com/media/first.png");
  });

  it("returns null when there is no usable image", () => {
    expect(extractCoverImage("<p>no images here</p>", "https://x.com")).toBeNull();
    expect(extractCoverImage(undefined, "https://x.com")).toBeNull();
    expect(extractCoverImage('<img src="data:image/png;base64,AAAA">', "https://x.com")).toBeNull();
  });
});
