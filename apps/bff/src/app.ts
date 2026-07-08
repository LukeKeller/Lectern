import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { buildOpenApiDocument } from "@lectern/shared";
import type { ReadLaterBackend, RssBackend } from "@lectern/shared";
import type { OverlayStore, UnificationService } from "./unify";
import type { TtsRouter } from "./backends/tts-router";
import { registerAuth } from "./auth";
import { registerApiRoutes, NotFoundError } from "./routes";
import { registerPodcastRoutes } from "./podcast";
import { registerMediaRoutes } from "./media";
import { buildRealDeps, type DiscoveryTrigger } from "./deps";
import { BackendHttpError } from "./errors";
import fastifyStatic from "@fastify/static";
import { resolve as resolvePath } from "node:path";
import { config } from "./config";

/**
 * Injectable application dependencies. Tests pass in-memory fakes; production
 * uses the real backends + glue store (see `buildRealDeps`).
 */
export interface AppDeps {
  rss: RssBackend;
  readLater: ReadLaterBackend;
  overlay: OverlayStore;
  unify: UnificationService;
  tts: TtsRouter;
  discovery: DiscoveryTrigger;
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
  app.setErrorHandler((err, req, reply) => {
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
    // Fastify's logger is disabled, so app.log.error is a no-op; surface
    // unexpected faults to stderr (the systemd journal) — a bare 500 with no
    // trace is undebuggable in production otherwise.
    console.error(`[lectern] 500 on ${req.method} ${req.url}:`, err);
    return reply.code(500).send({ error: "internal_error" });
  });

  // Liveness/readiness probes (used by the systemd unit + YunoHost service check).
  app.get("/healthz", async () => ({ status: "ok" }));
  app.get("/readyz", async () => ({ status: "ready" }));

  // SSO-gated bootstrap: served under the main permission (SSOwat injects
  // Ynh-User), so an authenticated web session can fetch the app's API token
  // and use it for the bearer-gated /api routes without a manual paste.
  app.get("/bootstrap", async (req) => ({ token: config.LECTERN_API_TOKEN, user: req.user }));

  // Serve the OpenAPI 3.1 document (no auth: outside the /api/v1 prefix).
  app.get("/api/openapi.json", async () => buildOpenApiDocument());

  const resolved = deps ?? buildRealDeps();
  app.register(
    async (instance) => {
      registerApiRoutes(instance, resolved);
    },
    { prefix: "/api/v1" },
  );
  // Public, token-gated podcast feed + episode audio (no bearer auth — podcast
  // clients can't send headers). Registered before the SPA fallback so the
  // notFound handler never swallows these routes.
  registerPodcastRoutes(app, resolved);
  // SSO-gated article image proxy (no bearer — an <img> can't send headers).
  // Also before the SPA fallback so its notFound handler can't swallow it.
  registerMediaRoutes(app, resolved);
  registerWebApp(app, resolved);
  return app;
}

/**
 * Production single-service mode: when LECTERN_WEB_DIR is set, the BFF also serves
 * the prebuilt web SPA and owns the Web Share Target endpoint. Skipped in tests
 * (LECTERN_WEB_DIR defaults to ""), so route tests stay API-only.
 */
function registerWebApp(app: FastifyInstance, deps: AppDeps): void {
  const webDir = config.LECTERN_WEB_DIR;
  if (!webDir) return;
  const root = resolvePath(webDir);

  // Parse Web Share Target form posts without pulling in an extra dependency.
  app.addContentTypeParser(
    "application/x-www-form-urlencoded",
    { parseAs: "string" },
    (_req, body, done) => {
      done(null, Object.fromEntries(new URLSearchParams(body as string)));
    },
  );

  // Web Share Target: the installed PWA posts a shared link here (same-origin,
  // SSO-gated in production). Save it, then redirect back into the app.
  app.post("/share-target", async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const shared = [body.url, body.text, body.title]
      .map((v) => (typeof v === "string" ? v : ""))
      .join(" ");
    const url = shared.match(/https?:\/\/\S+/)?.[0];
    if (url) await deps.readLater.save({ url });
    return reply.redirect("/", 303);
  });

  app.register(fastifyStatic, { root, wildcard: false });

  // SPA fallback: serve index.html for unmatched GETs that aren't API calls.
  app.setNotFoundHandler((req, reply) => {
    if (req.method === "GET" && !req.url.startsWith("/api")) {
      return reply.sendFile("index.html");
    }
    return reply.code(404).send({ error: "not_found" });
  });
}
