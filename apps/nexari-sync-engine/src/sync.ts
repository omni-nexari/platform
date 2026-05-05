/**
 * sync.ts — WebSocket-based group sync protocol
 *
 * Transport: native browser WebSocket → relay running on QBC:9616 (logic.js).
 * All signaling travels over a single persistent WS connection. The relay
 * broadcasts each message to every other client in the same groupId.
 *
 * Protocol:
 *   WS_REGISTER  client → server  "I'm here, add me to group"
 *   PEERS        server → client  "current peer list"
 *   PING         client → server  clock offset measurement
 *   PONG         server → client  echo with server timestamp
 *   LOAD_URL     leader → follower  "load and prebuffer this URL"
 *   READY        follower → leader  "prebuffered, ready to play"
 *   GO           leader → all      "play at this epoch (server time)"
 *   PLAYHEAD     any → any         push every 600ms — pos + serverNow (monitoring only)
 *   LOOP_READY   client → relay    "I have prebuffered at frame 0, ready for loop"
 *   LOOP_GO      relay → all       "play NOW at this epoch (server time)"
 *
 * Clock sync: WS PING/PONG (mini-NTP, same math as clock.ts but over WS).
 * Leader election: lexicographically highest deviceId = leader.
 * Loop sync: barrier pattern -- all devices send LOOP_READY; relay broadcasts
 *   LOOP_GO when all are ready; all call playFromPrebuffer() simultaneously.
 */
import { logger } from './logger.js';
import {
  getCurrentPosMs, playFromPrebuffer, setOnLoop, setRole, setPlaylist,
  isPlaying as engineIsPlaying, getDuration as engineGetDuration,
} from './engine.js';

// ── Types ──────────────────────────────────────────────────────────────────────

interface PeerInfo { deviceId: string; ip: string; registeredAt: number; }

export interface SyncConfig {
  wsUrl:         string;   // e.g. "ws://192.168.1.11:9616"
  groupId:       string;
  deviceId:      string;
  selfIp:        string;
  expectedPeers: number;
  onStatus:      (msg: string) => void;
  prepareEngine:     (url: string) => Promise<void>;
  schedulePlay:      (epochMs: number) => void;
  getEngineDuration: () => number;
  restartEngine?:    () => void;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const CLOCK_SAMPLES      = 7;
const CLOCK_RESYNC_MS    = 60_000;
const GO_AHEAD_MS        = 5000;

const PLAYHEAD_TICK_MS   = 600;   // faster ticks → <50ms steady-state accuracy
const PEER_FRESH_MS      = 4000;
const NUDGE_THRESHOLD_MS = 8;
const NUDGE_DAMPING      = 0.6;
const NUDGE_CAP_MS       = 150;
const NUDGE_COOLDOWN_MS  = 2500;
const DRIFT_SKIP_MS      = 14_000;
const CAL_GRACE_MS       = 4000;
const CAL_EWMA_ALPHA     = 0.2;

const DEVICE_LATENCY_MS: Record<string, number> = {
  'tizen7.0-mac-28af427a99db': 0,
  'tizen4.0-mac-d49dc0aa111b': 30,
};

const WS_RECONNECT_MS = 2000;
const LEADER_SCAN_MS  = 4000;

// ── State ──────────────────────────────────────────────────────────────────────

let _cfg: SyncConfig;
let _ws: WebSocket | null = null;
let _wsReady  = false;
let _stopped  = false;

let _role: 'pending' | 'leader' | 'follower' = 'pending';
let _peers: string[] = [];

let _offsetMs    = 0;
let _selfLatency = 0;

let _leaderReady   = false;
let _followerReady = new Set<string>();
let _goSent        = false;
let _loadReceived  = false;

let _phaseTimer:  any = null;
let _phaseStartedAt   = 0;
let _peerHeads = new Map<string, { serverNow: number; posMs: number; at: number }>();
let _cooldownUntil    = 0;
let _ewma  = 0;
let _ewmaN = 0;

let _peerWatchTimer: any  = null;
let _resyncInProgress     = false;
let _playlistUrls: string[] = [];

// ── Public ─────────────────────────────────────────────────────────────────────

export async function init(cfg: SyncConfig): Promise<void> {
  _cfg = cfg; _stopped = false; _role = 'pending'; _peers = [];
  _leaderReady = false; _followerReady = new Set(); _goSent = false; _loadReceived = false;
  _phaseStartedAt = 0; _ewma = 0; _ewmaN = 0;
  _selfLatency = DEVICE_LATENCY_MS[cfg.deviceId] ?? 0;

  logger.info(`[Sync] init deviceId=${cfg.deviceId} group=${cfg.groupId} selfLatency=${_selfLatency}ms`);
  cfg.onStatus('Connecting to relay…');

  // Wire loop callback: when engine finishes prebuffering at frame 0, send
  // LOOP_READY to the relay. The relay collects all devices and broadcasts
  // LOOP_GO when all are ready, triggering simultaneous playFromPrebuffer().
  setOnLoop(() => {
    if (!_stopped) {
      logger.info('[Sync] prebuffer ready -- sending LOOP_READY');
      _wsSend({ type: 'LOOP_READY', groupId: _cfg.groupId, deviceId: _cfg.deviceId });
    }
  });

  await _connectWs();
  await _measureClock();
  // Early re-syncs to correct any initial clock offset error (observed ~15s drift on QBC).
  // The first re-sync at 3s fires before the GO countdown (5s), so PLAYHEAD ticks
  // start with a corrected offset.
  setTimeout(() => { if (!_stopped) _measureClock().catch(() => {}); }, 3_000);
  setTimeout(() => { if (!_stopped) _measureClock().catch(() => {}); }, 10_000);
  setInterval(() => { if (!_stopped) _measureClock().catch(() => {}); }, CLOCK_RESYNC_MS);
  setInterval(() => {
    logger.info(`[Sync] heartbeat role=${_role} peers=[${_peers.join(',')}] stopped=${_stopped}`);
  }, 10_000);

  cfg.onStatus(`Waiting for ${cfg.expectedPeers} peers…`);
  await _waitPeers();

  logger.info(`[Sync] role=${_role} peers=[${_peers.join(', ')}]`);
  cfg.onStatus(`Role: ${_role} — peer(s): ${_peers.join(', ')}`);

  // Tell engine which display mode to use (leader=QBC portrait, follower=SBB landscape)
  const resolvedRole = _role as 'leader' | 'follower';
  setRole(resolvedRole);

  // Resolve full playlist so the engine can advance through clips at each EOS.
  // Both devices do this independently; they stay in sync via the barrier pattern.
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
        ws.onerror  = () => { logger.warn('[Sync] WS error'); };
        ws.onclose  = () => {
          _wsReady = false;
          logger.warn('[Sync] WS closed — reconnecting…');
          if (!_stopped) setTimeout(attempt, WS_RECONNECT_MS);
        };
      } catch (e: any) {
        logger.error(`[Sync] WS open failed: ${e?.message}`);
        if (!_stopped) setTimeout(attempt, WS_RECONNECT_MS);
      }
    };
    attempt();
  });
}

