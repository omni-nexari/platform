#!/usr/bin/env bash
# update.sh — Run this directly on the Pi to pull latest code and restart
# Usage:  bash /opt/signage/infra/pi/update.sh
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/signage}"
BRANCH="${BRANCH:-main}"
ENV_FILE="/etc/signage/api.env"

echo "==> [update] Pulling latest code..."
cd "$APP_DIR"
# Stash any local modifications to tracked files so the pull can proceed cleanly.
# Migration journal and other generated files can drift on the server; we always
# want the remote version, so pop the stash after pulling (remote wins on conflict).
if ! git diff --quiet HEAD; then
  echo "    Local changes detected — stashing before pull..."
  git stash push --include-untracked -m "update.sh auto-stash $(date -Iseconds)"
  STASHED=1
else
  STASHED=0
fi

git pull origin "$BRANCH"

if [ "$STASHED" = "1" ]; then
  echo "    Restoring stash (remote version wins on conflict)..."
  git stash pop || {
    echo "    WARNING: stash pop had conflicts — keeping remote version for conflicted files"
    git checkout -- .
  }
fi

echo "==> [update] Installing dependencies..."
pnpm install --frozen-lockfile

echo "==> [update] Building..."
pnpm --filter @signage/db     build
pnpm --filter @signage/shared build
pnpm --filter @signage/api    build
pnpm --filter @signage/ds     build

echo "==> [update] Running migrations..."
set -a; source "$ENV_FILE"; set +a
pnpm db:migrate

echo "==> [update] Restarting service..."
sudo systemctl restart signage-api

# ── Tizen assets directory ────────────────────────────────────────────────────
# /var/signage/tizen/ is created by bootstrap.sh, but guard here in case this
# script is run on a fresh clone without a full bootstrap.
# The WGT and sssp_config.xml are deployed here from Windows via install-nexari2.ps1.
echo "==> [update] Checking Tizen assets directory..."
sudo mkdir -p /var/signage/tizen
sudo chown -R "${USER}:${USER}" /var/signage/tizen
if compgen -G "/var/signage/tizen/*.wgt" > /dev/null 2>&1; then
    wgt_file=$(ls -1t /var/signage/tizen/*.wgt | head -1)
    wgt_size=$(du -sh "$wgt_file" | cut -f1)
    echo "    WGT present: $(basename $wgt_file) (${wgt_size})"
else
    echo "    WARNING: No .wgt file in /var/signage/tizen/ — run install-nexari2.ps1 from Windows to deploy"
fi

echo ""
echo "Done! Health check:"
curl -s http://127.0.0.1:3000/api/v1/health
echo ""
