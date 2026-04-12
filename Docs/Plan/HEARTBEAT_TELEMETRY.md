# Heartbeat & Telemetry Data Flow

Documents what data is collected and sent at each lifecycle stage for Tizen SBB devices.

---

## Config Intervals

| Constant | Value |
|---|---|
| `HEARTBEAT_INTERVAL` | 30 000 ms (30s) |
| `TELEMETRY_INTERVAL` | 5 × 60 × 1000 ms (5min) |
| `PAIRING_CHECK_INTERVAL` | 5 000 ms (5s) |
| `COMMAND_POLL_INTERVAL` | 10 000 ms (10s) — unused (commands arrive via WS) |
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

**On reinstall** (device already exists in DB): `mdcNetworkStandby` is reset to `null` so the auto-enable fires again on the next WS connect.

**No WebSocket open at this stage. No heartbeat. No telemetry.**  
Device polls `GET /pair/status?code=XXXXX` every 5s until an admin claims it.

---

## Phase 2 — Just After Pairing (admin claims device)

`Pairing.onPaired()` → saves `deviceId`, `deviceToken`, `deviceName`, `workspaceId` to `localStorage` → attempts `Telemetry.send(deviceId)`.

> ⚠️ **Known issue**: This initial telemetry call **always fails silently** because `Player.wsConnection` doesn't exist yet. `API.sendTelemetry()` returns `{ ok: false, reason: 'ws_unavailable' }`. The app starts the player anyway.
> **Result**: First real system telemetry is T+5min after player start.

`Player.init()` then runs, which:
1. Opens the WebSocket
2. Starts heartbeat (30s) and telemetry (5min) intervals
3. After 5s: calls `runPostPairingMdcSetup()`

### Post-Pairing MDC Setup (`runPostPairingMdcSetup`)

Fires 5s after `Player.init()`. If WS is not open yet, retries every 3s.

Actions (all via XHR to `localhost:9615`, non-blocking):
- Sends `mdc_id_persist` WS message to persist the scanned MDC ID to DB
- `standby_set { value: 0 }` — sets Standby Control to **Off**
- `osd_display_set { osdType: 0, osdOnOff: 0 }` — Source OSD off
- `osd_display_set { osdType: 2, osdOnOff: 0 }` — No Signal OSD off
- `osd_display_set { osdType: 3, osdOnOff: 0 }` — MDC OSD off
- `osd_display_set { osdType: 4, osdOnOff: 0 }` — Schedule OSD off

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
| `cpuLoad` | ✅ from `tizen.systeminfo.CPU.load` |
| `storageFreeBytes` | ✅ from `STORAGE.units[0].availableCapacity` |
| `memoryFreeBytes` | ✅ from `tizen.systeminfo.getAvailableMemory()` |
| `memoryTotalBytes` | ✅ from `tizen.systeminfo.getTotalMemory()` |
| `currentContentId` | ⚠️ always null |
| `nextContentId` | ⚠️ always null |
| `nextStartsAt` | ⚠️ always null |
| `playerVersion` | null (populated at 5min only) |
| `firmwareVersion` | null (populated at 5min only) |
| `deviceUptimeSec` | null (populated at 5min only) |
| `powerState` | null (populated via `mdc_heartbeat`, not this message) |
| `temperatureC` | null (see `mdcTemperatureC` on `devices`) |
| `irLock` / `buttonLock` | null (`system_state` msg — not sent by tizen player) |

### Phase 3b — MDC Heartbeat (every 30s, piggybacked on heartbeat)

`sendWebSocketHeartbeat()` also calls `sendMdcHeartbeat()` after sending the heartbeat payload.

`sendMdcHeartbeat()` sends `status_get` via XHR to `localhost:9615/mdc-control` (5s timeout), then — if the MDC response is OK — sends:

```json
{
  "type": "mdc_heartbeat",
  "payload": { "power": 1, "volume": 0, "mute": 0, "input": 33 }
}
```

**Server side** (`ws.ts`) on receipt — updates `devices` only (no heartbeat row):

| Field | Value |
|---|---|
| `powerState` | ✅ `power === 1 → 'on'`, else `'off'` |
| `mdcVolume` | ✅ integer |
| `mdcMute` | ✅ boolean |
| `mdcInput` | ✅ integer (Samsung input source code) |

