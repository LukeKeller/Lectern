import { z } from "zod";
import { Card, Category, Highlight, HighlightColor, Location, Source, Tag } from "./model";
import { Feed, FeedFolder } from "./feeds";
import { SyncPullResponse, SyncPushRequest, SyncPushResponse } from "./sync";
import {
  BulkDeleteRequest,
  BulkDeleteResponse,
  BulkMaintenanceRequest,
  BulkMaintenanceResponse,
  ForceSyncResponse,
} from "./maintenance";
import { SavedView } from "./views";
import {
  FeedNotificationPref,
  FeedNotificationPrefsResponse,
  PushOkResponse,
  PushPublicKeyResponse,
  PushSubscriptionRequest,
  PushUnsubscribeRequest,
  SetFeedNotificationRequest,
} from "./push";
import {
  ClearCandidatesRequest,
  ClearCandidatesResponse,
  CreateCandidatesRequest,
  CreateCandidatesResponse,
  CreateRunRequest,
  DiscoveryCandidate,
  DiscoveryCandidatesResponse,
  DiscoveryConfig,
  DiscoveryProfile,
  DiscoveryRun,
  DiscoveryRunsResponse,
  DiscoverySeed,
  DiscoverySettings,
  DismissFollowRequest,
  DismissFollowResponse,
  ExtractContentRequest,
  ExtractContentResponse,
  FollowDomainRequest,
  FollowDomainResponse,
  FollowSuggestionsResponse,
  LatestRunResponse,
  ListCandidatesQuery,
  ListRunsQuery,
  PutDiscoveryProfileRequest,
  TriggerRunResponse,
  UnprocessedVotesResponse,
  UpdateDiscoverySettingsRequest,
  UpdateRunRequest,
  VoteRequest,
} from "./discovery";

/**
 * The unified Lectern API contract. Mirrors the Readwise Reader API surface
 * (documents CRUD + tags + sync) over both backends. Request/response schemas are
 * the single source of truth: the BFF validates against them and the typed client
 * (packages/api-client) is built on them. `buildOpenApiDocument()` emits the spec.
 */

// ---- Request / response schemas --------------------------------------------

export const ListDocumentsQuery = z.object({
  location: Location.optional(),
  category: Category.optional(),
  source: Source.optional(),
  tag: z.string().optional(),
  search: z.string().optional(),
  updatedAfter: z.string().optional(),
  cursor: z.string().optional(),
  pageSize: z.number().int().positive().max(200).default(50),
  withContent: z.boolean().default(false),
});
export type ListDocumentsQuery = z.infer<typeof ListDocumentsQuery>;

export const ListDocumentsResponse = z.object({
  results: z.array(Card),
  nextCursor: z.string().nullable().default(null),
  count: z.number().int().nonnegative(),
});
export type ListDocumentsResponse = z.infer<typeof ListDocumentsResponse>;

export const SaveDocumentRequest = z.object({
  url: z.url(),
  html: z.string().optional(),
  title: z.string().optional(),
  tags: z.array(z.string()).default([]),
  location: Location.default("inbox"),
});
export type SaveDocumentRequest = z.infer<typeof SaveDocumentRequest>;

export const UpdateDocumentRequest = z.object({
  location: Location.optional(),
  readingProgress: z.number().min(0).max(1).optional(),
  readAnchor: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
  title: z.string().optional(),
  note: z.string().nullable().optional(),
});
export type UpdateDocumentRequest = z.infer<typeof UpdateDocumentRequest>;

export const DocumentContentResponse = z.object({ id: z.string(), html: z.string() });
export type DocumentContentResponse = z.infer<typeof DocumentContentResponse>;

/** The cover-derived reader accent: a hex colour, or null when there's none. */
export const DocumentAccentResponse = z.object({ color: z.string().nullable() });
export type DocumentAccentResponse = z.infer<typeof DocumentAccentResponse>;

/**
 * A publication's "dress": a small set of theming tokens extracted from the
 * source site's `<head>` (brand accent, favicon, an optional Google-hosted
 * display font). Cached per host, not per document — every article from a
 * source shares it. Each field is null when the source doesn't expose it.
 */
