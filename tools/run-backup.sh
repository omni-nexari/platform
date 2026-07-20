cp /tmp/backup.sh /opt/nexari/infra/pi/backup.sh
chmod +x /opt/nexari/infra/pi/backup.sh
ENV_DIR=/etc/signage DATA_DIR=/var/nexari BACKUP_STATUS_FILE=/var/nexari/backup-status.txt bash /opt/nexari/infra/pi/backup.sh
echo "Status: $(cat /var/nexari/backup-status.txt)"
