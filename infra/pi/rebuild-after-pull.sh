#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# rebuild-after-pull.sh — Lightweight rebuild after a manual git pull
#
# Use this when you've already pulled new commits directly on the Pi and just
# want to rebuild + restart without re-running the full deploy.sh.
#
# Usage:
#   cd /opt/signage
#   bash infra/pi/rebuild-after-pull.sh
#
# Override the app directory:
#   APP_DIR=/some/other/path bash infra/pi/rebuild-after-pull.sh
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/signage}"
ENV_FILE="/etc/signage/api.env"

cd "$APP_DIR"

# ── Validate env file ─────────────────────────────────────────────────────────
if [[ ! -f "$ENV_FILE" ]]; then
    echo "ERROR: $ENV_FILE not found. Cannot run migrations."
    exit 1
fi

# ── Stash any local changes ───────────────────────────────────────────────────
STASH_NAME=""
if ! git diff --quiet || ! git diff --cached --quiet || [[ -n "$(git ls-files --others --exclude-standard)" ]]; then
    STASH_NAME="rebuild-$(date +%Y%m%d-%H%M%S)"
    echo "==> [rebuild] Stashing local changes as '$STASH_NAME'..."
    git stash push --include-untracked -m "$STASH_NAME"
fi

# ── Clean dist directories ────────────────────────────────────────────────────
echo "==> [rebuild] Removing stale dist directories..."
rm -rf \
    packages/db/dist \
    packages/shared/dist \
    apps/api/dist \
    apps/ds/dist

# ── Install dependencies ──────────────────────────────────────────────────────
echo "==> [rebuild] Installing dependencies..."
pnpm install --frozen-lockfile

# ── Build (scoped — excludes nexari-tizen) ────────────────────────────────────
echo "==> [rebuild] Building packages..."
pnpm --filter @signage/db      build
pnpm --filter @signage/shared  build
pnpm --filter @signage/api     build
pnpm --filter @signage/ds      build

# ── DB migrations ─────────────────────────────────────────────────────────────
echo "==> [rebuild] Running database migrations..."
set -a; source "$ENV_FILE"; set +a
pnpm db:migrate

# ── Restart service ───────────────────────────────────────────────────────────
echo "==> [rebuild] Restarting signage-api..."
sudo systemctl restart signage-api

sleep 2
if curl -sf http://127.0.0.1:3000/api/v1/health > /dev/null; then
    echo "    Health check PASSED"
else
    echo "!!! Health check FAILED — check: journalctl -u signage-api -n 50 --no-pager"
    exit 1
fi

echo ""
echo "✓ Rebuild complete."
if [[ -n "$STASH_NAME" ]]; then
    echo "  Local changes were stashed as: $STASH_NAME"
    echo "  To restore: git stash list  |  git stash pop"
fi
