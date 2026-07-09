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

APP_DIR="${APP_DIR:-/opt/nexari}"
BRANCH="${BRANCH:-main}"
GIT_REPO="${GIT_REPO:-}"
CERTBOT_EMAIL="${CERTBOT_EMAIL:-}"
ENV_DIR="${ENV_DIR:-/etc/nexari}"
SERVICE_NAME="${SERVICE_NAME:-nexari-api}"
NGINX_CONF_FILE="${NGINX_CONF_FILE:-signage.conf}"
ENV_FILE="$ENV_DIR/api.env"

# ── Validate env file ─────────────────────────────────────────────────────────
if [[ ! -f "$ENV_FILE" ]]; then
    echo "ERROR: $ENV_FILE not found."
    echo "       Copy infra/env/api.env.example to $ENV_FILE and fill in all values."
    exit 1
fi

# ── Git pull ──────────────────────────────────────────────────────────────────
echo "==> [deploy] Updating repo..."
cd "$APP_DIR"
git config --global --add safe.directory "$APP_DIR" 2>/dev/null || true

if [[ -n "$GIT_REPO" ]]; then
    git remote set-url origin "$GIT_REPO"
fi

git fetch origin
git checkout "$BRANCH"
git pull origin "$BRANCH"

# ── Install dependencies ──────────────────────────────────────────────────────
echo "==> [deploy] Installing dependencies..."
pnpm install --prefer-offline

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
NGINX_CONF="$APP_DIR/infra/nginx/$NGINX_CONF_FILE"
sudo cp "$NGINX_CONF" /etc/nginx/sites-available/"$SERVICE_NAME"

# Ensure the symlink exists (idempotent)
if [[ ! -L /etc/nginx/sites-enabled/"$SERVICE_NAME" ]]; then
    sudo ln -s /etc/nginx/sites-available/"$SERVICE_NAME" /etc/nginx/sites-enabled/"$SERVICE_NAME"
fi

# Remove stale legacy links
[[ -L /etc/nginx/sites-enabled/signage ]] && sudo rm -f /etc/nginx/sites-enabled/signage
[[ -L /etc/nginx/sites-enabled/signage.conf ]] && sudo rm -f /etc/nginx/sites-enabled/signage.conf

# Remove default site if still present
[[ -L /etc/nginx/sites-enabled/default ]] && sudo rm -f /etc/nginx/sites-enabled/default

# Install the platform vhost only when explicitly requested
INSTALL_PLATFORM_VHOST="${INSTALL_PLATFORM_VHOST:-false}"
if [[ "$INSTALL_PLATFORM_VHOST" == "true" && -f "$APP_DIR/infra/nginx/platform.nexari.ca.conf" ]]; then
    sudo cp "$APP_DIR/infra/nginx/platform.nexari.ca.conf" /etc/nginx/sites-available/platform.nexari.ca.conf
    if [[ ! -L /etc/nginx/sites-enabled/platform.nexari.ca.conf ]]; then
        sudo ln -s /etc/nginx/sites-available/platform.nexari.ca.conf /etc/nginx/sites-enabled/platform.nexari.ca.conf
    fi
fi

sudo nginx -t
sudo systemctl reload nginx

# ── TLS / certbot ─────────────────────────────────────────────────────────────
if [[ -n "$CERTBOT_EMAIL" ]]; then
    ensure_cert() {
        local domain="$1"
        local cert_path="/etc/letsencrypt/live/$domain/fullchain.pem"
        if [[ ! -f "$cert_path" ]]; then
            echo "==> [deploy] Obtaining TLS certificate for $domain via certbot..."
            sudo certbot --nginx \
                -d "$domain" \
                --email "$CERTBOT_EMAIL" \
                --agree-tos \
                --non-interactive \
                --redirect
            sudo systemctl reload nginx
        else
            echo "==> [deploy] TLS cert already exists for $domain, skipping certbot."
        fi
    }

    ensure_cert ds.chiho.app
    ensure_cert platform.nexari.ca
fi

# ── systemd service ───────────────────────────────────────────────────────────
SERVICE_SRC="$APP_DIR/infra/systemd/$SERVICE_NAME.service"
SERVICE_DST="/etc/systemd/system/$SERVICE_NAME.service"

# Refresh service file if it changed
if ! cmp -s "$SERVICE_SRC" "$SERVICE_DST" 2>/dev/null; then
    echo "==> [deploy] Updating systemd service file..."
    sudo cp "$SERVICE_SRC" "$SERVICE_DST"
    sudo systemctl daemon-reload
    sudo systemctl enable "$SERVICE_NAME"
fi

echo "==> [deploy] Restarting $SERVICE_NAME..."
sudo systemctl restart "$SERVICE_NAME"

# ── Health check ──────────────────────────────────────────────────────────────
echo "==> [deploy] Waiting for API to come up..."
sleep 6
if curl -sf http://127.0.0.1:3000/api/v1/health > /dev/null; then
    echo "    Health check PASSED"
else
    echo "!!! Health check FAILED — check: journalctl -u $SERVICE_NAME -n 50 --no-pager"
    exit 1
fi

echo ""
echo "✓ Deploy complete."
echo "  Public:  https://ds.chiho.app"
echo "  LAN:     http://192.168.1.17"
