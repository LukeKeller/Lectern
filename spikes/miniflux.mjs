// D1 spike: exercise the MiniFlux REST API we rely on.
// Run: node --env-file=.env spikes/miniflux.mjs
const BASE = process.env.MINIFLUX_URL ?? "http://localhost:8088";
const AUTH =
  "Basic " + Buffer.from(process.env.MINIFLUX_BASIC ?? "admin:adminpass").toString("base64");
const FEED_URL = "https://simonwillison.net/atom/everything/";

async function mf(path, { method = "GET", body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { Authorization: AUTH, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, json };
}
const log = (l, v) =>
  console.log(`\n## ${l}\n${typeof v === "string" ? v : JSON.stringify(v, null, 2)}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const findings = {};

const me = await mf("/v1/me");
log("me.status / username", `${me.status} / ${me.json?.username}`);

// Category (idempotent)
let cat = await mf("/v1/categories", { method: "POST", body: { title: "Lectern Spike" } });
if (cat.status !== 201) {
  const all = await mf("/v1/categories");
  cat = { status: 200, json: all.json.find((c) => c.title === "Lectern Spike") };
}
const categoryId = cat.json.id;
log("category id", categoryId);

// Feed (idempotent)
let feed = await mf("/v1/feeds", {
  method: "POST",
  body: { feed_url: FEED_URL, category_id: categoryId },
});
let feedId = feed.json?.feed_id;
if (!feedId) {
  const all = await mf("/v1/feeds");
  feedId = all.json.find((f) => f.feed_url === FEED_URL)?.id;
}
log("feed_id (create status " + feed.status + ")", feedId);

await mf(`/v1/feeds/${feedId}/refresh`, { method: "PUT" });
let entries = { json: { total: 0, entries: [] } };
for (let i = 0; i < 15; i++) {
  await sleep(1500);
  entries = await mf(`/v1/entries?feed_id=${feedId}&limit=3&order=published_at&direction=desc`);
  if ((entries.json?.total ?? 0) > 0) break;
}
log("entries total", entries.json?.total);
const entry = entries.json.entries[0];
findings.entryFields = entry ? Object.keys(entry) : [];
log("entry[0] fields", findings.entryFields);
log("entry[0] sample", {
  id: entry?.id,
  status: entry?.status,
  starred: entry?.starred,
  title: entry?.title?.slice(0, 60),
  reading_time: entry?.reading_time,
  content_len: entry?.content?.length,
});

const id = entry.id;
const counters = await mf("/v1/feeds/counters");
log("counters keys", Object.keys(counters.json));

const markRead = await mf("/v1/entries", {
  method: "PUT",
  body: { entry_ids: [id], status: "read" },
});
const bookmark = await mf(`/v1/entries/${id}/bookmark`, { method: "PUT" });
const after = await mf(`/v1/entries/${id}`);
findings.statusWrite = after.json.status === "read";
findings.starWrite = after.json.starred === true;
log("after mark-read+bookmark", {
  status: markRead.status,
  bookmark: bookmark.status,
  entryStatus: after.json.status,
  starred: after.json.starred,
});

const fetched = await mf(`/v1/entries/${id}/fetch-content`);
findings.fetchContentLen = fetched.json?.content?.length ?? 0;
log("fetch-content status / content length", `${fetched.status} / ${findings.fetchContentLen}`);

// Delta candidates
const ts = Math.floor(Date.now() / 1000) - 3600;
const changedAfter = await mf(`/v1/entries?changed_after=${ts}&limit=1`);
const publishedAfter = await mf(`/v1/entries?published_after=${ts}&limit=1`);
findings.changedAfterWorks =
  changedAfter.status === 200 && typeof changedAfter.json?.total === "number";
findings.publishedAfterWorks =
  publishedAfter.status === 200 && typeof publishedAfter.json?.total === "number";
log("delta params (changed_after / published_after)", {
  changed_after: { status: changedAfter.status, total: changedAfter.json?.total },
  published_after: { status: publishedAfter.status, total: publishedAfter.json?.total },
});

const search = await mf(`/v1/entries?search=python&limit=1`);
findings.searchWorks = search.status === 200;
log("search?search=python total", search.json?.total);

const opml = await mf("/v1/export");
findings.opmlExport = typeof opml.json === "string" && opml.json.includes("<opml");
log("OPML export ok", findings.opmlExport);

log("FINDINGS", findings);
