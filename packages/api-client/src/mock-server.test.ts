import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LecternClient } from "./client";
import { type MockServerHandle, startMockServer } from "./mock-server";

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
    expect(r.count).toBe(1);
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
    expect(c.html).toContain("Mock article");
  });

  it("syncPull returns a cursor and cards", async () => {
    const r = await client.syncPull();
    expect(r.cursor).toBe("1");
    expect(r.cards).toHaveLength(1);
  });

  it("deleteDocument resolves on 204", async () => {
    await expect(client.deleteDocument("card_1")).resolves.toBeUndefined();
  });
});
