# YunoHost package (D8)

This directory will hold the `lectern_ynh` package (packaging v2), built from the
official [`example_ynh`](https://github.com/YunoHost/example_ynh) template:

- `manifest.toml` — see the skeleton in `docs/planning/architecture-plan.html`.
- `scripts/` — install, upgrade, remove, backup, restore, change_url.
- `conf/` — `nginx.conf` (reverse proxy + Web Share Target) and a hardened `systemd.service`.

The app declares `ldap = true` / `sso = true`, serves the SSO-gated web UI (trusting the
`Ynh-User` header), and exposes a token-authenticated `/api` permission (`auth_header = false`)
for the PWA/Android client. MiniFlux and Readeck are installed separately from the catalog;
the BFF calls their HTTP APIs server-side using tokens stored as app settings.

Filled in during deliverable **D8**.
