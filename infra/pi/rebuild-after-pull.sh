#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/signage}"

cd "${APP_DIR}"

echo "Cleaning previous build output"
rm -rf packages/db/dist packages/shared/dist apps/api/dist apps/ds/dist

echo "Installing dependencies"
pnpm install --frozen-lockfile

echo "Building workspace packages"
pnpm --filter @signage/db build
pnpm --filter @signage/shared build
pnpm --filter @signage/api build
pnpm --filter @signage/ds build

echo "Restarting services"
sudo systemctl restart signage-api
sudo systemctl reload nginx

echo "Done"
echo "Verify API health: curl http://127.0.0.1:3000/health"
echo "Verify service: sudo systemctl status signage-api --no-pager"