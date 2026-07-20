import { PgBoss } from "pg-boss";
import { eq, sql as dsql } from "drizzle-orm";
import { config, pushEnabled } from "./config";
import { db, sql } from "./db/client";
import { BackendHttpError } from "./errors";
import { getFeedPref, sendPush } from "./push";
import { ingestionLog, syncCursors } from "./db/schema";
import { MinifluxBackend } from "./backends/miniflux";
import { ReadeckBackend } from "./backends/readeck";
import {
  EmailInbox,
  formatEmailCursor,
  isExcludedSender,
  messageToSaveInput,
  newsletterContentHtml,
  newsletterUrlVariants,
  parseEmailCursor,
  parseExcludedSenders,
  type EmailCursor,
  type EmailFetchResult,
  type ParsedNewsletter,
} from "./backends/email-inbox";
import { DrizzleOverlayStore } from "./overlay-store";
import type { IndexedUrlMatch } from "./unify";
import type { Card } from "@lectern/shared";

/**
 * Background ingestion jobs on pg-boss (same Postgres as the glue DB). Two poll
 * jobs walk each backend's delta (MiniFlux via `changed_after`, Readeck via
 * `updated_since`) from the last-seen cursor and refresh the glue `documents`
 * index WITHOUT clobbering BFF-owned overlay columns; a reconcile job drops
 * orphaned rows. Jobs are opt-in (server starts them behind an env guard) and
 * never run during tests.
 */

const QUEUE = {
  pollMiniflux: "poll-miniflux",
  pollReadeck: "poll-readeck",
  pollEmail: "poll-email",
  reconcile: "orphan-reconcile",
  reconcileDeletions: "reconcile-deletions",
  backfillContent: "backfill-content",
  pruneLogs: "prune-ingestion-log",
} as const;

const POLL_PAGE_SIZE = 100;

let boss: PgBoss | null = null;

// ---------------------------------------------------------------------------
// Single-flight: a poll must never overlap itself
// ---------------------------------------------------------------------------

/**
 * Sentinel returned by `runExclusively` when another run already holds the lock.
 * Distinct from a real result (a poll legitimately returns 0) so callers can log
 * "skipped" rather than "indexed nothing".
 */
export const SKIPPED = Symbol("job-skipped");

/**
 * A mutual-exclusion primitive scoped to the whole database, not the process.
 * Production backs this with a Postgres session advisory lock; tests pass an
 * in-memory fake.
 */
export interface AdvisoryLock {
  tryLock(key: number): Promise<boolean>;
  unlock(key: number): Promise<void>;
}

/**
 * First half of the advisory-lock key pair — an arbitrary constant that
 * namespaces Lectern's locks away from anything else sharing the database
 * (pg-boss takes its own advisory locks during migrations).
 */
const ADVISORY_LOCK_NAMESPACE = 0x1ec7e12;

/**
 * Stable 32-bit key for a job name. djb2, folded into a signed int32 because
 * `pg_try_advisory_lock(int, int)` takes int4 arguments.
 */
export function advisoryLockKey(name: string): number {
  let h = 5381;
  for (let i = 0; i < name.length; i++) h = (Math.imul(h, 33) ^ name.charCodeAt(i)) | 0;
  return h | 0;
}

/**
 * Run `fn` only if no other run of the same `name` is in flight anywhere —
 * including in another process, and including a run started by an HTTP handler
 * rather than the scheduler.
 *
 * WHY THIS EXISTS. pg-boss's queue defaults are hostile to a long poll: a job is
 * `expire_seconds = 900` (15 min) by default, `failJobsByTimeout` fails any
 * active job past that unconditionally, and the heartbeat that would exempt it
 * only runs when `heartbeat_seconds` is set — which a bare `createQueue` leaves
 * NULL. With `retryLimit` defaulting to 2, a poll still running at T+15min is
 * marked failed and RE-QUEUED while the original handler is still executing. A
 * newsletter poll trivially exceeds 15 minutes (`ReadeckBackend.save` waits up
 * to 24s per message; production logged "saved 160 of 725").
 *
 * Two concurrent runs read the same cursor, fetch the same UID range and save
 * the same messages; the URL dedupe cannot arbitrate because run B checks before
 * run A has indexed, so both save and the library gains duplicate bookmarks under
 * fresh ids. The queue options set in `startJobs` narrow the window, but they
 * CANNOT close it on an existing deployment: `create_queue` is `ON CONFLICT DO
 * NOTHING` and a queue's `policy` is immutable after creation. The lock is
 * therefore the load-bearing guard, and it is the only one that also covers
 * `POST /sync/force`, which runs the polls inline and bypasses pg-boss entirely.
 */
export async function runExclusively<T>(
  lock: AdvisoryLock,
  name: string,
  fn: () => Promise<T>,
  onSkipped?: (name: string) => Promise<void>,
): Promise<T | typeof SKIPPED> {
  const key = advisoryLockKey(name);
  if (!(await lock.tryLock(key))) {
    await onSkipped?.(name);
    return SKIPPED;
  }
  try {
    return await fn();
  } finally {
    await lock.unlock(key);
  }
}

/**
 * Postgres session advisory lock held on a RESERVED connection. Reserving is
 * essential: a session lock lives on the connection that took it, and the shared
 * pool hands a different connection to every query, so `pg_advisory_lock` issued
 * through `db` would be released the moment that connection went back to the
 * pool. A transaction-scoped lock would work too, but would mean wrapping an
 * hour-long poll in one transaction.
 */
function pgAdvisoryLock(): AdvisoryLock {
  let held: Awaited<ReturnType<typeof sql.reserve>> | null = null;
  return {
    async tryLock(key) {
      const conn = await sql.reserve();
      try {
        const rows = await conn<{ ok: boolean }[]>`
          select pg_try_advisory_lock(${ADVISORY_LOCK_NAMESPACE}::int, ${key}::int) as ok`;
        if (rows[0]?.ok) {
          held = conn;
          return true;
        }
      } catch (err) {
        conn.release();
        throw err;
      }
      conn.release();
      return false;
    },
    async unlock(key) {
      const conn = held;
      held = null;
      if (!conn) return;
      try {
        await conn`select pg_advisory_unlock(${ADVISORY_LOCK_NAMESPACE}::int, ${key}::int)`;
      } finally {
        conn.release();
      }
    },
  };
}

/**
 * Wrap a job body in the database-wide lock for its name, logging (rather than
 * silently swallowing) a skipped run and returning `fallback` in that case.
 */
async function exclusiveJob<T>(name: string, fallback: T, fn: () => Promise<T>): Promise<T> {
  const result = await runExclusively(pgAdvisoryLock(), name, fn, async (n) =>
    logIngestion(
      "glue",
      "job-skipped",
      "warn",
      `${n} skipped: a previous run is still in flight (overlapping runs duplicate work)`,
    ),
  );
  return result === SKIPPED ? fallback : result;
}

