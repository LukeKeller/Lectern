import {
  Card,
  Feed,
  FeedsResponse,
  ImportOpmlRequest,
  ImportOpmlResponse,
  ImportReadwiseRequest,
  ImportReadwiseResponse,
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
  SavedView,
  SaveDocumentRequest,
  SearchResponse,
  SyncPullQuery,
  SyncPullResponse,
  SyncPushRequest,
  SyncPushResponse,
  TagsResponse,
  TtsSettings,
  TtsVoicesResponse,
  UpdateDocumentRequest,
  UpdateTtsSettingsRequest,
  UpdateViewRequest,
  ViewsResponse,
} from "@lectern/shared";
import type { z } from "zod";

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
  /** Full-text search over owned article bodies (server-side; online only). */
  search(q: string, limit = 20) {
    return this.request("GET", "/search", { query: { q, limit }, schema: SearchResponse });
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
