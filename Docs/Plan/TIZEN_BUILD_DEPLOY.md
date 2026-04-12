# Tizen App — Auto Build, Host & Deploy Plan

> **Status:** Plan / Design  
> **Scope:** `apps/tizen` (Tizen 5+, Signage) · `apps/tizen-sbb` (Tizen 4, SBB/SSSP) · `apps/tizen-kiosk` (Kiosk portrait/landscape) · `apps/tizen-kitchen` (Kitchen display)  
> **Build OS:** Ubuntu (headless, CI server)  
> **Updated:** 2026-04-12  
> **Certs:** `.p12` author + distributor certificates and password are already in hand  
> **Builder UI:** Tizen Builder — controlled by Superadmin and Management (owner/admin)

---

## Table of Contents

1. [Background & Goals](#1-background--goals)
2. [App Inventory](#2-app-inventory)
3. [Build Server Setup (Ubuntu + Tizen Studio CLI)](#3-build-server-setup-ubuntu--tizen-studio-cli)
4. [Version Management](#4-version-management)
5. [sssp_config.xml Generation](#5-sssp_configxml-generation)
6. [WGT File Hosting (Static File Server)](#6-wgt-file-hosting-static-file-server)
7. [TV Auto-Update Mechanism](#7-tv-auto-update-mechanism)
8. [Branding & Reskinning System](#8-branding--reskinning-system)
9. [App Rename — Custom Brand per Management Company](#9-app-rename--custom-brand-per-management-company)
10. [Management & SuperAdmin UI — Tizen Builder](#10-management--superadmin-ui--tizen-builder)
11. [CI/CD Pipeline (GitHub Actions)](#11-cicd-pipeline-github-actions)
12. [Extended Automation Opportunities](#12-extended-automation-opportunities)
13. [Open Questions](#13-open-questions)

---

## 1. Background & Goals

Samsung signage apps are packaged as `.wgt` files and installed on TVs via the SSSP launcher.
Currently the WGT is built by hand in Tizen Studio GUI and the resulting file is deployed manually.

**Goals of this plan:**

| # | Goal | Notes |
|---|------|-------|
| G1 | One-command (or fully automatic) WGT build | CLI-only, no GUI required |
| G2 | Auto-bump version in `package.json`, `config.xml`, `sssp_config.xml`, `build-info.js` | Already partially scripted |
| G3 | Host WGT + sssp_config files on a static file server | TVs pull from URL |
| G4 | TVs detect a new version and self-update without manual action | Version-check via API |
| G5 | Management / SuperAdmin can reskin the app (CSS, logo) from the portal UI | Runtime skin, no rebuild required |
| G6 | CI/CD pipeline triggers build on tag push | GitHub Actions on Ubuntu runner |
| G7 | **Tizen Builder UI** — Superadmin and Management (owner/admin) can trigger, monitor, and rollback builds for all app types from within the portal | Replaces manual CLI / GitHub UI access |
| G8 | **4 app types** — Signage (Tizen 5+ and SBB), Kiosk (portrait/landscape), Kitchen display — all managed under one build pipeline | Same API, separate WGT builds, same cert pair |

---

## 2. App Inventory

| App folder | WGT name | Package ID | Default `<name>` | Purpose | Tizen target | Hardware target |
|---|---|---|---|---|---|---|
| `apps/tizen` | `NexariSignage.wgt` | `NexariSignage` | **Nexari Signage** | CMS signage player | Tizen 5+ | Samsung Smart TV 2020+ |
| `apps/tizen-sbb` | `NexariSignageSBB.wgt` | `NexariSignageSBB` | **Nexari Signage SBB** | CMS signage player (SBB) | Tizen 4 | Samsung SBB / SSSP |
| `apps/tizen-kiosk` | `NexariKiosk.wgt` | `NexariKiosk` | **Nexari Kiosk** | POS self-order kiosk (portrait + landscape) | Tizen 5+ | Samsung Kiosk / consumer touch display |
| `apps/tizen-kitchen` | `NexariKitchen.wgt` | `NexariKitchen` | **Nexari Kitchen** | POS kitchen order display | Tizen 5+ | Any Samsung commercial display |

> **App type responsibilities:**
> - **Signage (tizen / tizen-sbb):** Renders CMS playlists and zones. Connects to heartbeat + content API. Supports MDC power commands, timers, sync groups.
> - **Kiosk (tizen-kiosk):** Renders `/kiosk/:wsId/portrait` or `/kiosk/:wsId/landscape` public pages. Full-screen touch UI. No CMS playlist — reads POS menu via kiosk-public API. Registered as `type: 'kiosk'` in the unified Devices page.
> - **Kitchen (tizen-kitchen):** Renders kitchen order board. Connects to POS orders WebSocket. Registered as `type: 'kitchen'` in the unified Devices page.

All four apps share:
- The same `.p12` author + distributor cert pair (different Package IDs, same signing identity)
- Same `generate-build-info.cjs` + `update-sssp.js` script pattern
- Same heartbeat endpoint (`POST /devices/heartbeat`) — `type` declared at registration
- Same platform CSS vars and brand skin API (`GET /api/v1/orgs/:orgId/player-skin`)

---

## 3. Build Server Setup (Ubuntu + Tizen Studio CLI)

### 3.1 Install Tizen Studio CLI (Headless)

```bash
# Download the CLI-only installer (no IDE required)
wget https://download.tizen.org/sdk/Installer/tizen-studio_X.X/web-cli_Tizen_Studio_X.X_ubuntu-64.bin
chmod +x web-cli_Tizen_Studio_X.X_ubuntu-64.bin
./web-cli_Tizen_Studio_X.X_ubuntu-64.bin --accept-license /opt/tizen-studio

# Add to PATH
export PATH=$PATH:/opt/tizen-studio/tools:/opt/tizen-studio/tools/ide/bin

# Install required packages (tv-samsung-5.0 + tv-samsung-4.0 for SBB)
/opt/tizen-studio/package-manager/package-manager-cli.bin install \
  NativeIDE \
  TV-SAMSUNG-EXTENSION-5.0 \
  TV-SAMSUNG-EXTENSION-4.0
```

### 3.2 Signing Certificates

> **Status: DONE** — `.p12` author and distributor certificates plus the cert password are already in hand.

```
apps/tizen/.sign/       ← author.p12 + distributor.p12  (already present)
apps/tizen-sbb/.sign/   ← author.p12 + distributor.p12  (already present)
```

- Store `.p12` files as **GitHub Actions secrets** (base64-encoded), never check them into git.
- The CI pipeline decodes them to disk before building and deletes them after.
- Default platform profile name: `signage` (tizen) / `signage-sbb` (tizen-sbb).

**Security rule:** Cert password must also be a secret. Never hard-code passwords.

### 3.3 CLI Build Command

```bash
# 1. Generate build-info.js and sync version into config.xml
node scripts/generate-build-info.cjs

# 2. Package WGT using tizen CLI
#    -t wgt       → output type is widget package
#    -o ../dist   → output directory
#    -- .         → project root
tizen package \
  --type wgt \
  --sign <PROFILE_NAME> \
  --output /artifacts \
  -- apps/tizen

# 3. Patch sssp_config.xml with actual WGT byte-size
node apps/tizen/scripts/update-sssp.js

# Same steps for tizen-sbb
tizen package --type wgt --sign <PROFILE_NAME_SBB> --output /artifacts -- apps/tizen-sbb
node apps/tizen-sbb/scripts/update-sssp.js
```

> The `tizen package` command reads `config.xml` for the app ID, version, and privilege list.
> The certificate profile is stored in `~/tizen-studio-data/profile/profiles.xml`.

### 3.4 Environment Variables for Build

| Variable | Purpose |
|----------|---------|
| `API_BASE` | Backend API URL injected into `build-info.js` at build time |
| `WS_URL` | WebSocket URL injected at build time |
| `TIZEN_CERT_PASSWORD` | `.p12` password (secret) |
| `TIZEN_AUTHOR_CERT_B64` | base64-encoded author `.p12` (secret, shared across all 4 apps) |
| `TIZEN_DIST_CERT_B64` | base64-encoded distributor `.p12` (secret, shared across all 4 apps) |
| `APP_TYPE` | `tizen` \| `tizen-sbb` \| `tizen-kiosk` \| `tizen-kitchen` — selects which app folder to build |

---

## 4. Version Management

### 4.1 Version Flow

```
package.json  ──(generate-build-info.cjs)──►  config.xml (widget@version)
                                           └──►  js/build-info.js (window.PLAYER_BUILD_INFO)
                                           └──►  sssp_config.xml (app_version + size via update-sssp.js)
```

### 4.2 Bump Commands (already in package.json)

```bash
npm run version:patch   # 1.0.0 → 1.0.1  (bug fix, CI auto-bump)
npm run version:minor   # 1.0.0 → 1.1.0  (new feature, manual)
npm run version:major   # 1.0.0 → 2.0.0  (breaking change, manual)
```

Each command already calls `generate-build-info.cjs` automatically.

### 4.3 Auto-Bump Strategy for CI

- **On push to `main`:** CI checks if files under `apps/tizen/js/` or `apps/tizen/css/` have changed.
  If so, run `npm run version:patch` and commit the bumped files back.
- **On manual dispatch** (GitHub Actions `workflow_dispatch`): allow choosing `patch / minor / major`.
- The version in `package.json` becomes the canonical version everywhere.

### 4.4 sssp_config.xml Fields That Change Per Build

```xml
<!-- tizen (Tizen 5+ / Smart TV) -->
<ServerConfig>
  <Type>URL</Type>
  <ApplicationName>Nexari Signage</ApplicationName>
  <Version>1.0.5</Version>
  <URL>https://your-home-server/signage-apps/default/tizen/latest/NexariSignage.wgt</URL>
  <Size>4718592</Size>
</ServerConfig>

<!-- tizen-sbb (Tizen 4 / SBB) -->
<ServerConfig>
  <Type>URL</Type>
  <ApplicationName>Nexari Signage SBB</ApplicationName>
  <Version>1.0.3</Version>
  <URL>https://your-home-server/signage-apps/default/tizen-sbb/latest/NexariSignageSBB.wgt</URL>
  <Size>3145728</Size>
</ServerConfig>

<!-- tizen-kiosk -->
<ServerConfig>
  <Type>URL</Type>
  <ApplicationName>Nexari Kiosk</ApplicationName>
  <Version>1.0.0</Version>
  <URL>https://your-home-server/signage-apps/default/tizen-kiosk/latest/NexariKiosk.wgt</URL>
  <Size>3670016</Size>
</ServerConfig>

<!-- tizen-kitchen -->
<ServerConfig>
  <Type>URL</Type>
  <ApplicationName>Nexari Kitchen</ApplicationName>
  <Version>1.0.0</Version>
  <URL>https://your-home-server/signage-apps/default/tizen-kitchen/latest/NexariKitchen.wgt</URL>
  <Size>2621440</Size>
</ServerConfig>
```

**Confirmed:** `update-sssp.js` must patch **both** `<size>` and `<Version>`. Samsung SSSP in Custom URL mode compares `<Version>` against the installed app version to decide whether to download and install the new WGT.

---

## 5. sssp_config.xml Generation

### 5.1 What Samsung SSSP Uses

When a TV is set to **Custom URL** launcher mode, it downloads `sssp_config.xml` from a known URL and reads:
- `<URL>` — where to download the WGT
- `<Size>` — expected byte count (validation)
- `<Version>` — **confirmed**: compared against installed version; if higher, triggers download + install

### 5.2 Per-App sssp_config Files

Each app has its own config file. On the file server:

```
/srv/signage-apps/
  default/                          ← Nexari brand (platform default)
    tizen/
      sssp_config.xml               ← always points to latest WGT
      latest/
        NexariSignage.wgt
      1.0.5/
        NexariSignage.wgt
        sssp_config.xml             ← version-pinned copy
    tizen-sbb/
      sssp_config.xml
      latest/
        NexariSignageSBB.wgt
      1.0.3/
        NexariSignageSBB.wgt
        sssp_config.xml
  {mgmtCompanyId}/                  ← custom-branded builds (see Section 9)
    tizen/
      ...
    tizen-sbb/
      ...
```

### 5.3 `sssp_config.xml` Template

**tizen** (`apps/tizen`, Tizen 5+ Smart TV):
```xml
<?xml version="1.0" encoding="UTF-8"?>
<SamsungSDP version="1">
  <ServerConfig>
    <Type>URL</Type>
    <ApplicationName>{{APP_NAME}}</ApplicationName>
    <Version>{{VERSION}}</Version>
    <URL>{{BASE_URL}}/{{MGMT_ID}}/tizen/latest/NexariSignage.wgt</URL>
    <Size>{{SIZE_BYTES}}</Size>
  </ServerConfig>
</SamsungSDP>
```

**tizen-sbb** (`apps/tizen-sbb`, Tizen 4 / SBB):
```xml
<?xml version="1.0" encoding="UTF-8"?>
<SamsungSDP version="1">
  <ServerConfig>
    <Type>URL</Type>
    <ApplicationName>{{APP_NAME}}</ApplicationName>
    <Version>{{VERSION}}</Version>
    <URL>{{BASE_URL}}/{{MGMT_ID}}/tizen-sbb/latest/NexariSignageSBB.wgt</URL>
    <Size>{{SIZE_BYTES}}</Size>
  </ServerConfig>
</SamsungSDP>
```

**tizen-kiosk** (`apps/tizen-kiosk`):
```xml
<?xml version="1.0" encoding="UTF-8"?>
<SamsungSDP version="1">
  <ServerConfig>
    <Type>URL</Type>
    <ApplicationName>{{APP_NAME}}</ApplicationName>
    <Version>{{VERSION}}</Version>
    <URL>{{BASE_URL}}/{{MGMT_ID}}/tizen-kiosk/latest/NexariKiosk.wgt</URL>
    <Size>{{SIZE_BYTES}}</Size>
  </ServerConfig>
</SamsungSDP>
```

**tizen-kitchen** (`apps/tizen-kitchen`):
```xml
<?xml version="1.0" encoding="UTF-8"?>
<SamsungSDP version="1">
  <ServerConfig>
    <Type>URL</Type>
    <ApplicationName>{{APP_NAME}}</ApplicationName>
    <Version>{{VERSION}}</Version>
    <URL>{{BASE_URL}}/{{MGMT_ID}}/tizen-kitchen/latest/NexariKitchen.wgt</URL>
    <Size>{{SIZE_BYTES}}</Size>
  </ServerConfig>
</SamsungSDP>
```

The build script fills `{{APP_NAME}}`, `{{VERSION}}`, `{{SIZE_BYTES}}`, `{{BASE_URL}}`, and `{{MGMT_ID}}` at build time. For the default platform build `MGMT_ID` = `default`.

---

## 6. WGT File Hosting (Static File Server)

### 6.1 Hosting Approach

> **Infrastructure confirmed:** **Ubuntu home AI server + Nginx**. Reference config: `infra/nginx/signage.conf`.

Mount `/srv/signage-apps` as the Nginx root and serve over HTTPS (Let's Encrypt or a local cert).

```
# Signage (Tizen 5+)
https://your-home-server/signage-apps/default/tizen/sssp_config.xml
https://your-home-server/signage-apps/default/tizen/latest/NexariSignage.wgt

# Signage (SBB)
https://your-home-server/signage-apps/default/tizen-sbb/sssp_config.xml
https://your-home-server/signage-apps/default/tizen-sbb/latest/NexariSignageSBB.wgt

# Kiosk
https://your-home-server/signage-apps/default/tizen-kiosk/sssp_config.xml
https://your-home-server/signage-apps/default/tizen-kiosk/latest/NexariKiosk.wgt

# Kitchen
https://your-home-server/signage-apps/default/tizen-kitchen/sssp_config.xml
https://your-home-server/signage-apps/default/tizen-kitchen/latest/NexariKitchen.wgt

# Master manifest (all apps + all mgmt company variants)
https://your-home-server/signage-apps/manifest.json
```

### 6.2 Nginx Config (additions to infra/nginx/signage.conf)

```nginx
server {
    listen 443 ssl;
    server_name your-home-server;   # replace with actual hostname / IP
    
    root /srv/signage-apps;
    autoindex off;

    # Allow WGT and XML downloads from TV devices
    location ~* \.(wgt|xml|json)$ {
        add_header Access-Control-Allow-Origin "*";
        add_header Cache-Control "no-cache, must-revalidate";
        expires 0;
    }
}
```

### 6.3 Version Manifest (manifest.json)

A machine-readable file the TV app queries to check for updates:

```json
{
  "default": {
    "tizen": {
      "version": "1.0.5",
      "buildId": "20260412-143000Z",
      "wgtUrl": "https://your-home-server/signage-apps/default/tizen/1.0.5/NexariSignage.wgt",
      "ssspConfig": "https://your-home-server/signage-apps/default/tizen/sssp_config.xml",
      "size": 4718592,
      "sha256": "abc123..."
    },
    "tizen-sbb": {
      "version": "1.0.3",
      "buildId": "20260412-143000Z",
      "wgtUrl": "https://your-home-server/signage-apps/default/tizen-sbb/1.0.3/NexariSignageSBB.wgt",
      "ssspConfig": "https://your-home-server/signage-apps/default/tizen-sbb/sssp_config.xml",
      "size": 3145728,
      "sha256": "def456..."
    },
    "tizen-kiosk": {
      "version": "1.0.0",
      "buildId": "20260412-143000Z",
      "wgtUrl": "https://your-home-server/signage-apps/default/tizen-kiosk/1.0.0/NexariKiosk.wgt",
      "ssspConfig": "https://your-home-server/signage-apps/default/tizen-kiosk/sssp_config.xml",
      "size": 3670016,
      "sha256": "ghi789..."
    },
    "tizen-kitchen": {
      "version": "1.0.0",
      "buildId": "20260412-143000Z",
      "wgtUrl": "https://your-home-server/signage-apps/default/tizen-kitchen/1.0.0/NexariKitchen.wgt",
      "ssspConfig": "https://your-home-server/signage-apps/default/tizen-kitchen/sssp_config.xml",
      "size": 2621440,
      "sha256": "jkl012..."
    }
  }
}
```

This manifest is generated at the end of the CI pipeline and uploaded to the file server.

### 6.4 Deploy Script (CI step)

```bash
# On CI after successful build (deploy user on Ubuntu home AI server):
DEPLOY=deploy@your-home-server
VERSION=$(cat /artifacts/default/tizen/version.txt)

for APP_TYPE in tizen tizen-sbb tizen-kiosk tizen-kitchen; do
  for MGMT_ID in default $(ls /artifacts | grep -v default); do
    rsync -az /artifacts/$MGMT_ID/$APP_TYPE/ \
      $DEPLOY:/srv/signage-apps/$MGMT_ID/$APP_TYPE/$VERSION/
    ssh $DEPLOY "ln -sfn /srv/signage-apps/$MGMT_ID/$APP_TYPE/$VERSION \
      /srv/signage-apps/$MGMT_ID/$APP_TYPE/latest"
    scp /artifacts/$MGMT_ID/$APP_TYPE/sssp_config.xml \
      $DEPLOY:/srv/signage-apps/$MGMT_ID/$APP_TYPE/sssp_config.xml
  done
done

# Upload master manifest (covers all app types + all mgmt company variants)
scp /artifacts/manifest.json $DEPLOY:/srv/signage-apps/manifest.json
```

---

## 7. TV Auto-Update Mechanism

There are two complementary mechanisms:

### 7.1 SSSP / Tizen Launcher Auto-Install

Samsung SSSP TVs in **URL launcher mode** will periodically re-fetch `sssp_config.xml`.
When the `<Version>` field is higher than the currently installed app version, the TV will:
1. Download the WGT from `<URL>`.
2. Validate the byte count against `<Size>`.
3. Install (overwrite) the current app.
4. Restart the app automatically.

This is the **primary update path** — no code change in the app required.
Configure the TV's launcher URL to point at `sssp_config.xml` on the file server once; all future updates happen automatically.

### 7.2 In-App Version Check (Active OTA)

For TVs already running the app, the app can check for a newer version:

```
Boot → call GET /api/v1/app/version-check?app=tizen|tizen-sbb|tizen-kiosk|tizen-kitchen
     ← { latestVersion, wgtUrl, releaseNotes }
→ if latestVersion > installedVersion:
    show "Updating app…" overlay
    download WGT to wgt:// storage
    call tizen.application.launch(installer, wgtPath)
    app restarts into new version
```

This requires:
- A new API endpoint: `GET /api/v1/app/version-check`
- The app calling it on boot (already has `COMMAND_POLL_INTERVAL` loop infrastructure)
- Using `tizen.download` + `b2bapis.b2bcontrol.installApp` on newer firmwares, or
  relying purely on the SSSP launcher for older SBB devices

### 7.3 Backend API Endpoint (to be built)

```
GET /api/v1/app/version-check
Query: app=tizen | tizen-sbb | tizen-kiosk | tizen-kitchen
Returns:
  {
    latestVersion: "1.0.5",
    buildId: "20260412-143000Z",
    wgtUrl: "https://your-home-server/signage-apps/default/{app}/1.0.5/{WgtName}.wgt",
    ssspConfigUrl: "https://your-home-server/signage-apps/default/{app}/sssp_config.xml",
    releaseNotes: "Bug fixes"
  }
```

The backend reads this from the versioned `manifest.json` on the file server
(or from a `tizen_builds` DB row updated at deployment time).

---

## 8. Branding & Reskinning System

### 8.1 What Is Already Built

> **Status: LARGELY BUILT** — The portal branding infrastructure is complete. TV runtime skin layer needs to be wired up.

| Component | Status | Location |
|-----------|--------|----------|
| `managementCompanies` table with `logoUrl`, `primaryColor`, `accentColor`, `sidebarBg`, `headingFontPreset`, `bodyFontPreset`, `loginBackgroundUrl`, `portalTitle` | ✅ Exists | `packages/db/src/schema/management.ts` |
| `ManagementBrandingPage.tsx` — full portal branding UI (logo upload, colors, fonts) | ✅ Exists | `apps/ds/src/pages/management/ManagementBrandingPage.tsx` |
| `PATCH /superadmin/management-companies/:id/branding` API route | ✅ Exists | `apps/api/src/routes/superadmin.ts` |
| `apps/tizen/css/style.css` — CSS variables defined (`:root` block) | ✅ Exists | `apps/tizen/css/style.css` |
| Default platform brand: **Nexari** colors, logo, fonts | ✅ Exists | `Docs/sample/Brand/` (reference) |
| TV boot → fetch org skin → inject CSS vars + swap logo | ⬜ To build | New JS module in `apps/tizen/js/` |
| Management UI: "TV Player Skin" section | ⬜ To build | Extend `ManagementBrandingPage.tsx` |

### 8.2 Default Platform Brand (Nexari)

The platform brand is **Nexari**. The four app names are **Nexari Signage**, **Nexari Signage SBB**, **Nexari Kiosk**, and **Nexari Kitchen** (`Docs/sample/Brand/`).
The default WGT ships with Nexari brand values:

| Token | Value | Usage |
|-------|-------|-------|
| `--blue` | `#3a7bff` | Primary — buttons, highlights |
| `--aqua` | `#4ff2d1` | Accent — icons, active states |
| `--magenta` | `#ff3ea5` | Highlight — alerts, CTAs |
| `--indigo` | `#2a2f7f` | Deep background tint |
| `--bg` | `#0f1115` | Main background |
| `--bg2` | `#0b0d11` | Deeper background |
| Font | Inter | Body + headings |

These match `apps/tizen/css/style.css` (`:root` block) and `Docs/sample/Brand/styles.css`.

Every management company (reseller) overrides these at runtime via the skin API, or at build time for a fully custom-named WGT (see Section 9).

### 8.3 Runtime Skin (No Rebuild Required)

The TV app fetches a skin config from the API on every boot:

```
Boot → GET /api/v1/orgs/{orgId}/player-skin
     ← {
         primaryColor:  "#1a73e8",
         accentColor:   "#fbbc04",
         logoUrl:       "https://cdn.your-domain.com/uploads/{orgId}/logo.png",
         fontFamily:    "Inter",
         customCss:     "..."
       }
→ App injects <style> block overriding CSS variables
→ App swaps logo <img src> to logoUrl
```

The existing `window.__PLAYER_CONFIG__` override mechanism in `apps/tizen/js/config.js` is the right insertion point for this skin data.

### 8.4 Skin Contract (CSS Variables to Expose)

The management UI sets these values; the TV app applies them:

```css
/* Overridden at runtime by the skin API response */
:root {
  --brand-primary:   /* management primaryColor  → replaces --blue    */
  --brand-accent:    /* management accentColor   → replaces --aqua    */
  --brand-sidebar:   /* management sidebarBg     → sidebar background */
  --brand-font:      /* management fontFamily    → body font          */
}
```

### 8.5 Logo Handling

- Management uploads PNG/SVG via the existing branding page → stored in `signage_uploads/{orgId}/`.
- TV app reads `playerSkin.logoUrl` on boot → sets `img.src` dynamically.
- No WGT rebuild required. Logo is fetched over the network.

### 8.6 Custom CSS Injection

- Management can supply a CSS snippet (server-sanitized) in branding settings.
- TV app appends as a `<style>` tag after base stylesheet.
- Scope: colors, backgrounds, font sizes, visibility overrides only.
- JS behavior is **never** exposed to CSS injection.

### 8.7 What Is Reskinnable at Runtime vs Requires Rebuild

| Change | Runtime (no rebuild) | Requires Rebuild |
|--------|---------------------|-----------------|
| Primary / accent / sidebar colors | ✅ | — |
| Logo image | ✅ | — |
| Background images / overlays | ✅ | — |
| Font family (webfont URL) | ✅ | — |
| Portal / app display title | ✅ (in-UI overlay only) | ✅ WGT `<name>` needs rebuild |
| **App package name** (shown in Samsung launcher) | ❌ | ✅ see Section 9 |
| Layout, zone sizes | ❌ | ✅ major version |
| New features / JS behavior | ❌ never | N/A |
| Privilege set (config.xml) | ❌ | ✅ major version |

---

## 9. App Rename — Custom Brand per Management Company

### 9.1 What "Rename" Means

The default WGT displays the app name (e.g. **"Nexari Signage"**) in:
- The Samsung TV launcher / app list
- The Tizen TaskManager / app switcher
- `config.xml` `<name>` field
- `sssp_config.xml` `<ApplicationName>` field

A management company (reseller) may want their TVs to show **their own brand name** here — e.g., "AcmeCorp Display" — instead of the Nexari Signage default.

**This requires a custom build** — it cannot be changed at runtime because it is baked into the WGT manifest at package time.

### 9.2 Custom Build Inputs Per Management Company

The management company branding record (`managementCompanies` table) needs two new fields:

| New DB field | Purpose | Example |
|---|---|---|
| `playerAppName` | Replaces `<name>` in config.xml | `"AcmeCorp Display"` |
| `playerAppDescription` | Replaces `<description>` in config.xml | `"AcmeCorp Digital Signage Player"` |

These are set by the management admin in the "TV Player Skin" section, or by SuperAdmin when setting up the management company.

If these fields are **null**, the CI build uses the default Nexari brand name.

### 9.3 Build-Time Substitution

The `generate-build-info.cjs` script (already syncs `version` into `config.xml`) needs to be extended to also patch `<name>` and `<description>` when env vars are provided:

```bash
# Default (Nexari brand) — no env vars needed:
# <name>Nexari Signage</name>  (or Nexari Signage SBB / Nexari Kiosk / Nexari Kitchen)
# <description>Nexari Signage — Samsung Smart TV (Tizen 5+)</description>

# Custom-branded build for a management company:
PLAYER_APP_NAME="AcmeCorp Display"
PLAYER_APP_DESC="AcmeCorp Digital Signage Player"
MGMT_COMPANY_ID="abc-123"
```

The script patches `config.xml`:
```xml
<!-- Default Nexari brand -->
<name>Nexari Signage</name>
<description>Nexari Signage — Samsung Smart TV (Tizen 5+)</description>

<!-- Custom management company brand -->
<name>AcmeCorp Display</name>
<description>AcmeCorp Digital Signage Player</description>
```

And `sssp_config.xml`:
```xml
<!-- Default -->
<ApplicationName>Nexari Signage</ApplicationName>

<!-- Custom -->
<ApplicationName>AcmeCorp Display</ApplicationName>
```

### 9.4 Per-Management-Company WGT File Layout on the File Server

Each management company that requests a custom-branded build gets their own directory, mirroring the `default/` structure across all 4 app types:

```
/srv/signage-apps/
  default/                               ← Nexari brand (platform default)
    tizen/sssp_config.xml
    tizen/latest/NexariSignage.wgt
    tizen-sbb/sssp_config.xml
    tizen-sbb/latest/NexariSignageSBB.wgt
    tizen-kiosk/sssp_config.xml
    tizen-kiosk/latest/NexariKiosk.wgt
    tizen-kitchen/sssp_config.xml
    tizen-kitchen/latest/NexariKitchen.wgt
  {mgmtCompanyId}/                       ← custom-branded builds
    tizen/sssp_config.xml
    tizen/latest/NexariSignage.wgt        ← <name> baked in as "AcmeCorp Display"
    tizen-sbb/...
    tizen-kiosk/...
    tizen-kitchen/...
```

When a TV is provisioned for an org that belongs to a management company with a custom app name, it is given the `sssp_config.xml` URL for that management company's folder.

### 9.5 When to Trigger a Custom Build

A custom-branded build is triggered when:
1. Management admin **saves a new `playerAppName`** for the first time → CI triggers a new build for that management company.
2. Management admin **changes `playerAppName`** → CI triggers a rebuild for that management company only (not the default build).
3. SuperAdmin **triggers manual rebuild** from the platform admin UI.
4. A new platform version is released → CI rebuilds ALL management company WGTs automatically.

### 9.6 Build Matrix (CI)

On each platform release, CI builds **all 4 app types** per management company entry, plus the default Nexari set:

```
Build matrix (app_type × mgmt_company):

  app_type: tizen        mgmtId: default   → NexariSignage.wgt       (Nexari brand)
  app_type: tizen-sbb    mgmtId: default   → NexariSignageSBB.wgt    (Nexari brand)
  app_type: tizen-kiosk  mgmtId: default   → NexariKiosk.wgt         (Nexari brand)
  app_type: tizen-kitchen mgmtId: default  → NexariKitchen.wgt       (Nexari brand)

  app_type: tizen        mgmtId: abc-123   → NexariSignage.wgt       ("AcmeCorp Display")
  app_type: tizen-sbb    mgmtId: abc-123   → NexariSignageSBB.wgt    ("AcmeCorp Display")
  app_type: tizen-kiosk  mgmtId: abc-123   → NexariKiosk.wgt         ("AcmeCorp Kiosk")
  app_type: tizen-kitchen mgmtId: abc-123  → NexariKitchen.wgt       ("AcmeCorp Kitchen")
  ...
```

Builder note: management companies may optionally override app names **per app type** (`playerAppNameKiosk`, `playerAppNameKitchen`) — or fall back to the same custom brand name used for signage. WGT builds are fast (< 60 seconds each). 4 app types × 10 management companies = ~40 builds = ~40 minutes, parallelised to ~10 minutes with 4 concurrent runners.

---

## 10. Management & SuperAdmin UI Capabilities

### 10.1 Management Portal — What's Already Built

| Page | Status | What it does |
|------|--------|-------------|
| `ManagementBrandingPage.tsx` | ✅ Built | Portal logo, colors, fonts, favicon, login background |
| `PATCH /superadmin/management-companies/:id/branding` | ✅ Built | Saves all portal branding fields |
| Logo/favicon/background upload | ✅ Built | `signage_uploads/` storage |

### 10.2 Management Portal — Additions Needed

| Page / Feature | Action | Notes |
|---|---|---|
| `ManagementBrandingPage.tsx` | Add **"TV Player Skin"** section | Wire `primaryColor`, `accentColor`, `logoUrl` to TV player skin API |
| `ManagementBrandingPage.tsx` | Add **"TV App Name"** field (`playerAppName`) | Saves to DB → triggers CI build for this management company |
| *(new)* `ManagementTizenPage.tsx` | Build status, current deployed version, release notes | Shows which WGT version their TVs are on |

### 10.3 SuperAdmin Portal — What's Already Built

| Page | Status | What it does |
|------|--------|-------------|
| `player-releases.ts` API routes | ✅ Built | `GET /latest`, `GET /` (list all), `POST /` (publish), `DELETE /:id` |
| `playerReleases` DB table | ✅ Built | `version`, `downloadUrl`, `releaseNotes`, `isLatest`, `publishedAt` |

The existing `playerReleases` table is the right foundation. A superadmin publishes a new release and sets `isLatest: true` — the `downloadUrl` points to the WGT on the file server. All TVs fetch this on boot.

### 10.4 SuperAdmin Portal — Additions Needed

| Page / Feature | Action | Notes |
|---|---|---|
| `SystemHealthPage.tsx` | Add **Tizen build server status** panel | Last build time, status, Docker runner health |
| *(new)* `PlatformTizenBuildsPage.tsx` | Build history, per-app + per-management-company view, rollback | Uses `playerReleases` + new `tizenBuilds` table |
| Trigger build button | `POST /api/v1/platform/tizen-builds/trigger` | Fires GitHub Actions webhook |
| Rollback button | `POST /api/v1/platform/tizen-builds/rollback` | Re-points `latest/` symlink, updates `playerReleases.isLatest` |

### 10.5 New DB Tables Needed

**`tizen_builds`** — tracks per-management-company build jobs:

```
id              uuid PK
mgmtCompanyId   uuid | null    — null = default/platform (Nexari brand)
appType         text           — "tizen" | "tizen-sbb"
version         text
status          text           — "pending" | "building" | "success" | "failed"
playerAppName   text | null    — custom name baked into this build
wgtUrl          text | null
ssspConfigUrl   text | null
sizeBytes       int | null
sha256          text | null
releaseNotes    text | null
buildLog        text | null
triggeredBy     uuid | null    — superadmin user id
createdAt       timestamp
completedAt     timestamp | null
```

**`org_player_skins`** — per-org runtime TV skin (runtime only, no rebuild):

```
id              uuid PK
orgId           uuid FK → organisations.id
primaryColor    text | null
accentColor     text | null
logoUrl         text | null
fontFamily      text | null
customCss       text | null    — sanitized CSS snippet only
createdAt       timestamp
updatedAt       timestamp
```

### 10.6 Player Skin API (to be built)

```
GET    /api/v1/orgs/:orgId/player-skin     → TV fetches on boot
PUT    /api/v1/orgs/:orgId/player-skin     → management saves runtime skin
POST   /api/v1/orgs/:orgId/player-skin/logo → upload logo, returns URL
```

### 10.7 Tizen Build API (to be built, superadmin only)

```
GET    /api/v1/platform/tizen-builds                 → list all builds
GET    /api/v1/platform/tizen-builds/latest           → latest per app type
POST   /api/v1/platform/tizen-builds/trigger          → webhook → CI pipeline
POST   /api/v1/platform/tizen-builds/rollback         → re-point latest, update playerReleases
GET    /api/v1/app/version-check?app=tizen            → TV calls on boot
```

---

## 11. CI/CD Pipeline (GitHub Actions)

### 11.1 Pipeline Overview

```
Tag push v1.x.x  OR  manual trigger from Tizen Builder UI
  │
  ├─ Job: build-matrix
  │     Queries /api/v1/platform/tizen-builds/matrix
  │     Returns: [ { mgmtId, appType, appName } ] for ALL 4 app types × all mgmt companies
  │
  ├─ Job: build-app  (runs N×4 times — once per matrix entry)
  │     1. Checkout repo
  │     2. Decode + install signing certs (same cert pair for all 4 apps)
  │     3. npm ci in apps/{appType}/
  │     4. npm run version:patch (default build) OR inherit version (custom builds)
  │     5. node scripts/generate-build-info.cjs
  │        + patch <name>/<description> if PLAYER_APP_NAME env set
  │     6. tizen package --type wgt --sign {profile} --output /artifacts/{mgmtId}/{appType}/
  │     7. node scripts/update-sssp.js (patches <Size> and <Version>)
  │     8. Generate per-entry manifest fragment
  │     9. Upload artifacts
  │
  ├─ Job: deploy (depends on: all build-app jobs)
  │     1. For each {mgmtId}/{appType}: rsync to file server, update latest/ symlink
  │     2. Upload all sssp_config.xml files
  │     3. Merge + upload master manifest.json
  │     4. POST /api/v1/platform/tizen-builds/complete (records DB rows, sets playerReleases.isLatest)
  │     5. WebSocket broadcast: { type: "update_available", version, appType }
  │
  └─ Job: notify
        Email/Slack: total WGTs built, any failures, version, build ID
```

### 11.2 Workflow File Sketch

```yaml
# .github/workflows/tizen-build.yml
on:
  push:
    tags:
      - 'v[0-9]+.[0-9]+.[0-9]+'
  workflow_dispatch:
    inputs:
      bump:
        description: 'Version bump type'
        type: choice
        options: [patch, minor, major]
        default: patch
      mgmt_company_id:
        description: 'Management company ID (leave blank for all)'
        default: ''
      app_types:
        description: 'App types to build (comma-separated, blank = all)'
        default: ''

jobs:
  build-app:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        include:
          - { mgmtId: default, appType: tizen,          appName: 'Nexari Signage' }
          - { mgmtId: default, appType: tizen-sbb,      appName: 'Nexari Signage SBB' }
          - { mgmtId: default, appType: tizen-kiosk,    appName: 'Nexari Kiosk' }
          - { mgmtId: default, appType: tizen-kitchen,  appName: 'Nexari Kitchen' }
          # + runtime entries from API for each mgmt company
    steps:
      - uses: actions/checkout@v4

      - name: Restore signing certs
        run: |
          for APP in tizen tizen-sbb tizen-kiosk tizen-kitchen; do
            mkdir -p apps/$APP/.sign
            echo "${{ secrets.TIZEN_AUTHOR_CERT_B64 }}" | base64 -d > apps/$APP/.sign/author.p12
            echo "${{ secrets.TIZEN_DIST_CERT_B64 }}"   | base64 -d > apps/$APP/.sign/distributor.p12
          done

      - name: Setup Tizen certificate profile
        run: |
          tizen certificate-profile add \
            --name signage \
            --author-cert apps/${{ matrix.appType }}/.sign/author.p12 \
            --author-password "${{ secrets.TIZEN_CERT_PASSWORD }}" \
            --dist-cert apps/${{ matrix.appType }}/.sign/distributor.p12 \
            --dist-password "${{ secrets.TIZEN_CERT_PASSWORD }}"

      - name: Build ${{ matrix.appType }}
        env:
          PLAYER_APP_NAME: ${{ matrix.appName }}
          MGMT_ID: ${{ matrix.mgmtId }}
          API_BASE: ${{ secrets.API_BASE }}
          WS_URL: ${{ secrets.WS_URL }}
        run: |
          cd apps/${{ matrix.appType }}
          npm ci
          npm run version:patch
          tizen package --type wgt --sign signage \
            --output ../../dist/${{ matrix.mgmtId }}/${{ matrix.appType }}
          node scripts/update-sssp.js

      - name: Clean up certs
        if: always()
        run: |
          for APP in tizen tizen-sbb tizen-kiosk tizen-kitchen; do
            rm -f apps/$APP/.sign/author.p12 apps/$APP/.sign/distributor.p12
          done

      - uses: actions/upload-artifact@v4
        with:
          name: tizen-wgt-${{ matrix.mgmtId }}-${{ github.run_number }}
          path: dist/

  deploy:
    needs: build-app
    runs-on: ubuntu-latest
    steps:
      - uses: actions/download-artifact@v4
      - name: Deploy all builds
        run: |
          for DIR in dist/*/; do
            MGMT_ID=$(basename $DIR)
            for APP_TYPE in tizen tizen-sbb tizen-kiosk tizen-kitchen; do
              [ -d "$DIR/$APP_TYPE" ] || continue
              VERSION=$(cat $DIR/$APP_TYPE/version.txt)
              rsync -az $DIR/$APP_TYPE/ \
                ${{ secrets.DEPLOY_USER }}@${{ secrets.DEPLOY_HOST }}:/srv/signage-apps/$MGMT_ID/$APP_TYPE/$VERSION/
              ssh ${{ secrets.DEPLOY_USER }}@${{ secrets.DEPLOY_HOST }} \
                "ln -sfn /srv/signage-apps/$MGMT_ID/$APP_TYPE/$VERSION \
                         /srv/signage-apps/$MGMT_ID/$APP_TYPE/latest"
              scp $DIR/$APP_TYPE/sssp_config.xml \
                ${{ secrets.DEPLOY_USER }}@${{ secrets.DEPLOY_HOST }}:/srv/signage-apps/$MGMT_ID/$APP_TYPE/sssp_config.xml
            done
          done
          # Merge + upload master manifest
          node scripts/merge-manifest.js dist/ > manifest.json
          scp manifest.json ${{ secrets.DEPLOY_USER }}@${{ secrets.DEPLOY_HOST }}:/srv/signage-apps/manifest.json
          # Notify platform API
          curl -X POST ${{ secrets.API_BASE }}/api/v1/platform/tizen-builds/complete \
            -H "Authorization: Bearer ${{ secrets.PLATFORM_API_KEY }}" \
            -d @dist/build-summary.json
```

### 11.3 Docker Image for CI (Recommended)

Pre-install Tizen Studio CLI in a Docker image to avoid downloading on every run:

```dockerfile
FROM ubuntu:22.04
RUN apt-get update && apt-get install -y curl nodejs npm git
RUN wget -q https://download.tizen.org/sdk/Installer/.../web-cli_Tizen_Studio_X.X_ubuntu-64.bin \
 && chmod +x web-cli_Tizen_Studio_X.X_ubuntu-64.bin \
 && ./web-cli_Tizen_Studio_X.X_ubuntu-64.bin --accept-license /opt/tizen-studio \
 && rm web-cli_Tizen_Studio_X.X_ubuntu-64.bin
ENV PATH="/opt/tizen-studio/tools:/opt/tizen-studio/tools/ide/bin:$PATH"
```

Push to your container registry (e.g., GHCR) and reference with `container: ghcr.io/your-org/tizen-builder:latest`.

---

## 12. Extended Automation Opportunities

With this pipeline in place, the following capabilities are available for free or with minimal additional work:

| Capability | Approach |
|---|---|
| **Rollback** | SuperAdmin or Management triggers rollback in Tizen Builder UI → re-points `latest/` symlink + sets `playerReleases.isLatest`. TVs auto-update back on next check. |
| **Staged rollout** | Per-management-company or per-org `sssp_config.xml`. Point a subset of TVs at `v-next/` for canary testing. Kiosk/kitchen can be staged independently from signage. |
| **Integrity verification** | `sha256` of WGT generated at build time; app verifies before install. Prevents corrupt downloads from deploying. |
| **Real-time push on deploy** | Deploy job sends WebSocket event `{ type: "update_available", version, appType }` to all connected devices of that type. |
| **Automatic cert expiry alert** | CI step checks `.p12` expiry date; alerts superadmin when `< 30 days` remain. Builder UI also shows expiry warning. |
| **Device version dashboard** | `PLAYER_BUILD_INFO.version` already sent in heartbeat — Devices page and Tizen Builder both show per-device app version and `appType`. |
| **Dependency audit** | `npm audit` in CI fails build on high-severity vulnerabilities. |
| **Build size tracking** | CI records WGT size per `appType` in `tizen_builds`; alert if growth > threshold. |
| **Per-org skin live preview** | Management portal skin page renders a mock TV frame with their colors/logo applied in real time. |
| **Kiosk/Kitchen selective rebuild** | Management can trigger a rebuild of `tizen-kiosk` only (e.g. after POS kiosk UI update) without rebuilding all signage WGTs. |

---

## 13. Open Questions

*All questions resolved.*

### Resolved

| # | Answer |
|---|--------|
| ~~Q1~~ | ✅ `sssp_config.xml` `<Version>` **is** used for update comparison. `update-sssp.js` must patch both `<size>` **and** `<Version>` after every build. |
| ~~Q2~~ | ✅ TVs are in **Custom URL launcher mode** pointed directly at the file server. No MagicINFO / SCM server in the chain. |
| ~~Q4~~ | ✅ Infrastructure: **Ubuntu home AI server + Nginx**. Config reference: `infra/nginx/signage.conf`. Serve `/srv/signage-apps` over HTTPS. |
| ~~Q5~~ | ✅ WGT files named to Nexari brand: `NexariSignage.wgt` (tizen), `NexariSignageSBB.wgt` (tizen-sbb), `NexariKiosk.wgt` (tizen-kiosk), `NexariKitchen.wgt` (tizen-kitchen). `update-sssp.js` in each app references its own filename. |
| ~~Q6~~ | ✅ Runtime CSS injection is sufficient for all current branding scenarios. Per-org WGT builds are not needed. |
| ~~Q3~~ | ✅ **Manual release tag** (`v1.0.5` etc.) triggers builds — or via Tizen Builder UI trigger. Push to `main` does NOT auto-trigger. `workflow_dispatch` + Builder UI both supported for manual runs. |

---

*End of document. All open questions resolved — ready for CI implementation.*
