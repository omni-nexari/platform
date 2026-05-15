#!/bin/bash
sudo -u postgres psql -d ds -t -c "SELECT created_at, message FROM log_entries WHERE message LIKE '%NativeSync%' OR message LIKE '%DIAG%' ORDER BY created_at DESC LIMIT 50;"
