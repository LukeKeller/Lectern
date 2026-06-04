import { describe, expect, it } from "vitest";
import { htmlToText } from "./html-text";

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
