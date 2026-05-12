#!/usr/bin/env bash
# Inject /api/v1/sync-relay/ws location block after each /api/v1/devices/ws/ block
set -euo pipefail
CONF=/etc/nginx/sites-available/signage.conf
TMP=$(mktemp)

sudo awk '
  /location \/api\/v1\/devices\/ws\// { in_block=1 }
  in_block && /^[[:space:]]*\}[[:space:]]*$/ {
    print
    print ""
    print "    # ── WebSocket — cross-platform sync relay ────────────────────────────────"
    print "    location /api/v1/sync-relay/ws {"
    print "        proxy_pass         http://signage_api/api/v1/sync-relay/ws;"
    print "        proxy_http_version 1.1;"
    print "        proxy_set_header   Upgrade           $http_upgrade;"
    print "        proxy_set_header   Connection        $connection_upgrade;"
    print "        proxy_set_header   Host              $host;"
    print "        proxy_set_header   X-Real-IP         $remote_addr;"
    print "        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;"
    print "        proxy_read_timeout 3600s;"
    print "        proxy_send_timeout 3600s;"
    print "        proxy_buffering    off;"
    print "    }"
    in_block=0
    next
  }
  { print }
' "$CONF" > "$TMP"

sudo cp "$CONF" "${CONF}.bak.$(date +%s)"
sudo cp "$TMP" "$CONF"
rm -f "$TMP"
sudo nginx -t && sudo systemctl reload nginx && echo NGINX_OK
