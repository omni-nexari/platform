# CrossOS Sync Engine

**Version**: 1.0 (May 2026)  
**Status**: Production — 4-device validated (Windows + 2× Tizen + Android)

A WebSocket-based frame-accurate group sync protocol that keeps video playback synchronized across heterogeneous devices on a LAN or cloud relay. Sub-50ms inter-device accuracy. Tested across Windows (Electron), Tizen 4/7 (Samsung Smart TV), and Android (WebView).

---

## Table of Contents

1. [Architecture](#1-architecture)
2. [WebSocket Protocol](#2-websocket-protocol)
3. [State Machine](#3-state-machine)
4. [Clock Synchronization](#4-clock-synchronization)
5. [Latency Auto-Calibration](#5-latency-auto-calibration)
6. [Leader Election](#6-leader-election)
7. [Loop Barrier](#7-loop-barrier)
8. [Resync Flow](#8-resync-flow)
9. [SyncConfig Reference](#9-syncconfig-reference)
10. [Timing Constants](#10-timing-constants)
11. [Platform Integration](#11-platform-integration)
12. [Management REST API](#12-management-rest-api)
13. [Database Schema](#13-database-schema)

---

## 1. Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Nexari Platform API                          │
│  ┌──────────────────────────────────┐  ┌───────────────────────┐   │
│  │  /api/v1/sync-relay/ws (WS)      │  │  /api/v1/sync-groups  │   │
│  │  Relay Server (sync-relay.ts)    │  │  Management REST API  │   │
│  │  • Group registry (in-memory)    │  │  • CRUD sync groups   │   │
│  │  • LOOP_READY barrier            │  │  • Manage members     │   │
│  │  • PING/PONG clock server        │  │  • Push manifests     │   │
│  │  • Broadcast relay               │  │  • Live state         │   │
│  └──────────────────────────────────┘  └───────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
         ▲ WS (device JWT via ?token=)                ▲ HTTP (user JWT)
         │                                            │
   ┌─────┴──────────────────────────────────────────┐
   │            Protocol Client  (sync.ts)           │
   │   • Leader election          • Clock offset     │
   │   • LOAD_URL / READY / GO    • Playhead ticks   │
   │   • RESYNC_REQUEST handler   • EWMA drift       │
   └─────────┬──────────────────────────────────────┘
             │  SyncConfig callbacks
   ┌─────────▼──────────────────────────────────────┐
   │            Playback Engine  (engine.ts)         │
   │   • A/B video slot swap      • LOOP_READY emit  │
   │   • schedulePlayAt(epoch)    • getCurrentPos()  │
   │   • play-latency probe       • Canvas wall mode │
   └─────────┬──────────────────────────────────────┘
             │ platform-specific adapters
   ┌─────────▼──────────────────────────────────────┐
   │  Platform Adapters                              │
   │  Windows: sync-coordinator.ts (Electron)        │
   │  Tizen:   player.ts → _startSyncGroupRelay()    │
   │  Android: player-web/src/player.ts              │
   └─────────────────────────────────────────────────┘
```

### Layer responsibilities

| Layer | File(s) | Purpose |
|---|---|---|
| Relay server | `apps/api/src/routes/sync-relay.ts` | Central WS hub. Handles group registration, LOOP_READY barrier, PING/PONG clock source, broadcast relay. |
| Protocol client | `apps/nexari-html5-sync/src/sync.ts` `apps/player-web/src/sync/sync.ts` | Implements leader/follower state machine, clock sync, leader election, resync logic. |
| Playback engine | `apps/nexari-html5-sync/src/engine.ts` | A/B slot video player with frame-precise scheduling and `setOnLoop` callback. |
| Platform adapters | per-app | Wire `SyncConfig` callbacks to local file URLs, player APIs, and hardware. |

---

## 2. WebSocket Protocol

All messages are JSON text frames. Every message has a `type` field. The relay appends `from: deviceId` to messages it forwards.

### Connection

```
ws://192.168.1.17/api/v1/sync-relay/ws?token=<device-JWT>
```

Authentication uses the device JWT issued during pairing, passed as `?token=` because neither browser WebSocket nor Tizen B2B WebApps support custom upgrade headers.

---

### Message Reference

#### `WS_REGISTER` — client → relay

Sent immediately after WS open. Joins a sync group. If another client with the same `deviceId` + `groupId` is already connected, it is evicted (graceful reconnect).

```json
{
  "type": "WS_REGISTER",
  "deviceId": "a658c739-1c52-48f1-b0e7-f823abbb0a75",
  "groupId": "591a7eaf-ca45-4a82-ba63-6cbe069ab68f",
  "ip": "192.168.1.110",
  "playLatencyMs": 85
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `deviceId` | string | yes | Unique device identifier (UUID or platform-specific) |
| `groupId` | string | yes | Sync group UUID from DS |
| `ip` | string | no | LAN IP for peer info display |
| `playLatencyMs` | number | no | Measured play→first-frame latency; used for auto-calibration |

---

#### `PEERS` — relay → all members

Sent to every group member when any device joins or leaves.

```json
{
  "type": "PEERS",
  "groupId": "591a7eaf-...",
  "peers": [
    { "deviceId": "2a949e66-...", "ip": "192.168.1.11", "registeredAt": 1778900000000, "playLatencyMs": 0 },
    { "deviceId": "1ed6367a-...", "ip": "192.168.1.53", "registeredAt": 1778900001000, "playLatencyMs": 30 }
  ],
  "serverTimeMs": 1778900001500
}
```

---

#### `HEARTBEAT_PEERS` — relay → all members (every 5 s)

Lightweight peer-list refresh — only `deviceId` array, no metadata. Keeps follower `expectedPeers` counters fresh.

```json
{
  "type": "HEARTBEAT_PEERS",
  "peers": ["2a949e66-...", "1ed6367a-...", "a658c739-..."]
}
```

---

#### `PING` — client → relay

Clock sync request (mini-NTP). Sent 7 times with 60 ms spacing.

```json
{ "type": "PING", "t1": 1778900001000 }
```

#### `PONG` — relay → client

```json
{ "type": "PONG", "t1": 1778900001000, "t2": 1778900001005 }
```

`t1` = client send timestamp, `t2` = server receipt timestamp.

---

#### `LOAD_URL` — leader → followers (broadcast via relay)

Leader instructs all followers to prebuffer a specific playlist item. Includes `index` (0-based playlist position) so followers on different OSes can load their own local copy without parsing the leader's file path.

```json
{
  "type": "LOAD_URL",
  "url": "file:///C:/Nexari/content/portrait-video.mp4",
  "index": 0
}
```

**Important**: Followers must **not** deduplicate LOAD_URL. The leader re-sends it on every resync (e.g., when a new device joins), and followers must re-prepare and re-send READY each time.

---

#### `READY` — follower → leader (broadcast via relay)

Sent by a follower after `prepareEngine()` resolves. Indicates the device has prebuffered and is waiting for the GO signal.

```json
{ "type": "READY" }
```

The relay appends `from: deviceId` before forwarding. The leader counts READY messages against its `_peers` list.

---

#### `GO` — leader → all (broadcast via relay)

Leader sends GO once it has received READY from all peers and its own engine is ready.

```json
{
  "type": "GO",
  "playAt": 1778900005000,
  "durationMs": 16200
}
```

| Field | Type | Notes |
|---|---|---|
| `playAt` | number | Server epoch (ms) at which all devices must call `play()`. Default: `now + 1500ms`. |
| `durationMs` | number | Video duration. Followers use this for phase monitoring. |

Followers convert to local time via `localPlayAt = playAt - offsetMs + selfLatency`.

---

#### `PLAYHEAD` — any → relay (broadcast to group)

Position heartbeat sent every 600 ms while playing. Used for monitoring and EWMA drift correction. Does not trigger any playback changes.

```json
{
  "type": "PLAYHEAD",
  "serverNow": 1778900008000,
  "posMs": 3200
}
```

---

#### `LOOP_READY` — client → relay (barrier entry)

Sent when the engine has prebuffered at frame 0 and is ready for the next loop. The relay collects LOOP_READY from all connected group members. When all have sent it, the relay releases the barrier with LOOP_GO.

```json
{
  "type": "LOOP_READY",
  "groupId": "591a7eaf-...",
  "deviceId": "a658c739-..."
}
```

---

#### `LOOP_GO` — relay → all members (barrier release)

Relay emits this when every connected group member has sent LOOP_READY. All devices call `schedulePlayAt(playAt)` simultaneously, firing at the same absolute wall-clock moment.

```json
{ "type": "LOOP_GO", "playAt": 1778900021800 }
```

`playAt` = `Date.now() + 800ms` on the relay server. The 800 ms headroom is required for Tizen WebKit to execute `play()` precisely; tighter windows bleed platform first-frame latency into drift.

---

#### `RESYNC_REQUEST` — follower → leader (broadcast via relay)

Sent by a follower that has not received LOAD_URL within 4–8 seconds of joining. Triggers a full leader resync.

```json
{
  "type": "RESYNC_REQUEST",
  "groupId": "591a7eaf-...",
  "deviceId": "ce5e0309-..."
}
```

---

## 3. State Machine

### Leader path

```
init()
  │
  ├─ connect WS → WS_REGISTER
  ├─ measureClock() × 7 samples (PING/PONG)
  ├─ _waitPeers() — poll until expectedPeers joined or 6s timeout
  │       │
  │       └── elect role (lexicographic: highest deviceId = leader)
  │                        OR pre-determined from pinnedLeaderId
  │
  ├─ setRole('leader')
  ├─ fetchPlaylistUrls() → setPlaylist()
  │
  └─ _runLeader()
        │
        ├─ fetchVideoUrl() → LOAD_URL broadcast (with index)
        ├─ await prepareEngine(url)     ← must be awaited, not fire-and-forget
        ├─ _leaderReady = true
        └─ _checkAllReady()
              │
              ├─ [waiting] collect READY from each follower
              └─ [all ready] → GO broadcast (playAt = now + 1500ms)
                               schedulePlay(localPlayAt + selfLatency)
                               _startPhase() [PLAYHEAD ticks every 600ms]
                               _startPeerWatch() [_peerScan every 4s]
```

### Follower path

```
init()
  │
  ├─ connect WS → WS_REGISTER
  ├─ measureClock() × 7 samples
  ├─ _waitPeers() skipped (pinnedLeaderId set) or runs for election
  │
  ├─ setRole('follower')
  ├─ fetchPlaylistUrls() → setPlaylist()
  ├─ _scheduleFollowerResync(4000ms) — safety timer for late-join
  │
  └─ [await LOAD_URL]
        │
        ├─ resolve local URL from index or filename match
        ├─ await prepareEngine(localUrl)
        └─ READY sent
              │
              └─ [await GO]
                    │
                    ├─ localPlayAt = serverPlayAt − offsetMs + selfLatency
                    ├─ schedulePlay(localPlayAt)
                    └─ _startPhase() [PLAYHEAD ticks every 600ms]
```

### Loop cycle (steady state)

```
  Engine reaches EOS (end of segment)
       │
       ├─ setOnLoop callback fires
       ├─ engine prebuffers at frame 0
       └─ LOOP_READY sent to relay
              │
              └─ [relay collects from ALL group members]
                    │
                    └─ LOOP_GO broadcast (playAt = now + 800ms)
                          │
                          └─ all devices: schedulePlay(localPlayAt + selfLatency)
                                          simultaneously
```

---

## 4. Clock Synchronization

### Algorithm (mini-NTP over WebSocket)

1. Send 7 PING messages spaced 60 ms apart
2. For each PONG, compute:
   - `rtt = t3 - t1` (round-trip time, local clock)
   - `offset = t2 + rtt/2 - t3` (estimated clock offset, where `t2` = server receipt time)
3. Sort by RTT ascending; take the `offset` of the **best-RTT sample**
4. Store as `_offsetMs`

```
offset > 0: local clock is BEHIND server  (local + offset ≈ server time)
offset < 0: local clock is AHEAD of server
```

### Usage

```typescript
const serverTime = localTime + _offsetMs;   // _localToServer()
const localTime  = serverTime - _offsetMs;  // _serverToLocal()
```

All `playAt` epochs in GO and LOOP_GO are in **server time**. Followers convert before scheduling:

```typescript
const localPlayAt = _serverToLocal(msg.playAt) + _selfLatency;
```

### Re-measurement schedule

- Immediately after init
- At T+3s (before the first GO countdown)
- At T+10s (after the first loop)
- Every 60s thereafter

Early re-measurements correct the initial QBC clock drift observed in production (~15 s deviation on first boot).

---

## 5. Latency Auto-Calibration

Different hardware has different play→first-frame latencies. Without compensation, faster devices show the first frame before slower ones, causing visible tearing on a video wall.

### Mechanism

1. Each device measures its `playLatencyMs` (play() call → `requestVideoFrameCallback` on Chromium, `timeupdate` on others)
2. Reports it in `WS_REGISTER`
3. The relay broadcasts all values in `PEERS`
4. Each device computes:

```
selfLatency = max(all devices' playLatencyMs) - own playLatencyMs
```

The **slowest device** gets `selfLatency = 0` (it is the reference). **Faster devices** delay their `play()` call by `selfLatency` ms so all first-frames coincide.

### Manual override

`SyncConfig.selfLatency` bypasses auto-calibration entirely. Useful for devices that cannot measure their own latency. Negative values compensate for slow decoders (e.g., Android WebView cold start).

### Static fallback table

For known device profiles when no latency measurement is available:

```typescript
const DEVICE_LATENCY_MS: Record<string, number> = {
  'tizen7.0-mac-28af427a99db': 0,   // QBC — reference
  'tizen4.0-mac-d49dc0aa111b': 30,  // older Tizen — 30ms behind
};
```

---

## 6. Leader Election

### Lexicographic (default)

When `pinnedLeaderId` is not set, all devices wait for `expectedPeers` to join (up to 6 s), then elect:

```
leader = max([...peers, self]) // lexicographic string comparison
```

The device with the highest `deviceId` string becomes leader.

### Pinned leader (production)

The DS manifest includes `leaderPriority[0]` — the DB UUID of the elected leader. Set as `pinnedLeaderId` in `SyncConfig`:

- **Leader**: determined immediately at `init()`, no peer-wait needed
- **Followers**: skip peer-wait entirely; listen directly for `LOAD_URL`

Windows is always pinned leader in the current deployment (`allTizen=false` flag in the Windows sync coordinator).

### Role assignment order

1. `pinnedLeaderId === deviceId` → leader
2. `pinnedLeaderId !== deviceId` → follower  
3. (no pinnedLeaderId) → wait for peers → lexicographic election

---

## 7. Loop Barrier

The barrier pattern ensures all devices begin each loop iteration at the same moment, preventing drift from accumulating across loops.

### Flow

```
Device A (leader)     Device B (follower)   Device C (follower)   Relay
─────────────────     ──────────────────    ──────────────────    ─────
EOS → prebuffer       EOS → prebuffer       EOS → prebuffer
LOOP_READY ─────────────────────────────────────────────────────► collect
                      LOOP_READY ──────────────────────────────► collect
                                            LOOP_READY ─────────► collect
                                                                  all ready:
                                                                  playAt = now+800ms
◄──────────────────── LOOP_GO ───────────────────────────────── broadcast
schedulePlay()        schedulePlay()        schedulePlay()
▼ all devices play at identical wall-clock moment ▼
```

### Relay barrier reset

After broadcasting LOOP_GO, the relay clears the LOOP_READY set for the group. If a device reconnects mid-loop, its LOOP_READY will be counted in the next cycle.

### 800 ms headroom

The relay adds 800 ms to `Date.now()` when computing `playAt` in LOOP_GO. This gives Tizen WebKit enough time to:
1. Receive the WS message
2. Parse JSON
3. Calculate `schedulePlayAt` delay
4. Set the hardware timer

Tighter windows cause first-frame latency to bleed through as inter-device drift.

---

## 8. Resync Flow

Resync fires in two cases:

### 8a. New peer joins (leader-side)

1. Leader runs `_peerScan` every 4 s
2. If any `_peers` member is not in `_followerReady` → new joiner detected
3. Leader calls `_resyncLeader()`:
   - `_resyncInProgress = true` (prevents re-entrant scans)
   - Stop PLAYHEAD phase
   - Reset `_leaderReady`, `_followerReady`, `_goSent`
   - Call `restartEngine()` if provided (tears down and recreates player)
   - Re-run `_runLeader()` → LOAD_URL → READY → GO

**Critical fix**: `prepareEngine()` must be **awaited** inside `_runLeader()`. The old fire-and-forget pattern allowed `_resyncInProgress` to drop before prepare completed, causing `_peerScan` to trigger another resync during the prepare window — a loop that destroyed the engine continuously.

### 8b. Follower missed LOAD_URL (follower-side)

1. Follower starts a 4 s timer after joining
2. If LOAD_URL not received within timeout:
   - Send `RESYNC_REQUEST` to relay
   - Schedule retry every 5 s
3. Leader receives `RESYNC_REQUEST` → calls `_resyncLeader()`

This handles the race where a follower joins after the leader has already sent the initial LOAD_URL.

---

## 9. SyncConfig Reference

```typescript
export interface SyncConfig {
  // ── Required ──────────────────────────────────────────────────────────────

  /** WS relay URL. LAN: ws://192.168.1.X/api/v1/sync-relay/ws?token=JWT
   *  Cloud: ws://api.nexari.com/api/v1/sync-relay/ws?token=JWT */
  wsUrl: string;

  /** Sync group UUID (from DS). All devices in the same group must use the same value. */
  groupId: string;

  /** This device's unique identifier. Used for leader election and peer listing.
   *  Must be a stable ID that survives reboots (DB UUID or platform-specific). */
  deviceId: string;

  /** This device's LAN IP, reported in PEERS for peer info display only. */
  selfIp: string;

  /** Number of OTHER devices expected in the group (not counting self).
   *  Leader waits up to 6s for this many peers before proceeding solo. */
  expectedPeers: number;

  /** Called with human-readable status messages for UI display. */
  onStatus: (msg: string) => void;

  /** Prebuffer the video at the given URL. Must resolve when the video is
   *  buffered at frame 0 and ready for instant play. Called on both leader and follower. */
  prepareEngine: (url: string) => Promise<void>;

  /** Schedule video playback to begin at a specific local epoch (ms).
   *  Implementation: setTimeout(() => play(), epochMs - Date.now()) */
  schedulePlay: (epochMs: number) => void;

  /** Returns the current video duration in ms. Used for GO message payload. */
  getEngineDuration: () => number;

  // ── Optional ──────────────────────────────────────────────────────────────

  /** Called by the leader on resync to tear down and recreate the player.
   *  If omitted, prepareEngine must be idempotent. */
  restartEngine?: () => void;

  /** Called by the leader to resolve the URL to load and broadcast.
   *  Each platform provides its own implementation (Tizen: filesystem URI,
   *  Windows: absolute file path, Android: remote HTTPS URL).
   *  If omitted, falls back to getPlaylistUrls()[0] (requires pre-seeded playlist). */
  fetchVideoUrl?: () => Promise<string>;

  /** Measured play()→first-frame latency for this device (ms).
   *  Distributed to all peers via PEERS message. Used for auto-calibration:
   *  selfLatency = max(group) - own, so the slowest device is the reference.
   *  If provided, overrides the DEVICE_LATENCY_MS static table. */
  playLatencyMs?: number;

  /** Manual play() delay compensation (ms).
   *  Negative: call play() earlier (slow decoder, e.g. Android WebView cold start).
   *  Positive: delay play() to hold back a fast device.
   *  Overrides both playLatencyMs auto-cal and DEVICE_LATENCY_MS table.
   *  Default: 0. */
  selfLatency?: number;

  /** Pre-elected leader deviceId from the DS manifest's leaderPriority[0].
   *  When set, role is assigned immediately without lexicographic election.
   *  Followers skip _waitPeers() entirely; the leader still waits for peers. */
  pinnedLeaderId?: string;
}
```

---

## 10. Timing Constants

| Constant | Value | Purpose |
|---|---|---|
| `CLOCK_SAMPLES` | 7 | PING/PONG samples per clock measurement |
| `CLOCK_RESYNC_MS` | 60,000 ms | Clock re-measurement interval |
| `GO_AHEAD_MS` | 1,500 ms | Leader schedules GO this far in the future |
| `LOOP_GO_AHEAD_MS` | 800 ms | Relay schedules LOOP_GO this far ahead (Tizen WebKit headroom) |
| `PLAYHEAD_TICK_MS` | 600 ms | PLAYHEAD broadcast interval |
| `PEER_WAIT_TIMEOUT_MS` | 6,000 ms | Max wait for expectedPeers before proceeding solo |
| `LEADER_SCAN_MS` | 4,000 ms | _peerScan interval (new joiner detection) |
| `WS_RECONNECT_MS` | 2,000 ms | Delay before WS reconnect attempt |
| `NUDGE_THRESHOLD_MS` | 8 ms | Min drift before applying EWMA nudge |
| `NUDGE_DAMPING` | 0.6 | EWMA nudge damping factor |
| `NUDGE_CAP_MS` | 150 ms | Max single nudge correction |
| `NUDGE_COOLDOWN_MS` | 2,500 ms | Min interval between nudge corrections |
| `DRIFT_SKIP_MS` | 14,000 ms | Ignore PLAYHEAD drift during first 14s of play |
| `CAL_GRACE_MS` | 4,000 ms | No-nudge grace period after GO |
| `CAL_EWMA_ALPHA` | 0.2 | EWMA smoothing factor for drift |

---

## 11. Platform Integration

### Windows (Electron)

**File**: `apps/nexari-windows/src/renderer/sync-coordinator.ts`

The Windows app is always the **pinned leader** when mixed with Tizen/Android (`pinnedLeaderId = dbDeviceId`).

Key implementation notes:
- Video URLs are absolute Windows file paths: `C:\Nexari\content\video.mp4`
- `prepareEngine` uses the Electron renderer's HTML5 `<video>` element
- `playLatencyMs` is measured via `requestVideoFrameCallback` (sub-ms accurate on Chromium)
- `fetchVideoUrl` resolves the active content item from the published schedule

```typescript
init({
  wsUrl: `ws://192.168.1.17/api/v1/sync-relay/ws?token=${token}`,
  groupId: syncGroup.id,
  deviceId: dbDeviceId,          // UUID from device JWT sub claim
  selfIp: '192.168.1.110',
  expectedPeers: syncGroup.members.length - 1,
  pinnedLeaderId: dbDeviceId,    // Windows is always leader
  playLatencyMs: measuredLatency,
  prepareEngine: (url) => player.prepareVideo(url),
  schedulePlay: (epoch) => player.schedulePlayAt(epoch),
  getEngineDuration: () => player.getDurationMs(),
  restartEngine: () => player.destroyAndRecreate(),
  fetchVideoUrl: () => resolveActiveContentUrl(),
  onStatus: (msg) => updateStatusOverlay(msg),
});
```

---

### Tizen (Samsung Smart TV)

**File**: `apps/nexari-tizen/src/player.ts` → `_startSyncGroupRelay()`

Tizen devices are always **followers** in the CrossOS mode.

Key implementation notes:
- Video URLs resolved via `tizen.filesystem.toURI()` (Tizen 5+) or async path resolution (Tizen 4)
- `prepareEngine` uses Samsung AVPlay: `avObj.prepareAsync(url, onPrepare, onError)`
- Relay connected at `ws://{relayIp}/api/v1/sync-relay/ws?token={deviceToken}`
- The relay IP is the Pi (192.168.1.17) or the QBC (192.168.1.11) for LAN mode

```typescript
// In _startSyncGroupRelay():
await init({
  wsUrl: `ws://${relayHost}/api/v1/sync-relay/ws?token=${deviceToken}`,
  groupId: manifest.syncGroupId,
  deviceId: manifest.deviceId,
  selfIp: networkInfo.ip,
  expectedPeers: manifest.peerCount,
  pinnedLeaderId: manifest.leaderPriority[0],   // Windows UUID
  prepareEngine: (url) => avplayPrepare(url),
  schedulePlay: (epoch) => avplayScheduleAt(epoch),
  getEngineDuration: () => avObj.getDuration(),
  onStatus: (msg) => updateOverlay(msg),
});
```

---

### Android (WebView — player-web)

**File**: `apps/player-web/src/sync/sync.ts`

Android uses an identical copy of the sync protocol. The player-web bundle is loaded in the Kotlin WebView shell.

Key implementation notes:
- The Kotlin shell (`SyncRelayServer.kt`) provides a local WS relay for offline/LAN scenarios
- For cloud relay: the player uses `ws://192.168.1.17/api/v1/sync-relay/ws?token=...`
- `deviceId` is the platform-reported hardware ID or the DB UUID (from JWT sub claim)
- `selfLatency` may need a negative value for cold-start WebView scenarios (first load is slow)
- Logs streamed to the DS device detail page via WS `device_log` message (HTTP `/logs/ingest` is secondary)

```typescript
init({
  wsUrl: syncGroupManifest.relayWsUrl,
  groupId: syncGroupManifest.groupId,
  deviceId: dbDeviceId,          // JWT sub claim (UUID ce5e0309-...)
  selfIp: networkInfo.ipAddress,
  expectedPeers: syncGroupManifest.expectedPeers,
  pinnedLeaderId: syncGroupManifest.leaderPriority[0],
  prepareEngine: (url) => htmlVideoElement.load(url),
  schedulePlay: (epoch) => engine.schedulePlayAt(epoch),
  getEngineDuration: () => engine.getDurationMs(),
  onStatus: (msg) => logger.info(`[Sync] ${msg}`),
});
```

---

### Generic Browser / 3rd-party Player

Any device capable of WebSocket JSON + HTML5 `<video>` can implement the protocol:

1. Open WS to relay with a valid device JWT
2. Send `WS_REGISTER` immediately on open
3. Run 7-sample PING/PONG clock sync; store `offsetMs`
4. Wait for `LOAD_URL` (follower) or `PEERS` (for election)
5. On `LOAD_URL`: `video.src = url; video.load(); video.onseeked = () => sendREADY()`
6. On `GO`: `schedulePlay(_serverToLocal(playAt) + selfLatency)`
7. On video EOS: `video.currentTime = 0; video.pause(); sendLOOP_READY()`
8. On `LOOP_GO`: `schedulePlay(_serverToLocal(playAt) + selfLatency)`

See [Phase 2 SDK plan](#phase-2-sdk) for a `@signage/sync-client` npm package that handles all of the above.

---

## 12. Management REST API

All endpoints require user session JWT or workspace-scoped auth. Base path: `/api/v1`.

### Sync Groups

| Method | Path | Description |
|---|---|---|
| GET | `/sync-groups?workspaceId=` | List all groups in workspace |
| GET | `/sync-groups/:id` | Group detail with member list |
| POST | `/sync-groups` | Create group (allocates numeric groupId via CRC-16) |
| PATCH | `/sync-groups/:id` | Update name, playlist, relay mode, pinned leader |
| DELETE | `/sync-groups/:id` | Soft-delete (clears publishedSyncGroupId on all devices) |
| POST | `/sync-groups/:id/members` | Add devices; auto-detects mode (native-samsung vs custom-mixed) |
| DELETE | `/sync-groups/:id/members/:deviceId` | Remove device |
| POST | `/sync-groups/:id/manifest` | Build and push SYNC_GROUP_INIT manifest to all online members |
| POST | `/sync-groups/:id/priorities` | Reorder leader election priority array |
| GET | `/sync-groups/:id/state` | Live observability: leader, member readyState, drift, playbackRate |
| POST | `/sync-groups/:id/force-resync` | Emergency SYNC_RESET broadcast to all group members |

### Sync Playlists

| Method | Path | Description |
|---|---|---|
| GET | `/sync-playlists?workspaceId=` | List playlists with item counts |
| GET | `/sync-playlists/:id` | Playlist with full item details |
| POST | `/sync-playlists` | Create empty playlist |
| PATCH | `/sync-playlists/:id` | Rename |
| DELETE | `/sync-playlists/:id` | Soft-delete |
| PUT | `/sync-playlists/:id/items` | Atomic replace entire item list |

### Relay

| Method | Path | Description |
|---|---|---|
| GET | `/sync-relay/time` | Server clock (for HTTP clock-sync fallback) — returns `{ serverTimeMs }` |
| GET (WS) | `/sync-relay/ws?token=` | WebSocket relay connection |

---

## 13. Database Schema

Schema file: `packages/db/src/schema/sync.ts`

### `sync_groups`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `org_id` | uuid FK | |
| `workspace_id` | uuid FK | |
| `name` | text | |
| `group_id` | integer | Samsung SyncPlay group ID (CRC-16 of UUID, 0–65535, collision-checked) |
| `sync_playlist_id` | uuid FK → sync_playlists | |
| `mode` | text | `native-samsung` or `custom-mixed` (CrossOS engine) |
| `layout` | jsonb | Optional video-wall tiling metadata |
| `manifest_version` | integer | Bumped on every change; devices compare to detect updates |
| `state` | text | `idle` \| `preparing` \| `playing` \| `error` — derived from member heartbeats |
| `current_item_index` | integer | Best-effort, leader-reported |
| `sync_relay_mode` | text | `lan` (leader opens port 9616) \| `cloud` (use API relay) |
| `pinned_leader_id` | uuid FK → devices | NULL = auto-elect |

### `sync_group_members`

| Column | Type | Notes |
|---|---|---|
| `sync_group_id` | uuid FK | Composite PK |
| `device_id` | uuid FK | Composite PK |
| `tile_col` | smallint | Video wall column (0-based) |
| `tile_row` | smallint | Video wall row (0-based) |
| `leader_priority` | integer | Lower = higher leader priority |
| `last_seen_ip` | text | Latest LAN IP from heartbeat |
| `drift_ms` | integer | Drift vs leader (ms) |
| `playback_rate_x1000` | integer | playbackRate × 1000 |
| `ready_state` | text | `preparing` \| `ready` \| `playing` \| `offline` \| `error` |
| `last_report_at` | timestamptz | Last heartbeat timestamp |

### `sync_playlists` + `sync_playlist_items`

| Table | Key Columns |
|---|---|
| `sync_playlists` | `id`, `org_id`, `workspace_id`, `name` |
| `sync_playlist_items` | `sync_playlist_id`, `content_id`, `duration_seconds` (override), `sort_order` |

---

## Appendix: Observed Production Metrics

Measured during 4-device sync test (Windows + 2× Tizen + Android, May 2026):

| Metric | Value |
|---|---|
| LOOP_GO inter-device epoch match | Identical (0 ms diff between Tizen devices) |
| Android vs Tizen LOOP_GO delta | 78 ms — exactly equals Android NTP offset |
| Android NTP bestRTT | 9 ms |
| LOOP_GO cadence | ~16 s (matches video duration) |
| LOOP_GO cadence jitter | < 1 s (relay barrier prevents drift accumulation) |
| Steady-state inter-device sync | < 50 ms (target), observed < 30 ms |

---

## Appendix: Known Platform Quirks

| Platform | Quirk |
|---|---|
| Tizen 4 (SBB) | `stop()` must be deferred via `setTimeout(0)` from inside `onstreamcompleted` or the compositor freezes |
| Tizen 7 (QBC) | `setBufferingParam` silently stalls on `file://` URIs — must be skipped |
| Tizen 7 (QBC) | `oncurrentplaytime` returns 0 — use a 5s `getCurrentTime()` poll instead |
| Tizen (any) | `WS_REGISTER` must include `?token=` because Tizen B2B WebApps cannot set custom WS headers |
| Android WebView | First-load `play()` latency is higher than subsequent loops — consider negative `selfLatency` |
| Windows (Electron) | `requestVideoFrameCallback` available (Chromium) — best latency measurement accuracy |

---

## Appendix: Source Files

| Component | Path |
|---|---|
| Protocol client (Tizen/HTML5) | `apps/nexari-html5-sync/src/sync.ts` |
| Protocol client (Android/Web) | `apps/player-web/src/sync/sync.ts` |
| Playback engine | `apps/nexari-html5-sync/src/engine.ts` |
| Windows sync coordinator | `apps/nexari-windows/src/renderer/sync-coordinator.ts` |
| Tizen player (relay startup) | `apps/nexari-tizen/src/player.ts` |
| Relay server | `apps/api/src/routes/sync-relay.ts` |
| Management API — groups | `apps/api/src/routes/sync-groups.ts` |
| Management API — playlists | `apps/api/src/routes/sync-playlists.ts` |
| DB schema | `packages/db/src/schema/sync.ts` |
| Shared device message types | `packages/shared/src/schemas/device.ts` |
