/**
 * p2p-sync-client.ts
 * WebRTC DataChannel P2P sync coordinator.
 *
 * Role determination: both devices register at Pi relay; the device with the
 * lexicographically lower IP becomes the leader. The leader drives the sync
 * protocol; the follower waits for cues.
 *
 * Pi relay is used ONLY for WebRTC SDP/ICE signaling. Once the DataChannel
 * is open all messages are direct device-to-device.
 *
 * Public API:
 *   P2PSync.init(opts)
 *   P2PSync.setVideoReady(itemIndex, engineMode)     // called by player after load/decode
 *   P2PSync.setPlaybackState(itemIndex, currentTimeMs, engineMode)  // called every 1s
 *   P2PSync.onSyncPlay(handler)                      // player subscribes for SYNC_PLAY
 *   P2PSync.onVideoUrl(handler)                      // follower subscribes for VIDEO_URL
 *   P2PSync.onSetEngine(handler)                     // both subscribe for engine toggle
 *   P2PSync.onAdjust(handler)                        // follower subscribes for SYNC_ADJUST
 *   P2PSync.broadcastSetEngine(mode)                 // leader-only: toggle engines
 *   P2PSync.getRole()                                // 'leader' | 'follower' | 'pending'
 *   P2PSync.shutdown()
 */

import type { SyncMessage, EngineMode, MsgSyncPlay, MsgVideoUrl, MsgSetEngine, MsgSyncAdjust } from './sync-protocol.js';
import { getSyncedTime, setNtpOffset, getNtpOffset } from './ntp-client.js';

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
const REGISTER_INTERVAL_MS  = 5_000;   // keep-alive re-registration
const PEER_POLL_INTERVAL_MS = 2_000;   // poll /peers until partner found
const SIGNAL_POLL_INTERVAL_MS = 500;   // drain /signals while negotiating
const HEARTBEAT_INTERVAL_MS = 1_000;   // follower sends heartbeat
const DRIFT_NOOP_MS         = 30;
const DRIFT_NUDGE_MS        = 200;
const LEADER_START_AHEAD_MS = 5_000;   // leader fires SYNC_PLAY this far ahead

// Drift correction rates — smooth nudge for MSE (HTML5 supports fractional rates)
const NUDGE_FAST  = 1.005;
const NUDGE_SLOW  = 0.995;

// ── Module state ──────────────────────────────────────────────────────────────
let _opts: P2PSyncOpts | null = null;
let _role: Role = 'pending';
let _peerIp: string | null = null;
let _peerDeviceId: string | null = null;
let _groupId = 'synctest-001';

let _pc: RTCPeerConnection | null = null;
let _dc: RTCDataChannel | null = null;
let _dcOpen = false;

// Pending READY flag — set by player after load/decode, consumed when dc opens
let _readyItemIndex = -1;
let _readyEngineMode: EngineMode = 'mse';

// Playback state for heartbeat/drift
let _pbItemIndex   = -1;
let _pbCurrentMs   = 0;
let _pbEngineMode: EngineMode = 'mse';

// Follower view (leader only): deviceId → last heartbeat
interface FollowerView { currentMs: number; syncedTime: number; itemIndex: number; receivedAt: number; }
const _followerViews: Record<string, FollowerView> = {};

let _signalPollSince = 0;
let _registerTimer: any   = null;
let _peerPollTimer: any   = null;
let _signalPollTimer: any = null;
let _heartbeatTimer: any  = null;

// Handlers set by the player
let _onSyncPlay:  ((msg: MsgSyncPlay)  => void) | null = null;
let _onVideoUrl:  ((msg: MsgVideoUrl)  => void) | null = null;
let _onSetEngine: ((msg: MsgSetEngine) => void) | null = null;
let _onAdjust:    ((msg: MsgSyncAdjust) => void) | null = null;

// ── Public API ────────────────────────────────────────────────────────────────
export function getRole(): Role { return _role; }

