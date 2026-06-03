import { describe, expect, it } from "vitest";
import { parse, QueryNode, QueryParseError, serialize, type QueryNode as Q } from "./query";

const samples: Q[] = [
  { kind: "term", field: "location", op: "eq", value: "later" },
  { kind: "term", field: "tag", op: "has", value: "ai" },
  {
    kind: "and",
    nodes: [
      { kind: "term", field: "location", op: "eq", value: "later" },
      { kind: "term", field: "tag", op: "has", value: "ai" },
    ],
  },
  {
    kind: "and",
    nodes: [
      {
        kind: "or",
        nodes: [
          { kind: "term", field: "source", op: "eq", value: "readeck" },
          { kind: "term", field: "source", op: "eq", value: "miniflux" },
        ],
      },
      { kind: "not", node: { kind: "term", field: "location", op: "eq", value: "archive" } },
    ],
  },
  {
    kind: "and",
    nodes: [
      { kind: "term", field: "words", op: "gt", value: 1000 },
      { kind: "term", field: "saved", op: "after", value: "2026-01-01" },
      { kind: "term", field: "title", op: "contains", value: "bloat" },
      { kind: "term", field: "author", op: "eq", value: "Dan Luu" },
    ],
  },
];

describe("query AST <-> text round-trip", () => {
  for (const ast of samples) {
    it(`round-trips: ${serialize(ast)}`, () => {
      expect(parse(serialize(ast))).toEqual(ast);
      // The AST itself must satisfy the schema.
      expect(QueryNode.parse(ast)).toEqual(ast);
    });
  }
});

describe("parse from text", () => {
  it("parses a quoted value with spaces", () => {
    expect(parse('author:"Dan Luu"')).toEqual({
      kind: "term",
      field: "author",
      op: "eq",
      value: "Dan Luu",
    });
  });

  it("coerces numbers and resolves date operators by field type", () => {
    expect(parse("progress:>=0.5")).toEqual({
      kind: "term",
      field: "progress",
      op: "gte",
      value: 0.5,
    });
    expect(parse("saved:<2026-01-01")).toEqual({
      kind: "term",
      field: "saved",
      op: "before",
      value: "2026-01-01",
    });
  });

  it("respects NOT > AND > OR precedence", () => {
    // Parses as: location:later OR (tag:ai AND (NOT title:~spam))
    const ast = parse("location:later OR tag:ai AND NOT title:~spam") as Extract<Q, { kind: "or" }>;
    expect(ast.kind).toBe("or");
    expect(ast.nodes).toHaveLength(2);
    expect(ast.nodes[1]!.kind).toBe("and");
  });
});

describe("parse errors", () => {
  it("rejects an unknown field", () => {
    expect(() => parse("nope:1")).toThrow(QueryParseError);
  });
  it("rejects an invalid enum value", () => {
    expect(() => parse("location:nowhere")).toThrow(QueryParseError);
  });
  it("rejects a non-numeric number field", () => {
    expect(() => parse("words:abc")).toThrow(QueryParseError);
  });
  it("rejects an unbalanced parenthesis", () => {
    expect(() => parse("(location:later")).toThrow(QueryParseError);
  });
});
