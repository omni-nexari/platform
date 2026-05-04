(() => {
  var __getOwnPropNames = Object.getOwnPropertyNames;
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

  // src/logger.ts
  function initLogger(piBase, deviceId) {
    _piBase = piBase;
    _deviceId = deviceId;
    setInterval(_flush, 2e3);
  }
  function _push(level, msg, driftMs) {
    var _a;
    const entry = { deviceId: _deviceId, level, msg, ts: Date.now() };
    if (driftMs !== void 0) entry.driftMs = driftMs;
    ((_a = console[level]) != null ? _a : console.log)(`[${level.toUpperCase()}] ${msg}`);
    _appendToUi(level, msg);
    if (_piBase && _deviceId) _queue.push(entry);
  }
  function _appendToUi(level, msg) {
    const panel = document.getElementById("log-panel");
    if (!panel) return;
    const cls = level === "warn" ? "l-warn" : level === "error" ? "l-error" : msg.includes("drift") ? "l-drift" : "l-info";
    const line = document.createElement("div");
    line.className = cls;
    const t = (/* @__PURE__ */ new Date()).toISOString().slice(11, 23);
    line.innerHTML = `<span class="l-ts">${t}</span>${_esc(msg)}`;
    panel.appendChild(line);
    while (panel.children.length > 201) panel.removeChild(panel.children[1]);
    panel.scrollTop = panel.scrollHeight;
  }
  function _esc(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function _flush() {
    return __async(this, null, function* () {
      if (_flushing || !_queue.length || !_piBase) return;
      _flushing = true;
      const batch = _queue.splice(0, 20);
      try {
        for (const entry of batch) {
          const timeout = new Promise(
            (_, rej) => setTimeout(() => rej(new Error("log flush timeout")), 3e3)
          );
          yield Promise.race([
            fetch(`${_piBase}/api/v1/test-sync/log`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(entry)
            }),
            timeout
          ]);
        }
      } catch (e) {
      } finally {
        _flushing = false;
      }
    });
  }
  var _piBase, _deviceId, _queue, _flushing, logger;
  var init_logger = __esm({
    "src/logger.ts"() {
      _piBase = "";
      _deviceId = "";
      _queue = [];
      _flushing = false;
      logger = {
        info: (msg) => _push("info", msg),
        warn: (msg) => _push("warn", msg),
        error: (msg) => _push("error", msg),
        drift: (msg, driftMs) => _push("info", msg, driftMs)
      };
    }
  });

  // src/engine.ts
  function initEngine(container) {
    _destroyed = false;
    _playing = false;
    _durationMs = 0;
    _playAtEpoch = -1;
    _playStartEpoch = -1;
    const portrait = window.screen.width < window.screen.height;
    logger.info(`[HTML5] init \u2014 screen=${window.screen.width}x${window.screen.height} layout=${portrait ? "portrait" : "landscape"}`);
    _video = document.createElement("video");
    _video.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;z-index:0;object-fit:contain;background:#000;";
    _video.setAttribute("playsinline", "");
    _video.setAttribute("webkit-playsinline", "");
    _video.muted = true;
    _video.loop = true;
    container.appendChild(_video);
    _video.addEventListener("ended", () => {
      logger.warn("[HTML5] ended fired despite loop=true \u2014 forcing replay");
      if (_video && !_destroyed) {
        try {
          _video.currentTime = 0;
          _video.play();
        } catch (e) {
        }
      }
    });
    _video.addEventListener("error", () => {
      var _a, _b, _c;
      logger.error(`[HTML5] video error: ${(_b = (_a = _video == null ? void 0 : _video.error) == null ? void 0 : _a.message) != null ? _b : "unknown"} (code ${(_c = _video == null ? void 0 : _video.error) == null ? void 0 : _c.code})`);
    });
    _video.addEventListener("timeupdate", () => {
      var _a, _b;
      if (_destroyed || !_playing || _playStartEpoch < 0 || _durationMs <= 0) return;
      const now = Date.now();
      if (now - _lastDriftLog < 2e3) return;
      _lastDriftLog = now;
      const v = _video;
      const posMs = Math.round(((_a = v.currentTime) != null ? _a : 0) * 1e3);
      let actualRate = null;
      let actualRateStr = "";
      const ct = (_b = v.currentTime) != null ? _b : 0;
      if (_prevProbeCt >= 0 && _prevProbeWall >= 0) {
        const dtWall = (now - _prevProbeWall) / 1e3;
        let dtCt = ct - _prevProbeCt;
        if (dtCt < -1) dtCt += _durationMs / 1e3;
        if (dtWall > 0.1) {
          actualRate = dtCt / dtWall;
          actualRateStr = ` actualRate=${actualRate.toFixed(3)}`;
        }
      }
      _prevProbeCt = ct;
      _prevProbeWall = now;
      const inGrace = _playStartedAt >= 0 && now - _playStartedAt < STARTUP_ANCHOR_GRACE_MS;
      const rateOk = actualRate === null || actualRate >= 0.85 && actualRate <= 1.1;
      if (!inGrace && rateOk) {
        _reanchorClock();
      }
      const exp = _expectedMs();
      const drift = posMs - exp;
      let bufStr = "";
      try {
        const buf = v.buffered;
        if (buf && buf.length > 0) {
          const end = Math.round(buf.end(buf.length - 1) * 1e3);
          bufStr = ` buf=0-${end}ms`;
        } else {
          bufStr = " buf=empty";
        }
      } catch (e) {
      }
      logger.drift(
        `[HTML5] pos=${posMs}ms exp=${Math.round(exp)}ms drift=${Math.round(drift)}ms rate=${v.playbackRate.toFixed(3)}${actualRateStr}${bufStr}`,
        drift
      );
    });
    logger.info("[HTML5] <video> engine initialised");
  }
  function prepare(url) {
    if (!_video || _destroyed) return Promise.reject(new Error("[HTML5] engine not initialised"));
    _playing = false;
    _durationMs = 0;
    return new Promise((resolve, reject) => {
      const v = _video;
      const cleanup = () => {
        v.removeEventListener("canplaythrough", onReady);
        v.removeEventListener("loadedmetadata", onMeta);
        v.removeEventListener("error", onErr);
      };
      const onMeta = () => {
        var _a;
        _durationMs = Math.round(((_a = v.duration) != null ? _a : 0) * 1e3);
        logger.info(`[HTML5] loadedmetadata \u2014 duration=${_durationMs}ms videoSize=${v.videoWidth}x${v.videoHeight}`);
      };
      const onReady = () => __async(null, null, function* () {
        var _a;
        cleanup();
        if (_durationMs <= 0) _durationMs = Math.round(((_a = v.duration) != null ? _a : 0) * 1e3);
        logger.info(`[HTML5] canplaythrough \u2014 duration=${_durationMs}ms`);
        try {
          yield _primeDecoder(v);
          logger.info("[HTML5] decoder primed \u2014 ready to play instantly");
        } catch (e) {
          logger.warn(`[HTML5] decoder prime failed (continuing): ${e == null ? void 0 : e.message}`);
        }
        resolve();
      });
      const onErr = () => {
        var _a, _b;
        cleanup();
        reject(new Error(`[HTML5] load error: ${(_b = (_a = v.error) == null ? void 0 : _a.message) != null ? _b : "unknown"}`));
      };
      v.addEventListener("loadedmetadata", onMeta);
      v.addEventListener("canplaythrough", onReady);
      v.addEventListener("error", onErr);
      v.src = url;
      v.preload = "auto";
      v.load();
      logger.info(`[HTML5] loading: ${url}`);
    });
  }
  function _primeDecoder(v) {
    return new Promise((resolve) => {
      let settled = false;
      const PRIME_PLAY_MS = 250;
      const finish = () => {
        if (settled) return;
        settled = true;
        try {
          v.pause();
        } catch (e) {
        }
        const onSeeked = () => {
          v.removeEventListener("seeked", onSeeked);
          try {
            v.playbackRate = 1;
          } catch (e) {
          }
          resolve();
        };
        v.addEventListener("seeked", onSeeked);
        try {
          v.currentTime = 0;
        } catch (e) {
          resolve();
        }
        setTimeout(() => {
          v.removeEventListener("seeked", onSeeked);
          resolve();
        }, 1500);
      };
      setTimeout(finish, 4e3);
      v.muted = true;
      v.playbackRate = 1;
      v.play().then(() => {
        setTimeout(finish, PRIME_PLAY_MS);
      }).catch(() => finish());
    });
  }
  function schedulePlayAt(epochMs) {
    if (_destroyed) return;
    _playAtEpoch = epochMs;
    clearTimeout(_playTimer);
    const wait = epochMs - Date.now();
    logger.info(`[HTML5] schedulePlayAt epoch=${epochMs} T-${Math.round(Math.max(0, wait))}ms`);
    if (wait <= 0) {
      _doPlay();
      return;
    }
    _playTimer = setTimeout(() => {
      (function spin() {
        if (_destroyed) return;
        if (Date.now() >= _playAtEpoch) {
          _doPlay();
          return;
        }
        setTimeout(spin, 4);
      })();
    }, Math.max(0, wait - 60));
  }
  function _doPlay() {
    if (_destroyed || _playing || !_video) return;
    _video.currentTime = 0;
    _video.playbackRate = 1;
    _prevProbeCt = -1;
    _prevProbeWall = -1;
    _video.play().then(() => {
      _playing = true;
      _playStartEpoch = _playAtEpoch > 0 ? _playAtEpoch : Date.now();
      _playStartedAt = Date.now();
      logger.info(`[HTML5] play() \u2014 startEpoch=${_playStartEpoch}`);
    }).catch((e) => logger.error(`[HTML5] play() failed: ${e == null ? void 0 : e.message}`));
  }
  function getDuration() {
    return _durationMs;
  }
  function isPlaying() {
    return _playing;
  }
  function getCurrentPosMs() {
    var _a;
    if (!_video || !_playing) return null;
    return Math.round(((_a = _video.currentTime) != null ? _a : 0) * 1e3);
  }
  function nudgePhase(deltaMs) {
    if (_destroyed || !_playing || !_video) return;
    if (Math.abs(deltaMs) < RATE_MIN_DELTA_MS) return;
    let rateOffset = -deltaMs / RATE_WINDOW_MS;
    if (rateOffset > RATE_MAX_OFFSET) rateOffset = RATE_MAX_OFFSET;
    if (rateOffset < -RATE_MAX_OFFSET) rateOffset = -RATE_MAX_OFFSET;
    const newRate = Math.max(0.5, Math.min(2, 1 + rateOffset));
    _video.playbackRate = newRate;
    clearTimeout(_rateTimer);
    _rateTimer = setTimeout(() => {
      if (_video && !_destroyed) _video.playbackRate = 1;
    }, RATE_WINDOW_MS);
    logger.info(`[HTML5] nudge drift=${deltaMs}ms \u2192 rate=${newRate.toFixed(3)} for ${RATE_WINDOW_MS}ms`);
  }
  function destroyEngine() {
    _destroyed = true;
    _playing = false;
    clearTimeout(_playTimer);
    clearTimeout(_rateTimer);
    if (_video) {
      try {
        _video.pause();
      } catch (e) {
      }
      _video.src = "";
      try {
        _video.load();
      } catch (e) {
      }
      if (_video.parentNode) _video.parentNode.removeChild(_video);
      _video = null;
    }
    logger.info("[HTML5] engine destroyed");
  }
  function _expectedMs() {
    if (_playStartEpoch < 0 || _durationMs <= 0) return 0;
    return ((Date.now() - _playStartEpoch) % _durationMs + _durationMs) % _durationMs;
  }
  function _reanchorClock() {
    var _a;
    if (!_video || _playStartEpoch < 0 || _durationMs <= 0) return;
    const posMs = Math.round(((_a = _video.currentTime) != null ? _a : 0) * 1e3);
    if (posMs < 200) return;
    const now = Date.now();
    const elapsed = now - _playStartEpoch;
    const loopN = Math.floor(elapsed / _durationMs);
    const corrected = now - (loopN * _durationMs + posMs);
    const delta = corrected - _playStartEpoch;
    const firstAnchor = _playStartedAt >= 0 && now - _playStartedAt < STARTUP_ANCHOR_GRACE_MS + 6e3;
    const maxDelta = firstAnchor ? _durationMs * 1.5 : 2e3;
    if (Math.abs(delta) > 20 && Math.abs(delta) < maxDelta) {
      const tag = Math.abs(delta) > 500 ? "startup-anchor" : "re-anchor";
      logger.info(`[HTML5] clock ${tag}: _playStartEpoch ${delta > 0 ? "+" : ""}${Math.round(delta)}ms \u2192 actualPos=${posMs}ms`);
      _playStartEpoch = corrected;
    }
  }
  var _video, _destroyed, _playing, _durationMs, _playAtEpoch, _playStartEpoch, _playTimer, _lastDriftLog, _prevProbeCt, _prevProbeWall, STARTUP_ANCHOR_GRACE_MS, _playStartedAt, _rateTimer, RATE_WINDOW_MS, RATE_MAX_OFFSET, RATE_MIN_DELTA_MS;
  var init_engine = __esm({
    "src/engine.ts"() {
      init_logger();
      _video = null;
      _destroyed = false;
      _playing = false;
      _durationMs = 0;
      _playAtEpoch = -1;
      _playStartEpoch = -1;
      _playTimer = null;
      _lastDriftLog = 0;
      _prevProbeCt = -1;
      _prevProbeWall = -1;
      STARTUP_ANCHOR_GRACE_MS = 15e3;
      _playStartedAt = -1;
      _rateTimer = null;
      RATE_WINDOW_MS = 2500;
      RATE_MAX_OFFSET = 0.1;
      RATE_MIN_DELTA_MS = 4;
    }
  });

  // src/clock.ts
  function getOffsetMs() {
    return _offsetMs;
  }
  function localToServer(localMs) {
    return localMs + _offsetMs;
  }
  function serverToLocal(serverMs) {
    return serverMs - _offsetMs;
  }
  function measureOffset(piBase, samples = 7) {
    return __async(this, null, function* () {
      const results = [];
      for (let i = 0; i < samples; i++) {
        try {
          const t1 = Date.now();
          const res = yield fetch(`${piBase}/api/v1/test-sync/time`, { cache: "no-store" });
          const t3 = Date.now();
          if (!res.ok) {
            logger.warn(`[Clock] sample ${i} HTTP ${res.status}`);
            continue;
          }
          const data = yield res.json();
          const t2 = Number(data.serverTimeMs);
          if (!isFinite(t2)) continue;
          const rtt = t3 - t1;
          const offset = t2 + rtt / 2 - t3;
          results.push({ offset, rtt });
        } catch (e) {
          logger.warn(`[Clock] sample ${i} failed: ${e == null ? void 0 : e.message}`);
        }
        yield new Promise((r) => setTimeout(r, 50));
      }
      if (results.length === 0) {
        logger.warn("[Clock] no samples succeeded \u2014 using offset=0");
        _offsetMs = 0;
        _measured = false;
        _bestRttMs = -1;
        return 0;
      }
      results.sort((a, b) => a.rtt - b.rtt);
      const best = results[0];
      _offsetMs = Math.round(best.offset);
      _bestRttMs = best.rtt;
      _measured = true;
      const summary = results.map((r) => `rtt=${r.rtt}ms off=${Math.round(r.offset)}ms`).join("; ");
      logger.info(`[Clock] offset=${_offsetMs}ms bestRtt=${_bestRttMs}ms samples=${results.length} | ${summary}`);
      return _offsetMs;
    });
  }
  var _offsetMs, _measured, _bestRttMs;
  var init_clock = __esm({
    "src/clock.ts"() {
      init_logger();
      _offsetMs = 0;
      _measured = false;
      _bestRttMs = -1;
    }
  });

  // src/sync.ts
  function _calLsKey() {
    return CAL_LS_KEY_PREFIX + _cfg.deviceId;
  }
  function _loadStoredLatency() {
    var _a;
    try {
      const v = (_a = window.localStorage) == null ? void 0 : _a.getItem(_calLsKey());
      if (v == null) return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    } catch (e) {
      return null;
    }
  }
  function _saveStoredLatency(ms) {
    var _a;
    try {
      (_a = window.localStorage) == null ? void 0 : _a.setItem(_calLsKey(), String(Math.round(ms)));
    } catch (e) {
    }
  }
  function _selfLatencyMs() {
    return _selfLatencyCached;
  }
  function init(cfg) {
    return __async(this, null, function* () {
      var _a;
      _cfg = cfg;
      _stopped = false;
      _role = "pending";
      _peers = [];
      _pollSince = 0;
      _leaderEngineReady = false;
      _followerReadySet = /* @__PURE__ */ new Set();
      _goSent = false;
      _loadReceived = false;
      logger.info(`[Sync] init deviceId=${cfg.deviceId} group=${cfg.groupId}`);
      cfg.onStatus("Registering with relay\u2026");
      const stored = _loadStoredLatency();
      if (stored != null) {
        _selfLatencyCached = stored;
        logger.info(`[Sync] self-latency loaded from localStorage: ${stored}ms`);
      } else {
        _selfLatencyCached = (_a = DEVICE_LATENCY_FALLBACK_MS[cfg.deviceId]) != null ? _a : 0;
        logger.info(`[Sync] self-latency seeded from fallback table: ${_selfLatencyCached}ms`);
      }
      yield _register();
      setInterval(_register, REGISTER_EVERY);
      cfg.onStatus("Measuring clock offset\u2026");
      yield measureOffset(cfg.piBase);
      setInterval(() => {
        measureOffset(cfg.piBase).catch(() => {
        });
      }, 6e4);
      setInterval(() => {
        logger.info(`[Sync] heartbeat role=${_role} peers=[${_peers.join(",")}] stopped=${_stopped}`);
      }, 1e4);
      cfg.onStatus(`Waiting for ${cfg.expectedPeers} peers\u2026`);
      yield _waitForPeers();
      logger.info(`[Sync] role=${_role} peers=[${_peers.join(", ")}]`);
      cfg.onStatus(`Role: ${_role} \u2014 peer(s): ${_peers.join(", ")}`);
      _startPoll();
      if (_role === "leader") {
        yield _runLeader();
        _startLeaderPeerWatch();
      } else {
        cfg.onStatus("Follower \u2014 waiting for LOAD_URL from leader\u2026");
      }
    });
  }
  function stop() {
    _stopped = true;
    _stopPhaseHeartbeat();
    _stopLeaderPeerWatch();
    logger.info("[Sync] stopped");
  }
  function _runLeader() {
    return __async(this, null, function* () {
      _cfg.onStatus("Leader \u2014 fetching video URL\u2026");
      const url = yield _fetchVideoUrl();
      logger.info(`[Sync] leader video URL: ${url}`);
      for (const peer of _peers) {
        _send(peer, { type: "LOAD_URL", url });
      }
      _cfg.onStatus("Leader \u2014 preparing engine\u2026");
      _cfg.prepareEngine(url).then(() => {
        if (_stopped) return;
        logger.info("[Sync] leader engine READY");
        _leaderEngineReady = true;
        _cfg.onStatus(`Leader ready \u2014 waiting for followers (${_followerReadySet.size}/${_peers.length})\u2026`);
        _checkAllReady();
      }).catch((e) => {
        logger.error(`[Sync] leader engine prepare failed: ${e == null ? void 0 : e.message} \u2014 restarting in 5s`);
        if (!_stopped) setTimeout(() => {
          if (!_stopped) _runLeader();
        }, 5e3);
      });
    });
  }
  function _checkAllReady() {
    if (!_leaderEngineReady || _followerReadySet.size < _peers.length || _goSent || _stopped) return;
    _goSent = true;
    const localPlayAt = Date.now() + GO_AHEAD_MS;
    const serverPlayAt = localToServer(localPlayAt);
    const durationMs = _cfg.getEngineDuration();
    logger.info(`[Sync] ALL READY \u2192 GO localPlayAt=${localPlayAt} serverPlayAt=${serverPlayAt} offset=${getOffsetMs()}ms (+${GO_AHEAD_MS}ms) durationMs=${durationMs}`);
    _cfg.onStatus(`ALL READY \u2014 play in ${GO_AHEAD_MS / 1e3}s (server epoch ${serverPlayAt})`);
    for (const peer of _peers) {
      _send(peer, { type: "GO", playAt: serverPlayAt, durationMs });
    }
    const selfLatency = _selfLatencyMs();
    logger.info(`[Sync] leader self-schedule localPlayAt=${localPlayAt} latencyOffset=+${selfLatency}ms`);
    _cfg.schedulePlay(localPlayAt + selfLatency);
    _startPhaseHeartbeat();
  }
  function _startLeaderPeerWatch() {
    if (_leaderPeerWatchTimer || _stopped || _role !== "leader") return;
    _leaderPeerWatchTimer = setInterval(_leaderPeerScan, LEADER_PEER_SCAN_MS);
    logger.info("[Sync] leader peer-watch started");
  }
  function _stopLeaderPeerWatch() {
    if (_leaderPeerWatchTimer) {
      clearInterval(_leaderPeerWatchTimer);
      _leaderPeerWatchTimer = null;
    }
  }
  function _leaderPeerScan() {
    return __async(this, null, function* () {
      if (_stopped || _resyncInProgress || _role !== "leader") return;
      try {
        const res = yield _fetchTimeout(
          `${_cfg.piBase}/api/v1/test-sync/peers?groupId=${_cfg.groupId}`
        );
        if (!res.ok) return;
        const { peers = [] } = yield res.json();
        const now = Date.now();
        const fresh = peers.filter((p) => now - p.registeredAt < LEADER_PEER_FRESH_MS);
        const others = fresh.filter((p) => p.deviceId !== _cfg.deviceId).map((p) => p.deviceId);
        const known = new Set(_peers);
        const joiners = others.filter((id) => !known.has(id));
        if (joiners.length === 0) return;
        logger.info(`[Sync] new follower(s) joined: [${joiners.join(",")}] \u2014 triggering resync`);
        _cfg.onStatus(`New follower joined (${joiners.join(",")}) \u2014 resyncing\u2026`);
        _peers = others;
        yield _resyncLeader();
      } catch (e) {
        logger.warn(`[Sync] leader peer scan failed: ${e == null ? void 0 : e.message}`);
      }
    });
  }
  function _resyncLeader() {
    return __async(this, null, function* () {
      if (_resyncInProgress || _stopped) return;
      _resyncInProgress = true;
      try {
        _stopPhaseHeartbeat();
        _leaderEngineReady = false;
        _followerReadySet = /* @__PURE__ */ new Set();
        _goSent = false;
        if (_cfg.restartEngine) {
          try {
            _cfg.restartEngine();
          } catch (e) {
            logger.warn(`[Sync] restartEngine failed: ${e == null ? void 0 : e.message}`);
          }
        }
        yield _runLeader();
      } finally {
        _resyncInProgress = false;
      }
    });
  }
  function _dispatch(msg, from) {
    logger.info(`[Sync] \u2190 ${msg.type} from=${from}`);
    if (msg.type === "LOAD_URL") {
      if (_role !== "follower") return;
      if (_loadReceived) {
        logger.info("[Sync] LOAD_URL duplicate \u2014 ignored");
        return;
      }
      _loadReceived = true;
      _cfg.onStatus(`Follower \u2014 preparing engine: ${msg.url.split("/").pop()}`);
      _cfg.prepareEngine(msg.url).then(() => {
        if (_stopped) return;
        logger.info("[Sync] follower engine READY \u2014 sending READY to all peers");
        _cfg.onStatus("Follower \u2014 READY sent, waiting for GO\u2026");
        for (const peer of _peers) {
          _send(peer, { type: "READY" });
        }
      }).catch((e) => {
        logger.error(`[Sync] follower prepare failed: ${e == null ? void 0 : e.message} \u2014 retrying in 3s`);
        if (!_stopped) {
          setTimeout(() => {
            _loadReceived = false;
            logger.info("[Sync] follower ready for retry");
          }, 3e3);
        }
      });
      return;
    }
    if (msg.type === "READY") {
      if (_role !== "leader") return;
      _followerReadySet.add(from);
      logger.info(`[Sync] follower READY: ${from} (${_followerReadySet.size}/${_peers.length})`);
      _cfg.onStatus(`Leader \u2014 ${_followerReadySet.size}/${_peers.length} follower(s) ready`);
      _checkAllReady();
      return;
    }
    if (msg.type === "GO") {
      if (_role !== "follower") return;
      const serverPlayAt = msg.playAt;
      const localPlayAt = serverToLocal(serverPlayAt);
      const selfLatency = _selfLatencyMs();
      const adjustedLocal = localPlayAt + selfLatency;
      const wait = adjustedLocal - Date.now();
      logger.info(`[Sync] GO \u2192 schedulePlay in T-${Math.round(wait)}ms (serverEpoch=${serverPlayAt} localEpoch=${localPlayAt} latencyOffset=+${selfLatency}ms adjusted=${adjustedLocal} clockOffset=${getOffsetMs()}ms)`);
      _cfg.onStatus(`GO received \u2014 playing in ${Math.round(wait / 100) * 100 / 1e3}s`);
      _cfg.schedulePlay(adjustedLocal);
      _startPhaseHeartbeat();
      return;
    }
    if (msg.type === "PLAYHEAD") {
      const ph = msg;
      _peerPlayheads.set(from, { serverNow: ph.serverNow, posMs: ph.posMs, receivedAt: Date.now() });
      return;
    }
  }
  function _startPhaseHeartbeat() {
    if (_phaseTimer) return;
    _phaseStartedAt = Date.now();
    _peerPlayheads = /* @__PURE__ */ new Map();
    _calibrationEwma = 0;
    _calibrationSamples = 0;
    _phaseCooldownUntil = 0;
    _phaseTimer = setInterval(_phaseTick, PHASE_HEARTBEAT_MS);
    logger.info("[Sync] phase heartbeat started");
  }
  function _stopPhaseHeartbeat() {
    if (_phaseTimer) {
      clearInterval(_phaseTimer);
      _phaseTimer = null;
    }
    if (_calibrationSamples >= 3) {
      const newLatency = _selfLatencyCached + _calibrationEwma;
      _saveStoredLatency(newLatency);
      logger.info(`[Sync] saved latency calibration: ${Math.round(newLatency)}ms (was ${_selfLatencyCached}ms, ewma=${Math.round(_calibrationEwma)}ms over ${_calibrationSamples} samples)`);
    }
  }
  function _phaseTick() {
    if (_stopped || !isPlaying()) return;
    const myPos = getCurrentPosMs();
    if (myPos == null) return;
    const localNow = Date.now();
    const serverNow = localToServer(localNow);
    const duration = getDuration();
    if (duration <= 0) return;
    for (const peer of _peers) {
      _send(peer, { type: "PLAYHEAD", serverNow, posMs: myPos });
    }
    if (localNow < _phaseCooldownUntil) {
      return;
    }
    if (_role === "leader" && _peers.length >= 1) {
      return;
    }
    if (_role === "follower" && _peers.length === 1) {
      const leaderId = _peers[0];
      const ph = _peerPlayheads.get(leaderId);
      if (!ph) {
        logger.info("[Sync] phase wait: no leader playhead yet");
        return;
      }
      if (localNow - ph.receivedAt > PHASE_PEER_FRESH_MS) {
        logger.info(`[Sync] phase skip: leader playhead stale (${localNow - ph.receivedAt}ms)`);
        return;
      }
      const leaderProjected = ((ph.posMs + (serverNow - ph.serverNow)) % duration + duration) % duration;
      let myDrift2;
      {
        let d = myPos - leaderProjected;
        if (d > duration / 2) d -= duration;
        if (d < -duration / 2) d += duration;
        myDrift2 = d;
      }
      if (Math.abs(myDrift2) > PHASE_DRIFT_SKIP_MS) {
        logger.info(`[Sync] phase skip follower myDrift=${Math.round(myDrift2)}ms (> ${PHASE_DRIFT_SKIP_MS}ms, loop-boundary)`);
        return;
      }
      if (Date.now() - _phaseStartedAt < PHASE_CAL_GRACE_MS) {
        logger.info(`[Sync] phase warm-up follower myDrift=${Math.round(myDrift2)}ms (no nudge yet)`);
        return;
      }
      _calibrationEwma = _calibrationSamples === 0 ? myDrift2 : PHASE_CAL_EWMA_ALPHA * myDrift2 + (1 - PHASE_CAL_EWMA_ALPHA) * _calibrationEwma;
      _calibrationSamples++;
      if (Math.abs(myDrift2) < PHASE_NUDGE_THRESHOLD) {
        logger.info(`[Sync] phase OK follower myDrift=${Math.round(myDrift2)}ms ewma=${Math.round(_calibrationEwma)}ms (within \xB1${PHASE_NUDGE_THRESHOLD}ms)`);
        return;
      }
      let nudge2 = myDrift2 * PHASE_NUDGE_DAMPING;
      if (nudge2 > PHASE_NUDGE_CAP_MS) nudge2 = PHASE_NUDGE_CAP_MS;
      if (nudge2 < -PHASE_NUDGE_CAP_MS) nudge2 = -PHASE_NUDGE_CAP_MS;
      logger.info(`[Sync] phase NUDGE follower myDrift=${Math.round(myDrift2)}ms ewma=${Math.round(_calibrationEwma)}ms \u2192 nudge=${Math.round(nudge2)}ms`);
      nudgePhase(Math.round(nudge2));
      _phaseCooldownUntil = Date.now() + PHASE_NUDGE_COOLDOWN_MS;
      return;
    }
    const samples = [{ id: _cfg.deviceId, pos: myPos }];
    for (const [peerId, ph] of _peerPlayheads) {
      if (localNow - ph.receivedAt > PHASE_PEER_FRESH_MS) continue;
      const projected = ((ph.posMs + (serverNow - ph.serverNow)) % duration + duration) % duration;
      samples.push({ id: peerId, pos: projected });
    }
    if (samples.length < 2) return;
    const arc = (a, ref) => {
      let d = a - ref;
      if (d > duration / 2) d -= duration;
      if (d < -duration / 2) d += duration;
      return d;
    };
    const deltasFromSelf = samples.map((s) => arc(s.pos, myPos)).sort((a, b) => a - b);
    let consensusDelta;
    if (deltasFromSelf.length === 2) {
      consensusDelta = (deltasFromSelf[0] + deltasFromSelf[1]) / 2;
    } else {
      consensusDelta = deltasFromSelf[Math.floor(deltasFromSelf.length / 2)];
    }
    const myDrift = -consensusDelta;
    if (Date.now() - _phaseStartedAt < PHASE_CAL_GRACE_MS) {
      logger.info(`[Sync] phase warm-up samples=${samples.length} myDrift=${Math.round(myDrift)}ms (no nudge yet)`);
      return;
    }
    _calibrationEwma = _calibrationSamples === 0 ? myDrift : PHASE_CAL_EWMA_ALPHA * myDrift + (1 - PHASE_CAL_EWMA_ALPHA) * _calibrationEwma;
    _calibrationSamples++;
    if (Math.abs(myDrift) < PHASE_NUDGE_THRESHOLD) {
      logger.info(`[Sync] phase OK samples=${samples.length} myDrift=${Math.round(myDrift)}ms ewma=${Math.round(_calibrationEwma)}ms (within \xB1${PHASE_NUDGE_THRESHOLD}ms)`);
      return;
    }
    let nudge = myDrift * PHASE_NUDGE_DAMPING;
    if (nudge > PHASE_NUDGE_CAP_MS) nudge = PHASE_NUDGE_CAP_MS;
    if (nudge < -PHASE_NUDGE_CAP_MS) nudge = -PHASE_NUDGE_CAP_MS;
    logger.info(`[Sync] phase NUDGE samples=${samples.length} myDrift=${Math.round(myDrift)}ms ewma=${Math.round(_calibrationEwma)}ms \u2192 nudge=${Math.round(nudge)}ms`);
    nudgePhase(Math.round(nudge));
    _phaseCooldownUntil = Date.now() + PHASE_NUDGE_COOLDOWN_MS;
  }
  function _startPoll() {
    (function poll() {
      return __async(this, null, function* () {
        var _a, _b;
        while (!_stopped) {
          try {
            const res = yield _fetchTimeout(
              `${_cfg.piBase}/api/v1/test-sync/signals/${_cfg.deviceId}?since=${_pollSince}`
            );
            if (res.ok) {
              const data = yield res.json();
              for (const entry of (_a = data.entries) != null ? _a : []) {
                _pollSince = entry.idx + 1;
                if (entry.body) _dispatch(entry.body, String((_b = entry.from) != null ? _b : ""));
              }
            }
          } catch (e) {
          }
          yield _sleep(POLL_SLEEP_MS);
        }
      });
    })();
  }
  function _send(targetId, body, attempt = 0) {
    return __async(this, null, function* () {
      if (_stopped) return;
      try {
        const res = yield _fetchTimeout(`${_cfg.piBase}/api/v1/test-sync/signal/${targetId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ from: _cfg.deviceId, seq: attempt, body })
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        logger.info(`[Sync] -> ${body.type} to ${targetId} (attempt ${attempt})`);
      } catch (e) {
        logger.warn(`[Sync] send ${body.type} to ${targetId} failed (attempt ${attempt}): ${e == null ? void 0 : e.message}`);
        if (attempt < SEND_RETRIES && !_stopped) {
          setTimeout(() => _send(targetId, body, attempt + 1), SEND_RETRY_MS);
        }
      }
    });
  }
  function _waitForPeers() {
    return __async(this, null, function* () {
      while (!_stopped) {
        try {
          const res = yield _fetchTimeout(
            `${_cfg.piBase}/api/v1/test-sync/peers?groupId=${_cfg.groupId}`
          );
          if (res.ok) {
            const { peers = [] } = yield res.json();
            const fresh = peers.filter((p) => Date.now() - p.registeredAt < 3e4);
            if (fresh.length >= _cfg.expectedPeers) {
              const sorted = [...fresh].sort((a, b) => a.deviceId < b.deviceId ? -1 : 1);
              _role = sorted[sorted.length - 1].deviceId === _cfg.deviceId ? "leader" : "follower";
              _peers = fresh.filter((p) => p.deviceId !== _cfg.deviceId).map((p) => p.deviceId);
              logger.info(`[Sync] role=${_role} peers=[${_peers.join(",")}]`);
              return;
            }
            logger.info(`[Sync] waiting ${fresh.length}/${_cfg.expectedPeers} fresh peers`);
          }
        } catch (e) {
          logger.warn(`[Sync] peer poll: ${e == null ? void 0 : e.message}`);
        }
        yield _sleep(1e3);
      }
    });
  }
  function _register() {
    return __async(this, null, function* () {
      if (_stopped) return;
      try {
        yield _fetchTimeout(`${_cfg.piBase}/api/v1/test-sync/register`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            deviceId: _cfg.deviceId,
            role: _role,
            ip: _cfg.selfIp,
            groupId: _cfg.groupId
          })
        });
      } catch (e) {
      }
    });
  }
  function _fetchVideoUrl() {
    return __async(this, null, function* () {
      var _a, _b, _c, _d, _e, _f, _g;
      try {
        const res = yield _fetchTimeout(`${_cfg.piBase}/api/v1/content?type=video&limit=1`, {}, 5e3);
        if (res.ok) {
          const data = yield res.json();
          const items = (_c = (_b = (_a = data.items) != null ? _a : data.content) != null ? _b : data.data) != null ? _c : [];
          const url = (_g = (_f = (_d = items[0]) == null ? void 0 : _d.url) != null ? _f : (_e = items[0]) == null ? void 0 : _e.fileUrl) != null ? _g : "";
          if (url) {
            logger.info(`[Sync] video URL from API: ${url}`);
            return url;
          }
        }
      } catch (e) {
        logger.warn(`[Sync] fetchVideoUrl failed: ${e == null ? void 0 : e.message}`);
      }
      const fallback = "media/signage.mp4";
      logger.warn(`[Sync] using bundled fallback: ${fallback}`);
      return fallback;
    });
  }
  function _sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }
  function _fetchTimeout(_0, _1) {
    return __async(this, arguments, function* (url, opts, timeoutMs = FETCH_TIMEOUT) {
      const timeout = new Promise(
        (_, rej) => setTimeout(() => rej(new Error(`fetch timeout (${timeoutMs}ms): ${url}`)), timeoutMs)
      );
      return Promise.race([fetch(url, opts), timeout]);
    });
  }
  var GO_AHEAD_MS, FETCH_TIMEOUT, POLL_SLEEP_MS, REGISTER_EVERY, SEND_RETRIES, SEND_RETRY_MS, DEVICE_LATENCY_FALLBACK_MS, CAL_LS_KEY_PREFIX, _selfLatencyCached, PHASE_HEARTBEAT_MS, PHASE_PEER_FRESH_MS, PHASE_NUDGE_THRESHOLD, PHASE_NUDGE_DAMPING, PHASE_NUDGE_CAP_MS, PHASE_DRIFT_SKIP_MS, PHASE_CAL_GRACE_MS, PHASE_CAL_EWMA_ALPHA, _peerPlayheads, _phaseTimer, _phaseStartedAt, _calibrationEwma, _calibrationSamples, PHASE_NUDGE_COOLDOWN_MS, _phaseCooldownUntil, _cfg, _role, _peers, _stopped, _pollSince, _leaderEngineReady, _followerReadySet, _goSent, _loadReceived, LEADER_PEER_SCAN_MS, LEADER_PEER_FRESH_MS, _leaderPeerWatchTimer, _resyncInProgress;
  var init_sync = __esm({
    "src/sync.ts"() {
      init_logger();
      init_engine();
      init_clock();
      GO_AHEAD_MS = 6e3;
      FETCH_TIMEOUT = 2e3;
      POLL_SLEEP_MS = 500;
      REGISTER_EVERY = 5e3;
      SEND_RETRIES = 6;
      SEND_RETRY_MS = 2e3;
      DEVICE_LATENCY_FALLBACK_MS = {
        "tizen7.0-mac-28af427a99db": 0,
        "tizen4.0-mac-d49dc0aa111b": 30
      };
      CAL_LS_KEY_PREFIX = "nexari.cal.";
      _selfLatencyCached = 0;
      PHASE_HEARTBEAT_MS = 1500;
      PHASE_PEER_FRESH_MS = 4e3;
      PHASE_NUDGE_THRESHOLD = 8;
      PHASE_NUDGE_DAMPING = 0.6;
      PHASE_NUDGE_CAP_MS = 150;
      PHASE_DRIFT_SKIP_MS = 14e3;
      PHASE_CAL_GRACE_MS = 6e3;
      PHASE_CAL_EWMA_ALPHA = 0.2;
      _peerPlayheads = /* @__PURE__ */ new Map();
      _phaseTimer = null;
      _phaseStartedAt = 0;
      _calibrationEwma = 0;
      _calibrationSamples = 0;
      PHASE_NUDGE_COOLDOWN_MS = 2500;
      _phaseCooldownUntil = 0;
      _role = "pending";
      _peers = [];
      _stopped = false;
      _pollSince = 0;
      _leaderEngineReady = false;
      _followerReadySet = /* @__PURE__ */ new Set();
      _goSent = false;
      _loadReceived = false;
      LEADER_PEER_SCAN_MS = 4e3;
      LEADER_PEER_FRESH_MS = 3e4;
      _leaderPeerWatchTimer = null;
      _resyncInProgress = false;
    }
  });

  // src/app.ts
  var require_app = __commonJS({
    "src/app.ts"(exports) {
      init_engine();
      init_logger();
      init_sync();
      var RELAY_IP = "192.168.1.11";
      var RELAY_PORT = 9616;
      var CONFIG = {
        PI_BASE: `http://${RELAY_IP}:${RELAY_PORT}`,
        // Logger still posts to the Pi while we stabilise.
        LOG_BASE: "http://192.168.1.17",
        GROUP_ID: "syncengine-001",
        // Solo-leader friendly: leader proceeds as soon as it self-registers;
        // followers that arrive later trigger a live resync.
        EXPECTED_PEERS: 1
      };
      var _container;
      var _syncStarted = false;
      window.addEventListener("load", () => __async(null, null, function* () {
        _container = document.getElementById("player-container");
        const statusEl = document.getElementById("status");
        const deviceInfo = document.getElementById("device-info");
        const modeEl = document.getElementById("engine-mode");
        const setStatus = (msg) => {
          statusEl.textContent = msg;
        };
        modeEl.textContent = "HTML5 <video>";
        setStatus("Detecting device\u2026");
        const selfIp = yield _getSelfIp();
        const deviceId = yield _makeDeviceId(selfIp);
        initLogger(CONFIG.LOG_BASE, deviceId);
        deviceInfo.textContent = `${deviceId}  |  ${selfIp}  |  group: ${CONFIG.GROUP_ID}`;
        logger.info(`[App] boot ip=${selfIp} deviceId=${deviceId}`);
        document.addEventListener("keydown", (e) => {
          var _a, _b;
          if (e.keyCode === 10009 || e.keyCode === 27) {
            logger.info("[App] exit requested");
            stop();
            try {
              (_b = (_a = window.tizen) == null ? void 0 : _a.application) == null ? void 0 : _b.getCurrentApplication().exit();
            } catch (e2) {
            }
          }
        });
        initEngine(_container);
        _startNodeRelay(setStatus);
        if (!_syncStarted) {
          _syncStarted = true;
          const overlay = document.getElementById("overlay");
          const logPanel = document.getElementById("log-panel");
          yield new Promise((r) => setTimeout(r, 2500));
          init({
            piBase: CONFIG.PI_BASE,
            groupId: CONFIG.GROUP_ID,
            deviceId,
            selfIp,
            expectedPeers: CONFIG.EXPECTED_PEERS,
            onStatus: (msg) => {
              setStatus(msg);
              logger.info(`[Sync] status: ${msg}`);
            },
            prepareEngine: (url) => prepare(url),
            // Wipe + reinitialise the engine. sync.ts calls this when a new
            // follower joins mid-play so leader + followers restart cleanly.
            restartEngine: () => {
              logger.info("[App] engine restart requested");
              try {
                destroyEngine();
              } catch (e) {
              }
              const old = _container.querySelector("video");
              if (old == null ? void 0 : old.parentNode) old.parentNode.removeChild(old);
              initEngine(_container);
            },
            schedulePlay: (epochMs) => {
              if (overlay) overlay.style.display = "none";
              if (logPanel) logPanel.style.display = "none";
              schedulePlayAt(epochMs);
            },
            getEngineDuration: () => getDuration()
          });
        }
      }));
      function _pickSignedStub() {
        var _a, _b;
        let v = "6.5";
        try {
          v = ((_b = (_a = window.tizen) == null ? void 0 : _a.systeminfo) == null ? void 0 : _b.getCapability(
            "http://tizen.org/feature/platform.version"
          )) || v;
        } catch (e) {
        }
        if (v === "2.4" || v === "2.4.0") return "../lib/server2016.js.signed";
        if (v === "3.0" || v === "3.0.0") return "../lib/server2017.js.signed";
        if (v === "4.0" || v === "4.0.0") return "../lib/server2018.js.signed";
        if (v === "5.0" || v === "5.0.0") return "../lib/server2019.js.signed";
        return "../lib/server2022.js.signed";
      }
      function _startNodeRelay(setStatus) {
        var _a;
        const b2b = (_a = window.b2bapis) == null ? void 0 : _a.b2bcontrol;
        if (!b2b || typeof b2b.startNodeServer !== "function") {
          logger.warn("[NodeRelay] b2bcontrol.startNodeServer unavailable on this firmware");
          return;
        }
        const stub = _pickSignedStub();
        logger.info(`[NodeRelay] starting ${stub} \u2192 :${RELAY_PORT}`);
        setStatus(`Starting Node relay (${stub.split("/").pop()})\u2026`);
        try {
          b2b.startNodeServer(
            stub,
            "nexari-sync-relay",
            () => {
              logger.info(`[NodeRelay] running on :${RELAY_PORT}`);
            },
            (e) => {
              var _a2;
              logger.warn(`[NodeRelay] start failed: ${(_a2 = e == null ? void 0 : e.message) != null ? _a2 : e}`);
            }
          );
        } catch (e) {
          logger.warn(`[NodeRelay] startNodeServer threw: ${e == null ? void 0 : e.message}`);
        }
      }
      function _getSelfIp() {
        return __async(this, null, function* () {
          var _a;
          for (const propName of ["NETWORK", "WIFI_NETWORK", "ETHERNET_NETWORK"]) {
            try {
              const si = (_a = window.tizen) == null ? void 0 : _a.systeminfo;
              if (!(si == null ? void 0 : si.getPropertyValue)) break;
              const ip = yield new Promise((resolve) => {
                si.getPropertyValue(
                  propName,
                  (nw) => {
                    var _a2, _b;
                    const addr = ((_b = (_a2 = nw == null ? void 0 : nw.ipAddress) != null ? _a2 : nw == null ? void 0 : nw.ip) != null ? _b : "").trim();
                    resolve(addr && addr !== "0.0.0.0" ? addr : "");
                  },
                  () => resolve("")
                );
              });
              if (ip) return ip;
            } catch (e) {
            }
          }
          const h = window.location.hostname;
          return h && h !== "localhost" ? h : "127.0.0.1";
        });
      }
      function _normMac(v) {
        const t = String(v != null ? v : "").trim().toLowerCase();
        return /^[0-9a-f]{2}([:-]?[0-9a-f]{2}){5}$/.test(t) ? t.replace(/[^0-9a-f]/g, "") : "";
      }
      function _getNetworkMac() {
        return __async(this, null, function* () {
          var _a, _b, _c, _d, _e;
          try {
            const net = (_a = window.webapis) == null ? void 0 : _a.network;
            const m = _normMac((_b = net == null ? void 0 : net.getMac) == null ? void 0 : _b.call(net));
            if (m) return m;
            const info = (_c = net == null ? void 0 : net.getActiveConnectionInfo) == null ? void 0 : _c.call(net);
            const m2 = _normMac((_d = info == null ? void 0 : info.macAddress) != null ? _d : info == null ? void 0 : info.mac);
            if (m2) return m2;
          } catch (e) {
          }
          for (const prop of ["WIFI_NETWORK", "ETHERNET_NETWORK", "NETWORK"]) {
            try {
              const si = (_e = window.tizen) == null ? void 0 : _e.systeminfo;
              if (!(si == null ? void 0 : si.getPropertyValue)) break;
              const m = yield new Promise((r) => {
                si.getPropertyValue(
                  prop,
                  (info) => {
                    var _a2, _b2;
                    return r(_normMac((_b2 = (_a2 = info == null ? void 0 : info.macAddress) != null ? _a2 : info == null ? void 0 : info.networkMacAddress) != null ? _b2 : ""));
                  },
                  () => r("")
                );
              });
              if (m) return m;
            } catch (e) {
            }
          }
          return "";
        });
      }
      function _tizenTag() {
        var _a, _b, _c, _d;
        try {
          const v = String((_d = (_c = (_b = (_a = window.tizen) == null ? void 0 : _a.systeminfo) == null ? void 0 : _b.getCapability) == null ? void 0 : _c.call(_b, "http://tizen.org/feature/platform.version")) != null ? _d : "");
          return v ? `tizen${v.split(".").slice(0, 2).join(".")}-` : "";
        } catch (e) {
          return "";
        }
      }
      function _makeDeviceId(selfIp) {
        return __async(this, null, function* () {
          var _a, _b, _c, _d, _e, _f;
          const tag = _tizenTag();
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
          const mac = yield _getNetworkMac();
          if (mac) return tag + "mac-" + mac;
          if (selfIp && selfIp !== "127.0.0.1" && selfIp !== "0.0.0.0") {
            return tag + selfIp.replace(/\./g, "-");
          }
          const key = "_nexari_device_id";
          let id = localStorage.getItem(key);
          if (!id) {
            id = "dev-" + Math.random().toString(36).slice(2, 10);
            localStorage.setItem(key, id);
          }
          return id.startsWith(tag) ? id : tag + id;
        });
      }
    }
  });
  require_app();
})();