---

## Phase 4 — Every 5 Minutes (full telemetry + MDC poll)

**Source**: `player.ts` → `startTelemetry()` setInterval

Two operations run back-to-back on each tick:

### 4a — System Telemetry

`Telemetry.send(deviceId)` collects full system info (30s cache TTL), then `API.sendTelemetry()` sends **two WS messages**:

**Message A — `network_info`**
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
→ **No `deviceHeartbeats` row**

**Message B — `heartbeat` extras**
```json
{
  "type": "heartbeat",
  "payload": {
    "playerVersion": "1.0.0 20260403-035807Z",
    "firmwareVersion": "TIZEN-B2B-TRUNK2023-KantSU2e-LFD-HOTF-...",
    "timezone": "America/Toronto",
    "resolution": "1920x1080",
    "cpuLoad": 12.5,
    "storageFreeBytes": 1610612736,
    "memoryFreeBytes": 524288000,
    "memoryTotalBytes": 2147483648,
    "deviceUptimeSec": 86400,
    "tvName": "Lobby Display"
  }
}
```
→ Updates `devices`: all above fields + `lastSeen`, `status = 'online'`  
→ Inserts `deviceHeartbeats` row with full fields

| Column | Source API | Value |
|---|---|---|
| `playerVersion` | build-info.js | ✅ |
| `firmwareVersion` | `productinfo.getFirmwareVersion()` | ✅ |
| `timezone` (devices only) | `tizen.time.getLocalTimezone()` | ✅ |
| `resolution` (devices only) | `tizen.systeminfo.PANEL` | ✅ |
| `cpuLoad` | `tizen.systeminfo.CPU.load` | ✅ (0–100) |
| `storageFreeBytes` | `tizen.systeminfo.STORAGE.units[0].availableCapacity` | ✅ |
| `memoryFreeBytes` | `tizen.systeminfo.getAvailableMemory()` | ✅ |
| `memoryTotalBytes` | `tizen.systeminfo.getTotalMemory()` | ✅ |
| `deviceUptimeSec` | `tizen.systeminfo.getDeviceUptime()` | ✅ |
| `tvName` → `name` (devices only) | `webapis.network.getTVName()` | ✅ |
| `powerState` | — | ⚠️ not in this payload (see `mdc_heartbeat`) |
| `temperatureC` | — | ⚠️ not in this payload (see `mdcTemperatureC`) |

### 4b — MDC Poll (`runMdcPoll`)

Runs immediately after telemetry on every 5min tick, and also **5 seconds after every WS connect/reconnect**.

Sends 9 MDC GET commands in parallel via XHR to `localhost:9615/mdc-control` (5s timeout each). When all responses arrive, bundles results into one WS message:

```json
{
  "type": "mdc_poll",
  "payload": {
    "standby": 0,
    "osdStatus": 0,
    "networkStandby": 1,
    "menuOrientation": 0,
    "srcOrientation": null,
    "remoteControl": 1,
    "safetyLock": 0,
    "softwareVersion": "T-HKMFDEUC-1351.3",
    "temperatureC": 38
  }
}
```

**Server side** (`ws.ts`) on receipt — updates `devices` only:

| MDC GET command | Payload field | DB column |
|---|---|---|
| `standby_get` | `standby` | `mdcStandby` |
| `osd_display_get` | `osdStatus` | `mdcOsdStatus` |
| `network_standby_get` | `networkStandby` | `mdcNetworkStandby` |
| `menu_orientation_get` | `menuOrientation` | `mdcMenuOrientation` |
| `src_orientation_get` | `srcOrientation` | `mdcSrcOrientation` (nullable — NAK means unsupported) |
| `remote_control_get` | `remoteControl` | `mdcRemoteControl` |
| `safety_lock_get` | `safetyLock` | `mdcSafetyLock` |
| `sw_version_get` | `softwareVersion` | `mdcSoftwareVersion` |
| `display_status_get` | `temperatureC` (byte 4) | `mdcTemperatureC` |
| (always) | — | `mdcLastPoll` (timestamp) |

---

## Network Standby Auto-Enable

On every WS device connect, the API checks `devices.mdcNetworkStandby`. If it is `null` (device has never been polled, or was just reinstalled), it fires after 3s:

