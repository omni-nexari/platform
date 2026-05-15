#!/bin/bash
sudo -u postgres psql -d ds -t -c "SELECT created_at, device_id, message FROM log_entries WHERE (message LIKE '%ync%' OR message LIKE '%content%' OR message LIKE '%websocket%' OR message LIKE '%playlist%') AND created_at > now() - interval '10 minutes' ORDER BY created_at DESC LIMIT 80;"
