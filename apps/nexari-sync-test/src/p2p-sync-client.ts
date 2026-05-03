/**
 * p2p-sync-client.ts
 * HTTP-relay sync coordinator (no WebRTC).
 *
 * All messages go through the Pi signal queue:
 *   POST /api/v1/test-sync/signal/:targetDeviceId  { from, seq, body: SyncMessage }
 *   GET  /api/v1/test-sync/signals/:deviceId?since=N  -> { entries, nextSince }
 *
 * Role: lower deviceId lexicographically = leader.
 * Leader sends VIDEO_URL -> follower loads -> follower sends READY -> leader sends SYNC_PLAY.
 */

import type { SyncMessage, EngineMode, MsgSyncPlay, MsgVideoUrl, MsgSetEngine, MsgSyncAdjust } from './sync-protocol.js';
import { getSyncedTime } from './ntp-client.js';

// ── Types ──────────────────────────────────────────────────────────────────────
export interface P2PSyncOpts {
  piBase: string;        // e.g. 'http://192.168.1.17'
  deviceId: string;      // unique per-device string (use IP or serial)
  selfIp: string;        // this device's LAN IP
  groupId?: string;      // defaults to 'synctest-001'
  logger: (level: 'info'|'warn'|'error', msg: string) => void;
}

type Role = 'leader' | 'follower' | 'pending';

// ── Constants ──────────────────────────────────────────────────────────────────
const REGISTER_INTERVAL_MS    = 5_000;
const PEER_POLL_INTERVAL_MS   = 2_000;
const SIGNAL_POLL_INTERVAL_MS = 500;
const HEARTBEAT_INTERVAL_MS   = 1_000;
const DRIFT_NOOP_MS           = 10;
const DRIFT_NUDGE_MS          = 150;
const LEADER_START_AHEAD_MS   = 5_000;
const NUDGE_FAST  = 1.02;
const NUDGE_SLOW  = 0.98;
// Only trust peers registered in the last 12s (keep-alive is every 5s)
const PEER_MAX_AGE_MS = 12_000;

// ── Module state ──────────────────────────────────────────────────────────────
let _opts: P2PSyncOpts | null = null;
let _role: Role = 'pending';
let _peerDeviceId: string | null = null;
let _groupId = 'synctest-001';
let _connected = false;  // true once peer found and role assigned

// Pending flags
let _readyItemIndex  = -1;
let _readyEngineMode: EngineMode = 'mse';
let _pendingVideoUrl: string | null = null;

// Playback state
let _pbItemIndex   = -1;
let _pbCurrentMs   = 0;
let _pbEngineMode: EngineMode = 'mse';

// Follower view (leader only)
interface FollowerView { currentMs: number; syncedTime: number; itemIndex: number; receivedAt: number; }
const _followerViews: Record<string, FollowerView> = {};

let _signalPollSince = 0;
let _registerTimer: any   = null;
let _peerPollTimer: any   = null;
let _signalPollTimer: any = null;
let _heartbeatTimer: any  = null;
let _videoDurationMs      = 0;
let _syncPlaySent         = false;  // prevent duplicate SYNC_PLAYs from re-route READY

// Handlers
let _onSyncPlay:  ((msg: MsgSyncPlay)   => void) | null = null;
let _onVideoUrl:  ((msg: MsgVideoUrl)   => void) | null = null;
let _onSetEngine: ((msg: MsgSetEngine)  => void) | null = null;
let _onAdjust:    ((msg: MsgSyncAdjust) => void) | null = null;

// ── Public API ────────────────────────────────────────────────────────────────
export function getRole(): Role { return _role; }
export function setVideoDuration(ms: number): void { _videoDurationMs = ms; }

export function onSyncPlay(h: (msg: MsgSyncPlay) => void)   { _onSyncPlay  = h; }
export function onVideoUrl(h: (msg: MsgVideoUrl) => void)   { _onVideoUrl  = h; }
export function onSetEngine(h: (msg: MsgSetEngine) => void) { _onSetEngine = h; }
export function onAdjust(h: (msg: MsgSyncAdjust) => void)   { _onAdjust    = h; }

export function init(opts: P2PSyncOpts): void {
  _opts    = opts;
  _groupId = opts.groupId ?? 'synctest-001';
  _opts.logger('info', `[P2P] init: deviceId=${opts.deviceId}`);
  _startRegister();
  _startPeerPoll();
  _startSignalDrain();
}

/** Player calls this once the video is loaded/pre-decoded and ready to play. */
export function setVideoReady(itemIndex: number, engineMode: EngineMode): void {
  _readyItemIndex  = itemIndex;
  _readyEngineMode = engineMode;
  if (_connected && _role === 'follower') {
    _send({ type: 'READY', deviceId: _opts!.deviceId, engineMode });
    _opts?.logger('info', `[P2P] follower READY sent`);
  }
}

/** Player calls this on a 1s tick to update playback state. */
export function setPlaybackState(itemIndex: number, currentTimeMs: number, engineMode: EngineMode): void {
  _pbItemIndex  = itemIndex;
  _pbCurrentMs  = currentTimeMs;
  _pbEngineMode = engineMode;
}

