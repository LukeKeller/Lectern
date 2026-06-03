import Fastify, { type FastifyInstance } from "fastify";

/**
 * Builds the Fastify application. Kept separate from `server.ts` so tests can
 * exercise routes via `app.inject(...)` without binding a port.
 */
export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: false });

  // Liveness/readiness probes (used by the systemd unit + YunoHost service check).
  app.get("/healthz", async () => ({ status: "ok" }));
  app.get("/readyz", async () => ({ status: "ready" }));

  return app;
}
