chown mosquitto:mosquitto /etc/mosquitto/passwd
chmod 600 /etc/mosquitto/passwd
mkdir -p /var/log/mosquitto
chown mosquitto:mosquitto /var/log/mosquitto
systemctl start mosquitto && echo "MQTT_OK" || journalctl -u mosquitto -n 5 --no-pager
systemctl is-active mosquitto
