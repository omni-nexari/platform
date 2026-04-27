# SyncPlay — Research & Architecture Guide

## Overview

Two distinct sync modes are defined. They are implemented separately and never mixed in the same active group.

| Mode | Scope | Status |
|---|---|---|
| **Mode 1 — Native Samsung SyncPlay** | All Samsung B2B (Tizen 4 SSSP + Tizen 6.5+), same LAN | Active design target |
| **Mode 2 — Custom Mixed-Platform Sync** | Mixed groups: any non-Samsung device present | Active design target |

This document covers:
1. Samsung's native SyncPlay API — capabilities, hard constraints, and how it is already partially implemented
2. Why it cannot be used for SBB (Tizen 4) or any non-Samsung device
3. The custom mixed-platform sync architecture (Mode 2) — coordinator model, group lifecycle, readiness, leader election, failover
4. UI/UX — where and how SyncPlay features appear in the portal

---

## 1. Samsung Native SyncPlay API

### What it is

`webapis.syncplay` is a **firmware-level synchronisation API** available exclusively on Samsung B2B (LFD) displays running **Tizen 6.5 or later**. Synchronisation is handled in the OS layer — not in JavaScript. All participating devices must be on the same LAN.

**References:**
- [Samsung SyncPlay API Reference](https://developer.samsung.com/smarttv/develop/api-references/samsung-product-api-references/syncplay-api.html?device=signage)
- [SyncPlay API Migration Guide](https://developer.samsung.com/smarttv/develop/migrating-applications/syncplay-api-usage.html?device=signage)
- [Samsung SyncPlay Sample App (GitHub)](https://github.com/SamsungDForum/SyncPlaySynchronisedContentPlayback)

### API Surface

The entire public API is 5 methods:

```javascript
webapis.syncplay.getVersion()
webapis.syncplay.createPlaylist(contentsArr, onsuccess, onerror)
webapis.syncplay.start(syncinfo, onlistener)
webapis.syncplay.stop(onlistener)
webapis.syncplay.removePlaylist(onsuccess, onerror)
```

**`SyncPlayContent`** — passed as array to `createPlaylist`:
```javascript
{
  path: "file:///...sync-abc123.mp4",  // local or remote path
  duration: 30                          // seconds
}
```

**`SyncInfo`** — passed to `start`:
```javascript
{
  rectX: 0,
  rectY: 0,
  rectWidth: 3840,
  rectHeight: 2160,
  groupID: 55,       // 16-bit integer — all devices in same group sync together
  rotate: "OFF"
}
```

**Listener events** received via `onlistener` callback:
- `SYNC_PLAY_START_DONE`
- `SYNC_PLAY_STOP_DONE`
- `SYNC_PLAY_FINISH_DONE`

### Hard Constraints

| Constraint | Detail |
|---|---|
| **Tizen 6.5+ only** | `Since: 6.5` — Tizen 4 and 5 cannot use this API |
| **Samsung LFD B2B only** | Not available on consumer Samsung TVs, webOS, Android, or Windows |
| **Partner certificate** | `config.xml` must declare `http://developer.samsung.com/privilege/syncplay`; signing cert must have Partner-level privileges |
| **Same LAN required** | Uses firmware multicast/broadcast for clock alignment — cannot span WAN |
| **Video only** | Images in playlist have known limitations per Samsung docs |
| **Identical file paths** | All devices must have the same file path for each content item |
| **`groupID` is 16-bit** | Range 0–65535; must be identical across all devices in a sync group |

### How it's currently implemented (non-SBB `tizen` app)

The `tizen` player already handles SyncPlay correctly:

1. Server sets `content.syncPlay.enabled = true` and provides a `syncPlay.groupID`
2. `groupID` is derived deterministically from `folderId` — ensures all devices in a workspace compute the same value
3. Content is downloaded to deterministic paths: `sync-${contentId}.${ext}` — ensures identical file paths across devices
4. Server sends `{ type: "SYNC_PLAY", action: "START_SYNCPLAY" }` via WebSocket
5. Player calls `prepareSyncPlaylistNative()` → `webapis.syncplay.createPlaylist(...)`
6. Player calls `startSyncPlayNative()` → `webapis.syncplay.start({ ..., groupID })`
7. Firmware auto-selects a leader and coordinates playback start across all devices in the group

---

## 2. SBB (Tizen 4) — B2BSyncplay API

### Context

The SBB is not a "bare Tizen 4" device — the project is explicitly described as **"Samsung SBB/SSSP (Tizen 4.0)"**. It runs on the Samsung Smart Signage Platform (SSSP) and `b2bapis.js` is **already loaded** in `apps/tizen-sbb/index.html`:

```html
<script type="text/javascript" src="$B2BAPIS/b2bapis/b2bapis.js"></script>
```

`b2bapis` is already declared as a known global in `.jshintrc`. Other `b2bapis` methods (`b2bcontrol.startNodeServer`) are already called in `app.js`.

### The SSSP Sync API: `b2bapis.b2bsyncplay`

Before `webapis.syncplay` (Tizen 6.5+) existed, Samsung provided equivalent firmware-level sync on SSSP via `b2bapis.b2bsyncplay`. The migration guide at:
https://developer.samsung.com/smarttv/develop/migrating-applications/migrating-sssp-to-tizen.html?device=signage

explicitly maps B2BSyncplay → webapis.syncplay as a 1:1 migration.

| Method (SSSP / Tizen 4) | Method (Tizen 6.5+) |
|---|---|
| `b2bapis.b2bsyncplay.makeSyncPlayList(contents, onSuccess, onError)` | `webapis.syncplay.createPlaylist(contentsArr, onsuccess, onerror)` |
| `b2bapis.b2bsyncplay.startSyncPlay(x, y, w, h, groupID, rotate, onChange)` | `webapis.syncplay.start({ rectX, rectY, rectWidth, rectHeight, groupID, rotate }, onlistener)` |
| `b2bapis.b2bsyncplay.stopSyncPlay(onChange)` | `webapis.syncplay.stop(onlistener)` |
| `b2bapis.b2bsyncplay.clearSyncPlayList(onSuccess, onError)` | `webapis.syncplay.removePlaylist(onsuccess, onerror)` |
| `b2bapis.b2bsyncplay.getVersion()` | `webapis.syncplay.getVersion()` |

Key difference in `startSyncPlay`: parameters are **positional** (not an object) on the SSSP API.

### The current bug in the SBB player

`isSyncplayAvailable()` in `apps/tizen-sbb/js/player.js` only checks for `webapis.syncplay`:

```javascript
isSyncplayAvailable() {
    return typeof webapis !== 'undefined' &&
        !!webapis.syncplay &&
        typeof webapis.syncplay.start === 'function' ...
}
```

On Tizen 4, `webapis.syncplay` does not exist → `isSyncplayAvailable()` always returns `false` → all sync paths are bypassed → `handleSyncPlayCommand` logs "legacy orchestration disabled" and does nothing.

The fix is to also detect `b2bapis.b2bsyncplay` and use it as the sync backend on Tizen 4.

### What needs to change (no code changes yet — design only)

1. `isSyncplayAvailable()` should check both APIs:
   - prefer `webapis.syncplay` if present (Tizen 6.5+)
   - fall back to `b2bapis.b2bsyncplay` if present (SSSP / Tizen 4)
   - track which API is active: `syncplayBackend = 'webapis' | 'b2bapis'`

2. `prepareSyncPlaylistNative()` should call the right backend's `createPlaylist` / `makeSyncPlayList`.

3. `startSyncPlayNative()` should call the right backend's `start` / `startSyncPlay` (adapting positional vs object param).

4. `stopSyncPlayNative()` should call the right backend's `stop` / `stopSyncPlay` and `removePlaylist` / `clearSyncPlayList`.

### Cross-backend groups: confirmed compatible

Sync groups may freely mix Tizen 4 SBB devices (`b2bapis.b2bsyncplay`) and Tizen 6.5+ devices (`webapis.syncplay`).

- Samsung's SyncPlay is a **hardware-layer multicast protocol**. Both JS API namespaces are version-specific bindings on top of the same underlying firmware mechanism.
- The `groupID` (16-bit integer) is what the firmware uses to identify sync peers — the JS API path used to register that groupID does not matter.
- All Samsung B2B displays support SyncPlay at the firmware level; they just expose it through different JS APIs depending on Tizen/SSSP version.
- **Result:** a mixed group (Tizen 4 + Tizen 6.5+ in the same `groupID`) will sync correctly.

### Constraints (same as `webapis.syncplay`)

All of the same hard constraints apply:
- Partner-level certificate required (`b2bapis.js` privilege — no separate syncplay privilege needed on SSSP)
- Same LAN required
- Video only (images have limitations)
- Identical file paths across all devices
- `groupID` is a 16-bit integer (0–65535)
- No custom leader exposure — firmware selects leader internally

---

## 3. Mode 2 — Custom Mixed-Platform Sync

### Scope

Covers all groups that contain at least one non-Samsung device:
- webOS (LG) — HTML5 `<video>`
- Android — WebView HTML5 or ExoPlayer
- Windows — Electron / Chromium HTML5
- Any mixed group where Samsung and non-Samsung devices are combined

**Rule:** If any device in a group is not Samsung B2B (either SSSP Tizen 4 or Tizen 6.5+), the entire group uses Mode 2. Native Samsung firmware sync cannot be mixed with app-layer timing in the same group.

Note: All-Samsung groups (Tizen 4 SSSP and/or Tizen 6.5+) use Mode 1, not Mode 2. See Section 5.

---

### 3.1 Local Runtime Coordinator

The central decision for Mode 2 is: **who coordinates devices during runtime?**

#### Decision: Node.js local coordinator service

All screens are clients only. They do not accept inbound connections or host server processes. The runtime coordinator is a **dedicated Node.js service** on the LAN.

```
┌───────────────────────────────────────────────────┐
│  Cloud API Server (provisioning only)              │
│  - Creates sync groups and playlists               │
│  - Assigns screens to groups                       │
│  - Assigns leader priority order                   │
│  - Pushes config to devices while online           │
└────────────┬──────────────────────────────────────┘
             │ provisioning only (may be offline during playback)
             ▼
┌───────────────────────────────────────────────────┐
│  Local LAN Coordinator (Node.js service)           │
│  - Runs on dedicated box or capable Windows player │
│  - Tracks group membership and readiness           │
│  - Orchestrates start barrier and session          │
│  - Relays heartbeats and playhead references       │
│  - Manages leader/backup/failover                  │
└────────────┬──────────────────────────────────────┘
             │ WebSocket (LAN only)
  ┌──────────┼──────────┬──────────┬──────────┐
  │          │          │          │          │
Tizen 4   Tizen 6.5+ webOS    Android    Windows
 (SBB)     (AVPlay)  (HTML5)  (WebView)  (Electron)
```

**Coordinator responsibilities:**
1. Accept WebSocket connections from all group members
2. Track per-device readiness state (download progress, prebuffer, clock sync)
3. Enforce start barrier — wait for all required devices to reach `READY`
4. Elect a playback leader and maintain a backup priority list
5. Send `START_AT` once barrier is met
6. Broadcast periodic `PLAYHEAD_REF` from leader
7. Detect leader loss and trigger failover
8. Handle late joiners
9. Continue operating if cloud server is unreachable (LAN-only mode)

**Coordinator deployment options:**

| Option | Suitability |
|---|---|
| Dedicated local mini-PC / NUC | Best — stable, always-on, not tied to any display |
| On-prem edge server / gateway | Best — same as above |
| Windows-based player in the group | Good — if Windows player is accessible and stable |
| Tizen / webOS screen | Not supported — cannot bind inbound LAN sockets reliably |

---

### 3.2 Domain Objects

#### SyncPlaylist
An ordered list of media items to be played in synchronisation.

```typescript
{
  id: string
  name: string
  workspaceId: string
  items: SyncPlaylistItem[]  // ordered
  createdAt: string
  updatedAt: string
}

SyncPlaylistItem {
  id: string
  contentId: string
  contentVersion: string    // hash/version for cache validation
  durationSeconds: number
  localFilename: string     // deterministic: "sync-{contentId}.{ext}"
  order: number
}
```

#### SyncGroup
A named user-created group of screens assigned to play a SyncPlaylist together.

> **Existing DB schema** (`packages/db/src/schema/telemetry.ts`) already defines `sync_groups` and `sync_group_members` tables, explicitly tagged "Phase 3 — Samsung SyncPlay API". The shape below reconciles the existing columns with what the new feature needs.

```typescript
// DB table: sync_groups  (already exists)
{
  id: string              // uuid, PK
  orgId: string           // FK → organisations
  workspaceId: string     // FK → workspaces
  name: string
  groupId: number         // smallint (0–65535) — the firmware groupID for Mode 1
                          // Derived via CRC-16 from this record's id at creation time
  layout: object | null   // jsonb — video wall tile grid config (rows, cols, screen dimensions)
                          // Used by Mode 1 to position each screen within a multi-panel wall
  createdAt: string
  updatedAt: string

  // --- Columns to ADD via migration ---
  syncPlaylistId: string  // FK → sync_playlists (new table)
  mode: 'native-samsung' | 'custom-mixed'  // auto-set from assigned device platforms
}

// DB table: sync_group_members  (already exists)
{
  syncGroupId: string     // FK → sync_groups (cascade delete)
  deviceId: string        // FK → devices (cascade delete)
  tileCol: number         // smallint — x position in video wall grid (0-based)
  tileRow: number         // smallint — y position in video wall grid (0-based)
  // PK: (syncGroupId, deviceId)

  // --- Column to ADD ---
  leaderPriority: number  // int, order for leader election (0 = primary candidate)
}
```

**Tile layout note:** The `tileCol`/`tileRow` fields exist for Mode 1 video wall use: each Samsung screen in the group renders a different tile/viewport of the video content rather than the same full-frame content. The `layout` jsonb on the group stores the grid dimensions. This is a future Mode 1 feature — for initial SyncPlay implementation every screen renders the full image (tileCol = 0, tileRow = 0).

#### SyncSession
The live runtime state for an active playback session.

```typescript
{
  sessionId: string
  groupId: string
  playlistId: string
  generation: number          // increments on leader change or playlist change
  leaderId: string            // current active leader device ID
  state: SyncSessionState
  currentItemIndex: number
  startedAt: string | null    // UTC ms when playback began
}

type SyncSessionState =
  | 'IDLE'
  | 'PROVISIONED'      // group assigned, assets not yet fully ready
  | 'DOWNLOADING'      // assets downloading across members
  | 'READY'            // start barrier met — all required devices ready
  | 'STARTING'         // startAt sent, waiting for play
  | 'PLAYING'
  | 'RESYNCING'        // recovering from drift or leader change
  | 'DEGRADED'         // one or more screens disconnected during playback
  | 'STOPPED'
```

---

### 3.3 Group Lifecycle & Workflow

#### Provisioning (user action via portal)

1. User creates a **SyncPlaylist** and adds content items.
2. User creates a **SyncGroup**, assigns a SyncPlaylist.
3. User assigns screens to the group.
4. Server auto-assigns leader priority order:
   - prefer stable, high-uptime devices
   - rank all assigned screens as backup leaders (all are candidates)
   - push full config to all devices via cloud WebSocket
5. Devices receive group config and begin downloading missing assets.

#### Preparation (automatic, on-device)

6. Each device checks local cache for each playlist item:
   - if `file exists + version matches + checksum valid` → skip download
   - else → download to deterministic path `sync-{contentId}.{ext}`
7. Per-item readiness gate — a device is **READY** when all of these pass for all playlist items:
   - `manifestReceived` — group config received
   - `assetsDownloaded` — all files exist with correct version/checksum
   - `firstItemPrebuffered` — first playlist item opened and prebuffered by player
   - `clockSynced` — device clock aligned to coordinator/authority clock
8. Each device reports readiness progress to coordinator via WebSocket.

#### Holding behavior while waiting for group ready

- **Devices do NOT start the SyncPlaylist independently before group start.**
- While waiting, devices continue displaying their currently assigned normal content (schedule/playlist/default).
- Once all required devices are `READY`, coordinator issues `START_AT`.

#### Session start (coordinator-driven)

9. Coordinator evaluates start barrier: waits until all assigned online screens report `READY`.
   Screens that were offline when the group was provisioned are excluded from the barrier.
10. Coordinator sends `START_AT` to all group members with:
    - `targetStartAt` = current coordinator time + `bufferMs` (default 5000ms, increase for Tizen 4 which needs long prepareAsync)
    - `currentItemIndex = 0`
    - `sessionId` and `generation`
11. Each device applies its own `leaderOffsetMs` correction and calls `play()` at the adjusted start time via `waitForPreciseSyncedTime`.

#### Runtime (coordinator-driven)

12. Leader emits `PLAYHEAD_HEARTBEAT` every 500ms to coordinator.
13. Coordinator fans out `PLAYHEAD_REF` to all followers every 2s.
14. Followers apply drift correction:
    - compute `expectedMs = refPositionMs + (localClockOffset + timeSinceSent)`
    - compare to `avplay.getCurrentTime()` or `video.currentTime * 1000`
    - `|drift| > 300ms` → hard seek
    - `20ms < |drift| < 300ms` → rate nudge (HTML5 only; Tizen 4 uses seek at >250ms)
    - `|drift| ≤ 20ms` → no action
15. Downloads for remaining playlist items continue in background while playing.

---

### 3.4 Leader Election & Failover

#### Initial assignment
Server assigns an ordered list of all screens in the group as backup leader candidates when the group is created. Any screen can become leader — "backup leaders" are just lower-priority candidates.

```
leaderPriority = [deviceA, deviceB, deviceC, deviceD]
                   ^active  ^backup1  ^backup2  ^backup3
```

#### Leader heartbeat
- Leader sends `LEADER_HEARTBEAT` to coordinator every **500ms**.
- Coordinator rebroadcasts so all followers know leader is alive.

#### Failover trigger
- If coordinator receives no `LEADER_HEARTBEAT` from current leader for **2000ms** (4 missed):
  - Coordinator promotes next healthy device in `leaderPriority` order.
  - New leader is sent `LEADER_TAKEOVER` with current `generation + 1`, current `itemIndex`, and estimated `playheadMs`.
  - All followers are sent `LEADER_CHANGED` with new `leaderId` and `generation`.

#### New leader reconstruction
New leader:
- Accepts its own current `avplay.getCurrentTime()` as the new authoritative playhead.
- Begins emitting `LEADER_HEARTBEAT` immediately.
- Coordinator re-issues `PLAYHEAD_REF` from new leader to resync followers.

#### During failover
- Followers continue playing independently (do not pause/stop) while failover completes.
- After `LEADER_CHANGED`, followers resync to new leader's playhead via seek correction if drift is detected.

---

### 3.5 LAN Runtime Protocol Messages

All messages are JSON over WebSocket. Coordinator to/from all devices.

```
Device → Coordinator
  DEVICE_JOIN        { deviceId, groupId, sessionId? }
  READINESS_UPDATE   { deviceId, state, downloadProgress, assetsReady, prebufferReady, clockReady }
  LEADER_HEARTBEAT   { deviceId, sessionId, generation, itemIndex, positionMs, sentAt }
  PLAYHEAD_REPORT    { deviceId, positionMs, itemIndex }

Coordinator → Device
  SESSION_CONFIG     { sessionId, generation, groupId, playlistId, leaderId, leaderPriority }
  START_AT           { sessionId, generation, targetStartAt, itemIndex, coordinatorSentAt }
  PLAYHEAD_REF       { sessionId, generation, leaderId, positionMs, itemIndex, sentAt }
  LEADER_CHANGED     { sessionId, generation, newLeaderId }
  LEADER_TAKEOVER    { sessionId, generation, itemIndex, estimatedPositionMs }
  RESYNC             { sessionId, generation, targetPositionMs, itemIndex }
  SESSION_STOP       { sessionId, reason }
```

---

### 3.6 Platform-Specific Runtime Notes

#### Tizen 4 (SBB) — AVPlay

```javascript
webapis.avplay.prepareAsync(onSuccess, onError)  // trigger on SESSION_CONFIG receipt
webapis.avplay.play()                             // trigger at targetStartAt
webapis.avplay.getCurrentTime()                   // ms — report in PLAYHEAD_REPORT
webapis.avplay.seekTo(ms)                         // drift > 250ms
webapis.avplay.setSpeed(rate)                     // discrete only: 0.5, 1.0, 2.0 — NOT used for drift
```

- `setSpeed()` is discrete — **cannot do fine ±5% nudge**. Use seek-only drift correction.
- HLS seeks snap to segment boundaries — prefer local file:// paths for tight sync.
- `prepareAsync` can take 2–5s for network streams — coordinator should set `targetStartAt` buffer to at least **7000ms** for groups containing Tizen 4 devices.

#### webOS / Android WebView / Windows — HTML5 Video

```javascript
video.load()                              // trigger on SESSION_CONFIG receipt
video.play()                              // trigger at targetStartAt
video.currentTime * 1000                  // ms position
video.currentTime = expectedMs / 1000     // seek correction
video.playbackRate = 1.05 / 0.95          // fine rate nudge for small drift
```

---

### 3.7 Expected Accuracy

| Approach | Tizen 4 (SBB) | webOS/HTML5 | Windows |
|---|---|---|---|
| Scheduled start only | ~200–500ms | ~100–300ms | ~50–150ms |
| + seek correction | ~100–200ms | ~50–100ms | ~20–50ms |
| + rate nudge + seek | Not possible (discrete) | ~20–50ms | ~10–30ms |

For signage video walls, **100–200ms is generally acceptable**. For pixel-wall-level sync (<30ms), hardware PTP/genlock or single-stream WebRTC delivery would be needed.

---

### 3.8 Asset Identity & Cache Validation

To safely skip downloads on already-cached devices:

```
Required for reuse:
  - file exists at expected local path
  - version matches current SyncPlaylistItem.contentVersion
  - file size or SHA-256 checksum matches manifest value
  - file is openable by the player
```

Deterministic local path: `sync-{contentId}.{ext}` (already implemented in tizen player).

---

### 3.9 What Needs to Be Built

Legend: ✅ already exists in codebase · ⚠️ partially exists, needs extension · ❌ not yet built

#### Database migrations
- ✅ `sync_groups` table (`packages/db/src/schema/telemetry.ts`)
- ✅ `sync_group_members` table with `tileCol`/`tileRow` (same file)
- ❌ `sync_playlists` table (new — separate from regular `playlists`)
- ❌ `sync_playlist_items` table
- ⚠️ `sync_groups`: add `syncPlaylistId`, `mode` columns
- ⚠️ `sync_group_members`: add `leaderPriority` column
- ⚠️ `devices`: add `publishedSyncGroupId` FK column (alongside existing `publishedContentId`, `publishedPlaylistId`, `publishedScheduleId`)
- ⚠️ `schedule_slots`: add `syncGroupId` FK + `syncPlaylistId` FK columns for sync scheduling

#### Cloud API / backend
- ❌ `SyncPlaylist` CRUD routes (`GET/POST/PATCH/DELETE /sync-playlists`)
- ⚠️ `SyncGroup` CRUD routes — DB table exists, but no routes exist yet (`GET/POST/PATCH/DELETE /sync-groups`)
- ❌ `POST /sync-groups/:id/members` — add device to group
- ❌ `DELETE /sync-groups/:id/members/:deviceId` — remove device from group
- ⚠️ `POST /devices/publish` — exists but `resourceType` only supports `'content' | 'playlist' | 'schedule'`; add `'sync-group'`
- ❌ Auto-detect group `mode` (`native-samsung` vs `custom-mixed`) from assigned device platforms on create/member change

#### WebSocket handlers (apps/api/src/services/ws.ts)
- ⚠️ `SYNC_PLAY` message type exists but all actions are stubs/no-ops
- ❌ Handle incoming `READINESS_UPDATE` from devices
- ❌ Handle incoming `LEADER_HEARTBEAT` from devices
- ❌ Handle incoming `PLAYHEAD_REPORT` from devices
- ❌ Send `SESSION_CONFIG` on group assignment
- ❌ Send `START_AT` once readiness barrier is met
- ❌ Fan out `PLAYHEAD_REF` every 2s from leader reports
- ❌ Send `LEADER_CHANGED` / `LEADER_TAKEOVER` on failover
- ❌ Send `SESSION_STOP`

#### Node.js local coordinator service (Mode 2 only — new service)
- ❌ WebSocket server
- ❌ Group session state machine
- ❌ Start barrier logic (wait for all online screens)
- ❌ Leader heartbeat monitoring and failover
- ❌ `PLAYHEAD_REF` fan-out from leader reports
- ❌ LAN-only mode (no cloud dependency at runtime)
- ❌ Coordinator discovery (static config pushed from backend; optionally mDNS)

#### Tizen 4 (SBB) player (apps/tizen-sbb/js/player.js)
- ⚠️ `handleSyncPlayCommand()` exists but logs "legacy orchestration disabled" — all cases are no-ops
- ❌ Fix `isSyncplayAvailable()` — add `b2bapis.b2bsyncplay` check (bug: always returns false on Tizen 4)
- ❌ Mode 1: detect `b2bapis.b2bsyncplay`, call `makeSyncPlayList` / `startSyncPlay` with positional args
- ❌ Mode 2: handle `SESSION_CONFIG` → begin prebuffer
- ❌ Mode 2: report `READINESS_UPDATE` with per-gate status
- ❌ Mode 2: handle `START_AT` → `waitForPreciseSyncedTime` → `play()`
- ❌ Mode 2: handle `PLAYHEAD_REF` → seek correction when drift >250ms
- ❌ Mode 2: `LEADER_HEARTBEAT` emit if elected leader

#### Non-Samsung clients — Mode 2 only (webOS / Android / Windows)
- ❌ Sync agent: WebSocket client + HTML5 video control + clock sync
- ❌ Same protocol as above, with `video.playbackRate` for fine drift correction

#### Portal / frontend (apps/ds/src)
- ✅ `DevicePickerModal` — already supports multi-select, reuse as-is for adding screens to groups
- ✅ `ContentPickerModal` — already supports playlist-only filter, reuse for Sync Playlist picker
- ✅ Publish pattern (`POST /devices/publish` from PlaylistPage) — extend for sync groups
- ✅ Device detail already shows `publishedTarget` badge — extend to show `sync-group` type
- ❌ Sidebar: add collapsible Sync section (Sync Playlists + Sync Groups)
- ❌ Route + page: `/workspaces/:wsId/sync-playlists` — Sync Playlists list
- ❌ Route + page: `/workspaces/:wsId/sync-playlists/:id` — Sync Playlist editor with per-item cache badge
- ❌ Route + page: `/workspaces/:wsId/sync-groups` — Sync Groups list with status pills
- ❌ Route + page: `/workspaces/:wsId/sync-groups/:id` — Sync Group detail with screens list + live status panel
- ❌ Devices page: mixed render — Sync Group card for grouped devices, normal card for ungrouped
- ❌ Device detail: read-only Sync section (group name, status, content ready)
- ❌ Publish flow: screen picker that resolves to a Sync Group (create inline if none exists)
- ❌ Publish flow on Devices page: SyncPlay option that surfaces available groups
- ❌ Schedule page: allow Sync Group as schedule target; show Sync Playlist picker for that target
- ❌ Image-in-Samsung-group warning in Sync Playlist editor
- ❌ Empty and error/degraded states for all new Sync pages (see Section 6)

---

## 4. Mode 1 — Native Samsung SyncPlay (Deferred)

> Implementation deferred. Design is documented here for reference.

### When to use

Only when **all** of these conditions are met:
- All devices are Samsung B2B LFD
- All devices run Tizen 6.5 or later
- All devices are on the same LAN
- App is signed with Partner-level certificate

### Call sequence

```javascript
// 1. All devices download content to identical local paths first
// 2. Construct playlist
webapis.syncplay.createPlaylist([
  { path: "file:///shared/sync-abc123.mp4", duration: 30 },
  { path: "file:///shared/sync-def456.mp4", duration: 15 }
], onsuccess, onerror)

// 3. Start — firmware auto-selects leader and coordinates
webapis.syncplay.start({
  rectX: 0, rectY: 0,
  rectWidth: 3840, rectHeight: 2160,
  groupID: 55,    // 16-bit int, same on all devices in group
  rotate: "OFF"
}, onlistener)

// 4. Listener receives: SYNC_PLAY_START_DONE, SYNC_PLAY_STOP_DONE, SYNC_PLAY_FINISH_DONE

// 5. Stop
webapis.syncplay.stop(onlistener)

// 6. Clear
webapis.syncplay.removePlaylist(onsuccess, onerror)
```

### Constraints

| Constraint | Detail |
|---|---|
| Tizen 6.5+ only (`webapis.syncplay`) | Cannot be used on Tizen 4 via this namespace |
| Tizen 4 SSSP (`b2bapis.b2bsyncplay`) | Functionally equivalent — needs hardware validation |
| Cross-backend grouping | Tizen 4 `b2bapis.b2bsyncplay` + Tizen 6.5 `webapis.syncplay` can share a groupID — same firmware multicast protocol underneath |
| Samsung B2B only | webOS, Android, Windows not supported by either API |
| Partner certificate required | `webapis.syncplay`: declare in config.xml; `b2bapis.b2bsyncplay`: covered by b2bapis.js privilege |
| Same LAN required | Firmware multicast — no WAN support |
| Video only | Image sync has known limitations |
| Identical file paths | All devices must resolve the same path for the same content |
| `groupID` 16-bit | Range 0–65535 — derived deterministically from group/folder ID |
| No custom leader exposure | Firmware selects leader internally, not configurable |
| No per-device readiness API | No API to query if all devices are ready before start |

### Currently implemented (tizen non-SBB player)

- `prepareSyncPlaylistNative()` → `createPlaylist()`
- `startSyncPlayNative()` → `start({ ..., groupID })`
- `groupID` derived from `folderId` via deterministic hash
- content uses `sync-${contentId}.${ext}` deterministic naming
- triggered by server via `{ type: "SYNC_PLAY", action: "START_SYNCPLAY" }` WebSocket message

---

## 5. Mode Selection Rule

All Samsung B2B devices — Tizen 4 SSSP (`b2bapis.b2bsyncplay`) and Tizen 6.5+ (`webapis.syncplay`) — are treated as a single native sync tier. They share the same underlying firmware sync mechanism and use the same `groupID`. The player picks the correct API namespace automatically at runtime.

```
All screens in group are Samsung B2B (any Tizen version, SSSP or 6.5+), same LAN?
  └─ YES → Mode 1: native-samsung
             Each device uses whichever API is available:
               Tizen 4 SSSP  → b2bapis.b2bsyncplay
               Tizen 6.5+    → webapis.syncplay
             Same groupID, same LAN → firmware handles synchronisation

  └─ NO  → Mode 2: custom-mixed
             Any non-Samsung device present (webOS, Android, Windows)
             → entire group uses app-layer sync
```

**Auto-detection logic (player side):**
```javascript
if (webapis?.syncplay?.start)        → use webapis.syncplay     (Tizen 6.5+)
else if (b2bapis?.b2bsyncplay?.startSyncPlay) → use b2bapis.b2bsyncplay (Tizen 4 SSSP)
else                                  → fall back to Mode 2 app-layer sync
```

**This is transparent to the user.** They never choose a mode — the system determines it from the assigned screens' platform metadata.

#### `groupID` derivation for Mode 1

The Samsung firmware sync API requires a 16-bit integer `groupID` (0–65535) that must be identical on all devices in the group at runtime. For the new named `SyncGroup` entity, the server derives this deterministically:

```
groupID = crc16(syncGroup.id) % 65536
```

This is pushed to devices as part of `SESSION_CONFIG`. Collision probability within a workspace is low but should be checked on group creation — if a collision is detected, increment by 1 and retry. The existing tizen player already uses a similar approach from `folderId`.

---

## 6. Portal UI/UX Design

### Design principle

**Keep it simple.** The user has two jobs:
1. Build a sync playlist
2. Create a sync group, add screens, assign the playlist

Everything else — mode detection, leader selection, sync API choice, download orchestration, start barrier, drift correction — is automatic and invisible.

---

### 6.1 Navigation additions

Two new sidebar entries under each workspace:

```
Devices
Content
Playlists
Schedules
Sync              ← new section header
  Sync Playlists
  Sync Groups
Canvas
Tags
Analytics
```

Grouped under a collapsible **Sync** section to keep the sidebar clean.

---

### 6.2 Sync Playlists page  `/workspaces/:wsId/sync-playlists`

Same card-grid layout as the existing Playlists page. Familiar, no new patterns to learn.

**Each card shows:**
- Playlist name
- Item count + total duration
- Thumbnail of first item
- Assigned groups count badge (e.g. "Used in 2 groups")

**Actions:**
- `+ New Sync Playlist` button (top right)
- Click card → open Sync Playlist Editor
- `Publish` button on the card, matching the current playlist/content/schedule publish action style
- `⋮` context menu: Edit, Duplicate, Delete

#### How publishing works from a Sync Playlist

- Click `Publish` on any Sync Playlist card or in the editor
- A screen picker opens — the same one used everywhere else in the portal
- Select the screens you want to sync together
- If those screens already belong to a Sync Group, the system will show it as the target
- If more than one matching group exists, pick the one you want
- If no group exists yet, you'll be offered a quick `Create Sync Group` step right there — no need to leave the publish flow
- After confirming, you land on the Sync Group page and the screens start downloading content automatically

#### Sync Playlist Editor  `/workspaces/:wsId/sync-playlists/:id`

Same layout as existing Playlist Editor — drag-to-reorder items, set per-item duration.

**Only difference from regular playlists:**
- Each item shows a small cache status icon (greyed = not yet on devices, green = all assigned screens have it)
- No loop toggle — looping is handled automatically by the sync session

No other new fields. Nothing technical exposed.

#### Scheduling a Sync Playlist

Sync Playlists can also be assigned from the existing Schedules page so you can set them to run at specific times.

- For normal standalone device schedules, nothing changes — existing behavior is untouched
- When scheduling for a Sync Group, the picker shows Sync Playlists as available options
- A scheduled Sync Playlist always targets a Sync Group — it never pins playback on individual screens independently

---

### 6.3 Sync Groups page  `/workspaces/:wsId/sync-groups`

Card layout.

**Each card shows:**
- Group name
- Assigned playlist name (or "No playlist" if unassigned)
- Screen count badge (e.g. "4 screens")
- Status pill — auto-coloured:
  - `Idle` (grey) — no active session
  - `Preparing` (blue) — assets downloading
  - `Ready` (teal) — all screens ready, waiting to start
  - `Playing` (green) — actively synced
  - `Degraded` (amber) — playing but one or more screens missing

**Actions:**
- `+ New Sync Group` button
- Click card → Sync Group Detail
- `Publish` button on the card, using the same placement and visual treatment as current resource cards
- `⋮` context menu: Edit, Delete

Clicking `Publish` on a Sync Group opens the sync playlist picker — same visual pattern as the rest of the portal. Select the playlist you want the group to play and confirm. Screens start preparing immediately.

---

### 6.4 Sync Group Detail  `/workspaces/:wsId/sync-groups/:id`

This is the only page with any configuration, and it is kept minimal.

#### Top section — setup (two fields only)

```
┌─────────────────────────────────────────────────────────────┐
│  Group Name     [ Lobby Video Wall                        ]  │
│  Sync Playlist  [ ▼  Lobby Brand Loop                    ]  │
└─────────────────────────────────────────────────────────────┘
```

That is the full setup. The only user inputs are:
- Group name
- Sync playlist
- Screens to include

No mode picker, no start policy, no leader priority knobs, no coordinator field.

Recommended defaults:
- Auto-suggest the group name from context
  - from playlist-first: `<playlist name> Group`
  - from device-first: `<location or first device name> Group`
- After save, always land on the Sync Group Detail page so the user immediately sees preparation state

#### Screens section — add/remove only

```
Screens in this group
┌──────────────────────────────────────────────────────┐
│  Lobby Left     Samsung SBB   ● Online    [Remove]   │
│  Lobby Right    Samsung SBB   ● Online    [Remove]   │
│  Hallway A      Samsung SBB   ○ Offline   [Remove]   │
└──────────────────────────────────────────────────────┘
[+ Add Screens]
```

- `+ Add Screens` opens a device picker modal (shows only devices in this workspace)
- The picker should reuse the existing device picker pattern already used in the portal: same modal layout, same tabs, same search / sort / hide-offline controls, same card selection behaviour
- Platform type shown as informational only — user doesn't act on it
- No drag-to-reorder, no leader priority column — system assigns leader automatically

#### Status section — live, read-only

Shown below the screens list. Only visible when a session is active.

```
Sync Status
  ● Playing  —  Lobby Left is leading  —  Started 4 min ago

  Lobby Left    ████████████ 100%   ✓ synced
  Lobby Right   ████████████ 100%   ✓ synced
  Hallway A     ███████░░░░░  62%   Downloading…

  [Stop Sync]
```

- Progress bar per device during `Preparing` state
- Simple ✓ synced / ⚠ drifting indicator during `Playing` state
- No ms drift numbers — too technical for this view
- Single `Stop Sync` action button; `Start Sync` appears when status is `Ready`

System automatically starts playback once all assigned online screens are ready. Manual start remains optional, but the default experience is hands-off.

---

### 6.5 Device Detail page — Sync section

Small read-only addition to the existing Device Detail page:

```
Sync
  Group          Lobby Video Wall
  Status         Playing
  Content ready  ✓ All items cached
```

No action needed from here — just visibility.

#### Stop Sync vs Remove from Group

These are two different actions and must be clearly separated in the UI:

| Action | What it does |
|---|---|
| **Stop Sync** | Ends the current playback session. The group, its screens, and its playlist assignment all remain. Screens resume normal scheduled content. The group can be started again. |
| **Remove from Group** | Removes a screen from the Sync Group entirely. The screen is no longer a member. Cached sync content on that device can optionally be cleared. |
| **Delete Group** | Removes the Sync Group. All screen assignments are removed. Cached content is not automatically cleared from devices. |

There is no "Unpublish" for a Sync Group the way there is for a normal content/playlist override. Sync Groups are persistent assignments, not device overrides. To stop a sync group from running, use Stop Sync. To disassociate a screen, use Remove.

### 6.5A Devices page — group presentation

On the main Devices page, Sync Groups should also be visible directly in the card grid so grouped playback is understandable without opening each device one by one.

Rendering rules on the Devices page:
- Devices that belong to a Sync Group should appear under a **group card** in the main card grid
- Devices that do not belong to any Sync Group should continue to appear as the current normal standalone device cards
- The page therefore becomes a mixed view: group cards for grouped context, normal device cards for ungrouped context

For grouped devices:
- Show a **group card** instead of separate top-level standalone cards for those same devices in the main Devices view
- The badge should read `Sync Group`, not `Device`
- The card title should be the group name
- Inside the card, list member devices as small sub-cards or rows
- Each member entry should show:
  - device name
  - online / offline state
  - current sync readiness or playback state
- The group card should also show the assigned Sync Playlist and overall group state (`Preparing`, `Ready`, `Playing`, `Degraded`)
- Each member device inside the group card should remain clickable so the user can still drill into the individual device detail page
- The group card itself should also be clickable to open the Sync Group Detail page

Example:

```
┌────────────────────────────────────────────────────────────┐
│ Sync Group   Lobby Video Wall                Playing      │
│ Playlist     Lobby Brand Loop                               │
│                                                            │
│  [Lobby Left     ● Online   ✓ Synced]                      │
│  [Lobby Right    ● Online   ✓ Synced]                      │
│  [Hallway A      ○ Offline  Downloading]                   │
└────────────────────────────────────────────────────────────┘
```

This is better than repeating isolated device cards because Sync playback is a group concept, not a per-device publishing concept.

Summary of the Devices page behavior:
- Grouped devices → shown as a Sync Group card in the main Devices view
- Individual grouped devices → still accessible from inside that group card
- Ungrouped devices → shown as normal device cards

---

### 6.5B Empty states

**Sync Playlists page — empty:**
```
  No Sync Playlists yet
  Create a sync playlist to get started.
  [+ New Sync Playlist]
```

**Sync Groups page — empty:**
```
  No Sync Groups yet
  A Sync Group lets multiple screens play content in perfect sync.
  [+ New Sync Group]
```

**Sync Group Detail — no playlist assigned:**
```
  No playlist assigned
  Pick a Sync Playlist to start synced playback on this group.
  [Assign Playlist]
```

**Sync Group Detail — no screens:**
```
  No screens in this group
  Add screens so they can play together in sync.
  [+ Add Screens]
```

---

### 6.5C Error and degraded states

**Download failed on a screen:**
- Show the screen row in amber with label `Download failed`
- Group stays in `Preparing` and retries automatically
- If a screen cannot download after retry, the portal shows a `⚠ 1 screen failed to download` banner on the group detail page
- System waits for that screen before starting

**Screen goes offline during Preparing:**
- Row shows `○ Offline — waiting`
- Group waits until the screen comes back online or is removed from the group

**Screen drops out during Playing:**
- Group card status changes from `Playing` to `Degraded`
- The screen row inside the group card shows `○ Offline`
- Remaining screens continue playing in sync
- When the screen comes back online, it rejoins automatically and catches up

**All screens offline:**
- Group status → `Idle`
- A `⚠ All screens offline` banner is shown on the group detail page

**Image items on an all-Samsung group:**
- Show an inline warning in the Sync Playlist editor:
  > ⚠ This playlist contains images. Samsung screens only support video in sync mode — images will be skipped during sync playback.

---

### 6.6 User workflow (four entry paths, all simple)

**Path A — Start from a Sync Playlist ("I know what I want to play")**
```
1. Sync Playlists → + New → add content → Save
2. Click Publish on the playlist card or in the editor
3. Pick the screens to include — same screen picker used elsewhere in the portal
4. If those screens are already in a Sync Group, choose that group
5. If not, create a new Sync Group right there (just give it a name)
   → You land on the Sync Group page
   → Screens start downloading content automatically
```

**Path B — Start from Sync Groups ("I want to set up a group")**
```
1. Sync Groups → + New
2. Give the group a name
3. Add screens
4. Pick a Sync Playlist
5. Save
   → You land on the group page
   → Screens start downloading content automatically
```

**Path C — Start from Devices ("I know which screens I want")**
```
1. Devices → select one or more devices
2. Click Publish
3. Choose SyncPlay from the resource type picker
4. If those devices are already in a Sync Group, choose it
5. If not, create a new group (just give it a name)
6. Pick a Sync Playlist from the same picker used elsewhere in the portal
7. Save
   → You land on the Sync Group page
   → Screens start downloading content automatically
```

**Path D — Update what an existing group is playing**
```
1. Sync Groups → open the group
2. Click Publish
3. Pick a different Sync Playlist
4. Confirm
   → Screens switch over to the new playlist
```

**Path E — Schedule a Sync Group to run at a specific time**
```
1. Schedules → + New or edit an existing schedule
2. Set your time / recurrence as normal
3. For the target, pick a Sync Group instead of individual devices
4. The playlist picker will show available Sync Playlists for that group
5. Select and save
   → At the scheduled time, all screens in the group prepare and play together automatically
```

Design rules for all paths:
- All paths reuse the same screen picker and playlist picker already in the portal
- The `Publish` button, placement, and interaction style are the same as everywhere else in the portal
- The user only ever decides three things: group name, playlist, and which screens
- The system handles everything else automatically — no technical choices required

#### When to use normal Publish vs Sync Publish

| | Normal Publish | Sync Publish |
|---|---|---|
| **What you're publishing** | Content, Playlist, or Schedule | Sync Playlist |
| **Target** | Individual devices | A Sync Group |
| **Screens play** | Independently — each on its own | Together — all timed to match |
| **Requires a group?** | No | Yes (created inline if needed) |

If you want screens to play independently → use normal Publish.
If you want screens to play in perfect sync → use Sync Publish through a Sync Group.

---

### 6.7 What the system auto-decides (invisible to user)

| Decision | Auto logic |
|---|---|
| Sync mode | All Samsung B2B → firmware sync (Mode 1); any non-Samsung present → app-layer sync (Mode 2) |
| API backend | Tizen 6.5+ → `webapis.syncplay`; Tizen 4 SSSP → `b2bapis.b2bsyncplay` |
| `groupID` | Derived from `SyncGroup.id` via CRC-16 — same value pushed to all devices |
| Leader | Server picks first online high-uptime device; rest are automatic backup candidates |
| Who can start | All assigned online screens must be ready; screens offline at provision time are excluded |
| Start timing buffer | 7 seconds if any Tizen 4 device is in the group; 5 seconds otherwise |
| Drift correction | Samsung firmware handles it internally; other screens use seek or playback rate nudge |
| Coordinator | Non-Samsung groups only: always uses cloud — no manual configuration needed |

---

---

## 7. References

| Resource | URL |
|---|---|
| Samsung SyncPlay API Reference | https://developer.samsung.com/smarttv/develop/api-references/samsung-product-api-references/syncplay-api.html?device=signage |
| SyncPlay API Migration Guide (SSSP → webapis) | https://developer.samsung.com/smarttv/develop/migrating-applications/syncplay-api-usage.html?device=signage |
| Samsung SyncPlay Sample App | https://github.com/SamsungDForum/SyncPlaySynchronisedContentPlayback |
| Samsung AVPlay API | https://developer.samsung.com/smarttv/develop/api-references/samsung-product-api-references/avplay-api.html |
