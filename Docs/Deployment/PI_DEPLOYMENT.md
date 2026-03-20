# Raspberry Pi Deployment Guide

This guide deploys the current monorepo to a Raspberry Pi host using systemd + nginx.

## 1. Preconditions

- Raspberry Pi reachable via SSH
- Ubuntu 24.04 or similar Debian-based distro
- A user with sudo rights
- OpenSSH client installed on your Windows machine

## 2. One-time bootstrap on Pi

From your Windows machine:

```powershell
cd C:\Users\chiho\Projects\Platform
powershell -ExecutionPolicy Bypass -File .\tools\deploy-pi.ps1 -Host <PI_IP_OR_HOSTNAME> -User <PI_USER> -RemoteDir /opt/signage -RunBootstrap
```

What this does:

- Uploads tracked repository files into the remote target directory
- Installs runtime dependencies on the Pi
- Installs Node 22 + pnpm
- Creates app directories and enables core services

## 3. Configure production env

On the Pi:

```bash
sudo mkdir -p /etc/signage
sudo cp /opt/signage/infra/env/api.env.example /etc/signage/api.env
sudo nano /etc/signage/api.env
```

Set strong JWT secrets and correct DB/SMTP values.
For the Pi host, keep these application-level values in place:

```dotenv
FFMPEG_PATH=ffmpeg
LIBREOFFICE_PATH=soffice
GHOSTSCRIPT_PATH=gs
APP_URL=https://ds.chiho.app
APP_EXTRA_ORIGINS=http://192.168.1.17,http://localhost:5173
API_PORT=3000
```

Set `APP_URL=https://ds.chiho.app` so invite and password-reset emails generate production links instead of localhost URLs.

## 3.1 TLS / Certbot

We use `certbot` (Let's Encrypt) to obtain TLS for `ds.chiho.app`. If you installed `certbot` already, the deploy script will detect existing certificates and skip issuance. To enable automatic issuance during `deploy.sh` set `CERTBOT_EMAIL`.

On the Pi, to run certbot manually:

```bash
sudo certbot --nginx -d ds.chiho.app --email admin@chiho.app --agree-tos --non-interactive
```

If running via the Windows helper, pass the email as an argument:

```powershell
powershell -File .\tools\deploy-pi.ps1 -Host <PI> -User <user> -RemoteDir /opt/signage -GitRepo git@github.com:yourorg/Platform.git -Branch main -CertbotEmail admin@chiho.app
```

## 4. Deploy or redeploy

From Windows:

```powershell
cd C:\Users\chiho\Projects\Platform
powershell -ExecutionPolicy Bypass -File .\tools\deploy-pi.ps1 -Host <PI_IP_OR_HOSTNAME> -User <PI_USER> -RemoteDir /opt/signage
```

This runs:

- pnpm install
- pnpm recursive build
- DB migrations
- systemd service refresh/restart
- nginx config install/reload

## 4.1 Rebuild after git pull on the Pi

If you already have the repo on the Pi and just pulled new commits, use the lightweight rebuild script instead of the full bootstrap/deploy flow:

```bash
cd /opt/signage
bash infra/pi/rebuild-after-pull.sh
```

What it does:

- stashes local tracked and untracked changes if the Pi checkout is dirty
- removes stale `dist` output for `packages/db`, `packages/shared`, `apps/api`, and `apps/ds`
- runs `pnpm install --frozen-lockfile`
- rebuilds DB, shared, API, and dashboard packages
- restarts `signage-api`
- reloads nginx

If local changes were stashed, the script prints the stash name at the end. You can inspect it with `git stash list` and reapply it later with `git stash pop`.

If your checkout lives somewhere else, override the app directory:

```bash
APP_DIR=/some/other/path bash /opt/signage/infra/pi/rebuild-after-pull.sh
```

## 5. Validation

On Pi:

```bash
systemctl status signage-api --no-pager
curl -sS http://127.0.0.1:3000/health
sudo nginx -t
```

From browser:

- Open http://<PI_IP_OR_HOSTNAME>
- Verify dashboard loads
- Verify API calls resolve under /api

## 6. Notes

- nginx routes /api/* to Fastify and strips the /api prefix before reaching the API app.
- WebSocket endpoint is proxied via /ws/* and forwarded to Fastify at port 3000.
- Uploaded files are served from /var/signage/uploads via /uploads/*.
