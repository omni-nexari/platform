#!/bin/bash
cd /opt/nexari
DOMAIN=$(awk -F= '/^DOMAIN/{gsub(/"/, "", $2); print $2}' .env)
echo "Domain: $DOMAIN"
sed "s/NEXARI_DOMAIN/${DOMAIN}/g" nginx.conf.template > nginx.conf
docker compose exec nginx nginx -t
docker compose exec nginx nginx -s reload
echo "Nginx reloaded OK"
