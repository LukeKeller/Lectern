#!/usr/bin/env node
/**
 * diagnose-newsletters.mjs — read-only newsletter-ingestion diagnostic.
 *
 * WHY THIS EXISTS. The email path has no observable surface: `ingestion_log`
 * rows are only reachable by hand in psql, and the two states that look
 * identical from the UI — "the mail never reached the mailbox we poll" and "the
 * mail reached it and ingestion dropped it" — need IMAP and Postgres side by
 * side to tell apart. Every previous newsletter bug was diagnosed by guessing
 * from source; this prints the evidence instead.
 *
 * It WRITES NOTHING: no IMAP flags (messages are fetched with envelopes only,
 * and the connection never sets \Seen), no DB mutations, no Readeck calls.
 *
 * Run it ON THE SERVER, from the install's server directory so `imapflow` and
 * `postgres` resolve:
 *
 *   cd /var/www/lectern/server        # or wherever install_dir/server is
 *   node diagnose-newsletters.mjs ../.env
 *
 * The .env path defaults to `../.env` then `./.env`. Nothing is printed in
 * full: passwords are redacted, subjects are truncated.
 */

import { readFileSync } from "node:fs";
import { ImapFlow } from "imapflow";
import postgres from "postgres";

// ---------------------------------------------------------------------------
// env
// ---------------------------------------------------------------------------

/** Minimal .env reader: `KEY=value`, optional quotes, `#` comments. Enough for
 *  the YunoHost-rendered file, which is machine-generated and simple. */
function loadEnv(paths) {
  for (const path of paths) {
    let raw;
    try {
      raw = readFileSync(path, "utf8");
    } catch {
      continue;
    }
    const env = {};
    for (const line of raw.split("\n")) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!m) continue;
      let value = m[2].trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      env[m[1]] = value;
    }
    console.log(`env: ${path}`);
    return env;
  }
  console.log("env: none found, using the process environment only");
  return {};
}

const fileEnv = loadEnv([process.argv[2], "../.env", "./.env"].filter(Boolean));
const env = { ...fileEnv, ...process.env };
const get = (key, fallback = "") => (env[key] ?? "").trim() || fallback;

const IMAP_HOST = get("IMAP_HOST");
const IMAP_PORT = Number.parseInt(get("IMAP_PORT", "993"), 10);
const IMAP_USER = get("IMAP_USER");
const IMAP_PASSWORD = get("IMAP_PASSWORD");
const IMAP_MAILBOX = get("IMAP_MAILBOX", "INBOX");
const IMAP_SECURE = get("IMAP_SECURE", "1") !== "0";
const DATABASE_URL = get("DATABASE_URL", "postgres://lectern:lectern@localhost:5433/lectern");

const NEWSLETTER_URL_BASE = "https://newsletter.lectern.local/";
/** Mirrors `PCHAR_ESCAPES` in backends/email-inbox.ts — the forms Readeck's URL
 *  normalizer can store a synthetic newsletter URL under. */
const PCHAR_ESCAPES = [
  [/%40/g, "@"],
  [/%3A/gi, ":"],
  [/%24/g, "$"],
  [/%26/g, "&"],
  [/%2B/gi, "+"],
  [/%2C/gi, ","],
  [/%3B/gi, ";"],
  [/%3D/gi, "="],
];

function newsletterUrlVariants(messageId) {
  const encoded = NEWSLETTER_URL_BASE + encodeURIComponent(messageId.replace(/^<|>$/g, "").trim());
  let normalized = encoded;
  for (const [pattern, literal] of PCHAR_ESCAPES) normalized = normalized.replace(pattern, literal);
  return normalized === encoded ? [encoded] : [encoded, normalized];
}

function heading(title) {
  console.log(`\n${"=".repeat(72)}\n${title}\n${"=".repeat(72)}`);
}

const trunc = (s, n) => {
  const v = (s ?? "").replace(/\s+/g, " ").trim();
  return v.length > n ? `${v.slice(0, n - 1)}…` : v;
};

// ---------------------------------------------------------------------------
// 1. config
// ---------------------------------------------------------------------------

