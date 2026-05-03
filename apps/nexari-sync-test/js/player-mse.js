"use strict";
/**
 * player-mse.ts
 * MSE (Media Source Extensions) video engine.
 *
 * Pipeline:
 *   fetch(videoUrl) → ReadableStream → MediaSource + SourceBuffer (1 MB chunks)
 *   video.oncanplay → signals READY to P2P sync client
 *   syncClient.onSyncPlay → schedules video.play() at wall-clock syncedStartMs
 *   requestVideoFrameCallback (with polyfill) → reports accurate currentTimeMs
 *   video.playbackRate nudge for drift correction (HTML5 supports smooth rates)
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initMsePlayer = initMsePlayer;
exports.loadVideo = loadVideo;
exports.teardown = teardown;
const ntp_client_js_1 = require("./ntp-client.js");
const P2PSync = __importStar(require("./p2p-sync-client.js"));
const perf_hud_js_1 = require("./perf-hud.js");
const logger_js_1 = require("./logger.js");
const CHUNK_SIZE = 1 * 1024 * 1024; // 1 MB append chunks
let _video = null;
let _ms = null;
let _sb = null;
let _syncedStartMs = -1;
let _startScheduled = false;
let _itemIndex = 0;
let _stateTickTimer = null;
let _rVfcSupported = false;
let _syncWatchdog = null;
// ── Public API ────────────────────────────────────────────────────────────────
/** Mount the MSE player into the given container. */
function initMsePlayer(container) {
    _teardown();
    _video = document.createElement('video');
    _video.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;background:#000;';
    _video.muted = false;
    _video.volume = 1;
    _video.playsInline = true;
    container.appendChild(_video);
    // Check for requestVideoFrameCallback support
    _rVfcSupported = typeof _video.requestVideoFrameCallback === 'function';
    logger_js_1.logger.info(`[MSE] rVFC supported: ${_rVfcSupported}`);
    P2PSync.onSyncPlay(_handleSyncPlay);
    P2PSync.onAdjust(_handleAdjust);
    _startStateTickTimer();
}
/**
 * Load a video URL via MSE streaming. Calls P2PSync.setVideoReady() once
 * the video has enough data to play (oncanplay).
 */