export const SourceThemeResponse = z.object({
  /** Brand accent for light chrome, `#rrggbb`, or null. */
  accent: z.string().nullable(),
  /** Brand accent for dark chrome (the source's dark-mode theme-color), or null. */
  accentDark: z.string().nullable(),
  /** Reading-surface background for light themes (literal from the source's CSS,
   *  or a brand-derived tint), `#rrggbb`, or null. */
  background: z.string().nullable(),
  /** Reading-surface background for dark themes, `#rrggbb`, or null. */
  backgroundDark: z.string().nullable(),
  /** Body text colour, `#rrggbb`, or null (the reader keeps its own when null). */
  text: z.string().nullable(),
  /** Link colour for the reading column, `#rrggbb`, or null (falls back to accent). */
  link: z.string().nullable(),
  /** Body font family name applied to the reading column in Full mode, or null. */
  bodyFont: z.string().nullable(),
  /** Heading/display font family (headline slots), or null. */
  displayFont: z.string().nullable(),
  faviconUrl: z.string().nullable(),
  /** The publication's own name (og:site_name / application-name / title), or null. */
  siteName: z.string().nullable(),
  /** How the palette was obtained: `literal` (parsed from the source's own CSS) or
   *  `derived` (synthesized from the brand accent + favicon when the CSS was
   *  unreadable). Null when no re-skin palette was produced. */
  derivation: z.enum(["literal", "derived"]).nullable(),
});
export type SourceThemeResponse = z.infer<typeof SourceThemeResponse>;

/** One cached source's tokens plus its host + when it was last fetched. Powers the
 *  Settings "Cached sources" summary (what's been parsed and saved per source). */
export const SourceThemeSummary = SourceThemeResponse.extend({
  host: z.string(),
  fetchedAt: z.string(),
});
export type SourceThemeSummary = z.infer<typeof SourceThemeSummary>;

export const SourceThemesResponse = z.object({ themes: z.array(SourceThemeSummary) });
export type SourceThemesResponse = z.infer<typeof SourceThemesResponse>;

export const SearchQuery = z.object({
  q: z.string().min(1),
  limit: z.number().int().min(1).max(50).default(20),
});
export type SearchQuery = z.infer<typeof SearchQuery>;

/** A full-text hit: the document id, a plain-text snippet, and a relevance rank. */
export const SearchResult = z.object({ id: z.string(), snippet: z.string(), rank: z.number() });
export type SearchResult = z.infer<typeof SearchResult>;

export const SearchResponse = z.object({ results: z.array(SearchResult) });
export type SearchResponse = z.infer<typeof SearchResponse>;

export const CreateHighlightRequest = z.object({
  text: z.string(),
  color: HighlightColor.default("yellow"),
  note: z.string().nullable().default(null),
  startSelector: z.string(),
  startOffset: z.number().int().nonnegative(),
  endSelector: z.string(),
  endOffset: z.number().int().nonnegative(),
});
export type CreateHighlightRequest = z.infer<typeof CreateHighlightRequest>;

export const HighlightsResponse = z.object({ highlights: z.array(Highlight) });
export type HighlightsResponse = z.infer<typeof HighlightsResponse>;

export const TagsResponse = z.object({ tags: z.array(Tag) });
export type TagsResponse = z.infer<typeof TagsResponse>;

export const CreateViewRequest = SavedView.omit({ id: true, createdAt: true, updatedAt: true });
export type CreateViewRequest = z.infer<typeof CreateViewRequest>;

export const UpdateViewRequest = CreateViewRequest.partial();
export type UpdateViewRequest = z.infer<typeof UpdateViewRequest>;

export const ViewsResponse = z.object({ views: z.array(SavedView) });
export type ViewsResponse = z.infer<typeof ViewsResponse>;

export const SyncPullQuery = z.object({
  since: z.string().optional(),
  pageSize: z.number().int().positive().max(500).default(200),
});
export type SyncPullQuery = z.infer<typeof SyncPullQuery>;

export const FeedsResponse = z.object({ feeds: z.array(Feed), folders: z.array(FeedFolder) });
export type FeedsResponse = z.infer<typeof FeedsResponse>;

export const SubscribeFeedRequest = z.object({
  feedUrl: z.url(),
  folderId: z.string().optional(),
});
export type SubscribeFeedRequest = z.infer<typeof SubscribeFeedRequest>;

export const UpdateFeedRequest = z.object({
  folderId: z.string().nullable().optional(),
  title: z.string().optional(),
});
export type UpdateFeedRequest = z.infer<typeof UpdateFeedRequest>;

export const ImportOpmlRequest = z.object({ opml: z.string() });
export type ImportOpmlRequest = z.infer<typeof ImportOpmlRequest>;

export const ImportOpmlResponse = z.object({ message: z.string() });
export type ImportOpmlResponse = z.infer<typeof ImportOpmlResponse>;

export const ImportReadwiseRequest = z.object({ csv: z.string() });
export type ImportReadwiseRequest = z.infer<typeof ImportReadwiseRequest>;

