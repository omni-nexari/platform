/**
 * wall-sync.ts — P2P WebSocket group sync for nexari-tizen videowall
 *
 * Adapted from apps/nexari-sync-engine/src/sync.ts for the main player.
 *
 * Transport: native browser WebSocket → Node relay running on the leader TV
 *   (b2bapis.b2bcontrol.startNodeServer loads js/logic.js on port 9616).
 *   All WS signalling travels to/from ws://<leaderIp>:9616.
 *
 * Protocol messages:
 *   WS_REGISTER  client → relay   "I'm here, add me to group"
 *   PEERS        relay → client   "current peer list"
 *   PING         client → relay   clock offset sample t1
 *   PONG         relay → client   echo with server timestamp t2
 *   LOAD_URL     leader → all     "prebuffer this URL"
 *   READY        follower → relay "prebuffered, waiting for GO"
 *   GO           leader → all     "play at this server epoch"
 *   LOOP_READY   client → relay   "prebuffered at frame 0, barrier ready"
 *   LOOP_GO      relay → all      "play NOW at this server epoch"
 *   PLAYHEAD     any → any        playhead position for monitoring (no correction)
 *
 * Clock sync: PING/PONG mini-NTP over the same WS connection (7 samples,
 *   min-RTT selected). Converts server epochs ↔ local Date.now().
 *
 * Leader election: lexicographically highest deviceId (UUID from DB).
 *   The leader also hosts the Node relay.
 *
 * Loop sync: barrier pattern — all devices send LOOP_READY; relay broadcasts
 *   LOOP_GO when all are ready; all call WallEngine.schedulePlayAt() simultaneously.
 *
 * Live-join resync: if a new follower connects after GO was sent, the leader
 *   detects it via PEERS and restarts the round (LOAD_URL → READY → GO).
 *
 * TypeScript namespace, compiled with module:none — loaded as a plain <script>
 * in index.html AFTER wall-engine.js and BEFORE player.js.
 *
 * Runtime globals used:
 *   WallEngine — the wall-engine.ts namespace
 *   logger     — shared logger instance (defined in player.ts before this script)
 */
namespace WallSync {

  export interface WallSyncConfig {
    /** WebSocket URL of the on-TV relay, e.g. "ws://192.168.1.11:9616" */
    wsUrl:         string;
    /** Device-group UUID from VIDEOWALL_INIT */
    groupId:       string;
    /** This device's UUID (from device.id) */
    deviceId:      string;
    /** Total number of wall members (including self) */
    expectedPeers: number;
    /** Status callback for diagnostics */
    onStatus:      (msg: string) => void;
    /** Returns the current wall content URL (set before or after init) */
    getContentUrl: () => string | null;
  }

  // ── Constants ──────────────────────────────────────────────────────────────

  const CLOCK_SAMPLES   = 7;
  const CLOCK_RESYNC_MS = 60_000;
  const GO_AHEAD_MS     = 5000;    // ms between GO broadcast and actual play epoch

  const WS_RECONNECT_MS = 2000;
  const LEADER_SCAN_MS  = 4000;
  const PLAYHEAD_TICK_MS = 600;

  // ── State ──────────────────────────────────────────────────────────────────

  let _cfg: WallSyncConfig;
  let _ws: WebSocket | null     = null;
  let _wsReady  = false;
  let _stopped  = false;
  let _running  = false;           // true once boot sequence completes

  let _role: 'pending' | 'leader' | 'follower' = 'pending';
  let _peers: string[] = [];

  let _offsetMs    = 0;            // local→server clock offset (ms)

  let _leaderReady   = false;
  let _followerReady = new Set<string>();
  let _goSent        = false;
  let _loadReceived  = false;

  let _phaseTimer:  any = null;
  let _peerHeads = new Map<string, { serverNow: number; posMs: number; at: number }>();
  let _peerWatchTimer: any = null;
  let _resyncInProgress    = false;

  let _currentUrl: string | null = null;  // most recent VIDEOWALL content URL

  // ── Public ─────────────────────────────────────────────────────────────────

