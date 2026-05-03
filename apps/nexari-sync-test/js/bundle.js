(() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __getOwnPropSymbols = Object.getOwnPropertySymbols;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __propIsEnum = Object.prototype.propertyIsEnumerable;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __spreadValues = (a, b) => {
    for (var prop in b || (b = {}))
      if (__hasOwnProp.call(b, prop))
        __defNormalProp(a, prop, b[prop]);
    if (__getOwnPropSymbols)
      for (var prop of __getOwnPropSymbols(b)) {
        if (__propIsEnum.call(b, prop))
          __defNormalProp(a, prop, b[prop]);
      }
    return a;
  };
  var __esm = (fn, res) => function __init() {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  };
  var __commonJS = (cb, mod) => function __require() {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  };
  var __async = (__this, __arguments, generator) => {
    return new Promise((resolve, reject) => {
      var fulfilled = (value) => {
        try {
          step(generator.next(value));
        } catch (e) {
          reject(e);
        }
      };
      var rejected = (value) => {
        try {
          step(generator.throw(value));
        } catch (e) {
          reject(e);
        }
      };
      var step = (x) => x.done ? resolve(x.value) : Promise.resolve(x.value).then(fulfilled, rejected);
      step((generator = generator.apply(__this, __arguments)).next());
    });
  };

  // src/ntp-client.ts
  function getNtpOffset() {
    return _offsetMs;
  }
  function getSyncedTime() {
    return Date.now() + _offsetMs;
  }
  function syncTime(piBase) {
    return __async(this, null, function* () {
      const url = `${piBase}/time`;
      const good = [];
      for (let i = 0; i < NTP_SAMPLES; i++) {
        try {
          const t0 = Date.now();
          const ctrl = new AbortController();
          const tid = setTimeout(() => ctrl.abort(), 1500);
          const res = yield fetch(url, { signal: ctrl.signal });
          clearTimeout(tid);
          const t3 = Date.now();
          const json = yield res.json();
          const ts = Number(json == null ? void 0 : json.timestamp);
          if (!isFinite(ts)) continue;
          const rtt = t3 - t0;
          if (rtt > RTT_LIMIT_MS) continue;
          good.push({ offset: ts - t0 - rtt / 2, rtt });
        } catch (e) {
        }
        yield new Promise((r) => setTimeout(r, 20));
      }
      if (good.length === 0) {
        return { offsetMs: _offsetMs, rttMs: 0, samples: 0 };
      }
      good.sort((a, b) => a.rtt - b.rtt);
      const best = good[0];
      const prev = _offsetMs;
      const delta = Math.abs(best.offset - prev);
      _offsetMs = delta > SNAP_THRESHOLD ? best.offset : prev * (1 - EWMA_ALPHA) + best.offset * EWMA_ALPHA;
      return { offsetMs: Math.round(_offsetMs), rttMs: Math.round(best.rtt), samples: good.length };
    });
  }
  var NTP_SAMPLES, RTT_LIMIT_MS, SNAP_THRESHOLD, EWMA_ALPHA, _offsetMs;
  var init_ntp_client = __esm({
    "src/ntp-client.ts"() {
      NTP_SAMPLES = 8;
      RTT_LIMIT_MS = 300;
      SNAP_THRESHOLD = 80;
      EWMA_ALPHA = 0.2;
      _offsetMs = 0;
    }
  });

  // src/p2p-sync-client.ts
  function getRole() {
    return _role;
  }
  function setVideoDuration(ms) {
    _videoDurationMs = ms;
  }
  function onSyncPlay(h) {
    _onSyncPlay = h;
  }
  function onVideoUrl(h) {
    _onVideoUrl = h;
  }
  function onSetEngine(h) {
    _onSetEngine = h;
  }
  function onAdjust(h) {
    _onAdjust = h;
  }
  function init(opts) {
    var _a;
    _opts = opts;
    _groupId = (_a = opts.groupId) != null ? _a : "synctest-001";
    _opts.logger("info", `[P2P] init: deviceId=${opts.deviceId}`);
    _startRegister();
    _startPeerPoll();
    _startSignalDrain();
  }
  function setVideoReady(itemIndex, engineMode) {
    _readyItemIndex = itemIndex;
    _readyEngineMode = engineMode;
    if (_connected && _role === "follower") {
      _send({ type: "READY", deviceId: _opts.deviceId, engineMode });
      _opts == null ? void 0 : _opts.logger("info", `[P2P] follower READY sent`);
    }
  }
  function setPlaybackState(itemIndex, currentTimeMs, engineMode) {
    _pbItemIndex = itemIndex;
    _pbCurrentMs = currentTimeMs;
    _pbEngineMode = engineMode;
  }
  function broadcastVideoUrl(url) {
    _pendingVideoUrl = url;
    if (_connected && _role === "leader") {
      _send({ type: "VIDEO_URL", url, durationMs: 0, engineMode: _readyEngineMode });
      _opts == null ? void 0 : _opts.logger("info", `[P2P] leader sent VIDEO_URL: ${url}`);
    } else {
      _opts == null ? void 0 : _opts.logger("info", `[P2P] VIDEO_URL queued (not connected yet): ${url}`);
    }
  }
  function broadcastSetEngine(mode) {
    if (_role !== "leader") return;
    _send({ type: "SET_ENGINE", engineMode: mode });
    _opts == null ? void 0 : _opts.logger("info", `[P2P] leader broadcast SET_ENGINE: ${mode}`);
    _onSetEngine == null ? void 0 : _onSetEngine({ type: "SET_ENGINE", engineMode: mode });
  }
  function _startRegister() {
    _doRegister();
    _registerTimer = setInterval(_doRegister, REGISTER_INTERVAL_MS);
  }
  function _doRegister() {
    if (!_opts) return;
    fetch(`${_opts.piBase}/api/v1/test-sync/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        deviceId: _opts.deviceId,
        role: _role === "pending" ? "peer" : _role,
        ip: _opts.selfIp,
        groupId: _groupId
      })
    }).catch(() => {
    });
  }
  function _startPeerPoll() {
    _peerPollTimer = setInterval(_doPeerPoll, PEER_POLL_INTERVAL_MS);
  }
  function _doPeerPoll() {
    return __async(this, null, function* () {
      if (_connected) {
        clearInterval(_peerPollTimer);
        return;
      }
      if (!_opts) return;
      try {
        const res = yield fetch(`${_opts.piBase}/api/v1/test-sync/peers?groupId=${_groupId}`);
        const data = yield res.json();
        const now = Date.now();
        const peers = data.peers.filter(
          (p) => p.deviceId !== _opts.deviceId && (p.registeredAt == null || now - p.registeredAt < PEER_MAX_AGE_MS)
        );
        if (!peers.length) {
          _opts.logger("info", `[P2P] no fresh peers yet (total in group: ${data.peers.length})`);
          return;
        }
        peers.sort((a, b) => {
          var _a, _b;
          return ((_a = b.registeredAt) != null ? _a : 0) - ((_b = a.registeredAt) != null ? _b : 0);
        });
        const peer = peers[0];
        _peerDeviceId = peer.deviceId;
        _role = _opts.deviceId < peer.deviceId ? "leader" : "follower";
        _connected = true;
        _opts.logger("info", `[P2P] paired with ${peer.deviceId} -> self is ${_role}`);
        _doRegister();
        clearInterval(_peerPollTimer);
        if (_role === "leader" && _pendingVideoUrl) {
          _send({ type: "VIDEO_URL", url: _pendingVideoUrl, durationMs: 0, engineMode: _readyEngineMode });
          _opts.logger("info", `[P2P] leader sent VIDEO_URL on connect: ${_pendingVideoUrl}`);
        }
        if (_role === "follower" && _readyItemIndex >= 0) {
          _send({ type: "READY", deviceId: _opts.deviceId, engineMode: _readyEngineMode });
          _opts.logger("info", `[P2P] follower sent READY on connect`);
        }
        _startHeartbeat();
      } catch (e) {
        _opts == null ? void 0 : _opts.logger("warn", `[P2P] peer poll failed: ${e == null ? void 0 : e.message}`);
      }
    });
  }
  function _send(msg) {
    if (!_opts || !_peerDeviceId) return;
    fetch(`${_opts.piBase}/api/v1/test-sync/signal/${_peerDeviceId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from: _opts.deviceId, seq: Date.now(), body: msg })
    }).catch((e) => _opts == null ? void 0 : _opts.logger("warn", `[P2P] _send failed: ${e == null ? void 0 : e.message}`));
  }
  function _startSignalDrain() {
    _signalPollTimer = setInterval(_doSignalDrain, SIGNAL_POLL_INTERVAL_MS);
  }
  function _doSignalDrain() {
    return __async(this, null, function* () {
      var _a;
      if (!_opts) return;
      try {
        const res = yield fetch(`${_opts.piBase}/api/v1/test-sync/signals/${_opts.deviceId}?since=${_signalPollSince}`);
        const data = yield res.json();
        if (data.nextSince != null) _signalPollSince = data.nextSince;
        for (const entry of (_a = data.entries) != null ? _a : []) {
          if (entry.from && entry.from !== _peerDeviceId) {
            _opts == null ? void 0 : _opts.logger("info", `[P2P] re-routing peer: ${_peerDeviceId != null ? _peerDeviceId : "none"} \u2192 ${entry.from}`);
            _peerDeviceId = entry.from;
            const newRole = _opts.deviceId < entry.from ? "leader" : "follower";
            if (newRole !== _role) {
              _opts == null ? void 0 : _opts.logger("info", `[P2P] role updated: ${_role} \u2192 ${newRole}`);
              _role = newRole;
            }
            if (_role === "follower" && _readyItemIndex >= 0 && !_syncPlaySent) {
              _send({ type: "READY", deviceId: _opts.deviceId, engineMode: _readyEngineMode });
              _opts == null ? void 0 : _opts.logger("info", `[P2P] follower READY sent after re-route`);
            }
            if (_role === "leader" && _pendingVideoUrl) {
              _send({ type: "VIDEO_URL", url: _pendingVideoUrl, durationMs: 0, engineMode: _readyEngineMode });
              _opts == null ? void 0 : _opts.logger("info", `[P2P] leader re-sent VIDEO_URL after re-route`);
            }
          }
          try {
            _handleMessage(entry.body);
          } catch (e) {
          }
        }
      } catch (e) {
      }
    });
  }
  function _handleMessage(msg) {
    if (!_opts) return;
    switch (msg.type) {
      case "VIDEO_URL":
        _opts.logger("info", `[P2P] VIDEO_URL received: ${msg.url}`);
        _onVideoUrl == null ? void 0 : _onVideoUrl(msg);
        break;
      case "READY":
        if (_role === "leader" && !_syncPlaySent) {
          _syncPlaySent = true;
          _opts.logger("info", `[P2P] follower READY received`);
          const startMs = getSyncedTime() + LEADER_START_AHEAD_MS;
          const syncPlay = { type: "SYNC_PLAY", syncedStartMs: startMs, videoDurationMs: _videoDurationMs, itemIndex: _pbItemIndex >= 0 ? _pbItemIndex : 0 };
          _send(syncPlay);
          _onSyncPlay == null ? void 0 : _onSyncPlay(syncPlay);
          _opts.logger("info", `[P2P] SYNC_PLAY sent: startMs=${startMs} durationMs=${_videoDurationMs}`);
        } else if (_role === "leader" && _syncPlaySent) {
          _opts.logger("info", `[P2P] duplicate READY ignored (SYNC_PLAY already sent)`);
        }
        break;
      case "SYNC_PLAY":
        _syncPlaySent = true;
        _opts.logger("info", `[P2P] SYNC_PLAY received: startMs=${msg.syncedStartMs}`);
        _onSyncPlay == null ? void 0 : _onSyncPlay(msg);
        break;
      case "SET_ENGINE":
        _opts.logger("info", `[P2P] SET_ENGINE received: ${msg.engineMode}`);
        _onSetEngine == null ? void 0 : _onSetEngine(msg);
        break;
      case "HEARTBEAT": {
        const hb = msg;
        if (_role !== "leader" || _pbItemIndex < 0 || hb.itemIndex !== _pbItemIndex) break;
        _followerViews[hb.deviceId] = { currentMs: hb.currentTimeMs, syncedTime: hb.syncedTime, itemIndex: hb.itemIndex, receivedAt: Date.now() };
        const driftMs = hb.currentTimeMs - _pbCurrentMs;
        _opts == null ? void 0 : _opts.logger("info", `[P2P] hb: follower=${Math.round(hb.currentTimeMs)}ms leader=${Math.round(_pbCurrentMs)}ms drift=${Math.round(driftMs)}ms`);
        break;
      }
      case "SYNC_ADJUST":
        _onAdjust == null ? void 0 : _onAdjust(msg);
        break;
    }
  }
  function _startHeartbeat() {
    _heartbeatTimer = setInterval(() => {
      if (!_connected || _role !== "follower" || _pbItemIndex < 0) return;
      _opts == null ? void 0 : _opts.logger("info", `[P2P] hb sent: pos=${Math.round(_pbCurrentMs)}ms`);
      _send({
        type: "HEARTBEAT",
        deviceId: _opts.deviceId,
        itemIndex: _pbItemIndex,
        currentTimeMs: _pbCurrentMs,
        syncedTime: getSyncedTime(),
        engineMode: _pbEngineMode
      });
    }, HEARTBEAT_INTERVAL_MS);
  }
  var REGISTER_INTERVAL_MS, PEER_POLL_INTERVAL_MS, SIGNAL_POLL_INTERVAL_MS, HEARTBEAT_INTERVAL_MS, LEADER_START_AHEAD_MS, PEER_MAX_AGE_MS, _opts, _role, _peerDeviceId, _groupId, _connected, _readyItemIndex, _readyEngineMode, _pendingVideoUrl, _pbItemIndex, _pbCurrentMs, _pbEngineMode, _followerViews, _signalPollSince, _registerTimer, _peerPollTimer, _signalPollTimer, _heartbeatTimer, _videoDurationMs, _syncPlaySent, _onSyncPlay, _onVideoUrl, _onSetEngine, _onAdjust;
  var init_p2p_sync_client = __esm({
    "src/p2p-sync-client.ts"() {
      init_ntp_client();
      REGISTER_INTERVAL_MS = 5e3;
      PEER_POLL_INTERVAL_MS = 2e3;
      SIGNAL_POLL_INTERVAL_MS = 500;
      HEARTBEAT_INTERVAL_MS = 1e3;
      LEADER_START_AHEAD_MS = 5e3;
      PEER_MAX_AGE_MS = 12e3;
      _opts = null;
      _role = "pending";
      _peerDeviceId = null;
      _groupId = "synctest-001";
      _connected = false;
      _readyItemIndex = -1;
      _readyEngineMode = "mse";
      _pendingVideoUrl = null;
      _pbItemIndex = -1;
      _pbCurrentMs = 0;
      _pbEngineMode = "mse";
      _followerViews = {};
      _signalPollSince = 0;
      _registerTimer = null;
      _peerPollTimer = null;
      _signalPollTimer = null;
      _heartbeatTimer = null;
      _videoDurationMs = 0;
      _syncPlaySent = false;
      _onSyncPlay = null;
      _onVideoUrl = null;
      _onSetEngine = null;
      _onAdjust = null;
    }
  });

  // src/perf-hud.ts
  function initHud() {
    _el = document.getElementById("perf-hud");
    if (!_el) {
      _el = document.createElement("div");
      _el.id = "perf-hud";
      _el.style.cssText = [
        "position:fixed",
        "top:0",
        "left:0",
        "right:0",
        "background:rgba(0,0,0,0.72)",
        "color:#0f0",
        "font:13px/1.6 monospace",
        "padding:8px 14px",
        "z-index:9999",
        "pointer-events:none",
        "white-space:pre"
      ].join(";");
      document.body.appendChild(_el);
    }
    setInterval(_render, 250);
  }
  function updateHud(partial) {
    Object.assign(_state, partial);
  }
  function _fmt(ms) {
    return `${(ms / 1e3).toFixed(3)}s`;
  }
  function _render() {
    if (!_el) return;
    const s = _state;
    const absDrift = Math.abs(s.driftMs);
    const driftColor = absDrift > 50 ? "#f44" : absDrift > 20 ? "#fa0" : "#0f0";
    const decodeStr = s.decodePercent !== null ? `<span style="color:#4af">Decoding\u2026 ${s.decodePercent}%</span>  ` : "";
    _el.innerHTML = [
      `<span style="color:#8df">ENGINE</span> <b>${s.engineMode.toUpperCase()}</b>  <span style="color:#8df">ROLE</span> <b>${s.role}</b>  <span style="color:#8df">P2P</span> ${s.connectionState}  <span style="color:#8df">NTP</span> ${s.ntpOffsetMs > 0 ? "+" : ""}${s.ntpOffsetMs}ms`,
      `<span style="color:#8df">POS</span>  ${_fmt(s.positionMs)}  <span style="color:#8df">EXP</span>  ${_fmt(s.expectedMs)}  <span style="color:#8df">DRIFT</span> <span style="color:${driftColor}">${s.driftMs > 0 ? "+" : ""}${Math.round(s.driftMs)}ms</span>  <span style="color:#8df">LAST</span> ${s.lastAction}`,
      decodeStr
    ].filter(Boolean).join("\n");
  }
  var _el, _state;
  var init_perf_hud = __esm({
    "src/perf-hud.ts"() {
      _el = null;
      _state = {
        role: "pending",
        engineMode: "mse",
        ntpOffsetMs: 0,
        positionMs: 0,
        expectedMs: 0,
        driftMs: 0,
        lastAction: "\u2014",
        decodePercent: null,
        connectionState: "connecting"
      };
    }
  });

  // src/logger.ts
  function initLogger(piBase, deviceId) {
    _piBase = piBase;
    _deviceId = deviceId;
    setInterval(_flush, FLUSH_INTERVAL_MS);
  }
  function setLoggerEngine(mode) {
    _engineMode = mode;
  }
  function _push(level, msg, extra) {
    const entry = __spreadValues({
      deviceId: _deviceId,
      level,
      msg,
      ts: Date.now(),
      engineMode: _engineMode,
      ntpOffsetMs: _ntpOffset
    }, (extra == null ? void 0 : extra.driftMs) !== void 0 ? { driftMs: extra.driftMs } : {});
    console[level](`[${level.toUpperCase()}] ${msg}`);
    if (_piBase) _queue.push(entry);
  }
  function _flush() {
    return __async(this, null, function* () {
      if (_flushing || !_queue.length || !_piBase) return;
      _flushing = true;
      const batch = _queue.splice(0, BATCH_SIZE);
      try {
        for (const entry of batch) {
          yield fetch(`${_piBase}/api/v1/test-sync/log`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(entry)
          });
        }
      } catch (e) {
      } finally {
        _flushing = false;
      }
    });
  }
  var _piBase, _deviceId, _engineMode, _ntpOffset, _queue, _flushing, BATCH_SIZE, FLUSH_INTERVAL_MS, logger;
  var init_logger = __esm({
    "src/logger.ts"() {
      _piBase = "";
      _deviceId = "";
      _engineMode = "mse";
      _ntpOffset = 0;
      _queue = [];
      _flushing = false;
      BATCH_SIZE = 20;
      FLUSH_INTERVAL_MS = 2e3;
      logger = {
        debug: (msg) => _push("debug", msg),
        info: (msg) => _push("info", msg),
        warn: (msg) => _push("warn", msg),
        error: (msg) => _push("error", msg),
        drift: (msg, driftMs) => _push("info", msg, { driftMs })
      };
    }
  });

  // src/player-mse.ts
  function initMsePlayer(container) {
    _teardown();
    _video = document.createElement("video");
    _video.style.cssText = "position:absolute;top:0;left:0;width:100%;height:100%;background:#000;";
    _video.muted = false;
    _video.volume = 1;
    _video.playsInline = true;
    container.appendChild(_video);
    _registerEndedHandler();
    _rVfcSupported = typeof _video.requestVideoFrameCallback === "function";
    logger.info(`[MSE] rVFC supported: ${_rVfcSupported}`);
    onSyncPlay(_handleSyncPlay);
    onAdjust(_handleAdjust);
    _startStateTickTimer();
  }
  function loadVideo(url, itemIndex = 0) {
    return __async(this, null, function* () {
      if (!_video) return;
      _itemIndex = itemIndex;
      _syncedStartMs = -1;
      _startScheduled = false;
      logger.info(`[MSE] loading: ${url}`);
      updateHud({ positionMs: 0, expectedMs: 0, driftMs: 0, lastAction: "Buffering\u2026" });
      _video.preload = "auto";
      _video.src = url;
      _video.load();
      yield new Promise((resolve) => {
        if (!_video) return resolve();
        if (_video.readyState >= 3) {
          resolve();
          return;
        }
        _video.addEventListener("canplay", () => resolve(), { once: true });
      });
      logger.info("[MSE] canplay \u2014 signalling READY");
      _videoDurationMs2 = _video.duration > 0 && isFinite(_video.duration) ? Math.round(_video.duration * 1e3) : 0;
      if (_videoDurationMs2 > 0) {
        setVideoDuration(_videoDurationMs2);
        logger.info(`[MSE] duration: ${_videoDurationMs2}ms`);
      }
      updateHud({ lastAction: "Ready \u2014 waiting for SYNC_PLAY" });
      setVideoReady(_itemIndex, "mse");
      _video.pause();
      _syncWatchdog = setTimeout(() => {
        if (_video == null ? void 0 : _video.paused) {
          logger.warn("[MSE] watchdog: no SYNC_PLAY after 8s \u2014 playing unsynced");
          _playing = true;
          _video.play().catch((e) => logger.warn(`[MSE] watchdog play() failed: ${e == null ? void 0 : e.message}`));
        }
      }, 8e3);
      if (_syncedStartMs > 0) _schedulePlay();
      if (_rVfcSupported) _registerRVFC();
    });
  }
  function teardown() {
    _teardown();
  }
  function _handleSyncPlay(msg) {
    var _a;
    clearTimeout(_syncWatchdog);
    if (_startScheduled) {
      logger.info(`[MSE] SYNC_PLAY ignored (play already scheduled)`);
      return;
    }
    _syncedStartMs = msg.syncedStartMs;
    if (((_a = msg.videoDurationMs) != null ? _a : 0) > 0) _videoDurationMs2 = msg.videoDurationMs;
    logger.info(`[MSE] SYNC_PLAY received: startMs=${msg.syncedStartMs} durationMs=${_videoDurationMs2} (in ${msg.syncedStartMs - getSyncedTime()}ms)`);
    if (_video && _video.readyState >= 3) _schedulePlay();
  }
  function _schedulePlay() {
    if (_startScheduled || !_video) return;
    _startScheduled = true;
    _video.pause();
    _video.currentTime = 0;
    const wait = _syncedStartMs - getSyncedTime();
    if (wait <= 0) {
      logger.warn("[MSE] SYNC_PLAY cue already past \u2014 playing immediately");
      _video.play().catch((e) => logger.warn(`[MSE] play() failed (past cue): ${e == null ? void 0 : e.message}`));
      return;
    }
    logger.info(`[MSE] scheduling play in ${Math.round(wait)}ms`);
    const COARSE_THRESHOLD = 50;
    const coarseWait = Math.max(0, wait - COARSE_THRESHOLD);
    setTimeout(() => {
      const target = _syncedStartMs;
      function tryPlay() {
        if (getSyncedTime() >= target) {
          _playing = true;
          _video == null ? void 0 : _video.play().catch((e) => logger.warn(`[MSE] play() failed: ${e == null ? void 0 : e.message}`));
          updateHud({ lastAction: "play() fired" });
        } else {
          setTimeout(tryPlay, 4);
        }
      }
      tryPlay();
    }, coarseWait);
  }
  function _handleAdjust(msg) {
    if (!_video) return;
    if (_videoDurationMs2 > 0) return;
    updateHud({ driftMs: msg.driftMs, lastAction: `${msg.action} ${Math.round(msg.driftMs)}ms` });
    if (msg.action === "snap" && msg.targetMs !== void 0) {
      _video.currentTime = msg.targetMs / 1e3;
      _video.playbackRate = 1;
      logger.drift(`[MSE] snap to ${msg.targetMs}ms`, msg.driftMs);
    } else if (msg.action === "nudge" && msg.driftRate !== void 0) {
      _video.playbackRate = msg.driftRate;
      logger.drift(`[MSE] nudge rate=${msg.driftRate}`, msg.driftMs);
      setTimeout(() => {
        if (_video) _video.playbackRate = 1;
      }, 5e3);
    }
  }
  function _registerRVFC() {
    if (!_video || !_rVfcSupported) return;
    _video.requestVideoFrameCallback(_onFrame);
  }
  function _onFrame(_now, meta) {
    if (!_video) return;
    const posMs = meta.mediaTime * 1e3;
    const syncNow = getSyncedTime();
    const elapsed = syncNow - _syncedStartMs;
    const expectedMs = _syncedStartMs > 0 && elapsed > 0 ? elapsed : posMs;
    const driftMs = posMs - expectedMs;
    setPlaybackState(_itemIndex, posMs, "mse");
    updateHud({ positionMs: posMs, expectedMs, driftMs });
    _registerRVFC();
  }
  function _registerEndedHandler() {
    if (!_video) return;
    _video.addEventListener("ended", () => {
      if (_syncedStartMs > 0 && _videoDurationMs2 > 0) {
        const elapsed = getSyncedTime() - _syncedStartMs;
        const expectedMs = (elapsed % _videoDurationMs2 + _videoDurationMs2) % _videoDurationMs2;
        logger.info(`[MSE] loop: elapsed=${Math.round(elapsed)}ms seekTo=${Math.round(expectedMs)}ms`);
        _lastSeekTime = Date.now();
        if (_video) {
          _video.currentTime = expectedMs / 1e3;
          _video.play().catch((e) => logger.warn(`[MSE] loop play() failed: ${e == null ? void 0 : e.message}`));
        }
      } else {
        if (_video) {
          _video.currentTime = 0;
          _video.play().catch((e) => logger.warn(`[MSE] loop play() failed: ${e == null ? void 0 : e.message}`));
        }
      }
    });
  }
  function _startStateTickTimer() {
    _stateTickTimer = setInterval(() => {
      if (!_video || !_playing) return;
      if (Date.now() - _lastSeekTime < SEEK_SETTLE_MS) return;
      const posMs = _video.currentTime * 1e3;
      const syncNow = getSyncedTime();
      let expectedMs = posMs;
      if (_syncedStartMs > 0 && _videoDurationMs2 > 0) {
        const elapsed = syncNow - _syncedStartMs;
        expectedMs = (elapsed % _videoDurationMs2 + _videoDurationMs2) % _videoDurationMs2;
      }
      const driftMs = posMs - expectedMs;
      setPlaybackState(_itemIndex, posMs, "mse");
      updateHud({ positionMs: posMs, expectedMs, driftMs });
      if (_syncedStartMs > 0 && _videoDurationMs2 > 0) {
        const nearBoundary = expectedMs < NEAR_END_MS || expectedMs > _videoDurationMs2 - NEAR_END_MS;
        const absDrift = Math.abs(driftMs);
        if (!nearBoundary) {
          if (absDrift > SYNC_SEEK_MS) {
            _lastSeekTime = Date.now();
            logger.info(`[MSE] sync-seek: drift ${Math.round(driftMs)}ms \u2192 ${Math.round(expectedMs)}ms`);
            _video.currentTime = expectedMs / 1e3;
          } else if (driftMs > SYNC_AHEAD_MS) {
            if (_video.playbackRate !== NUDGE_SLOW) {
              _video.playbackRate = NUDGE_SLOW;
              logger.info(`[MSE] sync-nudge slow: ahead ${Math.round(driftMs)}ms`);
            }
          } else if (driftMs < -SYNC_BEHIND_MS) {
            if (_video.playbackRate !== NUDGE_FAST) {
              _video.playbackRate = NUDGE_FAST;
              logger.info(`[MSE] sync-nudge fast: behind ${Math.round(-driftMs)}ms`);
            }
          } else if (_video.playbackRate !== 1 && absDrift < 20) {
            _video.playbackRate = 1;
            logger.info(`[MSE] sync-restored: drift ${Math.round(driftMs)}ms`);
          }
        }
      }
    }, 50);
  }
  function _teardown() {
    clearInterval(_stateTickTimer);
    clearTimeout(_syncWatchdog);
    if (_video) {
      _video.pause();
      _video.src = "";
      _video.remove();
      _video = null;
    }
    if (_ms && _ms.readyState === "open") {
      try {
        _ms.endOfStream();
      } catch (e) {
      }
    }
    _ms = null;
    _sb = null;
    _startScheduled = false;
    _syncedStartMs = -1;
    _playing = false;
    _pausedForSync = false;
    _videoDurationMs2 = 0;
    _lastSeekTime = 0;
  }
  var CHUNK_SIZE, _video, _ms, _sb, _syncedStartMs, _startScheduled, _itemIndex, _stateTickTimer, _rVfcSupported, _syncWatchdog, _videoDurationMs2, _pausedForSync, _playing, _lastSeekTime, SYNC_AHEAD_MS, SYNC_BEHIND_MS, SYNC_SEEK_MS, SEEK_SETTLE_MS, NUDGE_FAST, NUDGE_SLOW, NEAR_END_MS;
  var init_player_mse = __esm({
    "src/player-mse.ts"() {
      init_ntp_client();
      init_p2p_sync_client();
      init_perf_hud();
      init_logger();
      CHUNK_SIZE = 1 * 1024 * 1024;
      _video = null;
      _ms = null;
      _sb = null;
      _syncedStartMs = -1;
      _startScheduled = false;
      _itemIndex = 0;
      _stateTickTimer = null;
      _rVfcSupported = false;
      _syncWatchdog = null;
      _videoDurationMs2 = 0;
      _pausedForSync = false;
      _playing = false;
      _lastSeekTime = 0;
      SYNC_AHEAD_MS = 50;
      SYNC_BEHIND_MS = 50;
      SYNC_SEEK_MS = 500;
      SEEK_SETTLE_MS = 2500;
      NUDGE_FAST = 1.02;
      NUDGE_SLOW = 0.98;
      NEAR_END_MS = 500;
    }
  });

  // src/decoder-ffmpeg.ts
  function _getWgtBase() {
    var _a, _b;
    try {
      const uri = (_b = (_a = window.tizen) == null ? void 0 : _a.filesystem) == null ? void 0 : _b.toURI("wgt-package");
      if (uri && typeof uri === "string" && uri.length > 10) {
        const base = uri.endsWith("/") ? uri : uri + "/";
        logger.info(`[WASM] wgt base (tizen.fs): ${base}`);
        return base;
      }
    } catch (e) {
      logger.warn(`[WASM] tizen.filesystem.toURI failed: ${e == null ? void 0 : e.message}`);
    }
    for (const s of Array.from(document.scripts)) {
      if (s.src && s.src.startsWith("file:///") && s.src.includes("bundle.js")) {
        const base = s.src.replace(/js\/bundle\.js.*$/, "");
        logger.info(`[WASM] wgt base (script.src): ${base}`);
        return base;
      }
    }
    const loc = window.location.href.replace(/[^\/]*$/, "");
    logger.warn(`[WASM] wgt base (location.href fallback): ${loc}`);
    return loc;
  }
  function _loadBlob(absUrl, mime) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("GET", absUrl, true);
      xhr.responseType = "arraybuffer";
      xhr.onload = () => {
        if (xhr.status === 0 || xhr.status >= 400) {
          reject(new Error(`XHR failed (${xhr.status}): ${absUrl}`));
        } else {
          resolve(URL.createObjectURL(new Blob([xhr.response], { type: mime })));
        }
      };
      xhr.onerror = () => reject(new Error(`XHR error: ${absUrl}`));
      xhr.send();
    });
  }
  function _xhrGetBytes(url) {
    const absUrl = url.startsWith("http") || url.startsWith("blob:") || url.startsWith("file:///opt") ? url : _getWgtBase() + url.replace(/^\.\//, "");
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("GET", absUrl, true);
      xhr.responseType = "arraybuffer";
      xhr.onload = () => resolve(new Uint8Array(xhr.response));
      xhr.onerror = () => reject(new Error(`XHR failed: ${absUrl}`));
      xhr.send();
    });
  }
  function decodeVideo(videoUrl) {
    return __async(this, null, function* () {
      logger.info(`[WASM] starting ffmpeg decode: ${videoUrl}`);
      updateHud({ decodePercent: 0, lastAction: "Initialising ffmpeg\u2026" });
      if (!_ffmpeg) {
        const { createFFmpeg } = FFmpeg;
        const base = _getWgtBase();
        logger.info(`[WASM] loading core files from: ${base}`);
        updateHud({ lastAction: "Loading ffmpeg core\u2026", decodePercent: 0 });
        const [corePath, wasmPath, workerPath] = yield Promise.all([
          _loadBlob(base + "js/lib/ffmpeg/ffmpeg-core.js", "application/javascript"),
          _loadBlob(base + "js/lib/ffmpeg/ffmpeg-core.wasm", "application/wasm"),
          _loadBlob(base + "js/lib/ffmpeg/ffmpeg-core.worker.js", "application/javascript")
        ]);
        logger.info("[WASM] core blobs created");
        _ffmpeg = createFFmpeg({
          corePath,
          wasmPath,
          workerPath,
          log: false,
          logger: ({ message }) => {
            const m = message.match(/frame=\s*(\d+)/);
            if (m) {
              const frame = parseInt(m[1], 10);
              updateHud({ lastAction: `Decoded ${frame} frames\u2026` });
            }
          }
        });
      }
      if (!_ffmpeg.isLoaded()) {
        logger.info("[WASM] loading ffmpeg-core.wasm\u2026");
        updateHud({ lastAction: "Loading ffmpeg-core.wasm\u2026", decodePercent: 0 });
        yield _ffmpeg.load();
        logger.info("[WASM] ffmpeg-core.wasm loaded");
      }
      updateHud({ lastAction: "Fetching video\u2026", decodePercent: 5 });
      const videoBytes = yield _xhrGetBytes(videoUrl);
      _ffmpeg.FS("writeFile", "input.mp4", videoBytes);
      let width = 1920, height = 1080, fps = 25;
      try {
        yield _ffmpeg.run("-i", "input.mp4");
      } catch (e) {
      }
      updateHud({ lastAction: "Decoding frames\u2026", decodePercent: 10 });
      yield _ffmpeg.run(
        "-i",
        "input.mp4",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgba",
        "-vf",
        "fps=fps=25",
        // normalise to 25fps for predictable timing
        "output%04d.rgba"
      );
      let files = [];
      try {
        files = _ffmpeg.FS("readdir", "/").filter((f) => f.startsWith("output") && f.endsWith(".rgba"));
        files.sort();
      } catch (e) {
        logger.error(`[WASM] readdir failed: ${e == null ? void 0 : e.message}`);
        throw e;
      }
      if (!files.length) throw new Error("ffmpeg produced no output frames");
      logger.info(`[WASM] reading ${files.length} frames`);
      const firstRaw = _ffmpeg.FS("readFile", files[0]);
      const totalPixels = firstRaw.length / 4;
      const KNOWN_WIDTHS = [3840, 1920, 1280, 854, 640];
      for (const w of KNOWN_WIDTHS) {
        if (totalPixels % w === 0) {
          width = w;
          height = totalPixels / w;
          break;
        }
      }
      fps = 25;
      const frames = [];
      const total = files.length;
      for (let i = 0; i < total; i++) {
        const raw = i === 0 ? firstRaw : _ffmpeg.FS("readFile", files[i]);
        const buf = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
        const clamped = new Uint8ClampedArray(buf);
        frames.push(new ImageData(clamped, width, height));
        _ffmpeg.FS("unlink", files[i]);
        const pct = 10 + Math.round(i / total * 88);
        if (i % 10 === 0) {
          updateHud({ decodePercent: pct, lastAction: `Decoded ${i + 1}/${total} frames` });
          yield new Promise((r) => setTimeout(r, 0));
        }
      }
      try {
        _ffmpeg.FS("unlink", "input.mp4");
      } catch (e) {
      }
      const durationMs = total / fps * 1e3;
      logger.info(`[WASM] decode complete: ${total} frames, ${width}\xD7${height}, ${fps}fps, ${Math.round(durationMs)}ms`);
      updateHud({ decodePercent: null, lastAction: `Decode done (${total} frames)` });
      return { frames, fps, width, height, durationMs };
    });
  }
  var _ffmpeg;
  var init_decoder_ffmpeg = __esm({
    "src/decoder-ffmpeg.ts"() {
      init_perf_hud();
      init_logger();
      _ffmpeg = null;
    }
  });

  // src/player-wasm.ts
  function initWasmPlayer(container) {
    _teardown2();
    _canvas = document.createElement("canvas");
    _canvas.style.cssText = "position:absolute;top:0;left:0;width:100%;height:100%;background:#000;";
    container.appendChild(_canvas);
    _ctx = _canvas.getContext("2d");
    onSyncPlay(_handleSyncPlay2);
    onAdjust(_handleAdjust2);
  }
  function loadVideo2(url, itemIndex = 0) {
    return __async(this, null, function* () {
      if (!_canvas || !_ctx) return;
      _itemIndex2 = itemIndex;
      _syncedStartMs2 = -1;
      _snapOffset = 0;
      updateHud({ lastAction: "Decoding\u2026", decodePercent: 0 });
      try {
        _decoded = yield decodeVideo(url);
      } catch (e) {
        logger.error(`[WASM] decode failed: ${e == null ? void 0 : e.message}`);
        throw e;
      }
      _canvas.width = _decoded.width;
      _canvas.height = _decoded.height;
      logger.info("[WASM] decode complete \u2014 signalling READY");
      updateHud({ lastAction: "Ready \u2014 waiting for SYNC_PLAY", decodePercent: null });
      setVideoDuration(_decoded.durationMs);
      setVideoReady(_itemIndex2, "wasm");
      _syncWatchdog2 = setTimeout(() => {
        if (_syncedStartMs2 < 0) {
          logger.warn("[WASM] watchdog: no SYNC_PLAY after 10s \u2014 playing unsynced");
          _syncedStartMs2 = getSyncedTime();
          _startRaf();
        }
      }, 1e4);
    });
  }
  function teardown2() {
    _teardown2();
  }
  function _handleSyncPlay2(msg) {
    clearTimeout(_syncWatchdog2);
    _syncedStartMs2 = msg.syncedStartMs;
    const wait = _syncedStartMs2 - getSyncedTime();
    logger.info(`[WASM] SYNC_PLAY received: startMs=${msg.syncedStartMs} (in ${Math.round(wait)}ms)`);
    updateHud({ lastAction: `SYNC_PLAY in ${Math.round(wait)}ms` });
    if (!_decoded) {
      logger.warn("[WASM] SYNC_PLAY arrived before decode \u2014 storing cue");
      return;
    }
    if (wait <= 0) {
      logger.warn("[WASM] SYNC_PLAY cue already past \u2014 starting immediately");
      _startRaf();
      return;
    }
    const COARSE_THRESHOLD = 50;
    const coarseWait = Math.max(0, wait - COARSE_THRESHOLD);
    setTimeout(() => {
      const target = _syncedStartMs2;
      function tryStart() {
        if (getSyncedTime() >= target) {
          updateHud({ lastAction: "rAF started" });
          _startRaf();
        } else {
          setTimeout(tryStart, 4);
        }
      }
      tryStart();
    }, coarseWait);
  }
  function _handleAdjust2(msg) {
    updateHud({ driftMs: msg.driftMs, lastAction: `${msg.action} ${Math.round(msg.driftMs)}ms` });
    if (msg.action === "snap" && msg.targetMs !== void 0) {
      _snapOffset = msg.targetMs - _getCurrentPositionMs();
      logger.drift(`[WASM] snap offset=${Math.round(_snapOffset)}ms`, msg.driftMs);
    }
    if (msg.action === "nudge" && msg.driftRate !== void 0) {
      const shiftMs = (msg.driftRate - 1) * 1e3;
      _syncedStartMs2 -= shiftMs;
      logger.drift(`[WASM] nudge: shifted syncedStartMs by ${Math.round(-shiftMs)}ms`, msg.driftMs);
    }
  }
  function _startRaf() {
    if (_rafHandle) cancelAnimationFrame(_rafHandle);
    _rafHandle = requestAnimationFrame(_rafTick);
  }
  function _rafTick() {
    if (!_decoded || !_ctx || !_canvas) return;
    const frames = _decoded.frames;
    const frameDurationMs = 1e3 / _decoded.fps;
    const totalFrames = frames.length;
    const elapsed = getSyncedTime() - _syncedStartMs2 + _snapOffset;
    let frameIdx = Math.floor(elapsed / frameDurationMs);
    frameIdx = (frameIdx % totalFrames + totalFrames) % totalFrames;
    const posMs = frameIdx * frameDurationMs;
    const expectedMs = elapsed > 0 ? elapsed % _decoded.durationMs : 0;
    const driftMs = posMs - expectedMs;
    setPlaybackState(_itemIndex2, posMs, "wasm");
    updateHud({ positionMs: posMs, expectedMs, driftMs });
    _ctx.putImageData(frames[frameIdx], 0, 0);
    _rafHandle = requestAnimationFrame(_rafTick);
  }
  function _getCurrentPositionMs() {
    if (!_decoded || _syncedStartMs2 < 0) return 0;
    const frameDurationMs = 1e3 / _decoded.fps;
    const elapsed = getSyncedTime() - _syncedStartMs2 + _snapOffset;
    const frameIdx = Math.floor(elapsed / frameDurationMs);
    return frameIdx * frameDurationMs;
  }
  function _teardown2() {
    if (_rafHandle) {
      cancelAnimationFrame(_rafHandle);
      _rafHandle = 0;
    }
    clearTimeout(_syncWatchdog2);
    if (_canvas) {
      _canvas.remove();
      _canvas = null;
    }
    _ctx = null;
    _decoded = null;
    _syncedStartMs2 = -1;
    _snapOffset = 0;
  }
  var _canvas, _ctx, _decoded, _syncedStartMs2, _rafHandle, _itemIndex2, _snapOffset, _syncWatchdog2;
  var init_player_wasm = __esm({
    "src/player-wasm.ts"() {
      init_ntp_client();
      init_p2p_sync_client();
      init_decoder_ffmpeg();
      init_perf_hud();
      init_logger();
      _canvas = null;
      _ctx = null;
      _decoded = null;
      _syncedStartMs2 = -1;
      _rafHandle = 0;
      _itemIndex2 = 0;
      _snapOffset = 0;
      _syncWatchdog2 = null;
    }
  });

  // src/player-avplay.ts
  function _av() {
    var _a, _b;
    return (_b = (_a = window.webapis) == null ? void 0 : _a.avplay) != null ? _b : null;
  }
  function initAvplayPlayer(container) {
    _teardown3();
    _tearingDown = false;
    if (!_av()) {
      logger.warn("[AVPlay] webapis.avplay not available \u2014 falling back gracefully");
      return;
    }
    _objElem = document.createElement("object");
    _objElem.type = "application/avplayer";
    _objElem.style.cssText = "position:absolute;top:0;left:0;width:100%;height:100%;";
    container.appendChild(_objElem);
    onSyncPlay(_handleSyncPlay3);
    onAdjust(_handleAdjust3);
    _startStateTickTimer2();
    logger.info("[AVPlay] engine initialised");
  }
  function loadVideo3(url, itemIndex = 0) {
    const av = _av();
    if (!av) return Promise.reject(new Error("[AVPlay] webapis.avplay not available"));
    _itemIndex3 = itemIndex;
    _syncedStartMs3 = -1;
    _startScheduled2 = false;
    _seekInFlight = false;
    _playing2 = false;
    logger.info(`[AVPlay] loading: ${url}`);
    updateHud({ positionMs: 0, expectedMs: 0, driftMs: 0, lastAction: "Opening\u2026" });
    return _resolveAbsoluteUri(url).then((absUri) => _openAndPrepare(av, absUri));
  }
  function teardown3() {
    _teardown3();
  }
  function _resolveAbsoluteUri(url) {
    var _a, _b, _c;
    if (/^(https?|file):\/\//i.test(url)) return Promise.resolve(url);
    const rel = url.replace(/^\.\//, "");
    try {
      const base = (_b = (_a = window.tizen) == null ? void 0 : _a.filesystem) == null ? void 0 : _b.toURI("wgt-package");
      if (base && typeof base === "string" && base.length > 5) {
        const abs = (base.endsWith("/") ? base : base + "/") + rel;
        logger.info(`[AVPlay] resolved URI (toURI): ${abs}`);
        return Promise.resolve(abs);
      }
    } catch (e) {
      logger.warn(`[AVPlay] toURI failed: ${e == null ? void 0 : e.message} \u2014 trying resolve()`);
    }
    const tizen = window.tizen;
    if ((_c = tizen == null ? void 0 : tizen.filesystem) == null ? void 0 : _c.resolve) {
      return new Promise((res, rej) => {
        try {
          tizen.filesystem.resolve(
            "wgt-package",
            (dir) => {
              const base = dir.toURI ? dir.toURI() : String(dir);
              const abs = (base.endsWith("/") ? base : base + "/") + rel;
              logger.info(`[AVPlay] resolved URI (resolve): ${abs}`);
              res(abs);
            },
            (e) => {
              logger.warn(`[AVPlay] filesystem.resolve failed: ${e == null ? void 0 : e.message} \u2014 using script fallback`);
              res(_scriptBaseFallback(rel));
            },
            "r"
          );
        } catch (e) {
          logger.warn(`[AVPlay] filesystem.resolve threw: ${e == null ? void 0 : e.message}`);
          res(_scriptBaseFallback(rel));
        }
      });
    }
    return Promise.resolve(_scriptBaseFallback(rel));
  }
  function _scriptBaseFallback(rel) {
    for (const s of Array.from(document.scripts)) {
      if (s.src && s.src.startsWith("file:///") && s.src.includes("bundle.js")) {
        const base = s.src.replace(/js\/bundle\.js.*$/, "");
        const abs = base + rel;
        logger.info(`[AVPlay] resolved URI (script): ${abs}`);
        return abs;
      }
    }
    logger.warn(`[AVPlay] could not resolve absolute URI for: ${rel}`);
    return rel;
  }
  function _openAndPrepare(av, absUri) {
    return new Promise((resolve, reject) => {
      var _a;
      try {
        logger.info(`[AVPlay] open: ${absUri}`);
        av.open(absUri);
        av.setDisplayRect(0, 0, 1920, 1080);
        av.setDisplayMethod("PLAYER_DISPLAY_MODE_FULL_SCREEN");
        av.setListener({
          onbufferingstart: () => {
            updateHud({ lastAction: "Buffering\u2026" });
            logger.info("[AVPlay] buffering start");
          },
          onbufferingcomplete: () => {
            logger.info("[AVPlay] buffering complete");
          },
          onstreamcompleted: () => {
            if (!_playing2 || _tearingDown) return;
            _handleLoop();
          },
          oncurrentplaytime: (_ms2) => {
          },
          onerror: (eventType) => {
            logger.error(`[AVPlay] error: ${eventType}`);
          },
          onerrormsg: (eventType, msg) => {
            logger.error(`[AVPlay] errormsg: ${eventType} \u2014 ${msg}`);
          },
          onresourceconflicted: () => {
            logger.warn("[AVPlay] resource conflict");
          }
        });
        av.prepareAsync(
          () => {
            _videoDurationMs3 = av.getDuration();
            setVideoDuration(_videoDurationMs3);
            logger.info(`[AVPlay] READY \u2014 duration=${_videoDurationMs3}ms`);
            updateHud({ lastAction: "Ready \u2014 waiting for SYNC_PLAY" });
            setVideoReady(_itemIndex3, "avplay");
            _syncWatchdog3 = setTimeout(() => {
              if (!_playing2 && !_tearingDown) {
                logger.warn("[AVPlay] watchdog: no SYNC_PLAY in 8s \u2014 playing unsynced");
                if (_syncedStartMs3 <= 0) _syncedStartMs3 = getSyncedTime();
                _playing2 = true;
                try {
                  av.play();
                } catch (e) {
                }
              }
            }, 8e3);
            if (_syncedStartMs3 > 0) _schedulePlay2();
            resolve();
          },
          (e) => {
            var _a2, _b;
            logger.error(`[AVPlay] prepareAsync failed: ${(_a2 = e == null ? void 0 : e.message) != null ? _a2 : String(e)}`);
            reject(new Error((_b = e == null ? void 0 : e.message) != null ? _b : String(e)));
          }
        );
      } catch (e) {
        logger.error(`[AVPlay] open/setup failed: ${(_a = e == null ? void 0 : e.message) != null ? _a : String(e)}`);
        reject(e);
      }
    });
  }
  function _handleSyncPlay3(msg) {
    var _a;
    clearTimeout(_syncWatchdog3);
    if (_startScheduled2) {
      logger.info("[AVPlay] SYNC_PLAY ignored (play already scheduled)");
      return;
    }
    _syncedStartMs3 = msg.syncedStartMs;
    if (((_a = msg.videoDurationMs) != null ? _a : 0) > 0) _videoDurationMs3 = msg.videoDurationMs;
    logger.info(
      `[AVPlay] SYNC_PLAY: startMs=${msg.syncedStartMs} durationMs=${_videoDurationMs3} (in ${msg.syncedStartMs - getSyncedTime()}ms)`
    );
    if (_av()) _schedulePlay2();
  }
  function _schedulePlay2() {
    if (_startScheduled2 || _tearingDown) return;
    _startScheduled2 = true;
    const av = _av();
    if (!av) return;
    try {
      const state = av.getState();
      if (state === "PLAYING") av.pause();
    } catch (e) {
    }
    const wait = _syncedStartMs3 - getSyncedTime();
    if (wait <= 0) {
      logger.warn("[AVPlay] SYNC_PLAY cue already past \u2014 playing immediately");
      _playing2 = true;
      try {
        av.play();
      } catch (e) {
        logger.warn(`[AVPlay] play() failed: ${e == null ? void 0 : e.message}`);
      }
      return;
    }
    logger.info(`[AVPlay] scheduling play in ${Math.round(wait)}ms`);
    const COARSE_THRESHOLD = 50;
    const coarseWait = Math.max(0, wait - COARSE_THRESHOLD);
    setTimeout(() => {
      const target = _syncedStartMs3;
      function tryPlay() {
        if (_tearingDown) return;
        if (getSyncedTime() >= target) {
          _playing2 = true;
          try {
            av.play();
            updateHud({ lastAction: "play() fired" });
          } catch (e) {
            logger.warn(`[AVPlay] play() failed: ${e == null ? void 0 : e.message}`);
          }
        } else {
          setTimeout(tryPlay, 4);
        }
      }
      tryPlay();
    }, coarseWait);
  }
  function _handleAdjust3(_msg) {
  }
  function _handleLoop() {
    var _a;
    if (_seekInFlight || _tearingDown) return;
    const av = _av();
    if (!av) return;
    if (_syncedStartMs3 <= 0 || _videoDurationMs3 <= 0) {
      logger.info("[AVPlay] loop: no syncedStart \u2014 seeking to 0");
      _seekInFlight = true;
      av.seekTo(0, () => {
        _lastSeekTime2 = Date.now();
        _seekInFlight = false;
        if (!_tearingDown) try {
          av.play();
        } catch (e) {
        }
      }, () => {
        _lastSeekTime2 = Date.now();
        _seekInFlight = false;
        if (!_tearingDown) try {
          av.play();
        } catch (e) {
        }
      });
      return;
    }
    const elapsed = getSyncedTime() - _syncedStartMs3;
    const expectedMs = (elapsed % _videoDurationMs3 + _videoDurationMs3) % _videoDurationMs3;
    logger.info(`[AVPlay] loop: elapsed=${Math.round(elapsed)}ms seekTo=${Math.round(expectedMs)}ms`);
    _seekInFlight = true;
    const onDone = () => {
      _lastSeekTime2 = Date.now();
      _seekInFlight = false;
      if (_tearingDown) return;
      try {
        av.play();
      } catch (e) {
        logger.warn(`[AVPlay] loop play() failed: ${e == null ? void 0 : e.message}`);
      }
    };
    try {
      av.seekTo(Math.round(expectedMs), onDone, (e) => {
        var _a2;
        logger.warn(`[AVPlay] loop seekTo failed: ${(_a2 = e == null ? void 0 : e.message) != null ? _a2 : e} \u2014 playing from 0`);
        _lastSeekTime2 = Date.now();
        _seekInFlight = false;
        if (!_tearingDown) try {
          av.play();
        } catch (e2) {
        }
      });
    } catch (e) {
      logger.warn(`[AVPlay] loop seekTo threw: ${(_a = e == null ? void 0 : e.message) != null ? _a : e}`);
      _lastSeekTime2 = Date.now();
      _seekInFlight = false;
      try {
        av.play();
      } catch (e2) {
      }
    }
  }
  function _startStateTickTimer2() {
    _stateTickTimer2 = setInterval(() => {
      var _a;
      if (!_playing2 || _tearingDown) return;
      if (_seekInFlight || Date.now() - _lastSeekTime2 < SEEK_SETTLE_MS2) return;
      const av = _av();
      if (!av) return;
      const posMs = av.getCurrentTime();
      const syncNow = getSyncedTime();
      let expectedMs = posMs;
      if (_syncedStartMs3 > 0 && _videoDurationMs3 > 0) {
        const elapsed = syncNow - _syncedStartMs3;
        expectedMs = (elapsed % _videoDurationMs3 + _videoDurationMs3) % _videoDurationMs3;
      }
      const driftMs = posMs - expectedMs;
      setPlaybackState(_itemIndex3, posMs, "avplay");
      updateHud({ positionMs: posMs, expectedMs, driftMs });
      if (_syncedStartMs3 > 0 && _videoDurationMs3 > 0) {
        const nearBoundary = expectedMs < NEAR_END_MS2 || expectedMs > _videoDurationMs3 - NEAR_END_MS2;
        const absDrift = Math.abs(driftMs);
        if (!nearBoundary && absDrift > SYNC_SEEK_MS2) {
          logger.info(`[AVPlay] sync-seek: drift ${Math.round(driftMs)}ms \u2192 ${Math.round(expectedMs)}ms`);
          _seekInFlight = true;
          try {
            av.seekTo(
              Math.round(expectedMs),
              () => {
                _lastSeekTime2 = Date.now();
                _seekInFlight = false;
              },
              (e) => {
                var _a2;
                _lastSeekTime2 = Date.now();
                _seekInFlight = false;
                logger.warn(`[AVPlay] sync-seek failed: ${(_a2 = e == null ? void 0 : e.message) != null ? _a2 : e}`);
              }
            );
          } catch (e) {
            _lastSeekTime2 = Date.now();
            _seekInFlight = false;
            logger.warn(`[AVPlay] seekTo threw: ${(_a = e == null ? void 0 : e.message) != null ? _a : e}`);
          }
        }
      }
    }, 50);
  }
  function _teardown3() {
    _tearingDown = true;
    clearInterval(_stateTickTimer2);
    clearTimeout(_syncWatchdog3);
    _stateTickTimer2 = null;
    _syncWatchdog3 = null;
    const av = _av();
    if (av) {
      try {
        const state = av.getState();
        if (state === "PLAYING" || state === "PAUSED" || state === "READY") {
          av.stop();
        }
        if (state !== "NONE") {
          av.close();
        }
      } catch (e) {
      }
    }
    if (_objElem) {
      _objElem.remove();
      _objElem = null;
    }
    _playing2 = false;
    _seekInFlight = false;
    _lastSeekTime2 = 0;
    _startScheduled2 = false;
    _syncedStartMs3 = -1;
    _videoDurationMs3 = 0;
  }
  var SYNC_SEEK_MS2, NEAR_END_MS2, SEEK_SETTLE_MS2, _syncedStartMs3, _startScheduled2, _itemIndex3, _stateTickTimer2, _syncWatchdog3, _videoDurationMs3, _playing2, _seekInFlight, _lastSeekTime2, _tearingDown, _objElem;
  var init_player_avplay = __esm({
    "src/player-avplay.ts"() {
      init_ntp_client();
      init_p2p_sync_client();
      init_perf_hud();
      init_logger();
      SYNC_SEEK_MS2 = 200;
      NEAR_END_MS2 = 500;
      SEEK_SETTLE_MS2 = 1e3;
      _syncedStartMs3 = -1;
      _startScheduled2 = false;
      _itemIndex3 = 0;
      _stateTickTimer2 = null;
      _syncWatchdog3 = null;
      _videoDurationMs3 = 0;
      _playing2 = false;
      _seekInFlight = false;
      _lastSeekTime2 = 0;
      _tearingDown = false;
      _objElem = null;
    }
  });

  // src/app.ts
  var require_app = __commonJS({
    "src/app.ts"(exports) {
      init_ntp_client();
      init_p2p_sync_client();
      init_player_mse();
      init_player_wasm();
      init_player_avplay();
      init_perf_hud();
      init_logger();
      var CONFIG = {
        PI_BASE: "http://192.168.1.17",
        GROUP_ID: "synctest-001"
      };
      var _currentEngine = "avplay";
      var _videoUrl = "";
      var _container;
      var _statusEl;
      var _bannerEl;
      window.addEventListener("load", () => __async(null, null, function* () {
        var _a, _b;
        _container = document.getElementById("video-container");
        _statusEl = document.getElementById("status-msg");
        _bannerEl = document.getElementById("engine-banner");
        initHud();
        _setStatus("Detecting device\u2026");
        const selfIp = yield _getSelfIp();
        const deviceId = yield _getDeviceId(selfIp);
        initLogger(CONFIG.PI_BASE, deviceId);
        logger.info(`[App] boot: ip=${selfIp} deviceId=${deviceId}`);
        _setStatus("Syncing time\u2026");
        yield syncTime(`${CONFIG.PI_BASE}/api/v1/devices`).catch(() => logger.warn("[App] NTP sync failed \u2014 using local clock"));
        logger.info(`[App] NTP offset: ${getNtpOffset()}ms`);
        updateHud({ ntpOffsetMs: getNtpOffset() });
        _setStatus("Connecting to peer\u2026");
        init({
          piBase: CONFIG.PI_BASE,
          deviceId,
          selfIp,
          groupId: CONFIG.GROUP_ID,
          logger: (level, msg) => {
            updateHud({ connectionState: level === "error" ? "error" : getRole() === "pending" ? "connecting" : "connected" });
            logger[level](msg);
          }
        });
        onVideoUrl((msg) => {
          _videoUrl = msg.url;
          logger.info(`[App] VIDEO_URL from leader: ${_videoUrl}`);
          _activateEngine(_currentEngine, _videoUrl);
        });
        onSetEngine((msg) => {
          logger.info(`[App] SET_ENGINE: ${msg.engineMode}`);
          _switchEngine(msg.engineMode);
        });
        try {
          (_b = (_a = window.tizen) == null ? void 0 : _a.tvinputdevice) == null ? void 0 : _b.registerKey("ChannelUp");
        } catch (e) {
        }
        document.addEventListener("keydown", _onKey);
        _setStatus("Loading video\u2026");
        _videoUrl = _fetchVideoUrl();
        logger.info(`[App] video URL: ${_videoUrl}`);
        yield _waitForRole(8e3);
        updateHud({ role: getRole(), engineMode: _currentEngine });
        _setBanner(_currentEngine);
        if (getRole() === "leader") {
          logger.info("[App] leader: sending VIDEO_URL to follower");
          broadcastVideoUrl(_videoUrl);
          _activateEngine(_currentEngine, _videoUrl);
        } else {
          _setStatus("Follower \u2014 waiting for VIDEO_URL\u2026");
          setTimeout(() => {
            if (_videoUrl && !_container.querySelector("video, canvas")) {
              logger.warn("[App] follower fallback: starting engine without leader sync");
              _activateEngine(_currentEngine, _videoUrl);
            }
          }, 5e3);
        }
      }));
      function _activateEngine(engine, url) {
        _hideStatus();
        if (engine === "avplay") {
          initAvplayPlayer(_container);
          loadVideo3(url).catch((e) => logger.error(`[App] AVPlay load failed: ${e == null ? void 0 : e.message}`));
        } else if (engine === "mse") {
          initMsePlayer(_container);
          loadVideo(url).catch((e) => logger.error(`[App] MSE load failed: ${e == null ? void 0 : e.message}`));
        } else {
          initWasmPlayer(_container);
          loadVideo2(url).catch((e) => logger.error(`[App] WASM load failed: ${e == null ? void 0 : e.message}`));
        }
        setLoggerEngine(engine);
        updateHud({ engineMode: engine });
        _setBanner(engine);
      }
      function _switchEngine(newEngine) {
        if (newEngine === _currentEngine) return;
        logger.info(`[App] switching engine: ${_currentEngine} \u2192 ${newEngine}`);
        _currentEngine = newEngine;
        teardown3();
        teardown();
        teardown2();
        _activateEngine(newEngine, _videoUrl);
      }
      function _onKey(e) {
        var _a, _b, _c;
        const CH_PLUS = [427, 33];
        if (CH_PLUS.includes(e.keyCode)) {
          if (getRole() === "leader") {
            const next = _currentEngine === "avplay" ? "mse" : "avplay";
            logger.info(`[App] CH+ key \u2192 broadcastSetEngine(${next})`);
            broadcastSetEngine(next);
            _currentEngine = next;
          } else {
            logger.info("[App] CH+ key ignored \u2014 follower cannot initiate engine switch");
          }
        }
        if (e.keyCode === 10009 || e.keyCode === 8) {
          try {
            (_c = (_b = (_a = window.tizen) == null ? void 0 : _a.application) == null ? void 0 : _b.getCurrentApplication()) == null ? void 0 : _c.exit();
          } catch (e2) {
          }
        }
      }
      function _getSelfIp() {
        return __async(this, null, function* () {
          var _a, _b, _c;
          try {
            const net = (_a = window.webapis) == null ? void 0 : _a.network;
            if (net) {
              const info = (_b = net.getActiveConnectionInfo) == null ? void 0 : _b.call(net);
              if ((info == null ? void 0 : info.ipAddress) && info.ipAddress !== "0.0.0.0") return info.ipAddress;
            }
          } catch (e) {
          }
          try {
            const sysinfo = (_c = window.tizen) == null ? void 0 : _c.systeminfo;
            if (sysinfo) {
              const ip = yield new Promise((resolve, reject) => {
                sysinfo.getPropertyValue(
                  "NETWORK",
                  (net) => {
                    resolve((net == null ? void 0 : net.ipAddress) && net.ipAddress !== "0.0.0.0" ? net.ipAddress : "");
                  },
                  () => resolve("")
                );
              });
              if (ip) return ip;
            }
          } catch (e) {
          }
          const h = window.location.hostname;
          return h && h !== "localhost" ? h : "127.0.0.1";
        });
      }
      function _getDeviceId(selfIp) {
        return __async(this, null, function* () {
          var _a, _b, _c, _d, _e, _f;
          const tag = _getTizenTag();
          try {
            const serial = (_c = (_b = (_a = window.webapis) == null ? void 0 : _a.productinfo) == null ? void 0 : _b.getSerialNumber) == null ? void 0 : _c.call(_b);
            if (serial && serial.trim().length > 0) return tag + serial.trim();
          } catch (e) {
          }
          try {
            const duid = (_f = (_e = (_d = window.webapis) == null ? void 0 : _d.productinfo) == null ? void 0 : _e.getDuid) == null ? void 0 : _f.call(_e);
            if (duid && duid.trim().length > 0) return tag + duid.trim();
          } catch (e) {
          }
          if (selfIp && selfIp !== "127.0.0.1" && selfIp !== "0.0.0.0") return tag + selfIp.replace(/\./g, "-");
          const storageKey = "_nexari_sync_device_id";
          let id = localStorage.getItem(storageKey);
          if (!id) {
            id = "dev-" + Math.random().toString(36).slice(2, 10);
            localStorage.setItem(storageKey, id);
          }
          return id.startsWith(tag) ? id : tag + id;
        });
      }
      function _getTizenTag() {
        var _a, _b, _c;
        try {
          const ver = (_b = (_a = window.tizen) == null ? void 0 : _a.systeminfo) == null ? void 0 : _b.getCapability(
            "http://tizen.org/feature/platform.version"
          );
          if (ver && typeof ver === "string") {
            const parts = ver.split(".");
            const major = parseInt(parts[0], 10);
            const minor = parseInt((_c = parts[1]) != null ? _c : "0", 10);
            const label = minor > 0 ? `${major}.${minor}` : `${major}`;
            return `tizen${label}-`;
          }
        } catch (e) {
        }
        return "";
      }
      var EMBEDDED_MEDIA = [
        "./media/1.mp4",
        "./media/2.mp4",
        "./media/3.mp4"
      ];
      function _fetchVideoUrl() {
        return EMBEDDED_MEDIA[0];
      }
      function _waitForRole(timeoutMs) {
        return __async(this, null, function* () {
          const deadline = Date.now() + timeoutMs;
          while (getRole() === "pending" && Date.now() < deadline) {
            yield new Promise((r) => setTimeout(r, 200));
          }
        });
      }
      function _setStatus(msg) {
        if (_statusEl) {
          _statusEl.textContent = msg;
          _statusEl.style.display = "";
        }
      }
      function _hideStatus() {
        if (_statusEl) _statusEl.style.display = "none";
      }
      function _setBanner(engine) {
        if (_bannerEl) _bannerEl.textContent = engine.toUpperCase();
      }
    }
  });
  require_app();
})();
