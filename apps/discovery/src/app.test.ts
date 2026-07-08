import { describe, expect, it, vi } from "vitest";
import { buildApp, type AppDeps } from "./app";
import type { DiscoveryClient } from "./run";

function deps(overrides?: Partial<AppDeps>): AppDeps {
  return {
    createClient: () => ({}) as unknown as DiscoveryClient,
    runner: vi.fn(async () => ({ runId: "run:test", status: "succeeded" as const })),
    token: "secret",
    ...overrides,
  };
}

describe("discovery worker HTTP surface", () => {
  it("GET /health returns ok", async () => {
    const app = buildApp(deps());
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
    await app.close();
  });

  it("POST /run rejects a missing/wrong bearer token with 401", async () => {
    const runner = vi.fn(async () => ({ runId: "run:x", status: "succeeded" as const }));
    const app = buildApp(deps({ runner }));
    const res = await app.inject({ method: "POST", url: "/run" });
    expect(res.statusCode).toBe(401);
    expect(runner).not.toHaveBeenCalled();
    await app.close();
  });

  it("POST /run accepts a valid token and kicks the runner (202)", async () => {
    const runner = vi.fn<AppDeps["runner"]>(async () => ({
      runId: "run:x",
      status: "succeeded" as const,
    }));
    const app = buildApp(deps({ runner }));
    const res = await app.inject({
      method: "POST",
      url: "/run",
      headers: { authorization: "Bearer secret" },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ ok: true });
    expect(runner).toHaveBeenCalledOnce();
    expect(runner.mock.calls[0]?.[1]).toEqual({ trigger: "manual" });
    await app.close();
  });

  it("POST /run is open when no token is configured", async () => {
    const runner = vi.fn(async () => ({ runId: "run:x", status: "succeeded" as const }));
    const app = buildApp(deps({ runner, token: "" }));
    const res = await app.inject({ method: "POST", url: "/run" });
    expect(res.statusCode).toBe(202);
    expect(runner).toHaveBeenCalledOnce();
    await app.close();
  });
});