function backends() {
  const rss = new MinifluxBackend({
    baseUrl: config.MINIFLUX_URL,
    apiToken: config.MINIFLUX_API_TOKEN || undefined,
    basic: config.MINIFLUX_BASIC,
  });
  const readLater = new ReadeckBackend({
    baseUrl: config.READECK_URL,
    apiToken: config.READECK_API_TOKEN,
  });
  const store = new DrizzleOverlayStore(db);
  return { rss, readLater, store };
}

async function getCursor(source: string): Promise<string | undefined> {
  const [row] = await db.select().from(syncCursors).where(eq(syncCursors.source, source));
  return row?.cursor ?? undefined;
}

/**
 * Would writing `next` over `current` move the cursor FORWARD (or leave it)?
 *
 * The cursor upsert is last-writer-wins with no compare-and-set, so a stale
 * writer — an overlapping run that started earlier, or a retried pg-boss job
 * whose original handler is still alive — can move the mark BACKWARDS and make
 * the next poll re-process settled mail. The overlap itself is prevented by the
 * advisory lock; this is the belt to that pair of braces, and it also covers the
 * ordinary case of a poll finishing out of order with a forced sync.
 *
 * Comparison is per-source because the cursor formats differ: `email` stores
 * `"<uidvalidity>:<uid>"`, the backend polls store an ISO 8601 instant. An
 * unparseable value on either side is allowed through — a monotonicity check
 * must never be the reason ingestion wedges.
 */
export function isCursorAdvance(
  source: string,
  current: string | null | undefined,
  next: string,
): boolean {
  if (!current) return true;
  if (source === "email") {
    const a = parseEmailCursor(current);
    const b = parseEmailCursor(next);
    if (!a || !b) return true;
    // A UIDVALIDITY change re-bases the mark: the old UID is meaningless, so the
    // new one is not a regression however small it is.
    if (a.uidValidity !== b.uidValidity) return true;
    return b.lastUid >= a.lastUid;
  }
  const a = Date.parse(current);
  const b = Date.parse(next);
  if (Number.isNaN(a) || Number.isNaN(b)) return true;
  return b >= a;
}

async function setCursor(source: string, cursor: string): Promise<void> {
  const current = await getCursor(source);
  if (!isCursorAdvance(source, current, cursor)) return;
  await db
    .insert(syncCursors)
    .values({ source, cursor })
    .onConflictDoUpdate({ target: syncCursors.source, set: { cursor, updatedAt: new Date() } });
}

/**
 * Hard cap on what any caller can write into `ingestion_log.message`.
 *
 * A drizzle query error's `message` is the ENTIRE failed SQL plus every bound
 * parameter. For the newsletter content insert that meant the whole email body:
 * production rows reached 100KB-280KB each, the table grew to 71 MB, and a
 * `select ... limit 8` returned 261 MB. The cap lives HERE, at the write
 * boundary, so no call site can ever dump a payload into the log again.
 */
export const LOG_MESSAGE_MAX = 500;

/** Cap a log line, marking that it was cut so a truncated cause isn't mistaken
 *  for the whole story. */
export function truncateLogMessage(message: string, max = LOG_MESSAGE_MAX): string {
  if (message.length <= max) return message;
  return `${message.slice(0, max)}… [truncated, ${message.length} chars]`;
}

/**
 * A short, USEFUL description of a thrown error.
 *
 * Drizzle wraps the driver error: `err.message` is the query text plus bound
 * parameters, while the actual Postgres failure (`foreign key violation`, plus
 * its SQLSTATE `code`) hangs off `err.cause`. Logging `err.message` therefore
 * recorded a giant SQL string and NOT the reason — which is exactly why the
 * newsletter content FK violation ran unnoticed for so long. Prefer the cause,
 * with its pg error code; fall back to the message only when there is no cause.
 */
export function describeError(err: unknown): string {
  const cause = err instanceof Error ? (err.cause as unknown) : undefined;
  if (cause instanceof Error) {
    const code = (cause as { code?: unknown }).code;
    const detail = (cause as { detail?: unknown }).detail;
    return [
      typeof code === "string" && code ? `[${code}] ` : "",
      cause.message,
      typeof detail === "string" && detail ? ` (${detail})` : "",
    ].join("");
  }
  if (cause !== undefined && cause !== null) return String(cause);
  return err instanceof Error ? err.message : String(err);
}

/**
 * The card to index for a freshly-saved newsletter, with the mail's Date header
 * filling in `publishedAt` when Readeck's extraction did not produce one.
 *
 * Belt and braces for the emitted `article:published_time` metadata: the email's
 * own Date header is authoritative for a newsletter, and this makes the value
 * correct from the moment of ingestion rather than depending on Readeck's
 * extractor. NOTE the limit — a later `pollReadeck` re-indexes from backend truth,
 * so if Readeck did not store a `published` this value is overwritten with null
 * on the next poll. The markup in `buildReadeckHtml` is what makes it durable.
 */
function withEmailPublishedAt(card: Card, msg: ParsedNewsletter): Card {
  if (card.publishedAt || !msg.date) return card;
  return { ...card, publishedAt: msg.date };
}

async function logIngestion(
  source: string,
  action: string,
  status: string,
  message: string,
): Promise<void> {
  await db
    .insert(ingestionLog)
    .values({ source, action, status, message: truncateLogMessage(message) });
}

/**
 * Walk MiniFlux's `changed_after` delta into the glue index; advance the cursor.
 * Single-flight (see `runExclusively`): an overlapping run returns 0 and logs.
 */
export async function pollMiniflux(): Promise<number> {
  return exclusiveJob(QUEUE.pollMiniflux, 0, pollMinifluxOnce);
}

