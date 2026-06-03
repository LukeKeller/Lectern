import { z } from "zod";
import { Category, Location, Source } from "./model";

/**
 * Saved-view query language.
 *
 * The canonical form is the `QueryNode` AST (stored in a SavedView). A compact text
 * DSL is provided for editing and display, with a `parse`/`serialize` pair that
 * round-trips. Compiling the AST to backend queries is D3/D9 — this module is syntax
 * only (AST <-> text), not evaluation.
 *
 * DSL examples:
 *   location:later AND tag:ai
 *   (source:readeck OR source:miniflux) AND words:>1000
 *   title:~bloat AND NOT location:archive
 *   author:"Dan Luu" AND saved:>2026-01-01
 */

export const QueryField = z.enum([
  "location",
  "category",
  "source",
  "tag",
  "author",
  "site",
  "title",
  "words",
  "progress",
  "saved",
  "updated",
  "highlighted",
]);
export type QueryField = z.infer<typeof QueryField>;

export const CompareOp = z.enum([
  "eq",
  "neq",
  "contains",
  "has",
  "gt",
  "gte",
  "lt",
  "lte",
  "before",
  "after",
]);
export type CompareOp = z.infer<typeof CompareOp>;

export const QueryValue = z.union([z.string(), z.number(), z.boolean()]);
export type QueryValue = z.infer<typeof QueryValue>;

export type QueryNode =
  | { kind: "and"; nodes: QueryNode[] }
  | { kind: "or"; nodes: QueryNode[] }
  | { kind: "not"; node: QueryNode }
  | { kind: "term"; field: QueryField; op: CompareOp; value: QueryValue };

export const QueryNode: z.ZodType<QueryNode> = z.lazy(() =>
  z.union([
    z.object({ kind: z.literal("and"), nodes: z.array(QueryNode) }),
    z.object({ kind: z.literal("or"), nodes: z.array(QueryNode) }),
    z.object({ kind: z.literal("not"), node: QueryNode }),
    z.object({
      kind: z.literal("term"),
      field: QueryField,
      op: CompareOp,
      value: QueryValue,
    }),
  ]),
);

const ENUM_FIELDS: Partial<Record<QueryField, z.ZodType>> = {
  location: Location,
  category: Category,
  source: Source,
};
const NUMBER_FIELDS: Partial<Record<QueryField, true>> = { words: true, progress: true };
const DATE_FIELDS: Partial<Record<QueryField, true>> = { saved: true, updated: true };
const BOOL_FIELDS: Partial<Record<QueryField, true>> = { highlighted: true };

export class QueryParseError extends Error {}

// ---- Serialize: AST -> text -------------------------------------------------

const OP_SYMBOL: Record<CompareOp, string> = {
  eq: "",
  has: "",
  neq: "!=",
  contains: "~",
  gt: ">",
  gte: ">=",
  lt: "<",
  lte: "<=",
  after: ">",
  before: "<",
};

function serializeValue(value: QueryValue): string {
  const s = String(value);
  return /\s/.test(s) ? `"${s}"` : s;
}

function serializeTerm(field: QueryField, op: CompareOp, value: QueryValue): string {
  return `${field}:${OP_SYMBOL[op]}${serializeValue(value)}`;
}

/** Wrap compound nodes in parentheses so nesting survives a round-trip. */
function serializeAtom(node: QueryNode): string {
  return node.kind === "term" ? serialize(node) : `(${serialize(node)})`;
}

export function serialize(node: QueryNode): string {
  switch (node.kind) {
    case "term":
      return serializeTerm(node.field, node.op, node.value);
    case "not":
      return `NOT ${serializeAtom(node.node)}`;
    case "and":
      return node.nodes.map(serializeAtom).join(" AND ");
    case "or":
      return node.nodes.map(serializeAtom).join(" OR ");
  }
}

// ---- Tokenize ---------------------------------------------------------------

type Token =
  | { t: "lparen" }
  | { t: "rparen" }
  | { t: "and" }
  | { t: "or" }
  | { t: "not" }
  | { t: "term"; raw: string };

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const c = input[i]!;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === "(") {
      tokens.push({ t: "lparen" });
      i++;
      continue;
    }
    if (c === ")") {
      tokens.push({ t: "rparen" });
      i++;
      continue;
    }
    // Read a chunk: stop at whitespace or parens, but keep quoted spans intact.
    let raw = "";
    while (i < input.length) {
      const ch = input[i]!;
      if (/\s/.test(ch) || ch === "(" || ch === ")") break;
      if (ch === '"') {
        raw += ch;
        i++;
        while (i < input.length && input[i] !== '"') {
          raw += input[i];
          i++;
        }
        if (i < input.length) {
          raw += '"';
          i++;
        }
        continue;
      }
      raw += ch;
      i++;
    }
    const upper = raw.toUpperCase();
    if (upper === "AND" && !raw.includes(":")) tokens.push({ t: "and" });
    else if (upper === "OR" && !raw.includes(":")) tokens.push({ t: "or" });
    else if (upper === "NOT" && !raw.includes(":")) tokens.push({ t: "not" });
    else tokens.push({ t: "term", raw });
  }
  return tokens;
}

