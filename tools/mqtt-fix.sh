rm -f /etc/mosquitto/conf.d/reflowcast.conf
systemctl start mosquitto && echo "MQTT_OK" || journalctl -u mosquitto -n 10 --no-pager
systemctl is-active mosquitto
