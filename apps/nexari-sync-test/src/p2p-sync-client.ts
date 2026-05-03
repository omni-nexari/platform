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

import type { SyncMessage, EngineMode, MsgClockProbe, MsgClockReply, MsgSyncPlay, MsgVideoUrl, MsgSetEngine, MsgSyncAdjust } from './sync-protocol.js';
import { getLocalClockTime, getNtpOffset, getSyncedTime, observeRemoteClock } from './ntp-client.js';

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
const SIGNAL_POLL_INTERVAL_MS = 50;
const HEARTBEAT_INTERVAL_MS   = 1_000;
const READY_RETRY_INTERVAL_MS = 1_000;
const VIDEO_URL_RETRY_INTERVAL_MS = 2_000;
const CLOCK_SYNC_INTERVAL_MS  = 100;
const CLOCK_SYNC_TIMEOUT_MS   = 5_000;
const CLOCK_SYNC_MIN_SAMPLES  = 6;
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
let _peerSessionId: string | null = null;
let _groupId = 'synctest-001';
let _connected = false;  // true once peer found and role assigned
let _sessionId = _newSessionId();

// Pending flags
let _readyItemIndex  = -1;
let _readyEngineMode: EngineMode = 'mse';
let _pendingVideoUrl: string | null = null;

// Playback state
let _pbItemIndex   = -1;
let _pbCurrentMs   = 0;
let _pbEngineMode: EngineMode = 'mse';

// Follower view (leader only)
interface FollowerView {
  currentMs: number;
  timelineMs: number;
  actualTimeMs: number;
  syncedTime: number;
  itemIndex: number;
  receivedAt: number;
}
const _followerViews: Record<string, FollowerView> = {};

let _signalPollSince = 0;
let _registerTimer: any   = null;
let _peerPollTimer: any   = null;
let _signalPollTimer: any = null;
let _signalDrainInFlight = false;
let _heartbeatTimer: any  = null;
let _readyRetryTimer: any = null;
let _videoUrlRetryTimer: any = null;
let _clockProbeTimer: any = null;
let _clockSyncWatchdog: any = null;
let _videoDurationMs      = 0;
let _syncPlaySent         = false;  // prevent duplicate SYNC_PLAYs from re-route READY
let _readySent            = false;
let _readyRetryCount      = 0;
let _videoUrlRetryCount   = 0;
let _syncedStartMs        = -1;
let _lastClockLogTime     = 0;
let _lastReadyBlockedLogTime = 0;
let _relaySessionStartedAtMs = -1;
let _staleSignalLogCount = 0;
let _clockProbeSeq = 0;
let _clockSyncStartedAt = 0;
let _leaderClockSamples = 0;
let _leaderClockBestRtt = Number.POSITIVE_INFINITY;
let _leaderClockReady = false;

// Handlers
let _onSyncPlay:  ((msg: MsgSyncPlay)   => void) | null = null;
let _onVideoUrl:  ((msg: MsgVideoUrl)   => void) | null = null;
let _onSetEngine: ((msg: MsgSetEngine)  => void) | null = null;
let _onAdjust:    ((msg: MsgSyncAdjust) => void) | null = null;
let _onRole:      ((role: Role)         => void) | null = null;

// ── Public API ────────────────────────────────────────────────────────────────
export function getRole(): Role { return _role; }
export function setVideoDuration(ms: number): void { _videoDurationMs = ms; }

export function onSyncPlay(h: (msg: MsgSyncPlay) => void)   { _onSyncPlay  = h; }
export function onVideoUrl(h: (msg: MsgVideoUrl) => void)   { _onVideoUrl  = h; }
export function onSetEngine(h: (msg: MsgSetEngine) => void) { _onSetEngine = h; }
export function onAdjust(h: (msg: MsgSyncAdjust) => void)   { _onAdjust    = h; }
export function onRole(h: (role: Role) => void)              { _onRole      = h; }

