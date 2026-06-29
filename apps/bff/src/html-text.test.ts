import { describe, expect, it } from "vitest";
import { hasReadableText, htmlToText, richerHtml, stripFeedChrome, stripUrls } from "./html-text";

describe("htmlToText", () => {
  it("strips tags and keeps paragraph breaks between blocks", () => {
    const out = htmlToText("<h2>Title</h2><p>First para.</p><p>Second para.</p>");
    expect(out).toBe("Title\n\nFirst para.\n\nSecond para.");
  });

  it("drops script/style content entirely", () => {
    const out = htmlToText("<p>Keep</p><script>var x = 1 < 2;</script><style>.a{}</style>");
    expect(out).toBe("Keep");
  });

  it("decodes named and numeric entities", () => {
    expect(htmlToText("<p>Tom &amp; Jerry &#8212; &#x2026;</p>")).toBe("Tom & Jerry — …");
  });

  it("collapses whitespace and blank runs", () => {
    expect(htmlToText("<p>a\t  b</p>\n\n\n<p>c</p>")).toBe("a b\n\nc");
  });
});

describe("stripUrls", () => {
  it("removes http(s) and www URLs the voice would read aloud", () => {
    expect(stripUrls("See https://example.com/a?b=1 for more")).toBe("See for more");
    expect(stripUrls("Visit www.example.com today")).toBe("Visit today");
  });

  it("tidies leftover empty brackets and spacing", () => {
    expect(stripUrls("Read more (https://example.com) now")).toBe("Read more now");
  });

  it("leaves URL-free text untouched", () => {
    expect(stripUrls("Just plain prose.")).toBe("Just plain prose.");
  });
});

describe("hasReadableText", () => {
  it("is false for empty markup and true for real text", () => {
    expect(hasReadableText("<p></p><p></p>")).toBe(false);
    expect(hasReadableText("   \n  ")).toBe(false);
    expect(hasReadableText("<p>hello</p>")).toBe(true);
  });
});

describe("richerHtml", () => {
  it("keeps the feed body when the scrape is empty markup (e.g. Bluesky)", () => {
    const feed = "<p>The full post text lives in the RSS item.</p>";
    expect(richerHtml(feed, "<p></p><p></p>")).toBe(feed);
  });

  it("prefers the scrape when it has more text than an excerpt feed body", () => {
    const excerpt = "<p>Short teaser…</p>";
    const full = "<p>The complete article body with much more text than the teaser.</p>";
    expect(richerHtml(excerpt, full)).toBe(full);
  });

  it("keeps the feed body on a tie", () => {
    expect(richerHtml("<p>same</p>", "<div>same</div>")).toBe("<p>same</p>");
  });

  it("keeps an image-only feed body over a chrome-heavy scrape (e.g. xkcd)", () => {
    const comic = '<img src="https://imgs.xkcd.com/comics/messi.png" alt="Messi" title="alt" />';
    // The scraped xkcd page: lots of text, but almost all of it is nav links.
    const chrome = `
      <ul>
        <li><a href="/archive">Archive</a></li>
        <li><a href="/about">About</a></li>
        <li><a href="/prev">&lt; Prev</a></li>
        <li><a href="/random">Random</a></li>
        <li><a href="/next">Next &gt;</a></li>
      </ul>
      <p>A webcomic of romance, sarcasm, math, and language.</p>
      ${comic}
      <p>Permanent link to this comic: <a href="https://xkcd.com/3260/">https://xkcd.com/3260/</a></p>
      <p>Comics I enjoy: <a href="#">SMBC</a>, <a href="#">Dinosaur Comics</a></p>`;
    expect(richerHtml(comic, chrome)).toBe(comic);
  });

  it("still prefers a scrape that is a real article wrapped around an image", () => {
    const lead = '<img src="hero.jpg" alt="" />';
    const article = `${lead}${"<p>Substantial article prose that goes on at length. </p>".repeat(20)}`;
    expect(richerHtml(lead, article)).toBe(article);
  });
});

describe("stripFeedChrome", () => {
  // Mirrors the real scrape shape: a leading empty <p>, the "Newswire" heading,
  // a list of ~headline links, an <hr/>, then the actual article.
  const onion =
    '<p></p><h3 id="h-newswire">Newswire</h3>' +
    "<ul>" +
    '<li><a href="https://theonion.com/a/"> </a><h3>Switzerland Finally Snaps</h3></li>' +
    '<li><a href="https://theonion.com/b/"> </a><h3>Sector Five Breached</h3></li>' +
    "</ul>" +
    "<hr/>" +
    "<p></p><h1>Emma Stone Finally Quits Waiting Tables</h1><p>The real story.</p>";

  it("removes The Onion's Newswire block so the article leads", () => {
    const out = stripFeedChrome(onion, "https://theonion.com/emma-stone/");
    expect(out).toBe("<h1>Emma Stone Finally Quits Waiting Tables</h1><p>The real story.</p>");
    expect(out).not.toContain("Newswire");
    expect(out).not.toContain("Switzerland Finally Snaps");
  });

  it("leaves content from other domains untouched", () => {
    const out = stripFeedChrome(onion, "https://example.com/post/");
    expect(out).toBe(onion);
  });

  it("is a no-op when there is no Newswire block", () => {
    const clean = "<h1>Title</h1><p>Body.</p>";
    expect(stripFeedChrome(clean, "https://theonion.com/x/")).toBe(clean);
  });

  it("returns the html unchanged when the url is unparseable", () => {
    expect(stripFeedChrome(onion, "")).toBe(onion);
  });
});
