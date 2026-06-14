#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# generate-keys.sh — Print secure random values for all required Nexari secrets
#
# Run this BEFORE install.sh. Copy the output; install.sh will prompt you to
# paste each value in turn.
#
# Requirements: openssl (standard on Linux/macOS)
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

echo ""
echo "┌─────────────────────────────────────────────────────────────────────┐"
echo "│  Nexari Platform — Secret Key Generator                            │"
echo "│                                                                     │"
echo "│  Copy ALL values below before running install.sh.                  │"
echo "│  Each value will be entered once; they are written to .env.        │"
echo "└─────────────────────────────────────────────────────────────────────┘"
echo ""

DB_PASSWORD=$(openssl rand -base64 48 | tr -d '+/=\n' | cut -c1-32)
REDIS_PASSWORD=$(openssl rand -base64 48 | tr -d '+/=\n' | cut -c1-32)
JWT_SECRET=$(openssl rand -hex 48)
JWT_REFRESH_SECRET=$(openssl rand -hex 48)
TOKEN_ENCRYPTION_KEY=$(openssl rand -hex 32)

echo "DB_PASSWORD          = $DB_PASSWORD"
echo "REDIS_PASSWORD       = $REDIS_PASSWORD"
echo "JWT_SECRET           = $JWT_SECRET"
echo "JWT_REFRESH_SECRET   = $JWT_REFRESH_SECRET"
echo "TOKEN_ENCRYPTION_KEY = $TOKEN_ENCRYPTION_KEY"
echo ""
echo "NOTE: Store these in a password manager. They cannot be recovered once"
echo "      the database is initialised. To rotate a secret you must update"
echo "      .env and restart the stack: bash update.sh"
echo ""
