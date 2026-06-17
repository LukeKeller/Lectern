import { describe, expect, it } from "vitest";
import { isBlockedHost, resolveImageTarget, rewriteArticleImages } from "./images";

const BASE = "https://lectern.test";
const proxy = (docId: string, ref: string) =>
  `${BASE}/media/documents/${encodeURIComponent(docId)}/image?u=${encodeURIComponent(ref)}`;

describe("rewriteArticleImages", () => {
  it("routes a relative (in-archive) image through the proxy", () => {
    const out = rewriteArticleImages('<p>x</p><img src="img/a.jpg">', "readeck:b1", BASE);
    expect(out).toContain(`src="${proxy("readeck:b1", "img/a.jpg")}"`);
    expect(out).not.toContain('src="img/a.jpg"');
    expect(out).toContain("<p>x</p>");
  });

  it("proxies an absolute image and drops its srcset/sizes", () => {
    const out = rewriteArticleImages(
      '<img src="https://cdn.x/y.png" srcset="https://cdn.x/y-2x.png 2x" sizes="50vw" width="600">',
      "miniflux:42",
      BASE,
    );
    expect(out).toContain(`src="${proxy("miniflux:42", "https://cdn.x/y.png")}"`);
    expect(out).not.toMatch(/srcset/i);
    expect(out).not.toMatch(/sizes/i);
    expect(out).toContain('width="600"'); // unrelated attributes are preserved
  });

  it("promotes a lazy data-src over a data: placeholder src", () => {
    const out = rewriteArticleImages(
      '<img src="data:image/gif;base64,AAAA" data-src="https://cdn.x/real.jpg">',
      "miniflux:42",
      BASE,
    );
    expect(out).toContain(`src="${proxy("miniflux:42", "https://cdn.x/real.jpg")}"`);
    expect(out).not.toMatch(/data-src/i);
    expect(out).not.toContain("data:image/gif");
  });

  it("picks the highest-resolution srcset candidate when there is no src", () => {
    const out = rewriteArticleImages(
      '<img srcset="https://x/s.jpg 480w, https://x/l.jpg 1024w">',
      "miniflux:42",
      BASE,
    );
    expect(out).toContain(`src="${proxy("miniflux:42", "https://x/l.jpg")}"`);
  });

  it("strips <picture> <source srcset> and proxies the <img> fallback", () => {
    const out = rewriteArticleImages(
      '<picture><source srcset="https://x/a.webp" type="image/webp"><img src="https://x/a.jpg"></picture>',
      "readeck:b1",
      BASE,
    );
    expect(out).not.toContain("<source");
    expect(out).toContain(`src="${proxy("readeck:b1", "https://x/a.jpg")}"`);
  });

  it("decodes HTML entities in the reference before encoding", () => {
    const out = rewriteArticleImages('<img src="https://x/a?b=1&amp;c=2">', "miniflux:42", BASE);
    expect(out).toContain(`u=${encodeURIComponent("https://x/a?b=1&c=2")}`);
  });

  it("leaves an inline data: image and non-image markup untouched", () => {
    const data = '<img src="data:image/png;base64,iVBOR">';
    expect(rewriteArticleImages(data, "miniflux:42", BASE)).toBe(data);
    expect(rewriteArticleImages("<p>hi</p>", "miniflux:42", BASE)).toBe("<p>hi</p>");
  });

  it("handles single quotes and attribute order", () => {
    const out = rewriteArticleImages("<img alt='cat' src='img/x.png'>", "readeck:b1", BASE);
    expect(out).toContain(`src="${proxy("readeck:b1", "img/x.png")}"`);
    expect(out).toContain("alt='cat'");
  });
});

describe("resolveImageTarget", () => {
  it("maps a relative readeck ref to an authed resource fetch", () => {
    expect(resolveImageTarget("readeck", "b1", "img/a.jpg", null)).toEqual({
      kind: "resource",
      sourceId: "b1",
      ref: "img/a.jpg",
    });
    expect(resolveImageTarget("readeck", "b1", "/bm/x/y.jpg", null)).toEqual({
      kind: "resource",
      sourceId: "b1",
      ref: "/bm/x/y.jpg",
    });
  });

  it("rejects archive path traversal", () => {
    expect(resolveImageTarget("readeck", "b1", "../../secret", null)).toBeNull();
  });

  it("treats absolute http(s) refs as guarded remote fetches", () => {
    expect(resolveImageTarget("readeck", "b1", "https://cdn.x/a.jpg", null)).toEqual({
      kind: "remote",
      url: "https://cdn.x/a.jpg",
      referer: null,
    });
  });

  it("blocks remote refs that resolve to private/loopback hosts", () => {
    expect(resolveImageTarget("readeck", "b1", "http://127.0.0.1/a.jpg", null)).toBeNull();
    expect(
      resolveImageTarget("miniflux", "42", "https://192.168.1.5/a.jpg", "https://b.x/p"),
    ).toBeNull();
  });

  it("resolves RSS relative refs against the original article URL", () => {
    expect(resolveImageTarget("miniflux", "42", "/img/p.jpg", "https://blog.x/2024/post")).toEqual({
      kind: "remote",
      url: "https://blog.x/img/p.jpg",
      referer: "https://blog.x/2024/post",
    });
    expect(resolveImageTarget("miniflux", "42", "pic.jpg", "https://blog.x/2024/post")).toEqual({
      kind: "remote",
      url: "https://blog.x/2024/pic.jpg",
      referer: "https://blog.x/2024/post",
    });
  });

  it("can't resolve an RSS relative ref without the article URL", () => {
    expect(resolveImageTarget("miniflux", "42", "pic.jpg", null)).toBeNull();
  });

  it("rejects data: and non-http schemes", () => {
    expect(
      resolveImageTarget("miniflux", "42", "data:image/png;base64,AA", "https://b.x/p"),
    ).toBeNull();
    expect(resolveImageTarget("miniflux", "42", "ftp://b.x/a", "https://b.x/p")).toBeNull();
  });
});

describe("isBlockedHost", () => {
  it("blocks loopback, private, link-local, and *.local hosts", () => {
    for (const h of [
      "localhost",
      "foo.local",
      "127.0.0.1",
      "10.0.0.1",
      "192.168.0.1",
      "172.16.0.1",
      "169.254.169.254",
      "::1",
      "fe80::1",
      "fc00::1",
    ]) {
      expect(isBlockedHost(h)).toBe(true);
    }
  });

  it("allows public hosts", () => {
    for (const h of ["example.com", "8.8.8.8", "1.2.3.4", "172.32.0.1", "cdn.example.org"]) {
      expect(isBlockedHost(h)).toBe(false);
    }
  });
});
