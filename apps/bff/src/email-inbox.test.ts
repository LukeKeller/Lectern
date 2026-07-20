import { EventEmitter } from "node:events";
import { checkServerIdentity } from "node:tls";
import { describe, expect, it } from "vitest";
import type { ImapFlowOptions } from "imapflow";
import {
  EMAIL_DOMAIN_LABEL_PREFIX,
  EMAIL_LABEL,
  EmailInbox,
  IMAP_CONNECTION_TIMEOUT_MS,
  IMAP_GREETING_TIMEOUT_MS,
  IMAP_SOCKET_TIMEOUT_MS,
  buildImapOptions,
  buildReadeckHtml,
  imapTlsOptions,
  formatEmailCursor,
  fromParsedMail,
  isExcludedSender,
  messageToSaveInput,
  newsletterContentHtml,
  newsletterUrl,
  parseEmailCursor,
  parseExcludedSenders,
  sanitizeEmailHtml,
  senderDomain,
  type EmailInboxOptions,
  type ImapClientLike,
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

describe("newsletterContentHtml", () => {
  it("keeps the sender's original image URLs (unwrapped body, no doc shell)", () => {
    const html = newsletterContentHtml(baseMsg);
    expect(html).toContain("https://x/y.png"); // real image URL preserved for the proxy
    expect(html).toContain("Hi there");
    expect(html).not.toMatch(/<\/?(html|head|body|title)\b/i); // unwrapped body only
    expect(html).not.toContain("marketing junk"); // the <title> is dropped with the head
  });

  it("still strips dangerous markup", () => {
    const msg = { ...baseMsg, html: "<body><script>evil()</script><p>ok</p></body>" };
    const html = newsletterContentHtml(msg);
    expect(html).not.toContain("<script");
    expect(html).toContain("ok");
  });

  it("strips NUL and C0 control bytes that break the Postgres text insert", () => {
    const msg = { ...baseMsg, html: "<body><p>a\u0000b\u0007c</p></body>" };
    const html = newsletterContentHtml(msg);
    expect(html).not.toMatch(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/);
    expect(html).toContain("abc");
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

describe("senderDomain", () => {
  it("returns the lowercased domain after the last @", () => {
    expect(senderDomain("Hello@404Media.co")).toBe("404media.co");
    expect(senderDomain("a@b@dailybyte.com")).toBe("dailybyte.com");
  });

  it("returns null when there is no domain part", () => {
    expect(senderDomain("")).toBeNull();
    expect(senderDomain("nobody")).toBeNull();
    expect(senderDomain("trailing@")).toBeNull();
  });
});

describe("messageToSaveInput", () => {
  it("tags with the sentinel label plus the sender and domain", () => {
    const input = messageToSaveInput(baseMsg);
    expect(input.labels).toContain(EMAIL_LABEL);
    expect(input.labels).toContain("The Daily Byte");
    expect(input.labels).toContain(EMAIL_DOMAIN_LABEL_PREFIX + "dailybyte.com");
    expect(input.url).toBe(newsletterUrl(baseMsg.messageId));
    expect(input.html).toMatch(/<title>Weekly Roundup<\/title>/);
  });

  it("omits the domain label when the address has no domain", () => {
    const input = messageToSaveInput({ ...baseMsg, fromAddress: "nobody" });
    expect(input.labels.some((l) => l.startsWith(EMAIL_DOMAIN_LABEL_PREFIX))).toBe(false);
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

  it("recovers the sender domain from its label and hides it from tags", () => {
    const card = readeckBookmarkToCard({
      ...bookmark,
      labels: [EMAIL_LABEL, "Joseph Cox", EMAIL_DOMAIN_LABEL_PREFIX + "404media.co"],
    });
    expect(card.senderDomain).toBe("404media.co");
    expect(card.tags).toEqual(["Joseph Cox"]);
    expect(card.tags.some((t) => t.startsWith(EMAIL_DOMAIN_LABEL_PREFIX))).toBe(false);
  });

  it("leaves ordinary bookmarks as articles with no sender domain", () => {
    const card = readeckBookmarkToCard({ ...bookmark, labels: ["tech"] });
    expect(card.category).toBe("article");
    expect(card.tags).toEqual(["tech"]);
    expect(card.senderDomain).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// TLS identity + connection options (BUG A)
// ---------------------------------------------------------------------------

const connOpts = {
  host: "127.0.0.1",
  port: 1143,
  user: "bridge",
  password: "secret",
  mailbox: "INBOX",
};

/**
 * The Proton Bridge certificate shape from the production incident: self-signed,
 * `CN=127.0.0.1`, with an IP SAN and NO DNS SAN. The missing DNS SAN is why
 * Node falls through to matching the CN, which is what the crash reported.
 */
const bridgeCert = {
  subject: { CN: "127.0.0.1" },
  subjectaltname: "IP Address:127.0.0.1",
} as unknown as Parameters<typeof checkServerIdentity>[1];

describe("imapTlsOptions (verify against the configured host, never against a guess)", () => {
  it("overrides the identity check for an IP literal host", () => {
    const tls = imapTlsOptions("127.0.0.1");
    expect(typeof tls?.checkServerIdentity).toBe("function");
  });

  it("leaves a DNS host on Node's default check", () => {
    // For a DNS host imapflow sets `servername`, so Node already verifies
    // against exactly the configured name on both paths. Overriding would be a
    // no-op that opts out of future Node improvements.
    expect(imapTlsOptions("imap.example.com")).toBeUndefined();
    expect(imapTlsOptions("localhost")).toBeUndefined();
  });

  it("handles IPv6 literals too", () => {
    expect(typeof imapTlsOptions("::1")?.checkServerIdentity).toBe("function");
  });

  it("accepts a cert whose IP SAN matches the configured host", () => {
    const tls = imapTlsOptions("127.0.0.1");
    // The hostname Node derived is the WRONG one ("localhost", per the crash);
    // the override must ignore it and use the configured host instead.
    expect(tls?.checkServerIdentity?.("localhost", bridgeCert)).toBeUndefined();
  });

  it("still REJECTS a cert that does not match the configured host", () => {
    // Verification stays on. This is the assertion that would fail if anyone
    // "fixed" this with rejectUnauthorized:false.
    const tls = imapTlsOptions("10.1.2.3");
    const err = tls?.checkServerIdentity?.("localhost", bridgeCert);
    expect(err).toBeInstanceOf(Error);
    expect(err?.message).toContain("10.1.2.3");
  });
});

describe("buildImapOptions (what is actually handed to the IMAP client)", () => {
  it("carries the identity override for an IP host on the implicit-TLS path", () => {
    const opts = buildImapOptions({ ...connOpts, port: 993, secure: true });
    expect(opts.secure).toBe(true);
    expect(typeof opts.tls?.checkServerIdentity).toBe("function");
    expect(opts.tls?.checkServerIdentity?.("localhost", bridgeCert)).toBeUndefined();
  });

  it("carries the identity override for an IP host on the STARTTLS path", () => {
    // The production failure was here: imapflow's STARTTLS upgrade options carry
    // no `host`, so Node verified against the literal string "localhost".
    const opts = buildImapOptions({ ...connOpts, secure: false });
    expect(opts.secure).toBe(false);
    expect(typeof opts.tls?.checkServerIdentity).toBe("function");
    expect(opts.tls?.checkServerIdentity?.("localhost", bridgeCert)).toBeUndefined();
  });

  it("adds no TLS options at all for a DNS host, on either path", () => {
    const host = "imap.example.com";
    expect(buildImapOptions({ ...connOpts, host, port: 993, secure: true }).tls).toBeUndefined();
    expect(buildImapOptions({ ...connOpts, host, secure: false }).tls).toBeUndefined();
  });

  it("defaults to implicit TLS when `secure` is unset", () => {
    expect(buildImapOptions(connOpts).secure).toBe(true);
  });

  it("never disables certificate verification", () => {
    for (const host of ["127.0.0.1", "imap.example.com"]) {
      for (const secure of [true, false]) {
        const opts = buildImapOptions({ ...connOpts, host, secure });
        expect(opts.tls?.rejectUnauthorized).toBeUndefined();
      }
    }
  });

  it("bounds every stage of the connection with a timeout", () => {
    // `fetchNew` previously had no timeout of its own: a stalled server held the
    // job (and its advisory lock) open until pg-boss's four-hour expiry.
    const opts = buildImapOptions(connOpts);
    expect(opts.connectionTimeout).toBe(IMAP_CONNECTION_TIMEOUT_MS);
    expect(opts.greetingTimeout).toBe(IMAP_GREETING_TIMEOUT_MS);
    expect(opts.socketTimeout).toBe(IMAP_SOCKET_TIMEOUT_MS);
    for (const ms of [opts.connectionTimeout, opts.greetingTimeout, opts.socketTimeout]) {
      expect(ms).toBeGreaterThan(0);
      // Comfortably inside the 5-minute poll cadence for the connect stages.
      expect(ms).toBeLessThanOrEqual(IMAP_SOCKET_TIMEOUT_MS);
    }
  });

  it("passes the mailbox credentials and silences the client logger", () => {
    const opts = buildImapOptions(connOpts);
    expect(opts.host).toBe("127.0.0.1");
    expect(opts.port).toBe(1143);
    expect(opts.auth).toEqual({ user: "bridge", pass: "secret" });
    expect(opts.logger).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// EmailInbox.fetchNew failure isolation (BUG B)
// ---------------------------------------------------------------------------

/**
 * A scriptable stand-in for `ImapFlow`. It is a real `EventEmitter`, which is
 * the whole point: emitting `'error'` with no listener THROWS, so these tests
 * exercise the actual crash mechanism rather than a mock of it.
 */
class FakeImapClient extends EventEmitter implements ImapClientLike {
  mailbox: { uidValidity: bigint; uidNext: number; exists: number } | false = {
    uidValidity: 42n,
    uidNext: 11,
    exists: 3,
  };
  /** Listeners present at the moment `connect()` ran — 0 means the crash route is open. */
  errorListenersAtConnect = -1;
  logoutCalls = 0;
  closeCalls = 0;
  released = 0;
  onConnect: (() => void) | null = null;

  async connect(): Promise<void> {
    this.errorListenersAtConnect = this.listenerCount("error");
    this.onConnect?.();
  }
  async getMailboxLock(): Promise<{ release: () => void }> {
    return {
      release: () => {
        this.released++;
      },
    };
  }
  async search(): Promise<number[] | false> {
    return [10];
  }
  async *fetch(): AsyncIterableIterator<{ uid: number; source?: Buffer | false }> {
    // No new mail above the cursor; the cursor path is covered elsewhere.
  }
  async logout(): Promise<void> {
    this.logoutCalls++;
  }
  close(): void {
    this.closeCalls++;
  }
}

function inboxWith(client: FakeImapClient, overrides: Partial<EmailInboxOptions> = {}) {
  return new EmailInbox({ ...connOpts, ...overrides }, () => client);
}

describe("EmailInbox.fetchNew (an IMAP fault must never reach the process)", () => {
  it("attaches an 'error' listener BEFORE anything can fail", async () => {
    const client = new FakeImapClient();
    await inboxWith(client).fetchNew({ uidValidity: "42", lastUid: 10 });
    // This is the assertion that stands between a mail-server hiccup and a
    // restart-looping BFF.
    expect(client.errorListenersAtConnect).toBeGreaterThan(0);
  });

  it("absorbs an 'error' emitted during connect instead of letting it throw", async () => {
    const client = new FakeImapClient();
    const tlsError = Object.assign(new Error("Hostname/IP does not match certificate's altnames"), {
      code: "ERR_TLS_CERT_ALTNAME_INVALID",
    });
    client.onConnect = () => {
      // Exactly what imapflow's `emitError` does (imap-flow.js:409). With no
      // listener this call itself throws, out of every promise chain.
      client.emit("error", tlsError);
      throw new Error("Unexpected close");
    };

    // It still fails the poll — but as a rejected promise a caller can handle,
    // and reporting the REAL cause rather than the generic "Unexpected close".
    await expect(inboxWith(client).fetchNew(null)).rejects.toThrow(
      "Hostname/IP does not match certificate's altnames",
    );
  });

  it("absorbs a late 'error' emitted after the fetch has finished", async () => {
    const client = new FakeImapClient();
    await inboxWith(client).fetchNew({ uidValidity: "42", lastUid: 10 });
    // A socket reset arriving during teardown used to be enough to kill the app.
    expect(() => client.emit("error", new Error("ECONNRESET"))).not.toThrow();
  });

  it("logs out and releases the mailbox lock on the happy path", async () => {
    const client = new FakeImapClient();
    await inboxWith(client).fetchNew({ uidValidity: "42", lastUid: 10 });
    expect(client.logoutCalls).toBe(1);
    expect(client.released).toBe(1);
  });

  it("hard-closes the socket when the connection never came up", async () => {
    const client = new FakeImapClient();
    client.onConnect = () => {
      throw Object.assign(new Error("Failed to establish connection in required time"), {
        code: "CONNECT_TIMEOUT",
      });
    };

    await expect(inboxWith(client).fetchNew(null)).rejects.toThrow(
      "Failed to establish connection in required time",
    );
    // LOGOUT speaks IMAP; there is no session to speak it on.
    expect(client.logoutCalls).toBe(0);
    expect(client.closeCalls).toBe(1);
  });

  it("does not let a failing teardown mask the real error", async () => {
    const client = new FakeImapClient();
    client.logout = async () => {
      throw new Error("logout exploded");
    };
    client.onConnect = () => {
      throw new Error("the real problem");
    };

    await expect(inboxWith(client).fetchNew(null)).rejects.toThrow("the real problem");
  });

  it("hands the client the options built by buildImapOptions", async () => {
    let seen: ImapFlowOptions | null = null;
    const client = new FakeImapClient();
    const inbox = new EmailInbox({ ...connOpts, secure: false }, (o) => {
      seen = o;
      return client;
    });

    await inbox.fetchNew({ uidValidity: "42", lastUid: 10 });

    // Compared field-by-field: `tls.checkServerIdentity` is a fresh closure per
    // call, so a deep equality would compare two functions by reference.
    const expected = buildImapOptions({ ...connOpts, secure: false });
    expect(seen).not.toBeNull();
    const { tls: seenTls, ...seenRest } = seen!;
    const { tls: expectedTls, ...expectedRest } = expected;
    expect(seenRest).toEqual(expectedRest);
    expect(typeof seenTls?.checkServerIdentity).toBe(typeof expectedTls?.checkServerIdentity);
    expect(seen!.socketTimeout).toBe(IMAP_SOCKET_TIMEOUT_MS);
  });
});