  /**
   * Kick off the sync engine.  Returns immediately; the boot sequence (WS
   * connect → clock sync → peer discovery → role election → first GO) runs
   * asynchronously.  Call handleNewContent(url) at any time to supply the
   * content URL — it will be used as soon as the engine becomes the leader.
   */
  export function init(cfg: WallSyncConfig): void {
    if (_running || _ws !== null) {
      logger.warn('[WallSync] init called while already running — ignored');
      return;
    }
    _cfg           = cfg;
    _stopped       = false;
    _running       = false;
    _role          = 'pending';
    _peers         = [];
    _leaderReady   = false;
    _followerReady = new Set();
    _goSent        = false;
    _loadReceived  = false;
    _currentUrl    = null;

    logger.info(
      `[WallSync] init deviceId=${cfg.deviceId} group=${cfg.groupId} ` +
      `ws=${cfg.wsUrl} expectedPeers=${cfg.expectedPeers}`,
    );
    cfg.onStatus('Connecting to wall relay\u2026');

    // Wire LOOP_READY callback into WallEngine.
    // When the engine finishes prebuffering at frame 0 it calls this, which
    // sends LOOP_READY to the relay. The relay broadcasts LOOP_GO when all
    // wall members are ready.
    if (typeof WallEngine !== 'undefined') {
      WallEngine.setOnLoop(() => {
        if (!_stopped) {
          logger.info('[WallSync] prebuffer ready — sending LOOP_READY');
          _wsSend({ type: 'LOOP_READY', groupId: _cfg.groupId, deviceId: _cfg.deviceId });
        }
      });
    }

    _bootAsync().catch((e: any) => {
      logger.error('[WallSync] boot failed: ' + (e?.message ?? String(e)));
    });
  }

  export function stop(): void {
    _stopped = true;
    _running = false;
    _stopPhase();
    _stopPeerWatch();
    if (_ws) { try { _ws.close(); } catch {} _ws = null; }
    _wsReady = false;
    logger.info('[WallSync] stopped');
  }

  export function isRunning(): boolean { return _running; }

  /**
   * Called by player.ts when a new VIDEOWALL content item is available.
   * If we are the leader and already booted, kick off LOAD_URL → GO immediately.
   * If we are a follower (or not yet booted), the URL is stored and used when needed.
   */
  export function handleNewContent(url: string): void {
    _currentUrl = url;
    if (_role === 'leader' && _running && !_goSent && !_resyncInProgress) {
      logger.info('[WallSync] handleNewContent — leader starting round for: ' + url.split('/').pop());
      _runLeader().catch((e: any) => {
        logger.error('[WallSync] _runLeader failed: ' + (e?.message ?? String(e)));
      });
    } else if (_role === 'pending') {
      logger.info('[WallSync] handleNewContent — URL stored, will use after boot');
    }
  }

  // ── Boot sequence ──────────────────────────────────────────────────────────

  async function _bootAsync(): Promise<void> {
    await _connectWs();
    await _measureClock();

    // Extra early re-syncs to stabilise offset before first GO (clock can
    // drift ~10-15 ms in the first few seconds on Tizen 7).
    setTimeout(() => { if (!_stopped) _measureClock().catch(() => {}); }, 3_000);
    setTimeout(() => { if (!_stopped) _measureClock().catch(() => {}); }, 10_000);
    setInterval(() => { if (!_stopped) _measureClock().catch(() => {}); }, CLOCK_RESYNC_MS);
    setInterval(() => {
      logger.info(`[WallSync] heartbeat role=${_role} peers=[${_peers.join(',')}] stopped=${_stopped}`);
    }, 10_000);

    _cfg.onStatus(`Waiting for ${_cfg.expectedPeers} peer(s)\u2026`);
    await _waitPeers();

    // Leader = lexicographically highest deviceId (all devices use the same rule)
    const allIds = [..._peers, _cfg.deviceId].sort();
    _role = allIds[allIds.length - 1] === _cfg.deviceId ? 'leader' : 'follower';
    logger.info(`[WallSync] role=${_role} peers=[${_peers.join(', ')}]`);
    _cfg.onStatus(`Role: ${_role}`);

    _running = true;

    if (_role === 'leader') {
      // handleNewContent may have been called before boot finished
      if (_currentUrl) {
        await _runLeader();
      } else {
        _cfg.onStatus('Leader — waiting for content URL\u2026');
      }
      _startPeerWatch();
    } else {
      _cfg.onStatus('Follower — waiting for LOAD_URL from leader\u2026');
    }
  }

  // ── WebSocket ──────────────────────────────────────────────────────────────

