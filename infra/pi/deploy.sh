#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/signage}"
GIT_REPO="${GIT_REPO:-}"
BRANCH="${BRANCH:-main}"
API_ENV_FILE="${API_ENV_FILE:-/etc/signage/api.env}"
DS_HOSTNAME="${DS_HOSTNAME:-ds.chiho.app}"
CERTBOT_EMAIL="${CERTBOT_EMAIL:-}"    # required for certbot; set in env or export before running
CERTBOT_STAGING="${CERTBOT_STAGING:-0}"

ensure_pnpm() {
  if command -v pnpm >/dev/null 2>&1; then
    return 0
  fi

  if command -v corepack >/dev/null 2>&1; then
    sudo env "PATH=$PATH" corepack enable
    sudo env "PATH=$PATH" corepack prepare pnpm@9 --activate
    if command -v pnpm >/dev/null 2>&1; then
      return 0
    fi
  fi

  if command -v npm >/dev/null 2>&1; then
    sudo npm install -g pnpm@9
    if command -v pnpm >/dev/null 2>&1; then
      return 0
    fi
  fi

  echo "Failed to provision pnpm. Install Node.js 22+ with corepack or install pnpm manually."
  exit 1
}

upsert_env_var() {
  local key="$1"
  local value="$2"

  if sudo grep -q "^${key}=" "${API_ENV_FILE}"; then
    sudo sed -i "s|^${key}=.*|${key}=${value}|" "${API_ENV_FILE}"
  else
    printf '%s=%s\n' "${key}" "${value}" | sudo tee -a "${API_ENV_FILE}" >/dev/null
  fi
}

resolve_binary_path() {
  local command_name="$1"
  local fallback="$2"
  local resolved

  resolved="$(command -v "${command_name}" 2>/dev/null || true)"
  if [[ -n "${resolved}" ]]; then
    printf '%s\n' "${resolved}"
  else
    printf '%s\n' "${fallback}"
  fi
}

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

FFMPEG_PATH_VALUE="$(resolve_binary_path ffmpeg ffmpeg)"
LIBREOFFICE_PATH_VALUE="$(resolve_binary_path soffice soffice)"
GHOSTSCRIPT_PATH_VALUE="$(resolve_binary_path gs gs)"

echo "Configuring media/tool binary paths in ${API_ENV_FILE}"
upsert_env_var "FFMPEG_PATH" "${FFMPEG_PATH_VALUE}"
upsert_env_var "LIBREOFFICE_PATH" "${LIBREOFFICE_PATH_VALUE}"
upsert_env_var "GHOSTSCRIPT_PATH" "${GHOSTSCRIPT_PATH_VALUE}"

cd "${APP_DIR}"

ensure_pnpm
pnpm install --no-frozen-lockfile
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

sudo certbot --nginx -d ds.chiho.app

echo "Deploy complete."
echo "API health: curl http://127.0.0.1:3000/health"