function loadVideo(url_1) {
    return __awaiter(this, arguments, void 0, function* (url, itemIndex = 0) {
        var _a, _b;
        if (!_video)
            return;
        _itemIndex = itemIndex;
        _syncedStartMs = -1;
        _startScheduled = false;
        logger_js_1.logger.info(`[MSE] loading: ${url}`);
        (0, perf_hud_js_1.updateHud)({ positionMs: 0, expectedMs: 0, driftMs: 0, lastAction: 'Buffering…' });
        try {
            _ms = new MediaSource();
            _video.src = URL.createObjectURL(_ms);
            yield new Promise((resolve) => {
                _ms.addEventListener('sourceopen', () => resolve(), { once: true });
            });
            // Detect MIME type from URL extension
            const ext = (_b = (_a = url.split('.').pop()) === null || _a === void 0 ? void 0 : _a.toLowerCase()) !== null && _b !== void 0 ? _b : 'mp4';
            const mime = ext === 'webm' ? 'video/webm; codecs="vp9"' : 'video/mp4; codecs="avc1.42E01E, mp4a.40.2"';
            if (!MediaSource.isTypeSupported(mime)) {
                throw new Error(`MSE: MIME not supported: ${mime}`);
            }
            _sb = _ms.addSourceBuffer(mime);
            // Stream-fetch and append in chunks
            const resp = yield fetch(url);
            if (!resp.ok)
                throw new Error(`fetch ${url} → ${resp.status}`);
            const reader = resp.body.getReader();
            yield _streamAppend(reader);
            _ms.endOfStream();
            logger_js_1.logger.info('[MSE] source buffer complete');
        }
        catch (e) {
            logger_js_1.logger.error(`[MSE] load failed: ${e === null || e === void 0 ? void 0 : e.message}`);
            throw e;
        }
        // Wait for canplay
        yield new Promise((resolve) => {
            if (!_video)
                return resolve();
            if (_video.readyState >= 3) {
                resolve();
                return;
            }
            _video.addEventListener('canplay', () => resolve(), { once: true });
        });
        logger_js_1.logger.info('[MSE] canplay — signalling READY');
        (0, perf_hud_js_1.updateHud)({ lastAction: 'Ready — waiting for SYNC_PLAY' });
        P2PSync.setVideoReady(_itemIndex, 'mse');
        // Pause until SYNC_PLAY arrives; watchdog unpauses after 8s
        _video.pause();
        _syncWatchdog = setTimeout(() => {
            if (_video === null || _video === void 0 ? void 0 : _video.paused) {
                logger_js_1.logger.warn('[MSE] watchdog: no SYNC_PLAY after 8s — playing unsynced');
                _video.play().catch(() => { });
            }
        }, 8000);
        // If leader and SYNC_PLAY already scheduled before canplay, apply now
        if (_syncedStartMs > 0)
            _schedulePlay();
        if (_rVfcSupported)
            _registerRVFC();
    });
}
function teardown() { _teardown(); }
// ── Sync handlers ─────────────────────────────────────────────────────────────
function _handleSyncPlay(msg) {
    clearTimeout(_syncWatchdog);
    _syncedStartMs = msg.syncedStartMs;
    logger_js_1.logger.info(`[MSE] SYNC_PLAY received: startMs=${msg.syncedStartMs} (in ${msg.syncedStartMs - (0, ntp_client_js_1.getSyncedTime)()}ms)`);
    if (_video && _video.readyState >= 3)
        _schedulePlay();
}
function _schedulePlay() {
    if (_startScheduled || !_video)
        return;
    _startScheduled = true;
    const wait = _syncedStartMs - (0, ntp_client_js_1.getSyncedTime)();
    if (wait <= 0) {
        logger_js_1.logger.warn('[MSE] SYNC_PLAY cue already past — playing immediately');
        _video.play().catch((e) => logger_js_1.logger.error(`[MSE] play failed: ${e === null || e === void 0 ? void 0 : e.message}`));
        return;
    }
    logger_js_1.logger.info(`[MSE] scheduling play in ${Math.round(wait)}ms`);
    // Poll at ~4ms intervals for the final 50ms for sub-frame precision
    const COARSE_THRESHOLD = 50;
    const coarseWait = Math.max(0, wait - COARSE_THRESHOLD);
    setTimeout(() => {
        // Fine-grain busy-wait for remaining ms
        const target = _syncedStartMs;
        function tryPlay() {
            if ((0, ntp_client_js_1.getSyncedTime)() >= target) {
                _video === null || _video === void 0 ? void 0 : _video.play().catch((e) => logger_js_1.logger.error(`[MSE] play() failed: ${e === null || e === void 0 ? void 0 : e.message}`));
                (0, perf_hud_js_1.updateHud)({ lastAction: 'play() fired' });
            }
            else {
                setTimeout(tryPlay, 4);
            }
        }
        tryPlay();
    }, coarseWait);
}
function _handleAdjust(msg) {
    if (!_video)
        return;
    (0, perf_hud_js_1.updateHud)({ driftMs: msg.driftMs, lastAction: `${msg.action} ${Math.round(msg.driftMs)}ms` });
    if (msg.action === 'snap' && msg.targetMs !== undefined) {
        _video.currentTime = msg.targetMs / 1000;
        _video.playbackRate = 1.0;
        logger_js_1.logger.drift(`[MSE] snap to ${msg.targetMs}ms`, msg.driftMs);
    }
    else if (msg.action === 'nudge' && msg.driftRate !== undefined) {
        _video.playbackRate = msg.driftRate;
        logger_js_1.logger.drift(`[MSE] nudge rate=${msg.driftRate}`, msg.driftMs);
        // Restore rate after 5s
        setTimeout(() => { if (_video)
            _video.playbackRate = 1.0; }, 5000);
    }
}
// ── rVFC / position reporting ─────────────────────────────────────────────────
function _registerRVFC() {
    if (!_video || !_rVfcSupported)
        return;
    _video.requestVideoFrameCallback(_onFrame);
}
function _onFrame(_now, meta) {
    if (!_video)
        return;
    const posMs = meta.mediaTime * 1000;
    const syncNow = (0, ntp_client_js_1.getSyncedTime)();
    const elapsed = syncNow - _syncedStartMs;
    const expectedMs = _syncedStartMs > 0 && elapsed > 0 ? elapsed : posMs;
    const driftMs = posMs - expectedMs;
    P2PSync.setPlaybackState(_itemIndex, posMs, 'mse');
    (0, perf_hud_js_1.updateHud)({ positionMs: posMs, expectedMs, driftMs });
    _registerRVFC(); // re-register for next frame
}
// ── State tick (polyfill path for Tizen 4/5 without rVFC) ─────────────────────
function _startStateTickTimer() {
    if (_rVfcSupported)
        return; // rVFC handles it
    _stateTickTimer = setInterval(() => {
        if (!_video)
            return;
        const posMs = _video.currentTime * 1000;
        const syncNow = (0, ntp_client_js_1.getSyncedTime)();
        const elapsed = syncNow - _syncedStartMs;
        const expectedMs = _syncedStartMs > 0 && elapsed > 0 ? elapsed : posMs;
        const driftMs = posMs - expectedMs;
        P2PSync.setPlaybackState(_itemIndex, posMs, 'mse');
        (0, perf_hud_js_1.updateHud)({ positionMs: posMs, expectedMs, driftMs });
    }, 50);
}
// ── Streaming append helper ───────────────────────────────────────────────────
function _streamAppend(reader) {
    return __awaiter(this, void 0, void 0, function* () {
        let buf = new Uint8Array(0);
        while (true) {
            const { done, value } = yield reader.read();
            if (done) {
                if (buf.length > 0)
                    yield _appendChunk(buf);
                break;
            }
            // Accumulate into buf
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
    return __awaiter(this, void 0, void 0, function* () {
        if (!_sb)
            return;
        if (_sb.updating) {
            yield new Promise((r) => _sb.addEventListener('updateend', () => r(), { once: true }));
        }
        const ab = chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength);
        _sb.appendBuffer(ab);
        yield new Promise((r) => _sb.addEventListener('updateend', () => r(), { once: true }));
    });
}
// ── Teardown ──────────────────────────────────────────────────────────────────
function _teardown() {
    clearInterval(_stateTickTimer);
    clearTimeout(_syncWatchdog);
    if (_video) {
        _video.pause();
        _video.src = '';
        _video.remove();
        _video = null;
    }
    if (_ms && _ms.readyState === 'open') {
        try {
            _ms.endOfStream();
        }
        catch (_a) { }
    }
    _ms = null;
    _sb = null;
    _startScheduled = false;
    _syncedStartMs = -1;
}
