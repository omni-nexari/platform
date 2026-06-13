# Nexari Platform — Partner Installation Guide

This guide walks a technical partner through deploying the Nexari Platform on a Linux VM using Docker Compose. No source code access is required — the platform is distributed as a pre-built Docker image.

---

## Requirements

### Server

| Resource | Minimum | Recommended |
|----------|---------|-------------|
| CPU | 2 cores | 4 cores |
| RAM | 4 GB | 8 GB |
| Disk | 40 GB SSD | 100 GB SSD |
| OS | Ubuntu 22.04 LTS | Ubuntu 24.04 LTS |
| Ports | 80, 443 open | — |

### Software

- **Docker Engine 24+** with the Compose plugin  
  Install: https://docs.docker.com/engine/install/ubuntu/
- **openssl** — standard on Ubuntu, required for key generation

### DNS

Create an **A record** pointing your chosen domain to the VM's public IP address before running the installer. Let's Encrypt certificate issuance requires this to be live.

---

## Step 1 — Obtain the install package

Download the latest release package from the Nexari Partner Portal or run:

```bash
curl -fsSL https://releases.nexari.io/platform/latest/install-package.tar.gz -o nexari.tar.gz
tar xzf nexari.tar.gz
cd nexari
```

The package contains:

```
nexari/
  Dockerfile              # (reference only — image is pulled from registry)
  docker-compose.yml
  nginx.conf.template
  .env.template
  generate-keys.sh
  install.sh
  update.sh
```

---

## Step 2 — Generate secret keys

Run the key generator **before** starting the installer. It prints five random values you will paste into the installer prompts.

```bash
bash generate-keys.sh
```

Example output:

```
DB_PASSWORD          = mK9zP2...
REDIS_PASSWORD       = vXqL7n...
JWT_SECRET           = 4a3b2c1d...
JWT_REFRESH_SECRET   = 9f8e7d6c...
TOKEN_ENCRYPTION_KEY = 1a2b3c4d...
```

**Store these values in a password manager immediately.** They cannot be recovered once the database is initialised. To rotate a secret later, edit `.env` and run `bash update.sh`.

---

## Step 3 — Run the installer

```bash
bash install.sh
```

The installer will prompt for each value in turn. All secrets are masked as you type.

### Prompts reference

| Prompt | Source | Validation |
|--------|--------|------------|
| `DB_PASSWORD` | `generate-keys.sh` output | Min 16 chars |
| `REDIS_PASSWORD` | `generate-keys.sh` output | Min 16 chars |
| `JWT_SECRET` | `generate-keys.sh` output | Min 64 hex chars |
| `JWT_REFRESH_SECRET` | `generate-keys.sh` output | Min 64 hex chars, must differ from JWT_SECRET |
| `TOKEN_ENCRYPTION_KEY` | `generate-keys.sh` output | Exactly 64 hex chars |
| Domain name | Your DNS record | Format validation |
| Resend API key | https://resend.com | — |
| From email addresses | Verified in Resend | Email format |
| Google / Microsoft OAuth | Optional — see below | — |
| Nexari license key | Provided by Nexari | — |
| MQTT settings | Optional — for ESP32/e-paper | — |
| Playwright / Chromium | Optional — see note below | — |

> **Playwright note:** Chromium is used only for generating HTML5 package thumbnail images. Disabling it saves ~600 MB of disk space. HTML5 content will still play correctly on devices; only the thumbnail in the management portal will show a placeholder.

After confirming the summary, the installer:

1. Writes `.env` (permissions: `600`)
2. Generates `nginx.conf` from the template
3. Pulls the Docker image from `ghcr.io/nexari/platform`
4. Starts PostgreSQL and Redis, waits for healthy status
5. Runs database migrations
6. Starts the API, waits for healthy status
7. Starts nginx

### Obtain a TLS certificate

Once nginx is running, issue a Let's Encrypt certificate:

```bash
docker compose --profile tls run --rm certbot certonly \
  --webroot -w /var/www/certbot \
  -d yourdomain.com \
  --email admin@yourdomain.com --agree-tos --no-eff-email
```

Then reload nginx to apply the certificate:

```bash
docker compose exec nginx nginx -s reload
```

### Set up automatic certificate renewal

Add to root crontab (`sudo crontab -e`):

```cron
0 3 * * * cd /opt/nexari && docker compose --profile tls run --rm certbot renew --quiet && docker compose exec nginx nginx -s reload
```

---

## Step 4 — Complete first-run setup

Open your browser and navigate to:

```
https://yourdomain.com/setup
```

The setup wizard will walk you through:

1. **Organisation name** — the company name displayed in the management portal
2. **Admin account** — the primary administrator email and password
3. **License key** — paste your Nexari license key (optional, can be added later)

After completing the wizard you will be redirected to the sign-in page.

---

## Optional integrations

These can be configured during install or added later by editing `.env` and running `docker compose up -d api`.

### Google OAuth (workspace SSO)

