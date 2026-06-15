# Partner Portal Plan — partners.nexari.ca

**Last updated: June 14, 2026**
**Status: Planned**

---

## Overview

`partners.nexari.ca` is a self-service portal for Nexari partners (resellers, venue operators,
enterprise customers) to manage their license, download player packages, and register their
self-hosted platform instances.

This is distinct from:
- `admin.nexari.ca` — internal Nexari team only (issue keys, manage partners, billing)
- `signage.<partner>.com` — the partner's own self-hosted Platform instance

---

## Workspace Location

New app added to the `nexari-admin` monorepo:

```
nexari-admin/
  apps/
    web/           ← admin.nexari.ca (Nexari team only) — unchanged
    marketing/     ← public marketing/install guide site
    partners/      ← NEW: partners.nexari.ca
      index.html
      package.json
      vite.config.ts
      src/
        App.tsx
        main.tsx
        pages/
          LoginPage.tsx
          DashboardPage.tsx
          InstancesPage.tsx
          DownloadsPage.tsx
          ProfilePage.tsx
        components/
        lib/
```

New routes added to `nexari-admin/apps/api`:
```
/partner-portal/auth/login         POST  — partner contact login
/partner-portal/auth/logout        POST
/partner-portal/me                 GET   — current partner + license summary
/partner-portal/instances          GET/POST/PATCH/DELETE — register platform URLs
/partner-portal/builds             POST  — request a player build
/partner-portal/builds/:id         GET   — poll build status
/partner-portal/builds/:id/download GET  — stream built artifact
```

---

## Authentication

Partners authenticate using their contact email (from the `partner_contacts` table).
The `partner_contacts` table already exists; a `passwordHash` column needs to be added.

Initial password is set when Nexari issues the license key and sends the welcome email
(alongside the `LICENSE_KEY` and `LICENSE_SECRET`).

Session: JWT stored in `httpOnly` cookie (same pattern as admin `web` app).

---

## Pages

### Dashboard
- License status badge (ok / grace / overlimit / suspended / revoked)
- Screen counts (signage + POS), last heartbeat time
- Max screens, modules allowed
- Link to upgrade/contact Nexari

### Platform Instances
Register one or more self-hosted Platform URLs (e.g. `https://signage.mycompany.com`).
Used to:
- Display the URL in the downloads page (so builds are pre-configured)
- Validate the URL is reachable (health check ping)
- Associate heartbeats with the correct instance

### Downloads

| Platform | Method | Notes |
|---|---|---|
| **Tizen** | Build on server → download `.wgt` | Per-partner URL baked in |
| **ePaper** | Build on server → download `.wgt` | Per-partner URL baked in |
| **Android** | Build on server → download `.apk` | Per-partner URL baked in |
| **Windows** | Pre-built download (generic) | Partner enters URL at first-launch pairing |
| **ESP32** | Pre-built firmware download | Partner flashes with own URL via serial |
| **Raspberry Pi** | Pre-built image download | Partner configures via env file |

### Profile
- Contact details
- Change password
- Billing email
- Notes

---

## Server-Side Build System

### Build Queue

Builds are async (20–60 seconds). Use the existing Redis instance in nexari-admin
(or a lightweight in-process queue) to manage jobs.

```
POST /partner-portal/builds
  body: { platform: 'tizen'|'epaper'|'android', instanceUrl: 'https://...' }
  → { buildId: 'uuid', status: 'queued' }

GET /partner-portal/builds/:id
  → { buildId, status: 'queued'|'building'|'done'|'failed', artifactUrl?, error? }

GET /partner-portal/builds/:id/download
  → streams .wgt / .apk file
```

### Tizen / ePaper Build (Ubuntu server)

Requirements on `admin.nexari.ca` server:
- Tizen Studio CLI (`tizen` command, typically at `/home/<user>/tizen-studio/tools/ide/bin/tizen`)
- Author certificate + distributor certificate (`.p12` files) pre-configured as a Tizen signing profile
- Node.js (already present for the API)

Build steps:
```bash
# 1. Copy source to temp dir
cp -r /opt/nexari-builds/nexari-tizen /tmp/build-<uuid>/

# 2. Generate build-info.js with partner URL
API_BASE=https://signage.partnerA.com/api/v1 \
WS_URL=wss://signage.partnerA.com \
node /tmp/build-<uuid>/scripts/generate-build-info.cjs

# 3. Package WGT
tizen package -t wgt -s nexari-profile -- /tmp/build-<uuid>/

# 4. Move artifact to storage
mv /tmp/build-<uuid>/*.wgt /var/nexari-admin/builds/<uuid>.wgt

# 5. Cleanup
rm -rf /tmp/build-<uuid>/
```

### Android Build (Ubuntu server)

Requirements:
- Android SDK command-line tools (`sdkmanager`, `avdmanager`)
- JDK 17 (`sudo apt install openjdk-17-jdk`)
- Signing keystore (nexari-android.jks) — same key used for all partner builds

Build steps:
```bash
# 1. Copy source to temp dir
cp -r /opt/nexari-builds/nexari-android /tmp/build-<uuid>/

# 2. Set partner URL via Gradle properties
cat > /tmp/build-<uuid>/android/partner.properties << EOF
partnerApiBase=https://signage.partnerA.com/api/v1
partnerWsBase=wss://signage.partnerA.com
EOF

# 3. Build
cd /tmp/build-<uuid>/android
./gradlew assembleSelfRelease \
  -PpartnerApiBase="https://signage.partnerA.com/api/v1" \
  -PpartnerWsBase="wss://signage.partnerA.com"

# 4. Move artifact
mv app/build/outputs/apk/self/release/app-self-release.apk \
   /var/nexari-admin/builds/<uuid>.apk

# 5. Cleanup
rm -rf /tmp/build-<uuid>/
```

### Windows (Pre-built, Generic)

The Windows Electron player uses `ElectronStore` to persist the API URL after first-launch
pairing. The installer is the same for all partners — no per-partner build needed.

Pre-built installer is uploaded by the Nexari team to a storage path on the server and
served directly from the Downloads page.

### Security Considerations

- Build temp dirs are isolated per job (`/tmp/build-<uuid>/`)
- Partner URL is validated (must be `https://` or `http://`, valid hostname) before injecting
- No partner can trigger builds for another partner's `instanceUrl`
- Signing keys (`.p12` files, keystore) are stored encrypted at rest
- Build artifacts are deleted from server after 24h or on download (configurable)
- Build process runs as a restricted user, not root

---

## Tizen Certificate Notes

For Samsung **commercial signage TVs (B2B/SSSP)**, the distributor certificate must be
issued through Samsung's B2B distribution channel (DDF — Distributor Distribution Framework).
Consumer TV distributor certs will not work on commercial displays.

If the current `.wgt` already runs on partner hardware, the existing author + distributor
cert pair is correct — move those `.p12` files to the server and configure the signing profile.

Samsung author certs expire every **2 years** — calendar a renewal reminder.

---

## Phased Rollout

| Phase | Scope |
|---|---|
| **Phase 1** | Login, Dashboard (license status), Downloads (pre-built binaries only) |
| **Phase 2** | Instance registration, Tizen/ePaper server-side builds |
| **Phase 3** | Android server-side builds |
| **Phase 4** | Build history, re-download previous builds |