async function pollMinifluxOnce(): Promise<number> {
  const { rss, store } = backends();
  const since = await getCursor("miniflux");
  const startedAt = new Date().toISOString();
  let cursor: string | null | undefined;
  let indexed = 0;

  // Push is off in the common case: keep the original blind-upsert path so there
  // is ZERO behavior change and zero extra DB queries when notifications are
  // disabled.
  if (!pushEnabled()) {
    do {
      const page = await rss.listEntries({
        updatedAfter: since,
        cursor: cursor ?? undefined,
        pageSize: POLL_PAGE_SIZE,
      });
      for (const card of page.items) {
        await store.indexFromBackend(card);
        indexed++;
      }
      cursor = page.nextCursor;
    } while (cursor);
    await setCursor("miniflux", startedAt);
    await logIngestion("miniflux", "poll", "ok", `indexed ${indexed} since ${since ?? "epoch"}`);
    return indexed;
  }

  // Push enabled: tally genuinely-new, unread entries per flagged feed, then fire
  // one batched push per feed after the walk. `feedId` is the stringified MiniFlux
  // feed id (== the id GET /feeds returns), pulled from the raw entry since the
  // unified Card has no feed field. We MUST check isIndexed BEFORE indexing (the
  // upsert would otherwise create the row and make every entry look "seen").
  const tally = new Map<string, { count: number; title: string }>();
  const prefCache = new Map<string, boolean>();
  do {
    const page = await rss.listEntriesWithFeed({
      updatedAfter: since,
      cursor: cursor ?? undefined,
      pageSize: POLL_PAGE_SIZE,
    });
    for (const item of page.items) {
      const isNew = !(await store.isIndexed(item.card.id));
      if (isNew && item.unread) {
        let enabled = prefCache.get(item.feedId);
        if (enabled === undefined) {
          enabled = await getFeedPref(item.feedId);
          prefCache.set(item.feedId, enabled);
        }
        if (enabled) {
          const prev = tally.get(item.feedId);
          tally.set(item.feedId, {
            count: (prev?.count ?? 0) + 1,
            title: item.feedTitle ?? prev?.title ?? "New articles",
          });
        }
      }
      await store.indexFromBackend(item.card);
      indexed++;
    }
    cursor = page.nextCursor;
  } while (cursor);

  await setCursor("miniflux", startedAt);
  await logIngestion("miniflux", "poll", "ok", `indexed ${indexed} since ${since ?? "epoch"}`);

  for (const [feedId, { count, title }] of tally) {
    if (count <= 0) continue;
    await sendPush({
      title,
      body: `${count} new article${count === 1 ? "" : "s"}`,
      url: "/feed",
      tag: `feed-${feedId}`,
    });
  }
  return indexed;
}

/**
 * Walk Readeck's `updated_since` delta into the glue index; advance the cursor.
 * Single-flight (see `runExclusively`): an overlapping run returns 0 and logs.
 */
export async function pollReadeck(): Promise<number> {
  return exclusiveJob(QUEUE.pollReadeck, 0, pollReadeckOnce);
}

async function pollReadeckOnce(): Promise<number> {
  const { readLater, store } = backends();
  const since = await getCursor("readeck");
  const startedAt = new Date().toISOString();
  let cursor: string | null | undefined;
  let indexed = 0;
  do {
    const page = await readLater.list({
      updatedAfter: since,
      cursor: cursor ?? undefined,
      pageSize: POLL_PAGE_SIZE,
    });
    for (const card of page.items) {
      await store.indexFromBackend(card);
      indexed++;
    }
    cursor = page.nextCursor;
  } while (cursor);
  await setCursor("readeck", startedAt);
  await logIngestion("readeck", "poll", "ok", `indexed ${indexed} since ${since ?? "epoch"}`);
  return indexed;
}

/** The store + backend surface newsletter ingestion needs, narrowed so tests can
 *  pass hand-written in-memory fakes instead of a live DB and Readeck. */
export interface NewsletterIngestDeps {
  store: {
    findByAnyUrl(urls: readonly string[]): Promise<IndexedUrlMatch | null>;
    /**
     * Create the glue `documents` row for a freshly-saved bookmark. MUST run
     * before `putContent` — `document_content.document_id` is an FK to
     * `documents.id`. See the ordering note in `ingestNewsletters`.
     */
    upsertIndex(card: Card): Promise<void>;
    putContent(id: string, html: string): Promise<void>;
  };
  readLater: {
    save(input: { url: string; html?: string; labels?: string[] }): Promise<string>;
    /** Read back the bookmark we just created, so it can be indexed immediately. */
    get(sourceId: string): Promise<Card>;
  };
  excluded: ReadonlySet<string>;
  /** Persist the UID high-water mark (called after every message we finish with). */
  setCursor(uid: number): Promise<void>;
  /**
   * Persisted per-UID save-failure counters, keyed by UID as a string. Survives
   * restarts, so a message cannot reset its attempt count by crashing the poll.
   * Only actively-failing UIDs are held (entries are dropped on success or skip),
   * so the map stays small.
   */
  getFailures(): Promise<Record<string, number>>;
  setFailures(failures: Record<string, number>): Promise<void>;
  /** Append an ingestion-log line (errors only; the caller writes the summary). */
  log(status: string, message: string): Promise<void>;
}

/**
 * How many polls a single message may fail to save before it is skipped for
 * good. Three is a deliberate compromise: at the 5-minute poll cadence a genuine
 * transient that our classifier misreads still gets ~15 minutes to clear, while
 * a truly malformed newsletter blocks the mailbox for at most that long.
 */
export const MAX_SAVE_ATTEMPTS = 3;

/** Node/undici network faults — no HTTP status, but unambiguously "try again". */
const TRANSIENT_NET_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EPIPE",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_SOCKET",
]);

/**
 * Is this save failure the backend being unavailable (retry forever) rather than
 * the message being unsaveable (eventually skip)?
 *
 * The distinction is the whole safety of the poison-message guard: without it,
 * a Readeck outage would burn three attempts on the oldest unread message and
 * then DISCARD it. So an outage must be recognisable — 5xx/429/408 from the
 * adapter, or a socket-level failure with no response at all — and must not
 * count against the message.
 *
 * A 4xx (Readeck rejecting the payload) or any other error is treated as
 * possibly-poison. That is the deliberately conservative direction: an unknown
 * error still gets `MAX_SAVE_ATTEMPTS` polls, and the eventual skip is logged as
 * an error naming the message, so nothing disappears silently.
 */
export function isTransientSaveError(err: unknown): boolean {
  if (err instanceof BackendHttpError) {
    return err.status === 408 || err.status === 429 || err.status >= 500;
  }
  const codes = [err, err instanceof Error ? err.cause : undefined]
    .map((e) => (e && typeof e === "object" ? (e as { code?: unknown }).code : undefined))
    .filter((c): c is string => typeof c === "string");
  if (codes.some((c) => TRANSIENT_NET_CODES.has(c))) return true;
  // undici surfaces a dead host as a bare `TypeError: fetch failed` whose cause
  // carries the code; keep the message check as a backstop for the shapes that
  // do not.
  const message = err instanceof Error ? err.message : String(err);
  return /fetch failed|socket hang up|network error|other side closed/i.test(message);
}

