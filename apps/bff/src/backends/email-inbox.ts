import { isIP } from "node:net";
import { checkServerIdentity, type ConnectionOptions } from "node:tls";
import { ImapFlow, type ImapFlowOptions } from "imapflow";
import { simpleParser, type ParsedMail } from "mailparser";

/**
 * Newsletter ingestion source. Reads a dedicated IMAP mailbox (one address the
 * user subscribes newsletters to and nothing else reads), parses each message's
 * MIME into HTML, and turns it into a Readeck save payload tagged with a sentinel
 * label so the unifier renders it as an `email`-category card.
 *
 * Only genuinely NEW mail is ever fetched. The UID cursor is the primary guard:
 * on a cold start (no cursor) or a UIDVALIDITY reset the backlog is deliberately
 * SKIPPED — the cursor is seeded to the mailbox's current high-water mark and
 * that poll ingests nothing (see `resolveFetchPlan`). The Message-ID-derived URL
 * dedupe in `ingestNewsletters` is the second line of defence, for a message that
 * is legitimately re-seen. Readeck does NOT dedupe — see `newsletterUrl` below.
 *
 * The pure transforms (sanitize/build/map/cursor) are exported and unit-tested
 * without a live IMAP server; only `EmailInbox.fetchNew` touches the network.
 */

/** Reserved Readeck label that marks a bookmark as an ingested newsletter. */
export const EMAIL_LABEL = "lectern:email";

/**
 * Prefix for the Readeck label carrying the sender's email domain. The suffix is
 * the bare domain (e.g. `lectern:from:404media.co`). This is the stable key the
 * Newsletters surface groups by, so issues from one publication's many display
 * names (404 Media's writers all mail under @404media.co) collapse into one rack.
 */
export const EMAIL_DOMAIN_LABEL_PREFIX = "lectern:from:";

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
  /**
   * Escape hatch (`IMAP_INGEST_BACKLOG=1`). When true, a cold start / UIDVALIDITY
   * reset walks the mailbox from UID 0 and ingests the whole back catalogue
   * instead of seeding past it. Off by default — see `resolveFetchPlan`.
   */
  ingestBacklog?: boolean;
}

/**
 * Per-mailbox sync position: UID high-water mark, scoped to a UIDVALIDITY.
 *
 * The pairing matters: UIDs are only meaningful within one UIDVALIDITY, and
 * Proton Mail Bridge rotates UIDVALIDITY on every restart (changing IMAP_HOST or
 * IMAP_USER also yields a different one). When the stored validity no longer
 * matches the mailbox's, the stored `lastUid` is meaningless — but it does NOT
 * mean "start from 0 and re-ingest everything". `fetchNew` treats that as a cold
 * start: it re-seeds `lastUid` to the mailbox's current high-water mark and
 * ingests nothing that poll, so only mail that arrives AFTER the reset is taken.
 */
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
 * Wrap a newsletter in a minimal document whose <title> is the subject, whose
 * author meta is the sender, and whose publication date is the mail's Date
 * header, so Readeck's readability extraction produces a clean card
 * title/byline/date instead of guessing from marketing boilerplate.
 *
 * THE DATE IS LOAD-BEARING. `readeckBookmarkToCard` maps `bookmark.published` to
 * the Card's `publishedAt` (readeck.ts), and Readeck only sets `published` from
 * metadata it extracts out of the HTML we hand it. Until this emitted a date,
 * every ingested newsletter came back with `published: null` — all 225 email rows
 * in production have a NULL `publishedAt` — so newsletters had no publication
 * date at all and sorted purely by `savedAt`. A poll that ingests a batch stamps
 * that whole batch with near-identical savedAt values, which makes "the 10 most
 * recent issues of this publication" unanswerable.
 *
 * We emit the date three ways rather than betting on one extractor path:
 * `article:published_time` (OpenGraph/schema.org, the most widely consumed),
 * `<meta name="date">` (Dublin-Core style), and a machine-readable `<time
 * datetime>` inside the <article>. All three carry the same ISO 8601 instant.
 * A message with no Date header emits NONE of them — an absent date is a clean
 * "unknown", whereas a placeholder would extract as a real (and wrong) date.
 */
