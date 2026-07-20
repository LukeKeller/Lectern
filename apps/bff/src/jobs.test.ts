import { describe, expect, it } from "vitest";
import { Card } from "@lectern/shared";
import {
  DELETION_BLAST_RADIUS_FLOOR,
  LOG_RETENTION,
  MAX_SAVE_ATTEMPTS,
  SKIPPED,
  advisoryLockKey,
  deletionAllowance,
  describeError,
  ingestNewsletters,
  isCursorAdvance,
  isTransientSaveError,
  pruneIngestionLog,
  reconcileSourceDeletions,
  runEmailPoll,
  runExclusively,
  truncateLogMessage,
  type AdvisoryLock,
  type BackendPresence,
  type DeletionReconcileDeps,
  type EmailPollDeps,
  type LogPruneDeps,
  type NewsletterIngestDeps,
  type NewsletterIngestResult,
} from "./jobs";
import { BackendHttpError } from "./errors";
import {
  buildReadeckHtml,
  formatEmailCursor,
  newsletterUrl,
  newsletterUrlVariants,
  parseExcludedSenders,
  resolveFetchPlan,
  type EmailFetchResult,
  type ParsedNewsletter,
} from "./backends/email-inbox";
import type { IndexedUrlMatch } from "./unify";

/**
 * Regression cover for the newsletter re-import bug, on both layers.
 *
 * Layer 1 (`resolveFetchPlan` / `runEmailPoll`): don't fetch the backlog at all.
 * Proton Mail Bridge rotates UIDVALIDITY on every restart and an IMAP host/user
 * change yields a different one; the old code fell back to UID 0 on both, which
 * means "ingest the entire mailbox" — one host switch swept in 160 messages of
 * back catalogue. Now a cold start seeds the cursor past the backlog.
 *
 * Layer 2 (`ingestNewsletters`): if a message IS re-seen, don't re-save it.
 * Readeck does not dedupe (its POST /api/bookmarks mints a new id for a URL it
 * already holds), so the replay must be stopped here, by URL, before the save.
 */

function msg(overrides: Partial<ParsedNewsletter> = {}): ParsedNewsletter {
  return {
    uid: 7,
    messageId: "<abc123@mail.example.com>",
    subject: "Weekly Roundup",
    fromName: "The Daily Byte",
    fromAddress: "hello@dailybyte.com",
    html: "<html><body><p>Hi there</p></body></html>",
    ...overrides,
  };
}

const cardFixture = {
  id: "readeck:100",
  source: "readeck",
  sourceId: "100",
  category: "email",
  location: "inbox",
  readState: "unopened",
  title: "Weekly Roundup",
  author: "The Daily Byte",
  siteName: null,
  url: "https://newsletter.lectern.local/abc123@mail.example.com",
  wordCount: null,
  readingTimeMinutes: null,
  readingProgress: 0,
  readAnchor: null,
  tags: [],
  highlightCount: 0,
  note: null,
  publishedAt: null,
  savedAt: "2026-07-19T00:00:00Z",
  updatedAt: "2026-07-19T00:00:00Z",
};

/**
 * Readeck normalizes the URL it is handed before storing the bookmark: escapes
 * that are unnecessary in a path segment get decoded, so `%40` becomes a literal
 * `@`. This asymmetry between what we POST and what comes back is what made the
 * URL dedupe inert in production.
 */
function readeckNormalizeUrl(url: string): string {
  return url.replace(/%40/g, "@");
}

/**
 * A drizzle-shaped query failure: the giant SQL + bound parameters live on
 * `message`, the real Postgres cause (with its SQLSTATE) on `cause`.
 */
function drizzleError(query: string, code: string, causeMessage: string): Error {
  const cause = Object.assign(new Error(causeMessage), { code });
  return Object.assign(new Error(`Failed query: ${query}`), { cause });
}

/**
 * In-memory stand-ins for the glue store and Readeck (no DB, no network).
 * `seed` pre-populates the URL index the way a prior successful ingest would;
 * `deleted: true` models a newsletter the user has since deleted (tombstoned).
 */
function deps(seed: { url: string; id: string; deleted: boolean }[] = []) {
  const index = new Map<string, IndexedUrlMatch>(
    seed.map((s) => [s.url, { id: s.id, deleted: s.deleted }]),
  );
  const saved: string[] = [];
  const content: string[] = [];
  const indexed: Card[] = [];
  const cursors: number[] = [];
  const logs: { status: string; message: string }[] = [];
  // The persisted per-UID failure counters, modelled as a plain object the same
  // way app_settings stores them.
  let failures: Record<string, number> = {};
  // Models Readeck's URL normalization: it decodes %40 back to a literal @
  // before storing the bookmark, so the url we POST is NOT the url we get back.
  const savedUrlById = new Map<string, string>();
  // Rows that exist in the fake `documents` table. `putContent` enforces the real
  // FK (document_content.document_id -> documents.id) so the ordering bug that
  // shipped — content written before the row existed — actually fails here.
  const documentRows = new Set<string>(seed.map((s) => s.id));
  let nextId = 100;
  const d: NewsletterIngestDeps = {
    store: {
      findByAnyUrl: async (urls) => {
        for (const url of urls) {
          const hit = index.get(url);
          if (hit) return hit;
        }
        return null;
      },
      upsertIndex: async (card) => {
        indexed.push(card);
        documentRows.add(card.id);
        index.set(card.url ?? "", { id: card.id, deleted: false });
      },
      putContent: async (id, html) => {
        if (!documentRows.has(id)) {
          // What Postgres actually raises, wrapped the way drizzle wraps it.
          throw drizzleError(
            `insert into "document_content" ... ${html}`,
            "23503",
            'insert or update on table "document_content" violates foreign key constraint "document_content_document_id_fkey"',
          );
        }
        content.push(id);
      },
    },
    readLater: {
      save: async (input) => {
        const id = String(nextId++);
        saved.push(input.url);
        savedUrlById.set(id, readeckNormalizeUrl(input.url));
        return id;
      },
      get: async (sourceId) =>
        Card.parse({
          ...cardFixture,
          id: `readeck:${sourceId}`,
          sourceId,
          url: savedUrlById.get(sourceId) ?? "https://newsletter.lectern.local/unknown",
        }),
    },
    excluded: parseExcludedSenders("diagnosis@digitallyadrift.com"),
    setCursor: async (uid) => {
      cursors.push(uid);
    },
    getFailures: async () => ({ ...failures }),
    setFailures: async (next) => {
      failures = { ...next };
    },
    log: async (status, message) => {
      logs.push({ status, message });
    },
  };
  return {
    deps: d,
    saved,
    content,
    indexed,
    cursors,
    logs,
    documentRows,
    failures: () => failures,
    seedFailures: (f: Record<string, number>) => {
      failures = { ...f };
    },
  };
}

