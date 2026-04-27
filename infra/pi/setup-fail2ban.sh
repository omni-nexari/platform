#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# Install fail2ban + the Signage superadmin jail.
# Idempotent. Restarts fail2ban only if the config files actually changed.
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "Must run as root (use sudo)." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "==> Installing fail2ban..."
apt-get install -y fail2ban

FILTER_DST=/etc/fail2ban/filter.d/signage-superadmin.conf
JAIL_DST=/etc/fail2ban/jail.d/signage-superadmin.conf

changed=0
for src_dst in \
  "$SCRIPT_DIR/fail2ban-signage-filter.conf:$FILTER_DST" \
  "$SCRIPT_DIR/fail2ban-signage-jail.conf:$JAIL_DST"
do
  src="${src_dst%%:*}"; dst="${src_dst##*:}"
  if ! cmp -s "$src" "$dst" 2>/dev/null; then
    install -m 0644 "$src" "$dst"
    changed=1
    echo "    installed $dst"
  fi
done

if [[ $changed -eq 1 ]]; then
  systemctl restart fail2ban
fi
systemctl enable fail2ban >/dev/null

echo ""
echo "Status:"
fail2ban-client status signage-superadmin || true