export function buildReadeckHtml(msg: ParsedNewsletter): string {
  const body = extractBody(sanitizeEmailHtml(msg.html));
  const date = msg.date ? escapeHtml(msg.date) : null;
  const dateMeta = date
    ? `<meta property="article:published_time" content="${date}">` +
      `<meta name="date" content="${date}">`
    : "";
  // Hidden, but present in the extracted article body: Readeck keeps the article
  // subtree, so a <time datetime> survives extraction even when head metadata is
  // dropped. `hidden` keeps it out of the rendered read view.
  const dateTag = date ? `<time datetime="${date}" hidden></time>` : "";
  return (
    `<!doctype html><html><head><meta charset="utf-8">` +
    `<title>${escapeHtml(msg.subject)}</title>` +
    `<meta name="author" content="${escapeHtml(msg.fromName)}">` +
    `${dateMeta}</head>` +
    `<body><article>${dateTag}${body}</article></body></html>`
  );
}

/**
 * The newsletter's own body HTML (sanitized, unwrapped from any document shell)
 * that Lectern stores as its content copy for the email document. We serve THIS
 * instead of Readeck's re-archived version, because Readeck's archiving of
 * newsletter images is unreliable — most archived `_resources` URLs 404 by read
 * time. Keeping the sender's original image URLs lets the same-origin image
 * proxy fetch them live when the article is opened.
 */
/**
 * Bytes a Postgres text column rejects and that email encodings sometimes leave
 * behind — NUL and the other C0 control chars (tab/newline/CR are kept). A stray
 * 0x00 otherwise fails the content insert on store. Hoisted to a const so the
 * eslint directive stays glued to the pattern through any reformatting.
 */
// eslint-disable-next-line no-control-regex
const C0_CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;

export function newsletterContentHtml(msg: ParsedNewsletter): string {
  return extractBody(sanitizeEmailHtml(msg.html)).replace(C0_CONTROL_CHARS, "");
}

/** A Readeck label derived from the sender's display name (trimmed, capped). */
function senderLabel(name: string): string {
  const clean = name.replace(/\s+/g, " ").trim().slice(0, 60);
  return clean || "Newsletter";
}

/**
 * The sender's domain: the lowercased, trimmed part after the last `@`. Null
 * when the address is missing or has no domain part. This is what newsletter
 * grouping keys on, so writers sharing a domain land in one publication.
 */
export function senderDomain(address: string): string | null {
  const at = address.lastIndexOf("@");
  if (at < 0) return null;
  const domain = address
    .slice(at + 1)
    .trim()
    .toLowerCase();
  return domain || null;
}

/** The bare Message-ID: angle brackets stripped, trimmed. */
function bareMessageId(messageId: string): string {
  return messageId.replace(/^<|>$/g, "").trim();
}

/**
 * Stable synthetic URL derived from the Message-ID. This is the URL we POST to
 * Readeck, and the basis of LECTERN's dedupe key for re-ingested mail.
 *
 * It is emphatically NOT a Readeck dedupe key. Readeck's `POST /api/bookmarks`
 * happily creates a second bookmark with a new id for a URL it already holds,
 * and since a document's identity is `readeck:<id>`, that new id becomes a NEW
 * unified document — stranding the original's read state, tags, and delete
 * tombstone on the old row. The dedupe has to happen here, before the save.
 *
 * WHAT WE SEND IS NOT WHAT COMES BACK. `encodeURIComponent` escapes `@` to `%40`,
 * and every RFC-compliant Message-ID has an `@`. Readeck normalizes the URL when
 * it stores the bookmark, decoding `%40` back to a literal `@`, so what lands in
 * `documents.url` never equals this string. Look the dedupe key up with
 * `newsletterUrlVariants`, never with a bare equality test against this value.
 *
 * Kept percent-encoding deliberately: Message-IDs may legally contain `/`, `?`
 * and `#`, which unescaped would change the URL's structure (path segment, query,
 * fragment) and make what Readeck stores depend on the id's content. Since the
 * lookup matches both forms, the encoding on the wire is free to stay strict.
 *
 * Stability caveat: this is only as stable as the Message-ID. Mail with no
 * Message-ID header gets a UID-derived fallback (see `fromParsedMail`), which
 * changes across a UIDVALIDITY reset and therefore will not dedupe.
 */
export function newsletterUrl(messageId: string): string {
  return NEWSLETTER_URL_BASE + encodeURIComponent(bareMessageId(messageId));
}

/**
 * Characters `encodeURIComponent` escapes but RFC 3986 allows unescaped in a path
 * segment (`pchar` = unreserved / sub-delims / ":" / "@"). A URL normalizer that
 * decodes unnecessary escapes — which is what Readeck does — turns these back
 * into literals, so a stored URL can differ from what we sent by exactly these.
 *
 * Pointedly ABSENT: `/`, `?`, `#`, `%`, and space. Decoding those would change
 * the URL's meaning, so no sane normalizer does it and neither do we.
 */
