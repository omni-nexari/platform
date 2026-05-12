/**
 * sync.ts — WebSocket-based group sync protocol for player-web.
 *
 * Ported from apps/nexari-html5-sync/src/sync.ts; logger and engine import
 * paths adjusted for the player-web package layout. Logic is identical.
 *
 * Protocol:
 *   WS_REGISTER  client → server  "I'm here, add me to group"
 *   PEERS        server → client  "current peer list"
 *   PING         client → server  clock offset measurement
 *   PONG         server → client  echo with server timestamp
 *   LOAD_URL     leader → follower  "load and prebuffer this URL"
 *   READY        follower → leader  "prebuffered, ready to play"
 *   GO           leader → all      "play at this epoch (server time)"
 *   PLAYHEAD     any → any         heartbeat every 600ms (monitoring only)
 *   LOOP_READY   client → relay    "prebuffered at frame 0, ready for loop"
 *   LOOP_GO      relay → all       "play NOW at this epoch"
 */
import { logger } from '../logger.js';
import {
  getCurrentPosMs, playFromPrebuffer, setOnLoop, setRole, setPlaylist,
  isPlaying as engineIsPlaying, getDuration as engineGetDuration,
  getPlaylistUrls,
} from './engine.js';

interface PeerInfo { deviceId: string; ip: string; registeredAt: number; }

export interface SyncConfig {
  wsUrl:             string;
  groupId:           string;
  deviceId:          string;
  selfIp:            string;
  expectedPeers:     number;
  onStatus:          (msg: string) => void;
  prepareEngine:     (url: string) => Promise<void>;
  schedulePlay:      (epochMs: number) => void;
  getEngineDuration: () => number;
  restartEngine?:    () => void;
}

const CLOCK_SAMPLES    = 7;
const CLOCK_RESYNC_MS  = 60_000;
const GO_AHEAD_MS      = 5000;
const PLAYHEAD_TICK_MS = 600;
const PEER_FRESH_MS    = 4000;
const WS_RECONNECT_MS  = 2000;
const LEADER_SCAN_MS   = 4000;

const DEVICE_LATENCY_MS: Record<string, number> = {};

let _cfg: SyncConfig;
let _ws: WebSocket | null = null;
let _wsReady = false;
let _stopped = false;
let _role: 'pending' | 'leader' | 'follower' = 'pending';
let _peers: string[] = [];
let _offsetMs = 0;
let _selfLatency = 0;
let _leaderReady = false;
let _followerReady = new Set<string>();
let _goSent = false;
let _loadReceived = false;
let _phaseTimer: ReturnType<typeof setInterval> | null = null;
let _phaseStartedAt = 0;
let _peerHeads = new Map<string, { serverNow: number; posMs: number; at: number }>();
let _ewma = 0;
let _ewmaN = 0;
let _peerWatchTimer: ReturnType<typeof setInterval> | null = null;
let _resyncInProgress = false;
let _playlistUrls: string[] = [];

// ── Public ─────────────────────────────────────────────────────────────────────

export async function init(cfg: SyncConfig): Promise<void> {
  _cfg = cfg; _stopped = false; _role = 'pending'; _peers = [];
  _leaderReady = false; _followerReady = new Set(); _goSent = false; _loadReceived = false;
  _phaseStartedAt = 0; _ewma = 0; _ewmaN = 0;
  _selfLatency = DEVICE_LATENCY_MS[cfg.deviceId] ?? 0;

  logger.info(`[Sync] init deviceId=${cfg.deviceId} group=${cfg.groupId}`);
  cfg.onStatus('Connecting to relay…');

  setOnLoop(() => {
    if (!_stopped) {
      logger.info('[Sync] prebuffer ready — sending LOOP_READY');
      _wsSend({ type: 'LOOP_READY', groupId: _cfg.groupId, deviceId: _cfg.deviceId });
    }
  });

  await _connectWs();
  await _measureClock();
  setTimeout(() => { if (!_stopped) _measureClock().catch(() => {}); }, 3_000);
  setTimeout(() => { if (!_stopped) _measureClock().catch(() => {}); }, 10_000);
  setInterval(() => { if (!_stopped) _measureClock().catch(() => {}); }, CLOCK_RESYNC_MS);

  cfg.onStatus(`Waiting for ${cfg.expectedPeers} peers…`);
  await _waitPeers();

  logger.info(`[Sync] role=${_role} peers=[${_peers.join(', ')}]`);
  cfg.onStatus(`Role: ${_role} — peer(s): ${_peers.join(', ')}`);

  const resolvedRole = _role as 'leader' | 'follower';
  setRole(resolvedRole);

  _playlistUrls = await _fetchPlaylistUrls();
  setPlaylist(_playlistUrls);

  if (resolvedRole === 'leader') {
    await _runLeader();
    _startPeerWatch();
  } else {
    cfg.onStatus('Follower — waiting for LOAD_URL from leader…');
  }
}

