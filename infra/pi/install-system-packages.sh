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

# ── Playwright (optional) — used for HTML5 content thumbnail generation ──────
# Skip if SIGNAGE_SKIP_PLAYWRIGHT=1.
if [[ "${SIGNAGE_SKIP_PLAYWRIGHT:-0}" != "1" ]]; then
  echo "==> Installing chromium for Playwright HTML5 thumbnails..."
  sudo apt-get install -y --no-install-recommends \
      libnss3 libatk-bridge2.0-0 libcups2 libxkbcommon0 \
      libxcomposite1 libxdamage1 libxrandr2 libgbm1 libpango-1.0-0 \
      libcairo2 libasound2 || true

  if [[ -d /opt/signage ]]; then
    # Run pnpm as the app user (SUDO_USER), not root, to avoid pnpm store mismatch.
    APP_USER="${SUDO_USER:-chiho}"
    pushd /opt/signage >/dev/null
    if su -c "pnpm --filter @signage/api list playwright 2>/dev/null" "$APP_USER" | grep -q playwright; then
      echo "    playwright npm package already installed."
    else
      echo "    Installing playwright npm package..."
      su -c "pnpm --filter @signage/api add playwright" "$APP_USER" || echo "!!! Playwright install failed — HTML5 thumbnails will be skipped."
    fi
    # Install browser binaries to a shared path so the systemd service can read them.
    PLAYWRIGHT_BIN="/opt/signage/node_modules/.bin/playwright"
    BROWSERS_DIR="/opt/playwright-browsers"
    mkdir -p "$BROWSERS_DIR"
    chown "$APP_USER" "$BROWSERS_DIR"
    if [[ -f "$PLAYWRIGHT_BIN" ]]; then
      PLAYWRIGHT_BROWSERS_PATH="$BROWSERS_DIR" su -c "$PLAYWRIGHT_BIN install chromium" "$APP_USER" || \
        echo "!!! Could not install Chromium browser bundle."
    else
      echo "!!! playwright binary not found at $PLAYWRIGHT_BIN — skipping browser install."
    fi
    popd >/dev/null
  fi
fi

echo ""
echo "Done. PPTX/PDF thumbnail generation should now work."
echo "Restart the API to pick up any environment changes:"
echo "    sudo systemctl restart signage-api"