const PCHAR_ESCAPES: ReadonlyArray<[RegExp, string]> = [
  [/%40/g, "@"],
  [/%3A/gi, ":"],
  [/%24/g, "$"],
  [/%26/g, "&"],
  [/%2B/gi, "+"],
  [/%2C/gi, ","],
  [/%3B/gi, ";"],
  [/%3D/gi, "="],
];

/**
 * Every form the newsletter's synthetic URL can legitimately be stored under, to
 * be matched as a set (`findByAnyUrl`). Order is not significant.
 *
 * WHY THIS EXISTS. The dedupe shipped in 87adf55 was completely inert in
 * production — it never matched once. It looked up the `encodeURIComponent` form
 * (`...%40ghost.wheresyoured.at`) while Readeck had normalized the URL to a
 * literal `@` before storing it, so the exact-equality lookup queried a string
 * that does not exist in `documents.url`: of 225 `category='email'` rows, 225
 * held a literal `@` and 0 held `%40`. Newsletters already in the library were
 * therefore re-imported on every replay under fresh Readeck bookmark ids,
 * stranding their read state, tags, and delete tombstones.
 *
 * Matching a SET rather than picking one canonical form is deliberate: it covers
 * the legacy rows written under either behaviour, and it does not bet on Readeck's
 * normalization staying exactly as it is today.
 */
export function newsletterUrlVariants(messageId: string): string[] {
  const encoded = newsletterUrl(messageId);
  let normalized = encoded;
  for (const [pattern, literal] of PCHAR_ESCAPES) normalized = normalized.replace(pattern, literal);
  // A Message-ID with no escapable characters yields one form, not two.
  return normalized === encoded ? [encoded] : [encoded, normalized];
}

/** Map a parsed newsletter into the Readeck `save()` payload. */
export function messageToSaveInput(msg: ParsedNewsletter): {
  url: string;
  html: string;
  labels: string[];
} {
  const labels = [EMAIL_LABEL, senderLabel(msg.fromName)];
  // Carry the sender's domain as a label so the grouping key survives Readeck
  // re-indexing and is recoverable on the card without a new backend field.
  const domain = senderDomain(msg.fromAddress);
  if (domain) labels.push(EMAIL_DOMAIN_LABEL_PREFIX + domain);
  return {
    url: newsletterUrl(msg.messageId),
    html: buildReadeckHtml(msg),
    labels,
  };
}

/** Normalize a mailparser result into our backend-agnostic shape. */
export function fromParsedMail(mail: ParsedMail, uid: number, mailbox: string): ParsedNewsletter {
  const fromVal = Array.isArray(mail.from?.value) ? mail.from?.value[0] : undefined;
  const fromName = (fromVal?.name || fromVal?.address || "Newsletter").trim();
  const fromAddress = fromVal?.address ?? "";
  const subject = (mail.subject ?? "").trim() || "(no subject)";
  // KNOWN LIMITATION: the fallback id is UID-derived, so for mail with no
  // Message-ID header the synthetic newsletter URL changes whenever UIDVALIDITY
  // rotates (every Proton Bridge restart) and the URL dedupe in `pollEmail` will
  // not catch the replay. Rare in practice — real newsletters all set a
  // Message-ID — and the only real fix is a content hash. Left as-is.
  const messageId = (mail.messageId ?? "").trim() || `<uid-${uid}@${mailbox}>`;
  const html =
    typeof mail.html === "string" && mail.html
      ? mail.html
      : `<pre>${escapeHtml(mail.text ?? "")}</pre>`;
  const date = mail.date instanceof Date ? mail.date.toISOString() : undefined;
  return { uid, messageId, subject, fromName, fromAddress, html, date };
}

/**
 * What a poll should do, decided before any message body is downloaded.
 *
 * - `incremental` — the stored cursor is valid for this UIDVALIDITY; fetch only
 *   UIDs above `fromUid`. This is the steady state.
 * - `cold-start` — there is no cursor, or the mailbox's UIDVALIDITY has changed.
 *   Ingest NOTHING; seed the cursor to `seededLastUid` (the mailbox's current
 *   high-water mark) so the next poll picks up only genuinely new arrivals.
 */