/** The zero result, so a test only has to name the fields it cares about. */
function outcome(overrides: Partial<NewsletterIngestResult> = {}): NewsletterIngestResult {
  return {
    saved: 0,
    skippedExcluded: 0,
    skippedDuplicate: 0,
    degraded: 0,
    skippedPoison: 0,
    ...overrides,
  };
}

describe("ingestNewsletters", () => {
  it("saves a genuinely new message and advances the cursor", async () => {
    const t = deps();
    const result = await ingestNewsletters([msg()], t.deps);

    expect(result).toEqual(outcome({ saved: 1 }));
    expect(t.saved).toEqual([newsletterUrl("<abc123@mail.example.com>")]);
    expect(t.content).toEqual(["readeck:100"]);
    expect(t.cursors).toEqual([7]);
  });

  it("does not re-save a replayed message whose document already exists", async () => {
    // Same Message-ID as a message we ingested before, arriving under a fresh UID
    // after a UIDVALIDITY rotation.
    const url = newsletterUrl("<abc123@mail.example.com>");
    const t = deps([{ url, id: "readeck:42", deleted: false }]);

    const result = await ingestNewsletters([msg({ uid: 1 })], t.deps);

    expect(result).toEqual(outcome({ skippedDuplicate: 1 }));
    expect(t.saved).toEqual([]);
    // The message is settled, so the cursor still moves past it.
    expect(t.cursors).toEqual([1]);
  });

  it("does not re-save a replayed message whose document is soft-deleted", async () => {
    // The delete must be sticky: a tombstoned row still means "already seen",
    // otherwise the next Bridge restart resurrects everything the user deleted.
    const url = newsletterUrl("<abc123@mail.example.com>");
    const t = deps([{ url, id: "readeck:42", deleted: true }]);

    const result = await ingestNewsletters([msg({ uid: 1 })], t.deps);

    expect(result).toEqual(outcome({ skippedDuplicate: 1 }));
    expect(t.saved).toEqual([]);
    expect(t.cursors).toEqual([1]);
  });

  it("dedupes within a single batch (same Message-ID twice)", async () => {
    const t = deps();
    const result = await ingestNewsletters([msg({ uid: 1 }), msg({ uid: 2 })], t.deps);

    expect(result).toEqual(outcome({ saved: 1, skippedDuplicate: 1 }));
    expect(t.saved).toHaveLength(1);
    expect(t.cursors).toEqual([1, 2]);
  });

  it("distinguishes excluded-sender skips from duplicate skips", async () => {
    const url = newsletterUrl("<dupe@mail.example.com>");
    const t = deps([{ url, id: "readeck:9", deleted: false }]);

    const result = await ingestNewsletters(
      [
        msg({ uid: 1, fromAddress: "Diagnosis@DigitallyAdrift.com" }),
        msg({ uid: 2, messageId: "<dupe@mail.example.com>" }),
        msg({ uid: 3, messageId: "<fresh@mail.example.com>" }),
      ],
      t.deps,
    );

    expect(result).toEqual(outcome({ saved: 1, skippedExcluded: 1, skippedDuplicate: 1 }));
    expect(t.saved).toEqual([newsletterUrl("<fresh@mail.example.com>")]);
    expect(t.cursors).toEqual([1, 2, 3]);
  });

  it("distinct Message-IDs are saved independently", async () => {
    const t = deps();
    const result = await ingestNewsletters(
      [msg({ uid: 1, messageId: "<one@x.com>" }), msg({ uid: 2, messageId: "<two@x.com>" })],
      t.deps,
    );

    expect(result).toEqual(outcome({ saved: 2 }));
    expect(t.saved).toEqual([newsletterUrl("<one@x.com>"), newsletterUrl("<two@x.com>")]);
  });

  it("stops at the first save error without advancing past it", async () => {
    const t = deps();
    t.deps.readLater.save = async () => {
      throw new Error("readeck rejected the payload");
    };

    const result = await ingestNewsletters([msg({ uid: 1 }), msg({ uid: 2 })], t.deps);

    expect(result).toEqual(outcome());
    expect(t.cursors).toEqual([]);
    expect(t.logs).toEqual([
      { status: "error", message: "uid 1: readeck rejected the payload (attempt 1 of 3)" },
    ]);
  });

  it("a content-store failure still counts the save, advances the cursor, and is visible", async () => {
    const t = deps();
    t.deps.store.putContent = async () => {
      throw new Error("pg down");
    };

    const result = await ingestNewsletters([msg({ uid: 5 })], t.deps);

    // The bookmark exists, so the message is settled — but the shortfall is
    // COUNTED, not swallowed. That silence is what hid the FK bug for months.
    expect(result).toEqual(outcome({ saved: 1, degraded: 1 }));
    expect(t.cursors).toEqual([5]);
    expect(t.logs[0]?.status).toBe("error");
    expect(t.logs[0]?.message).toContain("pg down");
  });
});

