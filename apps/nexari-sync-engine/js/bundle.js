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
  function _activeSlot() {
    var _a;
    return (_a = _slots[_activeIdx]) != null ? _a : null;
  }
  function _otherSlot() {
    return _slots.length > 1 ? _slots[1 - _activeIdx] : null;
  }
  function _av() {
    var _a, _b;
    return (_b = (_a = _activeSlot()) == null ? void 0 : _a.av) != null ? _b : null;
  }
  function _logDrift(ms) {
    if (_destroyed || !_playing || _playStartEpoch < 0 || _durationMs <= 0) return;
    const now = Date.now();
    if (now - _lastDriftLog < 2e3) return;
    _lastDriftLog = now;
    const exp = _expectedMs();
    const drift = ms - exp;
    logger.drift(`[AVPlay] pos=${ms}ms exp=${Math.round(exp)}ms drift=${Math.round(drift)}ms`, drift);
  }
  function _applyDisplay(a) {
    const portrait = window.screen.width < window.screen.height;
    if (portrait && typeof a.setDisplayRotation === "function") {
      try {
        a.setDisplayRotation("PLAYER_DISPLAY_ROTATION_90");
        logger.info("[AVPlay] setDisplayRotation(ROTATION_90) OK");
      } catch (e) {
        logger.warn(`[AVPlay] setDisplayRotation failed: ${e == null ? void 0 : e.message}`);
      }
    }
    try {
      a.setDisplayRect(0, 0, 1920, 1080);
      logger.info("[AVPlay] setDisplayRect(0,0,1920,1080) OK");
    } catch (e) {
      logger.error(`[AVPlay] setDisplayRect failed: ${e == null ? void 0 : e.message}`);
    }
    const mode = portrait ? "PLAYER_DISPLAY_MODE_FULL_SCREEN" : "PLAYER_DISPLAY_MODE_LETTER_BOX";
    try {
      a.setDisplayMethod(mode);
      logger.info(`[AVPlay] setDisplayMethod(${mode}) OK`);
    } catch (e) {
      logger.error(`[AVPlay] setDisplayMethod failed: ${e == null ? void 0 : e.message}`);
    }
  }
  function initEngine(container) {
    var _a, _b;
    _destroyed = false;
    _playing = false;
    _durationMs = 0;
    _swapFlight = false;
    _playAtEpoch = -1;
    _playStartEpoch = -1;
    _firstPlaytimeLogged = false;
    _url = "";
    _slots = [];
    _activeIdx = 0;
    Array.from(container.querySelectorAll('object[type="application/avplayer"]')).forEach((o) => {
      var _a2;
      return (_a2 = o.parentNode) == null ? void 0 : _a2.removeChild(o);
    });
    const w = window;
    const store = (_a = w.webapis) == null ? void 0 : _a.avplaystore;
    const avplay = (_b = w.webapis) == null ? void 0 : _b.avplay;
    const slotCount = store ? 2 : avplay ? 1 : 0;
    if (slotCount === 0) {
      logger.warn("[AVPlay] webapis.avplay/avplaystore not available");
      return;
    }
    for (let i = 0; i < slotCount; i++) {
      const obj = document.createElement("object");
      obj.type = "application/avplayer";
      obj.setAttribute("width", "1920");
      obj.setAttribute("height", "1080");
      obj.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;z-index:0;";
      container.appendChild(obj);
      const av = store ? store.getPlayer() : avplay;
      _slots.push({ av, obj, ready: false, preparing: false });
    }
    logger.info(`[AVPlay] engine init slots=${slotCount} screen=${window.screen.width}x${window.screen.height} portrait=${window.screen.width < window.screen.height} seamless=${slotCount === 2}`);
  }
  function prepare(url) {
    if (_destroyed || _slots.length === 0) return Promise.reject(new Error("[AVPlay] not available"));
    _playing = false;
    _durationMs = 0;
    _swapFlight = false;
    return _resolveUri(url).then((abs) => {
      _url = abs;
      return _openSlot(_slots[0], abs, 0);
    });
  }
  function _openSlot(slot, absUri, idx) {
    return new Promise((resolve, reject) => {
      var _a;
      if (_destroyed) {
        reject(new Error("destroyed"));
        return;
      }
      const a = slot.av;
      try {
        logger.info(`[AVPlay] slot${idx} open \u2192 ${absUri}`);
        a.open(absUri);
        try {
          logger.info(`[AVPlay] slot${idx} state after open: ${a.getState()}`);
        } catch (e) {
        }
        const isLocalFile = /^file:\/\//i.test(absUri);
        if (!isLocalFile && typeof a.setBufferingParam === "function") {
          try {
            a.setBufferingParam("PLAYER_BUFFER_FOR_PLAY", "PLAYER_BUFFER_SIZE_IN_SECOND", 0);
          } catch (e) {
          }
          try {
            a.setBufferingParam("PLAYER_BUFFER_FOR_RESUME", "PLAYER_BUFFER_SIZE_IN_SECOND", 0);
          } catch (e) {
          }
        }
        _applyDisplay(a);
        a.setListener(_makeListener(slot, idx));
        slot.preparing = true;
        a.prepareAsync(
          () => {
            if (_destroyed) {
              reject(new Error("destroyed during prepare"));
              return;
            }
            _applyDisplay(a);
            slot.ready = true;
            slot.preparing = false;
            if (idx === 0) _durationMs = a.getDuration();
            if (idx !== _activeIdx && typeof a.setVideoStillMode === "function") {
              try {
                a.setVideoStillMode("true");
                logger.info(`[AVPlay] slot${idx} setVideoStillMode(true) \u2014 held ready`);
              } catch (e) {
                logger.warn(`[AVPlay] slot${idx} setVideoStillMode failed: ${e == null ? void 0 : e.message}`);
              }
            }
            logger.info(`[AVPlay] slot${idx} READY \u2014 duration=${_durationMs}ms state=${a.getState()}`);
            resolve();
          },
          (e) => {
            var _a2, _b;
            slot.preparing = false;
            logger.error(`[AVPlay] slot${idx} prepareAsync failed: ${(_a2 = e == null ? void 0 : e.message) != null ? _a2 : e}`);
            reject(new Error((_b = e == null ? void 0 : e.message) != null ? _b : String(e)));
          }
        );
      } catch (e) {
        logger.error(`[AVPlay] slot${idx} open failed: ${(_a = e == null ? void 0 : e.message) != null ? _a : e}`);
        reject(e);
      }
    });
  }
  function _makeListener(slot, idx) {
    return {
      onbufferingstart: () => logger.info(`[AVPlay] slot${idx} buffering start`),
      onbufferingcomplete: () => logger.info(`[AVPlay] slot${idx} buffering complete`),
      onstreamcompleted: () => {
        if (slot !== _activeSlot()) {
          logger.info(`[AVPlay] slot${idx} stream completed (inactive \u2014 ignored)`);
          return;
        }
        logger.info(`[AVPlay] slot${idx} stream completed \u2192 swap scheduled`);
        if (!_destroyed) setTimeout(() => {
          if (!_destroyed) _handleLoop();
        }, 0);
      },
      oncurrentplaytime: (ms) => {
        if (slot !== _activeSlot()) return;
        if (!_firstPlaytimeLogged) {
          _firstPlaytimeLogged = true;
          logger.info(`[AVPlay] slot${idx} oncurrentplaytime first call: ms=${ms}`);
        }
        if (ms === 0) return;
        _logDrift(ms);
      },
      onerror: (t) => logger.error(`[AVPlay] slot${idx} error type=${t}`),
      onerrormsg: (t, m) => logger.error(`[AVPlay] slot${idx} errormsg type=${t} msg=${m}`),
      onevent: (t, d) => logger.info(`[AVPlay] slot${idx} event type=${t} data=${d}`),
      onstreaminfo: (w, h, bw, bh) => logger.info(`[AVPlay] slot${idx} streaminfo ${w}x${h} base=${bw}x${bh}`),
      ondrmevent: (t, d) => logger.info(`[AVPlay] slot${idx} drmevent type=${t} data=${d}`),
      onresolutionchanged: (w, h) => logger.info(`[AVPlay] slot${idx} resolution changed ${w}x${h}`),
      onbufferlevelchanged: (pct) => logger.info(`[AVPlay] slot${idx} buffer level ${pct}%`),
      onopenstatecompleted: () => logger.info(`[AVPlay] slot${idx} openstate completed`),
      onresourceconflicted: () => logger.warn(`[AVPlay] slot${idx} resource conflict`)
    };
  }
  function schedulePlayAt(epochMs) {
    if (_destroyed) return;
    _playAtEpoch = epochMs;
    clearTimeout(_playTimer);
    const slot = _activeSlot();
    if (!slot) return;
    const wait = epochMs - Date.now();
    logger.info(`[AVPlay] schedulePlayAt epoch=${epochMs} T-${Math.round(Math.max(0, wait))}ms slot=${_activeIdx}`);
    if (wait <= 0) {
      _doPlay(slot);
      return;
    }
    _playTimer = setTimeout(() => {
      (function spin() {
        if (_destroyed) return;
        if (Date.now() >= _playAtEpoch) {
          _doPlay(slot);
          return;
        }
        setTimeout(spin, 4);
      })();
    }, Math.max(0, wait - 60));
  }
  function _doPlay(slot) {
    if (_destroyed || _playing) return;
    const a = slot.av;
    try {
      _applyDisplay(a);
      if (typeof a.setVideoStillMode === "function") {
        try {
          a.setVideoStillMode("false");
        } catch (e) {
        }
      }
      try {
        logger.info(`[AVPlay] slot${_activeIdx} state before play: ${a.getState()}`);
      } catch (e) {
      }
      a.play();
      _playing = true;
      _playStartEpoch = _playAtEpoch > 0 ? _playAtEpoch : Date.now();
      logger.info(`[AVPlay] slot${_activeIdx} play() OK startEpoch=${_playStartEpoch}`);
      setTimeout(() => {
        if (_destroyed || !_playing) return;
        try {
          const st = a.getState();
          const ms = a.getCurrentTime ? a.getCurrentTime() : -1;
          if (st === "PLAYING" && ms === 0) logger.warn(`[AVPlay] STALL DETECTED \u2014 state=${st} pos=${ms}ms after 4s`);
          else logger.info(`[AVPlay] watchdog OK \u2014 state=${st} pos=${ms}ms`);
        } catch (e) {
        }
      }, 4e3);
      _startPoll();
    } catch (e) {
      logger.error(`[AVPlay] play() failed: ${e == null ? void 0 : e.message}`);
    }
  }
  function _startPoll() {
    clearInterval(_pollTimer);
    _pollTimer = setInterval(() => {
      if (_destroyed || !_playing) {
        clearInterval(_pollTimer);
        return;
      }
      const a = _av();
      if (!a) return;
      try {
        const ms = a.getCurrentTime ? a.getCurrentTime() : -1;
        const st = a.getState ? a.getState() : "?";
        logger.info(`[AVPlay] poll slot${_activeIdx} state=${st} pos=${ms}ms`);
        if (ms > 0) _logDrift(ms);
      } catch (e) {
        logger.warn(`[AVPlay] poll err: ${e == null ? void 0 : e.message}`);
      }
    }, 5e3);
  }
  function _handleLoop() {
    if (_swapFlight || _destroyed) return;
    const fromSlot = _activeSlot();
    if (!fromSlot) return;
    const toSlot = _otherSlot();
    if (!toSlot) {
      _fullResetLoop(fromSlot);
      return;
    }
    _swapFlight = true;
    _playing = false;
    clearInterval(_pollTimer);
    const fromAv = fromSlot.av;
    const toAv = toSlot.av;
    const fromIdx = _activeIdx;
    const toIdx = 1 - _activeIdx;
    logger.info(`[AVPlay] swap slot${fromIdx}\u2192slot${toIdx} starting`);
    if (typeof fromAv.setVideoStillMode === "function") {
      try {
        fromAv.setVideoStillMode("true");
        logger.info(`[AVPlay] slot${fromIdx} setVideoStillMode(true) \u2014 frame frozen`);
      } catch (e) {
        logger.warn(`[AVPlay] slot${fromIdx} stillMode(true) err: ${e == null ? void 0 : e.message}`);
      }
    }
    try {
      fromAv.stop();
      logger.info(`[AVPlay] slot${fromIdx} stopped`);
    } catch (e) {
      logger.warn(`[AVPlay] slot${fromIdx} stop err: ${e == null ? void 0 : e.message}`);
    }
    try {
      fromAv.close();
      fromSlot.ready = false;
      logger.info(`[AVPlay] slot${fromIdx} closed`);
    } catch (e) {
      logger.warn(`[AVPlay] slot${fromIdx} close err: ${e == null ? void 0 : e.message}`);
    }
    try {
      logger.info(`[AVPlay] slot${toIdx} open \u2192 ${_url}`);
      toAv.open(_url);
    } catch (e) {
      logger.error(`[AVPlay] slot${toIdx} open failed: ${e == null ? void 0 : e.message}`);
      _swapFlight = false;
      return;
    }
    _applyDisplay(toAv);
    toAv.setListener(_makeListener(toSlot, toIdx));
    if (typeof toAv.setVideoStillMode === "function") {
      try {
        toAv.setVideoStillMode("true");
      } catch (e) {
      }
    }
    toSlot.preparing = true;
    toAv.prepareAsync(
      () => {
        if (_destroyed) return;
        toSlot.preparing = false;
        toSlot.ready = true;
        _applyDisplay(toAv);
        const targetMs = _playStartEpoch > 0 && _durationMs > 0 ? Math.round(((Date.now() - _playStartEpoch) % _durationMs + _durationMs) % _durationMs) : 0;
        const useSeek = targetMs > 100 && targetMs < _durationMs - 500;
        logger.info(`[AVPlay] slot${toIdx} prepared \u2014 target=${targetMs}ms useSeek=${useSeek}`);
        const finalize = () => {
          if (typeof toAv.setVideoStillMode === "function") {
            try {
              toAv.setVideoStillMode("false");
            } catch (e) {
            }
          }
          try {
            toAv.play();
          } catch (e) {
            logger.error(`[AVPlay] slot${toIdx} play() failed: ${e == null ? void 0 : e.message}`);
          }
          _activeIdx = toIdx;
          _playing = true;
          _swapFlight = false;
          logger.info(`[AVPlay] swap complete \u2014 playing slot${_activeIdx}`);
          _startPoll();
        };
        if (useSeek) {
          try {
            toAv.seekTo(targetMs, finalize, (e) => {
              logger.warn(`[AVPlay] slot${toIdx} seekTo failed: ${e == null ? void 0 : e.message} \u2014 playing from 0`);
              finalize();
            });
          } catch (e) {
            logger.warn(`[AVPlay] slot${toIdx} seekTo threw: ${e == null ? void 0 : e.message}`);
            finalize();
          }
        } else {
          finalize();
        }
      },
      (e) => {
        var _a;
        toSlot.preparing = false;
        _swapFlight = false;
        logger.error(`[AVPlay] slot${toIdx} swap prepareAsync failed: ${(_a = e == null ? void 0 : e.message) != null ? _a : e} \u2014 falling back to full reset on slot${fromIdx}`);
        try {
          fromAv.open(_url);
        } catch (e2) {
        }
        _applyDisplay(fromAv);
        fromAv.setListener(_makeListener(fromSlot, fromIdx));
        _fullResetLoop(fromSlot);
      }
    );
  }
  function _fullResetLoop(slot) {
    _swapFlight = true;
    _playing = false;
    clearInterval(_pollTimer);
    const a = slot.av;
    let done = false;
    const guard = setTimeout(() => {
      if (done) return;
      done = true;
      _swapFlight = false;
      logger.warn("[AVPlay] full-reset loop timeout \u2014 forcing play()");
      try {
        a.play();
      } catch (e) {
      }
      _playing = true;
      _startPoll();
    }, 6e3);
    try {
      a.stop();
    } catch (e) {
    }
    a.prepareAsync(
      () => {
        if (done || _destroyed) return;
        const targetMs = _playStartEpoch > 0 && _durationMs > 0 ? Math.round(((Date.now() - _playStartEpoch) % _durationMs + _durationMs) % _durationMs) : 0;
        logger.info(`[AVPlay] full-reset loop ready, seekTo=${targetMs}ms`);
        _applyDisplay(a);
        const finishPlay = () => {
          if (done) return;
          done = true;
          clearTimeout(guard);
          _swapFlight = false;
          try {
            a.play();
          } catch (e) {
          }
          _playing = true;
          _startPoll();
        };
        if (targetMs > 100 && targetMs < _durationMs - 200) {
          a.seekTo(targetMs, finishPlay, (e) => {
            logger.warn(`[AVPlay] reset seekTo failed: ${e == null ? void 0 : e.message}`);
            finishPlay();
          });
        } else {
          finishPlay();
        }
      },
      (e) => {
        var _a;
        if (done) return;
        done = true;
        clearTimeout(guard);
        _swapFlight = false;
        logger.error(`[AVPlay] full-reset prepareAsync failed: ${(_a = e == null ? void 0 : e.message) != null ? _a : e}`);
      }
    );
  }
  function getDuration() {
    return _durationMs;
  }
  function isPlaying() {
    return _playing;
  }
  function getCurrentPosMs() {
    if (!_playing) return null;
    const a = _av();
    if (!a || !a.getCurrentTime) return null;
    try {
      const ms = a.getCurrentTime();
      if (ms <= 0) return null;
      return ms;
    } catch (e) {
      return null;
    }
  }
  function nudgePhase(deltaMs) {
    if (!_playing || _playStartEpoch < 0) return;
    _playStartEpoch += deltaMs;
    logger.info(`[AVPlay] phase nudge ${deltaMs >= 0 ? "+" : ""}${deltaMs}ms \u2192 playStartEpoch=${_playStartEpoch}`);
  }
  function destroyEngine() {
    var _a;
    _destroyed = true;
    _playing = false;
    clearTimeout(_playTimer);
    clearInterval(_pollTimer);
    for (const slot of _slots) {
      try {
        const s = slot.av.getState();
        if (s === "PLAYING" || s === "PAUSED" || s === "READY") slot.av.stop();
        slot.av.close();
      } catch (e) {
      }
      if ((_a = slot.obj) == null ? void 0 : _a.parentNode) slot.obj.parentNode.removeChild(slot.obj);
    }
    _slots = [];
    logger.info("[AVPlay] engine destroyed");
  }
  function _resolveUri(url) {
    var _a, _b, _c;
    if (/^(https?|file):\/\//i.test(url)) return Promise.resolve(url);
    const rel = url.replace(/^\.\//, "");
    try {
      const base = (_b = (_a = window.tizen) == null ? void 0 : _a.filesystem) == null ? void 0 : _b.toURI("wgt-package");
      if (base && base.length > 5) {
        const abs = (base.endsWith("/") ? base : base + "/") + rel;
        logger.info(`[AVPlay] uri (toURI): ${abs}`);
        return Promise.resolve(abs);
      }
    } catch (e) {
    }
    const tizen = window.tizen;
    if ((_c = tizen == null ? void 0 : tizen.filesystem) == null ? void 0 : _c.resolve) {
      return new Promise((res) => {
        try {
          tizen.filesystem.resolve(
            "wgt-package",
            (dir) => {
              const base = dir.toURI ? dir.toURI() : String(dir);
              const abs = (base.endsWith("/") ? base : base + "/") + rel;
              logger.info(`[AVPlay] uri (resolve): ${abs}`);
              res(abs);
            },
            () => res(_scriptBase(rel)),
            "r"
          );
        } catch (e) {
          res(_scriptBase(rel));
        }
      });
    }
    return Promise.resolve(_scriptBase(rel));
  }
  function _scriptBase(rel) {
    var _a;
    for (const s of Array.from(document.scripts)) {
      if (((_a = s.src) == null ? void 0 : _a.startsWith("file:///")) && s.src.includes("bundle.js"))
        return s.src.replace(/js\/bundle\.js.*$/, "") + rel;
    }
    logger.warn(`[AVPlay] could not resolve absolute URI for: ${rel}`);
    return rel;
  }
  function _expectedMs() {
    if (_playStartEpoch < 0 || _durationMs <= 0) return 0;
    return ((Date.now() - _playStartEpoch) % _durationMs + _durationMs) % _durationMs;
  }
  var _slots, _activeIdx, _url, _destroyed, _playing, _durationMs, _swapFlight, _playAtEpoch, _playStartEpoch, _playTimer, _lastDriftLog, _pollTimer, _firstPlaytimeLogged;
  var init_engine = __esm({
    "src/engine.ts"() {
      init_logger();
      _slots = [];
      _activeIdx = 0;
      _url = "";
      _destroyed = false;
      _playing = false;
      _durationMs = 0;
      _swapFlight = false;
      _playAtEpoch = -1;
      _playStartEpoch = -1;
      _playTimer = null;
      _lastDriftLog = 0;
      _pollTimer = null;
      _firstPlaytimeLogged = false;
    }
  });

  // src/engine-html5.ts
  function initHtml5Engine(container) {
    _destroyed2 = false;
    _playing2 = false;
    _durationMs2 = 0;
    _playAtEpoch2 = -1;
    _playStartEpoch2 = -1;
    _video = document.createElement("video");
    _video.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;z-index:0;object-fit:fill;background:#000;";
    _video.setAttribute("playsinline", "");
    _video.setAttribute("webkit-playsinline", "");
    container.appendChild(_video);
    _video.addEventListener("ended", () => {
      if (_destroyed2 || !_playing2) return;
      logger.info("[HTML5] ended \u2192 loop");
      _handleLoop2();
    });
    _video.addEventListener("error", () => {
      var _a, _b, _c;
      logger.error(`[HTML5] video error: ${(_b = (_a = _video == null ? void 0 : _video.error) == null ? void 0 : _a.message) != null ? _b : "unknown"} (code ${(_c = _video == null ? void 0 : _video.error) == null ? void 0 : _c.code})`);
    });
    _video.addEventListener("timeupdate", () => {
      var _a;
      if (_destroyed2 || !_playing2 || _playStartEpoch2 < 0 || _durationMs2 <= 0) return;
      const now = Date.now();
      if (now - _lastDriftLog2 < 2e3) return;
      _lastDriftLog2 = now;
      const posMs = Math.round(((_a = _video.currentTime) != null ? _a : 0) * 1e3);
      const exp = _expectedMs2();
      const drift = posMs - exp;
      logger.drift(`[HTML5] pos=${posMs}ms exp=${Math.round(exp)}ms drift=${Math.round(drift)}ms`, drift);
    });
    logger.info("[HTML5] <video> engine initialised");
  }
  function prepareHtml5(url) {
    if (!_video || _destroyed2) return Promise.reject(new Error("[HTML5] engine not initialised"));
    _playing2 = false;
    _durationMs2 = 0;
    return new Promise((resolve, reject) => {
      const v = _video;
      const cleanup = () => {
        v.removeEventListener("canplaythrough", onReady);
        v.removeEventListener("error", onErr);
      };
      const onReady = () => {
        var _a;
        cleanup();
        _durationMs2 = Math.round(((_a = v.duration) != null ? _a : 0) * 1e3);
        logger.info(`[HTML5] canplaythrough \u2014 duration=${_durationMs2}ms`);
        resolve();
      };
      const onErr = () => {
        var _a, _b;
        cleanup();
        reject(new Error(`[HTML5] load error: ${(_b = (_a = v.error) == null ? void 0 : _a.message) != null ? _b : "unknown"}`));
      };
      v.addEventListener("canplaythrough", onReady);
      v.addEventListener("error", onErr);
      v.src = url;
      v.preload = "auto";
      v.load();
      logger.info(`[HTML5] loading: ${url}`);
    });
  }
  function scheduleHtml5PlayAt(epochMs) {
    if (_destroyed2) return;
    _playAtEpoch2 = epochMs;
    clearTimeout(_playTimer2);
    const wait = epochMs - Date.now();
    logger.info(`[HTML5] schedulePlayAt epoch=${epochMs} T-${Math.round(Math.max(0, wait))}ms`);
    if (wait <= 0) {
      _doPlay2();
      return;
    }
    _playTimer2 = setTimeout(() => {
      (function spin() {
        if (_destroyed2) return;
        if (Date.now() >= _playAtEpoch2) {
          _doPlay2();
          return;
        }
        setTimeout(spin, 4);
      })();
    }, Math.max(0, wait - 60));
  }
  function _doPlay2() {
    if (_destroyed2 || _playing2 || !_video) return;
    _video.play().then(() => {
      _playing2 = true;
      _playStartEpoch2 = _playAtEpoch2 > 0 ? _playAtEpoch2 : Date.now();
      logger.info(`[HTML5] play() \u2014 startEpoch=${_playStartEpoch2}`);
    }).catch((e) => logger.error(`[HTML5] play() failed: ${e == null ? void 0 : e.message}`));
  }
  function _handleLoop2() {
    if (!_video || _destroyed2) return;
    const targetMs = _playStartEpoch2 > 0 && _durationMs2 > 0 ? Math.round(((Date.now() - _playStartEpoch2) % _durationMs2 + _durationMs2) % _durationMs2) : 0;
    logger.info(`[HTML5] loop \u2192 seekTo ${targetMs}ms`);
    _video.currentTime = targetMs / 1e3;
    _video.play().catch((e) => logger.warn(`[HTML5] loop play() failed: ${e == null ? void 0 : e.message}`));
  }
  function getHtml5Duration() {
    return _durationMs2;
  }
  function destroyHtml5Engine() {
    _destroyed2 = true;
    _playing2 = false;
    clearTimeout(_playTimer2);
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
  function _expectedMs2() {
    if (_playStartEpoch2 < 0 || _durationMs2 <= 0) return 0;
    return ((Date.now() - _playStartEpoch2) % _durationMs2 + _durationMs2) % _durationMs2;
  }
  var _video, _destroyed2, _playing2, _durationMs2, _playAtEpoch2, _playStartEpoch2, _playTimer2, _lastDriftLog2;
  var init_engine_html5 = __esm({
    "src/engine-html5.ts"() {
      init_logger();
      _video = null;
      _destroyed2 = false;
      _playing2 = false;
      _durationMs2 = 0;
      _playAtEpoch2 = -1;
      _playStartEpoch2 = -1;
      _playTimer2 = null;
      _lastDriftLog2 = 0;
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
      _startPoll2();
      if (_role === "leader") {
        yield _runLeader();
      } else {
        cfg.onStatus("Follower \u2014 waiting for LOAD_URL from leader\u2026");
      }
    });
  }
  function stop() {
    _stopped = true;
    _stopPhaseHeartbeat();
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
  }
  function _startPoll2() {
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
  var GO_AHEAD_MS, FETCH_TIMEOUT, POLL_SLEEP_MS, REGISTER_EVERY, SEND_RETRIES, SEND_RETRY_MS, DEVICE_LATENCY_FALLBACK_MS, CAL_LS_KEY_PREFIX, _selfLatencyCached, PHASE_HEARTBEAT_MS, PHASE_PEER_FRESH_MS, PHASE_NUDGE_THRESHOLD, PHASE_NUDGE_DAMPING, PHASE_NUDGE_CAP_MS, PHASE_CAL_GRACE_MS, PHASE_CAL_EWMA_ALPHA, _peerPlayheads, _phaseTimer, _phaseStartedAt, _calibrationEwma, _calibrationSamples, _cfg, _role, _peers, _stopped, _pollSince, _leaderEngineReady, _followerReadySet, _goSent, _loadReceived;
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
      PHASE_HEARTBEAT_MS = 3e3;
      PHASE_PEER_FRESH_MS = 6e3;
      PHASE_NUDGE_THRESHOLD = 15;
      PHASE_NUDGE_DAMPING = 0.5;
      PHASE_NUDGE_CAP_MS = 80;
      PHASE_CAL_GRACE_MS = 1e4;
      PHASE_CAL_EWMA_ALPHA = 0.2;
      _peerPlayheads = /* @__PURE__ */ new Map();
      _phaseTimer = null;
      _phaseStartedAt = 0;
      _calibrationEwma = 0;
      _calibrationSamples = 0;
      _role = "pending";
      _peers = [];
      _stopped = false;
      _pollSince = 0;
      _leaderEngineReady = false;
      _followerReadySet = /* @__PURE__ */ new Set();
      _goSent = false;
      _loadReceived = false;
    }
  });

  // src/app.ts
  var require_app = __commonJS({
    "src/app.ts"(exports) {
      init_engine();
      init_engine_html5();
      init_logger();
      init_sync();
      var CONFIG = {
        PI_BASE: "http://192.168.1.17",
        GROUP_ID: "syncengine-001",
        EXPECTED_PEERS: 2
      };
      var _mode = "avplay";
      var _container;
      var _syncStarted = false;
      window.addEventListener("load", () => __async(null, null, function* () {
        var _a;
        _container = document.getElementById("player-container");
        const statusEl = document.getElementById("status");
        const deviceInfo = document.getElementById("device-info");
        const modeEl = document.getElementById("engine-mode");
        const setStatus = (msg) => {
          statusEl.textContent = msg;
        };
        const setModeLabel = (m) => {
          modeEl.textContent = m === "avplay" ? "2 \xB7 AVPlay (active)" : "1 \xB7 HTML5 (active)";
        };
        setStatus("Detecting device\u2026");
        const selfIp = yield _getSelfIp();
        const deviceId = yield _makeDeviceId(selfIp);
        initLogger(CONFIG.PI_BASE, deviceId);
        deviceInfo.textContent = `${deviceId}  |  ${selfIp}  |  group: ${CONFIG.GROUP_ID}`;
        logger.info(`[App] boot ip=${selfIp} deviceId=${deviceId}`);
        try {
          const td = (_a = window.tizen) == null ? void 0 : _a.tvinputdevice;
          if (td) {
            td.registerKey("1");
            td.registerKey("2");
          }
        } catch (e) {
          logger.warn(`[App] registerKey failed: ${e == null ? void 0 : e.message}`);
        }
        document.addEventListener("keydown", (e) => {
          var _a2, _b;
          if (e.keyCode === 49) {
            _switchEngine("html5", setStatus, setModeLabel);
          } else if (e.keyCode === 50) {
            _switchEngine("avplay", setStatus, setModeLabel);
          } else if (e.keyCode === 10009 || e.keyCode === 27) {
            logger.info("[App] exit requested");
            stop();
            try {
              (_b = (_a2 = window.tizen) == null ? void 0 : _a2.application) == null ? void 0 : _b.getCurrentApplication().exit();
            } catch (e2) {
            }
          }
        });
        _activateEngine(_mode, _container);
        setModeLabel(_mode);
        if (!_syncStarted) {
          _syncStarted = true;
          const overlay = document.getElementById("overlay");
          const logPanel = document.getElementById("log-panel");
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
            prepareEngine: (url) => {
              if (_mode === "avplay") return prepare(url);
              return prepareHtml5(url);
            },
            schedulePlay: (epochMs) => {
              if (overlay) overlay.style.display = "none";
              if (logPanel) logPanel.style.display = "none";
              if (_mode === "avplay") schedulePlayAt(epochMs);
              else scheduleHtml5PlayAt(epochMs);
            },
            getEngineDuration: () => {
              if (_mode === "avplay") return getDuration();
              return getHtml5Duration();
            }
          });
        }
      }));
      function _activateEngine(mode, container) {
        var _a;
        try {
          destroyEngine();
        } catch (e) {
        }
        try {
          destroyHtml5Engine();
        } catch (e) {
        }
        const old = container.querySelector('object[type="application/avplayer"], video');
        if (old) (_a = old.parentNode) == null ? void 0 : _a.removeChild(old);
        if (mode === "avplay") {
          initEngine(container);
        } else {
          initHtml5Engine(container);
        }
      }
      function _switchEngine(mode, setStatus, setModeLabel) {
        if (_mode === mode) return;
        logger.info(`[App] engine switch ${_mode} \u2192 ${mode}`);
        _mode = mode;
        setModeLabel(mode);
        _activateEngine(mode, _container);
        setStatus(`Engine: ${mode === "avplay" ? "AVPlay" : "HTML5 video"} \u2014 waiting for next sync cue`);
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
