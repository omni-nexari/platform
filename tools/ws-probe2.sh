#!/usr/bin/env bash
for p in /api/v1/sync-relay /api/v1/sync-relay/ /api/v1/sync-relay/ws /api/v1/sync-relay/time ; do
  echo -n "$p -> nginx="
  curl -sS -o /dev/null -w "%{http_code}" -H "Host: 192.168.1.17" -H "Connection: Upgrade" -H "Upgrade: websocket" -H "Sec-WebSocket-Version: 13" -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" --max-time 2 "http://127.0.0.1$p"
  echo -n " direct="
  curl -sS -o /dev/null -w "%{http_code}\n" -H "Connection: Upgrade" -H "Upgrade: websocket" -H "Sec-WebSocket-Version: 13" -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" --max-time 2 "http://127.0.0.1:3000$p"
done
echo ---plain GET no upgrade---
for p in /api/v1/sync-relay /api/v1/sync-relay/ /api/v1/sync-relay/time ; do
  echo -n "$p -> "
  curl -sS -o /dev/null -w "%{http_code}\n" --max-time 2 "http://127.0.0.1:3000$p"
done
