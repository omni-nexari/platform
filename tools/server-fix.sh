sed -i '/^persistence/d' /etc/mosquitto/conf.d/nexari.conf
systemctl start mosquitto && echo MQTT_OK || { journalctl -u mosquitto -n 5 --no-pager; echo MQTT_FAILED; }
cp /tmp/backup.sh /opt/nexari/infra/pi/backup.sh
cp /tmp/signage-backup.service /etc/systemd/system/
cp /tmp/signage-backup.timer /etc/systemd/system/
chmod +x /opt/nexari/infra/pi/backup.sh
mkdir -p /var/nexari/backups
systemctl daemon-reload
systemctl enable signage-backup.timer
systemctl start signage-backup.timer && echo BACKUP_OK
ENV=/etc/signage/api.env
grep -q '^SSL_DOMAIN=' $ENV || printf '\nSSL_DOMAIN=reflowcast.com' >> $ENV
grep -q '^BACKUP_STATUS_FILE=' $ENV || printf '\nBACKUP_STATUS_FILE=/var/nexari/backup-status.txt' >> $ENV
grep -q '^FFMPEG_PATH=' $ENV || printf '\nFFMPEG_PATH=/usr/bin/ffmpeg' >> $ENV
grep -q '^LIBREOFFICE_PATH=' $ENV || printf '\nLIBREOFFICE_PATH=/usr/bin/soffice' >> $ENV
grep -q '^GHOSTSCRIPT_PATH=' $ENV || printf '\nGHOSTSCRIPT_PATH=/usr/bin/gs' >> $ENV
grep -q '^PLAYWRIGHT_BROWSERS_PATH=' $ENV || printf '\nPLAYWRIGHT_BROWSERS_PATH=/opt/playwright-browsers' >> $ENV
sed -i 's|^MQTT_HOST=.*|MQTT_HOST=127.0.0.1|' $ENV
grep -q '^MQTT_USERNAME=' $ENV || printf '\nMQTT_USERNAME=nexari' >> $ENV
grep -q '^MQTT_PASSWORD=' $ENV || printf '\nMQTT_PASSWORD=70e8e869b975206305a62cbd9294dddc' >> $ENV
echo ENV_OK
systemctl restart signage-api
sleep 2
echo "mosq=$(systemctl is-active mosquitto) api=$(systemctl is-active signage-api) timer=$(systemctl is-active signage-backup.timer)"