export const ImportReadwiseResponse = z.object({
  total: z.number().int().nonnegative(),
  imported: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
});
export type ImportReadwiseResponse = z.infer<typeof ImportReadwiseResponse>;

// ---- Text-to-speech (ElevenLabs "Listen") ----------------------------------

/** Which speech engine synthesizes audio. `elevenlabs` is the hosted default
 * (per-user API key); `kokoro` is a self-hosted Kokoro-FastAPI sibling service
 * the operator points the BFF at via `KOKORO_BASE_URL` (no key, no quota). */
export const TtsProvider = z.enum(["elevenlabs", "kokoro"]);
export type TtsProvider = z.infer<typeof TtsProvider>;

/** TTS config exposed to the client. The API key is write-only and NEVER read
 * back — only whether one is configured. */
export const TtsSettings = z.object({
  provider: TtsProvider.default("elevenlabs"),
  configured: z.boolean(),
  voiceId: z.string(),
  modelId: z.string(),
});
export type TtsSettings = z.infer<typeof TtsSettings>;

/** Partial update. `apiKey` omitted = leave unchanged; null/"" = clear it. */
export const UpdateTtsSettingsRequest = z.object({
  provider: TtsProvider.optional(),
  apiKey: z.string().nullable().optional(),
  voiceId: z.string().optional(),
  modelId: z.string().optional(),
});
export type UpdateTtsSettingsRequest = z.infer<typeof UpdateTtsSettingsRequest>;

export const TtsVoice = z.object({ id: z.string(), name: z.string() });
export type TtsVoice = z.infer<typeof TtsVoice>;

// ---- Email newsletter ignore list ------------------------------------------

/** A newsletter sender present in the library: the display name (== the card
 * author / sender label) and how many of its emails are currently saved. Drives
 * the one-tap "ignore this sender" affordance in Settings. */
export const EmailSender = z.object({ name: z.string(), count: z.number().int().nonnegative() });
export type EmailSender = z.infer<typeof EmailSender>;

/** The newsletter ignore list plus the senders currently in the library. An
 * ignored entry is matched case-insensitively against each incoming message's
 * From name AND address, so it can be either. */
export const EmailIgnoreSettings = z.object({
  senders: z.array(z.string()),
  known: z.array(EmailSender),
});
export type EmailIgnoreSettings = z.infer<typeof EmailIgnoreSettings>;

/** Add/remove a single sender from the ignore list. */
export const EmailIgnoreSenderRequest = z.object({ sender: z.string().min(1) });
export type EmailIgnoreSenderRequest = z.infer<typeof EmailIgnoreSenderRequest>;

/** Adding a sender also deletes its already-ingested emails; `removed` counts them. */
export const EmailIgnoreAddResponse = z.object({
  senders: z.array(z.string()),
  known: z.array(EmailSender),
  removed: z.number().int().nonnegative(),
});
export type EmailIgnoreAddResponse = z.infer<typeof EmailIgnoreAddResponse>;

export const TtsVoicesResponse = z.object({ voices: z.array(TtsVoice) });
export type TtsVoicesResponse = z.infer<typeof TtsVoicesResponse>;

/** ElevenLabs account usage/quota for the configured key, surfaced in Settings.
 * Mirrors `GET /v1/user/subscription`: how many characters the current billing
 * period has spent against its quota, the plan tier, and when usage resets. */
export const TtsUsage = z.object({
  tier: z.string(),
  status: z.string().nullable().default(null),
  /** Characters synthesized so far this billing period. */
  characterCount: z.number().int().nonnegative(),
  /** Character quota for the period (0 when the plan reports no limit). */
  characterLimit: z.number().int().nonnegative(),
  /** ISO timestamp when the period counter resets, or null if unknown. */
  nextResetAt: z.string().nullable().default(null),
});
export type TtsUsage = z.infer<typeof TtsUsage>;

/** Request a short spoken sample of a voice (returns audio bytes, not JSON). */
export const TtsPreviewRequest = z.object({ voiceId: z.string() });
export type TtsPreviewRequest = z.infer<typeof TtsPreviewRequest>;

/** Optional metadata for a document synthesis (returns audio bytes, not JSON).
 * `title`, when present, is spoken before the body so each article announces
 * itself — useful when listening through a whole magazine issue. */
export const SynthesizeAudioRequest = z.object({ title: z.string().optional() });
export type SynthesizeAudioRequest = z.infer<typeof SynthesizeAudioRequest>;

// ---- Podcast feed ----------------------------------------------------------

