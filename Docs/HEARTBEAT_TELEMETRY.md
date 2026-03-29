# Heartbeat & Telemetry Data Flow

Documents what data is collected and sent at each lifecycle stage for Tizen SBB devices.

---

## Config Intervals

| Constant | Value |
|---|---|
| `HEARTBEAT_INTERVAL` | 30 000 ms (30s) |
| `TELEMETRY_INTERVAL` | 5 × 60 × 1000 ms (5min) |
| `PAIRING_CHECK_INTERVAL` | 5 000 ms (5s) |
| `COMMAND_POLL_INTERVAL` | 10 000 ms (10s) |
| `CONTENT_REFRESH_INTERVAL` | 60 000 ms (1min) |

---

## Phase 1 — Before Pairing (app installed, unpaired)

`Pairing.init()` → `Telemetry.getSystemInfo()` → `POST /pair/request`

Device gathers hardware info locally (displayed on screen) then registers with:

```json
{
  "duid": "...",
  "model": "...",
  "realModel": "...",
  "tvName": "...",
  "manufacturer": "Samsung",
  "platform": "TIZEN",
  "serialNumber": "...",
  "firmwareVersion": "...",
  "capabilities": { ... }
}
```

**API creates `devices` row with:**
- `status: 'unclaimed'`
- `duid`, `modelName`, `modelCode`, `serialNumber`, `firmwareVersion`
- `ipAddress` (from `req.ip`)
- `pairingCode`, `pairingExpiresAt` (10-min expiry)

**No WebSocket open at this stage. No heartbeat. No telemetry.**  
Device polls `GET /pair/status?code=XXXXX` every 5s until an admin claims it.

---

## Phase 2 — Just After Pairing (admin claims device)

`Pairing.onPaired()` is called → saves `deviceId`, `deviceToken`, `deviceName`, `workspaceId` to `localStorage` → attempts `Telemetry.send(deviceId)`.

> ⚠️ **Known issue**: This initial telemetry call **always fails silently** because `Player.wsConnection` doesn't exist yet (`Player.init()` hasn't been called). `API.sendTelemetry()` requires an open WebSocket and returns `{ ok: false, reason: 'ws_unavailable' }`. The `.catch()` block starts the player anyway.  
> **Result**: First real system telemetry is T+5min after player start.

---

## Phase 3 — Every 30 Seconds (heartbeat)

**Source**: `player.ts` → `sendWebSocketHeartbeat()`

**WS message sent:**
```json
{
  "type": "heartbeat",
  "payload": {
    "clockDriftMs": 42,
    "currentContentId": null,
    "nextContentId": null,
    "nextStartsAt": null
  }
}
```

> ⚠️ **Known issue**: `currentContentId`, `nextContentId`, `nextStartsAt` are read from `buildReadinessPayload()` which does not return those keys → always `undefined` → always `null` in DB.  
> **Result**: Every 30s heartbeat row is effectively just a `clockDriftMs` ping.

**Dedup**: heartbeat is skipped if payload JSON is unchanged within one interval.

**Server side** (`ws.ts`) on receipt:
- `devices` UPDATE: `status = 'online'`, `lastSeen`, `clockDriftMs` (if non-null)
- `deviceHeartbeats` INSERT:

| Column | Value |
|---|---|
| `deviceId` | ✅ |
| `clockDriftMs` | ✅ NTP offset ms |
| `currentContentId` | ⚠️ always null |
| `nextContentId` | ⚠️ always null |
| `nextStartsAt` | ⚠️ always null |
| `playerVersion` | null |
| `firmwareVersion` | null |
| `powerState` | null |
| `cpuLoad` | null |
| `storageFreeBytes` | null |
| `temperatureC` | null |
| `irLock` / `buttonLock` | null |

---

## Phase 4 — Every 5 Minutes (full telemetry)

**Source**: `player.ts` → `Telemetry.send(deviceId)` → `API.sendTelemetry()`

`Telemetry.send()` collects full system info from Tizen APIs (30s cache TTL), then `API.sendTelemetry()` sends **two WS messages**:

