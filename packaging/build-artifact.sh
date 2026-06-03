#!/usr/bin/env bash
# Build the self-contained Lectern runtime artifact into the YunoHost package's
# sources/ dir: a bundled BFF (+ production node_modules), the static web SPA,
# and the DB migrations. The package's install/upgrade scripts copy these into
# place (no build on the server).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PKG="$ROOT/packaging/lectern_ynh"
SRC="$PKG/sources"
DEPLOY="/tmp/lectern-bff-deploy"

cd "$ROOT"

# Bake the deploy version (from the YunoHost manifest) + short commit into the
# web build so the UI can show exactly what's running (see vite.config.ts).
MANIFEST_VERSION="$(sed -n 's/^version = "\(.*\)"/\1/p' "$PKG/manifest.toml" | head -1)"
GIT_SHA="$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo unknown)"
export LECTERN_VERSION="${MANIFEST_VERSION:-dev} (${GIT_SHA})"
echo "==> Version: $LECTERN_VERSION"

echo "==> Building web (static SPA)"
pnpm --filter @lectern/web build

echo "==> Building bff (bundle)"
pnpm --filter @lectern/bff build

echo "==> Resolving production node_modules (pnpm deploy)"
rm -rf "$DEPLOY"
pnpm --filter @lectern/bff deploy --prod --legacy "$DEPLOY"

echo "==> Assembling artifact -> $SRC"
rm -rf "$SRC"
mkdir -p "$SRC/server" "$SRC/web" "$SRC/migrations"
cp -a "$DEPLOY/dist" "$SRC/server/dist"
cp -a "$DEPLOY/node_modules" "$SRC/server/node_modules"
cp -a "$DEPLOY/package.json" "$SRC/server/package.json"
cp -a "$ROOT/apps/web/build/." "$SRC/web/"
cp -a "$ROOT/apps/bff/drizzle/"*.sql "$SRC/migrations/"

echo "==> Restoring full workspace deps (pnpm deploy --prod prunes dev deps)"
pnpm install --frozen-lockfile >/dev/null

echo "==> Done. Artifact sizes:"
du -sh "$SRC"/server "$SRC"/web "$SRC"/migrations
