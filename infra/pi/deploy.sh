#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# deploy.sh — Full deploy / redeploy
#
# Called by tools/deploy-pi.ps1 via SSH stdin, or run directly on the host.
# Required env vars (injected by deploy-pi.ps1):
#   GIT_REPO   — HTTPS clone URL (e.g. https://github.com/org/Platform.git)
#   BRANCH     — git branch to deploy (default: main)
#   APP_DIR    — app root (default: /opt/nexari)
# Optional:
#   CERTBOT_EMAIL — if set, obtains TLS cert if none exists yet
#   SSL_DOMAIN / CERTBOT_DOMAINS — domain(s) for certbot/nginx
#   NGINX_SERVER_NAMES — nginx server_name list (e.g. "partner.com *.partner.com")
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/nexari}"
APP_USER="${APP_USER:-nexari}"
APP_GROUP="${APP_GROUP:-$APP_USER}"
BRANCH="${BRANCH:-main}"
GIT_REPO="${GIT_REPO:-}"
CERTBOT_EMAIL="${CERTBOT_EMAIL:-}"
ENV_DIR="${ENV_DIR:-/etc/signage}"
SERVICE_NAME="${SERVICE_NAME:-signage-api}"
NGINX_CONF_FILE="${NGINX_CONF_FILE:-signage.conf}"
NGINX_SOURCE_DOMAIN="${NGINX_SOURCE_DOMAIN:-ds.chiho.app}"
NGINX_SERVER_NAMES="${NGINX_SERVER_NAMES:-}"
PUBLIC_URL="${PUBLIC_URL:-}"
LAN_URL="${LAN_URL:-}"
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

git fetch origin "$BRANCH"
git checkout "$BRANCH"
git reset --hard "origin/$BRANCH"

# ── Install dependencies ──────────────────────────────────────────────────────
echo "==> [deploy] Installing dependencies..."
pnpm install --no-frozen-lockfile

# ── Build (scoped — excludes nexari-tizen, which is built on Windows) ─────────
echo "==> [deploy] Building packages..."
pnpm --filter @signage/db      build
pnpm --filter @signage/shared  build
pnpm --filter @signage/api     build
pnpm --filter @signage/ds      build

# ── DB migrations ─────────────────────────────────────────────────────────────
echo "==> [deploy] Running database migrations..."
sudo bash -c "
    set -euo pipefail
    set -a
    source '$ENV_FILE'
    set +a
    cd '$APP_DIR'
    node packages/db/scripts/migrate.js
"

PRIMARY_DOMAIN="${SSL_DOMAIN:-}"
if [[ -z "$PRIMARY_DOMAIN" && -n "${APP_URL:-}" ]]; then
    PRIMARY_DOMAIN="$(printf '%s' "$APP_URL" | sed -E 's#^https?://##; s#/.*$##')"
fi
if [[ -z "$PUBLIC_URL" && -n "${APP_URL:-}" ]]; then
    PUBLIC_URL="$APP_URL"
fi

CERTBOT_DOMAINS="${CERTBOT_DOMAINS:-$PRIMARY_DOMAIN}"
if [[ -z "$NGINX_SERVER_NAMES" ]]; then
    NGINX_SERVER_NAMES="$PRIMARY_DOMAIN"
fi

# ── TLS / certbot ─────────────────────────────────────────────────────────────
# The nginx config references final certificate paths, so on first install we
# must obtain certificates before running `nginx -t` against that config.
if [[ -n "$CERTBOT_EMAIL" && -n "$CERTBOT_DOMAINS" ]]; then
    echo "==> [deploy] Ensuring TLS certificates..."
    sudo systemctl stop nginx 2>/dev/null || true

    certbot_domain_args=()
    for domain in $CERTBOT_DOMAINS; do
        if [[ "$domain" == *"*"* ]]; then
            echo "ERROR: Wildcard certificates like '$domain' require DNS-01 validation."
            echo "       Use a DNS provider/plugin (Cloudflare, Route53, etc.) or pass exact domains only."
            echo "       You can still set NGINX_SERVER_NAMES='partner.com *.partner.com' after installing a wildcard certificate manually."
            exit 1
        fi
        certbot_domain_args+=("-d" "$domain")
    done

    echo "==> [deploy] Obtaining/updating TLS certificate for: $CERTBOT_DOMAINS"
    sudo certbot certonly --standalone --expand \
        "${certbot_domain_args[@]}" \
        --email "$CERTBOT_EMAIL" \
        --agree-tos \
        --non-interactive
