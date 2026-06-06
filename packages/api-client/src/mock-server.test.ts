import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { endpoints } from "@lectern/shared";
import { LecternClient } from "./client";
import { handledOperationIds, type MockServerHandle, startMockServer } from "./mock-server";

let handle: MockServerHandle;
let client: LecternClient;

beforeAll(async () => {
  handle = await startMockServer(0);
  client = new LecternClient({ baseUrl: handle.url, token: "test-token" });
});

afterAll(() => {
  handle.server.close();
});

describe("mock server serves the contract", () => {
  // The client validates every response against the shared schema, so a successful
  // call proves the fixture conforms to the contract.
  it("listDocuments returns schema-valid results", async () => {
    const r = await client.listDocuments({ location: "later" });
    expect(r.count).toBeGreaterThan(1);
    expect(r.results[0]!.source).toBe("readeck");
  });

  it("saveDocument echoes the requested url + location", async () => {
    const c = await client.saveDocument({
      url: "https://example.com/x",
      tags: [],
      location: "inbox",
    });
    expect(c.url).toBe("https://example.com/x");
    expect(c.location).toBe("inbox");
  });

  it("getContent returns article html", async () => {
    const c = await client.getContent("card_1");
    expect(c.html).toContain("<main>");
  });

  it("syncPull returns a cursor and cards", async () => {
    const r = await client.syncPull();
    expect(r.cursor).toBe("1");
    expect(r.cards.length).toBeGreaterThan(1);
  });

  it("deleteDocument resolves on 204", async () => {
    await expect(client.deleteDocument("card_1")).resolves.toBeUndefined();
  });

  it("listFeeds returns feeds + folders", async () => {
    const r = await client.listFeeds();
    expect(r.feeds[0]!.feedUrl).toBe("https://simonwillison.net/atom/everything/");
    expect(r.folders).toHaveLength(2);
  });

  it("refreshFeeds resolves on an empty-body 202", async () => {
    await expect(client.refreshFeeds()).resolves.toBeUndefined();
  });
});

describe("mock dispatch is derived from the registry", () => {
  it("has a handler for every endpoint in the registry", () => {
    const missing = endpoints.filter((e) => !handledOperationIds.has(e.operationId));
    expect(missing.map((e) => e.operationId)).toEqual([]);
  });
});

describe("mock serves endpoints the old if-chain dropped", () => {
  it("search returns ranked, schema-valid results", async () => {
    const r = await client.search("fox");
    expect(r.results.length).toBeGreaterThan(0);
    expect(r.results[0]!.rank).toBe(1);
  });

  it("bulkDelete returns a deleted count", async () => {
    const r = await client.bulkDelete("archive");
    expect(r.deleted).toBeGreaterThanOrEqual(0);
  });

  it("forceSync returns per-source counts", async () => {
    const r = await client.forceSync();
    expect(r.miniflux + r.readeck).toBeGreaterThan(0);
  });

  it("getTtsUsage returns usage for the preconfigured key", async () => {
    const r = await client.getTtsUsage();
    expect(r.tier).toBeTruthy();
  });

  it("getDocumentAccent returns a nullable colour", async () => {
    const r = await client.getDocumentAccent("card_1");
    expect(r).toHaveProperty("color");
  });

  it("push endpoints round-trip against the contract", async () => {
    expect((await client.getPushPublicKey()).publicKey).toBeTruthy();
    const reg = await client.registerPushSubscription({
      endpoint: "https://push.example/abc",
      keys: { p256dh: "k", auth: "a" },
    });
    expect(reg.ok).toBe(true);
    expect(Array.isArray((await client.getFeedNotifications()).feeds)).toBe(true);
    expect(await client.setFeedNotification("feed_1", true)).toEqual({
      feedId: "feed_1",
      enabled: true,
    });
  });
});