describe("newsletter content ordering (the document_content FK)", () => {
  it("indexes the document BEFORE writing content, so the FK is satisfied", async () => {
    // The shipped bug: putContent ran straight after readLater.save(), when no
    // `documents` row existed for readeck:<id> yet (pollReadeck creates it, up to
    // 5 minutes later), so the insert violated
    // document_content_document_id_fkey EVERY time and was swallowed as
    // "best-effort" — leaving newsletters on Readeck's archived copy, whose
    // image URLs mostly 404.
    const t = deps();

    const result = await ingestNewsletters([msg()], t.deps);

    expect(result.saved).toBe(1);
    expect(result.degraded).toBe(0);
    // The row was created first...
    expect(t.indexed.map((c) => c.id)).toEqual(["readeck:100"]);
    // ...so the content write landed instead of throwing.
    expect(t.content).toEqual(["readeck:100"]);
  });

  it("the fake really does enforce the FK (the old ordering would fail)", async () => {
    // Guards the guard: if `putContent` accepted unknown ids, the test above
    // would pass against the broken ordering too.
    const t = deps();
    await expect(t.deps.store.putContent("readeck:999", "<p>body</p>")).rejects.toThrow(
      /Failed query/,
    );
  });

  it("carries the email's Date header onto the indexed card's publishedAt", async () => {
    // Every production email row has a NULL publishedAt, so newsletters sort by
    // savedAt and a batch ingest makes "most recent issues" unanswerable.
    const t = deps();

    await ingestNewsletters([msg({ date: "2026-07-07T17:06:48.000Z" })], t.deps);

    expect(t.indexed[0]?.publishedAt).toBe("2026-07-07T17:06:48.000Z");
  });

  it("does not invent a publishedAt when the mail has no Date header", async () => {
    const t = deps();

    await ingestNewsletters([msg()], t.deps);

    expect(t.indexed[0]?.publishedAt).toBeNull();
  });
});

describe("dedupe survives Readeck's URL normalization", () => {
  it("matches a stored row holding a literal @ when the key is percent-encoded", async () => {
    // THE BUG THAT SHIPPED. We looked up `...%40mail.example.com`; Readeck had
    // stored `...@mail.example.com`. Exact equality never matched, so of 225
    // production email rows, 0 ever deduped and replays re-imported everything.
    const stored = `https://newsletter.lectern.local/abc123@mail.example.com`;
    const t = deps([{ url: stored, id: "readeck:42", deleted: false }]);

    const result = await ingestNewsletters([msg({ uid: 1 })], t.deps);

    expect(result.skippedDuplicate).toBe(1);
    expect(result.saved).toBe(0);
    expect(t.saved).toEqual([]);
  });

  it("matches a legacy row stored in the percent-encoded form", async () => {
    // Rows written before Readeck normalized (or by any other path) must still
    // dedupe — which is why the lookup matches a SET of forms, not one.
    const t = deps([
      { url: newsletterUrl("<abc123@mail.example.com>"), id: "readeck:42", deleted: false },
    ]);

    const result = await ingestNewsletters([msg({ uid: 1 })], t.deps);

    expect(result.skippedDuplicate).toBe(1);
    expect(t.saved).toEqual([]);
  });

  it("a newsletter saved this run is not re-saved later in the same run", async () => {
    // End to end through the normalization: save POSTs the %40 form, the fake
    // Readeck hands back the literal-@ form, we index THAT, and the second copy
    // must still be recognised.
    const t = deps();

    const result = await ingestNewsletters([msg({ uid: 1 }), msg({ uid: 2 })], t.deps);

    expect(result).toEqual(outcome({ saved: 1, skippedDuplicate: 1 }));
  });
});

describe("newsletterUrlVariants", () => {
  it("offers both the sent (%40) and the stored (@) form", () => {
    expect(newsletterUrlVariants("<abc@x.com>")).toEqual([
      "https://newsletter.lectern.local/abc%40x.com",
      "https://newsletter.lectern.local/abc@x.com",
    ]);
  });

  it("includes the form newsletterUrl actually POSTs to Readeck", () => {
    expect(newsletterUrlVariants("<abc@x.com>")).toContain(newsletterUrl("<abc@x.com>"));
  });

  it("decodes only escapes that are legal unencoded in a path segment", () => {
    // `/`, `?`, `#` and `%` change a URL's structure, so no normalizer decodes
    // them and neither do we — decoding them would produce a URL that means
    // something different from the one we sent.
    const variants = newsletterUrlVariants("<a/b?c#d@x.com>");
    expect(variants.every((v) => v.includes("%2F"))).toBe(true);
    expect(variants.every((v) => v.includes("%3F"))).toBe(true);
    expect(variants.every((v) => v.includes("%23"))).toBe(true);
  });

  it("collapses to a single form when nothing is escapable", () => {
    expect(newsletterUrlVariants("<plain-id>")).toEqual([
      "https://newsletter.lectern.local/plain-id",
    ]);
  });
});

describe("buildReadeckHtml (the publication date round trip)", () => {
  it("emits the send date in the forms an extractor looks for", () => {
    const html = buildReadeckHtml(msg({ date: "2026-07-07T17:06:48.000Z" }));

    expect(html).toContain(
      '<meta property="article:published_time" content="2026-07-07T17:06:48.000Z">',
    );
    expect(html).toContain('<meta name="date" content="2026-07-07T17:06:48.000Z">');
    // Inside <article>, so it survives readability extraction stripping <head>.
    expect(html).toContain('<time datetime="2026-07-07T17:06:48.000Z" hidden></time>');
  });

  it("emits no date markup at all when the mail has no Date header", () => {
    // An absent date must read as "unknown", never as an epoch/placeholder that
    // would extract into a confidently wrong publication date.
    const html = buildReadeckHtml(msg());

    expect(html).not.toContain("article:published_time");
    expect(html).not.toContain("<time");
    expect(html).not.toContain("1970");
    expect(html).toContain("<article><p>Hi there</p></article>");
  });

  it("still carries title and author alongside the date", () => {
    const html = buildReadeckHtml(msg({ date: "2026-07-07T17:06:48.000Z" }));

    expect(html).toContain("<title>Weekly Roundup</title>");
    expect(html).toContain('<meta name="author" content="The Daily Byte">');
  });
});

