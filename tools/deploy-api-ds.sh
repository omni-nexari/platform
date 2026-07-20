#!/usr/bin/env bash
set -euo pipefail
rsync -a --delete /tmp/api-dist/ /opt/nexari/apps/api/dist/
rsync -a --delete /tmp/ds-dist2/ /opt/nexari/apps/ds/dist/
systemctl restart signage-api
echo "Deploy complete"
