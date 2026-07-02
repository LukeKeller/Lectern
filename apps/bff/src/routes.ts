import type { FastifyInstance } from "fastify";
import {
  BulkDeleteRequest,
  BulkDeleteResponse,
  BulkMaintenanceRequest,
  BulkMaintenanceResponse,
  Card,
  EmailIgnoreAddResponse,
  EmailIgnoreSenderRequest,
  EmailIgnoreSettings,
  CreateHighlightRequest,
  CreateViewRequest,
  ForceSyncResponse,
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
  FeedNotificationPref,
  FeedNotificationPrefsResponse,
  PlayerState,
  PodcastEpisode,
  PodcastSettings,
  PushOkResponse,
  PushPublicKeyResponse,
  PushSubscriptionRequest,
  PushUnsubscribeRequest,
  SetFeedNotificationRequest,
  SaveDocumentRequest,
  SavedView,
  SearchQuery,
  SearchResponse,
  SubscribeFeedRequest,
  SynthesizeAudioRequest,
  SyncPullQuery,
  SyncPullResponse,
  SyncPushRequest,
  SyncPushResponse,
  TagsResponse,
  TtsPreviewRequest,
  TtsSettings,
  TtsUsage,
  TtsVoicesResponse,
  type TtsProvider,
  UpdateDocumentRequest,
  UpdateFeedRequest,
  UpdateTtsSettingsRequest,
  UpdateViewRequest,
  ViewsResponse,
  type SyncConflict,
} from "@lectern/shared";
import { createHash } from "node:crypto";
import type { AppDeps } from "./app";
import type { DocumentRef } from "./unify";
import { accentFromUrl } from "./palette";
import { podcastFeedUrl, publicBaseUrl } from "./podcast";
import { rewriteArticleImages } from "./images";
import { parseId } from "./ids";
import { hasReadableText, htmlToText, stripUrls } from "./html-text";
import { parseReadwiseCsv, readwiseLocationToUnified } from "./csv";
import {
  deleteSubscription,
  listFeedPrefs,
  publicVapidKey,
  setFeedPref,
  upsertSubscription,
} from "./push";
import { MutationApplier } from "./mutations";
import { pollMiniflux, pollReadeck, reconcileDeletions } from "./jobs";

class NotFoundError extends Error {}

/** Carries an HTTP status the central error handler echoes back (4xx → that code
 * with `{ error: message }`). Used for the TTS pre-conditions (409 no key, 422
 * no readable text) shared by the Listen and podcast synthesis paths. */
class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Synthesize (or fetch from the content-hash cache) read-aloud audio for a
 * document. Shared by the Listen endpoint and the podcast publish endpoint so
 * they render byte-identical clips (and never double-bill ElevenLabs). The
 * optional `title` is spoken first so each article announces itself. Throws
 * `HttpError(409)` when no key is configured and `HttpError(422)` when the
 * document has no readable text.
 */
async function synthesizeDocument(
  deps: AppDeps,
  id: string,
  title: string | undefined,
): Promise<{ contentHash: string; mime: string; bytes: Buffer; charCount: number }> {
  const cfg = await deps.overlay.getTtsConfig();
  if (!ttsReady(cfg)) throw new HttpError(409, "TTS is not configured");
  const body = stripUrls(htmlToText(await loadContentHtml(deps, id)));
  if (!body) throw new HttpError(422, "no readable text for this document");
  const announce = title?.trim();
  const text = announce ? `${announce}.\n\n${body}` : body;
  // Voice ids never overlap between providers (ElevenLabs hex ids vs. Kokoro
  // names), so voice+model already namespaces the cache per provider.
  const contentHash = createHash("sha256")
    .update(`${cfg.voiceId}\n${cfg.modelId}\n${text}`)
    .digest("hex");
  const cached = await deps.overlay.getCachedAudio(contentHash);
  if (cached)
    return { contentHash, mime: cached.mime, bytes: cached.bytes, charCount: text.length };
  const bytes = await deps.tts.forProvider(cfg.provider).synthesize(text, {
    apiKey: cfg.apiKey ?? "",
    voiceId: cfg.voiceId,
    modelId: cfg.modelId,
  });
  await deps.overlay.putCachedAudio({
    contentHash,
    documentId: id,
    mime: "audio/mpeg",
    bytes,
    charCount: text.length,
  });
  return { contentHash, mime: "audio/mpeg", bytes, charCount: text.length };
}

/** Whether the configured provider is ready to synthesize. ElevenLabs needs a
 * per-user API key; the self-hosted Kokoro service needs none (its URL is server
 * config), so it's considered ready whenever it's the selected provider. */