describe("ingestion log hygiene", () => {
  it("logs the Postgres cause and code, not the query text", () => {
    // drizzle puts the whole failed SQL (plus every bound parameter — for us, the
    // entire email body) on `message`, and the real reason on `cause`. Logging
    // `message` recorded 100KB-280KB rows that never said "foreign key violation",
    // which is exactly why the FK bug went unnoticed.
    const err = drizzleError(
      `insert into "document_content" ... ${"x".repeat(200_000)}`,
      "23503",
      'insert or update on table "document_content" violates foreign key constraint',
    );

    const described = describeError(err);

    expect(described).toContain("[23503]");
    expect(described).toContain("foreign key constraint");
    expect(described).not.toContain("xxxx");
    expect(described.length).toBeLessThan(500);
  });

  it("falls back to the error's own message when there is no cause", () => {
    expect(describeError(new Error("readeck down"))).toBe("readeck down");
    expect(describeError("plain string")).toBe("plain string");
  });

  it("truncates anything oversized at the log boundary, marking the cut", () => {
    // The cap lives in logIngestion so NO call site can dump a payload into
    // ingestion_log again, whatever it passes.
    const huge = "y".repeat(200_000);

    const capped = truncateLogMessage(huge);

    expect(capped.length).toBeLessThan(600);
    expect(capped).toContain("[truncated, 200000 chars]");
  });

  it("leaves a normal-length line untouched", () => {
    expect(truncateLogMessage("saved 3 of 4")).toBe("saved 3 of 4");
  });

  it("a huge drizzle failure is both explained and capped end to end", async () => {
    const t = deps();
    t.deps.store.putContent = async () => {
      throw drizzleError(`insert ... ${"z".repeat(200_000)}`, "23503", "fk violation");
    };

    await ingestNewsletters([msg({ uid: 5 })], t.deps);

    const line = truncateLogMessage(t.logs[0]?.message ?? "");
    expect(line).toContain("[23503]");
    expect(line).toContain("fk violation");
    expect(line).not.toContain("zzzz");
  });
});

describe("resolveFetchPlan (which mail a poll is allowed to fetch)", () => {
  it("does a normal incremental fetch when the cursor matches the mailbox validity", () => {
    expect(resolveFetchPlan({ uidValidity: "42", lastUid: 900 }, "42", 1000)).toEqual({
      mode: "incremental",
      fromUid: 900,
    });
  });

  it("cold-starts to the current high-water mark when there is no cursor", () => {
    const plan = resolveFetchPlan(null, "42", 725);

    expect(plan).toEqual({ mode: "cold-start", seededLastUid: 725, reason: "no stored cursor" });
  });

  it("cold-starts to the current high-water mark when UIDVALIDITY changed", () => {
    // A Proton Bridge restart, or an IMAP_HOST switch: the stored UID is
    // meaningless, but that must NOT mean "start from 0".
    const plan = resolveFetchPlan({ uidValidity: "41", lastUid: 900 }, "42", 725);

    expect(plan).toEqual({
      mode: "cold-start",
      seededLastUid: 725,
      reason: "uidvalidity changed 41 -> 42",
    });
  });

  it("seeds to 0 for an empty mailbox rather than a negative uid", () => {
    expect(resolveFetchPlan(null, "42", 0)).toEqual({
      mode: "cold-start",
      seededLastUid: 0,
      reason: "no stored cursor",
    });
  });

  it("IMAP_INGEST_BACKLOG restores the full fetch from uid 0", () => {
    expect(resolveFetchPlan(null, "42", 725, { ingestBacklog: true })).toEqual({
      mode: "incremental",
      fromUid: 0,
    });
    expect(
      resolveFetchPlan({ uidValidity: "41", lastUid: 900 }, "42", 725, { ingestBacklog: true }),
    ).toEqual({ mode: "incremental", fromUid: 0 });
  });

  it("the escape hatch does not disturb a healthy incremental cursor", () => {
    expect(
      resolveFetchPlan({ uidValidity: "42", lastUid: 900 }, "42", 1000, { ingestBacklog: true }),
    ).toEqual({ mode: "incremental", fromUid: 900 });
  });
});

/**
 * In-memory poll rig: a scriptable inbox plus the store/Readeck fakes above, so
 * `runEmailPoll` is exercised with no IMAP server and no Postgres.
 */
function pollRig(fetchResult: EmailFetchResult, storedCursor?: string) {
  const base = deps();
  let cursor = storedCursor;
  const cursorWrites: string[] = [];
  const logs: { status: string; message: string }[] = [];
  const seenCursors: (string | undefined)[] = [];
  const d: EmailPollDeps = {
    inbox: {
      fetchNew: async (c) => {
        seenCursors.push(c ? formatEmailCursor(c) : undefined);
        return fetchResult;
      },
    },
    store: base.deps.store,
    readLater: base.deps.readLater,
    excluded: base.deps.excluded,
    getCursor: async () => cursor,
    setCursor: async (value) => {
      cursor = value;
      cursorWrites.push(value);
    },
    getFailures: base.deps.getFailures,
    setFailures: base.deps.setFailures,
    log: async (status, message) => {
      logs.push({ status, message });
    },
  };
  return {
    deps: d,
    base,
    cursorWrites,
    logs,
    seenCursors,
    saved: base.saved,
    cursorNow: () => cursor,
  };
}