export function init(opts: P2PSyncOpts): void {
  _opts    = opts;
  _groupId = opts.groupId ?? 'synctest-001';
  _sessionId = _newSessionId();
  _role = 'pending';
  _connected = false;
  _peerDeviceId = null;
  _peerSessionId = null;
  _signalPollSince = 0;
  _syncPlaySent = false;
  _readySent = false;
  _syncedStartMs = -1;
  _resetLeaderClockSync();
  _opts.logger('info', `[P2P] init: deviceId=${opts.deviceId}`);
  _startRegister();
  _startPeerPoll();
  _startSignalDrain();
}

/** Player calls this once the video is loaded/pre-decoded and ready to play. */
export function setVideoReady(itemIndex: number, engineMode: EngineMode): void {
  _readyItemIndex  = itemIndex;
  _readyEngineMode = engineMode;
  _pbItemIndex     = itemIndex;
  _pbCurrentMs     = 0;
  _pbEngineMode    = engineMode;
  if (_connected && _role === 'follower') {
    _maybeSendReady('video-ready');
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
    _sendVideoUrl('broadcast');
    _startVideoUrlRetry();
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
  clearInterval(_readyRetryTimer);
  clearInterval(_videoUrlRetryTimer);
  clearInterval(_clockProbeTimer);
  clearTimeout(_clockSyncWatchdog);
  _connected = false;
  _role = 'pending';
  _peerDeviceId = null;
  _peerSessionId = null;
  _syncPlaySent = false;
  _readySent = false;
  _readyRetryCount = 0;
  _videoUrlRetryCount = 0;
  _syncedStartMs = -1;
  _relaySessionStartedAtMs = -1;
  _staleSignalLogCount = 0;
  _resetLeaderClockSync();
  _opts?.logger('info', '[P2P] shutdown');
}

// ── Registration keep-alive ───────────────────────────────────────────────────
function _startRegister(): void {
  _doRegister();
  _registerTimer = setInterval(_doRegister, REGISTER_INTERVAL_MS);
}

function _doRegister(): void {
  if (!_opts) return;
  const t0 = Date.now();
  fetch(`${_opts.piBase}/api/v1/test-sync/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      deviceId: _opts.deviceId,
      sessionId: _sessionId,
      role: _role === 'pending' ? 'peer' : _role,
      ip: _opts.selfIp,
      groupId: _groupId,
    }),
  })
    .then(async (res) => _observeServerTime((await res.json().catch(() => null))?.serverTimeMs, t0, Date.now(), 'register'))
    .catch(() => {});
}

// ── Peer discovery ────────────────────────────────────────────────────────────
function _startPeerPoll(): void {
  _peerPollTimer = setInterval(_doPeerPoll, PEER_POLL_INTERVAL_MS);
}

async function _doPeerPoll(): Promise<void> {
  if (_connected) { clearInterval(_peerPollTimer); return; }
  if (!_opts) return;
  try {
    const t0 = Date.now();
    const res  = await fetch(`${_opts.piBase}/api/v1/test-sync/peers?groupId=${_groupId}`);
    const data = await res.json() as { peers?: Array<{ deviceId: string; ip: string; sessionId?: string | null; registeredAt?: number }>; serverTimeMs?: number };
    _observeServerTime(data.serverTimeMs, t0, Date.now(), 'peers');
    const allPeers = Array.isArray(data.peers) ? data.peers : [];

    // Filter out self and stale entries. registeredAt is server-domain time, so
    // compare against serverTimeMs when the relay provides it.
    const now = typeof data.serverTimeMs === 'number' ? data.serverTimeMs : Date.now();
    const peers = allPeers.filter((p) =>
      p.deviceId !== _opts!.deviceId &&
      (p.registeredAt == null || (now - p.registeredAt) < PEER_MAX_AGE_MS),
    );
    if (!peers.length) {
      _opts.logger('info', `[P2P] no fresh peers yet (total in group: ${allPeers.length})`);
      return;
    }

    // Pick the most recently registered peer
    peers.sort((a, b) => (b.registeredAt ?? 0) - (a.registeredAt ?? 0));
    const peer = peers[0];
    _peerDeviceId = peer.deviceId;
    _peerSessionId = peer.sessionId ?? null;

    _role = _opts.deviceId < peer.deviceId ? 'leader' : 'follower';
    _connected = true;
    _opts.logger('info', `[P2P] paired with ${peer.deviceId} -> self is ${_role}`);
    _onRole?.(_role);
    if (_role === 'follower') _startLeaderClockSync();

    _doRegister();
    clearInterval(_peerPollTimer);

    // Leader immediately sends VIDEO_URL; follower sends READY if already loaded
    if (_role === 'leader' && _pendingVideoUrl) {
      _sendVideoUrl('connect');
      _startVideoUrlRetry();
    }
    if (_role === 'follower' && _readyItemIndex >= 0) _maybeSendReady('connect');

    _startHeartbeat();
  } catch (e: any) {
    _opts?.logger('warn', `[P2P] peer poll failed: ${e?.message}`);
  }
}

// ── Send via Pi HTTP relay ─────────────────────────────────────────────────────
function _send(msg: SyncMessage): void {
  if (!_opts || !_peerDeviceId) return;
  const t0 = Date.now();
  fetch(`${_opts.piBase}/api/v1/test-sync/signal/${_peerDeviceId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: _opts.deviceId, sessionId: _sessionId, seq: Date.now(), body: msg }),
  })
    .then(async (res) => _observeServerTime((await res.json().catch(() => null))?.serverTimeMs, t0, Date.now(), 'signal'))
    .catch((e: any) => _opts?.logger('warn', `[P2P] _send failed: ${e?.message}`));
}