heading("1. CONFIG");
console.log(`LECTERN_ENABLE_JOBS   ${get("LECTERN_ENABLE_JOBS") || "(unset)"}`);
console.log(`LECTERN_ENABLE_EMAIL  ${get("LECTERN_ENABLE_EMAIL") || "(unset)"}`);
console.log(`IMAP_HOST             ${IMAP_HOST || "(unset — ingestion disabled)"}`);
console.log(`IMAP_PORT             ${IMAP_PORT}`);
console.log(`IMAP_USER             ${IMAP_USER}`);
console.log(`IMAP_PASSWORD         ${IMAP_PASSWORD ? "(set)" : "(EMPTY)"}`);
console.log(`IMAP_MAILBOX          ${IMAP_MAILBOX}`);
console.log(`IMAP_SECURE           ${IMAP_SECURE}`);
console.log(`IMAP_INGEST_BACKLOG   ${get("IMAP_INGEST_BACKLOG") || "(unset)"}`);
console.log(`IMAP_EXCLUDE_SENDERS  ${get("IMAP_EXCLUDE_SENDERS") || "(none)"}`);
if (get("LECTERN_ENABLE_EMAIL") !== "1" || get("LECTERN_ENABLE_JOBS") !== "1") {
  console.log('\n  !! The email poll only runs when BOTH flags are exactly "1".');
}

// ---------------------------------------------------------------------------
// 2. glue DB state
// ---------------------------------------------------------------------------

const sql = postgres(DATABASE_URL, { max: 1, onnotice: () => {} });
/** Message-IDs already indexed, from every URL form — the duplicate check. */
const knownUrls = new Map();

try {
  heading("2. GLUE DB");

  const [cursor] = await sql`select cursor, updated_at from sync_cursors where source = 'email'`;
  console.log(
    `cursor                ${cursor ? `${cursor.cursor}  (updated ${cursor.updated_at.toISOString()})` : "(none — next poll cold-starts)"}`,
  );

  const [ignore] = await sql`select value from app_settings where key = 'email-ignore'`;
  console.log(`ignore list           ${JSON.stringify(ignore?.value?.senders ?? [])}`);

  const [failures] = await sql`select value from app_settings where key = 'email-failures'`;
  console.log(`per-uid failures      ${JSON.stringify(failures?.value ?? {})}`);

  const counts = await sql`
    select category,
           count(*) filter (where deleted_at is null) as live,
           count(*) filter (where deleted_at is not null) as tombstoned
    from documents group by category order by category`;
  console.log("\ndocuments by category:");
  for (const row of counts) {
    console.log(
      `  ${String(row.category).padEnd(10)} live ${row.live}   tombstoned ${row.tombstoned}`,
    );
  }

  const recent = await sql`
    select id, url, saved_at, published_at, deleted_at,
           metadata->'card'->>'author' as author,
           metadata->'card'->>'title'  as title
    from documents
    where category = 'email'
    order by saved_at desc nulls last
    limit 15`;
  console.log("\n15 most recent email documents (newest first):");
  if (recent.length === 0) console.log("  (none)");
  for (const row of recent) {
    const flag = row.deleted_at ? "DELETED" : "live   ";
    console.log(
      `  ${flag} ${row.saved_at ? row.saved_at.toISOString().slice(0, 16) : "??".padEnd(16)}  ` +
        `${trunc(row.author, 24).padEnd(24)} ${trunc(row.title, 46)}`,
    );
  }

  // Every synthetic newsletter URL we hold, live or tombstoned. This is exactly
  // what `findByAnyUrl` matches against, so a hit here means ingestion WILL skip
  // that message as a duplicate.
  const urlRows = await sql`
    select url, deleted_at from documents
    where url like ${NEWSLETTER_URL_BASE + "%"}`;
  for (const row of urlRows) knownUrls.set(row.url, row.deleted_at !== null);
  console.log(`\nsynthetic newsletter URLs indexed: ${urlRows.length}`);

  heading("3. INGESTION LOG (source = email, newest 30)");
  const logs = await sql`
    select created_at, status, message from ingestion_log
    where source = 'email' order by created_at desc limit 30`;
  if (logs.length === 0) console.log("(no rows — the poll has never run, or logs were pruned)");
  for (const row of logs) {
    console.log(
      `${row.created_at.toISOString().slice(0, 19)}  ${String(row.status).padEnd(5)} ${trunc(row.message, 160)}`,
    );
  }
} finally {
  // The IMAP section below needs no DB, and holding a connection open across a
  // slow network walk is pointless.
  await sql.end({ timeout: 5 });
}

