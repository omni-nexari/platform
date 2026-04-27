#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# Configure UFW firewall for the Pi.
#
# - Default deny inbound, allow outbound
# - Allow SSH from 192.168.1.0/24 (local LAN) only
# - Allow HTTP (80) and HTTPS (443) from anywhere — nginx terminates and proxies
# - Postgres (5432) and Redis (6379) are NOT opened — they bind to localhost
#
# Idempotent and safe to re-run. Verifies SSH is allowed BEFORE enabling UFW.
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "Must run as root (use sudo)." >&2
  exit 1
fi

echo "==> Installing ufw..."
apt-get install -y ufw

echo "==> Resetting UFW to remove any pre-existing rules..."
ufw --force reset

echo "==> Setting default policies..."
ufw --force default deny incoming
ufw --force default allow outgoing

echo "==> Allowing SSH from 192.168.1.0/24 only..."
ufw allow from 192.168.1.0/24 to any port 22 proto tcp comment 'SSH local LAN'

echo "==> Allowing HTTP/HTTPS from anywhere..."
ufw allow 80/tcp  comment 'nginx HTTP'
ufw allow 443/tcp comment 'nginx HTTPS'

# Sanity check: refuse to enable if no SSH allow rule resolves
if ! ufw show added | grep -qE 'allow .* 22'; then
  echo "!!! No SSH allow rule found — refusing to enable UFW (would lock you out)." >&2
  exit 1
fi

echo "==> Enabling UFW..."
ufw --force enable
ufw status verbose

echo ""
echo "Done. Verify Postgres/Redis are NOT externally reachable from another host:"
echo "  nc -zv <pi-ip> 5432   # should TIME OUT"
echo "  nc -zv <pi-ip> 6379   # should TIME OUT"
