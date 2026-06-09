import { ImapFlow } from "imapflow";
import { simpleParser, type ParsedMail } from "mailparser";

/**
 * Newsletter ingestion source. Reads a dedicated IMAP mailbox (one address the
 * user subscribes newsletters to and nothing else reads), parses each message's
 * MIME into HTML, and turns it into a Readeck save payload tagged with a sentinel
 * label so the unifier renders it as an `email`-category card. Idempotent on two
 * axes: a UID cursor avoids re-fetching, and a stable Message-ID-derived URL lets
 * Readeck dedupe if the same message is ever re-processed (e.g. UIDVALIDITY reset).
 *
 * The pure transforms (sanitize/build/map/cursor) are exported and unit-tested
 * without a live IMAP server; only `EmailInbox.fetchNew` touches the network.
 */

/** Reserved Readeck label that marks a bookmark as an ingested newsletter. */
export const EMAIL_LABEL = "lectern:email";

/** Synthetic, stable base for newsletter "URLs" (emails have no canonical URL). */
const NEWSLETTER_URL_BASE = "https://newsletter.lectern.local/";

/** A parsed newsletter, decoupled from mailparser so the mappers are testable. */
export interface ParsedNewsletter {
  uid: number;
  messageId: string;
  subject: string;
  fromName: string;
  fromAddress: string;
  /** Raw HTML body (or a <pre>-wrapped text fallback for text-only mail). */
  html: string;
  /** Original send date, ISO 8601, when the message carried one. */
  date?: string;
}

export interface EmailInboxOptions {
  host: string;
  port: number;
  user: string;
  password: string;
  mailbox: string;
  /** TLS on connect (993). Set false for plain/STARTTLS on 143. */
  secure?: boolean;
}

/** Per-mailbox sync position: UID high-water mark, scoped to a UIDVALIDITY. */
export interface EmailCursor {
  uidValidity: string;
  lastUid: number;
}

export function parseEmailCursor(value: string | undefined): EmailCursor | null {
  if (!value) return null;
  const sep = value.indexOf(":");
  if (sep < 0) return null;
  const uidValidity = value.slice(0, sep);
  const lastUid = Number.parseInt(value.slice(sep + 1), 10);
  if (!uidValidity || !Number.isFinite(lastUid)) return null;
  return { uidValidity, lastUid };
}

export function formatEmailCursor(cursor: EmailCursor): string {
  return `${cursor.uidValidity}:${cursor.lastUid}`;
}

/**
 * Parse the comma-separated `IMAP_EXCLUDE_SENDERS` list into a set of lowercased
 * addresses. Lets the user drop internal/system mail (e.g. server diagnostics)
 * that lands in the shared newsletter mailbox before it becomes a reading card.
 */