function ttsReady(cfg: { provider: TtsProvider; apiKey: string | null }): boolean {
  return cfg.provider === "kokoro" || !!cfg.apiKey;
}

/** Short sample read aloud when auditioning a voice (kept brief to bound cost). */
const TTS_PREVIEW_TEXT = "This is a preview of how this voice sounds reading your articles aloud.";

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
  const mutations = new MutationApplier(deps);

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

    if (body.location !== undefined) await mutations.setLocation(parsed, id, body.location);
    if (body.tags !== undefined) await mutations.setTags(parsed, id, body.tags);
    if (body.readingProgress !== undefined)
      await mutations.setProgress(parsed, id, body.readingProgress, body.readAnchor ?? null);
    if (body.note !== undefined) await mutations.setNote(id, body.note);
    if (body.title !== undefined) await mutations.setTitle(id, body.title);

    const card = await loadDocument(deps, id);
    const withTitle = body.title ? { ...card, title: body.title } : card;
    return Card.parse(withTitle);
  });

  app.delete<{ Params: { id: string } }>("/documents/:id", async (req, reply) => {
    const { id } = req.params;
    const parsed = requireParsed(id);
    // Full delete: remove at the source (so the poll can't re-add it) then
    // tombstone locally (so the deletion syncs to other devices).
    await mutations.delete(parsed, id);
    return reply.code(204).send();
  });

  // Bulk delete: empty the archive, delete all read feed items, or delete every
  // read item (feed + newsletters). Removes each item at the source (so the poll
  // can't re-add it) then tombstones the index rows so the deletions ride the next
  // /sync delta out to other devices.
  app.post<{ Body: unknown }>("/documents/bulk-delete", async (req) => {
    const { scope } = BulkDeleteRequest.parse(req.body);
    let targets: DocumentRef[];
    if (scope === "archive") {
      targets = await deps.overlay.listByLocation("archive");
    } else if (scope === "read-feed") {
      targets = await deps.overlay.listReadBySource("miniflux");
    } else {
      // read-all: read feed items (MiniFlux) + read newsletters (Readeck email).
      // The two sets never overlap (distinct sources), so a plain concat is safe.
      const [feed, email] = await Promise.all([
        deps.overlay.listReadBySource("miniflux"),
        deps.overlay.listReadEmail(),
      ]);
      targets = [...feed, ...email];
    }
    await deleteTargets(deps, targets);
    return BulkDeleteResponse.parse({ deleted: targets.length });
  });

  // Age-based sweep over the unified index: delete (remove at the source so the
  // poll can't re-add them — the fix for a backend that re-serves stale entries)
  // or mark-read every live document matching the facets whose timestamp is older
  // than `before`. Powers "clean up items older than a week" and "clear
  // everything below this item" (the anchor's timestamp is sent as `before`).
  app.post<{ Body: unknown }>("/documents/bulk-maintenance", async (req) => {
    const body = BulkMaintenanceRequest.parse(req.body);
    const targets = await deps.overlay.listForMaintenance({
      location: body.location,
      source: body.source,
      category: body.category,
      before: new Date(body.before),
      dateField: body.dateField,
      inclusive: body.inclusive,
    });
    if (body.action === "delete") {
      await deleteTargets(deps, targets);
    } else {
      // Mark-read: flip the read flag at the source (MiniFlux batch PUT; Readeck
      // has no read enum, so completing its progress stands in) then mirror it
      // into the index so the lists/sync reflect it immediately.
      const minifluxIds = targets.filter((t) => t.source === "miniflux").map((t) => t.sourceId);
      await deps.rss.setReadMany(minifluxIds, true);
      const readeck = targets.filter((t) => t.source === "readeck");
      const concurrency = 5;
      for (let i = 0; i < readeck.length; i += concurrency) {
        await Promise.all(
          readeck
            .slice(i, i + concurrency)
            .map((t) => deps.readLater.setReadingProgress(t.sourceId, 1, null)),
        );
      }
      await deps.overlay.markIndexedReadMany(
        targets.map((t) => t.id),
        true,
      );
    }
    return BulkMaintenanceResponse.parse({ action: body.action, affected: targets.length });
  });

  // ---- newsletter ignore list --------------------------------------------
  app.get("/settings/email-ignore", async () => emailIgnoreSettings(deps));

  // Add a sender to the ignore list (skips its future emails at ingestion) AND
  // delete its already-saved emails. Cleanup matches the card author (== the
  // sender's display name), which is what the library and this list both show.
  app.post<{ Body: unknown }>("/settings/email-ignore", async (req) => {
    const { sender } = EmailIgnoreSenderRequest.parse(req.body);
    const current = await deps.overlay.getEmailIgnoreList();
    await deps.overlay.setEmailIgnoreList([...current, sender]);
    const existing = await deps.overlay.listEmailDocsBySender(sender);
    await deleteTargets(deps, existing);
    const settings = await emailIgnoreSettings(deps);
    return EmailIgnoreAddResponse.parse({ ...settings, removed: existing.length });
  });

  // Stop ignoring a sender. Existing emails are untouched (re-subscribe to get new).
  app.delete<{ Body: unknown }>("/settings/email-ignore", async (req) => {
    const { sender } = EmailIgnoreSenderRequest.parse(req.body);
    const target = sender.trim().toLowerCase();
    const current = await deps.overlay.getEmailIgnoreList();
    await deps.overlay.setEmailIgnoreList(current.filter((s) => s.trim().toLowerCase() !== target));
    return EmailIgnoreSettings.parse(await emailIgnoreSettings(deps));
  });

  app.get<{ Params: { id: string }; Querystring: { refresh?: string } }>(
    "/documents/:id/content",
    async (req) => {
      const { id } = req.params;
      requireParsed(id);
      // `?refresh=1` re-extracts from the original source, overwriting the cache.
      const refresh = req.query.refresh === "1" || req.query.refresh === "true";
      // Route the article's images through the same-origin proxy so they render
      // in the client (the backends aren't browser-reachable in production). The
      // stored copy stays faithful — only the served body is rewritten.
      const html = rewriteArticleImages(
        await loadContentHtml(deps, id, refresh),
        id,
        publicBaseUrl(req),
      );
      return DocumentContentResponse.parse({ id, html });
    },
  );

  // Adaptive reader accent derived from the cover image (computed once, cached).
  // Returns `{ color: "#rrggbb" | null }`; null means no usable colour.
  app.get<{ Params: { id: string } }>("/documents/:id/accent", async (req) => {
    const { id } = req.params;
    requireParsed(id);
    const cached = await deps.overlay.getAccent(id);
    if (cached !== undefined) return { color: cached };
    const card = await loadDocument(deps, id);
    const color = card.coverImage ? await accentFromUrl(card.coverImage) : null;
    await deps.overlay.putAccent(id, color);
    return { color };
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
    if (!ttsReady(cfg)) return reply.code(409).send({ error: "TTS is not configured" });
    try {
      const voices = await deps.tts.forProvider(cfg.provider).listVoices(cfg.apiKey ?? "");
      return TtsVoicesResponse.parse({ voices });
    } catch (err) {
      // A key can be valid for synthesis yet lack the "Voices read" permission
      // (ElevenLabs scoped keys → 401), or the Kokoro service may be briefly
      // unreachable. Don't fail the settings UI with a 502: return an empty list
      // so the client falls back to its built-in voices.
      app.log.warn({ err }, "listTtsVoices failed; returning empty list");
      return TtsVoicesResponse.parse({ voices: [] });
    }
  });

  // ElevenLabs account usage/quota for the configured key (characters spent this
  // billing period, plan tier, reset date). Read-only and never billed. Only the
  // ElevenLabs provider has a billed quota; 409 for any other provider.
  app.get("/settings/tts/usage", async (_req, reply) => {
    const cfg = await deps.overlay.getTtsConfig();
    const backend = deps.tts.forProvider(cfg.provider);
    if (cfg.provider !== "elevenlabs" || !cfg.apiKey || !backend.getUsage)
      return reply.code(409).send({ error: "usage is unavailable for this provider" });
    const usage = await backend.getUsage(cfg.apiKey);
    return TtsUsage.parse({
      tier: usage.tier,
      status: usage.status,
      characterCount: usage.characterCount,
      characterLimit: usage.characterLimit,
      nextResetAt: usage.nextResetUnix ? new Date(usage.nextResetUnix * 1000).toISOString() : null,
    });
  });

  // Synthesis fires ONLY here, on an explicit client Listen action. Cache-first
  // by content hash so re-listens and queue replays never re-bill ElevenLabs.
  app.post<{ Params: { id: string }; Body: unknown }>(
    "/documents/:id/audio",
    async (req, reply) => {
      const { id } = req.params;
      requireParsed(id);
      // `title`, when present, is spoken before the body so each article announces
      // itself (e.g. listening through a magazine issue). Baked into the per-article
      // audio so the same clip is reused from the card/reader (and the podcast feed).
      const { title } = SynthesizeAudioRequest.parse(req.body ?? {});
      const audio = await synthesizeDocument(deps, id, title);
      reply.header("content-type", audio.mime);
      reply.header("x-tts-content-hash", audio.contentHash);
      reply.header("cache-control", "private, max-age=31536000, immutable");
      return reply.send(audio.bytes);
    },
  );

  // Publish a document as a podcast episode: render (or reuse cached) audio and
  // record a self-contained episode row. Explicit opt-in — fires synthesis like
  // Listen, but returns metadata only (no bytes), so the UI never starts playback.
  app.post<{ Params: { id: string }; Body: unknown }>(
    "/documents/:id/podcast",
    async (req, reply) => {
      const { id } = req.params;
      requireParsed(id);
      const card = await loadDocument(deps, id);
      const announce = SynthesizeAudioRequest.parse(req.body ?? {}).title ?? card.title;
      const audio = await synthesizeDocument(deps, id, announce);
      // 128 kbps CBR → bytes*8/bitrate seconds. An estimate (no decode); good
      // enough for the <itunes:duration> hint.
      const durationSeconds = Math.round((audio.bytes.length * 8) / 128_000);
      const title = card.title || "Untitled";
      await deps.overlay.addPodcastEpisode({
        documentId: id,
        contentHash: audio.contentHash,
        title,
        sourceUrl: card.url ?? null,
        excerpt: card.excerpt ?? null,
        coverImage: card.coverImage ?? null,
        author: card.author ?? null,
        mime: audio.mime,
        byteLength: audio.bytes.length,
        durationSeconds,
      });
      const episode = await deps.overlay.getPodcastEpisode(id);
      reply.code(201);
      return PodcastEpisode.parse({
        documentId: id,
        title,
        durationSeconds,
        byteLength: audio.bytes.length,
        addedAt: (episode?.addedAt ?? new Date()).toISOString(),
      });
    },
  );

  // Podcast feed settings: the subscribe URL (token minted on first read) + count.
  app.get("/settings/podcast", async (req) => {
    const token = await deps.overlay.ensurePodcastToken();
    const episodes = await deps.overlay.listPodcastEpisodes();
    return PodcastSettings.parse({
      feedUrl: podcastFeedUrl(req, token),
      episodeCount: episodes.length,
    });
  });

  // Rotate the feed token, revoking the old subscribe URL.
  app.post("/settings/podcast/regenerate", async (req) => {
    const token = await deps.overlay.regeneratePodcastToken();
    const episodes = await deps.overlay.listPodcastEpisodes();
    return PodcastSettings.parse({
      feedUrl: podcastFeedUrl(req, token),
      episodeCount: episodes.length,
    });
  });

  // Short voice sample for auditioning. Same cache-first machinery (keyed by a
  // "preview" content hash) so re-auditioning a voice never re-bills.
  app.post<{ Body: unknown }>("/settings/tts/preview", async (req, reply) => {
    const cfg = await deps.overlay.getTtsConfig();
    if (!ttsReady(cfg)) return reply.code(409).send({ error: "TTS is not configured" });
    const { voiceId } = TtsPreviewRequest.parse(req.body);
    const voice = voiceId || cfg.voiceId;
    const contentHash = createHash("sha256")
      .update(`preview\n${voice}\n${cfg.modelId}\n${TTS_PREVIEW_TEXT}`)
      .digest("hex");
    let audio = await deps.overlay.getCachedAudio(contentHash);
    if (!audio) {
      const bytes = await deps.tts.forProvider(cfg.provider).synthesize(TTS_PREVIEW_TEXT, {
        apiKey: cfg.apiKey ?? "",
        voiceId: voice,
        modelId: cfg.modelId,
      });
      audio = { mime: "audio/mpeg", bytes };
      await deps.overlay.putCachedAudio({
        contentHash,
        documentId: `preview:${voice}`,
        mime: audio.mime,
        bytes,
        charCount: TTS_PREVIEW_TEXT.length,
      });
    }
    reply.header("content-type", audio.mime);
    reply.header("x-tts-content-hash", contentHash);
    reply.header("cache-control", "private, max-age=31536000, immutable");
    return reply.send(audio.bytes);
  });

  // Cross-device Listen player state: pause on one device, resume on another.
  app.get("/settings/player", async () => PlayerState.parse(await deps.overlay.getPlayerState()));
  app.patch<{ Body: unknown }>("/settings/player", async (req) => {
    const state = PlayerState.parse(req.body);
    return deps.overlay.setPlayerState(state);
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
      requireParsed(id);
      const body = CreateHighlightRequest.parse(req.body);
      const highlight = await mutations.addHighlight(id, {
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

  // ---- web push notifications --------------------------------------------
  app.get("/push/public-key", async () =>
    PushPublicKeyResponse.parse({ publicKey: publicVapidKey() }),
  );

  app.post<{ Body: unknown }>("/push/subscriptions", async (req) => {
    const body = PushSubscriptionRequest.parse(req.body);
    await upsertSubscription({
      endpoint: body.endpoint,
      p256dh: body.keys.p256dh,
      auth: body.keys.auth,
    });
    return PushOkResponse.parse({ ok: true });
  });

  app.delete<{ Body: unknown }>("/push/subscriptions", async (req) => {
    const body = PushUnsubscribeRequest.parse(req.body);
    await deleteSubscription(body.endpoint);
    return PushOkResponse.parse({ ok: true });
  });

  app.get("/push/feeds", async () => {
    const rows = await listFeedPrefs();
    return FeedNotificationPrefsResponse.parse({
      feeds: rows.map((r) => ({ feedId: r.feedId, enabled: r.enabled })),
    });
  });

  app.put<{ Params: { feedId: string }; Body: unknown }>("/push/feeds/:feedId", async (req) => {
    const body = SetFeedNotificationRequest.parse(req.body);
    const pref = await setFeedPref(req.params.feedId, body.enabled);
    return FeedNotificationPref.parse(pref);
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
        await mutations.apply(mutation);
        applied++;
      } catch (err) {
        conflicts.push({ id: mutation.id, reason: err instanceof Error ? err.message : "failed" });
      }
    }
    return SyncPushResponse.parse({ applied, conflicts });
  });

  // On-demand sync: run both backend polls then the deletion reconcile NOW,
  // instead of waiting for the 5-minute schedule. Polls are quick; await all so
  // the response reflects the freshly-reconciled state. The jobs construct their
  // own backend deps internally (safe standalone).
  app.post("/sync/force", async () => {
    const [miniflux, readeck] = await Promise.all([pollMiniflux(), pollReadeck()]);
    const tombstoned = await reconcileDeletions();
    return ForceSyncResponse.parse({ miniflux, readeck, tombstoned });
  });
}

function requireParsed(id: string) {
  const parsed = parseId(id);
  if (!parsed) throw new NotFoundError(`invalid document id: ${id}`);
  return parsed;
}

/**
 * Remove a set of index documents at their source, then tombstone the index
 * rows so the deletions ride the next `/sync` delta out to other devices. Shared
 * by every bulk-delete path (scope, age sweep, ignore-sender cleanup): one
 * batched `removed` PUT for MiniFlux, per-id Readeck deletes with modest
 * concurrency so a large set never opens hundreds of sockets.
 */
async function deleteTargets(deps: AppDeps, targets: DocumentRef[]): Promise<void> {
  if (targets.length === 0) return;
  const minifluxIds = targets.filter((t) => t.source === "miniflux").map((t) => t.sourceId);
  const readeck = targets.filter((t) => t.source === "readeck");
  await deps.rss.setRemoved(minifluxIds);
  const concurrency = 5;
  for (let i = 0; i < readeck.length; i += concurrency) {
    await Promise.all(
      readeck.slice(i, i + concurrency).map((t) => deps.readLater.delete(t.sourceId)),
    );
  }
  await deps.overlay.softDelete(targets.map((t) => t.id));
}

/** The ignore list plus the senders currently in the library (for one-tap add). */
async function emailIgnoreSettings(deps: AppDeps) {
  const [senders, known] = await Promise.all([
    deps.overlay.getEmailIgnoreList(),
    deps.overlay.listEmailSenders(),
  ]);
  return EmailIgnoreSettings.parse({ senders, known });
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
async function loadContentHtml(deps: AppDeps, id: string, refresh = false): Promise<string> {
  const parsed = requireParsed(id);
  // `refresh` forces a re-extract from the source, repairing a bad/partial capture;
  // otherwise serve the stored copy when present (fast, offline-able).
  if (!refresh) {
    const stored = await deps.overlay.getContent(id);
    // Ignore a cached body that extracted to empty markup (e.g. an earlier failed
    // scrape of a JS-only page) so it re-fetches and self-heals.
    if (stored && hasReadableText(stored.html)) return stored.html;
  }
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
    provider: cfg.provider,
    // Kokoro needs no key (server-configured URL), so it's "configured" whenever
    // selected; ElevenLabs is configured once a key is saved.
    configured: ttsReady(cfg),
    voiceId: cfg.voiceId,
    modelId: cfg.modelId,
  });
}

export { NotFoundError };