/** Leader-only: broadcast the video URL to the follower. Call after init() once URL is known. */
export function broadcastVideoUrl(url: string): void {
  _pendingVideoUrl = url;
  if (_connected && _role === 'leader') {
    _send({ type: 'VIDEO_URL', url, durationMs: 0, engineMode: _readyEngineMode });
    _opts?.logger('info', `[P2P] leader sent VIDEO_URL: ${url}`);
  } else {
    _opts?.logger('info', `[P2P] VIDEO_URL queued (not connected yet): ${url}`);
  }
}

/** Leader-only: trigger an engine switch broadcast (CH+ remote key handler). */
export function broadcastSetEngine(mode: EngineMode): void {
  if (_role !== 'leader') return;
  _send({ type: 'SET_ENGINE', engineMode: mode });
  _opts?.logger('info', `[P2P] leader broadcast SET_ENGINE: ${mode}`);
  _onSetEngine?.({ type: 'SET_ENGINE', engineMode: mode });
}

export function shutdown(): void {
  clearInterval(_registerTimer);
  clearInterval(_peerPollTimer);
  clearInterval(_signalPollTimer);
  clearInterval(_heartbeatTimer);
  _connected = false;
  _role = 'pending';
  _syncPlaySent = false;
  _opts?.logger('info', '[P2P] shutdown');
}

// ── Registration keep-alive ───────────────────────────────────────────────────
function _startRegister(): void {
  _doRegister();
  _registerTimer = setInterval(_doRegister, REGISTER_INTERVAL_MS);
}

function _doRegister(): void {
  if (!_opts) return;
  fetch(`${_opts.piBase}/api/v1/test-sync/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      deviceId: _opts.deviceId,
      role: _role === 'pending' ? 'peer' : _role,
      ip: _opts.selfIp,
      groupId: _groupId,
    }),
  }).catch(() => {});
}

// ── Peer discovery ────────────────────────────────────────────────────────────
function _startPeerPoll(): void {
  _peerPollTimer = setInterval(_doPeerPoll, PEER_POLL_INTERVAL_MS);
}

async function _doPeerPoll(): Promise<void> {
  if (_connected) { clearInterval(_peerPollTimer); return; }
  if (!_opts) return;
  try {
    const res  = await fetch(`${_opts.piBase}/api/v1/test-sync/peers?groupId=${_groupId}`);
    const data = await res.json() as { peers: Array<{ deviceId: string; ip: string; registeredAt?: number }> };

    // Filter out self and stale entries
    const now = Date.now();
    const peers = data.peers.filter((p) =>
      p.deviceId !== _opts!.deviceId &&
      (p.registeredAt == null || (now - p.registeredAt) < PEER_MAX_AGE_MS),
    );
    if (!peers.length) {
      _opts.logger('info', `[P2P] no fresh peers yet (total in group: ${data.peers.length})`);
      return;
    }

    // Pick the most recently registered peer
    peers.sort((a, b) => (b.registeredAt ?? 0) - (a.registeredAt ?? 0));
    const peer = peers[0];
    _peerDeviceId = peer.deviceId;

    _role = _opts.deviceId < peer.deviceId ? 'leader' : 'follower';
    _connected = true;
    _opts.logger('info', `[P2P] paired with ${peer.deviceId} -> self is ${_role}`);

    _doRegister();
    clearInterval(_peerPollTimer);

    // Leader immediately sends VIDEO_URL; follower sends READY if already loaded
    if (_role === 'leader' && _pendingVideoUrl) {
      _send({ type: 'VIDEO_URL', url: _pendingVideoUrl, durationMs: 0, engineMode: _readyEngineMode });
      _opts.logger('info', `[P2P] leader sent VIDEO_URL on connect: ${_pendingVideoUrl}`);
    }
    if (_role === 'follower' && _readyItemIndex >= 0) {
      _send({ type: 'READY', deviceId: _opts.deviceId, engineMode: _readyEngineMode });
      _opts.logger('info', `[P2P] follower sent READY on connect`);
    }

    _startHeartbeat();
  } catch (e: any) {
    _opts?.logger('warn', `[P2P] peer poll failed: ${e?.message}`);
  }
}

// ── Send via Pi HTTP relay ─────────────────────────────────────────────────────
function _send(msg: SyncMessage): void {
  if (!_opts || !_peerDeviceId) return;
  fetch(`${_opts.piBase}/api/v1/test-sync/signal/${_peerDeviceId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: _opts.deviceId, seq: Date.now(), body: msg }),
  }).catch((e: any) => _opts?.logger('warn', `[P2P] _send failed: ${e?.message}`));
}

// ── Signal drain (application messages from Pi relay) ────────────────────────
function _startSignalDrain(): void {
  _signalPollTimer = setInterval(_doSignalDrain, SIGNAL_POLL_INTERVAL_MS);
}