1. Go to [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services → Credentials
2. Create an **OAuth 2.0 Client ID** (Web application)
3. Add authorised redirect URI: `https://yourdomain.com/api/v1/auth/google/callback`
4. Copy the Client ID and Client Secret into `.env`:
   ```
   GOOGLE_OAUTH_CLIENT_ID=...
   GOOGLE_OAUTH_CLIENT_SECRET=...
   ```

### Microsoft OAuth (workspace SSO)

1. Go to [Azure Portal](https://portal.azure.com/) → App registrations → New registration
2. Add redirect URI: `https://yourdomain.com/api/v1/auth/microsoft/callback`
3. Copy the Application ID and a Client Secret into `.env`:
   ```
   MICROSOFT_OAUTH_CLIENT_ID=...
   MICROSOFT_OAUTH_CLIENT_SECRET=...
   MICROSOFT_OAUTH_TENANT_ID=common   # or your tenant ID for single-org
   ```

### MQTT (ESP32 / e-paper devices)

If you operate ESP32-based or e-paper display devices, configure an MQTT broker:

```
MQTT_HOST=mqtt.yourdomain.com
MQTT_PORT=1883
MQTT_USERNAME=nexari
MQTT_PASSWORD=...
```

---

## Day-to-day operations

### View logs

```bash
docker compose logs -f api          # API logs (most useful)
docker compose logs -f nginx        # nginx access/error logs
docker compose logs -f postgres     # database logs
```

### Service status

```bash
docker compose ps
```

### Restart a service

```bash
docker compose restart api
```

### Open a shell inside the API container

```bash
docker compose exec api sh
```

### Manual database backup

```bash
docker compose exec postgres pg_dump -U signage signage | gzip > backup-$(date +%Y%m%d).sql.gz
```

Schedule this with cron for automated backups. Store backups off-server (S3, Backblaze B2, etc.).

---

## Updating to a new version

```bash
bash update.sh
```

To pin a specific version:

```bash
bash update.sh --version v2.5.0
```

The update script:

1. Updates `NEXARI_VERSION` in `.env`
2. Pulls the new image
3. Runs any new database migrations (additive only — never destructive)
4. Restarts the API without touching PostgreSQL or Redis
5. Reloads nginx

**Rollback:** If the new version has an issue, re-run with the previous version tag:

```bash
bash update.sh --version v2.4.1
```

---

## Environment variables reference

| Variable | Required | Description |
|----------|----------|-------------|
| `DB_PASSWORD` | ✅ | PostgreSQL password |
| `REDIS_PASSWORD` | ✅ | Redis authentication password |
| `JWT_SECRET` | ✅ | JWT signing secret (min 64 hex chars) |
| `JWT_REFRESH_SECRET` | ✅ | JWT refresh token secret (must differ from JWT_SECRET) |
| `TOKEN_ENCRYPTION_KEY` | ✅ | AES-256 key for encrypting OAuth tokens (exactly 64 hex chars) |
| `DOMAIN` | ✅ | Domain name, e.g. `signage.mycompany.com` |
| `APP_URL` | ✅ | Full URL of the portal, e.g. `https://signage.mycompany.com` |
| `API_PUBLIC_URL` | ✅ | Full URL of the API, usually same as `APP_URL` |
| `RESEND_API_KEY` | ✅ | Resend.com API key for email delivery |
| `RESEND_FROM_ADMIN` | ✅ | From address for system emails |
| `RESEND_FROM_MAIL` | ✅ | From address for user-facing emails |
| `GOOGLE_OAUTH_CLIENT_ID` | — | Google OAuth Client ID |
| `GOOGLE_OAUTH_CLIENT_SECRET` | — | Google OAuth Client Secret |
| `MICROSOFT_OAUTH_CLIENT_ID` | — | Microsoft OAuth Application ID |
| `MICROSOFT_OAUTH_CLIENT_SECRET` | — | Microsoft OAuth Client Secret |
| `MICROSOFT_OAUTH_TENANT_ID` | — | Azure AD tenant (`common` for multi-tenant) |
| `NEXARI_LICENSE_KEY` | — | License key issued by Nexari |
| `MQTT_HOST` | — | MQTT broker hostname |
| `MQTT_PORT` | — | MQTT broker port (default `1883`) |
| `MQTT_USERNAME` | — | MQTT username |
| `MQTT_PASSWORD` | — | MQTT password |
| `UBER_CLIENT_ID` | — | Uber Eats integration Client ID |
| `UBER_CLIENT_SECRET` | — | Uber Eats integration Client Secret |
| `SIGNAGE_SKIP_PLAYWRIGHT` | — | Set to `1` to disable Chromium (saves ~600 MB) |

---

## Firewall checklist

| Port | Protocol | Purpose | Action |
|------|----------|---------|--------|
| 22 | TCP | SSH | Allow from your IP only |
| 80 | TCP | HTTP (ACME challenge + redirect) | Allow from anywhere |
| 443 | TCP | HTTPS | Allow from anywhere |
| 5432 | TCP | PostgreSQL | Block externally |
| 6379 | TCP | Redis | Block externally |

PostgreSQL and Redis are on an internal Docker network and are not accessible from the host or internet by default.

---

## Troubleshooting

### API fails to start

```bash
docker compose logs api --tail 50
```

Common causes:
- `DATABASE_URL` incorrect (check `DB_PASSWORD` in `.env` matches the postgres container)
- Migration failed — run manually: `docker compose run --rm api node packages/db/scripts/migrate.js`
- Port 3000 conflict — the API port is internal only; this usually indicates a prior container still running

### nginx 502 Bad Gateway

The API is not healthy. Check:

```bash
docker compose ps api       # should show "(healthy)"
docker compose logs api
```

### Certificate issues

Verify DNS resolution before re-running certbot:

```bash
dig +short yourdomain.com
```

The IP must match your VM. If DNS has not propagated yet (can take up to 24 hours), wait before retrying.

### Uploads not persisting after update

Uploads are stored in a named Docker volume (`uploads`) which persists across `update.sh` runs. If files disappear, check that the volume is mounted:

```bash
docker volume ls | grep uploads
docker compose exec api ls /var/signage/uploads
```

---

## Support

- Documentation: https://docs.nexari.io  
- Partner Portal: https://partners.nexari.io  
- Email: support@nexari.io