// ---- Parse term chunk -------------------------------------------------------

function parseTerm(raw: string): Extract<QueryNode, { kind: "term" }> {
  const colon = raw.indexOf(":");
  if (colon < 0) throw new QueryParseError(`Expected field:value, got "${raw}"`);
  const field = raw.slice(0, colon);
  const fieldParsed = QueryField.safeParse(field);
  if (!fieldParsed.success) throw new QueryParseError(`Unknown field "${field}"`);
  const f = fieldParsed.data;

  let rest = raw.slice(colon + 1);
  let symbol = "";
  for (const sym of [">=", "<=", "!=", ">", "<", "~"]) {
    if (rest.startsWith(sym)) {
      symbol = sym;
      rest = rest.slice(sym.length);
      break;
    }
  }
  // Strip surrounding quotes from the value.
  if (rest.startsWith('"') && rest.endsWith('"') && rest.length >= 2) rest = rest.slice(1, -1);

  const op = resolveOp(f, symbol);
  const value = coerceValue(f, rest);
  return { kind: "term", field: f, op, value };
}

function resolveOp(field: QueryField, symbol: string): CompareOp {
  switch (symbol) {
    case ">=":
      return "gte";
    case "<=":
      return "lte";
    case "!=":
      return "neq";
    case "~":
      return "contains";
    case ">":
      return DATE_FIELDS[field] ? "after" : "gt";
    case "<":
      return DATE_FIELDS[field] ? "before" : "lt";
    default:
      return field === "tag" ? "has" : "eq";
  }
}

function coerceValue(field: QueryField, raw: string): QueryValue {
  if (NUMBER_FIELDS[field]) {
    const n = Number(raw);
    if (Number.isNaN(n))
      throw new QueryParseError(`Field "${field}" expects a number, got "${raw}"`);
    return n;
  }
  if (BOOL_FIELDS[field]) return raw === "true";
  const enumSchema = ENUM_FIELDS[field];
  if (enumSchema) {
    const parsed = enumSchema.safeParse(raw);
    if (!parsed.success) throw new QueryParseError(`Invalid value "${raw}" for field "${field}"`);
    return parsed.data as QueryValue;
  }
  return raw;
}

// ---- Recursive-descent parser ----------------------------------------------
// Precedence: OR (lowest) < AND < NOT < atom. AND/OR produce flat n-ary nodes.

class Parser {
  private pos = 0;
  constructor(private readonly tokens: Token[]) {}

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }
  private next(): Token | undefined {
    return this.tokens[this.pos++];
  }

  parse(): QueryNode {
    const node = this.parseOr();
    if (this.pos !== this.tokens.length) throw new QueryParseError("Unexpected trailing input");
    return node;
  }

  private parseOr(): QueryNode {
    const nodes = [this.parseAnd()];
    while (this.peek()?.t === "or") {
      this.next();
      nodes.push(this.parseAnd());
    }
    return nodes.length === 1 ? nodes[0]! : { kind: "or", nodes };
  }

  private parseAnd(): QueryNode {
    const nodes = [this.parseUnary()];
    while (this.peek()?.t === "and") {
      this.next();
      nodes.push(this.parseUnary());
    }
    return nodes.length === 1 ? nodes[0]! : { kind: "and", nodes };
  }

  private parseUnary(): QueryNode {
    if (this.peek()?.t === "not") {
      this.next();
      return { kind: "not", node: this.parseUnary() };
    }
    return this.parseAtom();
  }

  private parseAtom(): QueryNode {
    const tok = this.next();
    if (!tok) throw new QueryParseError("Unexpected end of input");
    if (tok.t === "lparen") {
      const node = this.parseOr();
      if (this.next()?.t !== "rparen") throw new QueryParseError("Missing closing parenthesis");
      return node;
    }
    if (tok.t === "term") return parseTerm(tok.raw);
    throw new QueryParseError(`Unexpected token "${tok.t}"`);
  }
}

export function parse(input: string): QueryNode {
  const tokens = tokenize(input);
  if (tokens.length === 0) throw new QueryParseError("Empty query");
  return new Parser(tokens).parse();
}
