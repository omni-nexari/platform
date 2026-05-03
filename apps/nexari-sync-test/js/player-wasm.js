"use strict";
/**
 * player-wasm.ts
 * WASM/ffmpeg canvas player.
 *
 * Pipeline:
 *   decodeVideo(url) → ImageData[] frame buffer (all pre-decoded before READY)
 *   SYNC_PLAY → rAF loop renders frames at:
 *     frameIdx = floor((getSyncedTime() - syncedStartMs) / frameDurationMs)
 *   Skips frames if behind, holds if ahead.
 *   Reports currentTimeMs = frameIdx * frameDurationMs for heartbeat.
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
exports.initWasmPlayer = initWasmPlayer;
exports.loadVideo = loadVideo;
exports.teardown = teardown;
const ntp_client_js_1 = require("./ntp-client.js");
const P2PSync = __importStar(require("./p2p-sync-client.js"));
const decoder_ffmpeg_js_1 = require("./decoder-ffmpeg.js");
const perf_hud_js_1 = require("./perf-hud.js");
const logger_js_1 = require("./logger.js");
let _canvas = null;
let _ctx = null;
let _decoded = null;
let _syncedStartMs = -1;
let _rafHandle = 0;
let _itemIndex = 0;
let _snapOffset = 0; // additional ms offset applied by snap corrections
let _syncWatchdog = null;
// ── Public API ────────────────────────────────────────────────────────────────
/** Mount the WASM canvas player into the given container. */
function initWasmPlayer(container) {
    _teardown();
    _canvas = document.createElement('canvas');
    _canvas.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;background:#000;';
    container.appendChild(_canvas);
    _ctx = _canvas.getContext('2d');
    P2PSync.onSyncPlay(_handleSyncPlay);
    P2PSync.onAdjust(_handleAdjust);
}
/**
 * Fetch and fully decode the video before signalling READY.
 * Heavy: all frames are decoded to RAM.
 */