export type EmailFetchPlan =
  | { mode: "incremental"; fromUid: number }
  | { mode: "cold-start"; seededLastUid: number; reason: string };

/**
 * Decide between an incremental fetch and a cold-start seed. Pure, so the policy
 * is unit-testable without an IMAP server.
 *
 * The rule the user asked for: never fetch the back catalogue. A cold start (no
 * cursor at all) and a UIDVALIDITY reset are indistinguishable in what they imply
 * — the stored UID means nothing — and BOTH used to fall back to UID 0, i.e.
 * "ingest the entire mailbox". Proton Mail Bridge rotates UIDVALIDITY on every
 * restart and a host/user change produces a different validity too, so that path
 * fired routinely: one such switch swept 160 messages of back catalogue into the
 * library in a single poll. Now we seed past the backlog instead.
 *
 * `highestUid` is the mailbox's current high-water mark, obtained from mailbox
 * metadata (never by downloading message bodies).
 *
 * `ingestBacklog` is the deliberate-backfill escape hatch (`IMAP_INGEST_BACKLOG`):
 * it restores the old fetch-everything-from-0 behaviour on demand.
 */
export function resolveFetchPlan(
  cursor: EmailCursor | null,
  uidValidity: string,
  highestUid: number,
  opts: { ingestBacklog?: boolean } = {},
): EmailFetchPlan {
  if (cursor && cursor.uidValidity === uidValidity) {
    return { mode: "incremental", fromUid: cursor.lastUid };
  }
  if (opts.ingestBacklog) return { mode: "incremental", fromUid: 0 };
  const reason = cursor
    ? `uidvalidity changed ${cursor.uidValidity} -> ${uidValidity}`
    : "no stored cursor";
  return { mode: "cold-start", seededLastUid: Math.max(0, highestUid), reason };
}

/** Outcome of one poll. `coldStart` is set only when the backlog was skipped. */
export interface EmailFetchResult {
  uidValidity: string;
  /** Empty on a cold start — the backlog is deliberately not ingested. */
  messages: ParsedNewsletter[];
  /**
   * Present only on a cold start / UIDVALIDITY reset. The caller MUST persist
   * `{uidValidity, lastUid: seededLastUid}` even though zero messages came back,
   * otherwise the next poll cold-starts again and never advances.
   */
  coldStart?: { seededLastUid: number; backlogSize: number; reason: string };
}

// ---------------------------------------------------------------------------
// Connection options: TLS identity, timeouts, and the injectable client seam
// ---------------------------------------------------------------------------

/**
 * How long to wait for the TCP/TLS connection to come up. ImapFlow's own default
 * is 90s; the poll runs every 5 minutes, so a connection that has not been made
 * in 30s is not going to be made in time to be useful.
 */
export const IMAP_CONNECTION_TIMEOUT_MS = 30_000;

/** How long to wait for the server's `* OK` greeting (ImapFlow default 16s). */
export const IMAP_GREETING_TIMEOUT_MS = 20_000;

/**
 * Socket INACTIVITY timeout (ImapFlow default 5 minutes). It bounds a stalled
 * server mid-fetch, not the total runtime: a large batch keeps the socket busy,
 * and the only quiet stretch is `simpleParser` between messages, which is
 * sub-second. Without this `fetchNew` had no timeout of its own at all, so a
 * half-open socket held the pg-boss job (and its advisory lock) open until the
 * job expiry four hours later.
 */
export const IMAP_SOCKET_TIMEOUT_MS = 120_000;

