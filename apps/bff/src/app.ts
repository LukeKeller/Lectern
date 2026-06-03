import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { buildOpenApiDocument } from "@lectern/shared";
import type { ReadLaterBackend, RssBackend } from "@lectern/shared";
import type { OverlayStore, UnificationService } from "./unify";
import { registerAuth } from "./auth";
import { registerApiRoutes, NotFoundError } from "./routes";
import { buildRealDeps } from "./deps";
import { BackendHttpError } from "./errors";

/**
 * Injectable application dependencies. Tests pass in-memory fakes; production
 * uses the real backends + glue store (see `buildRealDeps`).
 */
export interface AppDeps {
  rss: RssBackend;
  readLater: ReadLaterBackend;
  overlay: OverlayStore;
  unify: UnificationService;
}

function statusCodeOf(err: unknown): number | undefined {
  if (typeof err === "object" && err !== null && "statusCode" in err) {
    const sc = (err as { statusCode?: unknown }).statusCode;
    if (typeof sc === "number") return sc;
  }
  return undefined;
}

/**
 * Builds the Fastify application. Kept separate from `server.ts` so tests can
 * exercise routes via `app.inject(...)` without binding a port. Dependencies are
 * injectable; when omitted they default to the real backends + glue store.
 */
export function buildApp(deps?: AppDeps): FastifyInstance {
  const app = Fastify({ logger: false });

  registerAuth(app);

  // Central error handler: shared-schema validation -> 400; backend 429 ->
  // propagate Retry-After; backend 404 -> 404; other backend faults -> 502;
  // everything else -> 500 with no stack leak.
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: "validation", issues: err.issues });
    }
    if (err instanceof NotFoundError) {
      return reply.code(404).send({ error: "not_found", message: err.message });
    }
    if (err instanceof BackendHttpError) {
      if (err.status === 429) {
        if (err.retryAfter) reply.header("retry-after", err.retryAfter);
        return reply.code(429).send({ error: "rate_limited" });
      }
      if (err.status === 404) return reply.code(404).send({ error: "not_found" });
      return reply.code(502).send({ error: "backend_error", status: err.status });
    }
    const sc = statusCodeOf(err);
    if (sc !== undefined && sc >= 400 && sc < 500) {
      return reply.code(sc).send({ error: err instanceof Error ? err.message : "request_error" });
    }
    app.log.error(err);
    return reply.code(500).send({ error: "internal_error" });
  });

  // Liveness/readiness probes (used by the systemd unit + YunoHost service check).
  app.get("/healthz", async () => ({ status: "ok" }));
  app.get("/readyz", async () => ({ status: "ready" }));

  // Serve the OpenAPI 3.1 document (no auth: outside the /api/v1 prefix).
  app.get("/api/openapi.json", async () => buildOpenApiDocument());

  const resolved = deps ?? buildRealDeps();
  app.register(
    async (instance) => {
      registerApiRoutes(instance, resolved);
    },
    { prefix: "/api/v1" },
  );

  return app;
}
