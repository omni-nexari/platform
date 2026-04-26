#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# bootstrap.sh — One-time Pi setup
#
# Run via deploy-pi.ps1 -RunBootstrap, or manually:
#   sudo bash /opt/signage/infra/pi/bootstrap.sh
#
# Expects:
#   - Ubuntu 24.04 (arm64) or compatible Debian-based distro
#   - sudo access
#   - ~/.netrc already configured with GitHub credentials (done by deploy-pi.ps1)
#   - GIT_REPO env var set (HTTPS clone URL)
#   - APP_DIR env var (default: /opt/signage)
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/signage}"
APP_USER="${APP_USER:-chiho}"
GIT_REPO="${GIT_REPO:-}"
BRANCH="${BRANCH:-main}"

echo "==> [bootstrap] Updating package index..."
sudo apt-get update -qq

echo "==> [bootstrap] Installing system dependencies..."
sudo apt-get install -y --no-install-recommends \
    curl \
    git \
    nginx \
    redis-server \
    certbot \
    python3-certbot-nginx \
    ffmpeg \
    ghostscript \
    libreoffice-common \
    postgresql-client \
    ca-certificates \
    gnupg \
    lsb-release

# ── Node 22 via NodeSource ────────────────────────────────────────────────────
if ! command -v node &>/dev/null || [[ "$(node --version)" != v22* ]]; then
    echo "==> [bootstrap] Installing Node 22 via NodeSource..."
    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
    sudo apt-get install -y nodejs
else
    echo "==> [bootstrap] Node $(node --version) already installed, skipping."
fi

# ── pnpm ──────────────────────────────────────────────────────────────────────
if ! command -v pnpm &>/dev/null; then
    echo "==> [bootstrap] Installing pnpm..."
    sudo npm install -g pnpm
else
    echo "==> [bootstrap] pnpm $(pnpm --version) already installed, skipping."
fi

# ── App directories ───────────────────────────────────────────────────────────
echo "==> [bootstrap] Creating application directories..."
sudo mkdir -p "$APP_DIR" /var/signage/uploads /var/signage/tizen /etc/signage /var/www/certbot
sudo chown -R "$APP_USER:$APP_USER" "$APP_DIR" /var/signage /etc/signage
sudo chmod 750 /etc/signage

# ── Clone repo ────────────────────────────────────────────────────────────────
if [[ -n "$GIT_REPO" ]]; then
    if [[ -d "$APP_DIR/.git" ]]; then
        echo "==> [bootstrap] Repo already cloned at $APP_DIR, skipping clone."
    else
        echo "==> [bootstrap] Cloning $GIT_REPO ($BRANCH) into $APP_DIR..."
        git clone --branch "$BRANCH" --depth 1 "$GIT_REPO" "$APP_DIR"
        sudo chown -R "$APP_USER:$APP_USER" "$APP_DIR"
    fi
else
    echo "==> [bootstrap] GIT_REPO not set — skipping clone. Repo must be present at $APP_DIR before running deploy.sh."
fi

# ── systemd service ───────────────────────────────────────────────────────────
SERVICE_SRC="$APP_DIR/infra/systemd/signage-api.service"
SERVICE_DST="/etc/systemd/system/signage-api.service"

if [[ -f "$SERVICE_SRC" ]]; then
    echo "==> [bootstrap] Installing systemd service..."
    sudo cp "$SERVICE_SRC" "$SERVICE_DST"
    sudo systemctl daemon-reload
    sudo systemctl enable signage-api
    echo "    Service enabled. Do NOT start it yet — populate /etc/signage/api.env first."
else
    echo "!!! [bootstrap] Service file not found at $SERVICE_SRC — install it manually after cloning."
fi

# ── nginx: disable default site ───────────────────────────────────────────────
if [[ -L /etc/nginx/sites-enabled/default ]]; then
    echo "==> [bootstrap] Removing nginx default site..."
    sudo rm -f /etc/nginx/sites-enabled/default
fi

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  Bootstrap complete. Next steps:                            ║"
echo "║                                                              ║"
echo "║  1. Set up PostgreSQL 17:                                    ║"
echo "║     sudo -u postgres psql << 'EOF'                           ║"
echo "║     CREATE USER signage WITH PASSWORD 'STRONG_PASSWORD';     ║"
echo "║     CREATE DATABASE ds OWNER signage;                        ║"
echo "║     GRANT ALL PRIVILEGES ON DATABASE ds TO signage;          ║"
echo "║     \\c ds                                                    ║"
echo "║     GRANT ALL ON SCHEMA public TO signage;                   ║"
echo "║     EOF                                                      ║"
echo "║                                                              ║"
echo "║  2. Configure Redis password:                                ║"
echo "║     sudo nano /etc/redis/redis.conf                          ║"
echo "║     Set: requirepass <YOUR_REDIS_PASSWORD>                   ║"
echo "║     Set: bind 127.0.0.1 -::1                                 ║"
echo "║     sudo systemctl restart redis-server                      ║"
echo "║                                                              ║"
echo "║  3. Populate /etc/signage/api.env (use infra/env/api.env.example) ║"
echo "║                                                              ║"
echo "║  4. Run deploy.sh to build, migrate, and start services:     ║"
echo "║     (via deploy-pi.ps1 from Windows, or manually)           ║"
echo "╚══════════════════════════════════════════════════════════════╝"