/** A published podcast episode: one saved article rendered to audio and exposed
 * through the tokenized RSS feed. The audio bytes live in the TTS cache; this is
 * the feed-facing metadata returned when an episode is added. */
export const PodcastEpisode = z.object({
  documentId: z.string(),
  title: z.string(),
  durationSeconds: z.number().int().nonnegative(),
  byteLength: z.number().int().nonnegative(),
  addedAt: z.string(),
});
export type PodcastEpisode = z.infer<typeof PodcastEpisode>;

/** Podcast settings surfaced in the UI: the subscribe URL (token baked in) and
 * how many episodes the feed currently holds. */
export const PodcastSettings = z.object({
  feedUrl: z.string(),
  episodeCount: z.number().int().nonnegative(),
});
export type PodcastSettings = z.infer<typeof PodcastSettings>;

// ---- Listen player state (synced across devices) ---------------------------

export const PlayerQueueItem = z.object({ id: z.string(), title: z.string() });
export type PlayerQueueItem = z.infer<typeof PlayerQueueItem>;

/** The "Listen" player's cross-device state: queue, current track, position,
 * speed. `updatedAt` is server-set on each save (last-write-wins). */
export const PlayerState = z.object({
  queue: z.array(PlayerQueueItem).default([]),
  index: z.number().int().default(-1),
  position: z.number().nonnegative().default(0),
  rate: z.number().positive().default(1),
  updatedAt: z.string().nullable().default(null),
});
export type PlayerState = z.infer<typeof PlayerState>;

// ---- Endpoint registry ------------------------------------------------------

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface Endpoint {
  method: HttpMethod;
  /** Express-style path with `:param` segments. */
  path: string;
  operationId: string;
  summary: string;
  tags: string[];
  query?: z.ZodType;
  body?: z.ZodType;
  response?: z.ZodType;
  status: number;
}

