import { PgBoss } from "pg-boss";
import { eq, sql as dsql } from "drizzle-orm";
import { config, pushEnabled } from "./config";
import { db } from "./db/client";
import { getFeedPref, sendPush } from "./push";
import { ingestionLog, syncCursors } from "./db/schema";
import { MinifluxBackend } from "./backends/miniflux";
import { ReadeckBackend } from "./backends/readeck";
import {
  EmailInbox,
  formatEmailCursor,
  isExcludedSender,
  messageToSaveInput,
  parseEmailCursor,
  parseExcludedSenders,
} from "./backends/email-inbox";
import { DrizzleOverlayStore } from "./overlay-store";

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
} as const;

const POLL_PAGE_SIZE = 100;

let boss: PgBoss | null = null;

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

async function setCursor(source: string, cursor: string): Promise<void> {
  await db
    .insert(syncCursors)
    .values({ source, cursor })
    .onConflictDoUpdate({ target: syncCursors.source, set: { cursor, updatedAt: new Date() } });
}

async function logIngestion(
  source: string,
  action: string,
  status: string,
  message: string,
): Promise<void> {
  await db.insert(ingestionLog).values({ source, action, status, message });
}

/** Walk MiniFlux's `changed_after` delta into the glue index; advance the cursor. */
export async function pollMiniflux(): Promise<number> {
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

/** Walk Readeck's `updated_since` delta into the glue index; advance the cursor. */
export async function pollReadeck(): Promise<number> {
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

/**
 * Pull new newsletters from the dedicated IMAP mailbox and save each to Readeck
 * (with the `email` sentinel label) so they become first-class reader documents.
 * A no-op when IMAP isn't configured. The UID cursor advances after EACH
 * successful save, so a crash mid-batch never reprocesses saved mail; on the
 * first save error we stop (leaving that message for the next run) rather than
 * skipping past it. Readeck dedupes by the synthetic Message-ID URL, so any
 * replay is idempotent.
 */
export async function pollEmail(): Promise<number> {
  if (!config.IMAP_HOST) return 0;
  const inbox = new EmailInbox({
    host: config.IMAP_HOST,
    port: config.IMAP_PORT,
    user: config.IMAP_USER,
    password: config.IMAP_PASSWORD,
    mailbox: config.IMAP_MAILBOX,
    secure: config.IMAP_SECURE !== "0",
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
  const cursor = parseEmailCursor(await getCursor("email"));
  const { uidValidity, messages } = await inbox.fetchNew(cursor);
  let saved = 0;
  let skipped = 0;
  for (const msg of messages) {
    // Internal/system mail (e.g. server diagnostics) the user has excluded: drop
    // it but still advance the cursor so it isn't re-fetched on the next poll.
    if (isExcludedSender(msg, excluded)) {
      skipped++;
      await setCursor("email", formatEmailCursor({ uidValidity, lastUid: msg.uid }));
      continue;
    }
    try {
      await readLater.save(messageToSaveInput(msg));
      saved++;
      await setCursor("email", formatEmailCursor({ uidValidity, lastUid: msg.uid }));
    } catch (err) {
      await logIngestion(
        "email",
        "poll",
        "error",
        `uid ${msg.uid}: ${err instanceof Error ? err.message : String(err)}`,
      );
      break;
    }
  }
  await logIngestion(
    "email",
    "poll",
    "ok",
    `saved ${saved} of ${messages.length}${skipped ? `, skipped ${skipped}` : ""}`,
  );
  return saved;
}

/** Drop RSS highlights whose owning document is no longer indexed. */
export async function reconcileOrphans(): Promise<void> {
  await db.execute(
    dsql`delete from rss_highlights where document_id not in (select id from documents)`,
  );
  await logIngestion("glue", "reconcile", "ok", "removed orphan rss_highlights");
}

/**
 * Tombstone index rows whose backend item no longer exists (e.g. after a Readeck
 * dedup). Lists every id from each backend and soft-deletes index rows for that
 * source not in the set. A backend that errors is skipped — never mass-delete a
 * source's documents just because it was briefly unreachable.
 */
export async function reconcileDeletions(): Promise<number> {
  const { rss, readLater, store } = backends();
  let removed = 0;
  for (const source of ["miniflux", "readeck"] as const) {
    try {
      const present = new Set<string>();
      let cursor: string | null | undefined;
      do {
        const page =
          source === "miniflux"
            ? await rss.listEntries({ cursor: cursor ?? undefined, pageSize: POLL_PAGE_SIZE })
            : await readLater.list({ cursor: cursor ?? undefined, pageSize: POLL_PAGE_SIZE });
        for (const card of page.items) present.add(card.id);
        cursor = page.nextCursor;
      } while (cursor);
      const n = await store.softDeleteMissing(source, present);
      removed += n;
      await logIngestion(source, "reconcile-deletions", "ok", `tombstoned ${n} missing`);
    } catch (err) {
      await logIngestion(
        source,
        "reconcile-deletions",
        "error",
        err instanceof Error ? err.message : String(err),
      );
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

/**
 * Start the pg-boss instance, register workers, and schedule the poll +
 * reconcile jobs. Idempotent registration via `createQueue`. Returns the boss
 * so callers can inspect/stop it.
 */
export async function startJobs(): Promise<PgBoss> {
  if (boss) return boss;
  const instance = new PgBoss(config.DATABASE_URL);
  await instance.start();
  for (const name of Object.values(QUEUE)) await instance.createQueue(name);

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

  await instance.schedule(QUEUE.pollMiniflux, "*/5 * * * *");
  await instance.schedule(QUEUE.pollReadeck, "*/5 * * * *");
  if (config.LECTERN_ENABLE_EMAIL && config.IMAP_HOST) {
    await instance.schedule(QUEUE.pollEmail, "*/5 * * * *");
  }
  await instance.schedule(QUEUE.reconcile, "0 * * * *");
  await instance.schedule(QUEUE.reconcileDeletions, "*/15 * * * *");
  await instance.schedule(QUEUE.backfillContent, "*/10 * * * *");

  boss = instance;
  return instance;
}

export async function stopJobs(): Promise<void> {
  if (!boss) return;
  await boss.stop();
  boss = null;
}
