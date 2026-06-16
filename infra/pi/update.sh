#!/usr/bin/env bash
# update.sh — Run this directly on the Pi to pull latest code and restart
# Usage:  bash /opt/signage/infra/pi/update.sh
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/signage}"
BRANCH="${BRANCH:-main}"
ENV_FILE="/etc/signage/api.env"

echo "==> [update] Pulling latest code..."
cd "$APP_DIR"
# Hard-reset to remote — the Pi should never have persistent local changes.
# Generated files (migration journal, etc.) are always overwritten by the repo version.
git fetch origin "$BRANCH"
git reset --hard "origin/$BRANCH"

echo "==> [update] Installing dependencies..."
# Use --no-frozen-lockfile so new workspace packages (e.g. nexari-html5-sync,
# nexari-sync-engine) with deps not yet reflected in pnpm-lock.yaml don't block
# the deploy. The lockfile is still written back but not enforced strictly.
pnpm install --no-frozen-lockfile

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

echo "==> [update] Updating nginx config..."
sudo cp "$APP_DIR/infra/nginx/signage.conf" /etc/nginx/sites-available/signage.conf
if [[ -f "$APP_DIR/infra/nginx/platform.nexari.ca.conf" ]]; then
    sudo cp "$APP_DIR/infra/nginx/platform.nexari.ca.conf" /etc/nginx/sites-available/platform.nexari.ca.conf
    if [[ ! -L /etc/nginx/sites-enabled/platform.nexari.ca.conf ]]; then
        sudo ln -s /etc/nginx/sites-available/platform.nexari.ca.conf /etc/nginx/sites-enabled/platform.nexari.ca.conf
    fi
fi
sudo nginx -t && sudo systemctl reload nginx

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

# ── Android assets directory ───────────────────────────────────────────────
# Hosts the latest APK + update.json + dpc-provisioning.json. Created here in
# case the script is run on a fresh clone without a full bootstrap.
echo "==> [update] Checking Android assets directory..."
sudo mkdir -p /var/signage/android
sudo chown -R "${USER}:${USER}" /var/signage/android
if [[ -f /var/signage/android/nexari-android-latest.apk ]]; then
    apk_size=$(du -sh /var/signage/android/nexari-android-latest.apk | cut -f1)
    echo "    APK present: nexari-android-latest.apk (${apk_size})"
else
    echo "    INFO: No APK in /var/signage/android/ — build via apps/nexari-android and deploy with tools/deploy-android.ps1"
fi

echo ""
echo "Done! Health check:"
curl -s http://127.0.0.1:3000/api/v1/health
echo ""
