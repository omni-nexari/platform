#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/signage}"
STASH_NAME=""

cd "${APP_DIR}"

if [[ -n "$(git status --porcelain)" ]]; then
	STASH_NAME="rebuild-after-pull-$(date +%Y%m%d-%H%M%S)"
	echo "Stashing local changes as ${STASH_NAME}"
	git stash push --include-untracked -m "${STASH_NAME}"
fi

git pull --rebase origin main

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
echo "Verify API health: curl http://127.0.0.1:3000/api/v1/health"
echo "Verify service: sudo systemctl status signage-api --no-pager"

if [[ -n "${STASH_NAME}" ]]; then
	echo "Local changes were stashed as ${STASH_NAME}"
	echo "Review with: git stash list"
	echo "Reapply with: git stash pop"
fi

curl http://127.0.0.1:3000/api/v1/health
sudo systemctl status signage-api --no-pager