export function onSyncPlay(h: (msg: MsgSyncPlay) => void)   { _onSyncPlay  = h; }
export function onVideoUrl(h: (msg: MsgVideoUrl) => void)   { _onVideoUrl  = h; }
export function onSetEngine(h: (msg: MsgSetEngine) => void) { _onSetEngine = h; }
export function onAdjust(h: (msg: MsgSyncAdjust) => void)   { _onAdjust    = h; }

export function init(opts: P2PSyncOpts): void {
  _opts    = opts;
  _groupId = opts.groupId ?? 'synctest-001';
  _opts.logger('info', `[P2P] init: deviceId=${opts.deviceId} ip=${opts.selfIp}`);
  _startRegister();
  _startPeerPoll();
  _startSignalDrain();
}

/** Player calls this once the video is loaded/pre-decoded and ready to play. */
export function setVideoReady(itemIndex: number, engineMode: EngineMode): void {
  _readyItemIndex  = itemIndex;
  _readyEngineMode = engineMode;
  if (_dcOpen && _role === 'follower') {
    _send({ type: 'READY', deviceId: _opts!.deviceId, engineMode });
    _opts?.logger('info', `[P2P] follower READY sent (itemIndex=${itemIndex})`);
  }
  // If leader and dc not open yet, READY is sent once channel opens (in _onDcOpen)
}

/** Player calls this on a 1s tick to update playback state. */
export function setPlaybackState(itemIndex: number, currentTimeMs: number, engineMode: EngineMode): void {
  _pbItemIndex  = itemIndex;
  _pbCurrentMs  = currentTimeMs;
  _pbEngineMode = engineMode;
}

/** Leader-only: trigger an engine switch broadcast (CH+ remote key handler). */
export function broadcastSetEngine(mode: EngineMode): void {
  if (_role !== 'leader') return;
  _send({ type: 'SET_ENGINE', engineMode: mode });
  _opts?.logger('info', `[P2P] leader broadcast SET_ENGINE: ${mode}`);
  // Also fire locally so leader's own player switches
  _onSetEngine?.({ type: 'SET_ENGINE', engineMode: mode });
}

export function shutdown(): void {
  clearInterval(_registerTimer);
  clearInterval(_peerPollTimer);
  clearInterval(_signalPollTimer);
  clearInterval(_heartbeatTimer);
  _dc?.close();
  _pc?.close();
  _dc = null; _pc = null; _dcOpen = false;
  _role = 'pending';
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
    body: JSON.stringify({ deviceId: _opts.deviceId, role: 'peer', ip: _opts.selfIp, groupId: _groupId }),
  }).catch(() => { /* silent – registration is best-effort */ });
}

// ── Peer discovery ────────────────────────────────────────────────────────────
function _startPeerPoll(): void {
  _peerPollTimer = setInterval(_doPeerPoll, PEER_POLL_INTERVAL_MS);
}

async function _doPeerPoll(): Promise<void> {
  if (_dcOpen) { clearInterval(_peerPollTimer); return; }
  if (!_opts) return;
  try {
    const res  = await fetch(`${_opts.piBase}/api/v1/test-sync/peers?groupId=${_groupId}`);
    const data = await res.json() as { peers: Array<{ deviceId: string; ip: string }> };
    const peers = data.peers.filter((p) => p.deviceId !== _opts!.deviceId);
    if (!peers.length) return;  // wait for partner

    const peer = peers[0];
    _peerIp       = peer.ip;
    _peerDeviceId = peer.deviceId;

    // Role: lower IP (lexicographic) is leader
    _role = _opts.selfIp < peer.ip ? 'leader' : 'follower';
    _opts.logger('info', `[P2P] peer found: ${peer.ip} → self is ${_role}`);

    clearInterval(_peerPollTimer);
    _initWebRTC();
  } catch (e: any) {
    _opts?.logger('warn', `[P2P] peer poll failed: ${e?.message}`);
  }
}

