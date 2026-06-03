// D1 spike: exercise the Readeck REST API + sample extraction quality.
// Run: node --env-file=.env spikes/readeck.mjs
const BASE = process.env.READECK_URL ?? "http://localhost:8089";
const TOKEN = process.env.READECK_API_TOKEN;
const SAMPLE = [
  "https://danluu.com/web-bloat/",
  "https://overreacted.io/a-complete-guide-to-useeffect/",
  "https://blog.codinghorror.com/the-best-code-is-no-code-at-all/",
  "https://en.wikipedia.org/wiki/RSS",
];

async function rd(path, { method = "GET", body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      Authorization: "Bearer " + TOKEN,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, headers: Object.fromEntries(res.headers), json, text };
}
const log = (l, v) =>
  console.log(`\n## ${l}\n${typeof v === "string" ? v : JSON.stringify(v, null, 2)}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const findings = {};

const profile = await rd("/api/profile");
log("profile.status / roles", `${profile.status} / ${profile.json?.provider?.roles}`);

async function createBookmark(url) {
  const r = await rd("/api/bookmarks", { method: "POST", body: { url } });
  let id = r.json?.id ?? r.headers["bookmark-id"];
  if (!id && r.headers["location"]) id = r.headers["location"].split("/").pop();
  return { status: r.status, id, headers: r.headers, json: r.json };
}
async function poll(id, tries = 20) {
  for (let i = 0; i < tries; i++) {
    const b = await rd(`/api/bookmarks/${id}`);
    if (b.json && (b.json.loaded === true || b.json.state === 0)) return b.json;
    await sleep(1200);
  }
  return (await rd(`/api/bookmarks/${id}`)).json;
}

// Create the sample set
const created = [];
for (const url of SAMPLE) {
  const c = await createBookmark(url);
  created.push({ url, ...c });
}
log(
  "create responses",
  created.map((c) => ({
    url: c.url,
    status: c.status,
    id: c.id,
    idSource: c.json?.id ? "body" : "header/location",
  })),
);

// Wait for extraction, then report quality
const extraction = [];
for (const c of created) {
  if (!c.id) {
    extraction.push({ url: c.url, error: "no id" });
    continue;
  }
  const b = await poll(c.id);
  extraction.push({
    url: c.url,
    title: b?.title?.slice(0, 50),
    state: b?.state,
    has_article: b?.has_article,
    word_count: b?.word_count,
    reading_time: b?.reading_time,
    site_name: b?.site_name,
  });
}
log("EXTRACTION SAMPLE", extraction);

// Deep dive on the first bookmark
const main = created[0];
const b = await rd(`/api/bookmarks/${main.id}`);
findings.bookmarkFields = Object.keys(b.json ?? {});
log("bookmark fields", findings.bookmarkFields);

const article = await rd(`/api/bookmarks/${main.id}/article`);
findings.articleHtmlLen = article.text?.length ?? 0;
log(
  "article html length / snippet",
  `${findings.articleHtmlLen}\n${(article.text ?? "").replace(/\s+/g, " ").slice(0, 200)}`,
);

// reading progress + anchor round-trip (THE decisive capability)
const patchProg = await rd(`/api/bookmarks/${main.id}`, {
  method: "PATCH",
  body: { read_progress: 42, read_anchor: "#node-5" },
});
const afterProg = await rd(`/api/bookmarks/${main.id}`);
findings.progressWrite = afterProg.json?.read_progress === 42;
findings.anchorWrite = afterProg.json?.read_anchor === "#node-5";
log("progress round-trip", {
  patch: patchProg.status,
  read_progress: afterProg.json?.read_progress,
  read_anchor: afterProg.json?.read_anchor,
});

// labels round-trip
let patchLabels = await rd(`/api/bookmarks/${main.id}`, {
  method: "PATCH",
  body: { add_labels: ["lectern", "spike"] },
});
let afterLabels = await rd(`/api/bookmarks/${main.id}`);
if (!(afterLabels.json?.labels ?? []).includes("lectern")) {
  patchLabels = await rd(`/api/bookmarks/${main.id}`, {
    method: "PATCH",
    body: { labels: ["lectern", "spike"] },
  });
  afterLabels = await rd(`/api/bookmarks/${main.id}`);
}
findings.labelWrite = (afterLabels.json?.labels ?? []).includes("lectern");
log("labels round-trip", { patch: patchLabels.status, labels: afterLabels.json?.labels });

// annotations / highlights
const annoList = await rd(`/api/bookmarks/${main.id}/annotations`);
findings.annotationsListStatus = annoList.status;
const annoCreate = await rd(`/api/bookmarks/${main.id}/annotations`, {
  method: "POST",
  body: { color: "yellow" },
});
log("annotations list status / create probe", {
  list: { status: annoList.status, isArray: Array.isArray(annoList.json) },
  createProbe: { status: annoCreate.status, body: annoCreate.json },
});

// search + pagination headers
const search = await rd(`/api/bookmarks?search=bloat&limit=5`);
findings.searchStatus = search.status;
findings.paginationHeaders = Object.keys(search.headers).filter((h) =>
  /total|page|link|count/i.test(h),
);
log("search?search=bloat", {
  status: search.status,
  count: Array.isArray(search.json) ? search.json.length : "n/a",
  paginationHeaders: findings.paginationHeaders,
});

// updated-since style delta probe
const updated = await rd(`/api/bookmarks?updated_since=2000-01-01T00:00:00Z&limit=1`);
const sortUpdated = await rd(`/api/bookmarks?sort=-updated&limit=1`);
log("delta probes", { updated_since: updated.status, "sort=-updated": sortUpdated.status });

log("FINDINGS", findings);
