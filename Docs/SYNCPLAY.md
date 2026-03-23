# SyncPlay — Research & Architecture Guide

## Overview

Two distinct sync modes are defined. They are implemented separately and never mixed in the same active group.

| Mode | Scope | Status |
|---|---|---|
| **Mode 1 — Native Samsung SyncPlay** | Samsung B2B LFD, Tizen 6.5+ only, same LAN | Deferred — implement later |
| **Mode 2 — Custom Mixed-Platform Sync** | All platforms: Tizen 4, webOS, Android, Windows | Active design target |

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

### Open question: cross-backend groups

If a sync group contains both Tizen 4 SBB devices (using `b2bapis.b2bsyncplay`) and Tizen 6.5+ devices (using `webapis.syncplay`), can they sync together?

- Both use the same underlying Samsung firmware sync mechanism (same LAN, same `groupID`) — they likely communicate at the firmware level using the same protocol.
- **This needs to be validated on actual hardware.** It is not documented by Samsung either way.
- If cross-backend groups work → SBB can participate in Samsung native sync with Tizen 6.5+ peers with the same `groupID`.
- If they do not → SBB-only groups use `b2bapis.b2bsyncplay`; mixed groups fall back to Mode 2 (custom app-layer sync).

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

Covers all platforms that cannot use Samsung native SyncPlay:
- Tizen 4 (SBB) — AVPlay
- Tizen 6.5+ (when group contains mixed platforms) — AVPlay only, not native SyncPlay
- webOS (LG) — HTML5 `<video>`
- Android — WebView HTML5 or ExoPlayer
- Windows — Electron / Chromium HTML5

**Rule:** If any device in a group is not Samsung B2B Tizen 6.5+, the entire group uses Mode 2. Native Samsung SyncPlay cannot be mixed with app-layer timing in the same group.

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

```typescript
{
  id: string
  name: string
  workspaceId: string
  syncPlaylistId: string
  mode: 'native-samsung' | 'custom-mixed'   // auto-determined from device platforms
  leaderPriority: string[]   // ordered device IDs — server assigns on group creation
  coordinatorAddress: string // LAN address of Node.js coordinator
  startPolicy: 'all-ready' | 'quorum-80'
  createdAt: string
  updatedAt: string
}
```

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
  | 'DEGRADED'         // quorum lost, some devices missing
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

9. Coordinator evaluates start barrier:
   - `all-ready`: waits for all assigned devices to report `READY`
   - `quorum-80`: starts when ≥80% of assigned devices are ready (admin-configurable)
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
  SESSION_CONFIG     { sessionId, generation, groupId, playlistId, leaderId, leaderPriority, startPolicy }
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

#### Cloud API / backend
- [ ] `SyncPlaylist` CRUD (separate from regular playlists)
- [ ] `SyncGroup` CRUD with screen assignment
- [ ] Auto-assign `leaderPriority` on group creation
- [ ] Push `SESSION_CONFIG` to devices on group assignment
- [ ] Track per-device readiness state from reports
- [ ] `startPolicy` configuration per group

#### Node.js local coordinator service
- [ ] WebSocket server
- [ ] Group session state machine
- [ ] Start barrier logic (`all-ready` or `quorum`)
- [ ] Leader heartbeat monitoring and failover
- [ ] `PLAYHEAD_REF` fan-out from leader reports
- [ ] LAN-only mode (no cloud dependency at runtime)
- [ ] Coordinator discovery (static config pushed from backend; optionally mDNS)

#### Tizen 4 (SBB) player
- [ ] Handle `SESSION_CONFIG` → begin prebuffer
- [ ] Report `READINESS_UPDATE` with per-gate status
- [ ] Handle `START_AT` → `waitForPreciseSyncedTime` → `play()`
- [ ] Handle `PLAYHEAD_REF` → seek correction when drift >250ms
- [ ] `LEADER_HEARTBEAT` emit if elected leader

#### Non-Samsung clients (webOS / Android / Windows)
- [ ] Sync agent: WebSocket client + HTML5 video control + clock sync
- [ ] Same protocol as above, with `video.playbackRate` for fine drift correction

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
| Cross-backend grouping | Can Tizen 4 B2BSyncplay + Tizen 6.5 webapis.syncplay share a groupID? Unknown — test required |
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

