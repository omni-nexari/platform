# Zone SyncPlay — Intra-Device Sync + Cross-Device Design

## Status

| Scope | Status |
|---|---|
| Intra-device zone sync (multiple zones, one QB24C) | ✅ Shipped (`20260406-001205Z`) |
| Cross-device zone sync (multiple QB24C displays) | 🔲 Design phase — see §2 onwards |

---

## 0. Intra-Device Zone Sync — Implemented

Multiple video zones on a **single device** are synchronised using AVPlay VideoMixer + app-layer count-based gating.

### Architecture

```
activateZoneMode()
  → _zoneSyncExpectedCount = count of zones with syncGroup set
  → setAvPlayVisualMode(true)  [body transparent so hardware layer shows through]
  → each zone: download → prepareAsync (serialised) → _enqueueZoneSync(play)

_enqueueZoneSync(playFn):
  → pushes to _zoneSyncReadyQueue
  → when queue.length === _zoneSyncExpectedCount → _flushZoneSyncQueue() immediately
  → fallback: 10s timer fires remaining zones if any zone failed to prepare

_flushZoneSyncQueue():
  → calls play() on all zones in same JS tick

onstreamcompleted (single-video loop zone):
  → pushes {avp, zoneIndex} to _zoneSyncLoopQueue
  → when queue.length === _zoneSyncExpectedCount:
      → seekTo(0) + play() all at once  [prevents loop drift accumulation]
```

### Key implementation details

- **Serialised `prepareAsync`**: `_videoMixerQueue` is a chained Promise — Samsung rejects concurrent `prepareAsync()` calls across players (`PLAYER_ERROR_NOT_SUPPORTED_FILE`). Each zone's prepare runs only after the previous completes.
- **Count-based flush (not timer-based)**: Timer-based debounce failed because zones download at different speeds (e.g. Zone 0 takes 4s, Zone 2 takes 4.8s). Counting guarantees all prepared zones start in the same JS tick regardless of download timing.
- **Loop re-sync**: `onstreamcompleted` fires independently per zone. Without re-sync, drift accumulates ~60ms/loop. `_zoneSyncLoopQueue` gates the re-loop the same way the initial start is gated.
- **HTML5 fallback**: Zones without `syncGroup` use HTML5 `<video>` (no body transparency needed, no AVPlay required). Only zones with `syncGroup` use AVPlay VideoMixer.
- **Local files only**: All zone video is downloaded to `file:///opt/usr/home/owner/apps_rw/EBDSignage/data/content/` before playback. No HTTP streaming.

### Zone config fields (`ZoneConfig`)

| Field | Values | Effect |
|---|---|---|
| `syncGroup` | `'A'`\|`'B'`\|`'C'`\|`'D'`\|`null` | Zones with same non-null group → AVPlay VideoMixer, count-based sync |
| `fitMode` | `'fill'`\|`'contain'`\|`null` | `fill` = `PLAYER_DISPLAY_MODE_FULL_SCREEN`; `contain` = `PLAYER_DISPLAY_MODE_LETTER_BOX` |

### Validated on QB24C-T (QBCTF, build `20260406-001205Z`)

- 2 synced video zones + 1 image playlist zone: all playing simultaneously ✅
- `[Zone sync] Starting 2 zone(s) simultaneously` fires once for both zones ✅
- `[Zone sync] Re-looping 2 zone(s) simultaneously` fires on each loop iteration ✅
- No decoder contention (AVPlay VideoMixer handles multiple streams) ✅

---

## 1. Background — Cross-Device Sync

### What we have today

| Feature | Status |
|---|---|
| AVPlay VideoMixer multi-zone | ✅ Implemented |
| Intra-device zone sync (count-based gate + loop re-sync) | ✅ Implemented (`20260406-001205Z`) |
| Samsung native SyncPlay (`webapis.syncplay`) | ✅ Implemented for full-screen content |
| NTP clock alignment (our custom, cross-platform) | ✅ Implemented |

### The gap

Samsung's `webapis.syncplay` cannot be used directly for zones because:

- It **owns the AVPlay player internally** — you cannot call `setDisplayRect` or `USE_VIDEOMIXER` on its internal player
- It accepts only a **single** `rectX/Y/W/H` per device — no multi-zone
- Zone playback uses `webapis.avplaystore.getPlayer()` which is a **separate pipeline** from the syncplay-managed player

---

## 2. Cross-Device Design: Firmware Clock + App-Layer Execution

The insight is to **decouple clock alignment from player control**.

```
┌─────────────────────────────────────────────────────┐
│  Samsung Firmware SyncPlay (clock alignment only)    │
│  webapis.syncplay — dummy 1px playlist               │
│  → fires SYNC_PLAY_START_DONE at T₀ on all devices   │
└───────────────────────┬─────────────────────────────┘
                        │ T₀ (same wall-clock across group)
                        ▼
┌─────────────────────────────────────────────────────┐
│  App-layer zone player (our avplaystore pipeline)    │
│  seekTo(0) + play() triggered at T₀                  │
│  Loop swaps aligned to T₀ + N×videoDuration          │
└─────────────────────────────────────────────────────┘
```

**Key principle**: The firmware aligns the clock network (multicast, same LAN). We use the resulting shared `T₀` to drive our avplaystore zone players manually.

---