describe("runEmailPoll (cold start seeds the cursor instead of ingesting the backlog)", () => {
  it("first-ever run ingests nothing and persists the seeded cursor", async () => {
    const rig = pollRig({
      uidValidity: "42",
      messages: [],
      coldStart: { seededLastUid: 725, backlogSize: 725, reason: "no stored cursor" },
    });

    const saved = await runEmailPoll(rig.deps);

    expect(saved).toBe(0);
    expect(rig.saved).toEqual([]);
    // Persisting on a zero-message poll is the point: otherwise the next poll
    // cold-starts again and nothing is ever ingested.
    expect(rig.cursorWrites).toEqual(["42:725"]);
    expect(rig.cursorNow()).toBe("42:725");
  });

  it("explains in the ingestion log why nothing was ingested", async () => {
    const rig = pollRig({
      uidValidity: "42",
      messages: [],
      coldStart: { seededLastUid: 725, backlogSize: 725, reason: "no stored cursor" },
    });

    await runEmailPoll(rig.deps);

    expect(rig.logs).toHaveLength(1);
    expect(rig.logs[0]?.status).toBe("ok");
    expect(rig.logs[0]?.message).toContain("cold start");
    expect(rig.logs[0]?.message).toContain("seeded cursor to uid 725");
    expect(rig.logs[0]?.message).toContain("skipped backlog of 725 messages");
    expect(rig.logs[0]?.message).toContain("IMAP_INGEST_BACKLOG=1");
  });

  it("a UIDVALIDITY change re-seeds instead of sweeping the mailbox", async () => {
    // The production incident: a host switch changed UIDVALIDITY and the old
    // fallback-to-0 ingested 160 messages of back catalogue in one poll.
    const rig = pollRig(
      {
        uidValidity: "99",
        messages: [],
        coldStart: { seededLastUid: 725, backlogSize: 725, reason: "uidvalidity changed 42 -> 99" },
      },
      "42:900",
    );

    const saved = await runEmailPoll(rig.deps);

    expect(saved).toBe(0);
    expect(rig.saved).toEqual([]);
    expect(rig.seenCursors).toEqual(["42:900"]);
    expect(rig.cursorWrites).toEqual(["99:725"]);
  });

  it("a matching validity ingests normally and advances the cursor per message", async () => {
    const rig = pollRig(
      {
        uidValidity: "42",
        messages: [
          msg({ uid: 901, messageId: "<a@x.com>" }),
          msg({ uid: 902, messageId: "<b@x.com>" }),
        ],
      },
      "42:900",
    );

    const saved = await runEmailPoll(rig.deps);

    expect(saved).toBe(2);
    expect(rig.saved).toEqual([newsletterUrl("<a@x.com>"), newsletterUrl("<b@x.com>")]);
    expect(rig.cursorWrites).toEqual(["42:901", "42:902"]);
    expect(rig.logs).toEqual([{ status: "ok", message: "saved 2 of 2" }]);
  });

  it("with the backlog escape hatch on, the fetched backlog is ingested as normal", async () => {
    // `fetchNew` resolves the flag (no coldStart block comes back), so the poll
    // sees an ordinary batch — here the whole mailbox from uid 1.
    const rig = pollRig({
      uidValidity: "42",
      messages: [
        msg({ uid: 1, messageId: "<old@x.com>" }),
        msg({ uid: 2, messageId: "<older@x.com>" }),
      ],
    });

    const saved = await runEmailPoll(rig.deps);

    expect(saved).toBe(2);
    expect(rig.cursorWrites).toEqual(["42:1", "42:2"]);
  });
});

describe("newsletterUrl (the dedupe key ingestNewsletters looks up)", () => {
  it("is stable for the same Message-ID and differs across ids", () => {
    expect(newsletterUrl("<abc@x.com>")).toBe(newsletterUrl("<abc@x.com>"));
    expect(newsletterUrl("abc@x.com")).toBe(newsletterUrl("<abc@x.com>"));
    expect(newsletterUrl("<abc@x.com>")).not.toBe(newsletterUrl("<abd@x.com>"));
  });
});

// ---------------------------------------------------------------------------
// A. A poll must never overlap itself
// ---------------------------------------------------------------------------

/**
 * An in-memory stand-in for the Postgres session advisory lock, shared by every
 * "connection" in a test so a second holder really is refused. Mirrors
 * `pg_try_advisory_lock`: non-blocking, returns false when already held.
 */
function fakeLock(): AdvisoryLock & { held: Set<number> } {
  const held = new Set<number>();
  return {
    held,
    tryLock: async (key) => {
      if (held.has(key)) return false;
      held.add(key);
      return true;
    },
    unlock: async (key) => {
      held.delete(key);
    },
  };
}

describe("runExclusively (the guard against two polls on one cursor)", () => {
  it("refuses a second run while the first is in flight", async () => {
    const lock = fakeLock();
    const skipped: string[] = [];
    let running = 0;
    let peak = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const body = async () => {
      running++;
      peak = Math.max(peak, running);
      await gate;
      running--;
      return "ran";
    };

    const first = runExclusively(lock, "poll-email", body, async (n) => {
      skipped.push(n);
    });
    const second = await runExclusively(lock, "poll-email", body, async (n) => {
      skipped.push(n);
    });
    release();

    expect(second).toBe(SKIPPED);
    expect(await first).toBe("ran");
    // The whole point: the body was never entered twice.
    expect(peak).toBe(1);
    expect(skipped).toEqual(["poll-email"]);
  });

  it("releases the lock so the next scheduled run proceeds", async () => {
    const lock = fakeLock();

    await runExclusively(lock, "poll-email", async () => 1);
    const second = await runExclusively(lock, "poll-email", async () => 2);

    expect(second).toBe(2);
    expect(lock.held.size).toBe(0);
  });

  it("releases the lock even when the job throws", async () => {
    const lock = fakeLock();

    await expect(
      runExclusively(lock, "poll-readeck", async () => {
        throw new Error("readeck down");
      }),
    ).rejects.toThrow("readeck down");

    expect(lock.held.size).toBe(0);
    expect(await runExclusively(lock, "poll-readeck", async () => "next")).toBe("next");
  });

  it("locks are per-job, so different polls still run concurrently", async () => {
    const lock = fakeLock();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));

    const email = runExclusively(lock, "poll-email", async () => {
      await gate;
      return "email";
    });
    const readeck = await runExclusively(lock, "poll-readeck", async () => "readeck");
    release();

    expect(readeck).toBe("readeck");
    expect(await email).toBe("email");
  });

  it("gives every job name a distinct, stable int32 key", () => {
    expect(advisoryLockKey("poll-email")).toBe(advisoryLockKey("poll-email"));
    expect(advisoryLockKey("poll-email")).not.toBe(advisoryLockKey("poll-readeck"));
    for (const name of ["poll-email", "poll-readeck", "poll-miniflux", "reconcile-deletions"]) {
      expect(Number.isSafeInteger(advisoryLockKey(name))).toBe(true);
      expect(Math.abs(advisoryLockKey(name))).toBeLessThanOrEqual(2 ** 31);
    }
  });

  it("a simulated concurrent second poll does not double-save the same mail", async () => {
    // The production failure: pg-boss failed a poll at its 15-minute expiry and
    // re-queued it while the original was still saving. Both runs read the same
    // cursor, fetched the same UID range and saved the same messages — the URL
    // dedupe could not arbitrate, because run B checked before run A indexed.
    const lock = fakeLock();
    const rig = pollRig(
      { uidValidity: "42", messages: [msg({ uid: 901, messageId: "<a@x.com>" })] },
      "42:900",
    );
    // Both runs share ONE rig, so a double-save would show up as two entries.
    const runs = await Promise.all([
      runExclusively(lock, "poll-email", () => runEmailPoll(rig.deps)),
      runExclusively(lock, "poll-email", () => runEmailPoll(rig.deps)),
    ]);

    expect(runs.filter((r) => r === SKIPPED)).toHaveLength(1);
    expect(rig.saved).toEqual([newsletterUrl("<a@x.com>")]);
    expect(rig.cursorWrites).toEqual(["42:901"]);
  });
});

