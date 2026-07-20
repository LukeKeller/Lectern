# Newsletter ingestion (IMAP)

Lectern can subscribe to email newsletters by reading them out of a **dedicated
IMAP mailbox** and turning each message into a card in your library. Point it at
a mailbox nothing else reads, subscribe your newsletters to that address, and
Lectern polls it every 5 minutes (background jobs must be enabled).

## The one rule: never hand-edit `.env` on the server

`/var/www/lectern/.env` is a **rendered artifact**. Every `yunohost app upgrade`,
and every config-panel apply, re-renders it from
`packaging/lectern_ynh/conf/.env` using the app's stored settings — silently
discarding anything you edited by hand.

The **app settings are the source of truth**. Change them one of two ways:

```bash
# CLI
yunohost app config set lectern main.newsletters.imap_host 127.0.0.1
yunohost app config get lectern main.newsletters      # inspect current values
```

…or from **Admin UI > Applications > Lectern > Config panel > Newsletter
ingestion**. Both re-render `.env` and restart the service, so the change takes
effect immediately — no upgrade, no SSH.

## Settings

| Setting                | Default | What it does                                                                                |
| ---------------------- | ------- | ------------------------------------------------------------------------------------------- |
| `imap_host`            | (empty) | IMAP server. **Empty disables ingestion entirely.**                                         |
| `imap_port`            | `993`   | `993` implicit TLS, `143` STARTTLS, `1143` Proton Bridge.                                   |
| `imap_user`            | (empty) | Mailbox login.                                                                              |
| `imap_password`        | (empty) | Mailbox password.                                                                           |
| `imap_secure`          | `1`     | `1` = TLS from the first byte (993). `0` = connect plain, upgrade via STARTTLS (143, 1143). |
| `imap_mailbox`         | `INBOX` | Folder to read. Use e.g. `INBOX/Newsletters` if you file them.                              |
| `imap_exclude_senders` | (empty) | Comma-separated `From` addresses to skip. Case-insensitive, exact match.                    |
| `imap_ingest_backlog`  | `0`     | One-off backfill switch — see below.                                                        |
| `node_extra_ca_certs`  | (empty) | Path to an extra CA bundle, for a self-signed IMAP certificate. See below.                  |

### `imap_host` must match the certificate

The host you configure has to match the name on the mail server's TLS
certificate, because Lectern verifies it. For a normal remote mail server that
means your mail domain (`mail.example.com`). It is **never `localhost`** — even
for a server on the same machine, a TLS connection to `localhost` fails the
certificate name check.

Local gateways follow the same rule, they just resolve it differently: Proton
Bridge issues its certificate for `CN=127.0.0.1`, so for Bridge the correct host
is literally `127.0.0.1`.

### `imap_ingest_backlog` is a one-off

Normally Lectern only ingests mail that arrives **after** it starts watching. On
the first run — and after any UIDVALIDITY reset, which happens on **every Proton
Bridge restart** and whenever the host or username changes — it seeds its UID
cursor to the mailbox's current high-water mark and ingests nothing that poll
(the ingestion log says as much).

To import an existing back catalogue: turn `imap_ingest_backlog` **on**, let a
single poll run (up to 5 minutes), then turn it **back off**. Leaving it on means
every UIDVALIDITY reset re-imports the entire mailbox from scratch.

## Proton Bridge

[Proton Bridge](https://proton.me/mail/bridge) runs locally and exposes your
Proton mailbox over IMAP on loopback. Its certificate is self-signed, so Node
needs to be told to trust it.

1. Point Lectern at the bridge:

   ```bash
   yunohost app config set lectern main.newsletters.imap_host 127.0.0.1
   yunohost app config set lectern main.newsletters.imap_port 1143
   yunohost app config set lectern main.newsletters.imap_secure 0
   ```

   Port 1143 is STARTTLS, not implicit TLS — hence `imap_secure=0`. The
   connection is still encrypted and still verified; only the _timing_ of the TLS
   handshake differs.

2. Copy the bridge's certificate somewhere the app user can read it:

   ```bash
   cp ~/.config/protonmail/bridge-v3/cert.pem /var/www/lectern/bridge-cert.pem
   chown lectern:lectern /var/www/lectern/bridge-cert.pem
   chmod 640 /var/www/lectern/bridge-cert.pem
   ```

3. Trust it:

   ```bash
   yunohost app config set lectern main.newsletters.node_extra_ca_certs \
       /var/www/lectern/bridge-cert.pem
   ```

4. Verify from the server:

   ```bash
   openssl s_client -connect 127.0.0.1:1143 -starttls imap \
       -CAfile /var/www/lectern/bridge-cert.pem -verify_return_error
   # => Verification: OK
   ```

### `node_extra_ca_certs` adds trust, it does not disable checking

`NODE_EXTRA_CA_CERTS` appends the given bundle to Node's trusted roots.
Certificate verification stays **fully on** — a wrong hostname or an expired
certificate still fails the handshake. There is deliberately no
`NODE_TLS_REJECT_UNAUTHORIZED` escape hatch in the package: adding the CA is
sufficient, and disabling verification would silently apply to every outbound
TLS connection the BFF makes (MiniFlux, Readeck, article fetches, Web Push),
not just IMAP.

Two things to keep in mind:

- **Empty is safe.** Node ignores an empty `NODE_EXTRA_CA_CERTS` entirely, so
  leave the setting blank when the mail server has a normal publicly-trusted
  certificate.
- **A wrong path is not.** If the file does not exist, Node prints a
  `Warning: Ignoring extra certs from ..., load failed` line on every TLS
  handshake, and the connection then fails verification.

## Troubleshooting

```bash
journalctl -u lectern -f            # ingestion logs
yunohost app config get lectern     # what the settings actually are
```

- `self-signed certificate` → set `node_extra_ca_certs` (see above), and check
  the file is readable by the `lectern` user.
- `Hostname/IP does not match certificate` → `imap_host` is not the certificate's
  name. Use the mail domain, or `127.0.0.1` for Proton Bridge.
- Connection hangs or resets immediately → `imap_secure` does not match the port.
  993 needs `1`; 143 and 1143 need `0`.
- Nothing is ingested on a fresh setup → expected. Lectern starts from the
  mailbox's high-water mark; only mail arriving afterwards becomes a card. Use
  `imap_ingest_backlog` for a one-off import of what is already there.
