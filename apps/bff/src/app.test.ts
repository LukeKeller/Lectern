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

  it("GET /bootstrap returns the api token + user for an authenticated session", async () => {
    const app = buildApp();
    const res = await app.inject({ method: "GET", url: "/bootstrap" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { token: string; user: string };
    expect(typeof body.token).toBe("string");
    expect(body.token.length).toBeGreaterThan(0);
    expect(typeof body.user).toBe("string");
    await app.close();
  });
});
