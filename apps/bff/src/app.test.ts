import { describe, expect, it } from "vitest";
import { buildApp } from "./app";

describe("BFF health endpoints", () => {
  it("GET /healthz returns ok", async () => {
    const app = buildApp();
    const res = await app.inject({ method: "GET", url: "/healthz" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
    await app.close();
  });

  it("GET /readyz returns ready", async () => {
    const app = buildApp();
    const res = await app.inject({ method: "GET", url: "/readyz" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ready" });
    await app.close();
  });

  it("returns 404 for an unknown route", async () => {
    const app = buildApp();
    const res = await app.inject({ method: "GET", url: "/nope" });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