async function _doSignalDrain(): Promise<void> {
  if (!_opts) return;
  try {
    const res  = await fetch(`${_opts.piBase}/api/v1/test-sync/signals/${_opts.deviceId}?since=${_signalPollSince}`);
    const data = await res.json() as { entries: Array<{ idx: number; from: string; body: unknown }>; nextSince: number };
    if (data.nextSince != null) _signalPollSince = data.nextSince;
    for (const entry of data.entries ?? []) {
      // If we're receiving a message from someone other than our current peer,
      // re-route: we likely paired with a stale device initially.
      if (entry.from && entry.from !== _peerDeviceId) {
        _opts?.logger('info', `[P2P] re-routing peer: ${_peerDeviceId ?? 'none'} → ${entry.from}`);
        _peerDeviceId = entry.from;
        // Re-evaluate role with the real peer (we may have paired with a stale device initially)
        const newRole: Role = _opts!.deviceId < entry.from ? 'leader' : 'follower';
        if (newRole !== _role) {
          _opts?.logger('info', `[P2P] role updated: ${_role} → ${newRole}`);
          _role = newRole;
        }
        // Resume the correct side of the handshake
        if (_role === 'follower' && _readyItemIndex >= 0 && !_syncPlaySent) {
          _send({ type: 'READY', deviceId: _opts!.deviceId, engineMode: _readyEngineMode });
          _opts?.logger('info', `[P2P] follower READY sent after re-route`);
        }
        if (_role === 'leader' && _pendingVideoUrl) {
          _send({ type: 'VIDEO_URL', url: _pendingVideoUrl, durationMs: 0, engineMode: _readyEngineMode });
          _opts?.logger('info', `[P2P] leader re-sent VIDEO_URL after re-route`);
        }
      }
      try { _handleMessage(entry.body as SyncMessage); } catch { /* ignore malformed */ }
    }
  } catch { /* silent – network blip */ }
}

// ── Message handler ───────────────────────────────────────────────────────────
function _handleMessage(msg: SyncMessage): void {
  if (!_opts) return;
  switch (msg.type) {
    case 'VIDEO_URL':
      _opts.logger('info', `[P2P] VIDEO_URL received: ${(msg as MsgVideoUrl).url}`);
      _onVideoUrl?.(msg as MsgVideoUrl);
      break;

    case 'READY':
      if (_role === 'leader' && !_syncPlaySent) {
        _syncPlaySent = true;
        _opts.logger('info', `[P2P] follower READY received`);
        const startMs = getSyncedTime() + LEADER_START_AHEAD_MS;
        const syncPlay = { type: 'SYNC_PLAY' as const, syncedStartMs: startMs, videoDurationMs: _videoDurationMs, itemIndex: _pbItemIndex >= 0 ? _pbItemIndex : 0 };
        _send(syncPlay);
        _onSyncPlay?.(syncPlay);
        _opts.logger('info', `[P2P] SYNC_PLAY sent: startMs=${startMs} durationMs=${_videoDurationMs}`);
      } else if (_role === 'leader' && _syncPlaySent) {
        _opts.logger('info', `[P2P] duplicate READY ignored (SYNC_PLAY already sent)`);
      }
      break;

    case 'SYNC_PLAY':
      _syncPlaySent = true;  // prevent subsequent READY sends
      _opts.logger('info', `[P2P] SYNC_PLAY received: startMs=${(msg as MsgSyncPlay).syncedStartMs}`);
      _onSyncPlay?.(msg as MsgSyncPlay);
      break;

    case 'SET_ENGINE':
      _opts.logger('info', `[P2P] SET_ENGINE received: ${(msg as MsgSetEngine).engineMode}`);
      _onSetEngine?.(msg as MsgSetEngine);
      break;

    case 'HEARTBEAT': {
      const hb = msg as any;
      if (_role !== 'leader' || _pbItemIndex < 0 || hb.itemIndex !== _pbItemIndex) break;
      _followerViews[hb.deviceId] = { currentMs: hb.currentTimeMs, syncedTime: hb.syncedTime, itemIndex: hb.itemIndex, receivedAt: Date.now() };
      // Each TV self-corrects via wall-clock tick — just log drift for DS dashboard
      const driftMs = hb.currentTimeMs - _pbCurrentMs;
      _opts?.logger('info', `[P2P] hb: follower=${Math.round(hb.currentTimeMs)}ms leader=${Math.round(_pbCurrentMs)}ms drift=${Math.round(driftMs)}ms`);
      break;
    }

    case 'SYNC_ADJUST':
      _onAdjust?.(msg as MsgSyncAdjust);
      break;
  }
}

// ── Heartbeat ─────────────────────────────────────────────────────────────────
function _startHeartbeat(): void {
  _heartbeatTimer = setInterval(() => {
    if (!_connected || _role !== 'follower' || _pbItemIndex < 0) return;
    _opts?.logger('info', `[P2P] hb sent: pos=${Math.round(_pbCurrentMs)}ms`);
    _send({
      type: 'HEARTBEAT',
      deviceId: _opts!.deviceId,
      itemIndex: _pbItemIndex,
      currentTimeMs: _pbCurrentMs,
      syncedTime: getSyncedTime(),
      engineMode: _pbEngineMode,
    });
  }, HEARTBEAT_INTERVAL_MS);
}
