/**
 * sync.ts — 3-phase group sync protocol
 *
 * Phase 1 — LOAD_URL:  leader → each follower: "load this video"
 * Phase 2 — READY:     each device → leader:   "my engine is prepared"
 * Phase 3 — GO:        leader → each follower: "play at this absolute epoch ms"
 *
 * Role election: peer with lowest registeredAt = leader (auto, no tie-break needed
 * since registration timestamps will differ by at least network RTT).
 *
 * Clock sync: NONE required. Samsung Tizen TVs sync NTP at OS level.
 * Date.now() is shared across all TVs on the same LAN within ~20ms.
 * The GO message adds GO_AHEAD_MS (6000ms) headroom so all devices
 * comfortably hit the same play epoch despite load variance.
 *
 * Signal transport: existing Pi relay  POST /test-sync/signal/:target
 *                                       GET  /test-sync/signals/:id?since=N
 * Poll loop: sequential async loop, 500ms sleep, 2s abort per fetch.
 * No in-flight guard — a new fetch always starts after the previous one
 * either completes or times out.
 */
import { logger } from './logger.js';
import { measureOffset, getOffsetMs, localToServer, serverToLocal } from './clock.js';

// ── Types ──────────────────────────────────────────────────────────────────────

type SyncMsg =
  | { type: 'LOAD_URL'; url: string }
  | { type: 'READY' }
  | { type: 'GO'; playAt: number; durationMs: number };

