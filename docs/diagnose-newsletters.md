# Diagnosing newsletter ingestion

Newsletters arrive by IMAP and become `category: 'email'` cards on the Newsletters
surface. When they stop arriving, the failure is invisible from the UI: the
`ingestion_log` table is only reachable by hand in psql, and two very different
causes look identical from the browser —

- the mail never reached the mailbox Lectern polls (a server-side filter moved it), and
- the mail reached it and ingestion dropped it (excluded sender, dedupe, poison skip).

`apps/bff/scripts/diagnose-newsletters.mjs` prints both sides at once. It is
**read-only**: envelopes only (no `\Seen` flags set), no DB writes, no Readeck calls.
Passwords are redacted and subjects truncated, so the output is safe to paste.

## Run it on the server

The script imports `imapflow` and `postgres`, so it has to run from the install's
`server/` directory where those are installed.

```bash
# from a checkout, on your machine:
scp apps/bff/scripts/diagnose-newsletters.mjs <server>:/var/www/lectern/server/

# on the server (as root or the lectern user — the .env is mode 400):
cd /var/www/lectern/server
sudo -u lectern node diagnose-newsletters.mjs ../.env > /tmp/newsletters.txt
cat /tmp/newsletters.txt
```

The `.env` path argument is optional; it falls back to `../.env` then `./.env`.
Adjust the install dir if yours differs (`ynh app setting lectern install_dir`).

## Prompt for Claude Code

Paste the output back with:

> Newsletter ingestion is broken again — here is the output of
> `apps/bff/scripts/diagnose-newsletters.mjs` from the live server. Work out which
> stage is dropping the newsletters from this evidence, confirm it against the code
> in `apps/bff/src/backends/email-inbox.ts` and `apps/bff/src/jobs.ts`, and fix the
> actual cause. Do not guess at a cause the output does not support.
>
> ```
> <paste the whole output here>
> ```

## What each section rules out

**1. CONFIG** — the poll only runs when `LECTERN_ENABLE_EMAIL` _and_
`LECTERN_ENABLE_JOBS` are both exactly `1`. Also shows `IMAP_MAILBOX`,
`IMAP_EXCLUDE_SENDERS` and `IMAP_INGEST_BACKLOG`.

**2. GLUE DB** — the email cursor (`<uidvalidity>:<uid>`), the user-managed ignore
list, the per-UID save-failure counters, live/tombstoned document counts by
category, and the 15 newest email documents.

**3. INGESTION LOG** — the newest 30 `source='email'` rows. This is where the
`saved N of M, skipped …` summary and the `SKIPPED after N failed attempts` poison
errors land; nothing else surfaces them.

**4. IMAP** — every folder with its message count (the configured one marked), the
mailbox's `uidValidity`/`uidNext`, and the 25 newest messages annotated with what
ingestion _would_ do to each: `would SAVE`, `skip: EXCLUDED sender`, or
`skip: DUPLICATE (live|tombstoned doc)` — the last computed against the synthetic
newsletter URLs actually present in `documents`.

## Reading the output

| Symptom in the output                                                       | Cause                                                                                                                                                                                                                         |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Newsletters sit in a folder that is **not** `IMAP_MAILBOX`                  | A server-side filter files them away from the polled mailbox. `IMAP_MAILBOX` is hardcoded to `INBOX` by the YunoHost template (`packaging/lectern_ynh/conf/.env`) — either stop the filter, or make the mailbox configurable. |
| Messages show `skip: DUPLICATE (tombstoned doc)`                            | A tombstoned row answers "already seen" forever (`findByAnyUrl` deliberately ignores `deleted_at`), so the issue can never be re-ingested.                                                                                    |
| Non-empty `per-uid failures`, or `SKIPPED after N failed attempts` log rows | Readeck is rejecting the payload. The log row names the subject and sender.                                                                                                                                                   |
| Cursor `uidValidity` ≠ the mailbox's                                        | Every poll cold-starts and ingests nothing; the cursor write is failing to stick.                                                                                                                                             |
| Cursor `lastUid` ≥ the newest UID listed                                    | Lectern has already consumed everything in the mailbox — nothing new arrived.                                                                                                                                                 |
| No `ingestion_log` rows at all                                              | The poll has never run (flags/jobs), or the rows aged out of the nightly prune.                                                                                                                                               |