function _wsSend(msg: object): void {
  if (!_ws || !_wsReady || _ws.readyState !== 1 /* OPEN */) return;
  try { _ws.send(JSON.stringify(msg)); } catch {}
}

// ── Clock sync (PING/PONG over WS) ────────────────────────────────────────────

function _measureClock(): Promise<void> {
  return new Promise((resolve) => {
    const results: { offset: number; rtt: number }[] = [];
    let remaining = CLOCK_SAMPLES;

    const finish = () => {
      if (results.length === 0) { resolve(); return; }
      results.sort((a, b) => a.rtt - b.rtt);
      _offsetMs = results[0].offset;
      const summary = results.map((r) => `rtt=${r.rtt}ms off=${r.offset}ms`).join('; ');
      logger.info(`[Clock] WS offset=${_offsetMs}ms bestRtt=${results[0].rtt}ms samples=${results.length} | ${summary}`);
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

// ── Peer discovery ─────────────────────────────────────────────────────────────

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

// ── Message dispatch ───────────────────────────────────────────────────────────

function _dispatch(msg: any): void {
  const from: string = msg.from ?? 'relay';

  if (msg.type === 'PONG') return; // consumed by clock measurement listeners

  if (msg.type === 'PEERS' || msg.type === 'HEARTBEAT_PEERS') {
    const list: string[] = msg.type === 'PEERS'
      ? (msg.peers as PeerInfo[]).map((p) => p.deviceId)
      : (msg.peers as string[]);
    const others = list.filter((id) => id !== _cfg.deviceId);
    if (JSON.stringify(others) !== JSON.stringify(_peers)) {
      // Clear followerReady for any peer that just dropped so _peerScan triggers resync.
      const dropped = _peers.filter((id) => !others.includes(id));
      dropped.forEach((id) => _followerReady.delete(id));
      _peers = others;
      logger.info(`[Sync] peers: [${_peers.join(', ')}]`);
    }
    return;
  }

  logger.info(`[Sync] ← ${msg.type} from=${from}`);

  if (msg.type === 'LOAD_URL') {
    if (_role !== 'follower') return;
    if (_loadReceived) { logger.info('[Sync] LOAD_URL dup — ignored'); return; }
    _loadReceived = true;
    _cfg.onStatus(`Follower — preparing: ${msg.url.split('/').pop()}`);
    _cfg.prepareEngine(msg.url)
      .then(() => {
        if (_stopped) return;
        logger.info('[Sync] follower READY — sending READY');
        _cfg.onStatus('Follower — READY sent, waiting for GO…');
        _wsSend({ type: 'READY' });
      })
      .catch((e: any) => {
        logger.error(`[Sync] follower prepare failed: ${e?.message} — retry in 3s`);
        if (!_stopped) setTimeout(() => { _loadReceived = false; }, 3000);
      });
    return;
  }

  if (msg.type === 'READY') {
    if (_role !== 'leader') return;
    _followerReady.add(from);
    logger.info(`[Sync] READY from ${from} (${_followerReady.size}/${_peers.length})`);
    _cfg.onStatus(`Leader — ${_followerReady.size}/${_peers.length} follower(s) ready`);
    _checkAllReady();
    return;
  }

  if (msg.type === 'GO') {
    if (_role !== 'follower') return;
    const localPlay = _serverToLocal(msg.playAt) + _selfLatency;
    const wait      = localPlay - Date.now();
    logger.info(`[Sync] GO → play in T-${Math.round(wait)}ms (serverEpoch=${msg.playAt} offset=${_offsetMs}ms latency=${_selfLatency}ms)`);
    _cfg.onStatus(`GO received — playing in ${(Math.round(wait / 100) * 100) / 1000}s`);
    _cfg.schedulePlay(localPlay);
    _startPhase();
    return;
  }

  if (msg.type === 'PLAYHEAD') {
    _peerHeads.set(from, { serverNow: msg.serverNow, posMs: msg.posMs, at: Date.now() });
    // Log for monitoring only — no drift correction (barrier sync handles alignment)
    return;
  }

  if (msg.type === 'LOOP_GO') {
    // Relay has confirmed all devices are prebuffered — play simultaneously.
    const localPlayAt = _serverToLocal(msg.playAt);
    const wait = Math.round(localPlayAt - Date.now());
    logger.info(`[Sync] LOOP_GO playAt=${msg.playAt} localPlayAt=${localPlayAt} T-${wait}ms`);
    _cfg.onStatus(`LOOP_GO -- playing in ${(Math.round(wait / 100) * 100) / 1000}s`);
    _cfg.schedulePlay(localPlayAt);
    // Reset phase tracker so PLAYHEAD monitoring starts fresh after loop boundary
    _phaseStartedAt = Date.now(); _ewma = 0; _ewmaN = 0;
    return;
  }
}

// ── Leader flow ────────────────────────────────────────────────────────────────

async function _runLeader(): Promise<void> {
  _cfg.onStatus('Leader — fetching video URL…');
  const url = await _fetchVideoUrl();
  logger.info(`[Sync] leader video: ${url}`);

  // Broadcast LOAD_URL to all followers
  _wsSend({ type: 'LOAD_URL', url });

  _cfg.onStatus('Leader — preparing engine…');
  _cfg.prepareEngine(url)
    .then(() => {
      if (_stopped) return;
      logger.info('[Sync] leader engine READY');
      _leaderReady = true;
      _cfg.onStatus(`Leader ready — waiting for ${_peers.length} follower(s)…`);
      _checkAllReady();
    })
    .catch((e: any) => {
      logger.error(`[Sync] leader prepare failed: ${e?.message} — retry in 5s`);
      if (!_stopped) setTimeout(() => { if (!_stopped) _runLeader(); }, 5000);
    });
}

function _checkAllReady(): void {
  if (!_leaderReady || _followerReady.size < _peers.length || _goSent || _stopped) return;
  _goSent = true;
  const localPlay  = Date.now() + GO_AHEAD_MS;
  const serverPlay = _localToServer(localPlay);
  const dur        = _cfg.getEngineDuration();
  logger.info(`[Sync] ALL READY → GO epoch=${serverPlay} dur=${dur}ms`);
  _cfg.onStatus(`ALL READY — play in ${GO_AHEAD_MS / 1000}s`);
  _wsSend({ type: 'GO', playAt: serverPlay, durationMs: dur });
  _cfg.schedulePlay(localPlay + _selfLatency);
  _startPhase();
}

// ── Leader peer watcher ────────────────────────────────────────────────────────

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
  _cfg.onStatus(`New follower (${joiners.join(',')}) — resyncing…`);
  _resyncLeader().catch(() => {});
}

async function _resyncLeader(): Promise<void> {
  if (_resyncInProgress || _stopped) return;
  _resyncInProgress = true;
  try {
    _stopPhase();
    _leaderReady = false; _followerReady = new Set(); _goSent = false;
    if (_cfg.restartEngine) { try { _cfg.restartEngine(); } catch {} }
    await _runLeader();
  } finally { _resyncInProgress = false; }
}

// ── PLAYHEAD heartbeat + drift correction ──────────────────────────────────────

function _startPhase(): void {
  if (_phaseTimer) return;
  _phaseStartedAt = Date.now(); _peerHeads = new Map();
  _ewma = 0; _ewmaN = 0; _cooldownUntil = 0;
  _phaseTimer = setInterval(_phaseTick, PLAYHEAD_TICK_MS);
  logger.info('[Sync] PLAYHEAD heartbeat started');
}

function _stopPhase(): void {
  if (_phaseTimer) { clearInterval(_phaseTimer); _phaseTimer = null; }
}

function _phaseTick(): void {
  if (_stopped || !engineIsPlaying()) return;
  const pos = getCurrentPosMs();
  if (pos == null) return;
  const now       = Date.now();
  const serverNow = _localToServer(now);
  const duration  = engineGetDuration();
  if (duration <= 0) return;

  // Broadcast PLAYHEAD for monitoring/logging only (no drift correction).
  _wsSend({ type: 'PLAYHEAD', serverNow, posMs: pos });

  if (_peers.length > 0) {
    const ph = _peerHeads.get(_peers[0]);
    if (ph && now - ph.at <= PEER_FRESH_MS) {
      const projected = ((ph.posMs + (serverNow - ph.serverNow)) % duration + duration) % duration;
      let drift = pos - projected;
      if (drift >  duration / 2) drift -= duration;
      if (drift < -duration / 2) drift += duration;
      logger.info(`[Sync] PLAYHEAD drift=${Math.round(drift)}ms pos=${pos}ms peer=${Math.round(projected)}ms`);
    }
  }
}

// ── Video URL ──────────────────────────────────────────────────────────────────

// ── Video URL resolution ───────────────────────────────────────────────────────

/**
 * Resolve a single bundled media filename to an absolute file:/// URI.
 * Tizen 5+: synchronous toURI().  Tizen 4: async two-step resolve().
 */
function _resolveBundledUrl(filename: string): Promise<string> {
  const FALLBACK = `file:///opt/usr/apps/fmDBbBnvJM.NexariSyncEngine/res/wgt/media/${filename}`;
  const tz = (window as any).tizen;
  // Tizen 5+ synchronous path
  try {
    if (typeof tz?.filesystem?.toURI === 'function') {
      const uri = tz.filesystem.toURI(`wgt-package/media/${filename}`) as string;
      if (uri && uri.startsWith('file:///')) return Promise.resolve(uri);
    }
  } catch {}
  // Tizen 4 async two-step path
  return new Promise<string>((res) => {
    try {
      tz.filesystem.resolve(
        'wgt-package',
        (rootFile: any) => {
          try {
            const mediaFile = rootFile.resolve(`media/${filename}`);
            res(typeof mediaFile?.toURI === 'function' ? mediaFile.toURI() : FALLBACK);
          } catch { res(FALLBACK); }
        },
        () => res(FALLBACK),
        'r',
      );
    } catch { res(FALLBACK); }
  });
}

/**
 * Resolve the ordered playlist of bundled clips.
 * Falls back to the API content URL as a single-item playlist if the API responds.
 */
async function _fetchPlaylistUrls(): Promise<string[]> {
  try {
    const res = await fetch(
      'http://192.168.1.17/api/v1/display/content?format=sync',
      { signal: AbortSignal.timeout(3000) } as any,
    );
    if (res.ok) {
      const data = await res.json();
      if (data?.url) {
        logger.info(`[Sync] playlist from API: ${data.url}`);
        return [data.url as string];
      }
    }
  } catch {}
  // Bundled playlist
  const files = ['1.mp4', '2.mp4', '3.mp4'];
  const urls  = await Promise.all(files.map((f) => _resolveBundledUrl(f)));
  logger.info(`[Sync] playlist (bundled): ${urls.map((u) => u.split('/').pop()).join(', ')}`);
  return urls;
}

async function _fetchVideoUrl(): Promise<string> {
  if (_playlistUrls.length > 0) return _playlistUrls[0];
  const urls = await _fetchPlaylistUrls();
  return urls[0];
}

