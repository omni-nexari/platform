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
  function _getState(p) {
    if (!p) return "NONE";
    try {
      return p.getState();
    } catch (e) {
      return "NONE";
    }
  }
  function _avState() {
    try {
      return webapis.avplay.getState();
    } catch (e) {
      return "NONE";
    }
  }
  function _setupDisplay(p) {
    if (p) {
      try {
        p.setDisplayRect(0, 0, 1920, 1080);
      } catch (e) {
      }
      if (_role === "leader") {
        try {
          p.setDisplayRotation("PLAYER_DISPLAY_ROTATION_90");
        } catch (e) {
        }
        try {
          p.setDisplayMethod("PLAYER_DISPLAY_MODE_LETTER_BOX");
        } catch (e) {
        }
      } else {
        try {
          p.setDisplayMethod("PLAYER_DISPLAY_MODE_LETTER_BOX");
        } catch (e) {
        }
      }
    } else {
      try {
        webapis.avplay.setDisplayRect(0, 0, 1920, 1080);
      } catch (e) {
      }
      if (_role === "leader") {
        try {
          webapis.avplay.setDisplayRotation("PLAYER_DISPLAY_ROTATION_90");
        } catch (e) {
        }
        try {
          webapis.avplay.setDisplayMethod("PLAYER_DISPLAY_MODE_LETTER_BOX");
        } catch (e) {
        }
      } else {
        try {
          webapis.avplay.setDisplayMethod("PLAYER_DISPLAY_MODE_LETTER_BOX");
        } catch (e) {
        }
      }
    }
  }
  function _setStillMode(on) {
    if (!_playerA) return;
    try {
      _playerA.setVideoStillMode(on ? "true" : "false");
    } catch (e) {
    }
  }
  function _makeListenerA() {
    let eosGuard = false;
    return {
      onbufferingstart() {
        logger.info("[AVPlay] A buffering start");
      },
      onbufferingprogress(pct) {
        if (pct % 25 === 0) logger.info(`[AVPlay] A buffering ${pct}%`);
      },
      onbufferingcomplete() {
        logger.info("[AVPlay] A buffering complete");
      },
      oncurrentplaytime(_posMs) {
      },
      onstreamcompleted() {
        if (eosGuard) return;
        let cur = 0;
        try {
          cur = _playerA ? _playerA.getCurrentTime() : 0;
        } catch (e) {
        }
        if (_destroyed || _durationMs <= 0 || cur < _durationMs - 600) {
          logger.info(`[AVPlay] A spurious EOS pos=${cur}ms dur=${_durationMs}ms -- ignored`);
          return;
        }
        eosGuard = true;
        _playing = false;
        logger.info(`[AVPlay] A EOS at ${cur}ms -- starting prebuffer`);
        _prebufferForBarrier();
      },
      onerror(err) {
        logger.error(`[AVPlay] A error: ${JSON.stringify(err)}`);
      },
      onevent(type, _data) {
        logger.info(`[AVPlay] A event type=${type}`);
      }
    };
  }
  function _makeListenerSingle() {
    return {
      onbufferingstart() {
        logger.info("[AVPlay] buffering start");
      },
      onbufferingprogress(pct) {
        if (pct % 25 === 0) logger.info(`[AVPlay] buffering ${pct}%`);
      },
      onbufferingcomplete() {
        logger.info("[AVPlay] buffering complete");
      },
      oncurrentplaytime(_posMs) {
      },
      onstreamcompleted() {
        let cur = 0;
        try {
          cur = webapis.avplay.getCurrentTime();
        } catch (e) {
        }
        if (_destroyed || _durationMs <= 0 || cur < _durationMs - 600) {
          logger.info(`[AVPlay] spurious EOS pos=${cur}ms dur=${_durationMs}ms -- ignored`);
          return;
        }
        _playing = false;
        logger.info(`[AVPlay] EOS at ${cur}ms -- starting prebuffer`);
        _prebufferForBarrier();
      },
      onerror(err) {
        logger.error(`[AVPlay] error: ${JSON.stringify(err)}`);
      },
      onevent(type, _data) {
        logger.info(`[AVPlay] event type=${type}`);
      }
    };
  }
  function _startDriftLog() {
    if (_driftTimer) return;
    let frozenCount = 0;
    _driftTimer = setInterval(() => {
      if (_destroyed || !_playing) return;
      try {
        let pos;
        let st;
        if (_useAvplaystore && _playerA) {
          pos = _playerA.getCurrentTime();
          st = _getState(_playerA);
        } else {
          pos = webapis.avplay.getCurrentTime();
          st = _avState();
        }
        logger.info(`[AVPlay] pos=${pos}ms duration=${_durationMs}ms state=${st}`);
        if (_durationMs > 0 && pos >= _durationMs - 200) {
          frozenCount++;
          if (frozenCount >= 2) {
            frozenCount = 0;
            logger.warn(`[AVPlay] watchdog: frozen at end pos=${pos}ms -- forcing prebuffer`);
            _prebufferForBarrier();
          }
        } else {
          frozenCount = 0;
        }
      } catch (e) {
      }
    }, DRIFT_LOG_MS);
  }
  function _stopDriftLog() {
    if (_driftTimer) {
      clearInterval(_driftTimer);
      _driftTimer = null;
    }
  }
  function setRole(role) {
    _role = role;
  }
  function setOnLoop(cb) {
    _onLoop = cb;
  }
  function setPlaylist(urls) {
    if (urls.length === 0) return;
    _playlist = urls;
    _playlistIdx = 0;
    _url = urls[0];
    logger.info(`[AVPlay] playlist (${urls.length}): ${urls.map((u) => u.split("/").pop()).join(", ")}`);
  }
  function initEngine(_container) {
    _destroyed = false;
    _playing = false;
    _durationMs = 0;
    _url = "";
    _looping = false;
    _prebuffered = false;
    clearTimeout(_playTimer);
    _stopDriftLog();
    try {
      if (typeof webapis !== "undefined" && webapis.avplaystore) {
        if (_playerA) {
          try {
            const s = _getState(_playerA);
            if (s === "PLAYING" || s === "PAUSED") _playerA.stop();
            if (s !== "NONE") _playerA.close();
          } catch (e) {
          }
        } else {
          _playerA = webapis.avplaystore.getPlayer();
        }
        _useAvplaystore = true;
        logger.info("[AVPlay] avplaystore single-player mode");
      } else {
        throw new Error("avplaystore unavailable");
      }
    } catch (e) {
      _playerA = null;
      _useAvplaystore = false;
      logger.info("[AVPlay] webapis.avplay fallback mode");
      try {
        const s = _avState();
        if (s === "PLAYING" || s === "PAUSED") webapis.avplay.stop();
        if (s !== "NONE") webapis.avplay.close();
      } catch (e2) {
      }
    }
  }
  function prepare(url) {
    _url = url;
    _durationMs = 0;
    _playing = false;
    _prebuffered = false;
    _looping = false;
    clearTimeout(_playTimer);
    _stopDriftLog();
    if (_playlist.length === 0) {
      _playlist = [url];
      _playlistIdx = 0;
    }
    logger.info(`[AVPlay] prepare: ${url.split("/").pop()} avplaystore=${_useAvplaystore}`);
    return new Promise((resolve, reject) => {
      if (_useAvplaystore && _playerA) {
        _openAndPrepare(_playerA, url, _makeListenerA(), resolve, reject);
      } else {
        _prepareSingle(url, resolve, reject);
      }
    });
  }
  function _openAndPrepare(p, url, listener, resolve, reject) {
    try {
      const s = _getState(p);
      if (s === "PLAYING" || s === "PAUSED") p.stop();
      if (s !== "NONE") p.close();
      p.open(url);
    } catch (e) {
      return reject(new Error(`avplaystore open failed: ${e == null ? void 0 : e.message}`));
    }
    _setupDisplay(p);
    p.setListener(listener);
    p.prepareAsync(
      () => {
        if (_destroyed) return resolve();
        _setupDisplay(p);
        _durationMs = p.getDuration();
        logger.info(`[AVPlay] A prepared -- duration=${_durationMs}ms`);
        resolve();
      },
      (err) => {
        var _a;
        logger.error(`[AVPlay] A prepareAsync failed: ${JSON.stringify(err)}`);
        reject(new Error(String((_a = err == null ? void 0 : err.name) != null ? _a : err)));
      }
    );
  }
  function _prepareSingle(url, resolve, reject) {
    try {
      const s = _avState();
      if (s === "PLAYING" || s === "PAUSED") webapis.avplay.stop();
      if (s !== "NONE") webapis.avplay.close();
      webapis.avplay.open(url);
    } catch (e) {
      return reject(new Error(`AVPlay open failed: ${e == null ? void 0 : e.message}`));
    }
    _setupDisplay();
    webapis.avplay.setListener(_makeListenerSingle());
    webapis.avplay.prepareAsync(
      () => {
        if (_destroyed) return resolve();
        _setupDisplay();
        _durationMs = webapis.avplay.getDuration();
        logger.info(`[AVPlay] prepared -- duration=${_durationMs}ms`);
        resolve();
      },
      (err) => {
        var _a;
        logger.error(`[AVPlay] prepareAsync failed: ${JSON.stringify(err)}`);
        reject(new Error(String((_a = err == null ? void 0 : err.name) != null ? _a : err)));
      }
    );
  }
  function _prebufferForBarrier() {
    if (_destroyed || _looping) return;
    _looping = true;
    _prebuffered = false;
    _stopDriftLog();
    if (_playlist.length > 1) {
      _playlistIdx = (_playlistIdx + 1) % _playlist.length;
      _url = _playlist[_playlistIdx];
      logger.info(`[AVPlay] playlist -> [${_playlistIdx + 1}/${_playlist.length}] ${_url.split("/").pop()}`);
    }
    if (_useAvplaystore && _playerA) {
      _prebufferAvplaystore(_url);
    } else {
      _prebufferGlobalAvplay(_url);
    }
  }
  function _prebufferAvplaystore(nextUrl) {
    _setStillMode(true);
    try {
      _playerA.stop();
    } catch (e) {
    }
    logger.info("[AVPlay] avplaystore prebuffer: still-freeze -> stop -> open -> prepareAsync");
    try {
      _playerA.open(nextUrl);
    } catch (e) {
      _looping = false;
      logger.error(`[AVPlay] A.open() failed: ${e == null ? void 0 : e.message}`);
      return;
    }
    _setupDisplay(_playerA);
    _playerA.setListener(_makeListenerA());
    _playerA.prepareAsync(
      () => {
        if (_destroyed) {
          _looping = false;
          return;
        }
        _setupDisplay(_playerA);
        _durationMs = _playerA.getDuration();
        try {
          _playerA.play();
        } catch (e) {
        }
        setTimeout(() => {
          if (_destroyed) {
            _looping = false;
            return;
          }
          try {
            _playerA.pause();
          } catch (e) {
          }
          _looping = false;
          _prebuffered = true;
          logger.info("[AVPlay] avplaystore: prebuffered at frame 0 -- LOOP_READY");
          if (_onLoop) _onLoop();
        }, 100);
      },
      (err) => {
        _looping = false;
        logger.error(`[AVPlay] A prepareAsync failed in prebuffer: ${JSON.stringify(err)}`);
      }
    );
  }
  function _prebufferGlobalAvplay(nextUrl) {
    logger.info("[AVPlay] global avplay prebuffer: stop -> close -> open -> prepareAsync");
    try {
      webapis.avplay.stop();
    } catch (e) {
    }
    try {
      webapis.avplay.close();
    } catch (e) {
    }
    setTimeout(() => {
      if (_destroyed) {
        _looping = false;
        return;
      }
      try {
        webapis.avplay.open(nextUrl);
        _setupDisplay();
        webapis.avplay.setListener(_makeListenerSingle());
        webapis.avplay.prepareAsync(
          () => {
            if (_destroyed) {
              _looping = false;
              return;
            }
            _setupDisplay();
            _durationMs = webapis.avplay.getDuration();
            try {
              webapis.avplay.play();
            } catch (e) {
            }
            setTimeout(() => {
              if (_destroyed) {
                _looping = false;
                return;
              }
              try {
                webapis.avplay.pause();
              } catch (e) {
              }
              _looping = false;
              _prebuffered = true;
              logger.info("[AVPlay] global: prebuffered at frame 0 -- LOOP_READY");
              if (_onLoop) _onLoop();
            }, 100);
          },
          (err) => {
            _looping = false;
            logger.error(`[AVPlay] global prebuffer failed: ${JSON.stringify(err)}`);
          }
        );
      } catch (e) {
        _looping = false;
        logger.error(`[AVPlay] global prebuffer open failed: ${e == null ? void 0 : e.message}`);
      }
    }, 50);
  }
  function schedulePlayAt(epochMs) {
    if (_destroyed) return;
    clearTimeout(_playTimer);
    const wait = epochMs - Date.now();
    logger.info(`[AVPlay] schedulePlayAt epoch=${epochMs} T-${Math.round(Math.max(0, wait))}ms`);
    if (wait <= 0) {
      _doPlay();
      return;
    }
    _playTimer = setTimeout(() => {
      (function spin() {
        if (_destroyed) return;
        if (Date.now() >= epochMs) {
          _doPlay();
          return;
        }
        setTimeout(spin, 4);
      })();
    }, Math.max(0, wait - 60));
  }
  function _doPlay() {
    _playTimer = null;
    if (_destroyed || _playing) return;
    _prebuffered = false;
    _playing = true;
    if (_useAvplaystore && _playerA) {
      _setStillMode(false);
      try {
        _playerA.play();
        logger.info("[AVPlay] avplaystore play() -- synchronized start");
      } catch (e) {
        logger.error(`[AVPlay] avplaystore play() failed: ${e == null ? void 0 : e.message}`);
      }
    } else {
      try {
        webapis.avplay.play();
        logger.info("[AVPlay] global avplay play() -- synchronized start");
      } catch (e) {
        logger.error(`[AVPlay] play() failed: ${e == null ? void 0 : e.message}`);
      }
    }
    _startDriftLog();
  }
  function getDuration() {
    return _durationMs;
  }
  function isPlaying() {
    if (_useAvplaystore && _playerA) return _playing && _getState(_playerA) === "PLAYING";
    return _playing && _avState() === "PLAYING";
  }
  function getCurrentPosMs() {
    if (!_playing) return null;
    try {
      if (_useAvplaystore && _playerA) return _playerA.getCurrentTime();
      return webapis.avplay.getCurrentTime();
    } catch (e) {
      return null;
    }
  }
  function destroyEngine() {
    _destroyed = true;
    _playing = false;
    _prebuffered = false;
    _looping = false;
    clearTimeout(_playTimer);
    _stopDriftLog();
    if (_playerA) {
      _setStillMode(false);
      try {
        const s = _getState(_playerA);
        if (s === "PLAYING" || s === "PAUSED") _playerA.stop();
        if (s !== "NONE") _playerA.close();
        webapis.avplaystore.releasePlayer(_playerA);
      } catch (e) {
      }
      _playerA = null;
    }
    try {
      const s = _avState();
      if (s === "PLAYING" || s === "PAUSED") webapis.avplay.stop();
      if (s !== "NONE") webapis.avplay.close();
    } catch (e) {
    }
    _useAvplaystore = false;
    logger.info("[AVPlay] engine destroyed");
  }
  var _url, _durationMs, _playing, _destroyed, _prebuffered, _looping, _playTimer, _driftTimer, _role, _onLoop, _playlist, _playlistIdx, _useAvplaystore, _playerA, DRIFT_LOG_MS;
  var init_engine = __esm({
    "src/engine.ts"() {
      init_logger();
      _url = "";
      _durationMs = 0;
      _playing = false;
      _destroyed = false;
      _prebuffered = false;
      _looping = false;
      _playTimer = null;
      _driftTimer = null;
      _role = null;
      _onLoop = null;
      _playlist = [];
      _playlistIdx = 0;
      _useAvplaystore = false;
      _playerA = null;
      DRIFT_LOG_MS = 2e3;
    }
  });

  // src/sync.ts
  function init(cfg) {
    return __async(this, null, function* () {
      var _a;
      _cfg = cfg;
      _stopped = false;
      _role2 = "pending";
      _peers = [];
      _leaderReady = false;
      _followerReady = /* @__PURE__ */ new Set();
      _goSent = false;
      _loadReceived = false;
      _phaseStartedAt = 0;
      _ewma = 0;
      _ewmaN = 0;
      _selfLatency = (_a = DEVICE_LATENCY_MS[cfg.deviceId]) != null ? _a : 0;
      logger.info(`[Sync] init deviceId=${cfg.deviceId} group=${cfg.groupId} selfLatency=${_selfLatency}ms`);
      cfg.onStatus("Connecting to relay\u2026");
      setOnLoop(() => {
        if (!_stopped) {
          logger.info("[Sync] prebuffer ready -- sending LOOP_READY");
          _wsSend({ type: "LOOP_READY", groupId: _cfg.groupId, deviceId: _cfg.deviceId });
        }
      });
      yield _connectWs();
      yield _measureClock();
      setTimeout(() => {
        if (!_stopped) _measureClock().catch(() => {
        });
      }, 3e3);
      setTimeout(() => {
        if (!_stopped) _measureClock().catch(() => {
        });
      }, 1e4);
      setInterval(() => {
        if (!_stopped) _measureClock().catch(() => {
        });
      }, CLOCK_RESYNC_MS);
      setInterval(() => {
        logger.info(`[Sync] heartbeat role=${_role2} peers=[${_peers.join(",")}] stopped=${_stopped}`);
      }, 1e4);
      cfg.onStatus(`Waiting for ${cfg.expectedPeers} peers\u2026`);
      yield _waitPeers();
      logger.info(`[Sync] role=${_role2} peers=[${_peers.join(", ")}]`);
      cfg.onStatus(`Role: ${_role2} \u2014 peer(s): ${_peers.join(", ")}`);
      const resolvedRole = _role2;
      setRole(resolvedRole);
      _playlistUrls = yield _fetchPlaylistUrls();
      setPlaylist(_playlistUrls);
      if (resolvedRole === "leader") {
        yield _runLeader();
        _startPeerWatch();
      } else {
        cfg.onStatus("Follower \u2014 waiting for LOAD_URL from leader\u2026");
      }
    });
  }
  function stop() {
    _stopped = true;
    _stopPhase();
    _stopPeerWatch();
    if (_ws) {
      try {
        _ws.close();
      } catch (e) {
      }
      _ws = null;
    }
    logger.info("[Sync] stopped");
  }
  function _connectWs() {
    return new Promise((resolve) => {
      const attempt = () => {
        if (_stopped) return;
        logger.info(`[Sync] WS connecting \u2192 ${_cfg.wsUrl}`);
        _wsReady = false;
        try {
          const ws = new WebSocket(_cfg.wsUrl);
          _ws = ws;
          ws.onopen = () => {
            _wsReady = true;
            logger.info("[Sync] WS connected");
            _wsSend({ type: "WS_REGISTER", deviceId: _cfg.deviceId, groupId: _cfg.groupId, ip: _cfg.selfIp });
            resolve();
          };
          ws.onmessage = (ev) => {
            try {
              _dispatch(JSON.parse(ev.data));
            } catch (e) {
            }
          };
          ws.onerror = () => {
            logger.warn("[Sync] WS error");
          };
          ws.onclose = () => {
            _wsReady = false;
            logger.warn("[Sync] WS closed \u2014 reconnecting\u2026");
            if (!_stopped) setTimeout(attempt, WS_RECONNECT_MS);
          };
        } catch (e) {
          logger.error(`[Sync] WS open failed: ${e == null ? void 0 : e.message}`);
          if (!_stopped) setTimeout(attempt, WS_RECONNECT_MS);
        }
      };
      attempt();
    });
  }
  function _wsSend(msg) {
    if (!_ws || !_wsReady || _ws.readyState !== 1) return;
    try {
      _ws.send(JSON.stringify(msg));
    } catch (e) {
    }
  }
  function _measureClock() {
    return new Promise((resolve) => {
      const results = [];
      let remaining = CLOCK_SAMPLES;
      const finish = () => {
        if (results.length === 0) {
          resolve();
          return;
        }
        results.sort((a, b) => a.rtt - b.rtt);
        _offsetMs = results[0].offset;
        const summary = results.map((r) => `rtt=${r.rtt}ms off=${r.offset}ms`).join("; ");
        logger.info(`[Clock] WS offset=${_offsetMs}ms bestRtt=${results[0].rtt}ms samples=${results.length} | ${summary}`);
        resolve();
      };
      for (let i = 0; i < CLOCK_SAMPLES; i++) {
        setTimeout(() => {
          if (!_wsReady) {
            if (--remaining === 0) finish();
            return;
          }
          const t1 = Date.now();
          const onMsg = (ev) => {
            const msg = (() => {
              try {
                return JSON.parse(ev.data);
              } catch (e) {
                return null;
              }
            })();
            if (!msg || msg.type !== "PONG" || msg.t1 !== t1) return;
            _ws.removeEventListener("message", onMsg);
            const t3 = Date.now();
            results.push({ offset: Math.round(msg.t2 + (t3 - t1) / 2 - t3), rtt: t3 - t1 });
            if (--remaining === 0) finish();
          };
          if (_ws) _ws.addEventListener("message", onMsg);
          _wsSend({ type: "PING", t1 });
          setTimeout(() => {
            if (_ws) _ws.removeEventListener("message", onMsg);
            if (--remaining === 0) finish();
          }, 1e3);
        }, i * 60);
      }
    });
  }
  function _waitPeers() {
    return new Promise((resolve) => {
      const check = () => {
        if (_stopped) {
          resolve();
          return;
        }
        if (_peers.length >= _cfg.expectedPeers) {
          const all = [..._peers, _cfg.deviceId].sort();
          _role2 = all[all.length - 1] === _cfg.deviceId ? "leader" : "follower";
          resolve();
          return;
        }
        setTimeout(check, 300);
      };
      check();
    });
  }
  function _dispatch(msg) {
    var _a;
    const from = (_a = msg.from) != null ? _a : "relay";
    if (msg.type === "PONG") return;
    if (msg.type === "PEERS" || msg.type === "HEARTBEAT_PEERS") {
      const list = msg.type === "PEERS" ? msg.peers.map((p) => p.deviceId) : msg.peers;
      const others = list.filter((id) => id !== _cfg.deviceId);
      if (JSON.stringify(others) !== JSON.stringify(_peers)) {
        const dropped = _peers.filter((id) => !others.includes(id));
        dropped.forEach((id) => _followerReady.delete(id));
        _peers = others;
        logger.info(`[Sync] peers: [${_peers.join(", ")}]`);
      }
      return;
    }
    logger.info(`[Sync] \u2190 ${msg.type} from=${from}`);
    if (msg.type === "LOAD_URL") {
      if (_role2 !== "follower") return;
      if (_loadReceived) {
        logger.info("[Sync] LOAD_URL dup \u2014 ignored");
        return;
      }
      _loadReceived = true;
      _cfg.onStatus(`Follower \u2014 preparing: ${msg.url.split("/").pop()}`);
      _cfg.prepareEngine(msg.url).then(() => {
        if (_stopped) return;
        logger.info("[Sync] follower READY \u2014 sending READY");
        _cfg.onStatus("Follower \u2014 READY sent, waiting for GO\u2026");
        _wsSend({ type: "READY" });
      }).catch((e) => {
        logger.error(`[Sync] follower prepare failed: ${e == null ? void 0 : e.message} \u2014 retry in 3s`);
        if (!_stopped) setTimeout(() => {
          _loadReceived = false;
        }, 3e3);
      });
      return;
    }
    if (msg.type === "READY") {
      if (_role2 !== "leader") return;
      _followerReady.add(from);
      logger.info(`[Sync] READY from ${from} (${_followerReady.size}/${_peers.length})`);
      _cfg.onStatus(`Leader \u2014 ${_followerReady.size}/${_peers.length} follower(s) ready`);
      _checkAllReady();
      return;
    }
    if (msg.type === "GO") {
      if (_role2 !== "follower") return;
      const localPlay = _serverToLocal(msg.playAt) + _selfLatency;
      const wait = localPlay - Date.now();
      logger.info(`[Sync] GO \u2192 play in T-${Math.round(wait)}ms (serverEpoch=${msg.playAt} offset=${_offsetMs}ms latency=${_selfLatency}ms)`);
      _cfg.onStatus(`GO received \u2014 playing in ${Math.round(wait / 100) * 100 / 1e3}s`);
      _cfg.schedulePlay(localPlay);
      _startPhase();
      return;
    }
    if (msg.type === "PLAYHEAD") {
      _peerHeads.set(from, { serverNow: msg.serverNow, posMs: msg.posMs, at: Date.now() });
      return;
    }
    if (msg.type === "LOOP_GO") {
      const localPlayAt = _serverToLocal(msg.playAt);
      const wait = Math.round(localPlayAt - Date.now());
      logger.info(`[Sync] LOOP_GO playAt=${msg.playAt} localPlayAt=${localPlayAt} T-${wait}ms`);
      _cfg.onStatus(`LOOP_GO -- playing in ${Math.round(wait / 100) * 100 / 1e3}s`);
      _cfg.schedulePlay(localPlayAt);
      _phaseStartedAt = Date.now();
      _ewma = 0;
      _ewmaN = 0;
      return;
    }
  }
  function _runLeader() {
    return __async(this, null, function* () {
      _cfg.onStatus("Leader \u2014 fetching video URL\u2026");
      const url = yield _fetchVideoUrl();
      logger.info(`[Sync] leader video: ${url}`);
      _wsSend({ type: "LOAD_URL", url });
      _cfg.onStatus("Leader \u2014 preparing engine\u2026");
      _cfg.prepareEngine(url).then(() => {
        if (_stopped) return;
        logger.info("[Sync] leader engine READY");
        _leaderReady = true;
        _cfg.onStatus(`Leader ready \u2014 waiting for ${_peers.length} follower(s)\u2026`);
        _checkAllReady();
      }).catch((e) => {
        logger.error(`[Sync] leader prepare failed: ${e == null ? void 0 : e.message} \u2014 retry in 5s`);
        if (!_stopped) setTimeout(() => {
          if (!_stopped) _runLeader();
        }, 5e3);
      });
    });
  }
  function _checkAllReady() {
    if (!_leaderReady || _followerReady.size < _peers.length || _goSent || _stopped) return;
    _goSent = true;
    const localPlay = Date.now() + GO_AHEAD_MS;
    const serverPlay = _localToServer(localPlay);
    const dur = _cfg.getEngineDuration();
    logger.info(`[Sync] ALL READY \u2192 GO epoch=${serverPlay} dur=${dur}ms`);
    _cfg.onStatus(`ALL READY \u2014 play in ${GO_AHEAD_MS / 1e3}s`);
    _wsSend({ type: "GO", playAt: serverPlay, durationMs: dur });
    _cfg.schedulePlay(localPlay + _selfLatency);
    _startPhase();
  }
  function _startPeerWatch() {
    if (_peerWatchTimer || _stopped) return;
    _peerWatchTimer = setInterval(_peerScan, LEADER_SCAN_MS);
  }
  function _stopPeerWatch() {
    if (_peerWatchTimer) {
      clearInterval(_peerWatchTimer);
      _peerWatchTimer = null;
    }
  }
  function _peerScan() {
    if (_stopped || _resyncInProgress || _role2 !== "leader") return;
    const joiners = _peers.filter((id) => !_followerReady.has(id));
    if (joiners.length === 0) return;
    logger.info(`[Sync] new follower(s): [${joiners.join(",")}] \u2014 resyncing`);
    _cfg.onStatus(`New follower (${joiners.join(",")}) \u2014 resyncing\u2026`);
    _resyncLeader().catch(() => {
    });
  }
  function _resyncLeader() {
    return __async(this, null, function* () {
      if (_resyncInProgress || _stopped) return;
      _resyncInProgress = true;
      try {
        _stopPhase();
        _leaderReady = false;
        _followerReady = /* @__PURE__ */ new Set();
        _goSent = false;
        if (_cfg.restartEngine) {
          try {
            _cfg.restartEngine();
          } catch (e) {
          }
        }
        yield _runLeader();
      } finally {
        _resyncInProgress = false;
      }
    });
  }
  function _startPhase() {
    if (_phaseTimer) return;
    _phaseStartedAt = Date.now();
    _peerHeads = /* @__PURE__ */ new Map();
    _ewma = 0;
    _ewmaN = 0;
    _cooldownUntil = 0;
    _phaseTimer = setInterval(_phaseTick, PLAYHEAD_TICK_MS);
    logger.info("[Sync] PLAYHEAD heartbeat started");
  }
  function _stopPhase() {
    if (_phaseTimer) {
      clearInterval(_phaseTimer);
      _phaseTimer = null;
    }
  }
  function _phaseTick() {
    if (_stopped || !isPlaying()) return;
    const pos = getCurrentPosMs();
    if (pos == null) return;
    const now = Date.now();
    const serverNow = _localToServer(now);
    const duration = getDuration();
    if (duration <= 0) return;
    _wsSend({ type: "PLAYHEAD", serverNow, posMs: pos });
    if (_peers.length > 0) {
      const ph = _peerHeads.get(_peers[0]);
      if (ph && now - ph.at <= PEER_FRESH_MS) {
        const projected = ((ph.posMs + (serverNow - ph.serverNow)) % duration + duration) % duration;
        let drift = pos - projected;
        if (drift > duration / 2) drift -= duration;
        if (drift < -duration / 2) drift += duration;
        logger.info(`[Sync] PLAYHEAD drift=${Math.round(drift)}ms pos=${pos}ms peer=${Math.round(projected)}ms`);
      }
    }
  }
  function _resolveBundledUrl(filename) {
    var _a;
    const FALLBACK = `file:///opt/usr/apps/fmDBbBnvJM.NexariSyncEngine/res/wgt/media/${filename}`;
    const tz = window.tizen;
    try {
      if (typeof ((_a = tz == null ? void 0 : tz.filesystem) == null ? void 0 : _a.toURI) === "function") {
        const uri = tz.filesystem.toURI(`wgt-package/media/${filename}`);
        if (uri && uri.startsWith("file:///")) return Promise.resolve(uri);
      }
    } catch (e) {
    }
    return new Promise((res) => {
      try {
        tz.filesystem.resolve(
          "wgt-package",
          (rootFile) => {
            try {
              const mediaFile = rootFile.resolve(`media/${filename}`);
              res(typeof (mediaFile == null ? void 0 : mediaFile.toURI) === "function" ? mediaFile.toURI() : FALLBACK);
            } catch (e) {
              res(FALLBACK);
            }
          },
          () => res(FALLBACK),
          "r"
        );
      } catch (e) {
        res(FALLBACK);
      }
    });
  }
  function _fetchPlaylistUrls() {
    return __async(this, null, function* () {
      try {
        const res = yield fetch(
          "http://192.168.1.17/api/v1/display/content?format=sync",
          { signal: AbortSignal.timeout(3e3) }
        );
        if (res.ok) {
          const data = yield res.json();
          if (data == null ? void 0 : data.url) {
            logger.info(`[Sync] playlist from API: ${data.url}`);
            return [data.url];
          }
        }
      } catch (e) {
      }
      const files = ["1.mp4", "2.mp4", "3.mp4"];
      const urls = yield Promise.all(files.map((f) => _resolveBundledUrl(f)));
      logger.info(`[Sync] playlist (bundled): ${urls.map((u) => u.split("/").pop()).join(", ")}`);
      return urls;
    });
  }
  function _fetchVideoUrl() {
    return __async(this, null, function* () {
      if (_playlistUrls.length > 0) return _playlistUrls[0];
      const urls = yield _fetchPlaylistUrls();
      return urls[0];
    });
  }
  var CLOCK_SAMPLES, CLOCK_RESYNC_MS, GO_AHEAD_MS, PLAYHEAD_TICK_MS, PEER_FRESH_MS, DEVICE_LATENCY_MS, WS_RECONNECT_MS, LEADER_SCAN_MS, _cfg, _ws, _wsReady, _stopped, _role2, _peers, _offsetMs, _selfLatency, _leaderReady, _followerReady, _goSent, _loadReceived, _phaseTimer, _phaseStartedAt, _peerHeads, _cooldownUntil, _ewma, _ewmaN, _peerWatchTimer, _resyncInProgress, _playlistUrls, _localToServer, _serverToLocal;
  var init_sync = __esm({
    "src/sync.ts"() {
      init_logger();
      init_engine();
      CLOCK_SAMPLES = 7;
      CLOCK_RESYNC_MS = 6e4;
      GO_AHEAD_MS = 5e3;
      PLAYHEAD_TICK_MS = 600;
      PEER_FRESH_MS = 4e3;
      DEVICE_LATENCY_MS = {
        "tizen7.0-mac-28af427a99db": 0,
        "tizen4.0-mac-d49dc0aa111b": 30
      };
      WS_RECONNECT_MS = 2e3;
      LEADER_SCAN_MS = 4e3;
      _ws = null;
      _wsReady = false;
      _stopped = false;
      _role2 = "pending";
      _peers = [];
      _offsetMs = 0;
      _selfLatency = 0;
      _leaderReady = false;
      _followerReady = /* @__PURE__ */ new Set();
      _goSent = false;
      _loadReceived = false;
      _phaseTimer = null;
      _phaseStartedAt = 0;
      _peerHeads = /* @__PURE__ */ new Map();
      _cooldownUntil = 0;
      _ewma = 0;
      _ewmaN = 0;
      _peerWatchTimer = null;
      _resyncInProgress = false;
      _playlistUrls = [];
      _localToServer = (t) => t + _offsetMs;
      _serverToLocal = (t) => t - _offsetMs;
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
        WS_URL: `ws://${RELAY_IP}:${RELAY_PORT}`,
        // Log relay: send logs to the on-TV Node relay (QBC:9616).
        // The relay stores logs in memory; the dashboard queries it directly.
        LOG_BASE: `http://${RELAY_IP}:${RELAY_PORT}`,
        GROUP_ID: "syncengine-001",
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
        modeEl.textContent = "AVPlay";
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
            wsUrl: CONFIG.WS_URL,
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
