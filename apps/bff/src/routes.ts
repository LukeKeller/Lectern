import type { FastifyInstance } from "fastify";
import {
  Card,
  CreateHighlightRequest,
  CreateViewRequest,
  DocumentContentResponse,
  Feed,
  FeedsResponse,
  Highlight,
  HighlightsResponse,
  ImportOpmlRequest,
  ImportOpmlResponse,
  ImportReadwiseRequest,
  ImportReadwiseResponse,
  ListDocumentsQuery,
  ListDocumentsResponse,
  SaveDocumentRequest,
  SavedView,
  SearchQuery,
  SearchResponse,
  SubscribeFeedRequest,
  SyncPullQuery,
  SyncPullResponse,
  SyncPushRequest,
  SyncPushResponse,
  TagsResponse,
  TtsSettings,
  TtsVoicesResponse,
  UpdateDocumentRequest,
  UpdateFeedRequest,
  UpdateTtsSettingsRequest,
  UpdateViewRequest,
  ViewsResponse,
  type SyncConflict,
} from "@lectern/shared";
import { createHash } from "node:crypto";
import type { AppDeps } from "./app";
import { parseId } from "./ids";
import { htmlToText } from "./html-text";
import { parseReadwiseCsv, readwiseLocationToUnified } from "./csv";
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
    // Served from the unified index (single source of truth), not live backends.
    const page = await deps.overlay.listDocuments({
      location: q.location,
      category: q.category,
      source: q.source,
      tag: q.tag,
      search: q.search,
      pageSize: q.pageSize,
      cursor: q.cursor,
    });
    return ListDocumentsResponse.parse({
      results: page.cards,
      nextCursor: page.nextCursor,
      count: page.cards.length,
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
    requireParsed(id);
    return DocumentContentResponse.parse({ id, html: await loadContentHtml(deps, id) });
  });

  // ---- text-to-speech ("Listen") -----------------------------------------
  app.get("/settings/tts", async () => ttsSettings(deps));

  app.patch<{ Body: unknown }>("/settings/tts", async (req) => {
    const body = UpdateTtsSettingsRequest.parse(req.body);
    await deps.overlay.setTtsConfig(body);
    return ttsSettings(deps);
  });

  app.get("/settings/tts/voices", async (_req, reply) => {
    const cfg = await deps.overlay.getTtsConfig();
    if (!cfg.apiKey) return reply.code(409).send({ error: "TTS is not configured" });
    try {
      return TtsVoicesResponse.parse({ voices: await deps.tts.listVoices(cfg.apiKey) });
    } catch (err) {
      // A key can be valid for synthesis yet lack the "Voices read" permission
      // (ElevenLabs scoped keys → 401). Don't fail the settings UI with a 502:
      // return an empty list so the client falls back to its built-in voices.
      app.log.warn({ err }, "listTtsVoices failed; returning empty list");
      return TtsVoicesResponse.parse({ voices: [] });
    }
  });

  // Synthesis fires ONLY here, on an explicit client Listen action. Cache-first
  // by content hash so re-listens and queue replays never re-bill ElevenLabs.
  app.post<{ Params: { id: string } }>("/documents/:id/audio", async (req, reply) => {
    const { id } = req.params;
    requireParsed(id);
    const cfg = await deps.overlay.getTtsConfig();
    if (!cfg.apiKey) return reply.code(409).send({ error: "TTS is not configured" });
    const text = htmlToText(await loadContentHtml(deps, id));
    if (!text) return reply.code(422).send({ error: "no readable text for this document" });
    const contentHash = createHash("sha256")
      .update(`${cfg.voiceId}\n${cfg.modelId}\n${text}`)
      .digest("hex");
    let audio = await deps.overlay.getCachedAudio(contentHash);
    if (!audio) {
      const bytes = await deps.tts.synthesize(text, {
        apiKey: cfg.apiKey,
        voiceId: cfg.voiceId,
        modelId: cfg.modelId,
      });
      audio = { mime: "audio/mpeg", bytes };
      await deps.overlay.putCachedAudio({
        contentHash,
        documentId: id,
        mime: audio.mime,
        bytes,
        charCount: text.length,
      });
    }
    reply.header("content-type", audio.mime);
    reply.header("x-tts-content-hash", contentHash);
    reply.header("cache-control", "private, max-age=31536000, immutable");
    return reply.send(audio.bytes);
  });

  app.get("/search", async (req) => {
    const raw = req.query as Record<string, unknown>;
    const q = SearchQuery.parse({
      q: raw.q,
      limit: raw.limit !== undefined ? Number(raw.limit) : undefined,
    });
    const results = await deps.overlay.searchContent(q.q, q.limit);
    return SearchResponse.parse({ results });
  });

  // ---- highlights ---------------------------------------------------------
  app.get<{ Params: { id: string } }>("/documents/:id/highlights", async (req) => {
    const { id } = req.params;
    requireParsed(id);
    // Glue-owned for all sources (see applyAddHighlight).
    const highlights = await deps.overlay.listRssHighlights(id);
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

  // ---- feeds --------------------------------------------------------------
  app.get("/feeds", async () => {
    const { feeds, folders } = await deps.rss.listFeeds();
    return FeedsResponse.parse({ feeds, folders });
  });

  app.post<{ Body: unknown }>("/feeds", async (req, reply) => {
    const body = SubscribeFeedRequest.parse(req.body);
    const feed = await deps.rss.subscribe({ feedUrl: body.feedUrl, folderId: body.folderId });
    reply.code(201);
    return Feed.parse(feed);
  });

  app.patch<{ Params: { id: string }; Body: unknown }>("/feeds/:id", async (req) => {
    const body = UpdateFeedRequest.parse(req.body);
    const feed = await deps.rss.updateFeed(req.params.id, {
      folderId: body.folderId,
      title: body.title,
    });
    return Feed.parse(feed);
  });

  app.delete<{ Params: { id: string } }>("/feeds/:id", async (req, reply) => {
    await deps.rss.deleteFeed(req.params.id);
    return reply.code(204).send();
  });

  app.post("/feeds/refresh", async (_req, reply) => {
    await deps.rss.refresh();
    return reply.code(202).send();
  });

  app.post<{ Body: unknown }>("/feeds/import", async (req) => {
    const body = ImportOpmlRequest.parse(req.body);
    const message = await deps.rss.importOpml(body.opml);
    return ImportOpmlResponse.parse({ message });
  });

  app.post<{ Body: unknown }>("/import/readwise", async (req) => {
    const { csv } = ImportReadwiseRequest.parse(req.body);
    const rows = parseReadwiseCsv(csv);
    let imported = 0;
    let failed = 0;
    const concurrency = 6;
    for (let i = 0; i < rows.length; i += concurrency) {
      const results = await Promise.allSettled(
        rows.slice(i, i + concurrency).map(async (row) => {
          // Preserve the Readwise triage location. Readeck only models
          // archived-vs-not, so inbox/later/shortlist live in our index.
          const location = readwiseLocationToUnified(row.location);
          const sourceId = await deps.readLater.createBookmark({
            url: row.url,
            labels: row.tags,
            archived: location === "archive",
          });
          // Index the card immediately so it shows up before the next backend
          // poll (the index is the read source of truth). The CSV gives us the
          // title/url/tags/location; the poll later refreshes backend-truth.
          const now = new Date().toISOString();
          const card = Card.parse({
            id: `readeck:${sourceId}`,
            source: "readeck",
            sourceId,
            category: "article",
            location,
            readState: "unopened",
            title: row.title ?? "",
            url: row.url,
            tags: row.tags,
            savedAt: now,
            updatedAt: now,
          });
          await deps.overlay.upsertIndex(card);
        }),
      );
      for (const r of results) {
        if (r.status === "fulfilled") imported++;
        else failed++;
      }
    }
    return ImportReadwiseResponse.parse({ total: rows.length, imported, failed });
  });

  // ---- sync ---------------------------------------------------------------
  app.get("/sync", async (req) => {
    const q = coerceSyncQuery(req.query as Record<string, unknown>);
    // Read the delta straight from the unified index: documents changed since the
    // client's cursor, plus the ids tombstoned since then (backend deletions /
    // dedup). Backends are no longer queried on the read path.
    const delta = await deps.overlay.documentsChangedSince(q.since);
    return SyncPullResponse.parse({
      cards: delta.cards,
      deletedIds: delta.deletedIds,
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

/**
 * DB-first article HTML: serve our captured copy if present (fast, offline-able,
 * survives backend loss); on a miss fetch from the extractor once and own it.
 * Shared by the content endpoint and TTS synthesis so they read identical text.
 */
async function loadContentHtml(deps: AppDeps, id: string): Promise<string> {
  const parsed = requireParsed(id);
  const stored = await deps.overlay.getContent(id);
  if (stored) return stored.html;
  const html =
    parsed.source === "readeck"
      ? await deps.readLater.getContent(parsed.sourceId)
      : await deps.rss.getEntryContent(parsed.sourceId);
  await deps.overlay.putContent(id, html);
  return html;
}

/** Public TTS settings view (never leaks the API key — only whether one is set). */
async function ttsSettings(deps: AppDeps) {
  const cfg = await deps.overlay.getTtsConfig();
  return TtsSettings.parse({
    configured: !!cfg.apiKey,
    voiceId: cfg.voiceId,
    modelId: cfg.modelId,
  });
}

export { NotFoundError };
