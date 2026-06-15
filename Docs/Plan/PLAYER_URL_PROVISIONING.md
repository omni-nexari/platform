# Player URL Provisioning

**Last updated: June 14, 2026**

---

## The Bootstrap Problem

Every player needs to know the partner's platform URL **before** it can do anything —
pairing, heartbeats, and content all require a valid `API_BASE`. The WS URL is always
auto-derived from `API_BASE` (http→ws, https→wss, same host), so only one URL needs
configuring.

The pairing code shown on screen is generated **by the Platform API** after the player
calls `POST <API_BASE>/api/v1/devices/pair/request`. The player cannot show a pairing
code until it already knows where to connect.

`admin.nexari.ca` **cannot** help here — it has no partner login page, and routing
ongoing player traffic through it would defeat the self-hosted architecture.

---

## Configuration Mechanism (All Platforms)

All players share the same config priority chain:

```
1. window.__PLAYER_CONFIG__ (injected at build time via generate-build-info.cjs)
   ↓ falls through if not set
2. localStorage PLAYER_API_BASE / PLAYER_WS_URL (set via settings overlay)
   ↓ falls through if not set
3. config.js defaultConfig (hardcoded fallback — currently ds.chiho.app)
```

WS URL derivation (if `PLAYER_WS_URL` not explicitly set):
```javascript
const apiUrl = new URL(CONFIG.API_BASE);
const wsProtocol = apiUrl.protocol === 'https:' ? 'wss:' : 'ws:';
CONFIG.WS_URL = `${wsProtocol}//${apiUrl.host}`;
```

---

## Per-Platform Solution

### Tizen (nexari-tizen)

**Recommended: Per-partner WGT build**

`generate-build-info.cjs` injects `window.__PLAYER_CONFIG__` into `js/build-info.js`
at build time via env vars:

```bash
API_BASE=https://signage.partnerA.com/api/v1 \
WS_URL=wss://signage.partnerA.com \
node scripts/generate-build-info.cjs
tizen package -t wgt -s <profile> -- .
```

The resulting `.wgt` has the partner URL baked in. Players boot directly to pairing
without any manual URL entry.

**Fallback: 10-tap settings overlay**

On any Tizen player, tap the top-left corner 10 times to open the settings panel.
Enter `API_BASE` and optionally `WS_URL`, click Save. Persisted in `localStorage`.

---

### ePaper (nexari-epaper)

**Same as Tizen** — uses identical `generate-build-info.cjs` + `tizen package` pipeline.

The settings overlay on the ePaper pairing screen also accepts manual URL entry.

---

### Android (nexari-android)

**Recommended: Per-partner APK build**

`build.gradle.kts` `productFlavors` define `DEFAULT_API_BASE` / `DEFAULT_WS_BASE`.
Pass partner URL via Gradle properties:

```bash
./gradlew assembleSelfRelease \
  -PpartnerApiBase="https://signage.partnerA.com/api/v1" \
  -PpartnerWsBase="wss://signage.partnerA.com"
```

Requires updating `build.gradle.kts` to read these properties:
```kotlin
create("self") {
    val partnerApi = project.findProperty("partnerApiBase") as String?
        ?: "https://ds.chiho.app/api/v1"
    val partnerWs = project.findProperty("partnerWsBase") as String?
        ?: "wss://ds.chiho.app"
    buildConfigField("String", "DEFAULT_API_BASE", "\"$partnerApi\"")
    buildConfigField("String", "DEFAULT_WS_BASE",  "\"$partnerWs\"")
}
```

**Fallback: player-web settings overlay**

The Android WebView loads `player-web`, which has the same 10-tap settings overlay.

---

### Windows (nexari-windows)

**No per-partner build needed.**

On first launch (no `deviceToken` in `ElectronStore`), the pairing screen is shown.
The pairing screen includes a URL field. The partner's technician enters the URL once;
it is persisted via `ElectronStore`:

```typescript
// main.ts — ipcMain.on('PAIRED', ...)
store2.set('apiBase', data.apiBase);  // persisted across restarts
```

On subsequent boots, `app:getConfig` returns the stored `apiBase`.

**Default fallback** (if no URL stored):
```typescript
const defaultApiBase = process.env.NEXARI_DEV === '1'
  ? 'http://192.168.1.17/api/v1'
  : 'https://ds.chiho.app/api/v1';  // TODO: update to prompt if not stored
```

Partners download a single generic `.exe` installer from `partners.nexari.ca`.

---

### ESP32 (nexari-esp32)

Configured at flash time via `src/config.h` or NVS (non-volatile storage).
Partners flash their own firmware with their URL embedded, or use the serial
configuration menu to set the URL after flashing.

---

### Raspberry Pi (player-web on Pi)

Configured via environment variables or `PLAYER_API_BASE` in the systemd service file:

```ini
# /etc/systemd/system/nexari-player.service
[Service]
Environment=PLAYER_API_BASE=https://signage.partnerA.com/api/v1
```

---

## Why Not a Central Provisioning Service?

An alternative considered: a provisioning endpoint at `admin.nexari.ca` where players
hit `GET /provision?code=XXXX` once to get their partner's URL.

**Rejected because:**
- Adds an internet dependency to the first-boot flow (admin.nexari.ca must be reachable)
- Requires provisioning code management in admin portal
- Adds no real value over build-time injection for Tizen/Android
- Windows already handles it via the pairing UI

Build-time injection is simpler, works offline, and is already supported by the
`generate-build-info.cjs` infrastructure in both Tizen and ePaper.

---

## Summary Table

| Platform | Method | Who configures | When |
|---|---|---|---|
| Tizen | Build-time WGT (server-generated) | `partners.nexari.ca` build | Before deployment |
| ePaper | Build-time WGT (server-generated) | `partners.nexari.ca` build | Before deployment |
| Android | Build-time APK (server-generated) | `partners.nexari.ca` build | Before deployment |
| Windows | Pairing screen URL field | Technician on-site | First launch |
| ESP32 | `config.h` / NVS | Partner at flash time | Before deployment |
| Raspberry Pi | systemd env var | Partner in service file | At install time |
