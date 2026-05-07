/**
 * wall-engine.ts — AVPlay engine for nexari-tizen videowall (Tizen 6.0+ B2B/LFD)
 *
 * Adapted from apps/nexari-sync-engine/src/engine.ts for the main player.
 * Key differences:
 *   - No HTML5 fallback path (player.ts handles non-wall HTML5 separately)
 *   - No display rotation — wall panels always render fullscreen (setVideoRoi
 *     handles the source-region crop, displayRect stays 1920×1080 full screen)
 *   - TypeScript namespace, compiled with module:none — loaded as a plain
 *     <script> in index.html before player.js
 *
 * Runtime globals used:
 *   webapis   — Tizen Samsung webapis SDK (avplay, avplaystore)
 *   logger    — shared logger instance (defined in player.ts before this script)
 */
var WallEngine;
(function (WallEngine) {
    // ── State ──────────────────────────────────────────────────────────────────
    let _url = '';
    let _durationMs = 0;
    let _playing = false;
    let _destroyed = false;
    let _prebuffered = false;
    let _looping = false;
    let _playTimer = null;
    let _driftTimer = null;
    let _onLoop = null;
    let _useAvplaystore = false;
    let _playerA = null; // single persistent avplaystore slot
    // Wall-crop ROI — set once via setWallCrop() at VIDEOWALL_INIT time.
    // survives destroyEngine/initEngine cycles (panel position never changes).
    let _wallRoi = null;
    const DRIFT_LOG_MS = 2000;
    // ── Helpers ─────────────────────────────────────────────────────────────────
    function _getState(p) {
        if (!p)
            return 'NONE';
        try {
            return p.getState();
        }
        catch (_a) {
            return 'NONE';
        }
    }
    function _avState() {
        try {
            return webapis.avplay.getState();
        }
        catch (_a) {
            return 'NONE';
        }
    }
    /**
     * Set display to fullscreen — for wall mode the source crop is handled
     * entirely by setVideoRoi; the destination rect is always the full panel.
     */
    function _setupDisplay(p) {
        if (p) {
            try {
                p.setDisplayRect(0, 0, 1920, 1080);
            }
            catch (_a) { }
            try {
                p.setDisplayMethod('PLAYER_DISPLAY_MODE_FULL_SCREEN');
            }
            catch (_b) { }
        }
        else {
            try {
                webapis.avplay.setDisplayRect(0, 0, 1920, 1080);
            }
            catch (_c) { }
            try {
                webapis.avplay.setDisplayMethod('PLAYER_DISPLAY_MODE_FULL_SCREEN');
            }
            catch (_e) { }
        }
    }
    /**
     * Apply video-wall source-region crop.
     *
     * Path 1 — Tizen 6.0+ (B2B/LFD): setVideoRoi(xR, yR, wR, hR).
     *   Display rect stays fullscreen; GPU scaler renders only the slice.
     *
     * Path 2 — Tizen <6 oversize displayRect fallback (unsigned-long params).
     *   Only works for the top-left cell (xR=0, yR=0); other cells log a warning
     *   and fall back to full-frame playback (acceptable degradation).
     *
     * Must be called AFTER prepareAsync success (state must be READY/PLAYING/PAUSED).
     */
    function _applyWallRoi(p) {
        var _a, _b, _c, _e;
        if (!_wallRoi)
            return;
        const { xR, yR, wR, hR } = _wallRoi;
        const target = p !== null && p !== void 0 ? p : webapis.avplay;
        // Path 1 — Tizen 6.0+ setVideoRoi
        if (target && typeof target.setVideoRoi === 'function') {
            try {
                target.setVideoRoi(xR, yR, wR, hR);
                logger.info(`[WallEngine] setVideoRoi(${xR.toFixed(4)}, ${yR.toFixed(4)}, ` +
                    `${wR.toFixed(4)}, ${hR.toFixed(4)}) applied`);
                return;
            }
            catch (e) {
                logger.warn(`[WallEngine] setVideoRoi threw: ${(_b = (_a = e === null || e === void 0 ? void 0 : e.name) !== null && _a !== void 0 ? _a : e === null || e === void 0 ? void 0 : e.message) !== null && _b !== void 0 ? _b : e} ` +
                    `— trying displayRect fallback`);
            }
        }
        else {
            logger.info('[WallEngine] setVideoRoi unavailable (Tizen <6?) — trying displayRect fallback');
        }
        // Path 2 — Tizen <6 oversize displayRect (unsigned params only)
        const outW = Math.round(1920 / wR);
        const outH = Math.round(1080 / hR);
        const offX = -Math.round(xR * outW);
        const offY = -Math.round(yR * outH);
        if (offX < 0 || offY < 0) {
            logger.warn(`[WallEngine] displayRect fallback requires negative offset (${offX},${offY})` +
                ` — Tizen <6 cannot crop col>0/row>0; playing full frame`);
            return;
        }
        try {
            if (p) {
                p.setDisplayRect(offX, offY, outW, outH);
                try {
                    p.setDisplayMethod('PLAYER_DISPLAY_MODE_FULL_SCREEN');
                }
                catch (_f) { }
            }
            else {
                webapis.avplay.setDisplayRect(offX, offY, outW, outH);
                try {
                    webapis.avplay.setDisplayMethod('PLAYER_DISPLAY_MODE_FULL_SCREEN');
                }
                catch (_g) { }
            }
            logger.info(`[WallEngine] displayRect oversize fallback (${offX},${offY},${outW},${outH}) applied`);
        }
        catch (e) {
            logger.warn(`[WallEngine] displayRect fallback threw: ${(_e = (_c = e === null || e === void 0 ? void 0 : e.name) !== null && _c !== void 0 ? _c : e === null || e === void 0 ? void 0 : e.message) !== null && _e !== void 0 ? _e : e} — full frame`);
        }
    }
    function _setStillMode(on) {
        if (!_playerA)
            return;
        try {
            _playerA.setVideoStillMode(on ? 'true' : 'false');
        }
        catch (_a) { }
    }
    // ── Listener factories ───────────────────────────────────────────────────────
    function _makeListenerA() {
        let eosGuard = false;
        return {
            onbufferingstart() { logger.info('[WallEngine] A buffering start'); },
            onbufferingprogress(pct) {
                if (pct % 25 === 0)
                    logger.info(`[WallEngine] A buffering ${pct}%`);
            },
            onbufferingcomplete() { logger.info('[WallEngine] A buffering complete'); },
            oncurrentplaytime(_t) { },
            onstreamcompleted() {
                if (eosGuard)
                    return;
                let cur = 0;
                try {
                    cur = _playerA ? _playerA.getCurrentTime() : 0;
                }
                catch (_a) { }
                if (_destroyed || _durationMs <= 0 || cur < _durationMs - 600) {
                    logger.info(`[WallEngine] A spurious EOS pos=${cur}ms dur=${_durationMs}ms — ignored`);
                    return;
                }
                eosGuard = true;
                _playing = false;
                logger.info(`[WallEngine] A EOS at ${cur}ms — starting prebuffer`);
                _prebufferForBarrier();
            },
            onerror(err) { logger.error(`[WallEngine] A error: ${JSON.stringify(err)}`); },
            onevent(type, _d) { logger.debug(`[WallEngine] A event type=${type}`); },
        };
    }
    function _makeListenerSingle() {
        return {
            onbufferingstart() { logger.info('[WallEngine] buffering start'); },
            onbufferingprogress(pct) {
                if (pct % 25 === 0)
                    logger.info(`[WallEngine] buffering ${pct}%`);
            },
            onbufferingcomplete() { logger.info('[WallEngine] buffering complete'); },
            oncurrentplaytime(_t) { },
            onstreamcompleted() {
                let cur = 0;
                try {
                    cur = webapis.avplay.getCurrentTime();
                }
                catch (_a) { }
                if (_destroyed || _durationMs <= 0 || cur < _durationMs - 600) {
                    logger.info(`[WallEngine] spurious EOS pos=${cur}ms dur=${_durationMs}ms — ignored`);
                    return;
                }
                _playing = false;
                logger.info(`[WallEngine] EOS at ${cur}ms — starting prebuffer`);
                _prebufferForBarrier();
            },
            onerror(err) { logger.error(`[WallEngine] error: ${JSON.stringify(err)}`); },
            onevent(type, _d) { logger.debug(`[WallEngine] event type=${type}`); },
        };
    }
    // ── Drift watchdog ───────────────────────────────────────────────────────────
    function _startDriftLog() {
        if (_driftTimer)
            return;
        let frozenCount = 0;
        _driftTimer = setInterval(() => {
            if (_destroyed || !_playing)
                return;
            try {
                let pos;
                let st;
                if (_useAvplaystore && _playerA) {
                    pos = _playerA.getCurrentTime();
                    st = _getState(_playerA);
                }
                else {
                    pos = webapis.avplay.getCurrentTime();
                    st = _avState();
                }
                logger.info(`[WallEngine] pos=${pos}ms dur=${_durationMs}ms state=${st}`);
                if (_durationMs > 0 && pos >= _durationMs - 200) {
                    frozenCount++;
                    if (frozenCount >= 2) {
                        frozenCount = 0;
                        logger.warn(`[WallEngine] watchdog: frozen at end pos=${pos}ms — forcing prebuffer`);
                        _playing = false;
                        _prebufferForBarrier();
                    }
                }
                else {
                    frozenCount = 0;
                }
            }
            catch (_a) { }
        }, DRIFT_LOG_MS);
    }
    function _stopDriftLog() {
        if (_driftTimer) {
            clearInterval(_driftTimer);
            _driftTimer = null;
        }
    }
    // ── Barrier prebuffer ────────────────────────────────────────────────────────
    /**
     * On EOS: freeze last frame, rebuffer at frame 0, signal LOOP_READY.
     * The relay collects all LOOP_READY messages and broadcasts LOOP_GO when
     * all wall panels are ready, so all call schedulePlayAt() simultaneously.
     */
    function _prebufferForBarrier() {
        if (_destroyed || _looping)
            return;
        _looping = true;
        _prebuffered = false;
        _stopDriftLog();
        if (_useAvplaystore && _playerA) {
            _prebufferAvplaystore(_url);
        }
        else {
            _prebufferGlobalAvplay(_url);
        }
    }
    /**
     * Avplaystore still-mode transition:
     *  1. setVideoStillMode("true") — freeze last frame on hardware overlay
     *  2. stop()                    — player IDLE, still frame held
     *  3. open(url)                 — reload same slot with same URL
     *  4. prepareAsync → play()+pause() at frame 0
     *  5. _onLoop() → LOOP_READY
     */
    function _prebufferAvplaystore(nextUrl) {
        _setStillMode(true);
        try {
            _playerA.stop();
        }
        catch (_a) { }
        logger.info('[WallEngine] avplaystore prebuffer: still-freeze → stop → open → prepareAsync');
        try {
            _playerA.open(nextUrl);
        }
        catch (e) {
            _looping = false;
            logger.error(`[WallEngine] A.open() failed: ${e === null || e === void 0 ? void 0 : e.message}`);
            return;
        }
        _setupDisplay(_playerA);
        _playerA.setListener(_makeListenerA());
        _playerA.prepareAsync(() => {
            if (_destroyed) {
                _looping = false;
                return;
            }
            _setupDisplay(_playerA);
            _applyWallRoi(_playerA);
            _durationMs = _playerA.getDuration();
            try {
                _playerA.play();
            }
            catch (_a) { }
            setTimeout(() => {
                if (_destroyed) {
                    _looping = false;
                    return;
                }
                try {
                    _playerA.pause();
                }
                catch (_a) { }
                _looping = false;
                _prebuffered = true;
                logger.info('[WallEngine] avplaystore: prebuffered at frame 0 — LOOP_READY');
                if (_onLoop)
                    _onLoop();
            }, 100);
        }, (err) => {
            _looping = false;
            logger.error(`[WallEngine] A prepareAsync failed in prebuffer: ${JSON.stringify(err)}`);
        });
    }
    function _prebufferGlobalAvplay(nextUrl) {
        logger.info('[WallEngine] global avplay prebuffer: stop → close → open → prepareAsync');
        try {
            webapis.avplay.stop();
        }
        catch (_a) { }
        try {
            webapis.avplay.close();
        }
        catch (_b) { }
        setTimeout(() => {
            if (_destroyed) {
                _looping = false;
                return;
            }
            try {
                webapis.avplay.open(nextUrl);
                _setupDisplay();
                webapis.avplay.setListener(_makeListenerSingle());
                webapis.avplay.prepareAsync(() => {
                    if (_destroyed) {
                        _looping = false;
                        return;
                    }
                    _setupDisplay();
                    _applyWallRoi();
                    _durationMs = webapis.avplay.getDuration();
                    try {
                        webapis.avplay.play();
                    }
                    catch (_a) { }
                    setTimeout(() => {
                        if (_destroyed) {
                            _looping = false;
                            return;
                        }
                        try {
                            webapis.avplay.pause();
                        }
                        catch (_a) { }
                        _looping = false;
                        _prebuffered = true;
                        logger.info('[WallEngine] global: prebuffered at frame 0 — LOOP_READY');
                        if (_onLoop)
                            _onLoop();
                    }, 100);
                }, (err) => {
                    _looping = false;
                    logger.error(`[WallEngine] global prebuffer failed: ${JSON.stringify(err)}`);
                });
            }
            catch (e) {
                _looping = false;
                logger.error(`[WallEngine] global prebuffer open failed: ${e === null || e === void 0 ? void 0 : e.message}`);
            }
        }, 50);
    }
    // ── Scheduled play ───────────────────────────────────────────────────────────
    function _doPlay() {
        _playTimer = null;
        if (_destroyed || _playing)
            return;
        _prebuffered = false;
        _playing = true;
        if (_useAvplaystore && _playerA) {
            _setStillMode(false);
            try {
                _playerA.play();
                logger.info('[WallEngine] avplaystore play() — synchronized start');
            }
            catch (e) {
                logger.error(`[WallEngine] avplaystore play() failed: ${e === null || e === void 0 ? void 0 : e.message}`);
            }
        }
        else {
            try {
                webapis.avplay.play();
                logger.info('[WallEngine] global avplay play() — synchronized start');
            }
            catch (e) {
                logger.error(`[WallEngine] play() failed: ${e === null || e === void 0 ? void 0 : e.message}`);
            }
        }
        _startDriftLog();
    }
    // ── Internal prepare helpers ─────────────────────────────────────────────────
    function _openAndPrepare(p, url, listener, resolve, reject) {
        try {
            const s = _getState(p);
            if (s === 'PLAYING' || s === 'PAUSED')
                p.stop();
            if (s !== 'NONE')
                p.close();
            p.open(url);
        }
        catch (e) {
            return reject(new Error('avplaystore open failed: ' + (e === null || e === void 0 ? void 0 : e.message)));
        }
        _setupDisplay(p);
        p.setListener(listener);
        p.prepareAsync(() => {
            if (_destroyed)
                return resolve();
            _setupDisplay(p);
            _applyWallRoi(p);
            _durationMs = p.getDuration();
            logger.info(`[WallEngine] A prepared — duration=${_durationMs}ms`);
            resolve();
        }, (err) => {
            var _a;
            logger.error(`[WallEngine] A prepareAsync failed: ${JSON.stringify(err)}`);
            reject(new Error(String((_a = err === null || err === void 0 ? void 0 : err.name) !== null && _a !== void 0 ? _a : err)));
        });
    }
    function _prepareSingle(url, resolve, reject) {
        try {
            const s = _avState();
            if (s === 'PLAYING' || s === 'PAUSED')
                webapis.avplay.stop();
            if (s !== 'NONE')
                webapis.avplay.close();
            webapis.avplay.open(url);
        }
        catch (e) {
            return reject(new Error('AVPlay open failed: ' + (e === null || e === void 0 ? void 0 : e.message)));
        }
        _setupDisplay();
        webapis.avplay.setListener(_makeListenerSingle());
        webapis.avplay.prepareAsync(() => {
            if (_destroyed)
                return resolve();
            _setupDisplay();
            _applyWallRoi();
            _durationMs = webapis.avplay.getDuration();
            logger.info(`[WallEngine] prepared — duration=${_durationMs}ms`);
            resolve();
        }, (err) => {
            var _a;
            logger.error(`[WallEngine] prepareAsync failed: ${JSON.stringify(err)}`);
            reject(new Error(String((_a = err === null || err === void 0 ? void 0 : err.name) !== null && _a !== void 0 ? _a : err)));
        });
    }
    // ── Public API ───────────────────────────────────────────────────────────────
    /**
     * Set the source-region crop for this wall tile. Must be called before
     * initEngine(). Ratios are 0..1 relative to source video dimensions.
     * Survives destroyEngine()/initEngine() cycles.
     */
    function setWallCrop(xRatio, yRatio, wRatio, hRatio) {
        _wallRoi = { xR: xRatio, yR: yRatio, wR: wRatio, hR: hRatio };
        logger.info(`[WallEngine] wall ROI set xR=${xRatio.toFixed(4)} yR=${yRatio.toFixed(4)} ` +
            `wR=${wRatio.toFixed(4)} hR=${hRatio.toFixed(4)}`);
    }
    WallEngine.setWallCrop = setWallCrop;
    /** Register callback invoked when this device has prebuffered at frame 0. */
    function setOnLoop(cb) { _onLoop = cb; }
    WallEngine.setOnLoop = setOnLoop;
    /**
     * Initialise (or re-initialise) the AVPlay engine.
     * Must be called before prepare(). Acquires a single avplaystore slot.
     */
    function initEngine() {
        _destroyed = false;
        _playing = false;
        _durationMs = 0;
        _url = '';
        _looping = false;
        _prebuffered = false;
        clearTimeout(_playTimer);
        _stopDriftLog();
        try {
            if (typeof webapis !== 'undefined' && webapis.avplaystore) {
                if (_playerA) {
                    try {
                        const s = _getState(_playerA);
                        if (s === 'PLAYING' || s === 'PAUSED')
                            _playerA.stop();
                        if (s !== 'NONE')
                            _playerA.close();
                    }
                    catch (_a) { }
                    // Re-use existing slot (avplaystore only has one per app)
                }
                else {
                    _playerA = webapis.avplaystore.getPlayer();
                }
                _useAvplaystore = true;
                logger.info('[WallEngine] avplaystore single-player mode');
            }
            else {
                throw new Error('avplaystore unavailable');
            }
        }
        catch (_b) {
            _playerA = null;
            _useAvplaystore = false;
            logger.info('[WallEngine] webapis.avplay global fallback mode');
            try {
                const s = _avState();
                if (s === 'PLAYING' || s === 'PAUSED')
                    webapis.avplay.stop();
                if (s !== 'NONE')
                    webapis.avplay.close();
            }
            catch (_c) { }
        }
    }
    WallEngine.initEngine = initEngine;
    /**
     * Open and prepareAsync a URL. Resolves when the player reaches READY state
     * (setVideoRoi has already been applied). The caller should then await
     * schedulePlayAt(epochMs) from a GO signal.
     */
    function prepare(url) {
        _url = url;
        _durationMs = 0;
        _playing = false;
        _prebuffered = false;
        _looping = false;
        clearTimeout(_playTimer);
        _stopDriftLog();
        logger.info(`[WallEngine] prepare: ${url.split('/').pop()} avplaystore=${_useAvplaystore}`);
        return new Promise((resolve, reject) => {
            if (_useAvplaystore && _playerA) {
                _openAndPrepare(_playerA, url, _makeListenerA(), resolve, reject);
            }
            else {
                _prepareSingle(url, resolve, reject);
            }
        });
    }
    WallEngine.prepare = prepare;
    /**
     * Schedule play at a local epoch (Date.now()-compatible).
     * Uses a spin-loop for sub-frame precision in the last 60 ms.
     */
    function schedulePlayAt(epochMs) {
        if (_destroyed)
            return;
        clearTimeout(_playTimer);
        const wait = epochMs - Date.now();
        logger.info(`[WallEngine] schedulePlayAt epoch=${epochMs} T-${Math.round(Math.max(0, wait))}ms`);
        if (wait <= 0) {
            _doPlay();
            return;
        }
        _playTimer = setTimeout(() => {
            (function spin() {
                if (_destroyed)
                    return;
                if (Date.now() >= epochMs) {
                    _doPlay();
                    return;
                }
                setTimeout(spin, 4);
            })();
        }, Math.max(0, wait - 60));
    }
    WallEngine.schedulePlayAt = schedulePlayAt;
    /** Legacy alias kept for any direct callers. */
    function playFromPrebuffer() {
        if (_destroyed)
            return;
        if (!_prebuffered)
            logger.warn('[WallEngine] playFromPrebuffer: not prebuffered');
        _doPlay();
    }
    WallEngine.playFromPrebuffer = playFromPrebuffer;
    function getDuration() { return _durationMs; }
    WallEngine.getDuration = getDuration;
    function isPlaying() {
        if (_useAvplaystore && _playerA)
            return _playing && _getState(_playerA) === 'PLAYING';
        return _playing && _avState() === 'PLAYING';
    }
    WallEngine.isPlaying = isPlaying;
    function getCurrentPosMs() {
        if (!_playing)
            return null;
        try {
            if (_useAvplaystore && _playerA)
                return _playerA.getCurrentTime();
            return webapis.avplay.getCurrentTime();
        }
        catch (_a) {
            return null;
        }
    }
    WallEngine.getCurrentPosMs = getCurrentPosMs;
    function isInitialised() {
        return _useAvplaystore ? _playerA !== null : true;
    }
    WallEngine.isInitialised = isInitialised;
    /** Stop and release all resources. setWallCrop values are preserved. */
    function destroyEngine() {
        _destroyed = true;
        _playing = false;
        _prebuffered = false;
        _looping = false;
        clearTimeout(_playTimer);
        _stopDriftLog();
        if (_playerA) {
            try {
                _playerA.setVideoStillMode('false');
            }
            catch (_a) { }
            try {
                const s = _getState(_playerA);
                if (s === 'PLAYING' || s === 'PAUSED')
                    _playerA.stop();
                if (s !== 'NONE')
                    _playerA.close();
                webapis.avplaystore.releasePlayer(_playerA);
            }
            catch (_b) { }
            _playerA = null;
        }
        try {
            const s = _avState();
            if (s === 'PLAYING' || s === 'PAUSED')
                webapis.avplay.stop();
            if (s !== 'NONE')
                webapis.avplay.close();
        }
        catch (_c) { }
        _useAvplaystore = false;
        logger.info('[WallEngine] engine destroyed');
    }
    WallEngine.destroyEngine = destroyEngine;
})(WallEngine || (WallEngine = {})); // namespace WallEngine
