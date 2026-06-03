import { describe, expect, it } from "vitest";
import { buildOpenApiDocument, endpoints } from "./api";

describe("OpenAPI document", () => {
  const doc = buildOpenApiDocument();

  it("is a structurally valid OpenAPI 3.1 document", () => {
    expect(doc.openapi).toBe("3.1.0");
    expect(doc.info).toMatchObject({ title: "Lectern API" });
    expect(doc.paths).toBeTypeOf("object");
    // JSON round-trips (no functions/undefined leaked in).
    expect(JSON.parse(JSON.stringify(doc))).toEqual(doc);
  });

  it("exposes every registered endpoint", () => {
    const paths = doc.paths as Record<string, Record<string, unknown>>;
    for (const ep of endpoints) {
      const openapiPath = ep.path.replace(/:(\w+)/g, "{$1}");
      expect(paths[openapiPath], `missing path ${openapiPath}`).toBeDefined();
      expect(
        paths[openapiPath]![ep.method.toLowerCase()],
        `missing ${ep.method} ${openapiPath}`,
      ).toBeDefined();
    }
  });

  it("declares bearer security and core component schemas", () => {
    const components = doc.components as Record<string, Record<string, unknown>>;
    expect(components.securitySchemes).toHaveProperty("bearerAuth");
    expect(components.schemas).toHaveProperty("Card");
    expect(components.schemas).toHaveProperty("SavedView");
  });

  it("emits path + query parameters", () => {
    const paths = doc.paths as Record<
      string,
      Record<string, { parameters?: { name: string; in: string }[] }>
    >;
    const getDoc = paths["/documents/{id}"]!.get!;
    expect(getDoc.parameters?.some((p) => p.in === "path" && p.name === "id")).toBe(true);
    const list = paths["/documents"]!.get!;
    expect(list.parameters?.some((p) => p.in === "query" && p.name === "location")).toBe(true);
  });
});