export function parseExcludedSenders(value: string | undefined): Set<string> {
  return new Set(
    (value ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

/**
 * True when a message's From is on the exclude list (case-insensitive). Matches
 * either the address OR the display name, so an entry added from the UI (which
 * shows the sender's name) and one set via the env address list both work.
 */
export function isExcludedSender(msg: ParsedNewsletter, excluded: ReadonlySet<string>): boolean {
  const addr = msg.fromAddress.trim().toLowerCase();
  const name = msg.fromName.trim().toLowerCase();
  return (addr !== "" && excluded.has(addr)) || (name !== "" && excluded.has(name));
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Strip the actively dangerous parts of newsletter HTML (scripts, embedded
 * frames, inline event handlers, javascript: URLs) while KEEPING images — Readeck
 * runs the HTML through its own sanitizer on save, so this is defense-in-depth,
 * not the only line. No DOM: regex, matching the house style in html-text.ts.
 */
export function sanitizeEmailHtml(html: string): string {
  if (!html) return "";
  let s = html;
  // Drop element + content for executable/structural tags.
  s = s.replace(/<(script|style|noscript|iframe|object|embed|form)\b[\s\S]*?<\/\1>/gi, " ");
  // Drop any stray opening tags (unclosed, self-closing, or head-only singletons).
  s = s.replace(/<(script|style|noscript|iframe|object|embed|form|link|meta|base)\b[^>]*>/gi, " ");
  // Strip inline event handlers (on*="...").
  s = s.replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  // Neutralize javascript: in href/src.
  s = s.replace(/\b(href|src)\s*=\s*("javascript:[^"]*"|'javascript:[^']*')/gi, '$1="#"');
  return s;
}

/** Inner body content, unwrapped from any full <html>/<head>/<body> document. */
function extractBody(html: string): string {
  let s = html.replace(/<!doctype[^>]*>/gi, "");
  const body = s.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (body) return body[1] ?? "";
  s = s.replace(/<head\b[\s\S]*?<\/head>/gi, "");
  s = s.replace(/<\/?html[^>]*>/gi, "");
  return s;
}

/**
 * Wrap a newsletter in a minimal document whose <title> is the subject and whose
 * author meta is the sender, so Readeck's readability extraction produces a clean
 * card title/byline instead of guessing from marketing boilerplate.
 */
export function buildReadeckHtml(msg: ParsedNewsletter): string {
  const body = extractBody(sanitizeEmailHtml(msg.html));
  return (
    `<!doctype html><html><head><meta charset="utf-8">` +
    `<title>${escapeHtml(msg.subject)}</title>` +
    `<meta name="author" content="${escapeHtml(msg.fromName)}"></head>` +
    `<body><article>${body}</article></body></html>`
  );
}

/** A Readeck label derived from the sender's display name (trimmed, capped). */
function senderLabel(name: string): string {
  const clean = name.replace(/\s+/g, " ").trim().slice(0, 60);
  return clean || "Newsletter";
}

/** Stable synthetic URL from the Message-ID so Readeck dedupes re-ingested mail. */
export function newsletterUrl(messageId: string): string {
  const id = messageId.replace(/^<|>$/g, "").trim();
  return NEWSLETTER_URL_BASE + encodeURIComponent(id);
}

/** Map a parsed newsletter into the Readeck `save()` payload. */
export function messageToSaveInput(msg: ParsedNewsletter): {
  url: string;
  html: string;
  labels: string[];
} {
  return {
    url: newsletterUrl(msg.messageId),
    html: buildReadeckHtml(msg),
    labels: [EMAIL_LABEL, senderLabel(msg.fromName)],
  };
}

/** Normalize a mailparser result into our backend-agnostic shape. */
export function fromParsedMail(mail: ParsedMail, uid: number, mailbox: string): ParsedNewsletter {
  const fromVal = Array.isArray(mail.from?.value) ? mail.from?.value[0] : undefined;
  const fromName = (fromVal?.name || fromVal?.address || "Newsletter").trim();
  const fromAddress = fromVal?.address ?? "";
  const subject = (mail.subject ?? "").trim() || "(no subject)";
  const messageId = (mail.messageId ?? "").trim() || `<uid-${uid}@${mailbox}>`;
  const html =
    typeof mail.html === "string" && mail.html
      ? mail.html
      : `<pre>${escapeHtml(mail.text ?? "")}</pre>`;
  const date = mail.date instanceof Date ? mail.date.toISOString() : undefined;
  return { uid, messageId, subject, fromName, fromAddress, html, date };
}

export class EmailInbox {
  private readonly opts: EmailInboxOptions;

  constructor(opts: EmailInboxOptions) {
    this.opts = opts;
  }

  /**
   * Fetch every message with UID above the cursor's high-water mark, parsed and
   * sorted ascending. Returns the mailbox's current UIDVALIDITY so the caller can
   * detect a reset (validity change) and restart from UID 0 — Readeck's URL dedupe
   * makes that reprocessing harmless. Opens, reads, parses, and logs out; marking
   * \Seen is unnecessary because the UID cursor is the source of truth.
   */
  async fetchNew(cursor: EmailCursor | null): Promise<{
    uidValidity: string;
    messages: ParsedNewsletter[];
  }> {
    const client = new ImapFlow({
      host: this.opts.host,
      port: this.opts.port,
      secure: this.opts.secure ?? true,
      auth: { user: this.opts.user, pass: this.opts.password },
      logger: false,
    });
    await client.connect();
    try {
      const lock = await client.getMailboxLock(this.opts.mailbox);
      try {
        const mailbox = client.mailbox;
        const uidValidity = mailbox ? String(mailbox.uidValidity) : "0";
        const lastUid = cursor && cursor.uidValidity === uidValidity ? cursor.lastUid : 0;
        const messages: ParsedNewsletter[] = [];
        // `${lastUid + 1}:*` can echo the final message even when none are newer,
        // so filter on uid; an empty mailbox yields nothing.
        for await (const msg of client.fetch(
          `${lastUid + 1}:*`,
          { uid: true, source: true },
          { uid: true },
        )) {
          if (msg.uid <= lastUid || !msg.source) continue;
          const parsed = await simpleParser(msg.source);
          messages.push(fromParsedMail(parsed, msg.uid, this.opts.mailbox));
        }
        messages.sort((a, b) => a.uid - b.uid);
        return { uidValidity, messages };
      } finally {
        lock.release();
      }
    } finally {
      await client.logout();
    }
  }
}
