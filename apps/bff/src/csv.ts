/**
 * Minimal RFC-4180 CSV parser (handles quoted fields, escaped quotes, embedded
 * commas/newlines) plus a tolerant mapper for Readwise Reader library exports.
 * Column names vary, so headers are matched case-insensitively with a
 * contains-fallback.
 */

export function parseCsv(text: string): string[][] {
  const s = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ",") {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i++;
      continue;
    }
    field += c;
    i++;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export interface ReadwiseRow {
  url: string;
  title?: string;
  tags: string[];
  /** Readwise location: new | later | shortlist | archive | feed (lowercased). */
  location?: string;
}

function findColumn(header: string[], names: string[]): number {
  for (const n of names) {
    const idx = header.indexOf(n);
    if (idx >= 0) return idx;
  }
  for (let i = 0; i < header.length; i++) {
    if (names.some((n) => header[i]!.includes(n))) return i;
  }
  return -1;
}

/**
 * Parse a Readwise Reader CSV export into importable rows. Prefers the original
 * article link ("Source URL") over the in-app "URL"; only http(s) rows are kept.
 */
export function parseReadwiseCsv(text: string): ReadwiseRow[] {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const header = rows[0]!.map((h) => h.trim().toLowerCase());
  const urlIdx = findColumn(header, ["source url", "source_url", "url"]);
  const titleIdx = findColumn(header, ["title"]);
  const tagsIdx = findColumn(header, ["document tags", "tags"]);
  const locIdx = findColumn(header, ["location"]);
  if (urlIdx < 0) return [];

  const out: ReadwiseRow[] = [];
  for (let r = 1; r < rows.length; r++) {
    const cols = rows[r]!;
    const url = (cols[urlIdx] ?? "").trim();
    if (!/^https?:\/\//i.test(url)) continue;
    const tagsRaw = tagsIdx >= 0 ? (cols[tagsIdx] ?? "") : "";
    out.push({
      url,
      title: titleIdx >= 0 ? (cols[titleIdx] ?? "").trim() || undefined : undefined,
      tags: tagsRaw
        .split(/[,;]/)
        .map((t) => t.trim())
        .filter(Boolean),
      location: locIdx >= 0 ? (cols[locIdx] ?? "").trim().toLowerCase() || undefined : undefined,
    });
  }
  return out;
}
