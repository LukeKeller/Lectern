import {
  Card,
  Feed,
  FeedsResponse,
  ImportOpmlRequest,
  ImportOpmlResponse,
  ImportReadwiseRequest,
  ImportReadwiseResponse,
  BulkDeleteRequest,
  BulkDeleteResponse,
  BulkMaintenanceRequest,
  BulkMaintenanceResponse,
  EmailIgnoreAddResponse,
  EmailIgnoreSettings,
  ForceSyncResponse,
  SubscribeFeedRequest,
  UpdateFeedRequest,
  CreateHighlightRequest,
  CreateViewRequest,
  DocumentContentResponse,
  Highlight,
  HighlightsResponse,
  ListDocumentsQuery,
  ListDocumentsResponse,
  PlayerState,
  PodcastEpisode,
  PodcastSettings,
  SavedView,
  SaveDocumentRequest,
  SearchResponse,
  RelatedDocumentsResponse,
  TagSuggestionsResponse,
  SourceThemeResponse,
  SourceThemesResponse,
  SyncPullQuery,
  SyncManifestResponse,
  SyncPullResponse,
  SyncPushRequest,
  SyncPushResponse,
  PushPublicKeyResponse,
  PushOkResponse,
  PushSubscriptionRequest,
  PushUnsubscribeRequest,
  FeedNotificationPref,
  FeedNotificationPrefsResponse,
  TagsResponse,
  TtsSettings,
  TtsUsage,
  TtsVoicesResponse,
  UpdateDocumentRequest,
  UpdateTtsSettingsRequest,
  UpdateViewRequest,
  ViewsResponse,
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
  DismissFollowResponse,
  ExtractContentResponse,
  DiscoverySettings,
  FollowDomainResponse,
  FollowSuggestionsResponse,
  LatestRunResponse,
  RunDetailResponse,
  ListCandidatesQuery,
  PutDiscoveryProfileRequest,
  TriggerRunResponse,
  UnprocessedVotesResponse,
  UpdateDiscoverySettingsRequest,
  UpdateRunRequest,
  VoteValue,
} from "@lectern/shared";
import { z } from "zod";

export interface ClientOptions {
  /** Base URL including the API prefix, e.g. https://host/api/v1 */
  baseUrl: string;
  token?: string;
  fetch?: typeof fetch;
}

export class LecternApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "LecternApiError";
  }
}

interface RequestOptions<T> {
  query?: Record<string, unknown>;
  body?: unknown;
  schema?: z.ZodType<T>;
}

/** Typed Lectern API client. Responses are validated against the shared contract. */
export class LecternClient {
  private readonly baseUrl: string;
  private readonly token?: string;
  private readonly doFetch: typeof fetch;

