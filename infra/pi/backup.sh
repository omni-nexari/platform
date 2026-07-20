#!/usr/bin/env bash
# backup.sh — PostgreSQL pg_dump for Nexari Platform
# Run via systemd timer (signage-backup.timer) or manually:
#   sudo bash /opt/nexari/infra/pi/backup.sh
#
# Writes a one-line status record to BACKUP_STATUS_FILE after every run so
# the management portal /monitoring page can show last-backup health.
# Status format:  <ISO-timestamp> <ok|error> <size|-> <filename|reason>
set -euo pipefail

ENV_DIR="${ENV_DIR:-/etc/signage}"
ENV_FILE="$ENV_DIR/api.env"
DATA_DIR="${DATA_DIR:-/var/nexari}"
BACKUP_DIR="$DATA_DIR/backups"
BACKUP_STATUS_FILE="${BACKUP_STATUS_FILE:-$DATA_DIR/backup-status.txt}"
KEEP_DAYS="${KEEP_DAYS:-7}"

_ts() { date -u +%Y-%m-%dT%H:%M:%SZ; }

# ── Load env ──────────────────────────────────────────────────────────────────
if [[ -f "$ENV_FILE" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "$ENV_FILE"
    set +a
fi

mkdir -p "$BACKUP_DIR"

if [[ -z "${DATABASE_URL:-}" ]]; then
    echo "$(_ts) error - no-database-url" | sudo tee "$BACKUP_STATUS_FILE" > /dev/null
    echo "ERROR: DATABASE_URL not set in $ENV_FILE"
    exit 1
fi

TIMESTAMP=$(date -u +%Y%m%dT%H%M%SZ)
FILENAME="backup-${TIMESTAMP}.sql.gz"
FILEPATH="$BACKUP_DIR/$FILENAME"

echo "==> [backup] pg_dump → $FILEPATH"
if pg_dump "$DATABASE_URL" | gzip > "$FILEPATH"; then
    SIZE=$(du -sh "$FILEPATH" | cut -f1)
    echo "$(_ts) OK $SIZE $FILENAME" > "$BACKUP_STATUS_FILE"
    echo "    OK  $SIZE  $FILENAME"
    # Prune backups older than KEEP_DAYS
    find "$BACKUP_DIR" -name 'backup-*.sql.gz' -mtime "+${KEEP_DAYS}" -delete 2>/dev/null || true
else
    echo "$(_ts) ERROR - pg_dump-failed -" > "$BACKUP_STATUS_FILE"
    echo "ERROR: pg_dump failed"
    exit 1
fi
