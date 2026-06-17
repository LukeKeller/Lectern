/**
 * Diagnostic: dump what MiniFlux actually returns for a feed entry, so we can
 * see what's present vs. dropped for X/Bluesky posts (quote posts, images).
 *
 * Searches MiniFlux for a term (e.g. "bsky.app" or "x.com"), then for the first
 * match prints the raw feed body (`entry.content`) alongside the scraped copy
 * (`fetch-content`) — the two inputs to `richerHtml` — plus a tally of the
 * `<img>` and quote/blockquote markup in each.
 *
 * Run against the live MiniFlux (e.g. on the VPS, or through an SSH tunnel):
 *   MINIFLUX_URL=http://localhost:8088 MINIFLUX_API_TOKEN=... \
 *     pnpm --filter ./apps/bff exec tsx src/scripts/inspect-feed.ts "bsky.app"
 *
 * Auth: set MINIFLUX_API_TOKEN, or MINIFLUX_BASIC as "user:pass".
 */
import { htmlToText, richerHtml } from "../html-text";

const term: string = process.argv[2] ?? "";
if (!term) {
  console.error('Usage: inspect-feed.ts "<search term, e.g. bsky.app or x.com>"');
  process.exit(1);
}

const baseUrl = (process.env.MINIFLUX_URL ?? "http://localhost:8088").replace(/\/+$/, "");
const token = process.env.MINIFLUX_API_TOKEN || "";
const basic = process.env.MINIFLUX_BASIC || "";
const auth: Record<string, string> = token
  ? { "X-Auth-Token": token }
  : { Authorization: "Basic " + Buffer.from(basic).toString("base64") };

async function get(path: string): Promise<unknown> {
  const res = await fetch(baseUrl + path, { headers: auth });
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${res.statusText}`);
  return res.json();
}

/** Quick structural tally so the dump is skimmable without reading raw HTML. */
function tally(label: string, html: string): void {
  const imgs = (html.match(/<img\b/gi) ?? []).length;
  const quotes = (html.match(/<blockquote\b/gi) ?? []).length;
  const iframes = (html.match(/<iframe\b/gi) ?? []).length;
  const links = (html.match(/<a\b/gi) ?? []).length;
  console.log(
    `  ${label}: ${htmlToText(html).length} chars text | ${imgs} img | ${quotes} blockquote | ${iframes} iframe | ${links} links`,
  );
}

async function main(): Promise<void> {
  const search = (await get(`/v1/entries?search=${encodeURIComponent(term)}&limit=1`)) as {
    total: number;
    entries: Array<{ id: number; title: string; url: string; content?: string }>;
  };
  const entry = search.entries[0];
  if (!entry) {
    console.error(`No entries matched "${term}".`);
    process.exit(2);
  }

  console.log(`\nEntry ${entry.id}: ${entry.title}`);
  console.log(`URL: ${entry.url}\n`);

  const feedBody = entry.content ?? "";
  let scraped = "";
  try {
    const fc = (await get(`/v1/entries/${entry.id}/fetch-content`)) as { content?: string };
    scraped = fc.content ?? "";
  } catch (e) {
    console.log(`  (fetch-content failed: ${(e as Error).message})`);
  }

  console.log("Structural tally:");
  tally("feed body (entry.content)", feedBody);
  tally("scraped (fetch-content) ", scraped);
  const chosen = richerHtml(feedBody, scraped);
  console.log(`\nricherHtml would serve: ${chosen === feedBody ? "FEED BODY" : "SCRAPED"}\n`);

  console.log("----- FEED BODY (raw) -----\n" + feedBody + "\n");
  console.log("----- SCRAPED (raw) -----\n" + scraped + "\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
