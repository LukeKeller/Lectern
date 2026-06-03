import { z } from "zod";
import { Card, Category, Highlight, HighlightColor, Location, Source, Tag } from "./model";
import { SyncPullResponse, SyncPushRequest, SyncPushResponse } from "./sync";
import { SavedView } from "./views";

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

// ---- Endpoint registry ------------------------------------------------------

export type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

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