// ── Signal drain (application messages from Pi relay) ────────────────────────
function _startSignalDrain(): void {
  _signalPollTimer = setInterval(_doSignalDrain, SIGNAL_POLL_INTERVAL_MS);
}

async function _doSignalDrain(): Promise<void> {
  if (!_opts || _signalDrainInFlight) return;
  _signalDrainInFlight = true;
  try {
    const t0 = Date.now();
    const controller = new AbortController();
    const fetchTimer = setTimeout(() => controller.abort(), 3000);
    let res: Response;
    try {
      res = await fetch(`${_opts.piBase}/api/v1/test-sync/signals/${_opts.deviceId}?since=${_signalPollSince}`, { signal: controller.signal });
    } finally {
      clearTimeout(fetchTimer);
    }
    const data = await res.json() as { entries: Array<{ idx: number; from: string; sessionId?: string | null; at?: number; body: unknown }>; nextSince: number; serverTimeMs?: number };
    _observeServerTime(data.serverTimeMs, t0, Date.now(), 'signals');
    if (data.nextSince != null) _signalPollSince = data.nextSince;
    for (const entry of data.entries ?? []) {
      if (_isStaleSignal(entry)) continue;
      if (_isWrongPeerSession(entry)) continue;
      // If we're receiving a message from someone other than our current peer,
      // re-route: we likely paired with a stale device initially.
      if (entry.from && entry.from !== _peerDeviceId) {
        _opts?.logger('info', `[P2P] re-routing peer: ${_peerDeviceId ?? 'none'} → ${entry.from}`);
        _peerDeviceId = entry.from;
        _peerSessionId = entry.sessionId ?? null;
        _readySent = false;
        _stopReadyRetry();
        _resetLeaderClockSync();
        // Re-evaluate role with the real peer (we may have paired with a stale device initially)
        const newRole: Role = _opts!.deviceId < entry.from ? 'leader' : 'follower';
        if (newRole !== _role) {
          _opts?.logger('info', `[P2P] role updated: ${_role} → ${newRole}`);
          _role = newRole;
          _onRole?.(_role);
        }
        // Resume the correct side of the handshake
        if (_role === 'follower') _startLeaderClockSync();
        if (_role === 'follower' && _readyItemIndex >= 0 && !_syncPlaySent) _maybeSendReady('re-route');
        if (_role === 'leader' && _pendingVideoUrl) {
          _stopVideoUrlRetry();
          _sendVideoUrl('re-route');
          _startVideoUrlRetry();
        }
      }
      try { _handleMessage(entry.body as SyncMessage); } catch { /* ignore malformed */ }
    }
  } catch { /* silent – network blip */ } finally {
    _signalDrainInFlight = false;
  }
}