// ── WebRTC ────────────────────────────────────────────────────────────────────
function _initWebRTC(): void {
  const config: RTCConfiguration = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
    ],
  };
  _pc = new RTCPeerConnection(config);

  _pc.onicecandidate = (ev) => {
    if (ev.candidate) _sendSignal({ type: 'ice', candidate: ev.candidate.toJSON() });
  };

  _pc.ondatachannel = (ev) => {
    _dc = ev.channel;
    _setupDc();
  };

  if (_role === 'leader') {
    _dc = _pc.createDataChannel('sync', { ordered: true });
    _setupDc();
    _pc.createOffer()
      .then((offer) => _pc!.setLocalDescription(offer))
      .then(() => _sendSignal({ type: 'offer', sdp: _pc!.localDescription!.toJSON() }))
      .catch((e: any) => _opts?.logger('error', `[P2P] offer failed: ${e?.message}`));
  }
}

function _setupDc(): void {
  if (!_dc) return;
  _dc.onopen  = _onDcOpen;
  _dc.onclose = () => { _dcOpen = false; _opts?.logger('warn', '[P2P] DataChannel closed'); };
  _dc.onmessage = (ev) => {
    try { _handleMessage(JSON.parse(ev.data as string)); } catch { /* ignore malformed */ }
  };
}

function _onDcOpen(): void {
  _dcOpen = true;
  _opts?.logger('info', `[P2P] DataChannel open — role=${_role}`);

  if (_role === 'leader') {
    // Send READY if player already signalled readiness before dc opened
    if (_readyItemIndex >= 0) {
      _send({ type: 'READY', deviceId: _opts!.deviceId, engineMode: _readyEngineMode });
    }
    _startHeartbeat();
  } else {
    // Follower: send READY if already loaded
    if (_readyItemIndex >= 0) {
      _send({ type: 'READY', deviceId: _opts!.deviceId, engineMode: _readyEngineMode });
    }
    _startHeartbeat();
  }
}

function _handleMessage(msg: SyncMessage): void {
  if (!_opts) return;
  switch (msg.type) {
    case 'READY':
      if (_role === 'leader') {
        _opts.logger('info', `[P2P] follower READY received (engine=${msg.engineMode})`);
        // Schedule SYNC_PLAY 5s ahead so both have time to react
        const startMs = getSyncedTime() + LEADER_START_AHEAD_MS;
        _send({ type: 'SYNC_PLAY', syncedStartMs: startMs, itemIndex: _pbItemIndex >= 0 ? _pbItemIndex : 0 });
        // Also deliver to leader's own player
        _onSyncPlay?.({ type: 'SYNC_PLAY', syncedStartMs: startMs, itemIndex: _pbItemIndex >= 0 ? _pbItemIndex : 0 });
        _opts.logger('info', `[P2P] leader broadcast SYNC_PLAY at +5s (syncedStartMs=${startMs})`);
      }
      break;

    case 'VIDEO_URL':
      _onVideoUrl?.(msg);
      break;

    case 'SET_ENGINE':
      _opts.logger('info', `[P2P] SET_ENGINE received: ${msg.engineMode}`);
      _onSetEngine?.(msg);
      break;

    case 'SYNC_PLAY':
      _opts.logger('info', `[P2P] SYNC_PLAY received: startMs=${msg.syncedStartMs}`);
      _onSyncPlay?.(msg);
      break;

    case 'HEARTBEAT':
      if (_role === 'leader') _handleHeartbeat(msg);
      break;

    case 'SYNC_ADJUST':
      _onAdjust?.(msg);
      break;
  }
}

// ── Heartbeat + drift correction (leader receives, follower sends) ─────────────
function _startHeartbeat(): void {
  _heartbeatTimer = setInterval(() => {
    if (!_dcOpen) return;
    if (_role === 'follower') {
      _send({
        type: 'HEARTBEAT',
        deviceId: _opts!.deviceId,
        itemIndex: _pbItemIndex,
        currentTimeMs: _pbCurrentMs,
        syncedTime: getSyncedTime(),
        engineMode: _pbEngineMode,
      });
    } else {
      _expireStaleFollowers();
    }
  }, HEARTBEAT_INTERVAL_MS);
}

