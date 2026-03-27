#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this script with sudo."
  exit 1
fi

APP_USER="${APP_USER:-chiho}"
APP_DIR="${APP_DIR:-/opt/signage}"
UPLOAD_DIR="${UPLOAD_DIR:-/var/signage/uploads}"
ENV_DIR="${ENV_DIR:-/etc/signage}"
REQUIRED_NODE_MAJOR="22"

export DEBIAN_FRONTEND=noninteractive

ensure_pnpm() {
  if command -v pnpm >/dev/null 2>&1; then
    return 0
  fi

  if command -v corepack >/dev/null 2>&1; then
    corepack enable
    corepack prepare pnpm@9 --activate
    if command -v pnpm >/dev/null 2>&1; then
      return 0
    fi
  fi

  if command -v npm >/dev/null 2>&1; then
    npm install -g pnpm@9
    if command -v pnpm >/dev/null 2>&1; then
      return 0
    fi
  fi

  echo "Failed to provision pnpm. Install Node.js 22+ with corepack or install pnpm manually."
  exit 1
}

get_node_major() {
  if ! command -v node >/dev/null 2>&1; then
    echo 0
    return
  fi

  node -v | cut -d. -f1 | tr -d 'v'
}

ensure_node_runtime() {
  local node_major

  node_major="$(get_node_major)"
  if [[ "${node_major}" -ge "${REQUIRED_NODE_MAJOR}" ]] && command -v npm >/dev/null 2>&1; then
    return 0
  fi

  apt-mark unhold nodejs npm libnode-dev libnode108 2>/dev/null || true
  apt-get remove -y nodejs npm libnode-dev libnode108 2>/dev/null || true
  apt-get purge -y nodejs npm libnode-dev libnode108 2>/dev/null || true
  apt-get autoremove -y 2>/dev/null || true

  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get update
  apt-get install -y --allow-change-held-packages nodejs

  if ! command -v npm >/dev/null 2>&1; then
    apt-get install -y --allow-change-held-packages npm || true
  fi

  node_major="$(get_node_major)"
  if [[ "${node_major}" -lt "${REQUIRED_NODE_MAJOR}" ]]; then
    echo "Node.js installation failed. Expected Node ${REQUIRED_NODE_MAJOR}+ but found $(node -v 2>/dev/null || echo missing)."
    exit 1
  fi

  if ! command -v npm >/dev/null 2>&1; then
    echo "npm installation failed. 'npm' is still not available on PATH."
    exit 1
  fi
}

LIBREOFFICE_PACKAGES=()
if apt-cache show libreoffice-headless >/dev/null 2>&1; then
  LIBREOFFICE_PACKAGES=(libreoffice-core libreoffice-headless)
elif apt-cache show libreoffice-core-nogui >/dev/null 2>&1; then
  LIBREOFFICE_PACKAGES=(libreoffice-core-nogui)
elif apt-cache show libreoffice-core >/dev/null 2>&1; then
  LIBREOFFICE_PACKAGES=(libreoffice-core)
else
  LIBREOFFICE_PACKAGES=(libreoffice)
fi

apt-get update
apt-get install -y \
  ca-certificates \
  curl \
  git \
  gnupg \
  nginx \
  postgresql \
  postgresql-contrib \
  redis-server \
  ffmpeg \
  ghostscript \
  "${LIBREOFFICE_PACKAGES[@]}"

# Install snapd & certbot (via snap) for Let's Encrypt
apt-get install -y snapd || true
snap install core || true
snap refresh core || true
snap install --classic certbot || true
ln -sf /snap/bin/certbot /usr/bin/certbot || true

ensure_node_runtime

ensure_pnpm

if ! id -u "${APP_USER}" >/dev/null 2>&1; then
  useradd --system --create-home --shell /bin/bash "${APP_USER}"
fi

mkdir -p "${APP_DIR}" "${UPLOAD_DIR}" "${ENV_DIR}"
chown -R "${APP_USER}:${APP_USER}" "${APP_DIR}" "${UPLOAD_DIR}"
chmod 750 "${ENV_DIR}"

systemctl enable postgresql
systemctl enable redis-server
systemctl enable nginx

echo "Bootstrap complete."
echo "Next: copy repository into ${APP_DIR}, create ${ENV_DIR}/api.env, install nginx/systemd files, then deploy."
echo "Deploy will auto-detect and write FFMPEG_PATH, LIBREOFFICE_PATH, and GHOSTSCRIPT_PATH into ${ENV_DIR}/api.env."
