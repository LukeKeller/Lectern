import Fastify, { type FastifyInstance } from "fastify";
import type { RunTrigger } from "@lectern/shared";
import { config } from "./config";
import type { DiscoveryClient, RunResult } from "./run";

/**
 * Injectable application dependencies. Tests pass fakes (a client factory and a
 * runner spy); production wires the real `LecternClient` + `runDiscovery`
 * (see `deps.ts`).
 */
export interface AppDeps {
  /** Build a fresh Lectern client per request (cheap; connection-lazy). */
  createClient: () => DiscoveryClient;
  /** Kick off a run. Returned promise is not awaited by POST /run. */
  runner: (client: DiscoveryClient, opts: { trigger: RunTrigger }) => Promise<RunResult>;
  /** Bearer token required on POST /run. Defaults to config. */
  token?: string;
}

/**
 * Build the worker's HTTP surface. Kept separate from `server.ts` so tests can
 * exercise it via `app.inject(...)` without binding a port.
 *
 *   POST /run    — Bearer-gated; kicks a manual run fire-and-forget, returns 202.
 *   GET  /health — liveness probe.
 */
export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({ logger: false });
  const token = deps.token ?? config.DISCOVERY_TOKEN;

  app.get("/health", async () => ({ status: "ok" }));

  app.post("/run", async (req, reply) => {
    // Require the bearer token when one is configured. An empty token (dev
    // default) leaves the endpoint open on the loopback bind.
    if (token) {
      const auth = req.headers.authorization ?? "";
      if (auth !== `Bearer ${token}`) {
        return reply.code(401).send({ error: "unauthorized" });
      }
    }

    // Fire-and-forget: the run reports its own progress via the run record, so
    // the HTTP caller doesn't wait for it.
    const client = deps.createClient();
    void deps.runner(client, { trigger: "manual" }).catch((err) => {
      console.error("[discovery] manual run failed:", err);
    });

    return reply.code(202).send({ ok: true });
  });

  return app;
}
