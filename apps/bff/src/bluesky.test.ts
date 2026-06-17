import { describe, expect, it, vi } from "vitest";
import {
  type BskyPostView,
  enrichBlueskyContent,
  parseBlueskyPostUrl,
  renderBlueskyPost,
} from "./bluesky";

describe("parseBlueskyPostUrl", () => {
  it("parses a handle-based post url", () => {
    expect(parseBlueskyPostUrl("https://bsky.app/profile/bumas.bsky.social/post/3moe3yoasqc2z")).toEqual(
      { repo: "bumas.bsky.social", rkey: "3moe3yoasqc2z" },
    );
  });

  it("parses a did-based post url", () => {
    expect(parseBlueskyPostUrl("https://bsky.app/profile/did:plc:abc123/post/3xyz")).toEqual({
      repo: "did:plc:abc123",
      rkey: "3xyz",
    });
  });

  it("returns null for non-bluesky urls", () => {
    expect(parseBlueskyPostUrl("https://example.com/profile/x/post/y")).toBeNull();
    expect(parseBlueskyPostUrl("https://bsky.app/profile/x")).toBeNull();
  });
});

describe("renderBlueskyPost", () => {
  it("renders plain text as escaped paragraphs", () => {
    const post: BskyPostView = { record: { text: "Tom & Jerry <3\n\nSecond para" } };
    const html = renderBlueskyPost(post);
    expect(html).toContain("<p>Tom &amp; Jerry &lt;3</p>");
    expect(html).toContain("<p>Second para</p>");
    expect(html).not.toContain("<3");
  });

  it("converts single newlines to <br> within a paragraph", () => {
    const html = renderBlueskyPost({ record: { text: "line one\nline two" } });
    expect(html).toBe("<p>line one<br/>line two</p>");
  });

  it("renders an images embed with fullsize url and alt", () => {
    const post: BskyPostView = {
      record: { text: "look" },
      embed: {
        $type: "app.bsky.embed.images#view",
        images: [{ fullsize: "https://cdn.bsky.app/img/full.jpg", alt: "a cat & dog" }],
      },
    };
    const html = renderBlueskyPost(post);
    expect(html).toContain('<img src="https://cdn.bsky.app/img/full.jpg"');
    expect(html).toContain('alt="a cat &amp; dog"');
    expect(html).toContain("<figcaption>a cat &amp; dog</figcaption>");
  });

  it("renders an external embed as a link card", () => {
    const post: BskyPostView = {
      embed: {
        $type: "app.bsky.embed.external#view",
        external: {
          uri: "https://example.com/article",
          title: "A Title",
          description: "A description",
        },
      },
    };
    const html = renderBlueskyPost(post);
    expect(html).toContain('<a href="https://example.com/article">A Title</a>');
    expect(html).toContain("A description");
  });

  it("renders a record (quote) embed as a blockquote with author and text", () => {
    const post: BskyPostView = {
      record: { text: "quoting this" },
      embed: {
        $type: "app.bsky.embed.record#view",
        record: {
          $type: "app.bsky.embed.record#viewRecord",
          author: { handle: "alice.bsky.social", displayName: "Alice" },
          value: { text: "the original post" },
        },
      },
    };
    const html = renderBlueskyPost(post);
    expect(html).toContain("<blockquote>");
    expect(html).toContain("@alice.bsky.social");
    expect(html).toContain("the original post");
  });

  it("renders recordWithMedia with both image and quote", () => {
    const post: BskyPostView = {
      record: { text: "media + quote" },
      embed: {
        $type: "app.bsky.embed.recordWithMedia#view",
        media: {
          $type: "app.bsky.embed.images#view",
          images: [{ fullsize: "https://cdn.bsky.app/img/m.jpg", alt: "media img" }],
        },
        record: {
          record: {
            $type: "app.bsky.embed.record#viewRecord",
            author: { handle: "bob.bsky.social", displayName: "Bob" },
            value: { text: "quoted via recordWithMedia" },
          },
        },
      },
    };
    const html = renderBlueskyPost(post);
    expect(html).toContain('<img src="https://cdn.bsky.app/img/m.jpg"');
    expect(html).toContain("<blockquote>");
    expect(html).toContain("@bob.bsky.social");
    expect(html).toContain("quoted via recordWithMedia");
  });

  it("ignores unknown embed types and missing fields without throwing", () => {
    expect(renderBlueskyPost({ record: { text: "hi" }, embed: { $type: "app.bsky.embed.weird" } })).toBe(
      "<p>hi</p>",
    );
    expect(renderBlueskyPost({})).toBe("");
  });
});

describe("enrichBlueskyContent", () => {
  const thread = {
    thread: {
      post: {
        record: { text: "enriched post" },
        embed: {
          $type: "app.bsky.embed.images#view",
          images: [{ fullsize: "https://cdn.bsky.app/img/e.jpg", alt: "" }],
        },
      },
    },
  };

  it("returns enriched HTML from an injected fetch stub", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify(thread), { status: 200 }),
    ) as unknown as typeof fetch;
    const html = await enrichBlueskyContent(
      "https://bsky.app/profile/alice.bsky.social/post/aaa111",
      "FALLBACK",
      fetchImpl,
    );
    expect(html).toContain("enriched post");
    expect(html).toContain('<img src="https://cdn.bsky.app/img/e.jpg"');
  });

  it("returns the fallback when the fetch throws", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    const html = await enrichBlueskyContent(
      "https://bsky.app/profile/alice.bsky.social/post/throws1",
      "FALLBACK",
      fetchImpl,
    );
    expect(html).toBe("FALLBACK");
  });

  it("returns the fallback on a non-ok response", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 502 })) as unknown as typeof fetch;
    const html = await enrichBlueskyContent(
      "https://bsky.app/profile/alice.bsky.social/post/notok1",
      "FALLBACK",
      fetchImpl,
    );
    expect(html).toBe("FALLBACK");
  });

  it("returns the fallback for a non-bluesky url without calling fetch", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;
    const html = await enrichBlueskyContent("https://example.com/post/1", "FALLBACK", fetchImpl);
    expect(html).toBe("FALLBACK");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