export const endpoints: Endpoint[] = [
  {
    method: "GET",
    path: "/documents",
    operationId: "listDocuments",
    summary: "List documents",
    tags: ["documents"],
    query: ListDocumentsQuery,
    response: ListDocumentsResponse,
    status: 200,
  },
  {
    method: "GET",
    path: "/search",
    operationId: "search",
    summary: "Full-text search over owned article bodies",
    tags: ["documents"],
    query: SearchQuery,
    response: SearchResponse,
    status: 200,
  },
  {
    method: "POST",
    path: "/documents",
    operationId: "saveDocument",
    summary: "Save a document",
    tags: ["documents"],
    body: SaveDocumentRequest,
    response: Card,
    status: 201,
  },
  {
    method: "GET",
    path: "/documents/:id",
    operationId: "getDocument",
    summary: "Get a document",
    tags: ["documents"],
    response: Card,
    status: 200,
  },
  {
    method: "PATCH",
    path: "/documents/:id",
    operationId: "updateDocument",
    summary: "Update a document",
    tags: ["documents"],
    body: UpdateDocumentRequest,
    response: Card,
    status: 200,
  },
  {
    method: "DELETE",
    path: "/documents/:id",
    operationId: "deleteDocument",
    summary: "Delete a document",
    tags: ["documents"],
    status: 204,
  },
  {
    method: "POST",
    path: "/documents/bulk-delete",
    operationId: "bulkDeleteDocuments",
    summary: "Bulk delete documents (empty archive or delete read feed items)",
    tags: ["documents"],
    body: BulkDeleteRequest,
    response: BulkDeleteResponse,
    status: 200,
  },
  {
    method: "POST",
    path: "/documents/bulk-maintenance",
    operationId: "bulkMaintenance",
    summary: "Delete or mark-read documents older than a cutoff (by location/source)",
    tags: ["documents"],
    body: BulkMaintenanceRequest,
    response: BulkMaintenanceResponse,
    status: 200,
  },
  {
    method: "GET",
    path: "/documents/:id/content",
    operationId: "getDocumentContent",
    summary: "Get article HTML",
    tags: ["documents"],
    response: DocumentContentResponse,
    status: 200,
  },
  {
    method: "GET",
    path: "/documents/:id/accent",
    operationId: "getDocumentAccent",
    summary: "Get the cover-derived reader accent colour",
    tags: ["documents"],
    response: DocumentAccentResponse,
    status: 200,
  },
  {
    method: "GET",
    path: "/documents/:id/source-theme",
    operationId: "getSourceTheme",
    summary: "Get the source publication's theming tokens (accent, favicon, font)",
    tags: ["documents"],
    response: SourceThemeResponse,
    status: 200,
  },
  {
    method: "GET",
    path: "/source-themes",
    operationId: "listSourceThemes",
    summary: "List every cached per-source theme (what's parsed and saved per host)",
    tags: ["documents"],
    response: SourceThemesResponse,
    status: 200,
  },
  {
    method: "DELETE",
    path: "/source-themes",
    operationId: "clearSourceThemes",
    summary: "Clear the source-theme cache so every host re-fetches on next open",
    tags: ["documents"],
    status: 204,
  },
  {
    method: "GET",
    path: "/documents/:id/highlights",
    operationId: "listHighlights",
    summary: "List highlights for a document",
    tags: ["highlights"],
    response: HighlightsResponse,
    status: 200,
  },
  {
    method: "POST",
    path: "/documents/:id/highlights",
    operationId: "createHighlight",
    summary: "Create a highlight",
    tags: ["highlights"],
    body: CreateHighlightRequest,
    response: Highlight,
    status: 201,
  },
  {
    method: "DELETE",
    path: "/highlights/:id",
    operationId: "deleteHighlight",
    summary: "Delete a highlight",
    tags: ["highlights"],
    status: 204,
  },
  {
    method: "GET",
    path: "/tags",
    operationId: "listTags",
    summary: "List tags",
    tags: ["tags"],
    response: TagsResponse,
    status: 200,
  },
  {
    method: "GET",
    path: "/views",
    operationId: "listViews",
    summary: "List saved views",
    tags: ["views"],
    response: ViewsResponse,
    status: 200,
  },
  {
    method: "POST",
    path: "/views",
    operationId: "createView",
    summary: "Create a saved view",
    tags: ["views"],
    body: CreateViewRequest,
    response: SavedView,
    status: 201,
  },
  {
    method: "PATCH",
    path: "/views/:id",
    operationId: "updateView",
    summary: "Update a saved view",
    tags: ["views"],
    body: UpdateViewRequest,
    response: SavedView,
    status: 200,
  },
  {
    method: "DELETE",
    path: "/views/:id",
    operationId: "deleteView",
    summary: "Delete a saved view",
    tags: ["views"],
    status: 204,
  },
  {
    method: "GET",
    path: "/sync",
    operationId: "syncPull",
    summary: "Pull changes since a cursor",
    tags: ["sync"],
    query: SyncPullQuery,
    response: SyncPullResponse,
    status: 200,
  },
  {
    method: "POST",
    path: "/sync",
    operationId: "syncPush",
    summary: "Push queued mutations",
    tags: ["sync"],
    body: SyncPushRequest,
    response: SyncPushResponse,
    status: 200,
  },
  {
    method: "POST",
    path: "/sync/force",
    operationId: "forceSync",
    summary: "Run backend polls + deletion reconcile now",
    tags: ["sync"],
    response: ForceSyncResponse,
    status: 200,
  },
  {
    method: "GET",
    path: "/feeds",
    operationId: "listFeeds",
    summary: "List feeds and folders",
    tags: ["feeds"],
    response: FeedsResponse,
    status: 200,
  },
  {
    method: "POST",
    path: "/feeds",
    operationId: "subscribeFeed",
    summary: "Subscribe to a feed",
    tags: ["feeds"],
    body: SubscribeFeedRequest,
    response: Feed,
    status: 201,
  },
  {
    method: "PATCH",
    path: "/feeds/:id",
    operationId: "updateFeed",
    summary: "Update a feed (rename / move folder)",
    tags: ["feeds"],
    body: UpdateFeedRequest,
    response: Feed,
    status: 200,
  },
  {
    method: "DELETE",
    path: "/feeds/:id",
    operationId: "deleteFeed",
    summary: "Unsubscribe from a feed",
    tags: ["feeds"],
    status: 204,
  },
  {
    method: "POST",
    path: "/feeds/refresh",
    operationId: "refreshFeeds",
    summary: "Refresh all feeds",
    tags: ["feeds"],
    status: 202,
  },
  {
    method: "POST",
    path: "/feeds/import",
    operationId: "importOpml",
    summary: "Import feeds from OPML",
    tags: ["feeds"],
    body: ImportOpmlRequest,
    response: ImportOpmlResponse,
    status: 200,
  },
  {
    method: "POST",
    path: "/import/readwise",
    operationId: "importReadwise",
    summary: "Import a Readwise Reader library CSV export",
    tags: ["documents"],
    body: ImportReadwiseRequest,
    response: ImportReadwiseResponse,
    status: 200,
  },
  {
    method: "GET",
    path: "/settings/tts",
    operationId: "getTtsSettings",
    summary: "Get text-to-speech settings (never returns the API key)",
    tags: ["tts"],
    response: TtsSettings,
    status: 200,
  },
  {
    method: "PATCH",
    path: "/settings/tts",
    operationId: "updateTtsSettings",
    summary: "Update text-to-speech settings (set/clear key, voice, model)",
    tags: ["tts"],
    body: UpdateTtsSettingsRequest,
    response: TtsSettings,
    status: 200,
  },
  {
    method: "GET",
    path: "/settings/tts/voices",
    operationId: "listTtsVoices",
    summary: "List the configured account's available voices",
    tags: ["tts"],
    response: TtsVoicesResponse,
    status: 200,
  },
  {
    method: "GET",
    path: "/settings/tts/usage",
    operationId: "getTtsUsage",
    summary: "Get the configured ElevenLabs account's usage and quota",
    tags: ["tts"],
    response: TtsUsage,
    status: 200,
  },
  {
    method: "POST",
    path: "/documents/:id/audio",
    operationId: "synthesizeAudio",
    summary: "Synthesize (or return cached) read-aloud audio for a document",
    tags: ["tts"],
    body: SynthesizeAudioRequest,
    status: 200,
  },
  {
    method: "POST",
    path: "/documents/:id/podcast",
    operationId: "addPodcastEpisode",
    summary: "Render a document to audio and publish it as a podcast episode",
    tags: ["tts"],
    body: SynthesizeAudioRequest,
    response: PodcastEpisode,
    status: 201,
  },
  {
    method: "GET",
    path: "/settings/podcast",
    operationId: "getPodcastSettings",
    summary: "Get the podcast feed subscribe URL and episode count",
    tags: ["tts"],
    response: PodcastSettings,
    status: 200,
  },
  {
    method: "POST",
    path: "/settings/podcast/regenerate",
    operationId: "regeneratePodcastFeed",
    summary: "Rotate the podcast feed token (revokes the previous URL)",
    tags: ["tts"],
    response: PodcastSettings,
    status: 200,
  },
  {
    method: "POST",
    path: "/settings/tts/preview",
    operationId: "previewTtsVoice",
    summary: "Synthesize (or return cached) a short sample of a voice",
    tags: ["tts"],
    body: TtsPreviewRequest,
    status: 200,
  },
  {
    method: "GET",
    path: "/settings/player",
    operationId: "getPlayerState",
    summary: "Get the cross-device Listen player state",
    tags: ["tts"],
    response: PlayerState,
    status: 200,
  },
  {
    method: "PATCH",
    path: "/settings/player",
    operationId: "savePlayerState",
    summary: "Save the cross-device Listen player state",
    tags: ["tts"],
    body: PlayerState,
    response: PlayerState,
    status: 200,
  },
  {
    method: "GET",
    path: "/settings/email-ignore",
    operationId: "getEmailIgnore",
    summary: "List ignored newsletter senders and the senders in the library",
    tags: ["documents"],
    response: EmailIgnoreSettings,
    status: 200,
  },
  {
    method: "POST",
    path: "/settings/email-ignore",
    operationId: "addEmailIgnore",
    summary: "Ignore a newsletter sender and delete its already-saved emails",
    tags: ["documents"],
    body: EmailIgnoreSenderRequest,
    response: EmailIgnoreAddResponse,
    status: 200,
  },
  {
    method: "DELETE",
    path: "/settings/email-ignore",
    operationId: "removeEmailIgnore",
    summary: "Stop ignoring a newsletter sender (existing emails are unaffected)",
    tags: ["documents"],
    body: EmailIgnoreSenderRequest,
    response: EmailIgnoreSettings,
    status: 200,
  },
  {
    method: "GET",
    path: "/push/public-key",
    operationId: "getPushPublicKey",
    summary: "Get the Web Push VAPID public key (null when push is disabled)",
    tags: ["push"],
    response: PushPublicKeyResponse,
    status: 200,
  },
  {
    method: "POST",
    path: "/push/subscriptions",
    operationId: "registerPushSubscription",
    summary: "Register a browser push subscription",
    tags: ["push"],
    body: PushSubscriptionRequest,
    response: PushOkResponse,
    status: 200,
  },
  {
    method: "DELETE",
    path: "/push/subscriptions",
    operationId: "unregisterPushSubscription",
    summary: "Remove a browser push subscription",
    tags: ["push"],
    body: PushUnsubscribeRequest,
    response: PushOkResponse,
    status: 200,
  },
  {
    method: "GET",
    path: "/push/feeds",
    operationId: "getFeedNotifications",
    summary: "List per-feed notification preferences",
    tags: ["push"],
    response: FeedNotificationPrefsResponse,
    status: 200,
  },
  {
    method: "PUT",
    path: "/push/feeds/:feedId",
    operationId: "setFeedNotification",
    summary: "Toggle notifications for a single feed",
    tags: ["push"],
    body: SetFeedNotificationRequest,
    response: FeedNotificationPref,
    status: 200,
  },

  // ---- Discovery (user-facing) ----
  {
    method: "GET",
    path: "/discovery/candidates",
    operationId: "listCandidates",
    summary: "List discovered candidates (optionally filtered by status)",
    tags: ["discovery"],
    query: ListCandidatesQuery,
    response: DiscoveryCandidatesResponse,
    status: 200,
  },
  {
    method: "POST",
    path: "/discovery/candidates/:id/vote",
    operationId: "voteCandidate",
    summary: "Vote a candidate up (signal only) or down (signal + dismiss)",
    tags: ["discovery"],
    body: VoteRequest,
    response: DiscoveryCandidate,
    status: 200,
  },
  {
    method: "POST",
    path: "/discovery/candidates/:id/save",
    operationId: "saveCandidate",
    summary: "Save a candidate to Readeck (it becomes a library document)",
    tags: ["discovery"],
    response: DiscoveryCandidate,
    status: 200,
  },
  {
    method: "POST",
    path: "/discovery/candidates/clear",
    operationId: "clearCandidates",
    summary: "Clear candidates off the list without training (all active, or by id)",
    tags: ["discovery"],
    body: ClearCandidatesRequest,
    response: ClearCandidatesResponse,
    status: 200,
  },
  {
    method: "POST",
    path: "/discovery/run",
    operationId: "triggerDiscoveryRun",
    summary: "Trigger a discovery run now (fire-and-forget to the worker)",
    tags: ["discovery"],
    response: TriggerRunResponse,
    status: 202,
  },
  {
    method: "GET",
    path: "/discovery/settings",
    operationId: "getDiscoverySettings",
    summary: "Get discovery settings (never returns the Brave API key)",
    tags: ["discovery"],
    response: DiscoverySettings,
    status: 200,
  },
  {
    method: "PATCH",
    path: "/discovery/settings",
    operationId: "updateDiscoverySettings",
    summary: "Update discovery settings (topics, seeds, fetchers, schedule, keys)",
    tags: ["discovery"],
    body: UpdateDiscoverySettingsRequest,
    response: DiscoverySettings,
    status: 200,
  },
  {
    method: "POST",
    path: "/discovery/profile/reseed",
    operationId: "reseedDiscoveryProfile",
    summary: "Rebuild the interest profile from the current library",
    tags: ["discovery"],
    response: DiscoveryProfile,
    status: 200,
  },
  {
    method: "GET",
    path: "/discovery/runs",
    operationId: "listDiscoveryRuns",
    summary: "List recent discovery runs (history for the Activity page)",
    tags: ["discovery"],
    query: ListRunsQuery,
    response: DiscoveryRunsResponse,
    status: 200,
  },
  {
    method: "GET",
    path: "/discovery/runs/latest",
    operationId: "getLatestDiscoveryRun",
    summary: "Get the current/most-recent run (polled live while running)",
    tags: ["discovery"],
    response: LatestRunResponse,
    status: 200,
  },
  {
    method: "GET",
    path: "/discovery/follow-suggestions",
    operationId: "getFollowSuggestions",
    summary: "Domains the user keeps saving/upvoting that aren't yet followed feeds",
    tags: ["discovery"],
    response: FollowSuggestionsResponse,
    status: 200,
  },
  {
    method: "POST",
    path: "/discovery/follow",
    operationId: "followDomain",
    summary: "Subscribe to a suggested domain's feed (MiniFlux autodiscovery)",
    tags: ["discovery"],
    body: FollowDomainRequest,
    response: FollowDomainResponse,
    status: 200,
  },
  {
    method: "POST",
    path: "/discovery/follow/dismiss",
    operationId: "dismissFollow",
    summary: "Dismiss a follow suggestion so it stops being offered",
    tags: ["discovery"],
    body: DismissFollowRequest,
    response: DismissFollowResponse,
    status: 200,
  },

  // ---- Discovery (service-facing: called by the discovery worker) ----
  {
    method: "GET",
    path: "/discovery/config",
    operationId: "getDiscoveryConfig",
    summary: "Get full discovery config incl. secrets (worker only)",
    tags: ["discovery"],
    response: DiscoveryConfig,
    status: 200,
  },
  {
    method: "GET",
    path: "/discovery/profile",
    operationId: "getDiscoveryProfile",
    summary: "Get the persisted interest profile (worker only)",
    tags: ["discovery"],
    response: DiscoveryProfile,
    status: 200,
  },
  {
    method: "PUT",
    path: "/discovery/profile",
    operationId: "putDiscoveryProfile",
    summary: "Persist the profile and mark folded-in votes processed (worker only)",
    tags: ["discovery"],
    body: PutDiscoveryProfileRequest,
    response: DiscoveryProfile,
    status: 200,
  },
  {
    method: "GET",
    path: "/discovery/seed",
    operationId: "getDiscoverySeed",
    summary: "Get the weighted seed corpus from the library (worker only)",
    tags: ["discovery"],
    response: DiscoverySeed,
    status: 200,
  },
  {
    method: "GET",
    path: "/discovery/votes/unprocessed",
    operationId: "listUnprocessedVotes",
    summary: "List votes not yet folded into the profile (worker only)",
    tags: ["discovery"],
    response: UnprocessedVotesResponse,
    status: 200,
  },
  {
    method: "POST",
    path: "/discovery/candidates",
    operationId: "createCandidates",
    summary: "Bulk-insert scored candidates, deduped by URL (worker only)",
    tags: ["discovery"],
    body: CreateCandidatesRequest,
    response: CreateCandidatesResponse,
    status: 200,
  },
  {
    method: "POST",
    path: "/discovery/extract",
    operationId: "extractContent",
    summary: "Transiently save a URL to Readeck and return its extracted full text (worker only)",
    tags: ["discovery"],
    body: ExtractContentRequest,
    response: ExtractContentResponse,
    status: 200,
  },
  {
    method: "POST",
    path: "/discovery/runs",
    operationId: "createDiscoveryRun",
    summary: "Open a run record (worker only)",
    tags: ["discovery"],
    body: CreateRunRequest,
    response: DiscoveryRun,
    status: 201,
  },
  {
    method: "PATCH",
    path: "/discovery/runs/:id",
    operationId: "updateDiscoveryRun",
    summary: "Update a run's stage/stats/status (worker only)",
    tags: ["discovery"],
    body: UpdateRunRequest,
    response: DiscoveryRun,
    status: 200,
  },
];

