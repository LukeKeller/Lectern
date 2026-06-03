import type { FastifyInstance } from "fastify";
import {
  Card,
  CreateHighlightRequest,
  CreateViewRequest,
  DocumentContentResponse,
  Highlight,
  HighlightsResponse,
  ListDocumentsQuery,
  ListDocumentsResponse,
  SaveDocumentRequest,
  SavedView,
  SyncPullQuery,
  SyncPullResponse,
  SyncPushRequest,
  SyncPushResponse,
  TagsResponse,
  UpdateDocumentRequest,
  UpdateViewRequest,
  ViewsResponse,
  type SyncConflict,
} from "@lectern/shared";
import type { AppDeps } from "./app";
import { parseId } from "./ids";
import {
  applyAddHighlight,
  applyLocation,
  applyMutation,
  applyNote,
  applyProgress,
  applyTags,
} from "./mutations";

class NotFoundError extends Error {}

function coerceListQuery(raw: Record<string, unknown>): ListDocumentsQuery {
  return ListDocumentsQuery.parse({
    ...raw,
    pageSize: raw.pageSize !== undefined ? Number(raw.pageSize) : undefined,
    withContent:
      raw.withContent !== undefined
        ? raw.withContent === "true" || raw.withContent === true
        : undefined,
  });
}

function coerceSyncQuery(raw: Record<string, unknown>): SyncPullQuery {
  return SyncPullQuery.parse({
    ...raw,
    pageSize: raw.pageSize !== undefined ? Number(raw.pageSize) : undefined,
  });
}

/**
 * Registers every endpoint from the shared `endpoints` registry under the caller's
 * prefix (`/api/v1`). Inputs are validated against the shared request schemas
 * (a thrown `ZodError` becomes a 400 in the central error handler) and responses
 * are shaped with the response schemas.
 */