export function stop(): void {
  _stopped = true;
  _stopPhase();
  _stopPeerWatch();
  if (_ws) { try { _ws.close(); } catch {} _ws = null; }
  logger.info('[Sync] stopped');
}

// ── WebSocket ──────────────────────────────────────────────────────────────────

function _connectWs(): Promise<void> {
  return new Promise((resolve) => {
    const attempt = () => {
      if (_stopped) return;
      logger.info(`[Sync] WS connecting → ${_cfg.wsUrl}`);
      _wsReady = false;
      try {
        const ws = new WebSocket(_cfg.wsUrl);
        _ws = ws;
        ws.onopen = () => {
          _wsReady = true;
          logger.info('[Sync] WS connected');
          _wsSend({ type: 'WS_REGISTER', deviceId: _cfg.deviceId, groupId: _cfg.groupId, ip: _cfg.selfIp });
          resolve();
        };
        ws.onmessage = (ev) => {
          try { _dispatch(JSON.parse(ev.data as string)); } catch {}
        };
        ws.onerror = () => { logger.warn('[Sync] WS error'); };
        ws.onclose = () => {
          _wsReady = false;
          logger.warn('[Sync] WS closed — reconnecting…');
          if (!_stopped) setTimeout(attempt, WS_RECONNECT_MS);
        };
      } catch (e: unknown) {
        logger.error(`[Sync] WS open failed: ${(e as Error)?.message}`);
        if (!_stopped) setTimeout(attempt, WS_RECONNECT_MS);
      }
    };
    attempt();
  });
}

function _wsSend(msg: object): void {
  if (!_ws || !_wsReady || _ws.readyState !== 1) return;
  try { _ws.send(JSON.stringify(msg)); } catch {}
}

// ── Clock sync ────────────────────────────────────────────────────────────────

function _measureClock(): Promise<void> {
  return new Promise((resolve) => {
    const results: { offset: number; rtt: number }[] = [];
    let remaining = CLOCK_SAMPLES;

    const finish = () => {
      if (results.length === 0) { resolve(); return; }
      results.sort((a, b) => a.rtt - b.rtt);
      _offsetMs = results[0]!.offset;
      logger.info(`[Clock] offset=${_offsetMs}ms bestRtt=${results[0]!.rtt}ms samples=${results.length}`);
      resolve();
    };

    for (let i = 0; i < CLOCK_SAMPLES; i++) {
      setTimeout(() => {
        if (!_wsReady) { if (--remaining === 0) finish(); return; }
        const t1 = Date.now();
        const onMsg = (ev: MessageEvent) => {
          const msg = (() => { try { return JSON.parse(ev.data as string); } catch { return null; } })();
          if (!msg || msg.type !== 'PONG' || msg.t1 !== t1) return;
          _ws!.removeEventListener('message', onMsg);
          const t3 = Date.now();
          results.push({ offset: Math.round(msg.t2 + (t3 - t1) / 2 - t3), rtt: t3 - t1 });
          if (--remaining === 0) finish();
        };
        if (_ws) _ws.addEventListener('message', onMsg);
        _wsSend({ type: 'PING', t1 });
        setTimeout(() => {
          if (_ws) _ws.removeEventListener('message', onMsg);
          if (--remaining === 0) finish();
        }, 1000);
      }, i * 60);
    }
  });
}

const _localToServer = (t: number) => t + _offsetMs;
const _serverToLocal = (t: number) => t - _offsetMs;

// ── Peer discovery ────────────────────────────────────────────────────────────

function _waitPeers(): Promise<void> {
  return new Promise((resolve) => {
    const check = () => {
      if (_stopped) { resolve(); return; }
      if (_peers.length >= _cfg.expectedPeers) {
        const all = [..._peers, _cfg.deviceId].sort();
        _role = all[all.length - 1] === _cfg.deviceId ? 'leader' : 'follower';
        resolve(); return;
      }
      setTimeout(check, 300);
    };
    check();
  });
}

