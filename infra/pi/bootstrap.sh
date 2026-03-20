#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this script with sudo."
  exit 1
fi

APP_USER="${APP_USER:-signage}"
APP_DIR="${APP_DIR:-/opt/signage}"
UPLOAD_DIR="${UPLOAD_DIR:-/var/signage/uploads}"
ENV_DIR="${ENV_DIR:-/etc/signage}"

export DEBIAN_FRONTEND=noninteractive

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
  libreoffice-core \
  libreoffice-headless

# Install snapd & certbot (via snap) for Let's Encrypt
apt-get install -y snapd || true
snap install core || true
snap refresh core || true
snap install --classic certbot || true
ln -sf /snap/bin/certbot /usr/bin/certbot || true

if ! command -v node >/dev/null 2>&1 || [[ "$(node -v | cut -d. -f1 | tr -d 'v')" -lt 22 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

corepack enable
corepack prepare pnpm@9 --activate

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
