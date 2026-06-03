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
  SavedView,
  SaveDocumentRequest,
  SearchResponse,
  SyncPullQuery,
  SyncPullResponse,
  SyncPushRequest,
  SyncPushResponse,
  TagsResponse,
  UpdateDocumentRequest,
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
  getContent(id: string) {
    return this.request("GET", `/documents/${id}/content`, { schema: DocumentContentResponse });
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
}