export interface NewsletterIngestResult {
  saved: number;
  /** Dropped because the sender is on the exclude/ignore list. */
  skippedExcluded: number;
  /** Dropped because a document with this newsletter URL already exists. */
  skippedDuplicate: number;
  /**
   * Saved to Readeck, but indexing or the content copy failed. Non-fatal (the
   * next `pollReadeck` + `backfillReadeckContent` recover the row), but counted
   * and surfaced in the summary log line so it can never go unnoticed again.
   */
  degraded: number;
  /**
   * Abandoned after `MAX_SAVE_ATTEMPTS` failed saves — a poison message. The
   * cursor is advanced past it so one bad newsletter cannot wedge every future
   * ingest; each skip writes an error row naming the subject and sender.
   */
  skippedPoison: number;
}

/**
 * Save each parsed newsletter to Readeck, skipping senders the user excluded and
 * messages we have already ingested. The UID cursor advances after EACH message
 * we finish with (saved or skipped), so a crash mid-batch never reprocesses
 * settled mail.
 *
 * POISON MESSAGES ARE BOUNDED. A save error stops the run without advancing the
 * cursor — but only for `MAX_SAVE_ATTEMPTS` polls. Previously this was
 * unbounded: the failing UID was retried every 5 minutes forever, and each retry
 * re-downloaded and re-parsed the entire remaining mailbox before hitting the
 * same wall, which is the shape that produced 3049 error rows against a
 * 725-message mailbox. Now each non-transient failure increments a persisted
 * per-UID counter, and on the third the message is skipped for good with an
 * error row naming its subject and sender. A TRANSIENT failure (backend down —
 * see `isTransientSaveError`) does NOT count, so an outage never causes mail to
 * be discarded; it just retries as before.
 *
 * DEDUPE IS OURS, NOT READECK'S. Readeck's `POST /api/bookmarks` is not
 * idempotent — it mints a fresh bookmark id even for a URL it already holds, and
 * a document's identity is `readeck:<id>`, so a re-save lands on a NEW row and
 * strands the original's read state, tags, and delete tombstone. So before
 * saving we look the synthetic Message-ID URL up in our own index and skip it if
 * it is there, whether live or tombstoned (a deleted newsletter must STAY
 * deleted, not resurrect on the next replay). The lookup tries every form the URL
 * can be stored under (`newsletterUrlVariants`), because Readeck rewrites the URL
 * it is given — matching only the sent form is what made this check inert.
 *
 * This URL check is the SECOND line of defence, not the first. A UIDVALIDITY
 * reset no longer replays the mailbox at all — `EmailInbox.fetchNew` seeds past
 * the backlog and hands back zero messages (see `runEmailPoll`). What is left
 * here covers a message legitimately re-seen on the incremental path.
 *
 * ORDERING: INDEX BEFORE CONTENT. `document_content.document_id` is an FK to
 * `documents.id`, and the `documents` row for a new bookmark does not exist until
 * something indexes it. Writing content straight after `save()` therefore threw
 * an FK violation EVERY time (3049 error rows in production's ingestion_log; of
 * 225 email documents only 65 ever got content), and the try/catch swallowed it —
 * so newsletters silently fell back to Readeck's archived copy, whose `_resources`
 * image URLs mostly 404. We now read the new bookmark back, index it, and only
 * then store content. That also removes the up-to-5-minute wait for the next
 * `pollReadeck` before a newsletter appears in the library.
 *
 * KNOWN LIMITATION: a message with no Message-ID header falls back to a
 * UID-derived id (`<uid-N@mailbox>`, see `fromParsedMail`), so its synthetic URL
 * changes when UIDVALIDITY rotates and it will NOT dedupe across a reset. Such
 * mail is rare (essentially every real newsletter sets a Message-ID) and the
 * only fix is a content hash, which is out of scope here.
 */
export async function ingestNewsletters(
  messages: ParsedNewsletter[],
  deps: NewsletterIngestDeps,
): Promise<NewsletterIngestResult> {
  const result: NewsletterIngestResult = {
    saved: 0,
    skippedExcluded: 0,
    skippedDuplicate: 0,
    degraded: 0,
    skippedPoison: 0,
  };
  const failures = await deps.getFailures();
  let failuresChanged = false;
  const forget = (uid: number) => {
    if (failures[String(uid)] === undefined) return;
    delete failures[String(uid)];
    failuresChanged = true;
  };
  for (const msg of messages) {
    // Internal/system mail (e.g. server diagnostics) the user has excluded: drop
    // it but still advance the cursor so it isn't re-fetched on the next poll.
    if (isExcludedSender(msg, deps.excluded)) {
      result.skippedExcluded++;
      await deps.setCursor(msg.uid);
      continue;
    }
    // Already in the library (or deliberately deleted from it): don't re-save.
    // Same cursor treatment as an excluded sender — the message is settled.
    const existing = await deps.store.findByAnyUrl(newsletterUrlVariants(msg.messageId));
    if (existing) {
      result.skippedDuplicate++;
      await deps.setCursor(msg.uid);
      continue;
    }
    try {
      const sourceId = await deps.readLater.save(messageToSaveInput(msg));
      // Index first (the FK below depends on the row existing), then own the
      // newsletter's body ourselves (with the sender's real image URLs) so the
      // reader serves it instead of Readeck's archived copy — Readeck's newsletter
      // image archiving is unreliable (most `_resources` URLs 404), so we keep the
      // original URLs and let the image proxy fetch them at read time.
      //
      // Both steps are recoverable-if-failed but MUST NOT be silent: the bookmark
      // already exists, so we still advance the cursor (re-saving would mint a
      // duplicate), count the message as degraded, and log the real cause. The
      // next `pollReadeck` indexes the row and `backfillReadeckContent` fills the
      // content, so a failure here costs freshness, not data.
      try {
        const card = await deps.readLater.get(sourceId);
        await deps.store.upsertIndex(withEmailPublishedAt(card, msg));
        await deps.store.putContent(card.id, newsletterContentHtml(msg));
      } catch (indexErr) {
        result.degraded++;
        await deps.log("error", `uid ${msg.uid} index/content: ${describeError(indexErr)}`);
      }
      result.saved++;
      forget(msg.uid);
      await deps.setCursor(msg.uid);
    } catch (err) {
      const cause = describeError(err);
      // The backend is down, not the message: retry indefinitely, and do NOT
      // let the outage burn this message's attempt budget.
      if (isTransientSaveError(err)) {
        await deps.log("error", `uid ${msg.uid}: ${cause} (transient — will retry)`);
        break;
      }
      const attempts = (failures[String(msg.uid)] ?? 0) + 1;
      failures[String(msg.uid)] = attempts;
      failuresChanged = true;
      if (attempts >= MAX_SAVE_ATTEMPTS) {
        forget(msg.uid);
        result.skippedPoison++;
        await deps.log(
          "error",
          `uid ${msg.uid} SKIPPED after ${attempts} failed attempts and will NOT be ingested — ` +
            `"${msg.subject}" from ${msg.fromAddress || "unknown sender"}. Last error: ${cause}`,
        );
        await deps.setCursor(msg.uid);
        continue;
      }
      await deps.log(
        "error",
        `uid ${msg.uid}: ${cause} (attempt ${attempts} of ${MAX_SAVE_ATTEMPTS})`,
      );
      break;
    }
  }
  if (failuresChanged) await deps.setFailures(failures);
  return result;
}

