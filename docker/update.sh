#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Nexari Platform — Update Script
#
# Usage:
#   bash update.sh                  — pull latest image and restart API
#   bash update.sh --version v2.5.0 — pin to a specific version
#
# This script:
#   1. Optionally updates NEXARI_VERSION in .env
#   2. Pulls the new Docker image
#   3. Runs database migrations (safe — drizzle only adds, never drops)
#   4. Performs a zero-downtime restart of the api service
#   5. Verifies the new container is healthy before declaring success
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BOLD='\033[1m'; RESET='\033[0m'

info()    { echo -e "${GREEN}▶${RESET}  $*"; }
warn()    { echo -e "${YELLOW}⚠${RESET}  $*"; }
section() { echo -e "\n${BOLD}── $* ──────────────────────────────────────────────${RESET}"; }
die()     { echo -e "${RED}✖${RESET}  $*" >&2; exit 1; }

# ── CLI args ──────────────────────────────────────────────────────────────────
NEW_VERSION=""
while [[ $# -gt 0 ]]; do
  case $1 in
    --version) NEW_VERSION="$2"; shift 2 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# ── Prereqs ───────────────────────────────────────────────────────────────────
[[ -f .env ]] || die ".env not found — run install.sh first"
docker compose ps >/dev/null 2>&1 || die "Docker Compose stack not running — start with: docker compose up -d"

# ── Optionally pin version ─────────────────────────────────────────────────────
if [[ -n "$NEW_VERSION" ]]; then
  section "Pinning version to $NEW_VERSION"
  # Replace NEXARI_VERSION= line in .env
  sed -i "s|^NEXARI_VERSION=.*|NEXARI_VERSION=${NEW_VERSION}|" .env
  info "NEXARI_VERSION set to $NEW_VERSION in .env"
fi

CURRENT_VERSION=$(grep '^NEXARI_VERSION=' .env | cut -d= -f2 || echo "latest")
info "Updating to version: $CURRENT_VERSION"

# ── Pull new image ─────────────────────────────────────────────────────────────
section "Pulling image"
docker compose pull api
info "Image pulled"

# ── Run migrations ─────────────────────────────────────────────────────────────
section "Running database migrations"
# Run migrations using the NEW image against the running database
# --rm ensures the migration container is removed after completion
docker compose run --rm api node packages/db/scripts/migrate.js
info "Migrations complete"

# ── Refresh DS static files ───────────────────────────────────────────────────
section "Refreshing DS static files"
docker compose up --no-deps ds-init
info "DS static files updated"

# ── Restart API (no-deps keeps postgres/redis untouched) ──────────────────────
section "Restarting API"
docker compose up -d --no-deps api
info "API restarted, waiting for health check..."

for i in $(seq 1 40); do
  if docker compose ps api | grep -q "healthy"; then
    info "API is healthy"
    break
  fi
  if [[ $i -eq 40 ]]; then
    die "API did not become healthy. Check: docker compose logs api --tail 50"
  fi
  sleep 5
done

# ── Reload nginx to pick up any new static assets ─────────────────────────────
section "Reloading nginx"
docker compose exec nginx nginx -s reload 2>/dev/null || warn "nginx reload skipped (not running?)"

# ── Done ──────────────────────────────────────────────────────────────────────
section "Update Complete"
echo ""
echo -e "${GREEN}${BOLD}Nexari Platform updated to ${CURRENT_VERSION}${RESET}"
echo ""
echo "  Check status:  docker compose ps"
echo "  View logs:     docker compose logs -f api"
echo ""
