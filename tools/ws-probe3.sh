#!/usr/bin/env bash
# Use socat to capture what nginx forwards to upstream, on port 3001.
# First stop API briefly is too risky. Instead, just use nginx error/access logs.
echo "=== nginx access log for sync-relay ==="
sudo tail -n 200 /var/log/nginx/access.log 2>/dev/null | grep -i sync-relay | tail -20
echo "=== nginx error log ==="
sudo tail -n 30 /var/log/nginx/error.log
echo "=== check which location matches via debug ==="
curl -sS --include -H "Host: 192.168.1.17" -H "Connection: Upgrade" -H "Upgrade: websocket" -H "Sec-WebSocket-Version: 13" -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" --max-time 2 "http://127.0.0.1/api/v1/sync-relay?token=abc" 2>&1 | head -20
echo "=== compare: notifications/ws (works) ==="
curl -sS --include -H "Host: 192.168.1.17" -H "Connection: Upgrade" -H "Upgrade: websocket" -H "Sec-WebSocket-Version: 13" -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" --max-time 2 "http://127.0.0.1/api/v1/notifications/ws" 2>&1 | head -20