/** Everything one newsletter poll touches, narrowed so tests can pass in-memory
 *  fakes instead of a live IMAP server, Readeck, and Postgres. */
export interface EmailPollDeps {
  inbox: { fetchNew(cursor: EmailCursor | null): Promise<EmailFetchResult> };
  store: NewsletterIngestDeps["store"];
  readLater: NewsletterIngestDeps["readLater"];
  excluded: ReadonlySet<string>;
  /** Read the raw stored cursor string (`"<uidvalidity>:<uid>"`), if any. */
  getCursor(): Promise<string | undefined>;
  /** Persist the raw cursor string. */
  setCursor(value: string): Promise<void>;
  getFailures: NewsletterIngestDeps["getFailures"];
  setFailures: NewsletterIngestDeps["setFailures"];
  log(status: string, message: string): Promise<void>;
}

/**
 * One newsletter poll: read the cursor, fetch, ingest, log. Split out from
 * `pollEmail` so the cold-start branch is testable without IMAP or a DB.
 *
 * COLD START. When there is no cursor (first ever run) or the mailbox's
 * UIDVALIDITY has changed (Proton Mail Bridge rotates it on restart; a host or
 * user change produces a different one), `fetchNew` returns zero messages and a
 * `coldStart` block. We then persist the seeded high-water mark and stop. This
 * is the fix for the full-mailbox sweep: the old code fell back to UID 0 and
 * ingested the entire back catalogue — one host switch pulled in 160 messages in
 * a single poll. The seed is logged explicitly so the reason nothing appeared is
 * visible in the ingestion log.
 *
 * Persisting the cursor on a zero-message poll is load-bearing: without it every
 * subsequent poll would cold-start again and never ingest anything.
 *
 * NOTHING HERE MAY THROW. Newsletter ingestion is optional and best-effort, and
 * it shares a process with the API, the reader and the RSS feeds. It previously
 * had no error handling at ALL around `fetchNew`: a TLS name-check failure at
 * connect time propagated straight out, and the accompanying unhandled `'error'`
 * event on the ImapFlow client (now fixed at its source in `EmailInbox`) took the
 * whole BFF down and left systemd restart-looping it. So every failure — a
 * connect rejection, an auth failure, a hung socket, a mid-fetch TLS error, or a
 * fault in ingestion itself — is caught, written to the ingestion log, and turned
 * into "this poll ingested 0". The next poll is five minutes away.
 */
export async function runEmailPoll(deps: EmailPollDeps): Promise<number> {
  try {
    return await runEmailPollOnce(deps);
  } catch (err) {
    // The log write is itself part of the failure surface (the glue DB may be
    // exactly what is broken), so it must not resurrect the throw it is
    // reporting.
    try {
      await deps.log("error", `newsletter poll failed: ${describeError(err)}`);
    } catch {
      // nothing left to report to; the poll still must not take the app down
    }
    return 0;
  }
}

async function runEmailPollOnce(deps: EmailPollDeps): Promise<number> {
  const cursor = parseEmailCursor(await deps.getCursor());
  // Connection-time faults are the ones that crashed production, and they are
  // worth naming distinctly: "the mail server is unreachable/untrusted" is a very
  // different operator action from "ingesting a message failed".
  let fetched: EmailFetchResult;
  try {
    fetched = await deps.inbox.fetchNew(cursor);
  } catch (err) {
    await deps.log("error", `imap connect/fetch failed: ${describeError(err)}`);
    return 0;
  }
  const { uidValidity, messages, coldStart } = fetched;

  if (coldStart) {
    await deps.setCursor(formatEmailCursor({ uidValidity, lastUid: coldStart.seededLastUid }));
    await deps.log(
      "ok",
      `cold start (${coldStart.reason}): seeded cursor to uid ${coldStart.seededLastUid}, ` +
        `skipped backlog of ${coldStart.backlogSize} messages — only mail arriving from now on is ingested ` +
        `(set IMAP_INGEST_BACKLOG=1 to import the back catalogue)`,
    );
    return 0;
  }

  const { saved, skippedExcluded, skippedDuplicate, degraded, skippedPoison } =
    await ingestNewsletters(messages, {
      store: deps.store,
      readLater: deps.readLater,
      excluded: deps.excluded,
      setCursor: (uid) => deps.setCursor(formatEmailCursor({ uidValidity, lastUid: uid })),
      getFailures: deps.getFailures,
      setFailures: deps.setFailures,
      log: deps.log,
    });
  const skips = [
    skippedDuplicate ? `${skippedDuplicate} duplicate` : "",
    skippedExcluded ? `${skippedExcluded} excluded sender` : "",
    skippedPoison ? `${skippedPoison} unsaveable` : "",
  ].filter(Boolean);
  // `degraded` and `skippedPoison` ride the SUMMARY line, not just a per-message
  // error row: a partially-failed ingest must be visible at a glance, since that
  // failure mode (content never landing) previously hid behind a swallowed
  // exception, and an abandoned message is mail the user will never see.
  await deps.log(
    degraded || skippedPoison ? "warn" : "ok",
    `saved ${saved} of ${messages.length}` +
      `${skips.length ? `, skipped ${skips.join(" + ")}` : ""}` +
      `${degraded ? `, ${degraded} without index/content copy` : ""}`,
  );
  return saved;
}

/**
 * Pull new newsletters from the dedicated IMAP mailbox and save each to Readeck
 * (with the `email` sentinel label) so they become first-class reader documents.
 * A no-op when IMAP isn't configured. Wires the real IMAP inbox, Readeck, and
 * glue DB into `runEmailPoll`; the poll policy (including the cold-start seed
 * that skips the back catalogue) lives there, and the per-message
 * save/skip/cursor policy in `ingestNewsletters`.
 */
export async function pollEmail(): Promise<number> {
  if (!config.IMAP_HOST) return 0;
  return exclusiveJob(QUEUE.pollEmail, 0, pollEmailOnce);
}