export interface SyncConfig {
  piBase:        string;
  groupId:       string;
  deviceId:      string;
  selfIp:        string;
  expectedPeers: number;
  onStatus:      (msg: string) => void;
  // Engine callbacks — injected by app.ts (routes to AVPlay or HTML5 depending on active mode)
  prepareEngine:     (url: string) => Promise<void>;
  schedulePlay:      (epochMs: number) => void;
  getEngineDuration: () => number;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const GO_AHEAD_MS    = 6000;  // leader schedules play this far ahead so followers can spin-wait
const FETCH_TIMEOUT  = 2000;  // abort individual fetches after this long
const POLL_SLEEP_MS  = 500;   // gap between signal polls
const REGISTER_EVERY = 5000;  // re-register heartbeat interval
const SEND_RETRIES   = 6;     // max attempts to send a signal
const SEND_RETRY_MS  = 2000;  // delay between send retries

// ── State ──────────────────────────────────────────────────────────────────────

let _cfg:   SyncConfig;
let _role: string = 'pending';
let _peers: string[] = [];
let _stopped = false;
let _pollSince = 0;

// Leader
let _leaderEngineReady   = false;
let _followerReadySet    = new Set<string>();
let _goSent              = false;

// Follower
let _loadReceived = false;

// ── Public ────────────────────────────────────────────────────────────────────

export async function init(cfg: SyncConfig): Promise<void> {
  _cfg     = cfg;
  _stopped = false;
  _role    = 'pending';
  _peers   = [];
  _pollSince = 0;
  _leaderEngineReady = false;
  _followerReadySet  = new Set();
  _goSent            = false;
  _loadReceived      = false;

  logger.info(`[Sync] init deviceId=${cfg.deviceId} group=${cfg.groupId}`);
  cfg.onStatus('Registering with relay…');

  await _register();
  setInterval(_register, REGISTER_EVERY);

  // Measure clock offset vs Pi relay so leader/follower share a canonical clock.
  // Without this, each TV's independent NTP sync introduces 20-60ms skew that
  // shows up as a constant inter-TV play offset.
  cfg.onStatus('Measuring clock offset…');
  await measureOffset(cfg.piBase);
  // Re-measure every 60s to track slow drift.
  setInterval(() => { measureOffset(cfg.piBase).catch(() => {}); }, 60_000);

  // Heartbeat: log role + peer state every 10s so Pi logs always show device is alive
  setInterval(() => {
    logger.info(`[Sync] heartbeat role=${_role} peers=[${_peers.join(',')}] stopped=${_stopped}`);
  }, 10_000);

  cfg.onStatus(`Waiting for ${cfg.expectedPeers} peers…`);
  await _waitForPeers();
  logger.info(`[Sync] role=${_role} peers=[${_peers.join(', ')}]`);
  cfg.onStatus(`Role: ${_role} — peer(s): ${_peers.join(', ')}`);

  // Start polling before acting so we never miss a signal
  _startPoll();

  if (_role === 'leader') {
    await _runLeader();
  } else {
    cfg.onStatus('Follower — waiting for LOAD_URL from leader…');
  }
}

export function stop(): void {
  _stopped = true;
  logger.info('[Sync] stopped');
}

// ── Leader flow ────────────────────────────────────────────────────────────────

async function _runLeader(): Promise<void> {
  _cfg.onStatus('Leader — fetching video URL…');
  const url = await _fetchVideoUrl();
  logger.info(`[Sync] leader video URL: ${url}`);

  // Send LOAD_URL to every follower
  for (const peer of _peers) {
    _send(peer, { type: 'LOAD_URL', url });
  }

  // Prepare own engine in parallel (doesn't block waiting for follower READY)
  _cfg.onStatus('Leader — preparing engine…');
  _cfg.prepareEngine(url)
    .then(() => {
      if (_stopped) return;
      logger.info('[Sync] leader engine READY');
      _leaderEngineReady = true;
      _cfg.onStatus(`Leader ready — waiting for followers (${_followerReadySet.size}/${_peers.length})…`);
      _checkAllReady();
    })
    .catch((e: any) => {
      logger.error(`[Sync] leader engine prepare failed: ${e?.message} — restarting in 5s`);
      // Re-run the entire leader flow after a delay so media is retried
      if (!_stopped) setTimeout(() => { if (!_stopped) _runLeader(); }, 5000);
    });
}

function _checkAllReady(): void {
  if (!_leaderEngineReady || _followerReadySet.size < _peers.length || _goSent || _stopped) return;
  _goSent = true;

  const localPlayAt  = Date.now() + GO_AHEAD_MS;
  const serverPlayAt = localToServer(localPlayAt);
  const durationMs   = _cfg.getEngineDuration();
  logger.info(`[Sync] ALL READY → GO localPlayAt=${localPlayAt} serverPlayAt=${serverPlayAt} offset=${getOffsetMs()}ms (+${GO_AHEAD_MS}ms) durationMs=${durationMs}`);
  _cfg.onStatus(`ALL READY — play in ${GO_AHEAD_MS / 1000}s (server epoch ${serverPlayAt})`);

  // GO carries SERVER time; each follower converts to its own local clock.
  for (const peer of _peers) {
    _send(peer, { type: 'GO', playAt: serverPlayAt, durationMs });
  }
  // Leader uses local time directly — no conversion needed for self.
  _cfg.schedulePlay(localPlayAt);
}

// ── Signal dispatch ────────────────────────────────────────────────────────────

function _dispatch(msg: SyncMsg, from: string): void {
  logger.info(`[Sync] ← ${msg.type} from=${from}`);

  if (msg.type === 'LOAD_URL') {
    if (_role !== 'follower') return;
    if (_loadReceived) { logger.info('[Sync] LOAD_URL duplicate — ignored'); return; }
    _loadReceived = true;
    _cfg.onStatus(`Follower — preparing engine: ${(msg as any).url.split('/').pop()}`);
    _cfg.prepareEngine((msg as any).url)
      .then(() => {
        if (_stopped) return;
        logger.info('[Sync] follower engine READY — sending READY to all peers');
        _cfg.onStatus('Follower — READY sent, waiting for GO…');
        for (const peer of _peers) {
          _send(peer, { type: 'READY' });
        }
      })
      .catch((e: any) => {
        logger.error(`[Sync] follower prepare failed: ${e?.message} — retrying in 3s`);
        if (!_stopped) {
          setTimeout(() => {
            _loadReceived = false; // allow re-dispatch on next LOAD_URL
            logger.info('[Sync] follower ready for retry');
          }, 3000);
        }
      });
    return;
  }

  if (msg.type === 'READY') {
    if (_role !== 'leader') return;
    _followerReadySet.add(from);
    logger.info(`[Sync] follower READY: ${from} (${_followerReadySet.size}/${_peers.length})`);
    _cfg.onStatus(`Leader — ${_followerReadySet.size}/${_peers.length} follower(s) ready`);
    _checkAllReady();
    return;
  }

  if (msg.type === 'GO') {
    if (_role !== 'follower') return;
    const serverPlayAt = (msg as any).playAt;
    const localPlayAt  = serverToLocal(serverPlayAt);
    const wait         = localPlayAt - Date.now();
    logger.info(`[Sync] GO → schedulePlay in T-${Math.round(wait)}ms (serverEpoch=${serverPlayAt} localEpoch=${localPlayAt} offset=${getOffsetMs()}ms)`);
    _cfg.onStatus(`GO received — playing in ${(Math.round(wait / 100) * 100) / 1000}s`);
    _cfg.schedulePlay(localPlayAt);
    return;
  }
}

// ── Signal poll (sequential async loop) ───────────────────────────────────────

function _startPoll(): void {
  (async function poll() {
    while (!_stopped) {
      try {
        const res = await _fetchTimeout(
          `${_cfg.piBase}/api/v1/test-sync/signals/${_cfg.deviceId}?since=${_pollSince}`,
        );
        if (res.ok) {
          const data = await res.json();
          for (const entry of (data.entries ?? [])) {
            _pollSince = entry.idx + 1;
            if (entry.body) _dispatch(entry.body as SyncMsg, String(entry.from ?? ''));
          }
        }
      } catch { /* transient network error — keep looping */ }
      await _sleep(POLL_SLEEP_MS);
    }
  })();
}

// ── Signal send (with automatic retry) ────────────────────────────────────────

async function _send(targetId: string, body: SyncMsg, attempt = 0): Promise<void> {
  if (_stopped) return;
  try {
    const res = await _fetchTimeout(`${_cfg.piBase}/api/v1/test-sync/signal/${targetId}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ from: _cfg.deviceId, seq: attempt, body }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    logger.info(`[Sync] -> ${body.type} to ${targetId} (attempt ${attempt})`);
  } catch (e: any) {
    logger.warn(`[Sync] send ${body.type} to ${targetId} failed (attempt ${attempt}): ${e?.message}`);
    if (attempt < SEND_RETRIES && !_stopped) {
      setTimeout(() => _send(targetId, body, attempt + 1), SEND_RETRY_MS);
    }
  }
}

// ── Peer discovery ─────────────────────────────────────────────────────────────

async function _waitForPeers(): Promise<void> {
  while (!_stopped) {
    try {
      const res = await _fetchTimeout(
        `${_cfg.piBase}/api/v1/test-sync/peers?groupId=${_cfg.groupId}`,
      );
      if (res.ok) {
        const { peers = [] } = await res.json() as {
          peers: Array<{ deviceId: string; registeredAt: number }>;
        };

        // Only count peers registered (or re-registered) within the last 30s.
        // Devices re-register every REGISTER_EVERY=5000ms, so anything older is
        // a stale entry from a previous boot and must not be counted.
        const fresh = peers.filter((p) => Date.now() - p.registeredAt < 30_000);

        if (fresh.length >= _cfg.expectedPeers) {
          // Deterministic: lexicographically LAST device ID = leader.
          // This never races with re-registration timestamps.
          const sorted = [...fresh].sort((a, b) => a.deviceId < b.deviceId ? -1 : 1);
          _role  = sorted[sorted.length - 1].deviceId === _cfg.deviceId ? 'leader' : 'follower';
          _peers = fresh.filter((p) => p.deviceId !== _cfg.deviceId).map((p) => p.deviceId);
          logger.info(`[Sync] role=${_role} peers=[${_peers.join(',')}]`);
          return;
        }
        logger.info(`[Sync] waiting ${fresh.length}/${_cfg.expectedPeers} fresh peers`);
      }
    } catch (e: any) {
      logger.warn(`[Sync] peer poll: ${e?.message}`);
    }
    await _sleep(1000);
  }
}

async function _register(): Promise<void> {
  if (_stopped) return;
  try {
    await _fetchTimeout(`${_cfg.piBase}/api/v1/test-sync/register`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        deviceId:  _cfg.deviceId,
        role:      _role,
        ip:        _cfg.selfIp,
        groupId:   _cfg.groupId,
      }),
    });
  } catch { /* best-effort */ }
}

// ── Video URL ──────────────────────────────────────────────────────────────────

async function _fetchVideoUrl(): Promise<string> {
  try {
    const res = await _fetchTimeout(`${_cfg.piBase}/api/v1/content?type=video&limit=1`, {}, 5000);
    if (res.ok) {
      const data = await res.json();
      const items = data.items ?? data.content ?? data.data ?? [];
      const url = items[0]?.url ?? items[0]?.fileUrl ?? '';
      if (url) { logger.info(`[Sync] video URL from API: ${url}`); return url; }
    }
  } catch (e: any) {
    logger.warn(`[Sync] fetchVideoUrl failed: ${e?.message}`);
  }
  // Fallback — use media bundled inside the WGT package
  const fallback = 'media/signage.mp4';
  logger.warn(`[Sync] using bundled fallback: ${fallback}`);
  return fallback;
}

// ── Util ───────────────────────────────────────────────────────────────────────

function _sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Fetch with a manual timeout. Uses Promise.race() so it works on Tizen 4
 * which does not have AbortController.
 */
async function _fetchTimeout(url: string, opts?: RequestInit, timeoutMs = FETCH_TIMEOUT): Promise<Response> {
  const timeout = new Promise<never>((_, rej) =>
    setTimeout(() => rej(new Error(`fetch timeout (${timeoutMs}ms): ${url}`)), timeoutMs),
  );
  return Promise.race([fetch(url, opts), timeout]);
}