/**
 * Extra TLS options for an IMAP host, or `undefined` when Node's defaults are
 * already correct. Verification is ALWAYS on: this fixes *which name* is
 * verified, it never disables the check.
 *
 * THE BUG. RFC 6066 forbids SNI for IP literals, so ImapFlow sets
 * `this.servername = ... : !net.isIP(this.host) ? this.host : false` — i.e.
 * `false` for an IP host (imap-flow.js:282). Node then derives the name it hands
 * to `checkServerIdentity` from `servername || host || socket._host ||
 * 'localhost'`. On the STARTTLS path ImapFlow builds
 * `Object.assign({ socket, servername, port }, this.options.tls || {})`
 * (imap-flow.js:1148-1155) — note there is NO `host` key, because the socket
 * already exists. With `servername === false` and no `host`, Node falls all the
 * way through to the literal string `"localhost"` and verifies the certificate
 * against THAT. Against Proton Bridge's self-signed cert (`CN=127.0.0.1`, SAN
 * `IP Address:127.0.0.1`) that yields the production crash:
 *
 *   ERR_TLS_CERT_ALTNAME_INVALID: Host: localhost. is not cert's CN: 127.0.0.1
 *
 * The CA and the certificate were both fine; the name being checked was wrong.
 *
 * THE FIX. Verify against the host we actually configured. Node's own
 * `tls.checkServerIdentity` handles IP SANs correctly when it is given an IP
 * string (`net.isIP(hostname)` → match against the cert's `IP Address:` SANs),
 * so we delegate to it rather than reimplementing name matching.
 *
 * WHY IP-ONLY. For a DNS host `this.servername` IS the host, so Node already
 * verifies against exactly the name we configured on both the implicit-TLS and
 * STARTTLS paths — passing this override would compute the identical result
 * while permanently opting out of any future improvement to Node's default
 * derivation. The defect is specific to the IP-literal case that suppresses SNI,
 * so the fix is scoped to it and the overwhelmingly common DNS path keeps stock
 * behaviour. (Verified empirically against a local TLS server using a
 * `CN=127.0.0.1` / `SAN IP:127.0.0.1` self-signed cert: ImapFlow's STARTTLS
 * option shape reproduces the exact production error, and this override returns
 * `authorized: true`.)
 *
 * The single `tls` object covers BOTH paths: ImapFlow merges `this.options.tls`
 * into the implicit-TLS options (imap-flow.js:1641-1648) and into the STARTTLS
 * upgrade options (imap-flow.js:1148-1155). The failure was on the STARTTLS
 * path; applying it to both also hardens the implicit path, which only works
 * today because ImapFlow happens to pass `host` there.
 */
export function imapTlsOptions(host: string): ConnectionOptions | undefined {
  if (!isIP(host)) return undefined;
  return {
    // `_servername` is what Node derived (and is exactly what is wrong here);
    // the configured host is the name the operator actually pointed us at.
    checkServerIdentity: (_servername, cert) => checkServerIdentity(host, cert),
  };
}

/**
 * The full ImapFlow option object for a mailbox. Exported (and pure) so tests
 * can assert on what would be handed to the client without opening a socket.
 */
export function buildImapOptions(opts: EmailInboxOptions): ImapFlowOptions {
  const tls = imapTlsOptions(opts.host);
  return {
    host: opts.host,
    port: opts.port,
    // `secure: true` is implicit TLS on 993; `false` means plain 143 upgraded
    // via STARTTLS. The TLS identity fix above has to hold for both.
    secure: opts.secure ?? true,
    auth: { user: opts.user, pass: opts.password },
    logger: false,
    connectionTimeout: IMAP_CONNECTION_TIMEOUT_MS,
    greetingTimeout: IMAP_GREETING_TIMEOUT_MS,
    socketTimeout: IMAP_SOCKET_TIMEOUT_MS,
    ...(tls ? { tls } : {}),
  };
}

/** The slice of `ImapFlow` `fetchNew` uses, so tests can inject a fake client. */
export interface ImapClientLike {
  readonly mailbox: { uidValidity: bigint; uidNext: number; exists: number } | false;
  on(event: "error", listener: (err: Error) => void): unknown;
  connect(): Promise<void>;
  getMailboxLock(path: string): Promise<{ release: () => void }>;
  search(query: { all: true }, options: { uid: true }): Promise<number[] | false>;
  fetch(
    range: string,
    query: { uid: true; source: true },
    options: { uid: true },
  ): AsyncIterableIterator<{ uid: number; source?: Buffer | false }>;
  logout(): Promise<void>;
  close(): void;
}

export type ImapClientFactory = (options: ImapFlowOptions) => ImapClientLike;

const realImapClient: ImapClientFactory = (options) => new ImapFlow(options);

/**
 * Tear the connection down without ever throwing. `logout()` speaks IMAP, so it
 * is only meaningful on a connection that came up; when it did not (or when the
 * polite logout itself fails) fall back to closing the socket outright. A
 * failure here must never mask the real error propagating out of the `try`.
 */
async function disconnectQuietly(client: ImapClientLike, connected: boolean): Promise<void> {
  try {
    if (connected) await client.logout();
    else client.close();
    return;
  } catch {
    // fall through to the hard close
  }
  try {
    client.close();
  } catch {
    // already torn down; nothing left to do
  }
}

export class EmailInbox {
  private readonly opts: EmailInboxOptions;
  private readonly createClient: ImapClientFactory;

