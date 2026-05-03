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
    _opts.logger("info", `[P2P] init: deviceId=${opts.deviceId} ip=${opts.selfIp}`);
    _startRegister();
    _startPeerPoll();
    _startSignalDrain();
  }
  function setVideoReady(itemIndex, engineMode) {
    _readyItemIndex = itemIndex;
    _readyEngineMode = engineMode;
    if (_dcOpen && _role === "follower") {
      _send({ type: "READY", deviceId: _opts.deviceId, engineMode });
      _opts == null ? void 0 : _opts.logger("info", `[P2P] follower READY sent (itemIndex=${itemIndex})`);
    }
  }
  function setPlaybackState(itemIndex, currentTimeMs, engineMode) {
    _pbItemIndex = itemIndex;
    _pbCurrentMs = currentTimeMs;
    _pbEngineMode = engineMode;
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
      body: JSON.stringify({ deviceId: _opts.deviceId, role: "peer", ip: _opts.selfIp, groupId: _groupId })
    }).catch(() => {
    });
  }
  function _startPeerPoll() {
    _peerPollTimer = setInterval(_doPeerPoll, PEER_POLL_INTERVAL_MS);
  }
  function _doPeerPoll() {
    return __async(this, null, function* () {
      if (_dcOpen) {
        clearInterval(_peerPollTimer);
        return;
      }
      if (!_opts) return;
      try {
        const res = yield fetch(`${_opts.piBase}/api/v1/test-sync/peers?groupId=${_groupId}`);
        const data = yield res.json();
        const peers = data.peers.filter((p) => p.deviceId !== _opts.deviceId);
        if (!peers.length) return;
        const peer = peers[0];
        _peerIp = peer.ip;
        _peerDeviceId = peer.deviceId;
        _role = _opts.selfIp < peer.ip ? "leader" : "follower";
        _opts.logger("info", `[P2P] peer found: ${peer.ip} \u2192 self is ${_role}`);
        clearInterval(_peerPollTimer);
        _initWebRTC();
      } catch (e) {
        _opts == null ? void 0 : _opts.logger("warn", `[P2P] peer poll failed: ${e == null ? void 0 : e.message}`);
      }
    });
  }
  function _initWebRTC() {
    const config = {
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" }
      ]
    };
    _pc = new RTCPeerConnection(config);
    _pc.onicecandidate = (ev) => {
      if (ev.candidate) _sendSignal({ type: "ice", candidate: ev.candidate.toJSON() });
    };
    _pc.ondatachannel = (ev) => {
      _dc = ev.channel;
      _setupDc();
    };
    if (_role === "leader") {
      _dc = _pc.createDataChannel("sync", { ordered: true });
      _setupDc();
      _pc.createOffer().then((offer) => _pc.setLocalDescription(offer)).then(() => _sendSignal({ type: "offer", sdp: _pc.localDescription.toJSON() })).catch((e) => _opts == null ? void 0 : _opts.logger("error", `[P2P] offer failed: ${e == null ? void 0 : e.message}`));
    }
  }
  function _setupDc() {
    if (!_dc) return;
    _dc.onopen = _onDcOpen;
    _dc.onclose = () => {
      _dcOpen = false;
      _opts == null ? void 0 : _opts.logger("warn", "[P2P] DataChannel closed");
    };
    _dc.onmessage = (ev) => {
      try {
        _handleMessage(JSON.parse(ev.data));
      } catch (e) {
      }
    };
  }
  function _onDcOpen() {
    _dcOpen = true;
    _opts == null ? void 0 : _opts.logger("info", `[P2P] DataChannel open \u2014 role=${_role}`);
    if (_role === "leader") {
      if (_readyItemIndex >= 0) {
        _send({ type: "READY", deviceId: _opts.deviceId, engineMode: _readyEngineMode });
      }
      _startHeartbeat();
    } else {
      if (_readyItemIndex >= 0) {
        _send({ type: "READY", deviceId: _opts.deviceId, engineMode: _readyEngineMode });
      }
      _startHeartbeat();
    }
  }
  function _handleMessage(msg) {
    if (!_opts) return;
    switch (msg.type) {
      case "READY":
        if (_role === "leader") {
          _opts.logger("info", `[P2P] follower READY received (engine=${msg.engineMode})`);
          const startMs = getSyncedTime() + LEADER_START_AHEAD_MS;
          _send({ type: "SYNC_PLAY", syncedStartMs: startMs, itemIndex: _pbItemIndex >= 0 ? _pbItemIndex : 0 });
          _onSyncPlay == null ? void 0 : _onSyncPlay({ type: "SYNC_PLAY", syncedStartMs: startMs, itemIndex: _pbItemIndex >= 0 ? _pbItemIndex : 0 });
          _opts.logger("info", `[P2P] leader broadcast SYNC_PLAY at +5s (syncedStartMs=${startMs})`);
        }
        break;
      case "VIDEO_URL":
        _onVideoUrl == null ? void 0 : _onVideoUrl(msg);
        break;
      case "SET_ENGINE":
        _opts.logger("info", `[P2P] SET_ENGINE received: ${msg.engineMode}`);
        _onSetEngine == null ? void 0 : _onSetEngine(msg);
        break;
      case "SYNC_PLAY":
        _opts.logger("info", `[P2P] SYNC_PLAY received: startMs=${msg.syncedStartMs}`);
        _onSyncPlay == null ? void 0 : _onSyncPlay(msg);
        break;
      case "HEARTBEAT":
        if (_role === "leader") _handleHeartbeat(msg);
        break;
      case "SYNC_ADJUST":
        _onAdjust == null ? void 0 : _onAdjust(msg);
        break;
    }
  }
  function _startHeartbeat() {
    _heartbeatTimer = setInterval(() => {
      if (!_dcOpen) return;
      if (_role === "follower") {
        _send({
          type: "HEARTBEAT",
          deviceId: _opts.deviceId,
          itemIndex: _pbItemIndex,
          currentTimeMs: _pbCurrentMs,
          syncedTime: getSyncedTime(),
          engineMode: _pbEngineMode
        });
      } else {
        _expireStaleFollowers();
      }
    }, HEARTBEAT_INTERVAL_MS);
  }
  function _handleHeartbeat(msg) {
    if (_pbItemIndex < 0 || msg.itemIndex !== _pbItemIndex) return;
    _followerViews[msg.deviceId] = {
      currentMs: msg.currentTimeMs,
      syncedTime: msg.syncedTime,
      itemIndex: msg.itemIndex,
      receivedAt: Date.now()
    };
    const leaderNow = getSyncedTime();
    const expectedMs = _pbCurrentMs - (leaderNow - msg.syncedTime);
    const driftMs = msg.currentTimeMs - expectedMs;
    const absDrift = Math.abs(driftMs);
    let action = "noop";
    let driftRate = 1;
    let targetMs;
    if (absDrift > DRIFT_NUDGE_MS) {
      action = "snap";
      targetMs = _pbCurrentMs + 60;
    } else if (absDrift > DRIFT_NOOP_MS) {
      action = "nudge";
      driftRate = driftMs > 0 ? NUDGE_SLOW : NUDGE_FAST;
    }
    if (action === "noop") return;
    _send({ type: "SYNC_ADJUST", itemIndex: _pbItemIndex, driftMs: Math.round(driftMs), action, driftRate, targetMs });
    _opts == null ? void 0 : _opts.logger("info", `[P2P] SYNC_ADJUST \u2192 ${msg.deviceId}: drift=${Math.round(driftMs)}ms action=${action}`);
  }
  function _expireStaleFollowers() {
    const STALE = 6e3;
    const now = Date.now();
    Object.keys(_followerViews).forEach((id) => {
      if (now - _followerViews[id].receivedAt > STALE) delete _followerViews[id];
    });
  }
  function _startSignalDrain() {
    _signalPollTimer = setInterval(_doSignalDrain, SIGNAL_POLL_INTERVAL_MS);
  }
  function _doSignalDrain() {
    return __async(this, null, function* () {
      if (_dcOpen) return;
      if (!_opts || !_pc) return;
      try {
        const res = yield fetch(`${_opts.piBase}/api/v1/test-sync/signals/${_opts.deviceId}?since=${_signalPollSince}`);
        const data = yield res.json();
        _signalPollSince = data.nextSince;
        for (const entry of data.entries) {
          const { body } = entry;
          if (body.type === "offer" && _role === "follower") {
            yield _pc.setRemoteDescription(new RTCSessionDescription(body.sdp));
            const answer = yield _pc.createAnswer();
            yield _pc.setLocalDescription(answer);
            _sendSignal({ type: "answer", sdp: _pc.localDescription.toJSON() });
          } else if (body.type === "answer" && _role === "leader") {
            yield _pc.setRemoteDescription(new RTCSessionDescription(body.sdp));
          } else if (body.type === "ice") {
            yield _pc.addIceCandidate(new RTCIceCandidate(body.candidate)).catch(() => {
            });
          }
        }
      } catch (e) {
      }
    });
  }
  function _sendSignal(body) {
    if (!_opts || !_peerDeviceId) return;
    fetch(`${_opts.piBase}/api/v1/test-sync/signal/${_peerDeviceId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from: _opts.deviceId, seq: Date.now(), body })
    }).catch(() => {
    });
  }
  function _send(msg) {
    if (!_dc || !_dcOpen) return;
    try {
      _dc.send(JSON.stringify(msg));
    } catch (e) {
      _opts == null ? void 0 : _opts.logger("warn", `[P2P] send failed: ${e == null ? void 0 : e.message}`);
    }
  }
  var REGISTER_INTERVAL_MS, PEER_POLL_INTERVAL_MS, SIGNAL_POLL_INTERVAL_MS, HEARTBEAT_INTERVAL_MS, DRIFT_NOOP_MS, DRIFT_NUDGE_MS, LEADER_START_AHEAD_MS, NUDGE_FAST, NUDGE_SLOW, _opts, _role, _peerIp, _peerDeviceId, _groupId, _pc, _dc, _dcOpen, _readyItemIndex, _readyEngineMode, _pbItemIndex, _pbCurrentMs, _pbEngineMode, _followerViews, _signalPollSince, _registerTimer, _peerPollTimer, _signalPollTimer, _heartbeatTimer, _onSyncPlay, _onVideoUrl, _onSetEngine, _onAdjust;
  var init_p2p_sync_client = __esm({
    "src/p2p-sync-client.ts"() {
      init_ntp_client();
      REGISTER_INTERVAL_MS = 5e3;
      PEER_POLL_INTERVAL_MS = 2e3;
      SIGNAL_POLL_INTERVAL_MS = 500;
      HEARTBEAT_INTERVAL_MS = 1e3;
      DRIFT_NOOP_MS = 30;
      DRIFT_NUDGE_MS = 200;
      LEADER_START_AHEAD_MS = 5e3;
      NUDGE_FAST = 1.005;
      NUDGE_SLOW = 0.995;
      _opts = null;
      _role = "pending";
      _peerIp = null;
      _peerDeviceId = null;
      _groupId = "synctest-001";
      _pc = null;
      _dc = null;
      _dcOpen = false;
      _readyItemIndex = -1;
      _readyEngineMode = "mse";
      _pbItemIndex = -1;
      _pbCurrentMs = 0;
      _pbEngineMode = "mse";
      _followerViews = {};
      _signalPollSince = 0;
      _registerTimer = null;
      _peerPollTimer = null;
      _signalPollTimer = null;
      _heartbeatTimer = null;
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
    _rVfcSupported = typeof _video.requestVideoFrameCallback === "function";
    logger.info(`[MSE] rVFC supported: ${_rVfcSupported}`);
    onSyncPlay(_handleSyncPlay);
    onAdjust(_handleAdjust);
    _startStateTickTimer();
  }
  function loadVideo(url, itemIndex = 0) {
    return __async(this, null, function* () {
      var _a, _b;
      if (!_video) return;
      _itemIndex = itemIndex;
      _syncedStartMs = -1;
      _startScheduled = false;
      logger.info(`[MSE] loading: ${url}`);
      updateHud({ positionMs: 0, expectedMs: 0, driftMs: 0, lastAction: "Buffering\u2026" });
      try {
        _ms = new MediaSource();
        _video.src = URL.createObjectURL(_ms);
        yield new Promise((resolve) => {
          _ms.addEventListener("sourceopen", () => resolve(), { once: true });
        });
        const ext = (_b = (_a = url.split(".").pop()) == null ? void 0 : _a.toLowerCase()) != null ? _b : "mp4";
        const mime = ext === "webm" ? 'video/webm; codecs="vp9"' : 'video/mp4; codecs="avc1.42E01E, mp4a.40.2"';
        if (!MediaSource.isTypeSupported(mime)) {
          throw new Error(`MSE: MIME not supported: ${mime}`);
        }
        _sb = _ms.addSourceBuffer(mime);
        const resp = yield fetch(url);
        if (!resp.ok) throw new Error(`fetch ${url} \u2192 ${resp.status}`);
        const reader = resp.body.getReader();
        yield _streamAppend(reader);
        _ms.endOfStream();
        logger.info("[MSE] source buffer complete");
      } catch (e) {
        logger.error(`[MSE] load failed: ${e == null ? void 0 : e.message}`);
        throw e;
      }
      yield new Promise((resolve) => {
        if (!_video) return resolve();
        if (_video.readyState >= 3) {
          resolve();
          return;
        }
        _video.addEventListener("canplay", () => resolve(), { once: true });
      });
      logger.info("[MSE] canplay \u2014 signalling READY");
      updateHud({ lastAction: "Ready \u2014 waiting for SYNC_PLAY" });
      setVideoReady(_itemIndex, "mse");
      _video.pause();
      _syncWatchdog = setTimeout(() => {
        if (_video == null ? void 0 : _video.paused) {
          logger.warn("[MSE] watchdog: no SYNC_PLAY after 8s \u2014 playing unsynced");
          _video.play().catch(() => {
          });
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
    clearTimeout(_syncWatchdog);
    _syncedStartMs = msg.syncedStartMs;
    logger.info(`[MSE] SYNC_PLAY received: startMs=${msg.syncedStartMs} (in ${msg.syncedStartMs - getSyncedTime()}ms)`);
    if (_video && _video.readyState >= 3) _schedulePlay();
  }
  function _schedulePlay() {
    if (_startScheduled || !_video) return;
    _startScheduled = true;
    const wait = _syncedStartMs - getSyncedTime();
    if (wait <= 0) {
      logger.warn("[MSE] SYNC_PLAY cue already past \u2014 playing immediately");
      _video.play().catch((e) => logger.error(`[MSE] play failed: ${e == null ? void 0 : e.message}`));
      return;
    }
    logger.info(`[MSE] scheduling play in ${Math.round(wait)}ms`);
    const COARSE_THRESHOLD = 50;
    const coarseWait = Math.max(0, wait - COARSE_THRESHOLD);
    setTimeout(() => {
      const target = _syncedStartMs;
      function tryPlay() {
        if (getSyncedTime() >= target) {
          _video == null ? void 0 : _video.play().catch((e) => logger.error(`[MSE] play() failed: ${e == null ? void 0 : e.message}`));
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
  function _startStateTickTimer() {
    if (_rVfcSupported) return;
    _stateTickTimer = setInterval(() => {
      if (!_video) return;
      const posMs = _video.currentTime * 1e3;
      const syncNow = getSyncedTime();
      const elapsed = syncNow - _syncedStartMs;
      const expectedMs = _syncedStartMs > 0 && elapsed > 0 ? elapsed : posMs;
      const driftMs = posMs - expectedMs;
      setPlaybackState(_itemIndex, posMs, "mse");
      updateHud({ positionMs: posMs, expectedMs, driftMs });
    }, 50);
  }
  function _streamAppend(reader) {
    return __async(this, null, function* () {
      let buf = new Uint8Array(0);
      while (true) {
        const { done, value } = yield reader.read();
        if (done) {
          if (buf.length > 0) yield _appendChunk(buf);
          break;
        }
        const next = new Uint8Array(buf.length + value.length);
        next.set(buf);
        next.set(value, buf.length);
        buf = next;
        while (buf.length >= CHUNK_SIZE) {
          yield _appendChunk(buf.slice(0, CHUNK_SIZE));
          buf = buf.slice(CHUNK_SIZE);
        }
      }
    });
  }
  function _appendChunk(chunk) {
    return __async(this, null, function* () {
      if (!_sb) return;
      if (_sb.updating) {
        yield new Promise((r) => _sb.addEventListener("updateend", () => r(), { once: true }));
      }
      const ab = chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength);
      _sb.appendBuffer(ab);
      yield new Promise((r) => _sb.addEventListener("updateend", () => r(), { once: true }));
    });
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
  }
  var CHUNK_SIZE, _video, _ms, _sb, _syncedStartMs, _startScheduled, _itemIndex, _stateTickTimer, _rVfcSupported, _syncWatchdog;
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
    }
  });

  // src/decoder-ffmpeg.ts
  function decodeVideo(videoUrl) {
    return __async(this, null, function* () {
      logger.info(`[WASM] starting ffmpeg decode: ${videoUrl}`);
      updateHud({ decodePercent: 0, lastAction: "Initialising ffmpeg\u2026" });
      if (!_ffmpeg) {
        const { createFFmpeg } = FFmpeg;
        _ffmpeg = createFFmpeg({
          corePath: "./js/lib/ffmpeg/ffmpeg-core.js",
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
      const { fetchFile } = FFmpeg;
      const fileData = yield fetchFile(videoUrl);
      _ffmpeg.FS("writeFile", "input.mp4", fileData);
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

  // src/app.ts
  var require_app = __commonJS({
    "src/app.ts"(exports) {
      init_ntp_client();
      init_p2p_sync_client();
      init_player_mse();
      init_player_wasm();
      init_perf_hud();
      init_logger();
      var CONFIG = {
        PI_BASE: "http://192.168.1.17",
        GROUP_ID: "synctest-001"
      };
      var _currentEngine = "mse";
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
        const deviceId = selfIp.replace(/\./g, "-");
        initLogger(CONFIG.PI_BASE, deviceId);
        logger.info(`[App] boot: ip=${selfIp} deviceId=${deviceId}`);
        _setStatus("Syncing time\u2026");
        yield syncTime(CONFIG.PI_BASE).catch(() => logger.warn("[App] NTP sync failed \u2014 using local clock"));
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
        _setStatus("Fetching video\u2026");
        _videoUrl = yield _fetchVideoUrl();
        logger.info(`[App] video URL: ${_videoUrl}`);
        yield _waitForRole(8e3);
        updateHud({ role: getRole(), engineMode: _currentEngine });
        _setBanner(_currentEngine);
        if (getRole() === "leader") {
          logger.info("[App] leader: sending VIDEO_URL to follower");
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
        if (engine === "mse") {
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
        teardown();
        teardown2();
        _activateEngine(newEngine, _videoUrl);
      }
      function _onKey(e) {
        var _a, _b, _c;
        const CH_PLUS = [427, 33];
        if (CH_PLUS.includes(e.keyCode)) {
          if (getRole() === "leader") {
            const next = _currentEngine === "mse" ? "wasm" : "mse";
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
          var _a;
          try {
            const sysinfo = (_a = window.tizen) == null ? void 0 : _a.systeminfo;
            if (sysinfo) {
              return yield new Promise((resolve, reject) => {
                sysinfo.getPropertyValue("NETWORK", (net) => {
                  var _a2;
                  resolve((_a2 = net == null ? void 0 : net.ipAddress) != null ? _a2 : "0.0.0.0");
                }, reject);
              });
            }
          } catch (e) {
          }
          return window.location.hostname || "127.0.0.1";
        });
      }
      function _fetchVideoUrl() {
        return __async(this, null, function* () {
          var _a, _b;
          try {
            const res = yield fetch(`${CONFIG.PI_BASE}/api/v1/content?type=video&limit=1`);
            const data = yield res.json();
            const item = (_b = (_a = data == null ? void 0 : data.items) == null ? void 0 : _a[0]) != null ? _b : data == null ? void 0 : data[0];
            if (item == null ? void 0 : item.url) return item.url;
            if (item == null ? void 0 : item.filePath) return `${CONFIG.PI_BASE}/uploads/${item.filePath}`;
          } catch (e) {
            logger.error(`[App] fetchVideoUrl failed: ${e == null ? void 0 : e.message}`);
          }
          return "";
        });
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
