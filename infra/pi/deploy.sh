#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/signage}"
GIT_REPO="${GIT_REPO:-}"
BRANCH="${BRANCH:-main}"
API_ENV_FILE="${API_ENV_FILE:-/etc/signage/api.env}"
DS_HOSTNAME="${DS_HOSTNAME:-ds.chiho.app}"
CERTBOT_EMAIL="${CERTBOT_EMAIL:-}"    # required for certbot; set in env or export before running
CERTBOT_STAGING="${CERTBOT_STAGING:-0}"

if [[ -z "${GIT_REPO}" && ! -d "${APP_DIR}/.git" ]]; then
  echo "GIT_REPO is not set and ${APP_DIR} is not a git repo. Set GIT_REPO to clone from."
  exit 1
fi

mkdir -p "${APP_DIR}"

if [[ ! -d "${APP_DIR}/.git" ]]; then
  echo "Cloning ${GIT_REPO} (branch: ${BRANCH}) -> ${APP_DIR}"
  git clone --depth 1 --branch "${BRANCH}" "${GIT_REPO}" "${APP_DIR}"
else
  echo "Updating existing repo in ${APP_DIR}"
  git -C "${APP_DIR}" fetch --all --prune
  git -C "${APP_DIR}" checkout "${BRANCH}" 2>/dev/null || true
  git -C "${APP_DIR}" pull --rebase origin "${BRANCH}" || true
fi

if [[ ! -f "${API_ENV_FILE}" ]]; then
  echo "Missing API env file: ${API_ENV_FILE}"
  exit 1
fi

cd "${APP_DIR}"

# corepack needs sudo when node is installed system-wide
sudo corepack enable
sudo corepack prepare pnpm@9 --activate
export PNPM_HOME="/usr/local/share/pnpm"
export PATH="$PNPM_HOME:$PATH"
pnpm install --frozen-lockfile
pnpm -r build

set -a
source "${API_ENV_FILE}"
set +a

pnpm --filter @signage/db db:migrate || true

sudo cp infra/systemd/signage-api.service /etc/systemd/system/signage-api.service
sudo systemctl daemon-reload
sudo systemctl enable --now signage-api
sudo systemctl restart signage-api || true

# Install nginx site (server_name is already ds.chiho.app in the config)
sudo cp infra/nginx/signage.conf /etc/nginx/sites-available/signage.conf
sudo ln -sfn /etc/nginx/sites-available/signage.conf /etc/nginx/sites-enabled/signage.conf
if [[ -f /etc/nginx/sites-enabled/default ]]; then
  sudo rm -f /etc/nginx/sites-enabled/default || true
fi
sudo nginx -t
sudo systemctl reload nginx

CERT_PATH="/etc/letsencrypt/live/${DS_HOSTNAME}/fullchain.pem"
if [[ -f "${CERT_PATH}" ]]; then
  echo "TLS certificate already present at ${CERT_PATH}; skipping certbot issuance."
else
  if command -v certbot >/dev/null 2>&1 && [[ -n "${CERTBOT_EMAIL}" ]]; then
    echo "Requesting TLS certificate for ${DS_HOSTNAME} with certbot"
    STAGING_FLAG=""
    if [[ "${CERTBOT_STAGING}" != "0" ]]; then STAGING_FLAG="--staging"; fi
    sudo certbot --nginx -d "${DS_HOSTNAME}" --non-interactive --agree-tos --email "${CERTBOT_EMAIL}" ${STAGING_FLAG} || true
  else
    echo "Certbot not available or CERTBOT_EMAIL not set; skipping cert issuance."
    echo "To obtain a certificate later run: sudo certbot --nginx -d ${DS_HOSTNAME} --email you@example.com"
  fi
fi

echo "Deploy complete."
echo "API health: curl http://127.0.0.1:3000/health"
