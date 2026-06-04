import { describe, expect, it } from "vitest";
import { htmlToText, stripUrls } from "./html-text";

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
