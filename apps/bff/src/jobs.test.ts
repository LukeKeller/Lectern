import { describe, expect, it } from "vitest";
import { ingestNewsletters, type NewsletterIngestDeps } from "./jobs";
import { newsletterUrl, parseExcludedSenders, type ParsedNewsletter } from "./backends/email-inbox";
import type { IndexedUrlMatch } from "./unify";

/**
 * Regression cover for the newsletter re-import bug: Proton Mail Bridge rotates
 * UIDVALIDITY on every restart, which resets the UID cursor to 0 and replays the
 * WHOLE mailbox through `ingestNewsletters`. Readeck does not dedupe (its
 * POST /api/bookmarks mints a new id for a URL it already holds), so the replay
 * must be stopped here, by URL, before the save.
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
  const cursors: number[] = [];
  const logs: { status: string; message: string }[] = [];
  let nextId = 100;
  const d: NewsletterIngestDeps = {
    store: {
      findByUrl: async (url) => index.get(url) ?? null,
      putContent: async (id, html) => {
        content.push(id);
        void html;
      },
    },
    readLater: {
      save: async (input) => {
        const id = String(nextId++);
        saved.push(input.url);
        // Mirror the real ingest: a successful save becomes an indexed document,
        // so a replay within the same run would also find it.
        index.set(input.url, { id: `readeck:${id}`, deleted: false });
        return id;
      },
    },
    excluded: parseExcludedSenders("diagnosis@digitallyadrift.com"),
    setCursor: async (uid) => {
      cursors.push(uid);
    },
    log: async (status, message) => {
      logs.push({ status, message });
    },
  };
  return { deps: d, saved, content, cursors, logs };
}

describe("ingestNewsletters", () => {
  it("saves a genuinely new message and advances the cursor", async () => {
    const t = deps();
    const result = await ingestNewsletters([msg()], t.deps);

    expect(result).toEqual({ saved: 1, skippedExcluded: 0, skippedDuplicate: 0 });
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

    expect(result).toEqual({ saved: 0, skippedExcluded: 0, skippedDuplicate: 1 });
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

    expect(result).toEqual({ saved: 0, skippedExcluded: 0, skippedDuplicate: 1 });
    expect(t.saved).toEqual([]);
    expect(t.cursors).toEqual([1]);
  });

  it("dedupes within a single batch (same Message-ID twice)", async () => {
    const t = deps();
    const result = await ingestNewsletters([msg({ uid: 1 }), msg({ uid: 2 })], t.deps);

    expect(result).toEqual({ saved: 1, skippedExcluded: 0, skippedDuplicate: 1 });
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

    expect(result).toEqual({ saved: 1, skippedExcluded: 1, skippedDuplicate: 1 });
    expect(t.saved).toEqual([newsletterUrl("<fresh@mail.example.com>")]);
    expect(t.cursors).toEqual([1, 2, 3]);
  });

  it("distinct Message-IDs are saved independently", async () => {
    const t = deps();
    const result = await ingestNewsletters(
      [msg({ uid: 1, messageId: "<one@x.com>" }), msg({ uid: 2, messageId: "<two@x.com>" })],
      t.deps,
    );

    expect(result).toEqual({ saved: 2, skippedExcluded: 0, skippedDuplicate: 0 });
    expect(t.saved).toEqual([newsletterUrl("<one@x.com>"), newsletterUrl("<two@x.com>")]);
  });

  it("stops at the first save error without advancing past it", async () => {
    const t = deps();
    t.deps.readLater.save = async () => {
      throw new Error("readeck down");
    };

    const result = await ingestNewsletters([msg({ uid: 1 }), msg({ uid: 2 })], t.deps);

    expect(result).toEqual({ saved: 0, skippedExcluded: 0, skippedDuplicate: 0 });
    expect(t.cursors).toEqual([]);
    expect(t.logs).toEqual([{ status: "error", message: "uid 1: readeck down" }]);
  });

  it("a content-store failure still counts the save and advances the cursor", async () => {
    const t = deps();
    t.deps.store.putContent = async () => {
      throw new Error("pg down");
    };

    const result = await ingestNewsletters([msg({ uid: 5 })], t.deps);

    expect(result).toEqual({ saved: 1, skippedExcluded: 0, skippedDuplicate: 0 });
    expect(t.cursors).toEqual([5]);
    expect(t.logs[0]?.status).toBe("error");
  });
});

describe("newsletterUrl (the dedupe key ingestNewsletters looks up)", () => {
  it("is stable for the same Message-ID and differs across ids", () => {
    expect(newsletterUrl("<abc@x.com>")).toBe(newsletterUrl("<abc@x.com>"));
    expect(newsletterUrl("abc@x.com")).toBe(newsletterUrl("<abc@x.com>"));
    expect(newsletterUrl("<abc@x.com>")).not.toBe(newsletterUrl("<abd@x.com>"));
  });
});
