#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# Pi tuning — Redis memory policy + Postgres connection limits
#
# Idempotent. Safe to re-run. Changes only the keys listed; preserves the rest
# of each config file. Restarts the corresponding services on apply.
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "Must run as root (use sudo)." >&2
  exit 1
fi

REDIS_CONF=/etc/redis/redis.conf
PG_CONF_GLOB=/etc/postgresql/*/main/postgresql.conf

# ── Redis ─────────────────────────────────────────────────────────────────────
if [[ -f $REDIS_CONF ]]; then
  echo "[tune] Updating $REDIS_CONF"
  # maxmemory 128mb
  if grep -qE '^[#[:space:]]*maxmemory[[:space:]]+' "$REDIS_CONF"; then
    sed -i -E 's|^[#[:space:]]*maxmemory[[:space:]]+.*|maxmemory 128mb|' "$REDIS_CONF"
  else
    echo "maxmemory 128mb" >> "$REDIS_CONF"
  fi
  # maxmemory-policy noeviction (BullMQ MUST NOT lose job data)
  if grep -qE '^[#[:space:]]*maxmemory-policy[[:space:]]+' "$REDIS_CONF"; then
    sed -i -E 's|^[#[:space:]]*maxmemory-policy[[:space:]]+.*|maxmemory-policy noeviction|' "$REDIS_CONF"
  else
    echo "maxmemory-policy noeviction" >> "$REDIS_CONF"
  fi
  systemctl restart redis-server
  echo "[tune] Redis restarted."
else
  echo "[tune] Skipping Redis — $REDIS_CONF not found."
fi

# ── Postgres ──────────────────────────────────────────────────────────────────
PG_CONF=$(ls $PG_CONF_GLOB 2>/dev/null | head -n 1 || true)
if [[ -n "${PG_CONF:-}" && -f "$PG_CONF" ]]; then
  echo "[tune] Updating $PG_CONF"
  declare -A PG=(
    [max_connections]=30
    [shared_buffers]=256MB
    [work_mem]=8MB
    [maintenance_work_mem]=64MB
  )
  for key in "${!PG[@]}"; do
    val="${PG[$key]}"
    if grep -qE "^[#[:space:]]*${key}[[:space:]]*=" "$PG_CONF"; then
      sed -i -E "s|^[#[:space:]]*${key}[[:space:]]*=.*|${key} = ${val}|" "$PG_CONF"
    else
      echo "${key} = ${val}" >> "$PG_CONF"
    fi
  done
  systemctl restart postgresql
  echo "[tune] Postgres restarted."
else
  echo "[tune] Skipping Postgres — no postgresql.conf under /etc/postgresql/*/main."
fi

echo "[tune] Done. Verify with:"
echo "  redis-cli -a \"\$REDIS_PASS\" CONFIG GET maxmemory-policy"
echo "  sudo -u postgres psql -c 'SHOW max_connections;'"
