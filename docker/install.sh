#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Nexari Platform — Interactive Installer
#
# Usage: bash install.sh [--version vX.Y.Z]
#
# What this script does:
#   1. Checks system prerequisites (Docker, Docker Compose, openssl)
#   2. Prompts for every required configuration value
#   3. Validates each input before accepting it
#   4. Writes .env (mode 600) and nginx.conf from the template
#   5. Pulls the Docker image
#   6. Starts postgres + redis, waits for health, runs DB migrations
#   7. Starts the API, waits for health
#   8. Starts nginx (and optionally obtains a Let's Encrypt certificate)
#
# Prerequistes on the VM:
#   - Docker Engine 24+ with the Compose plugin (docker compose)
#   - openssl (for the key generator hint)
#   - Port 80 and 443 open in firewall + DNS A record pointing to this host
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# ── Script directory — all files live next to install.sh ─────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ── CLI args ──────────────────────────────────────────────────────────────────
NEXARI_VERSION="latest"
while [[ $# -gt 0 ]]; do
  case $1 in
    --version) NEXARI_VERSION="$2"; shift 2 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# ── Colour helpers ────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BOLD='\033[1m'; RESET='\033[0m'

info()    { echo -e "${GREEN}▶${RESET}  $*"; }
warn()    { echo -e "${YELLOW}⚠${RESET}  $*"; }
error()   { echo -e "${RED}✖${RESET}  $*" >&2; }
section() { echo -e "\n${BOLD}── $* ──────────────────────────────────────────────${RESET}"; }
die()     { error "$*"; exit 1; }

# ── Prereq checks ─────────────────────────────────────────────────────────────
section "Checking prerequisites"

command -v docker   >/dev/null 2>&1 || die "Docker is not installed. See https://docs.docker.com/engine/install/"
docker compose version >/dev/null 2>&1 || die "Docker Compose plugin not found. Install docker-compose-plugin."
command -v openssl  >/dev/null 2>&1 || die "openssl not found. Install with: apt-get install openssl"

DOCKER_VERSION=$(docker version --format '{{.Server.Version}}' 2>/dev/null || echo "unknown")
info "Docker version: $DOCKER_VERSION"
info "Docker Compose: $(docker compose version --short 2>/dev/null || echo 'ok')"

# ── Key generator hint ────────────────────────────────────────────────────────
section "Secret Keys"
echo ""
echo -e "${BOLD}Before continuing, run this in another terminal to generate your secrets:${RESET}"
echo ""
echo "    bash generate-keys.sh"
echo ""
echo "You will be asked to paste each generated value in the prompts below."
echo ""
read -rp "Press ENTER when you have your generated values ready..."

# ── Input helpers ─────────────────────────────────────────────────────────────

# prompt_plain <var_name> <prompt>
prompt_plain() {
  local var="$1" prompt="$2" val
  while true; do
    read -rp "  $prompt: " val
    if [[ -z "$val" ]]; then
      warn "Value cannot be empty."
    else
      printf -v "$var" '%s' "$val"
      return
    fi
  done
}

# prompt_secret <var_name> <prompt>
prompt_secret() {
  local var="$1" prompt="$2" val
  while true; do
    read -rsp "  $prompt: " val
    echo ""
    if [[ -z "$val" ]]; then
      warn "Value cannot be empty."
    else
      printf -v "$var" '%s' "$val"
      return
    fi
  done
}

# prompt_optional <var_name> <prompt>  (empty is allowed)
prompt_optional() {
  local var="$1" prompt="$2" val
  read -rp "  $prompt [leave blank to skip]: " val || true
  printf -v "$var" '%s' "$val"
}

# ── Infrastructure secrets ────────────────────────────────────────────────────
section "Infrastructure Secrets"
echo "Paste the values from generate-keys.sh output."
echo ""

while true; do
  prompt_secret DB_PASSWORD "DB_PASSWORD (min 16 chars)"
  if [[ ${#DB_PASSWORD} -lt 16 ]]; then
    warn "DB_PASSWORD must be at least 16 characters."
  else
    break
  fi
done

while true; do
  prompt_secret REDIS_PASSWORD "REDIS_PASSWORD (min 16 chars)"
  if [[ ${#REDIS_PASSWORD} -lt 16 ]]; then
    warn "REDIS_PASSWORD must be at least 16 characters."
  else
    break
  fi
done

while true; do
  prompt_secret JWT_SECRET "JWT_SECRET (min 64 hex chars)"
  if [[ ${#JWT_SECRET} -lt 64 ]]; then
    warn "JWT_SECRET must be at least 64 characters."
  elif ! [[ "$JWT_SECRET" =~ ^[0-9a-fA-F]+$ ]]; then
    warn "JWT_SECRET must be hexadecimal (0-9, a-f)."
  else
    break
  fi
done

while true; do
  prompt_secret JWT_REFRESH_SECRET "JWT_REFRESH_SECRET (min 64 hex chars, different from JWT_SECRET)"
  if [[ ${#JWT_REFRESH_SECRET} -lt 64 ]]; then
    warn "JWT_REFRESH_SECRET must be at least 64 characters."
  elif ! [[ "$JWT_REFRESH_SECRET" =~ ^[0-9a-fA-F]+$ ]]; then
    warn "JWT_REFRESH_SECRET must be hexadecimal."
  elif [[ "$JWT_REFRESH_SECRET" == "$JWT_SECRET" ]]; then
    warn "JWT_REFRESH_SECRET must differ from JWT_SECRET."
  else
    break
  fi
done

while true; do
  prompt_secret TOKEN_ENCRYPTION_KEY "TOKEN_ENCRYPTION_KEY (exactly 64 hex chars)"
  if [[ ${#TOKEN_ENCRYPTION_KEY} -ne 64 ]]; then
    warn "TOKEN_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes)."
  elif ! [[ "$TOKEN_ENCRYPTION_KEY" =~ ^[0-9a-fA-F]+$ ]]; then
    warn "TOKEN_ENCRYPTION_KEY must be hexadecimal."
  else
    break
  fi
done

# ── Domain + URLs ─────────────────────────────────────────────────────────────
section "Domain Configuration"
echo "Your DNS A record must already point to this server's IP address."
echo ""

while true; do
  prompt_plain DOMAIN "Your domain name (e.g. signage.mycompany.com — no https://)"
  # Basic format check
  if [[ ! "$DOMAIN" =~ ^[a-zA-Z0-9][a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$ ]]; then
    warn "That doesn't look like a valid domain name. Try again."
  else
    break
  fi
done

APP_URL="https://${DOMAIN}"
API_PUBLIC_URL="https://${DOMAIN}"

# ── Deployment mode ────────────────────────────────────────────────────────────
section "Deployment Mode"
echo "  standalone    — Docker handles TLS directly (ports 80 + 443, Let's Encrypt)"
echo "  behind-proxy  — An external reverse proxy handles TLS; Docker nginx binds"
echo "                  to a local port only (e.g. 8081)"
echo ""
read -rp "  Deploying behind a reverse proxy? [y/N]: " PROXY_CHOICE
if [[ "$PROXY_CHOICE" =~ ^[Yy]$ ]]; then
  BEHIND_PROXY=true
  echo ""
  read -rp "  HTTP port for Docker nginx [8081]: " HTTP_PORT_INPUT
  NEXARI_HTTP_PORT="${HTTP_PORT_INPUT:-8081}"
  NEXARI_HTTP_BIND="0.0.0.0"
  CERTBOT_EMAIL=""
  info "Behind-proxy mode: Docker nginx will bind on ${NEXARI_HTTP_BIND}:${NEXARI_HTTP_PORT}"
  info "Your upstream proxy must set: X-Forwarded-Proto: https, proxy_buffering off, client_max_body_size 2g"
else
  BEHIND_PROXY=false
  NEXARI_HTTP_PORT="80"
  NEXARI_HTTP_BIND="0.0.0.0"
  echo ""
  echo "Optional but recommended: provide an email for Let's Encrypt issuance and renewal."
  echo "If you skip it, the installer will still set up nginx, but you'll need to run certbot manually."
  echo ""
  while true; do
    prompt_optional CERTBOT_EMAIL "  CERTBOT_EMAIL (Let's Encrypt contact email)"
    if [[ -z "${CERTBOT_EMAIL:-}" || "$CERTBOT_EMAIL" =~ ^[^@]+@[^@]+\.[^@]+$ ]]; then
      break
    fi
    warn "Enter a valid email address or leave it blank to skip."
  done
fi

# ── Extra CORS origins (LAN access) ──────────────────────────────────────────
section "LAN / Extra Origins (Optional)"
echo "Allow access from this server's local IP in addition to your domain."
echo "Useful for on-site setup or devices that can't reach the public domain."
echo ""

# Auto-detect the server's primary LAN IP
DETECTED_LAN_IP=$(ip route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src") print $(i+1)}' | head -1)
if [[ -z "$DETECTED_LAN_IP" ]]; then
  DETECTED_LAN_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
fi

if [[ -n "$DETECTED_LAN_IP" ]]; then
  echo "  Detected local IP: ${DETECTED_LAN_IP}"
  read -rp "  Add http://${DETECTED_LAN_IP} as an allowed origin? [Y/n]: " LAN_CHOICE
  if [[ ! "$LAN_CHOICE" =~ ^[Nn]$ ]]; then
    APP_EXTRA_ORIGINS="http://${DETECTED_LAN_IP}"
    info "LAN access enabled for http://${DETECTED_LAN_IP}"
  else
    prompt_optional APP_EXTRA_ORIGINS "  Custom extra origins (comma-separated, no trailing slash)"
  fi
else
  prompt_optional APP_EXTRA_ORIGINS "  Extra origins (comma-separated, no trailing slash)"
fi

# ── Email delivery ─────────────────────────────────────────────────────────────
section "Email Delivery"
echo "Used for password resets and workspace invitations."
echo "You can skip this now and configure email later from the management portal"
echo "(Settings → Branding → Email & Notifications)."
echo ""
echo "  1) Resend cloud API (sign up at https://resend.com — free tier: 3 000 emails/month)"
echo "  2) SMTP / Gmail / Office 365 (use your existing email provider)"
echo "  3) Skip — configure email later from the portal"
echo ""

EMAIL_PROVIDER="disabled"
RESEND_API_KEY=""
RESEND_FROM_ADMIN=""
RESEND_FROM_MAIL=""
SMTP_HOST=""
SMTP_PORT="587"
SMTP_SECURE="true"
SMTP_USER=""
SMTP_PASSWORD=""

while true; do
  read -rp "Choose [1/2/3]: " _EMAIL_CHOICE
  case "$_EMAIL_CHOICE" in
    1)
      EMAIL_PROVIDER="resend"
      prompt_secret RESEND_API_KEY "RESEND_API_KEY"

      while true; do
        prompt_plain RESEND_FROM_ADMIN "From address for system emails (must be verified in Resend)"
        if [[ ! "$RESEND_FROM_ADMIN" =~ ^[^@]+@[^@]+\.[^@]+$ ]]; then
          warn "Enter a valid email address."
        else
          break
        fi
      done

      while true; do
        prompt_plain RESEND_FROM_MAIL "From address for user emails"
        if [[ ! "$RESEND_FROM_MAIL" =~ ^[^@]+@[^@]+\.[^@]+$ ]]; then
          warn "Enter a valid email address."
        else
          break
        fi
      done
      break
      ;;
    2)
      EMAIL_PROVIDER="smtp"
      echo "  Examples:"
      echo "    Gmail:      smtp.gmail.com  port 587  (use an App Password)"
      echo "    Office 365: smtp.office365.com  port 587"
      echo ""

      prompt_plain SMTP_HOST "SMTP host (e.g. smtp.gmail.com)"
      prompt_optional SMTP_PORT "SMTP port [587]"
      SMTP_PORT="${SMTP_PORT:-587}"
      prompt_optional SMTP_SECURE "TLS/STARTTLS — true or false [true]"
      SMTP_SECURE="${SMTP_SECURE:-true}"
      prompt_plain SMTP_USER "SMTP username / email"
      prompt_secret SMTP_PASSWORD "SMTP password / app password"

      while true; do
        prompt_plain RESEND_FROM_ADMIN "From address for system emails"
        if [[ ! "$RESEND_FROM_ADMIN" =~ ^[^@]+@[^@]+\.[^@]+$ ]]; then
          warn "Enter a valid email address."
        else
          break
        fi
      done

      while true; do
        prompt_plain RESEND_FROM_MAIL "From address for user emails"
        if [[ ! "$RESEND_FROM_MAIL" =~ ^[^@]+@[^@]+\.[^@]+$ ]]; then
          warn "Enter a valid email address."
        else
          break
        fi
      done
      break
      ;;
    3)
      EMAIL_PROVIDER="disabled"
      ok "Email skipped — configure later from the management portal."
      break
      ;;
    *) warn "Enter 1, 2, or 3." ;;
  esac
done

# ── Optional integrations ──────────────────────────────────────────────────────
section "Optional Integrations"
echo "Leave any of these blank to skip. They can be added later by editing .env"
echo "and running:  docker compose up -d api"
echo ""

echo "  Google OAuth (workspace SSO):"
prompt_optional GOOGLE_OAUTH_CLIENT_ID    "  GOOGLE_OAUTH_CLIENT_ID"
prompt_optional GOOGLE_OAUTH_CLIENT_SECRET "  GOOGLE_OAUTH_CLIENT_SECRET"

echo ""
echo "  Microsoft OAuth (workspace SSO):"
prompt_optional MICROSOFT_OAUTH_CLIENT_ID     "  MICROSOFT_OAUTH_CLIENT_ID"
prompt_optional MICROSOFT_OAUTH_CLIENT_SECRET  "  MICROSOFT_OAUTH_CLIENT_SECRET"
MICROSOFT_OAUTH_TENANT_ID="common"

echo ""
echo "  Nexari Admin remote monitoring:"
prompt_optional NEXARI_LICENSE_KEY "  NEXARI_LICENSE_KEY"
NEXARI_ADMIN_URL="https://admin.nexari.ca"

echo ""
echo "  MQTT (for ESP32/e-paper devices):"
prompt_optional MQTT_HOST     "  MQTT_HOST"
MQTT_PORT="1883"
prompt_optional MQTT_USERNAME "  MQTT_USERNAME"
prompt_optional MQTT_PASSWORD "  MQTT_PASSWORD"

echo ""
echo "  Uber Eats integration:"
prompt_optional UBER_CLIENT_ID     "  UBER_CLIENT_ID"
prompt_optional UBER_CLIENT_SECRET "  UBER_CLIENT_SECRET"

# ── Playwright ────────────────────────────────────────────────────────────────
section "Playwright / Chromium"
echo "Playwright is used for HTML5 package thumbnail rendering."
echo "Disabling saves ~600 MB of disk space — HTML5 thumbnails will show a"
echo "placeholder image instead."
echo ""
read -rp "  Install Playwright/Chromium? [Y/n]: " PLAYWRIGHT_CHOICE
if [[ "$PLAYWRIGHT_CHOICE" =~ ^[Nn]$ ]]; then
  SIGNAGE_SKIP_PLAYWRIGHT="1"
  info "Playwright disabled."
else
  SIGNAGE_SKIP_PLAYWRIGHT="0"
  info "Playwright enabled."
fi

# ── Summary ───────────────────────────────────────────────────────────────────
section "Configuration Summary"
echo ""
echo "  Domain:         $DOMAIN"
echo "  App URL:        $APP_URL"
echo "  Mode:           $([ "$BEHIND_PROXY" = "true" ] && echo "behind-proxy (port ${NEXARI_HTTP_PORT})" || echo "standalone")"
echo "  Cert email:     ${CERTBOT_EMAIL:-(not configured)}"
echo "  Email:          ${EMAIL_PROVIDER} ${RESEND_FROM_MAIL:+(from: $RESEND_FROM_MAIL)}"
echo "  Google OAuth:   ${GOOGLE_OAUTH_CLIENT_ID:-(not configured)}"
echo "  Microsoft OAuth:${MICROSOFT_OAUTH_CLIENT_ID:-(not configured)}"
echo "  Nexari license: ${NEXARI_LICENSE_KEY:-(not configured)}"
echo "  MQTT host:      ${MQTT_HOST:-(not configured)}"
echo "  Playwright:     $([ "$SIGNAGE_SKIP_PLAYWRIGHT" = "1" ] && echo disabled || echo enabled)"
echo "  Image version:  $NEXARI_VERSION"
echo ""
read -rp "Proceed with installation? [yes/no]: " CONFIRM
if [[ "$CONFIRM" != "yes" && "$CONFIRM" != "y" ]]; then
  echo "Aborted."
  exit 0
fi

# ── Write .env ────────────────────────────────────────────────────────────────
section "Writing .env"

cat > .env <<EOF
# Generated by install.sh on $(date -u +"%Y-%m-%dT%H:%M:%SZ")
# Do not commit this file to version control.

# ── Secrets ──
DB_PASSWORD=${DB_PASSWORD}
REDIS_PASSWORD=${REDIS_PASSWORD}
JWT_SECRET=${JWT_SECRET}
JWT_REFRESH_SECRET=${JWT_REFRESH_SECRET}
TOKEN_ENCRYPTION_KEY=${TOKEN_ENCRYPTION_KEY}

# ── URLs ──
DOMAIN=${DOMAIN}
APP_URL=${APP_URL}
API_PUBLIC_URL=${API_PUBLIC_URL}
APP_EXTRA_ORIGINS=${APP_EXTRA_ORIGINS}

# ── Email ──
EMAIL_PROVIDER=${EMAIL_PROVIDER}
RESEND_API_KEY=${RESEND_API_KEY}
RESEND_FROM_ADMIN=${RESEND_FROM_ADMIN}
RESEND_FROM_MAIL=${RESEND_FROM_MAIL}
SMTP_HOST=${SMTP_HOST}
SMTP_PORT=${SMTP_PORT}
SMTP_SECURE=${SMTP_SECURE}
SMTP_USER=${SMTP_USER}
SMTP_PASSWORD=${SMTP_PASSWORD}

# ── Google OAuth ──
GOOGLE_OAUTH_CLIENT_ID=${GOOGLE_OAUTH_CLIENT_ID}
GOOGLE_OAUTH_CLIENT_SECRET=${GOOGLE_OAUTH_CLIENT_SECRET}

# ── Microsoft OAuth ──
MICROSOFT_OAUTH_CLIENT_ID=${MICROSOFT_OAUTH_CLIENT_ID}
MICROSOFT_OAUTH_CLIENT_SECRET=${MICROSOFT_OAUTH_CLIENT_SECRET}
MICROSOFT_OAUTH_TENANT_ID=${MICROSOFT_OAUTH_TENANT_ID}

# ── Nexari Admin ──
NEXARI_LICENSE_KEY=${NEXARI_LICENSE_KEY}
NEXARI_ADMIN_URL=${NEXARI_ADMIN_URL}
LICENSE_SERVER_URL=${NEXARI_ADMIN_URL}

# ── MQTT ──
MQTT_HOST=${MQTT_HOST}
MQTT_PORT=${MQTT_PORT}
MQTT_USERNAME=${MQTT_USERNAME}
MQTT_PASSWORD=${MQTT_PASSWORD}

# ── Uber ──
UBER_CLIENT_ID=${UBER_CLIENT_ID}
UBER_CLIENT_SECRET=${UBER_CLIENT_SECRET}

# ── Advanced ──
SIGNAGE_SKIP_PLAYWRIGHT=${SIGNAGE_SKIP_PLAYWRIGHT}
COOKIE_SECURE=true
NODE_OPTIONS=--max-old-space-size=2048
NEXARI_VERSION=${NEXARI_VERSION}

# ── Network binding ──
NEXARI_HTTP_PORT=${NEXARI_HTTP_PORT}
NEXARI_HTTP_BIND=${NEXARI_HTTP_BIND}
EOF

chmod 600 .env
info ".env written (mode 600)"

# ── Write nginx.conf from template ────────────────────────────────────────────
section "Writing nginx.conf"

if [[ ! -f nginx.conf.template ]]; then
  die "nginx.conf.template not found in $SCRIPT_DIR"
fi

sed "s/NEXARI_DOMAIN/${DOMAIN}/g" nginx.conf.template > nginx.conf
info "nginx.conf written"

# ── Pull Docker image ─────────────────────────────────────────────────────────
section "Pulling Docker image"
docker compose pull
info "Image pulled: ghcr.io/omni-nexari/platform:${NEXARI_VERSION}"

# ── Start database + redis ─────────────────────────────────────────────────────
section "Starting postgres + redis"
docker compose up -d postgres redis
info "Waiting for postgres to become healthy..."
for i in $(seq 1 30); do
  if docker compose ps postgres | grep -q "healthy"; then
    info "postgres is healthy"
    break
  fi
  if [[ $i -eq 30 ]]; then
    die "postgres did not become healthy in time. Check: docker compose logs postgres"
  fi
  sleep 3
done

info "Waiting for redis to become healthy..."
for i in $(seq 1 20); do
  if docker compose ps redis | grep -q "healthy"; then
    info "redis is healthy"
    break
  fi
  if [[ $i -eq 20 ]]; then
    die "redis did not become healthy in time. Check: docker compose logs redis"
  fi
  sleep 3
done

# ── Run database migrations ────────────────────────────────────────────────────
section "Running database migrations"
docker compose run --rm api node packages/db/scripts/migrate.js
info "Migrations complete"

# ── Start API ─────────────────────────────────────────────────────────────────
section "Starting API"
docker compose up -d api
info "Waiting for API to become healthy..."
for i in $(seq 1 40); do
  if docker compose ps api | grep -q "healthy"; then
    info "API is healthy"
    break
  fi
  if [[ $i -eq 40 ]]; then
    die "API did not become healthy in time. Check: docker compose logs api"
  fi
  sleep 5
done

# ── Start nginx ────────────────────────────────────────────────────────────────
section "Starting nginx"
docker compose up -d nginx
info "nginx started"

# ── TLS certificate ────────────────────────────────────────────────────────────
section "TLS Certificate"
echo ""

if [[ "$BEHIND_PROXY" = "true" ]]; then
  info "Behind-proxy mode — TLS is handled by your upstream reverse proxy."
  echo ""
  echo "Your upstream proxy must:"
  echo "  - Terminate TLS and forward HTTP to this host on port ${NEXARI_HTTP_PORT}"
  echo "  - proxy_set_header X-Forwarded-Proto https"
  echo "  - proxy_buffering off"
  echo "  - client_max_body_size 2g"
else
  echo "nginx is now running on port 80 and 443."
  if [[ -n "${CERTBOT_EMAIL:-}" ]]; then
    info "Obtaining Let's Encrypt certificate for ${DOMAIN}..."
    docker compose --profile tls run --rm certbot certonly \
      --webroot -w /var/www/certbot \
      -d "${DOMAIN}" \
      --email "${CERTBOT_EMAIL}" \
      --agree-tos \
      --no-eff-email
    docker compose exec nginx nginx -s reload
    info "Certificate installed and nginx reloaded."
  else
    echo "To obtain a free Let's Encrypt certificate later, run:"
    echo ""
    echo "    docker compose --profile tls run --rm certbot certonly \\"
    echo "      --webroot -w /var/www/certbot \\"
    echo "      -d ${DOMAIN} \\"
    echo "      --email admin@${DOMAIN} --agree-tos --no-eff-email"
    echo ""
    echo "Then reload nginx:  docker compose exec nginx nginx -s reload"
  fi
  echo ""
  echo "To auto-renew (add to crontab):"
  echo "    0 3 * * * cd $SCRIPT_DIR && docker compose --profile tls run --rm certbot renew --quiet && docker compose exec nginx nginx -s reload"
fi

# ── Create player-builds directory structure ──────────────────────────────────
# nginx serves player app downloads from this host path.
# Populated by build-partner-players.ps1 via SCP.
section "Player Builds Directory"
mkdir -p \
  /var/nexari/player-builds/windows \
  /var/nexari/player-builds/android \
  /var/nexari/player-builds/tizen \
  /var/nexari/player-builds/epaper \
  /var/nexari/player-builds/esp32
chmod -R 755 /var/nexari/player-builds
info "Created /var/nexari/player-builds/{windows,android,tizen,epaper,esp32}"
warn "Player files are NOT included — deploy them with build-partner-players.ps1 or copy manually:"
warn "  Windows:  /var/nexari/player-builds/windows/nexari-windows-setup.exe"
warn "  Android:  /var/nexari/player-builds/android/nexari-android.apk"
warn "  Tizen:    /var/nexari/player-builds/tizen/<app>.wgt"

# ── Done ──────────────────────────────────────────────────────────────────────
section "Installation Complete"
echo ""
echo -e "${GREEN}${BOLD}Nexari Platform is running!${RESET}"
echo ""
  echo "  Open your browser and navigate to:  https://${DOMAIN}/setup"
echo "  Complete the first-run wizard to create your admin account."
echo ""
echo "  Useful commands:"
echo "    docker compose logs -f api     — stream API logs"
echo "    docker compose ps              — show service status"
echo "    bash update.sh                 — update to a new version"
echo ""