  function _connectWs(): Promise<void> {
    return new Promise((resolve) => {
      const attempt = () => {
        if (_stopped) return;
        logger.info(`[WallSync] WS connecting \u2192 ${_cfg.wsUrl}`);
        _wsReady = false;
        try {
          const ws = new WebSocket(_cfg.wsUrl);
          _ws = ws;
          ws.onopen = () => {
            _wsReady = true;
            logger.info('[WallSync] WS connected');
            _wsSend({ type: 'WS_REGISTER', deviceId: _cfg.deviceId, groupId: _cfg.groupId });
            resolve();
          };
          ws.onmessage = (ev) => {
            try { _dispatch(JSON.parse(ev.data as string)); } catch {}
          };
          ws.onerror  = () => { logger.warn('[WallSync] WS error'); };
          ws.onclose  = () => {
            _wsReady = false;
            logger.warn('[WallSync] WS closed — reconnecting\u2026');
            if (!_stopped) setTimeout(attempt, WS_RECONNECT_MS);
          };
        } catch (e: any) {
          logger.error(`[WallSync] WS open failed: ${e?.message}`);
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

  // ── Clock sync (PING/PONG mini-NTP over WS) ───────────────────────────────

  function _measureClock(): Promise<void> {
    return new Promise((resolve) => {
      const results: { offset: number; rtt: number }[] = [];
      let remaining = CLOCK_SAMPLES;

      const finish = () => {
        if (results.length === 0) { resolve(); return; }
        results.sort((a, b) => a.rtt - b.rtt);
        _offsetMs = results[0].offset;
        const summary = results.map((r) => `rtt=${r.rtt}ms off=${r.offset}ms`).join('; ');
        logger.info(`[WallSync] clock offset=${_offsetMs}ms bestRtt=${results[0].rtt}ms | ${summary}`);
        resolve();
      };

      for (let i = 0; i < CLOCK_SAMPLES; i++) {
        setTimeout(() => {
          if (!_wsReady) { if (--remaining === 0) finish(); return; }
          const t1 = Date.now();
          const onMsg = (ev: MessageEvent) => {
            const msg = (() => {
              try { return JSON.parse(ev.data as string); } catch { return null; }
            })();
            if (!msg || msg.type !== 'PONG' || msg.t1 !== t1) return;
            _ws!.removeEventListener('message', onMsg);
            const t3 = Date.now();
            results.push({
              offset: Math.round(msg.t2 + (t3 - t1) / 2 - t3),
              rtt: t3 - t1,
            });
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

  // ── Peer discovery ─────────────────────────────────────────────────────────

  function _waitPeers(): Promise<void> {
    return new Promise((resolve) => {
      const needed = Math.max(0, _cfg.expectedPeers - 1);  // exclude self
      const check = () => {
        if (_stopped) { resolve(); return; }
        if (_peers.length >= needed) { resolve(); return; }
        setTimeout(check, 300);
      };
      check();
    });
  }

  // ── Message dispatch ───────────────────────────────────────────────────────

  function _dispatch(msg: any): void {
    const from: string = msg.from ?? 'relay';

    // PONG is consumed by per-sample listeners in _measureClock
    if (msg.type === 'PONG') return;

    if (msg.type === 'PEERS' || msg.type === 'HEARTBEAT_PEERS') {
      const list: string[] = msg.type === 'PEERS'
        ? (msg.peers as any[]).map((p: any) => p.deviceId)
        : (msg.peers as string[]);
      const others = list.filter((id) => id !== _cfg.deviceId);
      if (JSON.stringify(others) !== JSON.stringify(_peers)) {
        const dropped = _peers.filter((id) => !others.includes(id));
        dropped.forEach((id) => _followerReady.delete(id));
        _peers = others;
        logger.info(`[WallSync] peers: [${_peers.join(', ')}]`);
      }
      return;
    }

    logger.info(`[WallSync] \u2190 ${msg.type} from=${from}`);

    if (msg.type === 'LOAD_URL') {
      if (_role !== 'follower') return;
      if (_loadReceived) { logger.info('[WallSync] LOAD_URL dup — ignored'); return; }
      _loadReceived = true;
      _currentUrl   = msg.url;
      _cfg.onStatus(`Follower — preparing: ${msg.url.split('/').pop()}`);
      if (typeof WallEngine !== 'undefined') {
        WallEngine.prepare(msg.url)
          .then(() => {
            if (_stopped) return;
            logger.info('[WallSync] follower READY — sending READY');
            _cfg.onStatus('Follower — READY sent, waiting for GO\u2026');
            _wsSend({ type: 'READY' });
          })
          .catch((e: any) => {
            logger.error(`[WallSync] follower prepare failed: ${e?.message} — retry in 3s`);
            if (!_stopped) setTimeout(() => { _loadReceived = false; }, 3000);
          });
      }
      return;
    }

    if (msg.type === 'READY') {
      if (_role !== 'leader') return;
      _followerReady.add(from);
      logger.info(`[WallSync] READY from ${from} (${_followerReady.size}/${_peers.length})`);
      _cfg.onStatus(`Leader — ${_followerReady.size}/${_peers.length} follower(s) ready`);
      _checkAllReady();
      return;
    }

    if (msg.type === 'GO') {
      if (_role !== 'follower') return;
      const localPlay = _serverToLocal(msg.playAt);
      const wait      = Math.round(localPlay - Date.now());
      logger.info(
        `[WallSync] GO \u2192 play in T-${wait}ms ` +
        `(serverEpoch=${msg.playAt} offset=${_offsetMs}ms)`,
      );
      _cfg.onStatus(`GO received — playing in ${Math.round(wait / 100) / 10}s`);
      if (typeof WallEngine !== 'undefined') WallEngine.schedulePlayAt(localPlay);
      _startPhase();
      return;
    }

    if (msg.type === 'PLAYHEAD') {
      _peerHeads.set(from, { serverNow: msg.serverNow, posMs: msg.posMs, at: Date.now() });
      // Monitoring only — no drift correction (barrier sync handles alignment)
      return;
    }

    if (msg.type === 'LOOP_GO') {
      const localPlayAt = _serverToLocal(msg.playAt);
      const wait = Math.round(localPlayAt - Date.now());
      logger.info(`[WallSync] LOOP_GO playAt=${msg.playAt} T-${wait}ms`);
      _cfg.onStatus(`LOOP_GO — playing in ${Math.round(wait / 100) / 10}s`);
      if (typeof WallEngine !== 'undefined') WallEngine.schedulePlayAt(localPlayAt);
      return;
    }
  }

  // ── Leader flow ────────────────────────────────────────────────────────────

  async function _runLeader(): Promise<void> {
    const url = _currentUrl ?? _cfg.getContentUrl();
    if (!url) {
      logger.warn('[WallSync] _runLeader: no content URL — deferring');
      return;
    }

    logger.info(`[WallSync] leader round start: ${url.split('/').pop()}`);
    _cfg.onStatus('Leader — sending LOAD_URL\u2026');

    // Reset per-round state
    _followerReady = new Set();
    _goSent        = false;
    _leaderReady   = false;
    _loadReceived  = false;

    _wsSend({ type: 'LOAD_URL', url });

    _cfg.onStatus('Leader — preparing engine\u2026');
    if (typeof WallEngine !== 'undefined') {
      WallEngine.prepare(url)
        .then(() => {
          if (_stopped) return;
          logger.info('[WallSync] leader engine READY');
          _leaderReady = true;
          _cfg.onStatus(`Leader ready — waiting for ${_peers.length} follower(s)\u2026`);
          _checkAllReady();
        })
        .catch((e: any) => {
          logger.error(`[WallSync] leader prepare failed: ${e?.message} — retry in 5s`);
          if (!_stopped) setTimeout(() => { if (!_stopped) _runLeader().catch(() => {}); }, 5000);
        });
    }
  }

  function _checkAllReady(): void {
    if (!_leaderReady || _followerReady.size < _peers.length || _goSent || _stopped) return;
    _goSent = true;
    const localPlay  = Date.now() + GO_AHEAD_MS;
    const serverPlay = _localToServer(localPlay);
    const dur        = typeof WallEngine !== 'undefined' ? WallEngine.getDuration() : 0;
    logger.info(`[WallSync] ALL READY \u2192 GO epoch=${serverPlay} dur=${dur}ms`);
    _cfg.onStatus(`ALL READY — play in ${GO_AHEAD_MS / 1000}s`);
    _wsSend({ type: 'GO', playAt: serverPlay, durationMs: dur });
    if (typeof WallEngine !== 'undefined') WallEngine.schedulePlayAt(localPlay);
    _startPhase();
  }

  // ── Leader peer watcher (live-join resync) ─────────────────────────────────

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
    logger.info(`[WallSync] new follower(s): [${joiners.join(',')}] — resyncing`);
    _cfg.onStatus(`New follower (${joiners.join(',')}) — resyncing\u2026`);
    _resyncLeader().catch(() => {});
  }

  async function _resyncLeader(): Promise<void> {
    if (_resyncInProgress || _stopped) return;
    _resyncInProgress = true;
    try {
      _stopPhase();
      _leaderReady = false; _followerReady = new Set(); _goSent = false;
      // Restart WallEngine to abort the current playback cleanly before re-prepare
      if (typeof WallEngine !== 'undefined') {
        try { WallEngine.destroyEngine(); } catch {}
        WallEngine.initEngine();
      }
      await _runLeader();
    } finally {
      _resyncInProgress = false;
    }
  }

  // ── PLAYHEAD heartbeat (monitoring only) ──────────────────────────────────

  function _startPhase(): void {
    if (_phaseTimer) return;
    _peerHeads = new Map();
    _phaseTimer = setInterval(_phaseTick, PLAYHEAD_TICK_MS);
    logger.info('[WallSync] PLAYHEAD heartbeat started');
  }

  function _stopPhase(): void {
    if (_phaseTimer) { clearInterval(_phaseTimer); _phaseTimer = null; }
  }

  function _phaseTick(): void {
    if (_stopped) return;
    if (typeof WallEngine === 'undefined' || !WallEngine.isPlaying()) return;
    const pos = WallEngine.getCurrentPosMs();
    if (pos == null) return;
    const serverNow = _localToServer(Date.now());
    const duration  = WallEngine.getDuration();
    if (duration <= 0) return;
    _wsSend({ type: 'PLAYHEAD', serverNow, posMs: pos });
  }

} // namespace WallSync