```
requestMdcControl(deviceId, 'network_standby_set', { value: 1 })
  → on success: writes mdcNetworkStandby = 1 to DB
```

This ensures network standby is always enabled on first connect without any user action.

---

## Full Data Map

### Hardware Identity Sources

| UI Field | DB Column | Source API | Message | Frequency |
|---|---|---|---|---|
| Model | `modelName` / `modelCode` | `productinfo.getModel()` / `getRealModel()` | `pair/request` | On pair |
| DUID | `duid` | `productinfo.getDuid()` | `pair/request` | On pair |
| Serial Number | `serialNumber` | `systemcontrol.getSerialNumber()` (partner cert) | `pair/request` | On pair |
| Software version | `firmwareVersion` | `productinfo.getFirmware()` (user-visible "Software Version") | `heartbeat` | 5min |
| Player version | `playerVersion` | `build-info.js` version + buildId | `heartbeat` | 5min |
| Resolution | `resolution` | `tizen.systeminfo.PANEL` | `heartbeat` | 5min |
| Timezone | `timezone` | `tizen.time.getLocalTimezone()` | `heartbeat` | 5min |
| Device time | *(derived)* | heartbeat `createdAt` + `clockDriftMs` | — | UI only |

### Network Sources

| UI Field | DB Column | Source API | Message | Frequency |
|---|---|---|---|---|
| IP Address | `ipAddress` | `tizen.systeminfo.NETWORK.ipAddress` | `network_info` | 5min |
| MAC Address | `macAddress` | `WIFI_NETWORK.macAddress` or `ETHERNET_NETWORK.macAddress` | `network_info` | 5min |
| Connection type | `connectionType` | `webapis.network.getActiveConnectionType()` | `network_info` | 5min |
| SSID | `wifiSsid` | `tizen.systeminfo.WIFI_NETWORK.ssid` | `network_info` | 5min |

### Telemetry Sources

| UI Field | DB Column | Source API | Message | Frequency |
|---|---|---|---|---|
| Temperature | `mdcTemperatureC` | MDC `display_status_get` byte 4 | `mdc_poll` | 5min |
| CPU | `cpuLoad` (heartbeats) | `tizen.systeminfo.CPU.load` | `heartbeat` | 30s |
| Memory | `memoryFreeBytes` + `memoryTotalBytes` (heartbeats) | `tizen.systeminfo.getAvailableMemory()` / `getTotalMemory()` | `heartbeat` | 30s |
| Storage used | `storageFreeBytes` (heartbeats) | `tizen.systeminfo.STORAGE.units[0].availableCapacity` | `heartbeat` | 30s |
| Uptime | `deviceUptimeSec` (heartbeats) | `tizen.systeminfo.getDeviceUptime()` | `heartbeat` | 5min |
| Clock drift | `clockDriftMs` (heartbeats) | NTP server time delta | `heartbeat` | 30s |

---

## Message-Level Data Map

| Field | pair/request | 30s heartbeat | 30s mdc_heartbeat | 5min telemetry | 5min mdc_poll |
|---|:---:|:---:|:---:|:---:|:---:|
| `duid` | ✅ | — | — | — | — |
| `serialNumber` | ✅ | — | — | — | — |
| `ipAddress` | ✅ req.ip | — | — | ✅ network_info | — |
| `macAddress` | — | — | — | ✅ network_info | — |
| `connectionType` | — | — | — | ✅ network_info | — |
| `wifiSsid` | — | — | — | ✅ network_info | — |
| `clockDriftMs` | — | ✅ | — | — | — |
| `currentContentId` | — | ⚠️ null | — | — | — |
| `playerVersion` | — | — | — | ✅ | — |
| `firmwareVersion` | ✅ | — | — | ✅ | — |
| `cpuLoad` | — | ✅ | — | ✅ | — |
| `storageFreeBytes` | — | ✅ | — | ✅ | — |
| `memoryFreeBytes` | — | ✅ | — | ✅ | — |
| `memoryTotalBytes` | — | ✅ | — | ✅ | — |
| `deviceUptimeSec` | — | — | — | ✅ | — |
| `resolution` | — | — | — | ✅ | — |
| `timezone` | — | — | — | ✅ | — |
| `tvName` / `name` | ✅ | — | — | ✅ | — |
| `powerState` | — | — | ✅ via MDC | — | — |
| `mdcVolume` | — | — | ✅ | — | — |
| `mdcMute` | — | — | ✅ | — | — |
| `mdcInput` | — | — | ✅ | — | — |
| `mdcStandby` | — | — | — | — | ✅ |
| `mdcNetworkStandby` | — | — | — | — | ✅ |
| `mdcRemoteControl` | — | — | — | — | ✅ |
| `mdcSafetyLock` | — | — | — | — | ✅ |
| `mdcOsdStatus` | — | — | — | — | ✅ |
| `mdcMenuOrientation` | — | — | — | — | ✅ |
| `mdcSrcOrientation` | — | — | — | — | ✅ |
| `mdcSoftwareVersion` | — | — | — | — | ✅ |
| `mdcTemperatureC` | — | — | — | — | ✅ |
| `mdcLastPoll` | — | — | — | — | ✅ timestamp |
| `irLock` / `buttonLock` | — | — | — | — | — |
| `status → 'online'` | — | ✅ | — | ✅ | — |
| `lastSeen` | — | ✅ | — | ✅ | — |