  constructor(opts: ClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, "");
    this.token = opts.token;
    this.doFetch = opts.fetch ?? fetch;
  }

  private async request<T>(method: string, path: string, opts: RequestOptions<T> = {}): Promise<T> {
    // Support an absolute baseUrl, or a relative one (e.g. "/reader/api/v1") resolved
    // against the current origin when running in a browser (same-origin production).
    const origin = (globalThis as { location?: { origin?: string } }).location?.origin;
    const base = /^https?:\/\//.test(this.baseUrl) ? undefined : origin;
    const url = new URL(this.baseUrl + path, base);
    if (opts.query) {
      for (const [k, v] of Object.entries(opts.query)) {
        if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
      }
    }
    const res = await this.doFetch(url, {
      method,
      headers: {
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        ...(opts.body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    if (!res.ok) throw new LecternApiError(res.status, `${method} ${path} -> ${res.status}`);
    if (res.status === 204) return undefined as T;
    // Tolerate any empty-body 2xx (e.g. 202 from /feeds/refresh) as a void result.
    const text = await res.text();
    if (!text) return undefined as T;
    const json = JSON.parse(text);
    return opts.schema ? opts.schema.parse(json) : (json as T);
  }

  listDocuments(query?: Partial<ListDocumentsQuery>) {
    return this.request("GET", "/documents", { query, schema: ListDocumentsResponse });
  }
  getDocument(id: string) {
    return this.request("GET", `/documents/${id}`, { schema: Card });
  }
  saveDocument(body: SaveDocumentRequest) {
    return this.request("POST", "/documents", { body, schema: Card });
  }
  updateDocument(id: string, body: UpdateDocumentRequest) {
    return this.request("PATCH", `/documents/${id}`, { body, schema: Card });
  }
  deleteDocument(id: string) {
    return this.request<void>("DELETE", `/documents/${id}`);
  }
  /**
   * Bulk-delete documents by scope ("archive" empties the archive; "read-feed"
   * removes read RSS/feed items). Returns how many were deleted. The deletions
   * are tombstoned server-side, so a subsequent sync pull drops them locally.
   */
  bulkDelete(scope: BulkDeleteRequest["scope"]) {
    return this.request("POST", "/documents/bulk-delete", {
      body: { scope },
      schema: BulkDeleteResponse,
    });
  }
  /**
   * Age-based bulk sweep: delete (removed at the source) or mark-read every live
   * document matching the facets whose timestamp precedes `before`. Used for
   * "clean up items older than a week" and "clear everything below this item".
   */
  bulkMaintenance(body: BulkMaintenanceRequest) {
    return this.request("POST", "/documents/bulk-maintenance", {
      body,
      schema: BulkMaintenanceResponse,
    });
  }
  /**
   * Force a full sync/reconcile on the server (re-index sources, prune deletions).
   * Returns per-source counts plus how many tombstones were created.
   */
  forceSync() {
    return this.request("POST", "/sync/force", { schema: ForceSyncResponse });
  }

  // ---- newsletter ignore list ----
  /** The ignored newsletter senders plus the senders currently in the library. */
  getEmailIgnore() {
    return this.request("GET", "/settings/email-ignore", { schema: EmailIgnoreSettings });
  }
  /** Ignore a sender's future emails AND delete its already-saved ones. */
  addEmailIgnore(sender: string) {
    return this.request("POST", "/settings/email-ignore", {
      body: { sender },
      schema: EmailIgnoreAddResponse,
    });
  }
  /** Stop ignoring a sender (existing emails are unaffected). */
  removeEmailIgnore(sender: string) {
    return this.request("DELETE", "/settings/email-ignore", {
      body: { sender },
      schema: EmailIgnoreSettings,
    });
  }
  /**
   * Fetch a document's article HTML. Pass `refresh` to bypass the stored copy and
   * re-extract from the original source (overwriting the cache) — used when the
   * captured content is incomplete or rendered wrong.
   */
  getContent(id: string, opts?: { refresh?: boolean }) {
    return this.request("GET", `/documents/${id}/content`, {
      query: opts?.refresh ? { refresh: 1 } : undefined,
      schema: DocumentContentResponse,
    });
  }
  /**
   * Adaptive reader accent (a hex colour) derived from the document's cover
   * image, or null when there's no usable colour. Computed once and cached
   * server-side, so it's cheap to call on every open.
   */
  getDocumentAccent(id: string) {
    return this.request<{ color: string | null }>("GET", `/documents/${id}/accent`);
  }
  /**
   * Per-source theming tokens (brand accent, favicon, display font) drawn from
   * the document's publication and cached server-side by host. Pass `refresh` to
   * re-fetch the source site and overwrite the cache.
   */
  getSourceTheme(id: string, opts?: { refresh?: boolean }) {
    return this.request("GET", `/documents/${id}/source-theme`, {
      query: opts?.refresh ? { refresh: 1 } : undefined,
      schema: SourceThemeResponse,
    });
  }
  /**
   * Every source theme cached server-side (one per host), with its host and when
   * it was last fetched. Powers the Settings "Cached sources" summary.
   */
  listSourceThemes() {
    return this.request("GET", "/source-themes", { schema: SourceThemesResponse });
  }
  /** Drop every cached source theme, forcing a re-fetch on the next open. 204. */
  clearSourceThemes() {
    return this.request<void>("DELETE", "/source-themes");
  }
  /** Full-text search over owned article bodies (server-side; online only). */
  search(q: string, limit = 20) {
    return this.request("GET", "/search", { query: { q, limit }, schema: SearchResponse });
  }
  /** "More like this" — library documents related to the given one. */
  getRelatedDocuments(id: string, limit = 3) {
    return this.request("GET", `/documents/${id}/related`, {
      query: { limit },
      schema: RelatedDocumentsResponse,
    });
  }
  /** Suggested tags for a document (tag-centroid similarity). */
  getTagSuggestions(id: string) {
    return this.request("GET", `/documents/${id}/tag-suggestions`, {
      schema: TagSuggestionsResponse,
    });
  }
  listHighlights(id: string) {
    return this.request("GET", `/documents/${id}/highlights`, { schema: HighlightsResponse });
  }
  createHighlight(id: string, body: CreateHighlightRequest) {
    return this.request("POST", `/documents/${id}/highlights`, { body, schema: Highlight });
  }
  deleteHighlight(id: string) {
    return this.request<void>("DELETE", `/highlights/${id}`);
  }
  listTags() {
    return this.request("GET", "/tags", { schema: TagsResponse });
  }
  listViews() {
    return this.request("GET", "/views", { schema: ViewsResponse });
  }
  createView(body: CreateViewRequest) {
    return this.request("POST", "/views", { body, schema: SavedView });
  }
  updateView(id: string, body: UpdateViewRequest) {
    return this.request("PATCH", `/views/${id}`, { body, schema: SavedView });
  }
  deleteView(id: string) {
    return this.request<void>("DELETE", `/views/${id}`);
  }
  syncPull(query?: Partial<SyncPullQuery>) {
    return this.request("GET", "/sync", { query, schema: SyncPullResponse });
  }
  syncManifest() {
    return this.request("GET", "/sync/manifest", { schema: SyncManifestResponse });
  }
  syncPush(body: SyncPushRequest) {
    return this.request("POST", "/sync", { body, schema: SyncPushResponse });
  }
  listFeeds() {
    return this.request("GET", "/feeds", { schema: FeedsResponse });
  }
  subscribeFeed(body: SubscribeFeedRequest) {
    return this.request("POST", "/feeds", { body, schema: Feed });
  }
  updateFeed(id: string, body: UpdateFeedRequest) {
    return this.request("PATCH", `/feeds/${id}`, { body, schema: Feed });
  }
  deleteFeed(id: string) {
    return this.request<void>("DELETE", `/feeds/${id}`);
  }
  refreshFeeds() {
    return this.request<void>("POST", "/feeds/refresh");
  }
  importOpml(body: ImportOpmlRequest) {
    return this.request("POST", "/feeds/import", { body, schema: ImportOpmlResponse });
  }
  importReadwise(body: ImportReadwiseRequest) {
    return this.request("POST", "/import/readwise", { body, schema: ImportReadwiseResponse });
  }

  // ---- Web Push notifications ----
  /** VAPID public key for this deployment, or null when push isn't configured. */
  getPushPublicKey() {
    return this.request("GET", "/push/public-key", { schema: PushPublicKeyResponse });
  }
  /** Register this device's push subscription (idempotent on the endpoint). */
  registerPushSubscription(body: PushSubscriptionRequest) {
    return this.request("POST", "/push/subscriptions", { body, schema: PushOkResponse });
  }
  /** Remove a device's push subscription. DELETE carries a JSON body (the endpoint). */
  unregisterPushSubscription(body: PushUnsubscribeRequest) {
    return this.request("DELETE", "/push/subscriptions", { body, schema: PushOkResponse });
  }
  /** Per-feed notification preferences for the current user. */
  getFeedNotifications() {
    return this.request("GET", "/push/feeds", { schema: FeedNotificationPrefsResponse });
  }
  /** Toggle notifications for a single feed. */
  setFeedNotification(feedId: string, enabled: boolean) {
    return this.request("PUT", `/push/feeds/${feedId}`, {
      body: { enabled },
      schema: FeedNotificationPref,
    });
  }

  // ---- text-to-speech ("Listen") ----
  getTtsSettings() {
    return this.request("GET", "/settings/tts", { schema: TtsSettings });
  }
  updateTtsSettings(body: UpdateTtsSettingsRequest) {
    return this.request("PATCH", "/settings/tts", { body, schema: TtsSettings });
  }
  listTtsVoices() {
    return this.request("GET", "/settings/tts/voices", { schema: TtsVoicesResponse });
  }
  /** ElevenLabs account usage/quota for the configured key (characters spent this
   * billing period, plan tier, reset date). 409 if no key is configured. */
  getTtsUsage() {
    return this.request("GET", "/settings/tts/usage", { schema: TtsUsage });
  }
  getPlayerState() {
    return this.request("GET", "/settings/player", { schema: PlayerState });
  }
  savePlayerState(body: PlayerState) {
    return this.request("PATCH", "/settings/player", { body, schema: PlayerState });
  }
  /**
   * Synthesize (or fetch cached) read-aloud audio for a document. Returns the
   * raw audio bytes plus the server-side content hash. Bespoke (not JSON): the
   * body is binary audio, so it bypasses the JSON request helper. Fires ONLY on
   * an explicit Listen action — never speculatively.
   */
  async synthesizeAudio(
    id: string,
    title?: string,
  ): Promise<{ bytes: ArrayBuffer; mime: string; contentHash: string }> {
    const origin = (globalThis as { location?: { origin?: string } }).location?.origin;
    const base = /^https?:\/\//.test(this.baseUrl) ? undefined : origin;
    const url = new URL(`${this.baseUrl}/documents/${id}/audio`, base);
    const res = await this.doFetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      },
      body: JSON.stringify(title ? { title } : {}),
    });
    if (!res.ok)
      throw new LecternApiError(res.status, `POST /documents/${id}/audio -> ${res.status}`);
    const bytes = await res.arrayBuffer();
    return {
      bytes,
      mime: res.headers.get("content-type") ?? "audio/mpeg",
      contentHash: res.headers.get("x-tts-content-hash") ?? "",
    };
  }

  /**
   * Publish a document as a podcast episode: renders (or reuses cached) audio
   * server-side and records the episode. Returns episode metadata only — no
   * audio bytes, so the caller never starts playback. Fires ElevenLabs synthesis
   * on a cache miss, like Listen, so it's an explicit user action.
   */
  addToPodcast(id: string, title?: string) {
    return this.request("POST", `/documents/${id}/podcast`, {
      body: title ? { title } : {},
      schema: PodcastEpisode,
    });
  }

  /** The podcast feed subscribe URL (token baked in) and current episode count. */
  getPodcastSettings() {
    return this.request("GET", "/settings/podcast", { schema: PodcastSettings });
  }

  /** Rotate the podcast feed token, revoking the previous subscribe URL. */
  regeneratePodcastFeed() {
    return this.request("POST", "/settings/podcast/regenerate", { schema: PodcastSettings });
  }

  // ---- Discovery (user-facing) ----
  /** List discovered candidates, optionally filtered by status. */
  listCandidates(query?: Partial<ListCandidatesQuery>) {
    return this.request("GET", "/discovery/candidates", {
      query,
      schema: DiscoveryCandidatesResponse,
    });
  }
  /** Vote a candidate up (signal only) or down (signal + dismiss). */
  voteCandidate(id: string, value: VoteValue) {
    return this.request("POST", `/discovery/candidates/${id}/vote`, {
      body: { value },
      schema: DiscoveryCandidate,
    });
  }
  /** Save a candidate to Readeck; it becomes a library document. */
  saveCandidate(id: string) {
    return this.request("POST", `/discovery/candidates/${id}/save`, {
      schema: DiscoveryCandidate,
    });
  }
  /** Clear candidates off the list without training the model. Omit `ids` to
   * clear every active candidate; pass ids to clear just those. */
  clearCandidates(ids?: string[]) {
    return this.request("POST", "/discovery/candidates/clear", {
      body: ids ? { ids } : {},
      schema: ClearCandidatesResponse,
    });
  }
  /** Trigger a discovery run now (fire-and-forget to the worker). */
  triggerDiscoveryRun() {
    return this.request("POST", "/discovery/run", { schema: TriggerRunResponse });
  }
  getDiscoverySettings() {
    return this.request("GET", "/discovery/settings", { schema: DiscoverySettings });
  }
  updateDiscoverySettings(body: UpdateDiscoverySettingsRequest) {
    return this.request("PATCH", "/discovery/settings", { body, schema: DiscoverySettings });
  }
  /** Rebuild the interest profile from the current library. */
  reseedDiscoveryProfile() {
    return this.request("POST", "/discovery/profile/reseed", { schema: DiscoveryProfile });
  }
  /** Recent runs (history for the Activity page). */
  listDiscoveryRuns(limit = 20) {
    return this.request("GET", "/discovery/runs", {
      query: { limit },
      schema: DiscoveryRunsResponse,
    });
  }
  /** Current/most-recent run (poll while running). */
  getLatestDiscoveryRun() {
    return this.request("GET", "/discovery/runs/latest", { schema: LatestRunResponse });
  }
  /** One run WITH its full forensic trace (the run-detail view). */
  getDiscoveryRun(id: string) {
    return this.request("GET", `/discovery/runs/${encodeURIComponent(id)}`, {
      schema: RunDetailResponse,
    });
  }
  /** Domains the user keeps saving/upvoting that aren't yet followed feeds. */
  getFollowSuggestions() {
    return this.request("GET", "/discovery/follow-suggestions", {
      schema: FollowSuggestionsResponse,
    });
  }
  /** Subscribe to a suggested domain's feed (MiniFlux autodiscovery). */
  followDomain(domain: string) {
    return this.request("POST", "/discovery/follow", {
      body: { domain },
      schema: FollowDomainResponse,
    });
  }
  /** Dismiss a follow suggestion so it stops being offered. */
  dismissFollow(domain: string) {
    return this.request("POST", "/discovery/follow/dismiss", {
      body: { domain },
      schema: DismissFollowResponse,
    });
  }

  // ---- Discovery (service-facing: used by the discovery worker) ----
  getDiscoveryConfig() {
    return this.request("GET", "/discovery/config", { schema: DiscoveryConfig });
  }
  getDiscoveryProfile() {
    return this.request("GET", "/discovery/profile", { schema: DiscoveryProfile });
  }
  putDiscoveryProfile(body: PutDiscoveryProfileRequest) {
    return this.request("PUT", "/discovery/profile", { body, schema: DiscoveryProfile });
  }
  getDiscoverySeed() {
    return this.request("GET", "/discovery/seed", { schema: DiscoverySeed });
  }
  listUnprocessedVotes() {
    return this.request("GET", "/discovery/votes/unprocessed", {
      schema: UnprocessedVotesResponse,
    });
  }
  createCandidates(body: CreateCandidatesRequest) {
    return this.request("POST", "/discovery/candidates", {
      body,
      schema: CreateCandidatesResponse,
    });
  }
  createDiscoveryRun(body: CreateRunRequest) {
    return this.request("POST", "/discovery/runs", { body, schema: DiscoveryRun });
  }
  updateDiscoveryRun(id: string, body: UpdateRunRequest) {
    return this.request("PATCH", `/discovery/runs/${id}`, { body, schema: DiscoveryRun });
  }
  /**
   * Ask the BFF for a URL's readable full text (it saves the page to Readeck
   * transiently, pulls the extracted article, and deletes the bookmark).
   * Returns the extracted article, or null when extraction failed — the worker
   * falls back to the search snippet.
   */
  async extractContent(url: string): Promise<ExtractContentResponse["result"]> {
    const res = await this.request("POST", "/discovery/extract", {
      body: { url },
      schema: ExtractContentResponse,
    });
    return res.result;
  }

  /** Fetch a short spoken sample of a voice (binary; bypasses the JSON helper). */
  async previewVoiceAudio(voiceId: string): Promise<{ bytes: ArrayBuffer; mime: string }> {
    const origin = (globalThis as { location?: { origin?: string } }).location?.origin;
    const base = /^https?:\/\//.test(this.baseUrl) ? undefined : origin;
    const url = new URL(`${this.baseUrl}/settings/tts/preview`, base);
    const res = await this.doFetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      },
      body: JSON.stringify({ voiceId }),
    });
    if (!res.ok)
      throw new LecternApiError(res.status, `POST /settings/tts/preview -> ${res.status}`);
    return {
      bytes: await res.arrayBuffer(),
      mime: res.headers.get("content-type") ?? "audio/mpeg",
    };
  }
}