export function registerApiRoutes(app: FastifyInstance, deps: AppDeps): void {
  // ---- documents ----------------------------------------------------------
  app.get("/documents", async (req) => {
    const q = coerceListQuery(req.query as Record<string, unknown>);
    const page = await deps.unify.list({
      updatedAfter: q.updatedAfter,
      cursor: q.cursor,
      pageSize: q.pageSize,
      search: q.search,
    });
    let results = page.items;
    if (q.location) results = results.filter((c) => c.location === q.location);
    if (q.category) results = results.filter((c) => c.category === q.category);
    if (q.source) results = results.filter((c) => c.source === q.source);
    if (q.tag) results = results.filter((c) => c.tags.includes(q.tag as string));
    return ListDocumentsResponse.parse({
      results,
      nextCursor: page.nextCursor,
      count: results.length,
    });
  });

  app.post<{ Body: unknown }>("/documents", async (req, reply) => {
    const body = SaveDocumentRequest.parse(req.body);
    const sourceId = await deps.readLater.save({
      url: body.url,
      html: body.html,
      labels: body.tags,
    });
    let card = await deps.readLater.get(sourceId);
    card = { ...card, location: body.location, tags: body.tags.length > 0 ? body.tags : card.tags };
    if (body.title) card = { ...card, title: body.title };
    await deps.overlay.upsertIndex(card);
    reply.code(201);
    return Card.parse(card);
  });

  app.get<{ Params: { id: string } }>("/documents/:id", async (req) => {
    const card = await loadDocument(deps, req.params.id);
    return Card.parse(card);
  });

  app.patch<{ Params: { id: string }; Body: unknown }>("/documents/:id", async (req) => {
    const { id } = req.params;
    const parsed = requireParsed(id);
    const body = UpdateDocumentRequest.parse(req.body);

    if (body.location !== undefined) await applyLocation(deps, parsed, id, body.location);
    if (body.tags !== undefined) await applyTags(deps, parsed, id, body.tags);
    if (body.readingProgress !== undefined)
      await applyProgress(deps, parsed, id, body.readingProgress, body.readAnchor ?? null);
    if (body.note !== undefined) await applyNote(deps, parsed, id, body.note);
    if (body.title !== undefined) await deps.overlay.upsertOverlay(id, { title: body.title });

    const card = await loadDocument(deps, id);
    const withTitle = body.title ? { ...card, title: body.title } : card;
    return Card.parse(withTitle);
  });

  app.delete<{ Params: { id: string } }>("/documents/:id", async (req, reply) => {
    const { id } = req.params;
    requireParsed(id);
    await deps.overlay.deleteDocument(id);
    return reply.code(204).send();
  });

  app.get<{ Params: { id: string } }>("/documents/:id/content", async (req) => {
    const { id } = req.params;
    const parsed = requireParsed(id);
    const html =
      parsed.source === "readeck"
        ? await deps.readLater.getContent(parsed.sourceId)
        : await deps.rss.getEntryContent(parsed.sourceId);
    return DocumentContentResponse.parse({ id, html });
  });

  // ---- highlights ---------------------------------------------------------
  app.get<{ Params: { id: string } }>("/documents/:id/highlights", async (req) => {
    const { id } = req.params;
    const parsed = requireParsed(id);
    const highlights =
      parsed.source === "readeck"
        ? await deps.readLater.listHighlights(parsed.sourceId)
        : await deps.overlay.listRssHighlights(id);
    return HighlightsResponse.parse({ highlights });
  });

  app.post<{ Params: { id: string }; Body: unknown }>(
    "/documents/:id/highlights",
    async (req, reply) => {
      const { id } = req.params;
      const parsed = requireParsed(id);
      const body = CreateHighlightRequest.parse(req.body);
      const highlight = await applyAddHighlight(deps, parsed, id, {
        text: body.text,
        color: body.color,
        note: body.note,
        startSelector: body.startSelector,
        startOffset: body.startOffset,
        endSelector: body.endSelector,
        endOffset: body.endOffset,
      });
      reply.code(201);
      return Highlight.parse(highlight);
    },
  );

  app.delete<{ Params: { id: string } }>("/highlights/:id", async (req, reply) => {
    // The path carries only the highlight id, so this resolves BFF-owned RSS
    // highlights (deletable by id). Readeck annotations require the owning
    // bookmark id and are removed via `POST /sync` removeHighlight instead.
    const ok = await deps.overlay.removeRssHighlight(req.params.id);
    if (!ok) throw new NotFoundError(`highlight not found: ${req.params.id}`);
    return reply.code(204).send();
  });

  // ---- tags ---------------------------------------------------------------
  app.get("/tags", async () => TagsResponse.parse({ tags: await deps.overlay.listTags() }));

  // ---- saved views --------------------------------------------------------
  app.get("/views", async () => ViewsResponse.parse({ views: await deps.overlay.listViews() }));

  app.post<{ Body: unknown }>("/views", async (req, reply) => {
    const body = CreateViewRequest.parse(req.body);
    const view = await deps.overlay.createView(body);
    reply.code(201);
    return SavedView.parse(view);
  });

  app.patch<{ Params: { id: string }; Body: unknown }>("/views/:id", async (req) => {
    const body = UpdateViewRequest.parse(req.body);
    const view = await deps.overlay.updateView(req.params.id, body);
    if (!view) throw new NotFoundError(`view not found: ${req.params.id}`);
    return SavedView.parse(view);
  });

  app.delete<{ Params: { id: string } }>("/views/:id", async (req, reply) => {
    const ok = await deps.overlay.deleteView(req.params.id);
    if (!ok) throw new NotFoundError(`view not found: ${req.params.id}`);
    return reply.code(204).send();
  });

  // ---- sync ---------------------------------------------------------------
  app.get("/sync", async (req) => {
    const q = coerceSyncQuery(req.query as Record<string, unknown>);
    const page = await deps.unify.list({ updatedAfter: q.since, pageSize: q.pageSize });
    return SyncPullResponse.parse({
      cards: page.items,
      deletedIds: [],
      cursor: new Date().toISOString(),
    });
  });

  app.post<{ Body: unknown }>("/sync", async (req) => {
    const body = SyncPushRequest.parse(req.body);
    let applied = 0;
    const conflicts: SyncConflict[] = [];
    for (const mutation of body.mutations) {
      try {
        await applyMutation(deps, mutation);
        applied++;
      } catch (err) {
        conflicts.push({ id: mutation.id, reason: err instanceof Error ? err.message : "failed" });
      }
    }
    return SyncPushResponse.parse({ applied, conflicts });
  });
}

function requireParsed(id: string) {
  const parsed = parseId(id);
  if (!parsed) throw new NotFoundError(`invalid document id: ${id}`);
  return parsed;
}

/** Load a single document: live from Readeck (overlaid), from the index for RSS. */
async function loadDocument(deps: AppDeps, id: string): Promise<Card> {
  const parsed = requireParsed(id);
  if (parsed.source === "readeck") {
    const [card] = await deps.unify.applyOverlays([await deps.readLater.get(parsed.sourceId)]);
    if (!card) throw new NotFoundError(`document not found: ${id}`);
    return card;
  }
  const card = await deps.overlay.getIndexedCard(id);
  if (!card) throw new NotFoundError(`document not found: ${id}`);
  return card;
}

export { NotFoundError };
