#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# deploy.sh — Full deploy / redeploy
#
# Called by tools/deploy-pi.ps1 via SSH stdin.
# Required env vars (injected by deploy-pi.ps1):
#   GIT_REPO   — HTTPS clone URL (e.g. https://github.com/org/Platform.git)
#   BRANCH     — git branch to deploy (default: main)
#   APP_DIR    — app root on Pi (default: /opt/signage)
# Optional:
#   CERTBOT_EMAIL — if set, obtains TLS cert if none exists yet
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/signage}"
BRANCH="${BRANCH:-main}"
GIT_REPO="${GIT_REPO:-}"
CERTBOT_EMAIL="${CERTBOT_EMAIL:-}"
ENV_FILE="/etc/signage/api.env"

# ── Validate env file ─────────────────────────────────────────────────────────
if [[ ! -f "$ENV_FILE" ]]; then
    echo "ERROR: $ENV_FILE not found."
    echo "       Copy infra/env/api.env.example to $ENV_FILE and fill in all values."
    exit 1
fi

# ── Git pull ──────────────────────────────────────────────────────────────────
echo "==> [deploy] Updating repo..."
cd "$APP_DIR"

if [[ -n "$GIT_REPO" ]]; then
    git remote set-url origin "$GIT_REPO"
fi

git fetch origin
git checkout "$BRANCH"
git pull origin "$BRANCH"

# ── Install dependencies ──────────────────────────────────────────────────────
echo "==> [deploy] Installing dependencies..."
pnpm install --frozen-lockfile

# ── Build (scoped — excludes nexari-tizen, which is built on Windows) ─────────
echo "==> [deploy] Building packages..."
pnpm --filter @signage/db      build
pnpm --filter @signage/shared  build
pnpm --filter @signage/api     build
pnpm --filter @signage/ds      build

# ── DB migrations ─────────────────────────────────────────────────────────────
echo "==> [deploy] Running database migrations..."
set -a; source "$ENV_FILE"; set +a
pnpm db:migrate

# ── nginx config ──────────────────────────────────────────────────────────────
echo "==> [deploy] Installing nginx config..."
NGINX_CONF="$APP_DIR/infra/nginx/signage.conf"
# Always write to the canonical 'signage' file (bootstrap may have created it
# without the .conf extension; writing to it keeps the existing symlink valid).
sudo cp "$NGINX_CONF" /etc/nginx/sites-available/signage

# Ensure the symlink exists (idempotent — bootstrap may have already created it)
if [[ ! -L /etc/nginx/sites-enabled/signage ]]; then
    sudo ln -s /etc/nginx/sites-available/signage /etc/nginx/sites-enabled/signage
fi

# Remove stale .conf-suffixed link if a previous deploy created it
[[ -L /etc/nginx/sites-enabled/signage.conf ]] && sudo rm -f /etc/nginx/sites-enabled/signage.conf

# Remove default site if still present
[[ -L /etc/nginx/sites-enabled/default ]] && sudo rm -f /etc/nginx/sites-enabled/default

sudo nginx -t
sudo systemctl reload nginx

# ── TLS / certbot ─────────────────────────────────────────────────────────────
if [[ -n "$CERTBOT_EMAIL" ]]; then
    CERT_PATH="/etc/letsencrypt/live/ds.chiho.app/fullchain.pem"
    if [[ ! -f "$CERT_PATH" ]]; then
        echo "==> [deploy] Obtaining TLS certificate via certbot..."
        sudo certbot --nginx \
            -d ds.chiho.app \
            --email "$CERTBOT_EMAIL" \
            --agree-tos \
            --non-interactive \
            --redirect
        sudo systemctl reload nginx
    else
        echo "==> [deploy] TLS cert already exists, skipping certbot."
    fi
fi

# ── systemd service ───────────────────────────────────────────────────────────
SERVICE_SRC="$APP_DIR/infra/systemd/signage-api.service"
SERVICE_DST="/etc/systemd/system/signage-api.service"

# Refresh service file if it changed
if ! cmp -s "$SERVICE_SRC" "$SERVICE_DST" 2>/dev/null; then
    echo "==> [deploy] Updating systemd service file..."
    sudo cp "$SERVICE_SRC" "$SERVICE_DST"
    sudo systemctl daemon-reload
    sudo systemctl enable signage-api
fi

echo "==> [deploy] Restarting signage-api..."
sudo systemctl restart signage-api

# ── Health check ──────────────────────────────────────────────────────────────
echo "==> [deploy] Waiting for API to come up..."
sleep 3
if curl -sf http://127.0.0.1:3000/api/v1/health > /dev/null; then
    echo "    Health check PASSED"
else
    echo "!!! Health check FAILED — check: journalctl -u signage-api -n 50 --no-pager"
    exit 1
fi

echo ""
echo "✓ Deploy complete."
echo "  Public:  https://ds.chiho.app"
echo "  LAN:     http://192.168.1.17"