function _observeServerTime(serverTimeMs: unknown, t0: number, t3: number, source: string): void {
  void t0;
  void t3;
  void source;
  if (typeof serverTimeMs !== 'number') return;
  if (_relaySessionStartedAtMs <= 0) _relaySessionStartedAtMs = serverTimeMs;
}

function _isStaleSignal(entry: { idx: number; from: string; at?: number }): boolean {
  const at = Number(entry.at);
  if (_relaySessionStartedAtMs <= 0 || !isFinite(at)) return false;
  if (at >= _relaySessionStartedAtMs - 1000) return false;
  if (_staleSignalLogCount < 3) {
    _staleSignalLogCount += 1;
    _opts?.logger('info', `[P2P] ignored stale signal idx=${entry.idx} from=${entry.from}`);
  }
  return true;
}

function _isWrongPeerSession(entry: { idx: number; from: string; sessionId?: string | null }): boolean {
  if (!_peerDeviceId || entry.from !== _peerDeviceId) return false;
  if (!entry.sessionId || !_peerSessionId) return false;
  if (entry.sessionId === _peerSessionId) return false;
  // Peer rebooted with a new session — accept and re-sync
  _opts?.logger('info', `[P2P] peer session updated (${entry.from}): ${_peerSessionId} → ${entry.sessionId}`);
  _peerSessionId = entry.sessionId;
  _readySent = false;
  _stopReadyRetry();
  _resetLeaderClockSync();
  if (_role === 'follower') _startLeaderClockSync();
  return false; // let the signal through
}

function _newSessionId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function _resetLeaderClockSync(): void {
  clearInterval(_clockProbeTimer);
  _clockProbeTimer = null;
  clearTimeout(_clockSyncWatchdog);
  _clockSyncWatchdog = null;
  _clockProbeSeq = 0;
  _clockSyncStartedAt = 0;
  _leaderClockSamples = 0;
  _leaderClockBestRtt = Number.POSITIVE_INFINITY;
  _leaderClockReady = false;
  _lastReadyBlockedLogTime = 0;
}

function _startLeaderClockSync(): void {
  if (!_opts || _role !== 'follower' || !_peerDeviceId || _leaderClockReady || _clockProbeTimer) return;
  _clockSyncStartedAt = Date.now();
  _opts.logger('info', '[P2P] leader-clock sync started');
  _sendClockProbe();
  _clockProbeTimer = setInterval(_sendClockProbe, CLOCK_SYNC_INTERVAL_MS);
  // Watchdog: fire once after timeout in case setInterval is throttled by the OS
  _clockSyncWatchdog = setTimeout(() => {
    if (!_leaderClockReady) _markLeaderClockReady(_leaderClockSamples > 0 ? 'watchdog-with-samples' : 'watchdog-no-samples');
  }, CLOCK_SYNC_TIMEOUT_MS + 500);
}

function _sendClockProbe(): void {
  if (!_opts || _role !== 'follower' || !_peerDeviceId || _syncPlaySent) {
    clearInterval(_clockProbeTimer);
    _clockProbeTimer = null;
    return;
  }
  if (_leaderClockReady) {
    clearInterval(_clockProbeTimer);
    _clockProbeTimer = null;
    return;
  }

  const elapsed = Date.now() - _clockSyncStartedAt;
  if (elapsed > CLOCK_SYNC_TIMEOUT_MS) {
    _markLeaderClockReady(_leaderClockSamples > 0 ? 'timeout-with-samples' : 'timeout-no-samples');
    return;
  }

  _send({
    type: 'CLOCK_PROBE',
    probeId: ++_clockProbeSeq,
    clientSendMs: getLocalClockTime(),
  });
}

function _handleClockProbe(msg: MsgClockProbe): void {
  if (_role !== 'leader') return;
  const leaderReceiveMs = getSyncedTime();
  _send({
    type: 'CLOCK_REPLY',
    probeId: msg.probeId,
    clientSendMs: msg.clientSendMs,
    leaderReceiveMs,
    leaderSendMs: getSyncedTime(),
  });
}