async function pollEmailOnce(): Promise<number> {
  const inbox = new EmailInbox({
    host: config.IMAP_HOST,
    port: config.IMAP_PORT,
    user: config.IMAP_USER,
    password: config.IMAP_PASSWORD,
    mailbox: config.IMAP_MAILBOX,
    secure: config.IMAP_SECURE !== "0",
    ingestBacklog: config.IMAP_INGEST_BACKLOG === "1",
  });
  const readLater = new ReadeckBackend({
    baseUrl: config.READECK_URL,
    apiToken: config.READECK_API_TOKEN,
  });
  // The exclude set is the static env list (addresses) UNION the user-managed
  // ignore list (names/addresses) stored in the glue DB, re-read every poll so a
  // Settings change takes effect on the next run without a restart.
  const store = new DrizzleOverlayStore(db);
  const excluded = parseExcludedSenders(config.IMAP_EXCLUDE_SENDERS);
  for (const s of await store.getEmailIgnoreList()) {
    const t = s.trim().toLowerCase();
    if (t) excluded.add(t);
  }
  return runEmailPoll({
    inbox,
    store,
    readLater,
    excluded,
    getCursor: () => getCursor("email"),
    setCursor: (value) => setCursor("email", value),
    getFailures: () => store.getEmailFailures(),
    setFailures: (f) => store.setEmailFailures(f),
    log: (status, message) => logIngestion("email", "poll", status, message),
  });
}

/** Drop RSS highlights whose owning document is no longer indexed. */
export async function reconcileOrphans(): Promise<void> {
  await db.execute(
    dsql`delete from rss_highlights where document_id not in (select id from documents)`,
  );
  await logIngestion("glue", "reconcile", "ok", "removed orphan rss_highlights");
}

// ---------------------------------------------------------------------------
// Deletion reconcile: tombstone index rows whose backend item is really gone
// ---------------------------------------------------------------------------

/** Whether a backend still holds an item. `unknown` means "the probe failed",
 *  which is emphatically NOT the same as "gone". */
export type BackendPresence = "present" | "missing" | "unknown";

/** Never tombstone more than this share of a source's live documents at once. */
export const DELETION_BLAST_RADIUS_FRACTION = 0.1;
/** ...but always allow at least this many, so a small library can still shrink. */
export const DELETION_BLAST_RADIUS_FLOOR = 25;
/** Hard stop on the enumeration walk, so a broken cursor cannot loop forever. */
const MAX_ENUMERATION_PAGES = 500;

/**
 * The most rows one reconcile pass may tombstone. Above this the enumeration is
 * treated as untrustworthy rather than as evidence of mass deletion.
 *
 * Genuine user deletions never arrive here: `deleteTargets` tombstones them
 * directly at delete time. So a pass proposing hundreds of deletions is a bug
 * signature (a truncated enumeration, a backend returning an empty list with a
 * 200), not a legitimate cleanup — and the failure is unrecoverable, because
 * `findByAnyUrl` deliberately ignores `deleted_at`, so a wrongly-tombstoned
 * newsletter answers "already seen" forever and is never re-ingested.
 */
export function deletionAllowance(liveCount: number): number {
  return Math.max(
    DELETION_BLAST_RADIUS_FLOOR,
    Math.ceil(liveCount * DELETION_BLAST_RADIUS_FRACTION),
  );
}

/** Everything one source's reconcile touches, narrowed so tests can drive it
 *  with in-memory fakes instead of live backends and Postgres. */
export interface DeletionReconcileDeps {
  /** Every id the backend currently holds. Throws if the walk is not trustworthy. */
  enumerate(): Promise<Set<string>>;
  /** Live (non-tombstoned) index rows for this source. */
  listLive(): Promise<{ id: string; sourceId: string }[]>;
  /** Per-item existence probe, run ONLY on would-be deletions. */
  probe(sourceId: string): Promise<BackendPresence>;
  softDelete(ids: string[]): Promise<void>;
  log(status: string, message: string): Promise<void>;
}

/**
 * Walk a backend's ids, defended against an enumeration that silently skips
 * items or never terminates.
 *
 * The skip is real and constant: `ReadeckBackend.list` hard-codes `sort:
 * "-updated"` and paginates by OFFSET, so any bookmark whose `updated` changes
 * mid-walk jumps to offset 0 and shifts every later item down by one — the walk
 * misses one. Something changes `updated` every few minutes (pollEmail creates
 * bookmarks, setReadingProgress PATCHes on every scroll), and reconcile runs
 * every 15. The skipped item was then absent from `present` and tombstoned with
 * no verification at all. That is why nothing here tombstones on the strength of
 * the enumeration alone any more — see `reconcileSourceDeletions`.
 *
 * A cursor that does not advance also aborts the walk. `ReadeckBackend.list`
 * computes `nextOffset = offset + body.length` and compares it against a
 * `total-count` header that becomes NaN if the header is absent or non-numeric;
 * `nextOffset < NaN` is false, so pagination silently stops after page one. An
 * empty page yields the same cursor twice, which we catch here.
 */
async function enumerateBackendIds(
  fetchPage: (
    cursor: string | undefined,
  ) => Promise<{ items: { id: string }[]; nextCursor: string | null }>,
): Promise<Set<string>> {
  const ids = new Set<string>();
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < MAX_ENUMERATION_PAGES; page++) {
    const { items, nextCursor } = await fetchPage(cursor);
    for (const item of items) ids.add(item.id);
    if (!nextCursor) return ids;
    if (seenCursors.has(nextCursor)) {
      throw new Error(`enumeration cursor did not advance (stuck at ${nextCursor})`);
    }
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }
  throw new Error(`enumeration exceeded ${MAX_ENUMERATION_PAGES} pages`);
}

/**
 * Tombstone one source's index rows whose backend item is really gone.
 *
 * Three defences, all of them load-bearing:
 *
 * 1. The enumeration is only ever used to NOMINATE candidates, never to delete.
 * 2. A blast-radius guard refuses the whole pass when the candidate set is
 *    implausibly large, and says so loudly instead of tombstoning.
 * 3. Every surviving candidate is re-verified with a direct per-item probe, and
 *    only a definite 404 is acted on. A probe that errors leaves the row alone.
 */