### Message A — `network_info`
```json
{
  "type": "network_info",
  "payload": {
    "mac": "AA:BB:CC:DD:EE:FF",
    "ip": "192.168.1.50",
    "gateway": "192.168.1.1",
    "connectionType": "ethernet",
    "wifiSsid": null,
    "wifiStrength": null
  }
}
```
→ Updates `devices`: `ipAddress`, `macAddress`, `connectionType`, `wifiSsid`, `wifiStrength`  
→ **No `deviceHeartbeats` row inserted**

### Message B — `heartbeat` extras
```json
{
  "type": "heartbeat",
  "payload": {
    "playerVersion": "1.0.0 20260329-162104Z",
    "firmwareVersion": "T-HKMFDEUC-1351.3",
    "timezone": "America/Toronto",
    "resolution": "1920x1080",
    "cpuLoad": 12.5,
    "storageFreeBytes": 9123456789,
    "tvName": "Lobby Display"
  }
}
```
→ Updates `devices`: all above fields + `lastSeen`, `status = 'online'`  
→ Inserts `deviceHeartbeats` row:

| Column | Value |
|---|---|
| `playerVersion` | ✅ |
| `firmwareVersion` | ✅ |
| `timezone` (devices only) | ✅ |
| `resolution` (devices only) | ✅ |
| `cpuLoad` | ✅ |
| `storageFreeBytes` | ✅ |
| `tvName` → `name` (devices only) | ✅ |
| `powerState` | ⚠️ never sent |
| `temperatureC` | ⚠️ not collected |
| `irLock` / `buttonLock` | ✗ (system_state msg only) |

---

## Full Data Map

| Field | pair/request | 30s heartbeat | 5min telemetry |
|---|:---:|:---:|:---:|
| `duid` / `serialNumber` | ✅ | — | — |
| `ipAddress` | ✅ req.ip | — | ✅ network_info |
| `macAddress` | — | — | ✅ network_info |
| `connectionType` | — | — | ✅ network_info |
| `wifiSsid` | — | — | ✅ network_info |
| `clockDriftMs` | — | ✅ | — |
| `currentContentId` | — | ⚠️ always null | — |
| `playerVersion` | — | — | ✅ |
| `firmwareVersion` | ✅ | — | ✅ |
| `cpuLoad` | — | — | ✅ |
| `storageFreeBytes` | — | — | ✅ |
| `resolution` | — | — | ✅ |
| `timezone` | — | — | ✅ |
| `tvName` / `name` | ✅ | — | ✅ |
| `powerState` | — | — | ⚠️ never sent |
| `temperatureC` | — | — | ⚠️ not collected |
| `irLock` / `buttonLock` | — | — | ✗ (system_state) |
| `status → 'online'` | — | ✅ | ✅ |
| `lastSeen` | — | ✅ | ✅ |

---

## Known Gaps

| # | Issue | Location | Impact |
|---|---|---|---|
| 1 | **Initial telemetry always fails** — WS not open when `onPaired()` fires | `pairing.js:260`, `api.js:55` | First system telemetry delayed to T+5min |
| 2 | **`currentContentId`/`nextContentId`/`nextStartsAt` always null** — `buildReadinessPayload()` doesn't return those keys | `player.ts` `sendWebSocketHeartbeat()` | Playing-state never tracked in heartbeat rows |
| 3 | **`powerState` never populated** in `deviceHeartbeats` | `telemetry.js` `send()` | Power state history missing |
| 4 | **`temperatureC` never populated** | No Tizen API call in pipeline | Thermal monitoring not available |

---

## Relevant Files

