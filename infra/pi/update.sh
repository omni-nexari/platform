#!/usr/bin/env bash
# update.sh — Run this directly on the Pi to pull latest code and restart
# Usage:  bash /opt/nexari/infra/pi/update.sh
# Env vars (with defaults matching the original signage Pi for backward compat):
#   APP_DIR          — app root (default: /opt/signage)
#   BRANCH           — git branch (default: main)
#   ENV_DIR          — directory containing api.env (default: /etc/signage)
#   SERVICE_NAME     — systemd service name (default: signage-api)
#   DATA_DIR         — uploads/tizen/android root (default: /var/signage)
#   NGINX_CONF_FILE  — nginx config filename in infra/nginx/ (default: signage.conf)
#   INSTALL_PLATFORM_VHOST — set to 'true' to install platform.nexari.ca.conf
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/signage}"
BRANCH="${BRANCH:-main}"
ENV_DIR="${ENV_DIR:-/etc/signage}"
SERVICE_NAME="${SERVICE_NAME:-signage-api}"
DATA_DIR="${DATA_DIR:-/var/signage}"
NGINX_CONF_FILE="${NGINX_CONF_FILE:-signage.conf}"
INSTALL_PLATFORM_VHOST="${INSTALL_PLATFORM_VHOST:-false}"
ENV_FILE="$ENV_DIR/api.env"

echo "==> [update] Pulling latest code..."
cd "$APP_DIR"
# Ensure git trusts this directory regardless of which user owns it
git config --global --add safe.directory "$APP_DIR" 2>/dev/null || true
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
sudo systemctl restart "$SERVICE_NAME"

echo "==> [update] Updating nginx config..."
NGINX_CONF="$APP_DIR/infra/nginx/$NGINX_CONF_FILE"
sudo cp "$NGINX_CONF" /etc/nginx/sites-available/"$SERVICE_NAME"
if [[ ! -L /etc/nginx/sites-enabled/"$SERVICE_NAME" ]]; then
    sudo ln -s /etc/nginx/sites-available/"$SERVICE_NAME" /etc/nginx/sites-enabled/"$SERVICE_NAME"
fi
if [[ "$INSTALL_PLATFORM_VHOST" == "true" && -f "$APP_DIR/infra/nginx/platform.nexari.ca.conf" ]]; then
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
sudo mkdir -p "$DATA_DIR/tizen"
sudo chown -R nexari:nexari "$DATA_DIR/tizen"
if compgen -G "$DATA_DIR/tizen/*.wgt" > /dev/null 2>&1; then
    wgt_file=$(ls -1t "$DATA_DIR"/tizen/*.wgt | head -1)
    wgt_size=$(du -sh "$wgt_file" | cut -f1)
    echo "    WGT present: $(basename $wgt_file) (${wgt_size})"
else
    echo "    WARNING: No .wgt file in $DATA_DIR/tizen/ — run install-nexari2.ps1 from Windows to deploy"
fi

# ── Android assets directory ───────────────────────────────────────────────
# Hosts the latest APK + update.json + dpc-provisioning.json. Created here in
# case the script is run on a fresh clone without a full bootstrap.
echo "==> [update] Checking Android assets directory..."
sudo mkdir -p "$DATA_DIR/android"
sudo chown -R nexari:nexari "$DATA_DIR/android"
if [[ -f "$DATA_DIR/android/nexari-android-latest.apk" ]]; then
    apk_size=$(du -sh "$DATA_DIR/android/nexari-android-latest.apk" | cut -f1)
    echo "    APK present: nexari-android-latest.apk (${apk_size})"
else
    echo "    INFO: No APK in $DATA_DIR/android/ — build via apps/nexari-android and deploy with tools/deploy-android.ps1"
fi

echo ""
echo "Done! Health check:"
curl -s http://127.0.0.1:3000/api/v1/health
echo ""
