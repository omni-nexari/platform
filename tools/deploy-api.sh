#!/usr/bin/env bash
set -euo pipefail
rsync -a --delete /tmp/api-dist2/ /opt/nexari/apps/api/dist/
systemctl restart signage-api
sleep 2
systemctl is-active signage-api
echo "Deploy complete"