> `irLock`/`buttonLock` are handled by a `system_state` WS message type defined in the schema, but the tizen player does not currently send it.

---

## Known Gaps

| # | Issue | Location | Impact |
|---|---|---|---|
| 1 | **Initial telemetry always fails** — WS not open when `onPaired()` fires | `pairing.js`, `api.js:sendTelemetry` | First system telemetry delayed to T+5min after player start |
| 2 | **`currentContentId`/`nextContentId`/`nextStartsAt` always null** — `buildReadinessPayload()` doesn't return those keys | `player.ts:sendWebSocketHeartbeat` | Playing-state never tracked in `deviceHeartbeats` rows |
| 3 | **`powerState` not in `deviceHeartbeats`** — `mdc_heartbeat` updates `devices.powerState` but doesn't insert a heartbeat row | `ws.ts:mdc_heartbeat` handler | Power state history missing from heartbeat timeseries |
| 4 | **`temperatureC` in `deviceHeartbeats` never populated** — temperature comes from `mdc_poll` → `devices.mdcTemperatureC`, not into heartbeat rows | `ws.ts:mdc_poll` handler | Thermal history missing from heartbeat timeseries |
| 5 | **`system_state` message not sent** — `irLock`/`buttonLock`/`autoPowerOn` schema exists but tizen player never sends this message | `apps/tizen` player | IR lock and button lock states never populated |
| 6 | **`serialNumber` via `systemcontrol` requires partner cert** — `webapis.systemcontrol.getSerialNumber()` throws `SecurityError` on devices not in developer mode or without a Samsung partner distributor certificate | `telemetry.js` | Serial number may be null on production units not yet dev-mode signed |

---

## Relevant Files

| File | Purpose |
|---|---|
| `apps/tizen/js/config.js` | All interval constants |
| `apps/tizen/js/pairing.js` | Pairing flow, `onPaired()`, initial telemetry attempt |
| `apps/tizen/js/telemetry.js` | `Telemetry.getSystemInfo()`, `Telemetry.send()` — all native API calls |
| `apps/tizen/js/api.js` | `API.sendTelemetry()` — splits into `network_info` + `heartbeat` WS msgs |
| `apps/tizen/src/player.ts` | `sendWebSocketHeartbeat()`, `sendMdcHeartbeat()`, `runMdcPoll()`, `runPostPairingMdcSetup()` |
| `apps/api/src/services/ws.ts` | Server-side WS handler — all device→API message types |
| `apps/api/src/routes/devices.ts` | `POST /pair/request`, `GET /pair/status`, `POST /mdc-control`, WS device endpoint |
| `packages/db/src/schema/telemetry.ts` | `deviceHeartbeats` schema — incl. `memoryFreeBytes`, `memoryTotalBytes`, `deviceUptimeSec` |
| `packages/db/migrations/0026_heartbeat_memory_uptime.sql` | Migration — adds the 3 new heartbeat columns |
| `packages/shared/src/schemas/device.ts` | `HeartbeatSchema` — Zod validation for heartbeat WS message |
| `apps/ds/src/pages/workspace/DeviceDetailPage.tsx` | Dashboard UI — Hardware Identity + Telemetry cards |

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
| **Config** | `zones` (jsonb), `screenshotIntervalMin`, `settings` (jsonb — legacy, unused) |
| **MDC live state** | `mdcVolume`, `mdcMute`, `mdcInput` — updated every 30s via `mdc_heartbeat` |
| **MDC settings** | `mdcStandby`, `mdcNetworkStandby`, `mdcRemoteControl`, `mdcSafetyLock`, `mdcOsdStatus`, `mdcMenuOrientation`, `mdcSrcOrientation` — updated every 5min via `mdc_poll` or immediately on toggle |
| **MDC info** | `mdcSoftwareVersion`, `mdcTemperatureC`, `mdcLastPoll`, `mdcId` |
| **Audit** | `createdAt`, `updatedAt`, `deletedAt` |