export async function reconcileSourceDeletions(
  source: string,
  deps: DeletionReconcileDeps,
): Promise<number> {
  const present = await deps.enumerate();
  const live = await deps.listLive();
  const candidates = live.filter((row) => !present.has(row.id));
  if (candidates.length === 0) {
    await deps.log("ok", `nothing missing (${live.length} live, ${present.size} at backend)`);
    return 0;
  }
  const allowance = deletionAllowance(live.length);
  if (candidates.length > allowance) {
    await deps.log(
      "error",
      `refusing to tombstone ${candidates.length} of ${live.length} ${source} documents in one ` +
        `pass (allowance ${allowance}); the backend enumeration returned only ${present.size} ids, ` +
        `which is not trustworthy. NO rows were touched — investigate before the next pass.`,
    );
    return 0;
  }

  const confirmed: string[] = [];
  let stillPresent = 0;
  let unverifiable = 0;
  const concurrency = 5;
  for (let i = 0; i < candidates.length; i += concurrency) {
    const batch = candidates.slice(i, i + concurrency);
    const results = await Promise.all(
      batch.map(async (row) => {
        try {
          return await deps.probe(row.sourceId);
        } catch {
          return "unknown" as const;
        }
      }),
    );
    results.forEach((presence, j) => {
      const row = batch[j]!;
      if (presence === "missing") confirmed.push(row.id);
      else if (presence === "present") stillPresent++;
      else unverifiable++;
    });
  }

  if (confirmed.length > 0) await deps.softDelete(confirmed);
  const notes = [
    stillPresent ? `${stillPresent} were still present (enumeration skipped them)` : "",
    unverifiable ? `${unverifiable} could not be verified and were left alone` : "",
  ].filter(Boolean);
  await deps.log(
    stillPresent || unverifiable ? "warn" : "ok",
    `tombstoned ${confirmed.length} of ${candidates.length} candidates` +
      `${notes.length ? `; ${notes.join(", ")}` : ""}`,
  );
  return confirmed.length;
}

/** A 404 means gone; anything else (including a network fault) means we do not
 *  know, and "do not know" must never become a tombstone. */
function presenceFromProbe(fetchOne: () => Promise<unknown>): Promise<BackendPresence> {
  return fetchOne().then(
    () => "present" as const,
    (err: unknown) =>
      err instanceof BackendHttpError && err.status === 404
        ? ("missing" as const)
        : ("unknown" as const),
  );
}

/**
 * Tombstone index rows whose backend item no longer exists (e.g. after a Readeck
 * dedup). A backend that errors is skipped — never mass-delete a source's
 * documents just because it was briefly unreachable. Single-flight, because a
 * pass overlapping a poll sees a moving target.
 */
export async function reconcileDeletions(): Promise<number> {
  return exclusiveJob(QUEUE.reconcileDeletions, 0, reconcileDeletionsOnce);
}

async function reconcileDeletionsOnce(): Promise<number> {
  const { rss, readLater, store } = backends();
  let removed = 0;
  for (const source of ["miniflux", "readeck"] as const) {
    const log = (status: string, message: string) =>
      logIngestion(source, "reconcile-deletions", status, message);
    try {
      removed += await reconcileSourceDeletions(source, {
        enumerate: () =>
          enumerateBackendIds((cursor) =>
            source === "miniflux"
              ? rss.listEntries({ cursor, pageSize: POLL_PAGE_SIZE })
              : readLater.list({ cursor, pageSize: POLL_PAGE_SIZE }),
          ),
        listLive: () => store.listLiveBySource(source),
        probe: (sourceId) =>
          source === "miniflux"
            ? presenceFromProbe(() => rss.getEntry(sourceId))
            : presenceFromProbe(() => readLater.get(sourceId)),
        softDelete: (ids) => store.softDelete(ids),
        log,
      });
    } catch (err) {
      await log("error", describeError(err));
    }
  }
  return removed;
}

/**
 * Capture article HTML into our own store for Readeck saves that lack it, so the
 * library owns full text (offline, fast, survives backend loss) and full-text
 * search has bodies to match. Bounded per run; only Readeck (the curated saves)
 * — feed bodies are captured lazily on read, never mass-fetched. Per-item
 * failures are skipped.
 */
export async function backfillReadeckContent(batch = 150): Promise<number> {
  // Single-flight: 150 sequential-ish article fetches can outlast pg-boss's
  // expiry, and an overlapping run just re-fetches the same rows.
  return exclusiveJob(QUEUE.backfillContent, 0, () => backfillReadeckContentOnce(batch));
}

async function backfillReadeckContentOnce(batch: number): Promise<number> {
  const { readLater, store } = backends();
  const rows = (await db.execute(dsql`
    select d.id as id, d.source_id as source_id
    from documents d
    left join document_content c on c.document_id = d.id
    where d.source = 'readeck' and d.deleted_at is null and c.document_id is null
    limit ${batch}
  `)) as unknown as Array<{ id: string; source_id: string }>;
  let stored = 0;
  const conc = 4;
  for (let i = 0; i < rows.length; i += conc) {
    await Promise.allSettled(
      rows.slice(i, i + conc).map(async (r) => {
        const html = await readLater.getContent(r.source_id);
        await store.putContent(r.id, html);
        stored += 1;
      }),
    );
  }
  await logIngestion("readeck", "backfill-content", "ok", `stored ${stored} of ${rows.length}`);
  return stored;
}

// ---------------------------------------------------------------------------
// ingestion_log retention
// ---------------------------------------------------------------------------

/**
 * Retention policy for `ingestion_log`, which until now had none at all — no
 * DELETE, no TTL, no rotation. Every poll writes an "ok" row (email, miniflux
 * and readeck every 5 minutes, reconcile every 15, backfill every 10, orphans
 * hourly), roughly 900 rows a day, forever. Capping message WIDTH bounded the
 * damage per row; this bounds the COUNT.
 *
 * The asymmetry is deliberate. An "ok" row carries no information a week later —
 * it exists to answer "is ingestion alive?", which only the recent ones can. An
 * error row is the diagnostic record of a real failure and is worth a quarter:
 * the newsletter FK violation ran unnoticed for months, and a short error TTL
 * would have erased the evidence that finally explained it.
 *
 * `maxRows` is the backstop against a pathological error storm (the incident
 * that produced 3049 error rows in a day would otherwise be retained in full for
 * 90 days). Deleting in bounded batches — and capping the batches per run — keeps
 * the prune itself short, so it can never become the long-running job that trips
 * the overlap problem it shares a file with.
 */
export const LOG_RETENTION = {
  okDays: 7,
  errorDays: 90,
  maxRows: 50_000,
  batchSize: 5_000,
  maxBatches: 20,
} as const;

export interface LogPruneDeps {
  /** Delete up to `limit` rows of this kind older than `before`; returns the count. */
  deleteOlderThan(kind: "ok" | "other", before: Date, limit: number): Promise<number>;
  /** Delete up to `limit` rows beyond the newest `maxRows`; returns the count. */
  deleteBeyondRowCap(maxRows: number, limit: number): Promise<number>;
  log(status: string, message: string): Promise<void>;
}

function daysBefore(now: Date, days: number): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