// ---- OpenAPI 3.1 document ----------------------------------------------------

type JsonSchema = Record<string, unknown>;

function toSchema(schema: z.ZodType): JsonSchema {
  try {
    return z.toJSONSchema(schema) as JsonSchema;
  } catch {
    return { type: "object" };
  }
}

function pathParameters(path: string): JsonSchema[] {
  return [...path.matchAll(/:(\w+)/g)].map((m) => ({
    name: m[1],
    in: "path",
    required: true,
    schema: { type: "string" },
  }));
}

function queryParameters(query: z.ZodType | undefined): JsonSchema[] {
  if (!query) return [];
  const json = toSchema(query);
  const props = (json.properties ?? {}) as Record<string, JsonSchema>;
  const required = (json.required ?? []) as string[];
  return Object.entries(props).map(([name, schema]) => ({
    name,
    in: "query",
    required: required.includes(name),
    schema,
  }));
}

const NAMED_SCHEMAS: Record<string, z.ZodType> = {
  Card,
  Highlight,
  Tag,
  SavedView,
  Feed,
  TtsSettings,
  TtsVoice,
};

export function buildOpenApiDocument(): JsonSchema {
  const paths: Record<string, Record<string, JsonSchema>> = {};

  for (const ep of endpoints) {
    const operation: JsonSchema = {
      operationId: ep.operationId,
      summary: ep.summary,
      tags: ep.tags,
      parameters: [...pathParameters(ep.path), ...queryParameters(ep.query)],
      responses: {
        [String(ep.status)]: {
          description: ep.summary,
          ...(ep.response
            ? { content: { "application/json": { schema: toSchema(ep.response) } } }
            : {}),
        },
      },
    };
    if (ep.body) {
      operation.requestBody = {
        required: true,
        content: { "application/json": { schema: toSchema(ep.body) } },
      };
    }
    const openapiPath = ep.path.replace(/:(\w+)/g, "{$1}");
    paths[openapiPath] ??= {};
    paths[openapiPath]![ep.method.toLowerCase()] = operation;
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "Lectern API",
      version: "0.1.0",
      description: "Unified RSS + read-later reader API (MiniFlux + Readeck behind one contract).",
    },
    servers: [{ url: "/api/v1" }],
    security: [{ bearerAuth: [] }],
    components: {
      securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } },
      schemas: Object.fromEntries(Object.entries(NAMED_SCHEMAS).map(([n, s]) => [n, toSchema(s)])),
    },
    paths,
  };
}