### `deviceHeartbeats` table (one row every 30s, ~48h retention)

| Column | Populated | Notes |
|---|---|---|
| `clockDriftMs` | Every 30s | NTP offset |
| `cpuLoad` | Every 30s | From `tizen.systeminfo.CPU.load` (0–100) |
| `storageFreeBytes` | Every 30s | From `STORAGE.units[0].availableCapacity` |
| `memoryFreeBytes` | Every 30s | From `tizen.systeminfo.getAvailableMemory()` |
| `memoryTotalBytes` | Every 30s | From `tizen.systeminfo.getTotalMemory()` |
| `playerVersion` | Every 5min | From build-info.js |
| `firmwareVersion` | Every 5min | From `productinfo.getFirmware()`, fallback to `BUILD.buildVersion` |
| `deviceUptimeSec` | Every 5min | From `tizen.systeminfo.getDeviceUptime()` |
| `temperatureC` | ⚠️ never | Temperature is in `devices.mdcTemperatureC` only |
| `powerState` | ⚠️ never | Power is in `devices.powerState` via `mdc_heartbeat` only |
| `irLock` / `buttonLock` | ⚠️ never | `system_state` msg not sent by tizen player |
| `currentContentId` | ⚠️ always null | `buildReadinessPayload()` does not return this key |

### `deviceScreenshots` table

One row per screenshot: `deviceId`, `contentId`, `trigger`, `storageKey`, `takenAt`, `requestedBy`

### `playEvents` table (partitioned, 13-month retention)

`deviceId`, `contentId`, `playlistId`, `scheduleId`, `zoneId`, `startedAt`, `endedAt`, `durationMs`, `completedFull`, `source`

---

## WS Message Types — Device → API

| Message type | Trigger | DB writes |
|---|---|---|
| `heartbeat` | Every 30s + every 5min (extended payload) | `devices` (status/lastSeen/clockDriftMs/versions), `deviceHeartbeats` INSERT |
| `mdc_heartbeat` | Every 30s (piggybacked on heartbeat) | `devices`: `powerState`, `mdcVolume`, `mdcMute`, `mdcInput` |
| `network_info` | Every 5min | `devices`: `ipAddress`, `macAddress`, `connectionType`, `wifiSsid`, `wifiStrength` |
| `mdc_poll` | Every 5min + on WS connect (+5s) | `devices`: all 9 MDC columns + `mdcLastPoll` |
| `mdc_id_persist` | On post-pairing MDC setup | `devices`: `mdcId` |
| `system_state` | Not sent by tizen player | `devices`: `irLock`, `buttonLock`, `autoPowerOn` |
| `screenshot_data` | On screenshot request or live-view | `deviceScreenshots` INSERT (persisted) or SSE relay (live) |
| `mdc_control_response` | ACK for mdc-control commands | None (relayed to waiting HTTP request) |
| `ack` | ACK for device commands | None (relayed to waiting HTTP request) |

---

## MDC Device ID — How It Works

Samsung MDC requires every packet to include the display's **MDC Device ID** (byte 3 of every frame). Default is `0x01` but devices may be configured otherwise.

### Storage & propagation

```
DB (devices.mdcId)
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
2. **Save** — `save_mdc_id` persists `mdcId` to `devices.mdcId` in DB, then sends `set_mdc_id` to update server.js memory. All subsequent commands use the saved ID — survives API and server.js restarts.

### On server.js restart

`DEVICE_MDC_ID` resets to `0x01` in memory. The API always reads `devices.mdcId` from DB and injects `displayId` into every relayed payload, so the correct ID is used regardless.

