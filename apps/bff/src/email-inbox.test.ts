import { describe, expect, it } from "vitest";
import {
  EMAIL_LABEL,
  buildReadeckHtml,
  formatEmailCursor,
  fromParsedMail,
  isExcludedSender,
  messageToSaveInput,
  newsletterUrl,
  parseEmailCursor,
  parseExcludedSenders,
  sanitizeEmailHtml,
  type ParsedNewsletter,
} from "./backends/email-inbox";
import { readeckBookmarkToCard, type ReadeckBookmark } from "./backends/readeck";

const baseMsg: ParsedNewsletter = {
  uid: 42,
  messageId: "<abc123@mail.example.com>",
  subject: "Weekly Roundup",
  fromName: "The Daily Byte",
  fromAddress: "hello@dailybyte.com",
  html: "<html><head><title>marketing junk</title></head><body><p>Hi there</p><img src='https://x/y.png'></body></html>",
};

describe("parseExcludedSenders", () => {
  it("splits, trims, lowercases and drops blanks", () => {
    const set = parseExcludedSenders(" Diagnosis@DigitallyAdrift.com , noreply@x.com ,, ");
    expect(set).toEqual(new Set(["diagnosis@digitallyadrift.com", "noreply@x.com"]));
  });

  it("returns an empty set for empty/undefined input", () => {
    expect(parseExcludedSenders("")).toEqual(new Set());
    expect(parseExcludedSenders(undefined)).toEqual(new Set());
  });
});

describe("isExcludedSender", () => {
  const excluded = parseExcludedSenders("diagnosis@digitallyadrift.com");

  it("matches the excluded address case-insensitively", () => {
    expect(
      isExcludedSender({ ...baseMsg, fromAddress: "Diagnosis@DigitallyAdrift.com" }, excluded),
    ).toBe(true);
  });

  it("lets other senders through", () => {
    expect(isExcludedSender({ ...baseMsg, fromAddress: "hello@dailybyte.com" }, excluded)).toBe(
      false,
    );
  });

  it("never excludes a message with no From address", () => {
    expect(isExcludedSender({ ...baseMsg, fromAddress: "" }, excluded)).toBe(false);
    expect(isExcludedSender(baseMsg, parseExcludedSenders(""))).toBe(false);
  });
});

describe("sanitizeEmailHtml", () => {
  it("strips scripts and inline handlers but keeps images", () => {
    const dirty =
      '<p onclick="steal()">hi</p><script>evil()</script><img src="https://x/pixel.png">';
    const clean = sanitizeEmailHtml(dirty);
    expect(clean).not.toMatch(/<script/i);
    expect(clean).not.toMatch(/onclick/i);
    expect(clean).toMatch(/<img/i);
  });

  it("neutralizes javascript: URLs", () => {
    expect(sanitizeEmailHtml('<a href="javascript:alert(1)">x</a>')).toMatch(/href="#"/);
  });

  it("returns empty string for empty input", () => {
    expect(sanitizeEmailHtml("")).toBe("");
  });
});

describe("buildReadeckHtml", () => {
  it("sets the subject as <title> and sender as author", () => {
    const html = buildReadeckHtml(baseMsg);
    expect(html).toMatch(/<title>Weekly Roundup<\/title>/);
    expect(html).toMatch(/<meta name="author" content="The Daily Byte">/);
  });

  it("unwraps a full document so the original <title> can't win", () => {
    const html = buildReadeckHtml(baseMsg);
    // The newsletter's own marketing <title> is dropped; only the subject remains.
    expect(html).not.toMatch(/marketing junk/);
    expect(html).toMatch(/Hi there/);
    expect(html).toMatch(/<img/);
  });

  it("escapes HTML-significant characters in the subject", () => {
    const html = buildReadeckHtml({ ...baseMsg, subject: 'A <b> & "Q"' });
    expect(html).toMatch(/<title>A &lt;b&gt; &amp; &quot;Q&quot;<\/title>/);
  });
});

describe("newsletterUrl", () => {
  it("strips angle brackets and is stable for a Message-ID", () => {
    const url = newsletterUrl("<abc123@mail.example.com>");
    expect(url).toBe(newsletterUrl("abc123@mail.example.com"));
    expect(url).toContain("abc123%40mail.example.com");
  });
});

describe("messageToSaveInput", () => {
  it("tags with the sentinel label plus the sender", () => {
    const input = messageToSaveInput(baseMsg);
    expect(input.labels).toContain(EMAIL_LABEL);
    expect(input.labels).toContain("The Daily Byte");
    expect(input.url).toBe(newsletterUrl(baseMsg.messageId));
    expect(input.html).toMatch(/<title>Weekly Roundup<\/title>/);
  });
});

describe("fromParsedMail", () => {
  it("falls back to a deterministic Message-ID and wraps text-only mail", () => {
    const msg = fromParsedMail(
      // Minimal mailparser-shaped object; html is false for text-only mail.
      { subject: "", html: false, text: "plain body", from: undefined, date: undefined } as never,
      7,
      "INBOX",
    );
    expect(msg.messageId).toBe("<uid-7@INBOX>");
    expect(msg.subject).toBe("(no subject)");
    expect(msg.fromName).toBe("Newsletter");
    expect(msg.html).toMatch(/<pre>plain body<\/pre>/);
  });
});

describe("email cursor", () => {
  it("round-trips", () => {
    expect(parseEmailCursor(formatEmailCursor({ uidValidity: "99", lastUid: 12 }))).toEqual({
      uidValidity: "99",
      lastUid: 12,
    });
  });

  it("rejects malformed cursors", () => {
    expect(parseEmailCursor(undefined)).toBeNull();
    expect(parseEmailCursor("nope")).toBeNull();
    expect(parseEmailCursor("99:notanumber")).toBeNull();
  });
});

describe("readeckBookmarkToCard email mapping", () => {
  const bookmark = {
    id: "b1",
    url: "https://newsletter.lectern.local/abc",
    title: "Weekly Roundup",
    site_name: null,
    authors: ["The Daily Byte"],
    created: "2026-06-01T00:00:00Z",
    updated: "2026-06-01T00:00:00Z",
    state: 0,
    loaded: true,
    has_article: true,
    is_archived: false,
    is_marked: false,
    read_progress: 0,
    word_count: 100,
    reading_time: 1,
  } satisfies Partial<ReadeckBookmark> as ReadeckBookmark;

  it("maps the sentinel label to the email category and hides it from tags", () => {
    const card = readeckBookmarkToCard({ ...bookmark, labels: [EMAIL_LABEL, "The Daily Byte"] });
    expect(card.category).toBe("email");
    expect(card.tags).toEqual(["The Daily Byte"]);
    expect(card.tags).not.toContain(EMAIL_LABEL);
  });

  it("leaves ordinary bookmarks as articles", () => {
    const card = readeckBookmarkToCard({ ...bookmark, labels: ["tech"] });
    expect(card.category).toBe("article");
    expect(card.tags).toEqual(["tech"]);
  });
});
