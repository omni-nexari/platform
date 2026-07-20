sed -i 's|^BACKUP_STATUS_FILE=.*|BACKUP_STATUS_FILE=/var/nexari/backup-status.txt|' /etc/signage/api.env
mkdir -p /var/nexari/backups
ENV_DIR=/etc/signage DATA_DIR=/var/nexari BACKUP_STATUS_FILE=/var/nexari/backup-status.txt bash /opt/nexari/infra/pi/backup.sh
echo "Status: $(cat /var/nexari/backup-status.txt)"
