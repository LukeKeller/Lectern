import { PgBoss } from "pg-boss";
import { eq, sql as dsql } from "drizzle-orm";
import { config } from "./config";
import { db } from "./db/client";
import { ingestionLog, syncCursors } from "./db/schema";
import { MinifluxBackend } from "./backends/miniflux";
import { ReadeckBackend } from "./backends/readeck";
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
  reconcile: "orphan-reconcile",
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

/** Drop RSS highlights whose owning document is no longer indexed. */
export async function reconcileOrphans(): Promise<void> {
  await db.execute(
    dsql`delete from rss_highlights where document_id not in (select id from documents)`,
  );
  await logIngestion("glue", "reconcile", "ok", "removed orphan rss_highlights");
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
  await instance.work(QUEUE.reconcile, async () => {
    await reconcileOrphans();
  });

  await instance.schedule(QUEUE.pollMiniflux, "*/5 * * * *");
  await instance.schedule(QUEUE.pollReadeck, "*/5 * * * *");
  await instance.schedule(QUEUE.reconcile, "0 * * * *");

  boss = instance;
  return instance;
}

export async function stopJobs(): Promise<void> {
  if (!boss) return;
  await boss.stop();
  boss = null;
}
