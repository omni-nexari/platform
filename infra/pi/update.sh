#!/usr/bin/env bash
# update.sh — Run this directly on the Pi to pull latest code and restart
# Usage:  bash /opt/signage/infra/pi/update.sh
set -euo pipefail

APP_DIR="/opt/signage"
ENV_FILE="/etc/signage/api.env"

echo "==> [update] Pulling latest code..."
cd "$APP_DIR"
git pull origin main

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

echo ""
echo "Done! Health check:"
curl -s http://127.0.0.1:3000/api/v1/health
echo ""
