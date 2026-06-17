import { Readable } from "node:stream";
import type { FastifyInstance } from "fastify";
import type { AppDeps } from "./app";
import { parseId } from "./ids";
import { fetchRemoteImage, resolveImageTarget } from "./images";

/**
 * Article image proxy. Captured article HTML is rewritten (see `images.ts`) to
 * point every `<img>` here, so images load same-origin and work in production
 * where the backends aren't reachable from the browser. Lives OUTSIDE the
 * `/api/v1` bearer scope — an `<img>` can't send an Authorization header — so it
 * relies on the same SSO/dev-user gate as `/bootstrap`. Bytes are streamed: from
 * the read-later backend (authed) for in-archive refs, or fetched directly for
 * remote URLs (SSRF-guarded in `resolveImageTarget`).
 */
export function registerMediaRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get<{ Params: { id: string }; Querystring: { u?: string } }>(
    "/media/documents/:id/image",
    async (req, reply) => {
      const parsed = parseId(req.params.id);
      if (!parsed) return reply.code(404).send();
      const ref = typeof req.query.u === "string" ? req.query.u : "";
      if (!ref) return reply.code(400).send();

      // The card supplies the original URL for RSS relative-ref resolution and
      // as the `Referer` for hotlink-protected remotes. Tolerate a missing index.
      const card = await deps.overlay.getIndexedCard(req.params.id).catch(() => null);
      const target = resolveImageTarget(parsed.source, parsed.sourceId, ref, card?.url ?? null);
      if (!target) return reply.code(400).send();

      const resource =
        target.kind === "resource"
          ? deps.readLater.getResource
            ? await deps.readLater.getResource(target.sourceId, target.ref)
            : null
          : await fetchRemoteImage(target.url, target.referer);
      if (!resource) return reply.code(404).send();

      reply.header("content-type", resource.contentType);
      if (resource.contentLength != null)
        reply.header("content-length", String(resource.contentLength));
      // Images are content-addressed by URL; cache hard (the SW also keeps a copy).
      reply.header("cache-control", "public, max-age=604800");
      return reply.send(Readable.from(resource.body));
    },
  );
}