fi

# ── nginx config ──────────────────────────────────────────────────────────────
echo "==> [deploy] Installing nginx config..."
NGINX_CONF="$APP_DIR/infra/nginx/$NGINX_CONF_FILE"
if [[ ! -f "$NGINX_CONF" ]]; then
    echo "ERROR: nginx config not found: $NGINX_CONF"
    exit 1
fi

tmp_nginx="$(mktemp)"
cp "$NGINX_CONF" "$tmp_nginx"
sed -i "s|/opt/signage|$APP_DIR|g" "$tmp_nginx"
if [[ -n "$PRIMARY_DOMAIN" ]]; then
    if [[ -n "$NGINX_SERVER_NAMES" ]]; then
        sed -i "s|server_name $NGINX_SOURCE_DOMAIN;|server_name $NGINX_SERVER_NAMES;|g" "$tmp_nginx"
    fi
    sed -i "s|$NGINX_SOURCE_DOMAIN|$PRIMARY_DOMAIN|g" "$tmp_nginx"
fi
sudo cp "$tmp_nginx" /etc/nginx/sites-available/"$SERVICE_NAME"
rm -f "$tmp_nginx"

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

# certbot certonly --standalone issues certificates but may not create the
# nginx helper files normally written by the nginx plugin. The bundled nginx
# configs include these paths, so create safe fallbacks before nginx -t.
if [[ -d /etc/letsencrypt ]]; then
    if [[ ! -f /etc/letsencrypt/options-ssl-nginx.conf ]]; then
        echo "==> [deploy] Creating /etc/letsencrypt/options-ssl-nginx.conf fallback..."
        sudo tee /etc/letsencrypt/options-ssl-nginx.conf > /dev/null <<'EOF'
ssl_session_cache shared:le_nginx_SSL:10m;
ssl_session_timeout 1440m;
ssl_session_tickets off;
ssl_protocols TLSv1.2 TLSv1.3;
ssl_prefer_server_ciphers off;
EOF
    fi

    if [[ ! -f /etc/letsencrypt/ssl-dhparams.pem ]]; then
        echo "==> [deploy] Creating /etc/letsencrypt/ssl-dhparams.pem fallback..."
        sudo openssl dhparam -out /etc/letsencrypt/ssl-dhparams.pem 2048
    fi
fi

if sudo grep -Eq '^\s*cp_nodelay\b' /etc/nginx/nginx.conf; then
    echo "ERROR: /etc/nginx/nginx.conf contains 'cp_nodelay', which is not a valid nginx directive."
    echo "       Run: sudo sed -i 's/^\([[:space:]]*\)cp_nodelay/\1tcp_nodelay/' /etc/nginx/nginx.conf"
    echo "       Then rerun: sudo nginx -t"
    exit 1
fi

sudo nginx -t
sudo systemctl restart nginx

# ── systemd service ───────────────────────────────────────────────────────────
SERVICE_DST="/etc/systemd/system/$SERVICE_NAME.service"

echo "==> [deploy] Writing systemd service file..."
tmp_service="$(mktemp)"
cat > "$tmp_service" <<EOF
[Unit]
Description=Nexari Signage API
After=network.target postgresql.service redis-server.service
Wants=postgresql.service redis-server.service

[Service]
Type=simple
User=$APP_USER
Group=$APP_GROUP
WorkingDirectory=$APP_DIR
EnvironmentFile=$ENV_FILE
ExecStart=/usr/bin/node --max-old-space-size=512 apps/api/dist/index.js
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=$SERVICE_NAME
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF
sudo cp "$tmp_service" "$SERVICE_DST"
rm -f "$tmp_service"
sudo systemctl daemon-reload
sudo systemctl enable "$SERVICE_NAME"

echo "==> [deploy] Restarting $SERVICE_NAME..."
sudo systemctl restart "$SERVICE_NAME"

# ── Health check ──────────────────────────────────────────────────────────────
echo "==> [deploy] Waiting for API to come up..."
sleep 6
if curl -sf "http://127.0.0.1:${API_PORT:-3000}/api/v1/health" > /dev/null; then
    echo "    Health check PASSED"
else
    echo "!!! Health check FAILED — check: journalctl -u $SERVICE_NAME -n 50 --no-pager"
    exit 1
fi

echo ""
echo "✓ Deploy complete."
[[ -n "$PUBLIC_URL" ]] && echo "  Public:  $PUBLIC_URL"
[[ -n "$LAN_URL" ]]    && echo "  LAN:     $LAN_URL"