#### Publish behavior must match the current portal flow

SyncPlay should follow the same publish convention the portal already uses today:
- Publish is initiated from the resource card or detail page
- The primary action label is `Publish`
- After clicking `Publish`, the user gets a picker modal to choose the publish target
- The system then applies the assignment in one step

For Sync Playlists specifically:
- `Publish` opens the existing picker flow used by the portal today
- The user first selects target screens using the existing device picker pattern
- Sync playback is never published as a plain standalone device override
- After device selection, the flow resolves to a Sync Group target:
  - if exactly one matching Sync Group already exists for the selected screens, use that group
  - if multiple matching Sync Groups exist, let the user choose one
  - if no matching Sync Group exists, offer `Create Sync Group` inline with this playlist preselected
- Final result: the playlist is assigned to a Sync Group, not directly to ad hoc standalone screens

#### Sync Playlist Editor  `/workspaces/:wsId/sync-playlists/:id`

Same layout as existing Playlist Editor — drag-to-reorder items, set per-item duration.

**Only difference from regular playlists:**
- Each item shows a small cache status icon (greyed = not yet on devices, green = all assigned screens have it)
- No loop toggle — looping is handled automatically by the sync session

No other new fields. Nothing technical exposed.

#### Scheduling a Sync Playlist

Sync Playlists must also be available from the existing Schedules flow when the user is scheduling for a Sync Group.

Rules:
- If the user is creating a normal schedule for standalone devices, the existing content / playlist / schedule behavior stays unchanged
- If the user is scheduling for a Sync Group, the picker must allow selecting a Sync Playlist
- A Sync Playlist scheduled through Schedules still resolves to a Sync Group target, never to independent device overrides
- The scheduling UX should reuse the current picker pattern and only expose Sync Playlists when the target context is a Sync Group

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

For Sync Groups:
- `Publish` means "publish this synchronised experience"
- Clicking `Publish` should open a target picker consistent with the current portal publish flow
- Device selection is only used to identify or create the target Sync Group
- Publish never bypasses the Sync Group and pins a Sync Playlist directly to a device outside group context

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

### 6.6 User workflow (four entry paths, all simple)

**Path A — Playlist first**
```
1. Sync Playlists → + New → add content → Save
2. From the playlist page or playlist editor, click `Publish`
3. Show the existing device picker modal pattern so the user selects screens the same way they already do elsewhere in the portal
4. Resolve the selected screens to a Sync Group
5. If a matching group exists, show it as the publish target
6. If no group exists yet, offer `Create Sync Group` inline with this playlist preselected
7. Prompt only for group name if needed, then save
  → New or existing group is now assigned this playlist
  → User lands on the group detail page
  → System starts preparing automatically
```

**Path B — Group first**
```
1. Sync Groups → + New → name it → add screens → choose sync playlist → Save
2. User lands on the group detail page
  → Preparation begins immediately
```

**Path C — Device first**
```
1. Devices → select one or more devices, or open a device detail page
2. Click `Publish`
3. Show the existing resource picker pattern already used in the portal
4. If the user chooses SyncPlay, resolve or create the Sync Group for those devices
5. Show the available Sync Playlists for that group using the existing picker pattern
6. If no Sync Group exists yet, offer `Create Sync Group` with those devices preselected
7. User confirms group name if needed, picks the sync playlist, and saves
  → User lands on the group detail page
  → Group assignment is created and preparation starts
```

**Path D — Existing Sync Group**
```
1. Sync Groups → open an existing group
2. Click `Publish`
3. Show the sync playlist picker using the current picker pattern
4. Select the sync playlist and confirm
  → Playlist is assigned to that group
  → Preparation or playback update begins immediately
```

**Path E — Schedule first**
```
1. Schedules → + New or edit existing schedule
2. Choose publish target
3. If the target is standalone devices, keep the current scheduling flow unchanged
4. If the target is a Sync Group, show Sync Playlists in the picker
5. Select the Sync Playlist and save the schedule
  → The schedule is attached to the Sync Group
  → At runtime, the group prepares and starts in sync when the schedule triggers
```