describe("isCursorAdvance (a stale writer must not rewind the cursor)", () => {
  it("accepts any cursor when none is stored", () => {
    expect(isCursorAdvance("email", undefined, "42:900")).toBe(true);
    expect(isCursorAdvance("readeck", null, "2026-07-19T00:00:00.000Z")).toBe(true);
  });

  it("rejects an email cursor that would move the UID backwards", () => {
    // Two overlapping runs both write; last-writer-wins would otherwise let the
    // slower one reinstate an older high-water mark and re-process settled mail.
    expect(isCursorAdvance("email", "42:900", "42:850")).toBe(false);
    expect(isCursorAdvance("email", "42:900", "42:901")).toBe(true);
    expect(isCursorAdvance("email", "42:900", "42:900")).toBe(true);
  });

  it("allows a re-base onto a different UIDVALIDITY however small the uid", () => {
    // A Bridge restart makes the old UID meaningless, so a lower one is not a
    // regression — refusing it here would wedge ingestion after every restart.
    expect(isCursorAdvance("email", "42:900", "99:12")).toBe(true);
  });

  it("rejects a backend timestamp cursor that would move backwards", () => {
    expect(isCursorAdvance("readeck", "2026-07-19T10:00:00.000Z", "2026-07-19T09:00:00.000Z")).toBe(
      false,
    );
    expect(isCursorAdvance("readeck", "2026-07-19T10:00:00.000Z", "2026-07-19T11:00:00.000Z")).toBe(
      true,
    );
  });

  it("lets an unparseable value through rather than wedging ingestion", () => {
    expect(isCursorAdvance("readeck", "not-a-date", "2026-07-19T10:00:00.000Z")).toBe(true);
    expect(isCursorAdvance("email", "garbage", "42:900")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// B. reconcileDeletions must not tombstone live documents
// ---------------------------------------------------------------------------

/**
 * A reconcile rig whose backend enumeration and per-item probe are scripted
 * separately, so a walk that SKIPS a live item (what OFFSET pagination over a
 * `-updated` sort does whenever anything is touched mid-walk) can be modelled
 * exactly.
 */
function reconcileRig(opts: {
  live: { id: string; sourceId: string }[];
  enumerated: string[];
  presence?: Record<string, BackendPresence>;
  enumerateError?: Error;
}) {
  const tombstoned: string[] = [];
  const logs: { status: string; message: string }[] = [];
  const probed: string[] = [];
  const d: DeletionReconcileDeps = {
    enumerate: async () => {
      if (opts.enumerateError) throw opts.enumerateError;
      return new Set(opts.enumerated);
    },
    listLive: async () => opts.live,
    probe: async (sourceId) => {
      probed.push(sourceId);
      return opts.presence?.[sourceId] ?? "missing";
    },
    softDelete: async (ids) => {
      tombstoned.push(...ids);
    },
    log: async (status, message) => {
      logs.push({ status, message });
    },
  };
  return { deps: d, tombstoned, logs, probed };
}

function liveDocs(n: number, from = 1): { id: string; sourceId: string }[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `readeck:${from + i}`,
    sourceId: String(from + i),
  }));
}

describe("reconcileSourceDeletions", () => {
  it("tombstones nothing when the backend still lists everything", async () => {
    const live = liveDocs(10);
    const rig = reconcileRig({ live, enumerated: live.map((d) => d.id) });

    expect(await reconcileSourceDeletions("readeck", rig.deps)).toBe(0);
    expect(rig.tombstoned).toEqual([]);
    expect(rig.probed).toEqual([]);
    expect(rig.logs[0]?.status).toBe("ok");
  });

  it("a mid-walk mutation that skips one item does NOT cause a tombstone", async () => {
    // THE BUG. `ReadeckBackend.list` sorts by `-updated` and paginates by OFFSET,
    // so a bookmark whose `updated` changes mid-walk jumps to offset 0 and shifts
    // everything down — the walk misses one. That item was absent from `present`
    // and tombstoned with no verification. It is unrecoverable: `findByAnyUrl`
    // ignores `deleted_at`, so a wrongly-tombstoned newsletter answers "already
    // seen" forever and is never re-ingested.
    const live = liveDocs(10);
    const skipped = live[4]!;
    const rig = reconcileRig({
      live,
      enumerated: live.filter((d) => d.id !== skipped.id).map((d) => d.id),
      // The individual probe tells the truth: it is still there.
      presence: { [skipped.sourceId]: "present" },
    });

    const removed = await reconcileSourceDeletions("readeck", rig.deps);

    expect(removed).toBe(0);
    expect(rig.tombstoned).toEqual([]);
    // It WAS nominated — the enumeration really did skip it — but verification
    // caught it, and the discrepancy is surfaced rather than swallowed.
    expect(rig.probed).toEqual([skipped.sourceId]);
    expect(rig.logs[0]?.status).toBe("warn");
    expect(rig.logs[0]?.message).toContain("still present");
  });

  it("tombstones an item the backend confirms is gone", async () => {
    const live = liveDocs(10);
    const gone = live[2]!;
    const rig = reconcileRig({
      live,
      enumerated: live.filter((d) => d.id !== gone.id).map((d) => d.id),
      presence: { [gone.sourceId]: "missing" },
    });

    expect(await reconcileSourceDeletions("readeck", rig.deps)).toBe(1);
    expect(rig.tombstoned).toEqual([gone.id]);
    expect(rig.logs[0]?.status).toBe("ok");
  });

  it("leaves a candidate alone when the probe itself fails", async () => {
    // "We could not check" must never become "therefore delete".
    const live = liveDocs(10);
    const unsure = live[7]!;
    const rig = reconcileRig({
      live,
      enumerated: live.filter((d) => d.id !== unsure.id).map((d) => d.id),
      presence: { [unsure.sourceId]: "unknown" },
    });

    expect(await reconcileSourceDeletions("readeck", rig.deps)).toBe(0);
    expect(rig.tombstoned).toEqual([]);
    expect(rig.logs[0]?.message).toContain("could not be verified");
  });

  it("a throwing probe is treated as unverifiable, not as missing", async () => {
    const live = liveDocs(10);
    const rig = reconcileRig({ live, enumerated: live.slice(1).map((d) => d.id) });
    rig.deps.probe = async () => {
      throw new Error("connection reset");
    };

    expect(await reconcileSourceDeletions("readeck", rig.deps)).toBe(0);
    expect(rig.tombstoned).toEqual([]);
  });

  it("the blast-radius guard refuses an implausibly large pass and touches nothing", async () => {
    // A truncated enumeration (e.g. `ReadeckBackend.list` stopping after page one
    // because a missing `total-count` header made `total` NaN) nominates almost
    // the whole library. Refuse, loudly, rather than mass-tombstoning.
    const live = liveDocs(725);
    const rig = reconcileRig({ live, enumerated: live.slice(0, 100).map((d) => d.id) });

    const removed = await reconcileSourceDeletions("readeck", rig.deps);

    expect(removed).toBe(0);
    expect(rig.tombstoned).toEqual([]);
    // Not even probed — the pass is abandoned before any per-item work.
    expect(rig.probed).toEqual([]);
    expect(rig.logs[0]?.status).toBe("error");
    expect(rig.logs[0]?.message).toContain("refusing to tombstone 625 of 725");
    expect(rig.logs[0]?.message).toContain("NO rows were touched");
  });

  it("still allows a genuine small cleanup in a large library", async () => {
    const live = liveDocs(725);
    const gone = live.slice(0, 3);
    const rig = reconcileRig({ live, enumerated: live.slice(3).map((d) => d.id) });

    expect(await reconcileSourceDeletions("readeck", rig.deps)).toBe(3);
    expect(rig.tombstoned).toEqual(gone.map((d) => d.id));
  });

  it("an enumeration that throws aborts before any deletion", async () => {
    const live = liveDocs(10);
    const rig = reconcileRig({
      live,
      enumerated: [],
      enumerateError: new Error("enumeration cursor did not advance (stuck at 100)"),
    });

    await expect(reconcileSourceDeletions("readeck", rig.deps)).rejects.toThrow("did not advance");
    expect(rig.tombstoned).toEqual([]);
  });
});

describe("deletionAllowance", () => {
  it("scales with the library but never drops below the floor", () => {
    expect(deletionAllowance(0)).toBe(DELETION_BLAST_RADIUS_FLOOR);
    expect(deletionAllowance(10)).toBe(DELETION_BLAST_RADIUS_FLOOR);
    expect(deletionAllowance(725)).toBe(73);
    expect(deletionAllowance(10_000)).toBe(1000);
  });
});

// ---------------------------------------------------------------------------
// C. One poison message must not wedge ingestion forever
// ---------------------------------------------------------------------------

describe("isTransientSaveError (outage vs. unsaveable message)", () => {
  it("treats 5xx / 429 / 408 from the backend as transient", () => {
    for (const status of [500, 502, 503, 429, 408]) {
      expect(isTransientSaveError(new BackendHttpError("readeck", status, null, "nope"))).toBe(
        true,
      );
    }
  });

  it("treats a 4xx rejection of the payload as possibly-poison", () => {
    for (const status of [400, 413, 415, 422]) {
      expect(isTransientSaveError(new BackendHttpError("readeck", status, null, "bad"))).toBe(
        false,
      );
    }
  });

  it("treats a socket-level failure as transient", () => {
    expect(isTransientSaveError(Object.assign(new Error("x"), { code: "ECONNREFUSED" }))).toBe(
      true,
    );
    const wrapped = new Error("fetch failed");
    wrapped.cause = Object.assign(new Error("connect ETIMEDOUT"), { code: "ETIMEDOUT" });
    expect(isTransientSaveError(wrapped)).toBe(true);
    expect(isTransientSaveError(new TypeError("fetch failed"))).toBe(true);
  });

  it("treats an ordinary error as possibly-poison", () => {
    expect(isTransientSaveError(new Error("invalid html"))).toBe(false);
  });
});

describe("poison-message bounding", () => {
  const boom = () => {
    throw new Error("readeck rejected the payload");
  };

  it("skips a UID that has already failed the maximum number of times", async () => {
    // The shipped behaviour: the failing UID was retried every 5 minutes FOREVER,
    // and each retry re-downloaded and re-parsed the whole remaining mailbox
    // before hitting the same wall — 3049 error rows against 725 messages.
    const t = deps();
    t.seedFailures({ "1": MAX_SAVE_ATTEMPTS - 1 });
    let calls = 0;
    t.deps.readLater.save = async () => {
      calls++;
      if (calls === 1) boom();
      return String(200 + calls);
    };

    const r = await ingestNewsletters(
      [msg({ uid: 1 }), msg({ uid: 2, messageId: "<good@x.com>" })],
      t.deps,
    );

    expect(r.skippedPoison).toBe(1);
    // The cursor moved PAST the bad message, and the good one behind it landed.
    expect(t.cursors).toEqual([1, 2]);
    expect(r.saved).toBe(1);
    // The counter is dropped once the message is abandoned, so the map stays small.
    expect(t.failures()).toEqual({});
  });

  it("names the abandoned message so the skip is never silent", async () => {
    const t = deps();
    t.seedFailures({ "1": MAX_SAVE_ATTEMPTS - 1 });
    t.deps.readLater.save = async () => boom();

    await ingestNewsletters([msg({ uid: 1, subject: "Broken Issue #12" })], t.deps);

    const line = t.logs[0]!;
    expect(line.status).toBe("error");
    expect(line.message).toContain("SKIPPED after 3 failed attempts");
    expect(line.message).toContain("Broken Issue #12");
    expect(line.message).toContain("hello@dailybyte.com");
  });

  it("counts up across polls rather than skipping on the first failure", async () => {
    const t = deps();
    t.deps.readLater.save = async () => boom();

    const first = await ingestNewsletters([msg({ uid: 1 })], t.deps);
    expect(first.skippedPoison).toBe(0);
    expect(t.failures()).toEqual({ "1": 1 });
    expect(t.cursors).toEqual([]);

    const second = await ingestNewsletters([msg({ uid: 1 })], t.deps);
    expect(second.skippedPoison).toBe(0);
    expect(t.failures()).toEqual({ "1": 2 });
    expect(t.cursors).toEqual([]);

    const third = await ingestNewsletters([msg({ uid: 1 })], t.deps);
    expect(third.skippedPoison).toBe(1);
    expect(t.cursors).toEqual([1]);
  });

  it("a TRANSIENT failure is retried forever and never burns an attempt", async () => {
    // A Readeck outage must not cause mail to be discarded: without this, the
    // oldest unread message would be dropped after three failed polls.
    const t = deps();
    t.deps.readLater.save = async () => {
      throw new BackendHttpError("readeck", 503, null, "service unavailable");
    };

    for (let poll = 0; poll < 10; poll++) {
      const r = await ingestNewsletters([msg({ uid: 1 })], t.deps);
      expect(r.skippedPoison).toBe(0);
    }

    expect(t.failures()).toEqual({});
    expect(t.cursors).toEqual([]);
    expect(t.logs.at(-1)?.message).toContain("transient — will retry");
  });

  it("a message that recovers has its counter cleared", async () => {
    const t = deps();
    t.seedFailures({ "1": 2 });

    await ingestNewsletters([msg({ uid: 1 })], t.deps);

    expect(t.failures()).toEqual({});
    expect(t.cursors).toEqual([1]);
  });

  it("the poll summary surfaces an abandoned message", async () => {
    const rig = pollRig({ uidValidity: "42", messages: [msg({ uid: 901 })] }, "42:900");
    await rig.base.deps.setFailures({ "901": MAX_SAVE_ATTEMPTS - 1 });
    rig.base.deps.readLater.save = async () => boom();

    await runEmailPoll(rig.deps);

    const summary = rig.logs.at(-1)!;
    expect(summary.status).toBe("warn");
    expect(summary.message).toContain("1 unsaveable");
  });
});

// ---------------------------------------------------------------------------
// D. ingestion_log retention
// ---------------------------------------------------------------------------

/** A prune rig with a scripted row population, so batching is observable. */
function pruneRig(counts: { ok: number; other: number; overCap: number }) {
  const remaining = { ...counts };
  const calls: string[] = [];
  const logs: { status: string; message: string }[] = [];
  const take = (key: keyof typeof remaining, limit: number) => {
    const n = Math.min(limit, remaining[key]);
    remaining[key] -= n;
    return n;
  };
  const deps: LogPruneDeps = {
    deleteOlderThan: async (kind, before, limit) => {
      calls.push(`${kind}@${before.toISOString()}`);
      return take(kind, limit);
    },
    deleteBeyondRowCap: async (maxRows, limit) => {
      calls.push(`cap@${maxRows}`);
      return take("overCap", limit);
    },
    log: async (status, message) => {
      logs.push({ status, message });
    },
  };
  return { deps, calls, logs, remaining };
}

describe("pruneIngestionLog", () => {
  it("deletes ok rows and error rows against their own cutoffs", async () => {
    const now = new Date("2026-07-19T00:00:00.000Z");
    const rig = pruneRig({ ok: 100, other: 5, overCap: 0 });

    const removed = await pruneIngestionLog(rig.deps, now);

    expect(removed).toBe(105);
    // "ok" rows are heartbeat noise; errors are the diagnostic record and are
    // deliberately kept far longer.
    expect(rig.calls[0]).toBe("ok@2026-07-12T00:00:00.000Z");
    expect(rig.calls[1]).toBe("other@2026-04-20T00:00:00.000Z");
    expect(rig.logs).toEqual([{ status: "ok", message: "pruned 105 ingestion_log rows" }]);
  });

  it("keeps errors longer than ok rows", () => {
    expect(LOG_RETENTION.errorDays).toBeGreaterThan(LOG_RETENTION.okDays);
  });

  it("enforces the row cap after the age sweeps", async () => {
    const rig = pruneRig({ ok: 0, other: 0, overCap: 42 });

    expect(await pruneIngestionLog(rig.deps)).toBe(42);
    expect(rig.calls.at(-1)).toBe(`cap@${LOG_RETENTION.maxRows}`);
  });

  it("stops as soon as a phase is drained (a short batch ends it)", async () => {
    const rig = pruneRig({ ok: 3, other: 0, overCap: 0 });

    await pruneIngestionLog(rig.deps);

    // One call per phase, no pointless second pass over an already-empty phase.
    expect(rig.calls.filter((c) => c.startsWith("ok@"))).toHaveLength(1);
  });

  it("stays bounded so the prune can never become a long-running job", async () => {
    // The prune shares a scheduler with the polls, so it must not be the thing
    // that trips the overlap problem. A pathological backlog is truncated, not
    // chased: the next run picks up where this one stopped.
    const enormous = LOG_RETENTION.batchSize * LOG_RETENTION.maxBatches * 5;
    const rig = pruneRig({ ok: enormous, other: 0, overCap: 0 });

    const removed = await pruneIngestionLog(rig.deps);

    expect(removed).toBe(LOG_RETENTION.batchSize * LOG_RETENTION.maxBatches);
    expect(rig.calls.filter((c) => c.startsWith("ok@"))).toHaveLength(LOG_RETENTION.maxBatches);
    expect(rig.remaining.ok).toBeGreaterThan(0);
  });
});