## 3. Cross-Device Implementation Plan

### Phase 1 — Dummy SyncPlay for clock sync

1. When a `set_zones` command includes a `syncGroupId`, call:
   ```javascript
   webapis.syncplay.createPlaylist([{ path: 'file:///dummy.mp4', duration: 99999 }], ...)
   webapis.syncplay.start({ rectX: 0, rectY: 0, rectWidth: 1, rectHeight: 1, groupID: syncGroupId, rotate: 'OFF' }, onListener)
   ```
2. `onListener` receives `SYNC_PLAY_START_DONE` → record `T₀ = Date.now() - ntpOffset`
3. All devices in the same `groupID` receive `SYNC_PLAY_START_DONE` within firmware-guaranteed tolerance (~16ms typical)

> **Validation required**: Whether `avplaystore` players and `syncplay` can coexist simultaneously on QB24C.
> The dummy video rect is 1×1px at 0,0 — intended to be invisible behind DOM. If firmware won't start without a real valid video, use a tiny black 1-second looping video bundled in the app package.

### Phase 2 — Aligned zone start

On `SYNC_PLAY_START_DONE`:
```
for each zone with video:
  activePlayer.seekTo(0)   // ensure position 0
  activePlayer.play()      // fire exactly now = T₀
```
All devices call `play()` at the same `T₀` → zones start in sync.

### Phase 3 — Aligned loop swap

The ping-pong `onstreamcompleted` fires when the video ends. If all devices have the same video file and same duration, they swap at the same wall time naturally.

For bulletproof alignment (drift correction):
1. Each device knows `T₀` and `videoDuration`
2. Next swap should happen at `T₀ + N×videoDuration`
3. In `onstreamcompleted`, compute `expectedSwapAt = T₀ + N×videoDuration`
4. Actual swap time = `Date.now() - ntpOffset`
5. If drift > threshold (e.g. 100ms): `nextActive.seekTo(drift)` before `play()`

This keeps zones frame-aligned across devices over many loops without drift accumulation.

### Phase 4 — Stop / teardown

On zone stop or content change:
```javascript
webapis.syncplay.stop(onListener)
webapis.syncplay.removePlaylist(...)
// then stopZoneMode() as normal
```

---

## 4. Platform Constraints

| Constraint | Impact |
|---|---|
| `webapis.syncplay` requires **Tizen 6.5+** | QB24C (QBCTF) is Tizen 6.5 — OK. SBB (Tizen 4) cannot participate in zone sync via this path |
| **Partner certificate** required for syncplay privilege | Must remain signed with partner cert |
| **Same LAN only** | Devices on different subnets cannot sync — firmware uses local multicast |
| **Identical file paths** for syncplay playlist items | Dummy video must be bundled at same path on all devices |
| `avplaystore` + `syncplay` **coexistence not documented** | Hardware validation required on QB24C |
| Samsung note: first switch may have brief black flash (platform limitation) | First sync start will have 1 flash; subsequent loops are seamless |

---

## 5. SBB (Tizen 4) Path

SBB uses `b2bapis.b2bsyncplay` instead of `webapis.syncplay` (see `SYNCPLAY.md` §2).
The same Phase 1–4 plan applies but using:
```javascript
b2bapis.b2bsyncplay.makeSyncPlayList(contents, onSuccess, onError)
b2bapis.b2bsyncplay.startSyncPlay(x, y, w, h, groupID, rotate, onChange)
```

Whether SBB and QB24C can form the **same firmware sync group** (mixed Tizen 4 + 6.5) is unknown and requires hardware testing. If not, SBB-only groups use `b2bsyncplay`; mixed groups fall back to NTP-only alignment.

---

## 6. Server-Side Changes Required

| Change | Detail |
|---|---|
| Zone schema: add `syncGroupId` field | 16-bit int (0–65535), same value pushed to all devices in group |
| `set_zones` WS message: include `syncGroupId` | If absent → no firmware sync, only NTP best-effort |
| Content download: deterministic dummy video path | Bundle a tiny `dummy-sync.mp4` in app package, or use existing downloaded file |
| Platform UI: "Sync group" setting per zone layout | Assign group ID when creating a zone layout; show devices in group |

---

## 7. Fallback Hierarchy

```
1. Firmware sync (webapis.syncplay dummy + avplaystore ping-pong)  ← Phase 1–3 above
2. NTP-aligned start (existing ntpOffset, no firmware)            ← already works today
3. Best-effort (play ASAP, no alignment)                          ← current state
```

The server decides which tier to enable per device based on firmware version reported in heartbeat (`PLAYER_FW_VERSION`).

---

## 8. Validation Checklist — Cross-Device (on QB24C hardware)

- [ ] `webapis.syncplay.start()` + `webapis.avplaystore.getPlayer()` can coexist
- [ ] Dummy 1px rect video does not visually appear over zone content
- [ ] `SYNC_PLAY_START_DONE` fires within acceptable tolerance across 2+ devices
- [ ] `avplaystore` loop re-sync stays aligned after 10+ iterations across devices
- [ ] `seekTo(drift)` on standby player before play() corrects inter-device drift
- [ ] `stopZoneMode()` + `syncplay.stop()` cleans up without player handle leak
- [ ] SBB `b2bsyncplay` + Tizen 6.5 `webapis.syncplay` in same group ID (if applicable)