// ── Message dispatch ──────────────────────────────────────────────────────────

function _dispatch(msg: Record<string, unknown>): void {
  const from = String(msg['from'] ?? 'relay');

  if (msg['type'] === 'PONG') return;

  if (msg['type'] === 'PEERS' || msg['type'] === 'HEARTBEAT_PEERS') {
    const list: string[] = msg['type'] === 'PEERS'
      ? (msg['peers'] as PeerInfo[]).map((p) => p.deviceId)
      : (msg['peers'] as string[]);
    const others = list.filter((id) => id !== _cfg.deviceId);
    if (JSON.stringify(others) !== JSON.stringify(_peers)) {
      const dropped = _peers.filter((id) => !others.includes(id));
      dropped.forEach((id) => _followerReady.delete(id));
      _peers = others;
      logger.info(`[Sync] peers: [${_peers.join(', ')}]`);
    }
    return;
  }

  logger.info(`[Sync] ← ${msg['type']} from=${from}`);

  if (msg['type'] === 'LOAD_URL') {
    if (_role !== 'follower') return;
    if (_loadReceived) { logger.info('[Sync] LOAD_URL dup — ignored'); return; }
    _loadReceived = true;

    // Use follower's own locally-resolved URL — leader may be on a different OS
    // with incompatible file:// paths. msg.index indicates the playlist position.
    const localPlaylist = getPlaylistUrls();
    let localUrl: string;
    const msgIndex = typeof msg['index'] === 'number' ? (msg['index'] as number) : -1;
    if (msgIndex >= 0 && localPlaylist[msgIndex]) {
      localUrl = localPlaylist[msgIndex]!;
    } else {
      const leaderFile = String(msg['url'] ?? '').split('/').pop() ?? '';
      const matchIdx = localPlaylist.findIndex((u) => u.split('/').pop() === leaderFile);
      localUrl = matchIdx >= 0 ? localPlaylist[matchIdx]! : (localPlaylist[0] ?? String(msg['url'] ?? ''));
    }
    const startIdx = localPlaylist.indexOf(localUrl);
    if (startIdx > 0) {
      setPlaylist([...localPlaylist.slice(startIdx), ...localPlaylist.slice(0, startIdx)]);
      logger.info(`[Sync] follower playlist realigned to start at ${localUrl.split('/').pop()}`);
    } else {
      setPlaylist(localPlaylist);
    }

    _cfg.onStatus(`Follower — preparing: ${localUrl.split('/').pop()}`);
    logger.info(`[Sync] LOAD_URL → local: ${localUrl.split('/').pop()} (leader sent: ${String(msg['url'] ?? '').split('/').pop()})`);

    _cfg.prepareEngine(localUrl).then(() => {
      if (_stopped) return;
      logger.info('[Sync] follower READY — sending READY');
      _cfg.onStatus('Follower — READY sent, waiting for GO…');
      _wsSend({ type: 'READY' });
    }).catch((e: unknown) => {
      logger.error(`[Sync] follower prepare failed: ${(e as Error)?.message} — retry in 3s`);
      if (!_stopped) setTimeout(() => { _loadReceived = false; }, 3000);
    });
    return;
  }

  if (msg['type'] === 'READY') {
    if (_role !== 'leader') return;
    _followerReady.add(from);
    logger.info(`[Sync] READY from ${from} (${_followerReady.size}/${_peers.length})`);
    _checkAllReady();
    return;
  }

  if (msg['type'] === 'GO') {
    if (_role !== 'follower') return;
    const serverAt = Number(msg['playAt']);
    const localPlay = _serverToLocal(serverAt) + _selfLatency;
    logger.info(`[Sync] GO → play in T-${Math.round(localPlay - Date.now())}ms`);
    _cfg.schedulePlay(localPlay);
    _startPhase();
    return;
  }

  if (msg['type'] === 'PLAYHEAD') {
    _peerHeads.set(from, {
      serverNow: Number(msg['serverNow']),
      posMs: Number(msg['posMs']),
      at: Date.now(),
    });
    return;
  }

  if (msg['type'] === 'LOOP_GO') {
    const serverAt = Number(msg['playAt']);
    const localPlayAt = _serverToLocal(serverAt);
    logger.info(`[Sync] LOOP_GO → play in T-${Math.round(localPlayAt - Date.now())}ms`);
    _cfg.schedulePlay(localPlayAt);
    _phaseStartedAt = Date.now(); _ewma = 0; _ewmaN = 0;
    return;
  }
}