// ---------------------------------------------------------------------------
// 4. IMAP
// ---------------------------------------------------------------------------

if (!IMAP_HOST) {
  heading("4. IMAP — SKIPPED (IMAP_HOST is empty, so ingestion is disabled)");
  process.exit(0);
}

heading("4. IMAP");
const client = new ImapFlow({
  host: IMAP_HOST,
  port: IMAP_PORT,
  secure: IMAP_SECURE,
  auth: { user: IMAP_USER, pass: IMAP_PASSWORD },
  logger: false,
});

await client.connect();
try {
  // Every folder with its message count. THE POINT: if the configured mailbox
  // holds ordinary mail while a sibling folder holds the newsletters, a
  // server-side filter is moving them out of our reach and no amount of
  // ingestion fixing will help — IMAP_MAILBOX is what has to change.
  console.log("folders (name — messages):");
  for (const box of await client.list()) {
    let count = "?";
    try {
      const status = await client.status(box.path, { messages: true });
      count = String(status.messages ?? "?");
    } catch {
      count = "(no access)";
    }
    const mark = box.path === IMAP_MAILBOX ? " <-- IMAP_MAILBOX" : "";
    console.log(`  ${box.path.padEnd(40)} ${count}${mark}`);
  }

  const lock = await client.getMailboxLock(IMAP_MAILBOX);
  try {
    const mailbox = client.mailbox;
    console.log(
      `\n${IMAP_MAILBOX}: exists=${mailbox.exists} uidValidity=${mailbox.uidValidity} uidNext=${mailbox.uidNext}`,
    );

    // Envelopes only — no bodies, no flag changes. 25 newest by UID.
    const from = Math.max(1, (Number(mailbox.uidNext) || 1) - 25);
    console.log(`\nnewest messages (uid ${from}:*), with what ingestion would do:\n`);
    const excluded = new Set(
      get("IMAP_EXCLUDE_SENDERS")
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
    );
    for await (const msg of client.fetch(
      `${from}:*`,
      { uid: true, envelope: true },
      { uid: true },
    )) {
      const env0 = msg.envelope ?? {};
      const sender = env0.from?.[0] ?? {};
      const address = (sender.address ?? "").toLowerCase();
      const name = (sender.name ?? "").trim();
      const messageId = env0.messageId ?? `<uid-${msg.uid}@${IMAP_MAILBOX}>`;

      let verdict = "would SAVE";
      if (excluded.has(address) || excluded.has(name.toLowerCase())) {
        verdict = "skip: EXCLUDED sender";
      } else {
        for (const url of newsletterUrlVariants(messageId)) {
          if (knownUrls.has(url)) {
            verdict = `skip: DUPLICATE (${knownUrls.get(url) ? "tombstoned" : "live"} doc)`;
            break;
          }
        }
      }
      console.log(
        `  uid ${String(msg.uid).padEnd(6)} ${(env0.date ? env0.date.toISOString().slice(0, 16) : "").padEnd(16)} ` +
          `${trunc(name || address, 26).padEnd(26)} ${trunc(env0.subject, 40).padEnd(40)} ${verdict}`,
      );
    }

    console.log(
      "\nRead the cursor from section 2 as `<uidValidity>:<lastUid>`. If its uidValidity\n" +
        `does not equal ${mailbox.uidValidity}, the next poll cold-starts and ingests NOTHING that pass.\n` +
        "If its lastUid is already at or above the newest uid above, there is nothing new to fetch.",
    );
  } finally {
    lock.release();
  }
} finally {
  await client.logout();
}
