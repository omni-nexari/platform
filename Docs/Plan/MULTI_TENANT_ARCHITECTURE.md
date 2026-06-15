# Multi-Tenant Architecture Overview

**Last updated: June 14, 2026**

---

## System Components

```
nexari-admin (admin.nexari.ca)      ← Internal Nexari team only
  └── manages: partners, license keys, billing, heartbeat tracking
  └── DB: separate PostgreSQL (nexari-admin workspace)

partners.nexari.ca                  ← Partner self-service portal (planned)
  └── partner login, license status, platform instances, player downloads

Platform (partner self-hosted)      ← Each partner runs their own instance
  └── docker image: ghcr.io/omni-nexari/platform:<version>
  └── stack: api + DS SPA + postgres + redis + nginx (docker-compose)
  └── served at: signage.partnerA.com, signage.partnerB.com, etc.
  └── phones home: POST https://admin.nexari.ca/heartbeat (HMAC-signed, every 15min)

Players (Tizen, Android, Windows, ePaper, ESP32)
  └── connect to: <partner's domain>/api/v1  (REST)
  └── connect to: wss://<partner's domain>   (WebSocket)
  └── WS URL is always auto-derived from API_BASE (http→ws, https→wss, same host)
```

---

## Why Players Connect Directly to Partner Instances

Each partner self-hosts their Platform Docker image for:
- **Data sovereignty** — customer content and device data stays on partner infrastructure
- **Data residency compliance** — enterprise clients may have GDPR/regional requirements
- **No single point of failure** — admin.nexari.ca outage does not affect any partner's screens
- **WS scalability** — WebSocket connections are stateful; proxying them centrally creates bottleneck
- **Content files** — stored in partner's `uploads` Docker volume, cannot be served by admin.nexari.ca

`admin.nexari.ca` only receives a lightweight HMAC-signed heartbeat every 15 minutes to track
screen counts for billing. No player traffic, no content URLs, no WS connections pass through it.

---

## License Heartbeat Flow

```
Partner Platform (license-client.ts)
  └── every 15 min → POST https://admin.nexari.ca/heartbeat
      body: { licenseKey, timestamp, signature(HMAC-SHA256), usage: { activeScreens, signageScreens, posScreens, totalOrgs } }

admin.nexari.ca API
  └── verifies HMAC signature (licenseKey + timestamp)
  └── records usage snapshot → licenseHeartbeats table
  └── updates licenseKeys.lastHeartbeatAt, lastSignageScreens, lastPosScreens
  └── responds: { status: 'ok'|'grace'|'overlimit'|'suspended'|'revoked', maxScreens, gracePct }

Partner Platform
  └── caches response in Redis (24h TTL) so transient admin.nexari.ca outage doesn't lock screens
  └── isPairingBlocked() → true if status = 'suspended' | 'revoked'
  └── isInstanceLocked() → true if status = 'revoked'
```

Partner configures three env vars at install time:
```
LICENSE_KEY         = NXR-XXXX-XXXX-XXXX-XXXX
LICENSE_SECRET      = <hmac secret issued with key>
LICENSE_SERVER_URL  = https://admin.nexari.ca
```

---

## Device Pairing Flow

```
1. Device boots → shows pairing code on screen
   └── player calls POST <partner domain>/api/v1/devices/pair/request
   └── server returns { code: "ABC123", status: "unclaimed" }

2. User opens: signage.partnerA.com/dashboard
   └── enters pairing code
   └── server marks device as claimed, issues deviceToken (JWT)

3. Device polls GET /api/v1/devices/pair/status?code=ABC123
   └── receives { claimed: true, deviceToken: "eyJ..." }
   └── stores token in localStorage

4. Player opens WebSocket: wss://signage.partnerA.com/api/v1/devices/ws/device?token=<jwt>
   └── sends heartbeat every 30s
   └── receives commands (content refresh, screenshot, reboot, etc.)
```

The player **must know the partner's URL** before step 1. This is the bootstrap problem
addressed in PLAYER_URL_PROVISIONING.md.

---

## Docker Stack Per Partner

```yaml
# Services in docker-compose.yml
api       → ghcr.io/omni-nexari/platform:<version>
              exposes port 3000 internally
              serves: REST API + WebSocket + DS SPA static files
postgres  → postgres:17-alpine (internal only, not exposed)
redis     → redis:7-alpine (internal only, not exposed)
nginx     → nginx:1.27-alpine
              ports: 80, 443 (host-facing)
              proxies /api/ → api:3000
              proxies WebSocket upgrade → api:3000
              serves /var/www/ds (DS SPA static files)
              serves /var/signage/uploads (media files via X-Accel-Redirect)
certbot   → Let's Encrypt TLS (profile-activated)
ds-init   → one-shot: copies DS SPA from api image → ds_static volume
```

---

## Update Flow

```bash
bash update.sh [--version v2.5.0]
```
1. Updates `NEXARI_VERSION` in `.env`
2. Pulls new image from `ghcr.io/omni-nexari/platform`
3. Runs database migrations (additive only — never destructive)
4. Restarts API container
5. Reloads nginx

Partners never rebuild from source. All updates are Docker image pulls.
