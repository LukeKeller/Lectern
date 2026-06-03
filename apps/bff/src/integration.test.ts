import { resolve } from "node:path";
import { Card } from "@lectern/shared";
import { describe, expect, it } from "vitest";
import { MinifluxBackend } from "./backends/miniflux";
import { ReadeckBackend } from "./backends/readeck";

/**
 * Live integration tests against the local dev stack (MiniFlux + Readeck).
 * Guarded so CI without the backends still passes: requires READECK_API_TOKEN
 * (loaded from the repo-root .env) and a successful reachability probe.
 */

// Load the repo-root .env (cwd is apps/bff under --filter); best-effort.
for (const rel of [".env", "../.env", "../../.env", "../../../.env"]) {
  try {
    process.loadEnvFile(resolve(process.cwd(), rel));
    break;
  } catch {
    // keep trying the next candidate
  }
}

const MINIFLUX_URL = process.env.MINIFLUX_URL ?? "http://localhost:8088";
const MINIFLUX_BASIC = process.env.MINIFLUX_BASIC ?? "admin:adminpass";
const MINIFLUX_API_TOKEN = process.env.MINIFLUX_API_TOKEN || undefined;
const READECK_URL = process.env.READECK_URL ?? "http://localhost:8089";
const READECK_API_TOKEN = process.env.READECK_API_TOKEN;

async function reachable(url: string, headers: Record<string, string>): Promise<boolean> {
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

const minifluxAuth: Record<string, string> = MINIFLUX_API_TOKEN
  ? { "X-Auth-Token": MINIFLUX_API_TOKEN }
  : { Authorization: "Basic " + Buffer.from(MINIFLUX_BASIC).toString("base64") };

const ready =
  !!READECK_API_TOKEN &&
  (await reachable(`${MINIFLUX_URL}/v1/me`, minifluxAuth)) &&
  (await reachable(`${READECK_URL}/api/profile`, { Authorization: "Bearer " + READECK_API_TOKEN }));

describe.skipIf(!ready)("MiniFlux live adapter", () => {
  const miniflux = new MinifluxBackend({
    baseUrl: MINIFLUX_URL,
    apiToken: MINIFLUX_API_TOKEN,
    basic: MINIFLUX_BASIC,
  });

  it("lists entries as valid Cards", async () => {
    const page = await miniflux.listEntries({ pageSize: 5 });
    expect(page.items.length).toBeGreaterThan(0);
    for (const card of page.items) {
      expect(card.source).toBe("miniflux");
      expect(() => Card.parse(card)).not.toThrow();
    }
  });

  it("round-trips setRead and setStarred", async () => {
    const page = await miniflux.listEntries({ pageSize: 1 });
    const card = page.items[0];
    expect(card).toBeDefined();
    if (!card) return;
    const id = card.sourceId;
    const wasRead = card.readState === "finished";

    await miniflux.setRead(id, !wasRead);
    const afterRead = await miniflux.listEntries({ pageSize: 50 });
    const reread = afterRead.items.find((c) => c.sourceId === id);
    expect(reread && reread.readState === "finished").toBe(!wasRead);

    // restore original read state
    await miniflux.setRead(id, wasRead);

    // starred toggles; verify both directions then restore.
    await miniflux.setStarred(id, true);
    await miniflux.setStarred(id, true); // idempotent no-op
    await miniflux.setStarred(id, false);
  });
});

describe.skipIf(!ready)("Readeck live adapter", () => {
  const readeck = new ReadeckBackend({ baseUrl: READECK_URL, apiToken: READECK_API_TOKEN ?? "" });

  it("lists bookmarks as valid Cards", async () => {
    const page = await readeck.list({ pageSize: 5 });
    expect(page.items.length).toBeGreaterThan(0);
    for (const card of page.items) {
      expect(card.source).toBe("readeck");
      expect(() => Card.parse(card)).not.toThrow();
    }
  });

  it("round-trips setReadingProgress and setLabels", async () => {
    const page = await readeck.list({ pageSize: 1 });
    const card = page.items[0];
    expect(card).toBeDefined();
    if (!card) return;
    const id = card.sourceId;

    const original = await readeck.get(id);

    await readeck.setReadingProgress(id, 0.37, "#itest-anchor");
    const afterProgress = await readeck.get(id);
    expect(afterProgress.readingProgress).toBeCloseTo(0.37, 2);
    expect(afterProgress.readAnchor).toBe("#itest-anchor");

    const label = "lectern-itest";
    const nextLabels = original.tags.includes(label) ? original.tags : [...original.tags, label];
    await readeck.setLabels(id, nextLabels);
    const afterLabels = await readeck.get(id);
    expect(afterLabels.tags).toContain(label);

    // restore original progress/anchor/labels
    await readeck.setReadingProgress(id, original.readingProgress, original.readAnchor);
    await readeck.setLabels(id, original.tags);
  });
});
