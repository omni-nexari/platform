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
curl -sS http://127.0.0.1:3000/api/v1/health
curl -sS -H "Host: ds.chiho.app" http://127.0.0.1/api/health
sudo nginx -t
```

From browser:

- Open http://<PI_IP_OR_HOSTNAME>
- Verify dashboard loads
- Verify API calls resolve under /api

## 6. Redis password setup

Redis must be configured with a password to match the `REDIS_URL` in `/etc/signage/api.env`.

### 6.1 Set requirepass in redis.conf

```bash
sudo nano /etc/redis/redis.conf
```

Find and set these two lines (use Ctrl+W to search):

```
requirepass RedisSignage@2026!
bind 127.0.0.1 -::1
```

Save with Ctrl+X → Y → Enter.

### 6.2 Restart and verify

```bash
sudo systemctl restart redis-server

# Should be refused without password:
redis-cli ping

# Should return PONG with password:
redis-cli -a 'RedisSignage@2026!' ping
```

### 6.3 Confirm api.env has matching REDIS_URL

```bash
grep REDIS_URL /etc/signage/api.env
```

Expected:

```
REDIS_URL=redis://:RedisSignage@2026!@localhost:6379
```

If missing or wrong:

```bash
sudo nano /etc/signage/api.env
```

### 6.4 Restart API after any redis.conf or api.env change

```bash
sudo systemctl restart signage-api
curl -sS http://127.0.0.1:3000/api/v1/health
```

Expected: `{"status":"ok","db":"ok",...}`

## 7. LAN access (192.168.1.17)

The nginx config includes a second server block for `192.168.1.17` so the dashboard is reachable over LAN without needing the public domain.

After deploying the nginx config, these URLs work from any device on the same network:

- `http://192.168.1.17/login`
- `http://192.168.1.17/superadmin`
- `http://192.168.1.17/management`

To apply the nginx config on Pi:

```bash
cd /opt/signage
sudo cp infra/nginx/signage.conf /etc/nginx/sites-available/signage.conf
sudo nginx -t
sudo systemctl reload nginx
```

Verify LAN access:

```bash
curl -sS http://192.168.1.17/api/v1/health
```

## 8. Notes

- nginx routes /api/* to Fastify and strips the /api prefix before reaching the API app.
- WebSocket endpoint is proxied via /ws/* and forwarded to Fastify at port 3000.
- Uploaded files are served from /var/signage/uploads via /uploads/*.
- The `requirepass` approach in redis.conf matches the `redis://:PASSWORD@host:port` URL format used by this app. Do not use ACL users unless you also update the REDIS_URL format to include a username.