function _handleClockReply(msg: MsgClockReply): void {
  if (_role !== 'follower' || _leaderClockReady) return;
  const result = observeRemoteClock(
    msg.leaderReceiveMs,
    msg.leaderSendMs,
    msg.clientSendMs,
    getLocalClockTime(),
    _leaderClockSamples + 1,
    'leader',
  );
  if (!result) return;

  _leaderClockSamples += 1;
  _leaderClockBestRtt = Math.min(_leaderClockBestRtt, result.rttMs);
  const now = Date.now();
  if (now - _lastClockLogTime > 1000 || _leaderClockSamples >= CLOCK_SYNC_MIN_SAMPLES) {
    _lastClockLogTime = now;
    _opts?.logger('info', `[P2P] leader clock sample ${_leaderClockSamples}: offset=${result.offsetMs}ms rtt=${result.rttMs}ms best=${_leaderClockBestRtt}ms`);
  }

  if (_leaderClockSamples >= CLOCK_SYNC_MIN_SAMPLES) _markLeaderClockReady('samples');
}

function _markLeaderClockReady(reason: string): void {
  if (_leaderClockReady) return;
  _leaderClockReady = true;
  clearInterval(_clockProbeTimer);
  _clockProbeTimer = null;
  clearTimeout(_clockSyncWatchdog);
  _clockSyncWatchdog = null;
  _opts?.logger('info', `[P2P] leader-clock ready (${reason}): samples=${_leaderClockSamples} bestRtt=${Math.round(_leaderClockBestRtt)}ms offset=${Math.round(getNtpOffset())}ms`);
  _maybeSendReady('clock-ready');
}

function _stopReadyRetry(): void {
  clearInterval(_readyRetryTimer);
  _readyRetryTimer = null;
  _readyRetryCount = 0;
}

function _stopVideoUrlRetry(): void {
  clearInterval(_videoUrlRetryTimer);
  _videoUrlRetryTimer = null;
  _videoUrlRetryCount = 0;
}

function _sendVideoUrl(reason: string): void {
  if (!_opts || _role !== 'leader' || !_pendingVideoUrl || !_peerDeviceId || _syncPlaySent) return;
  _send({ type: 'VIDEO_URL', url: _pendingVideoUrl, durationMs: _videoDurationMs, engineMode: _readyEngineMode });
  _opts.logger('info', `[P2P] leader sent VIDEO_URL (${reason}): ${_pendingVideoUrl}`);
}

function _startVideoUrlRetry(): void {
  if (!_opts || _role !== 'leader' || !_pendingVideoUrl || _videoUrlRetryTimer || _syncPlaySent) return;
  _videoUrlRetryTimer = setInterval(() => {
    if (!_opts || _role !== 'leader' || !_pendingVideoUrl || !_peerDeviceId || _syncPlaySent) {
      _stopVideoUrlRetry();
      return;
    }
    _videoUrlRetryCount += 1;
    _send({ type: 'VIDEO_URL', url: _pendingVideoUrl, durationMs: _videoDurationMs, engineMode: _readyEngineMode });
    if (_videoUrlRetryCount % 5 === 0) {
      _opts.logger('info', `[P2P] leader VIDEO_URL retry ${_videoUrlRetryCount}`);
    }
  }, VIDEO_URL_RETRY_INTERVAL_MS);
}

function _startReadyRetry(): void {
  if (!_opts || _role !== 'follower' || _readyRetryTimer || _syncPlaySent) return;
  _readyRetryTimer = setInterval(() => {
    if (!_opts || _role !== 'follower' || _syncPlaySent || !_peerDeviceId || _readyItemIndex < 0) {
      _stopReadyRetry();
      return;
    }
    _readyRetryCount += 1;
    _send({ type: 'READY', deviceId: _opts.deviceId, engineMode: _readyEngineMode });
    if (_readyRetryCount % 5 === 0) {
      _opts.logger('info', `[P2P] follower READY retry ${_readyRetryCount}`);
    }
  }, READY_RETRY_INTERVAL_MS);
}