/** Apply `LOG_RETENTION` in bounded batches. Returns the rows removed. */
export async function pruneIngestionLog(deps: LogPruneDeps, now = new Date()): Promise<number> {
  const { batchSize, maxBatches } = LOG_RETENTION;
  const phases: Array<() => Promise<number>> = [
    () => deps.deleteOlderThan("ok", daysBefore(now, LOG_RETENTION.okDays), batchSize),
    () => deps.deleteOlderThan("other", daysBefore(now, LOG_RETENTION.errorDays), batchSize),
    () => deps.deleteBeyondRowCap(LOG_RETENTION.maxRows, batchSize),
  ];
  let removed = 0;
  for (const phase of phases) {
    for (let batch = 0; batch < maxBatches; batch++) {
      const n = await phase();
      removed += n;
      // A short batch means the phase is drained; a full one means keep going,
      // but only up to maxBatches so one run stays bounded.
      if (n < batchSize) break;
    }
  }
  await deps.log("ok", `pruned ${removed} ingestion_log rows`);
  return removed;
}

/** Wire the retention policy to the glue DB. `ctid`-keyed deletes so each batch
 *  touches exactly `limit` rows without a sort over the whole table. */
export async function pruneIngestionLogJob(): Promise<number> {
  return exclusiveJob(QUEUE.pruneLogs, 0, () =>
    pruneIngestionLog({
      deleteOlderThan: async (kind, before, limit) => {
        const statusFilter =
          kind === "ok" ? dsql`status = 'ok'` : dsql`status is distinct from 'ok'`;
        const rows = await db.execute(dsql`
          delete from ingestion_log where ctid in (
            select ctid from ingestion_log
            where ${statusFilter} and created_at < ${before.toISOString()}
            limit ${limit}
          ) returning id`);
        return (rows as unknown as unknown[]).length;
      },
      deleteBeyondRowCap: async (maxRows, limit) => {
        const rows = await db.execute(dsql`
          delete from ingestion_log where ctid in (
            select ctid from ingestion_log order by id desc offset ${maxRows} limit ${limit}
          ) returning id`);
        return (rows as unknown as unknown[]).length;
      },
      log: (status, message) => logIngestion("glue", "prune-log", status, message),
    }),
  );
}

/**
 * Queue options for every Lectern job. `createQueue` alone is not enough:
 *
 * - `expireInSeconds` — pg-boss defaults to 900 (15 min), after which
 *   `failJobsByTimeout` fails the job and re-queues it WHILE THE ORIGINAL
 *   HANDLER IS STILL RUNNING. Our polls routinely exceed that (a 725-message
 *   newsletter mailbox is roughly an hour at `ReadeckBackend.save`'s pace), so
 *   the expiry is raised to four hours to match realistic runtime.
 * - `retryLimit: 0` — a poll is scheduled again in 5 minutes anyway. A retry
 *   buys nothing and, before the advisory lock, was the mechanism that put two
 *   handlers on the same cursor.
 * - `policy: "singleton"` — at most one active job per queue. Belt to the
 *   advisory lock's braces, and only effective on FRESH installs; see below.
 */
const QUEUE_OPTIONS = {
  policy: "singleton",
  expireInSeconds: 4 * 60 * 60,
  retryLimit: 0,
} as const;

/**
 * Create the queue with our options and, if it already exists, force the
 * mutable ones onto it.
 *
 * Both halves are needed. pg-boss's `create_queue` inserts `ON CONFLICT DO
 * NOTHING`, so on an existing deployment `createQueue(name, options)` is a
 * no-op and the queue keeps the 15-minute expiry it was born with. `updateQueue`
 * fixes that — except for `policy`, which pg-boss refuses to change after
 * creation. So an upgraded install gets the corrected expiry and retry limit but
 * keeps `standard` policy, and its only protection against overlap is the
 * advisory lock in `runExclusively`. That is by design: the lock, not the queue
 * policy, is what this fix rests on.
 */
async function ensureQueue(instance: PgBoss, name: string): Promise<void> {
  await instance.createQueue(name, { ...QUEUE_OPTIONS });
  // `policy` is deliberately omitted: pg-boss throws if you try to change it.
  await instance.updateQueue(name, {
    expireInSeconds: QUEUE_OPTIONS.expireInSeconds,
    retryLimit: QUEUE_OPTIONS.retryLimit,
  });
}

/**
 * Start the pg-boss instance, register workers, and schedule the poll +
 * reconcile jobs. Idempotent registration via `createQueue`. Returns the boss
 * so callers can inspect/stop it.
 */
export async function startJobs(): Promise<PgBoss> {
  if (boss) return boss;
  const instance = new PgBoss(config.DATABASE_URL);
  // Same crash class as the ImapFlow one, and a livelier one: PgBoss is an
  // EventEmitter that promotes 'error' from its manager, maintenance and cron
  // timers, and its internally-owned `pg` pool re-emits idle-client errors the
  // same way. All of those fire on ordinary database churn (a Postgres restart,
  // an idle-connection reset), and an 'error' emit with no listener throws out
  // of a timer callback — an uncaughtException that no `await` can catch. One
  // listener turns a routine DB blip from "the BFF exits 1" into a log line.
  instance.on("error", (err: unknown) => {
    console.error("[jobs] pg-boss error:", describeError(err));
  });
  await instance.start();
  for (const name of Object.values(QUEUE)) await ensureQueue(instance, name);

  await instance.work(QUEUE.pollMiniflux, async () => {
    await pollMiniflux();
  });
  await instance.work(QUEUE.pollReadeck, async () => {
    await pollReadeck();
  });
  if (config.LECTERN_ENABLE_EMAIL && config.IMAP_HOST) {
    await instance.work(QUEUE.pollEmail, async () => {
      await pollEmail();
    });
  }
  await instance.work(QUEUE.reconcile, async () => {
    await reconcileOrphans();
  });
  await instance.work(QUEUE.reconcileDeletions, async () => {
    await reconcileDeletions();
  });
  await instance.work(QUEUE.backfillContent, async () => {
    await backfillReadeckContent();
  });
  await instance.work(QUEUE.pruneLogs, async () => {
    await pruneIngestionLogJob();
  });

  await instance.schedule(QUEUE.pollMiniflux, "*/5 * * * *");
  await instance.schedule(QUEUE.pollReadeck, "*/5 * * * *");
  if (config.LECTERN_ENABLE_EMAIL && config.IMAP_HOST) {
    await instance.schedule(QUEUE.pollEmail, "*/5 * * * *");
  }
  await instance.schedule(QUEUE.reconcile, "0 * * * *");
  await instance.schedule(QUEUE.reconcileDeletions, "*/15 * * * *");
  await instance.schedule(QUEUE.backfillContent, "*/10 * * * *");
  // Daily, off-peak. Retention is time-based, so the exact minute is irrelevant;
  // running it once a day keeps each prune's batch count small.
  await instance.schedule(QUEUE.pruneLogs, "23 3 * * *");

  boss = instance;
  return instance;
}

export async function stopJobs(): Promise<void> {
  if (!boss) return;
  await boss.stop();
  boss = null;
}
