import type { Source } from "@lectern/shared";

/**
 * Unified ids are `"<source>:<sourceId>"` (e.g. `miniflux:42`, `readeck:abc`).
 * The colon split is on the FIRST colon so source ids may themselves contain colons.
 */
export interface ParsedId {
  source: Source;
  sourceId: string;
}

export function parseId(id: string): ParsedId | null {
  const i = id.indexOf(":");
  if (i <= 0) return null;
  const source = id.slice(0, i);
  const sourceId = id.slice(i + 1);
  if (sourceId.length === 0) return null;
  if (source !== "miniflux" && source !== "readeck") return null;
  return { source, sourceId };
}