function _maybeSendReady(reason: string): void {
  if (!_opts || !_connected || _role !== 'follower' || !_peerDeviceId) return;
  if (_syncPlaySent || _readyItemIndex < 0) return;
  if (_readySent) {
    _startReadyRetry();
    return;
  }
  if (!_leaderClockReady) {
    _startLeaderClockSync();
    const now = Date.now();
    if (now - _lastReadyBlockedLogTime > 1000) {
      _lastReadyBlockedLogTime = now;
      _opts.logger('info', `[P2P] follower READY waiting for leader clock (${reason})`);
    }
    return;
  }
  _readySent = true;
  _send({ type: 'READY', deviceId: _opts.deviceId, engineMode: _readyEngineMode });
  _opts.logger('info', `[P2P] follower READY sent (${reason})`);
  _startReadyRetry();
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
        _syncedStartMs = startMs;
        const syncPlay = { type: 'SYNC_PLAY' as const, syncedStartMs: startMs, videoDurationMs: _videoDurationMs, itemIndex: _pbItemIndex >= 0 ? _pbItemIndex : 0 };
        _send(syncPlay);
        _onSyncPlay?.(syncPlay);
        _opts.logger('info', `[P2P] SYNC_PLAY sent: startMs=${startMs} durationMs=${_videoDurationMs}`);
      } else if (_role === 'leader' && _syncPlaySent) {
        _opts.logger('info', `[P2P] duplicate READY ignored (SYNC_PLAY already sent)`);
      }
      break;

    case 'CLOCK_PROBE':
      _handleClockProbe(msg as MsgClockProbe);
      break;

    case 'CLOCK_REPLY':
      _handleClockReply(msg as MsgClockReply);
      break;

    case 'SYNC_PLAY':
      _syncPlaySent = true;  // prevent subsequent READY sends
      _readySent = true;
      _stopReadyRetry();
      _stopVideoUrlRetry();
      clearInterval(_clockProbeTimer);
      _clockProbeTimer = null;
      _syncedStartMs = (msg as MsgSyncPlay).syncedStartMs;
      if (((msg as MsgSyncPlay).videoDurationMs ?? 0) > 0) _videoDurationMs = (msg as MsgSyncPlay).videoDurationMs!;
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
      const local = _getTimelineSnapshot();
      const followerTimelineMs = Number.isFinite(hb.timelineMs) ? hb.timelineMs : hb.currentTimeMs;
      const followerActualMs = Number.isFinite(hb.actualTimeMs) ? hb.actualTimeMs : hb.currentTimeMs;
      _followerViews[hb.deviceId] = {
        currentMs: hb.currentTimeMs,
        timelineMs: followerTimelineMs,
        actualTimeMs: followerActualMs,
        syncedTime: hb.syncedTime,
        itemIndex: hb.itemIndex,
        receivedAt: Date.now(),
      };
      const driftMs = followerTimelineMs - local.timelineMs;
      _opts?.logger('info', `[P2P] hb: followerTl=${Math.round(followerTimelineMs)}ms leaderTl=${Math.round(local.timelineMs)}ms drift=${Math.round(driftMs)}ms actualFollower=${Math.round(followerActualMs)}ms actualLeader=${Math.round(_pbCurrentMs)}ms`);
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
    const timeline = _getTimelineSnapshot();
    _opts?.logger('info', `[P2P] hb sent: timeline=${Math.round(timeline.timelineMs)}ms pos=${Math.round(timeline.positionMs)}ms actual=${Math.round(_pbCurrentMs)}ms`);
    _send({
      type: 'HEARTBEAT',
      deviceId: _opts!.deviceId,
      itemIndex: _pbItemIndex,
      currentTimeMs: timeline.positionMs,
      timelineMs: timeline.timelineMs,
      actualTimeMs: _pbCurrentMs,
      syncedTime: getSyncedTime(),
      engineMode: _pbEngineMode,
    });
  }, HEARTBEAT_INTERVAL_MS);
}

function _getTimelineSnapshot(): { timelineMs: number; positionMs: number } {
  if (_syncedStartMs > 0) {
    const elapsed = Math.max(0, getSyncedTime() - _syncedStartMs);
    const positionMs = _videoDurationMs > 0
      ? ((elapsed % _videoDurationMs) + _videoDurationMs) % _videoDurationMs
      : elapsed;
    return { timelineMs: elapsed, positionMs };
  }
  return { timelineMs: _pbCurrentMs, positionMs: _pbCurrentMs };
}