function _handleHeartbeat(msg: { type: 'HEARTBEAT'; deviceId: string; itemIndex: number; currentTimeMs: number; syncedTime: number; engineMode: EngineMode }): void {
  if (_pbItemIndex < 0 || msg.itemIndex !== _pbItemIndex) return;
  _followerViews[msg.deviceId] = {
    currentMs: msg.currentTimeMs,
    syncedTime: msg.syncedTime,
    itemIndex: msg.itemIndex,
    receivedAt: Date.now(),
  };

  const leaderNow       = getSyncedTime();
  const expectedMs      = _pbCurrentMs - (leaderNow - msg.syncedTime);
  const driftMs         = msg.currentTimeMs - expectedMs;
  const absDrift        = Math.abs(driftMs);

  let action: 'noop' | 'nudge' | 'snap' = 'noop';
  let driftRate = 1.0;
  let targetMs: number | undefined;

  if (absDrift > DRIFT_NUDGE_MS) {
    action   = 'snap';
    targetMs = _pbCurrentMs + 60; // project 60ms forward for one-way trip
  } else if (absDrift > DRIFT_NOOP_MS) {
    action    = 'nudge';
    driftRate = driftMs > 0 ? NUDGE_SLOW : NUDGE_FAST;
  }

  if (action === 'noop') return;
  _send({ type: 'SYNC_ADJUST', itemIndex: _pbItemIndex, driftMs: Math.round(driftMs), action, driftRate, targetMs });
  _opts?.logger('info', `[P2P] SYNC_ADJUST → ${msg.deviceId}: drift=${Math.round(driftMs)}ms action=${action}`);
}

function _expireStaleFollowers(): void {
  const STALE = 6000;
  const now = Date.now();
  Object.keys(_followerViews).forEach((id) => {
    if (now - _followerViews[id].receivedAt > STALE) delete _followerViews[id];
  });
}

// ── Signal drain (SDP + ICE from Pi relay) ────────────────────────────────────
function _startSignalDrain(): void {
  _signalPollTimer = setInterval(_doSignalDrain, SIGNAL_POLL_INTERVAL_MS);
}

async function _doSignalDrain(): Promise<void> {
  if (_dcOpen) return;
  if (!_opts || !_pc) return;
  try {
    const res  = await fetch(`${_opts.piBase}/api/v1/test-sync/signals/${_opts.deviceId}?since=${_signalPollSince}`);
    const data = await res.json() as { entries: Array<{ idx: number; from: string; body: any }>; nextSince: number };
    _signalPollSince = data.nextSince;

    for (const entry of data.entries) {
      const { body } = entry;
      if (body.type === 'offer' && _role === 'follower') {
        await _pc.setRemoteDescription(new RTCSessionDescription(body.sdp));
        const answer = await _pc.createAnswer();
        await _pc.setLocalDescription(answer);
        _sendSignal({ type: 'answer', sdp: _pc.localDescription!.toJSON() });
      } else if (body.type === 'answer' && _role === 'leader') {
        await _pc.setRemoteDescription(new RTCSessionDescription(body.sdp));
      } else if (body.type === 'ice') {
        await _pc.addIceCandidate(new RTCIceCandidate(body.candidate)).catch(() => {});
      }
    }
  } catch { /* silent – network errors are non-fatal during negotiation */ }
}

function _sendSignal(body: unknown): void {
  if (!_opts || !_peerDeviceId) return;
  fetch(`${_opts.piBase}/api/v1/test-sync/signal/${_peerDeviceId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: _opts.deviceId, seq: Date.now(), body }),
  }).catch(() => {});
}

function _send(msg: SyncMessage): void {
  if (!_dc || !_dcOpen) return;
  try { _dc.send(JSON.stringify(msg)); } catch (e: any) {
    _opts?.logger('warn', `[P2P] send failed: ${e?.message}`);
  }
}