Rules for these entry points:
- Playlist-first must feel like "I already know the content, now choose the screens"
- Device-first must feel like "I already know the screens, now choose the content"
- Schedule-first must feel like "I already know when this group should run, now choose the synced content"
- Both flows must reuse the current picker UX instead of introducing a new Sync-only picker pattern
- SyncPlay should reuse the current `Publish` wording, button placement, and picker-first interaction model
- Sync playback always resolves to a Sync Group before assignment is saved
- A Sync Playlist is never published directly to a device outside Sync Group context
- When a device selection belongs to a Sync Group, publish should surface the available SyncPlay targets for that group rather than making the user navigate elsewhere
- User still only decides: name, playlist, screens

In all cases: **no mode selection, no leader config, no start policy, no coordinator URL** — the system handles all of that behind the scenes.

#### Practical publish rule

To stay consistent with the current product:
- Standard resources (content, playlist, schedule) publish to devices
- Sync resources publish through the same `Publish` action, but the resolved target is always a Sync Group
- If the destination is a Sync Group, the publish UI should show available Sync Playlists for that group
- If the destination is not in a Sync Group yet, the UI should offer group creation inline instead of forcing the user to leave the publish flow
- If the user is in Schedules and the selected target is a Sync Group, the picker should include Sync Playlists as valid scheduled resources

#### Strict separation between normal publish and Sync publish

- Normal publish:
  - Content / Playlist / Schedule
  - Target = device override
  - Works without any Sync Group

- Normal schedule:
  - Content / Playlist assigned on a schedule
  - Target = device override or existing non-sync scheduling target
  - No Sync Group required

- Sync publish:
  - Sync Playlist
  - Target = Sync Group
  - Requires a Sync Group, either existing or created inline during publish
  - Never creates a plain standalone device override

- Sync schedule:
  - Sync Playlist assigned on a schedule
  - Target = Sync Group
  - Requires a Sync Group
  - Never schedules independent per-device overrides for a synced experience

This keeps the product model unambiguous:
- If the user wants independent playback on screens, use normal publish
- If the user wants synchronised playback across screens, use Sync Group + Sync Playlist

---

### 6.7 What the system auto-decides (invisible to user)

| Decision | Auto logic |
|---|---|
| Sync mode | All Samsung B2B → native firmware sync; any non-Samsung → app-layer sync |
| API backend | Tizen 6.5+ → `webapis.syncplay`; Tizen 4 SSSP → `b2bapis.b2bsyncplay` |
| Leader | Server picks first online high-uptime device; rest are auto backup candidates |
| Start barrier | All assigned online screens must be ready (screens offline at provision time are excluded) |
| `targetStartAt` | Coordinator adds buffer based on slowest device type in group (7s for Tizen 4, 5s otherwise) |
| Drift correction | Samsung native → firmware handles; app-layer → seek or rate nudge per platform |
| Coordinator | Mode 2 only: cloud server by default; local Node.js coordinator if configured in workspace settings |

---

### 6.8 Advanced / workspace settings (Mode 2 only, optional, hidden by default)

Advanced settings exist only for **Mode 2 custom sync**. They do not apply to Samsung native firmware SyncPlay.

For teams that need them, accessible under Workspace Settings → Sync:

```
Workspace Settings → Sync (advanced)
  Local Coordinator    [ws://192.168.1.10:9876]  (blank = use cloud)
  Start policy         ● All screens ready  ○ 80% quorum
  Auto-start           ● On (start as soon as ready)  ○ Manual
```

These are workspace-level defaults for app-layer sync groups only. Not shown on the Sync Group Detail page itself — keeps the everyday view clean.

For Samsung native groups:
- No coordinator setting
- No start policy override
- No advanced user-facing controls
- The firmware API handles synchronisation directly once the group is provisioned

---

## 7. References

| Resource | URL |
|---|---|
| Samsung SyncPlay API Reference | https://developer.samsung.com/smarttv/develop/api-references/samsung-product-api-references/syncplay-api.html?device=signage |
| SyncPlay API Migration Guide (SSSP → webapis) | https://developer.samsung.com/smarttv/develop/migrating-applications/syncplay-api-usage.html?device=signage |
| Samsung SyncPlay Sample App | https://github.com/SamsungDForum/SyncPlaySynchronisedContentPlayback |
| Samsung AVPlay API | https://developer.samsung.com/smarttv/develop/api-references/samsung-product-api-references/avplay-api.html |