// ── Leader flow ───────────────────────────────────────────────────────────────

async function _runLeader(): Promise<void> {
  _cfg.onStatus('Leader — fetching video URL…');
  const url = _cfg.fetchVideoUrl ? await _cfg.fetchVideoUrl() : await _fetchVideoUrl();
  logger.info(`[Sync] leader video: ${url}`);
  const _leaderAllUrls = getPlaylistUrls();
  const _leaderIdx = _leaderAllUrls.indexOf(url);
  _wsSend({ type: 'LOAD_URL', url, index: _leaderIdx >= 0 ? _leaderIdx : 0 });

  _cfg.onStatus('Leader — preparing engine…');
  _cfg.prepareEngine(url).then(() => {
    if (_stopped) return;
    logger.info('[Sync] leader engine READY');
    _leaderReady = true;
    _cfg.onStatus(`Leader ready — waiting for ${_peers.length} follower(s)…`);
    _checkAllReady();
  }).catch((e: unknown) => {
    logger.error(`[Sync] leader prepare failed: ${(e as Error)?.message} — retry in 5s`);
    if (!_stopped) setTimeout(() => { if (!_stopped) _runLeader(); }, 5000);
  });
}

function _checkAllReady(): void {
  if (!_leaderReady || _followerReady.size < _peers.length || _goSent || _stopped) return;
  _goSent = true;
  const localPlay = Date.now() + GO_AHEAD_MS;
  const serverPlay = _localToServer(localPlay);
  const dur = _cfg.getEngineDuration();
  logger.info(`[Sync] ALL READY → GO epoch=${serverPlay} dur=${dur}ms`);
  _wsSend({ type: 'GO', playAt: serverPlay, durationMs: dur });
  _cfg.schedulePlay(localPlay + _selfLatency);
  _startPhase();
}

function _startPeerWatch(): void {
  if (_peerWatchTimer || _stopped) return;
  _peerWatchTimer = setInterval(_peerScan, LEADER_SCAN_MS);
}
function _stopPeerWatch(): void {
  if (_peerWatchTimer) { clearInterval(_peerWatchTimer); _peerWatchTimer = null; }
}
function _peerScan(): void {
  if (_stopped || _resyncInProgress || _role !== 'leader') return;
  const joiners = _peers.filter((id) => !_followerReady.has(id));
  if (joiners.length === 0) return;
  logger.info(`[Sync] new follower(s): [${joiners.join(',')}] — resyncing`);
  _resyncLeader().catch(() => {});
}
async function _resyncLeader(): Promise<void> {
  if (_resyncInProgress || _stopped) return;
  _resyncInProgress = true;
  try {
    _stopPhase();
    _leaderReady = false; _followerReady = new Set(); _goSent = false;
    if (_cfg.restartEngine) { try { _cfg.restartEngine(); } catch {} }
    if (_playlistUrls.length > 0) setPlaylist(_playlistUrls);
    await _runLeader();
  } finally { _resyncInProgress = false; }
}

// ── PLAYHEAD heartbeat ────────────────────────────────────────────────────────

function _startPhase(): void {
  if (_phaseTimer) return;
  _phaseStartedAt = Date.now(); _peerHeads = new Map(); _ewma = 0; _ewmaN = 0;
  _phaseTimer = setInterval(_phaseTick, PLAYHEAD_TICK_MS);
}
function _stopPhase(): void {
  if (_phaseTimer) { clearInterval(_phaseTimer); _phaseTimer = null; }
}
function _phaseTick(): void {
  if (_stopped || !engineIsPlaying()) return;
  const pos = getCurrentPosMs();
  const serverNow = _localToServer(Date.now());
  _wsSend({ type: 'PLAYHEAD', serverNow, posMs: pos });
}

// ── Video URL helpers ─────────────────────────────────────────────────────────

async function _fetchVideoUrl(): Promise<string> {
  // The leader's video URL comes from the playlist seeded by the player.
  const urls = getPlaylistUrls();
  if (urls.length > 0) return urls[0]!;
  // Fallback: never reached in normal operation.
  throw new Error('[Sync] no playlist URL available');
}

async function _fetchPlaylistUrls(): Promise<string[]> {
  return getPlaylistUrls();
}