| File | Purpose |
|---|---|
| `apps/tizen-sbb/js/config.js` | All interval constants |
| `apps/tizen-sbb/js/pairing.js` | Pairing flow, `onPaired()`, initial telemetry attempt |
| `apps/tizen-sbb/js/telemetry.js` | `Telemetry.getSystemInfo()`, `Telemetry.send()` |
| `apps/tizen-sbb/js/api.js` | `API.sendTelemetry()` — splits into `network_info` + `heartbeat` WS msgs |
| `apps/tizen-sbb/src/player.ts` | `sendWebSocketHeartbeat()`, `startHeartbeat()`, `startTelemetry()` |
| `apps/api/src/services/ws.ts` | Server-side WS handler — persists heartbeat/network_info/system_state |
| `apps/api/src/routes/devices.ts` | `POST /pair/request`, `GET /pair/status`, `POST /mdc-control` |
| `packages/db/src/` | `devices` + `deviceHeartbeats` schema |

---

## Device-Related Data Stored in DB

### `devices` table (one persistent row per display)

| Category | Columns |
|---|---|
| **Identity** | `id`, `orgId`, `workspaceId`, `name`, `deviceToken`, `pairingCode`, `pairingExpiresAt` |
| **Status** | `status` (unclaimed/online/offline/error), `lastSeen` |
| **Tizen hardware** | `duid`, `modelName`, `modelCode`, `serialNumber`, `macAddress` |
| **Network** | `ipAddress`, `connectionType`, `wifiSsid`, `wifiStrength` |
| **Display state** | `screenOrientation`, `powerState`, `irLock`, `buttonLock`, `autoPowerOn` |
| **Versions** | `firmwareVersion`, `playerVersion`, `resolution`, `timezone` |
| **NTP** | `ntpEnabled`, `ntpServer`, `ntpTimezone`, `clockDriftMs` |
| **Location** | `latitude`, `longitude`, `locationLabel` |
| **Content assignment** | `publishedContentId`, `publishedPlaylistId`, `publishedScheduleId`, `publishedSyncGroupId`, `defaultPlaylistId` |
| **Config** | `zones` (jsonb), `screenshotIntervalMin`, `settings` (jsonb text) |
| **Audit** | `createdAt`, `updatedAt`, `deletedAt` |

**`settings` jsonb** is the free-form config bag. Currently used to store:

| Key | Type | Set by |
|---|---|---|
| `mdcId` | `number` | `POST /mdc-control { action: save_mdc_id }` via MDC Fix test page |

### `deviceHeartbeats` table (one row every 30s, ~48h retention)

`playerVersion`, `firmwareVersion`, `powerState`, `clockDriftMs`, `irLock`, `buttonLock`, `cpuLoad`, `storageFreeBytes`, `temperatureC`, `currentContentId`, `nextContentId`, `nextStartsAt`

### `deviceScreenshots` table

One row per screenshot: `deviceId`, `contentId`, `trigger`, `storageKey`, `takenAt`, `requestedBy`

### `playEvents` table (partitioned, 13-month retention)

`deviceId`, `contentId`, `playlistId`, `scheduleId`, `zoneId`, `startedAt`, `endedAt`, `durationMs`, `completedFull`, `source`

---

## MDC Device ID — How It Works

Samsung MDC requires every packet to include the display's **MDC Device ID** (byte 3 of every frame). Default is `0x01` but devices may be configured otherwise.

### Storage & propagation

```
DB (devices.settings.mdcId)
  ↓ read on every mdc-control request
API (routes/devices.ts) injects displayId into WS payload
  ↓ WS mdc_control msg
player.ts forwards to server.js XHR body
  ↓ parsed.displayId
server.js DEVICE_MDC_ID (in-memory module var)
  ↓ used as default in buildPacket()
MDC TCP packet
```

### Setting the ID (test page workflow)

1. **Scan** — `mdc_id_scan` sends `CMD_STATUS GET` to IDs 1–9 sequentially (800ms each), returns first responder. Auto-sets `DEVICE_MDC_ID` in server.js memory for the current session.
2. **Save** — `save_mdc_id` persists `{ mdcId: N }` to `devices.settings` in DB, then sends `set_mdc_id` to update server.js memory. All subsequent commands use the saved ID automatically — survives API restarts and server.js restarts.

### On server.js restart

`DEVICE_MDC_ID` resets to `0x01` in memory. However the API always reads `devices.settings.mdcId` from DB and injects `displayId` into every relayed payload, so the correct ID is always used regardless.

