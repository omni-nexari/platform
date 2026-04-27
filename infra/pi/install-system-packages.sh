#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# install-system-packages.sh — Install/upgrade system packages on an already
# bootstrapped Pi.
#
# Safe to re-run. Use this when bootstrap.sh has already been executed but new
# packages have been added to its dependency list.
#
# Usage:
#   sudo bash /opt/signage/infra/pi/install-system-packages.sh
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail

echo "==> Updating package index..."
sudo apt-get update -qq

echo "==> Installing/upgrading system dependencies..."
sudo apt-get install -y --no-install-recommends --allow-change-held-packages \
    libreoffice-impress \
    libreoffice-writer \
    fonts-liberation \
    fonts-noto-core \
    poppler-utils \
    zip \
    unzip

# Remove the obsolete `libreoffice-common` if it's installed standalone — the
# real Impress/Writer packages pull it in as a dependency anyway.
echo "==> Verifying soffice is callable..."
if command -v soffice &>/dev/null; then
    echo "    soffice version: $(soffice --version | head -n1)"
else
    echo "!!! soffice not found on PATH after install — investigate manually." >&2
    exit 1
fi

echo "==> Verifying poppler tools..."
command -v pdftoppm >/dev/null && echo "    pdftoppm OK ($(pdftoppm -v 2>&1 | head -n1))"
command -v pdfinfo  >/dev/null && echo "    pdfinfo OK"

echo ""
echo "Done. PPTX/PDF thumbnail generation should now work."
echo "Restart the API to pick up any environment changes:"
echo "    sudo systemctl restart signage-api"