function loadVideo(url_1) {
    return __awaiter(this, arguments, void 0, function* (url, itemIndex = 0) {
        if (!_canvas || !_ctx)
            return;
        _itemIndex = itemIndex;
        _syncedStartMs = -1;
        _snapOffset = 0;
        (0, perf_hud_js_1.updateHud)({ lastAction: 'Decoding…', decodePercent: 0 });
        try {
            _decoded = yield (0, decoder_ffmpeg_js_1.decodeVideo)(url);
        }
        catch (e) {
            logger_js_1.logger.error(`[WASM] decode failed: ${e === null || e === void 0 ? void 0 : e.message}`);
            throw e;
        }
        // Size the canvas to decoded frame dimensions
        _canvas.width = _decoded.width;
        _canvas.height = _decoded.height;
        logger_js_1.logger.info('[WASM] decode complete — signalling READY');
        (0, perf_hud_js_1.updateHud)({ lastAction: 'Ready — waiting for SYNC_PLAY', decodePercent: null });
        P2PSync.setVideoReady(_itemIndex, 'wasm');
        // Watchdog: start playback unsynced if no SYNC_PLAY arrives in 10s
        _syncWatchdog = setTimeout(() => {
            if (_syncedStartMs < 0) {
                logger_js_1.logger.warn('[WASM] watchdog: no SYNC_PLAY after 10s — playing unsynced');
                _syncedStartMs = (0, ntp_client_js_1.getSyncedTime)();
                _startRaf();
            }
        }, 10000);
    });
}
function teardown() { _teardown(); }
// ── Sync handlers ─────────────────────────────────────────────────────────────
function _handleSyncPlay(msg) {
    clearTimeout(_syncWatchdog);
    _syncedStartMs = msg.syncedStartMs;
    const wait = _syncedStartMs - (0, ntp_client_js_1.getSyncedTime)();
    logger_js_1.logger.info(`[WASM] SYNC_PLAY received: startMs=${msg.syncedStartMs} (in ${Math.round(wait)}ms)`);
    (0, perf_hud_js_1.updateHud)({ lastAction: `SYNC_PLAY in ${Math.round(wait)}ms` });
    if (!_decoded) {
        logger_js_1.logger.warn('[WASM] SYNC_PLAY arrived before decode — storing cue');
        return; // rAF will start once decode completes and loadVideo checks _syncedStartMs
    }
    if (wait <= 0) {
        logger_js_1.logger.warn('[WASM] SYNC_PLAY cue already past — starting immediately');
        _startRaf();
        return;
    }
    // Coarse wait, then fine-grain busy-wait
    const COARSE_THRESHOLD = 50;
    const coarseWait = Math.max(0, wait - COARSE_THRESHOLD);
    setTimeout(() => {
        const target = _syncedStartMs;
        function tryStart() {
            if ((0, ntp_client_js_1.getSyncedTime)() >= target) {
                (0, perf_hud_js_1.updateHud)({ lastAction: 'rAF started' });
                _startRaf();
            }
            else {
                setTimeout(tryStart, 4);
            }
        }
        tryStart();
    }, coarseWait);
}
function _handleAdjust(msg) {
    (0, perf_hud_js_1.updateHud)({ driftMs: msg.driftMs, lastAction: `${msg.action} ${Math.round(msg.driftMs)}ms` });
    if (msg.action === 'snap' && msg.targetMs !== undefined) {
        // Apply offset so rAF loop treats targetMs as current position
        _snapOffset = msg.targetMs - _getCurrentPositionMs();
        logger_js_1.logger.drift(`[WASM] snap offset=${Math.round(_snapOffset)}ms`, msg.driftMs);
    }
    // WASM can't nudge playbackRate (we control the frame schedule directly via getSyncedTime)
    // For nudge: temporarily shift _syncedStartMs by a small amount
    if (msg.action === 'nudge' && msg.driftRate !== undefined) {
        // driftRate > 1 means we're behind → shift start earlier
        const shiftMs = (msg.driftRate - 1.0) * 1000; // proportional shift
        _syncedStartMs -= shiftMs;
        logger_js_1.logger.drift(`[WASM] nudge: shifted syncedStartMs by ${Math.round(-shiftMs)}ms`, msg.driftMs);
    }
}
// ── rAF render loop ───────────────────────────────────────────────────────────
function _startRaf() {
    if (_rafHandle)
        cancelAnimationFrame(_rafHandle);
    _rafHandle = requestAnimationFrame(_rafTick);
}
function _rafTick() {
    if (!_decoded || !_ctx || !_canvas)
        return;
    const frames = _decoded.frames;
    const frameDurationMs = 1000 / _decoded.fps;
    const totalFrames = frames.length;
    const elapsed = (0, ntp_client_js_1.getSyncedTime)() - _syncedStartMs + _snapOffset;
    let frameIdx = Math.floor(elapsed / frameDurationMs);
    // Loop
    frameIdx = ((frameIdx % totalFrames) + totalFrames) % totalFrames;
    const posMs = frameIdx * frameDurationMs;
    const expectedMs = elapsed > 0 ? elapsed % (_decoded.durationMs) : 0;
    const driftMs = posMs - expectedMs;
    P2PSync.setPlaybackState(_itemIndex, posMs, 'wasm');
    (0, perf_hud_js_1.updateHud)({ positionMs: posMs, expectedMs, driftMs });
    _ctx.putImageData(frames[frameIdx], 0, 0);
    _rafHandle = requestAnimationFrame(_rafTick);
}
function _getCurrentPositionMs() {
    if (!_decoded || _syncedStartMs < 0)
        return 0;
    const frameDurationMs = 1000 / _decoded.fps;
    const elapsed = (0, ntp_client_js_1.getSyncedTime)() - _syncedStartMs + _snapOffset;
    const frameIdx = Math.floor(elapsed / frameDurationMs);
    return frameIdx * frameDurationMs;
}
// ── Teardown ──────────────────────────────────────────────────────────────────
function _teardown() {
    if (_rafHandle) {
        cancelAnimationFrame(_rafHandle);
        _rafHandle = 0;
    }
    clearTimeout(_syncWatchdog);
    if (_canvas) {
        _canvas.remove();
        _canvas = null;
    }
    _ctx = null;
    _decoded = null;
    _syncedStartMs = -1;
    _snapOffset = 0;
}