  constructor(opts: EmailInboxOptions, createClient: ImapClientFactory = realImapClient) {
    this.opts = opts;
    this.createClient = createClient;
  }

  /**
   * Fetch every message with UID above the cursor's high-water mark, parsed and
   * sorted ascending, along with the mailbox's current UIDVALIDITY.
   *
   * On a cold start (no cursor) or a UIDVALIDITY reset — routine, since Proton
   * Mail Bridge rotates UIDVALIDITY on every restart — this returns ZERO messages
   * and a `coldStart` block instead: the back catalogue is skipped outright and
   * the caller seeds the cursor to the mailbox's current high-water mark, so the
   * next poll takes only genuinely new arrivals. Set `ingestBacklog` to restore
   * the old "walk the whole mailbox from UID 0" behaviour for a deliberate
   * backfill. The URL dedupe in `ingestNewsletters` still runs on the incremental
   * path, but it is now a second line of defence, not the thing standing between
   * a Bridge restart and a re-imported library.
   *
   * The high-water mark comes from the SELECT response's `uidNext` (and the
   * backlog size from `exists`) — mailbox metadata we already hold, so seeding
   * costs no extra round trip and downloads no message sources. Only if the
   * server omits `uidNext` do we fall back to a UID-only SEARCH, which returns a
   * list of numbers, still no bodies.
   *
   * Opens, reads, parses, and logs out; marking \Seen is unnecessary because the
   * UID cursor is the source of truth.
   *
   * NEVER LET AN IMAP FAULT ESCAPE AS AN UNHANDLED EVENT. `ImapFlow` is an
   * EventEmitter and `emitError` does a bare `this.emit('error', err)`
   * (imap-flow.js:409) for socket errors, unexpected disconnects and TLS
   * failures — including AFTER `connect()` has resolved, mid-`fetch`. Node's
   * EventEmitter THROWS an `'error'` emit that has no listener, and that throw
   * lands outside every promise chain: it became an uncaughtException, exited
   * the process 1, and systemd restart-looped the whole BFF. Newsletter
   * ingestion is an optional background job; it must never be able to do that.
   * So a listener is attached before anything can fail, and it stays attached
   * through teardown so a late emit is still absorbed.
   */
  async fetchNew(cursor: EmailCursor | null): Promise<EmailFetchResult> {
    const client = this.createClient(buildImapOptions(this.opts));
    // The listener only RECORDS. ImapFlow independently rejects the in-flight
    // operation, so rethrowing from here would produce a second copy of the
    // failure with nowhere to go. What makes this line load-bearing is simply
    // that a listener EXISTS — see the note above.
    const emitted: Error[] = [];
    client.on("error", (err) => {
      emitted.push(err);
    });
    let connected = false;
    try {
      await client.connect();
      connected = true;
      const lock = await client.getMailboxLock(this.opts.mailbox);
      try {
        const mailbox = client.mailbox;
        const uidValidity = mailbox ? String(mailbox.uidValidity) : "0";
        const backlogSize = mailbox ? mailbox.exists : 0;
        // uidNext - 1 bounds every UID currently in the mailbox, which is all a
        // high-water mark has to do. It costs nothing: the SELECT response
        // already carried it.
        let highestUid = mailbox && mailbox.uidNext > 0 ? mailbox.uidNext - 1 : 0;
        if (!highestUid && backlogSize > 0) {
          // Server didn't advertise UIDNEXT. Ask for UIDs only — metadata, no
          // message sources; we are not paying to parse 700 bodies for a number.
          const uids = await client.search({ all: true }, { uid: true });
          if (uids && uids.length) highestUid = Math.max(...uids);
        }

        const plan = resolveFetchPlan(cursor, uidValidity, highestUid, {
          ingestBacklog: this.opts.ingestBacklog,
        });
        if (plan.mode === "cold-start") {
          return {
            uidValidity,
            messages: [],
            coldStart: { seededLastUid: plan.seededLastUid, backlogSize, reason: plan.reason },
          };
        }

        const lastUid = plan.fromUid;
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
    } catch (err) {
      // Prefer the emitted cause. ImapFlow sometimes rejects the pending
      // operation with a generic "Unexpected close" while the actual reason
      // (the TLS name check, a socket reset) arrived on the 'error' event; the
      // generic one is what made this class of failure hard to diagnose.
      throw emitted[0] ?? err;
    } finally {
      await disconnectQuietly(client, connected);
    }
  }
}
