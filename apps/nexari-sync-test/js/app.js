"use strict";
/**
 * app.ts
 * Entry point for the Nexari Sync Test app.
 *
 * Boot sequence:
 *   1. Detect device IP from tizen.systeminfo (or fallback to window.location.hostname)
 *   2. syncTime() — 8-sample NTP against Pi
 *   3. P2PSync.init() — register + start peer discovery
 *   4. Fetch first video URL from Pi /api/v1/content?type=video&limit=1
 *   5. Activate MSE player (default engine) and load the video
 *   6. P2P handles SYNC_PLAY when both peers are READY
 *
 * Remote keys:
 *   CH+ (MediaChannelUp / key code 427) → broadcastSetEngine() toggle MSE↔WASM
 *   RETURN / BACK → exit app
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
// All modules are loaded as globals via <script> tags (module:none TypeScript build)
// TypeScript sees them via import for type checking; runtime uses the global names.
const ntp_client_js_1 = require("./ntp-client.js");
const P2PSync = __importStar(require("./p2p-sync-client.js"));
const player_mse_js_1 = require("./player-mse.js");
const player_wasm_js_1 = require("./player-wasm.js");
const perf_hud_js_1 = require("./perf-hud.js");
const logger_js_1 = require("./logger.js");
// ── Config ────────────────────────────────────────────────────────────────────
const CONFIG = {
    PI_BASE: 'http://192.168.1.17',
    GROUP_ID: 'synctest-001',
};
// ── State ─────────────────────────────────────────────────────────────────────
let _currentEngine = 'mse';
let _videoUrl = '';
let _container;
let _statusEl;
let _bannerEl;
// ── Boot ──────────────────────────────────────────────────────────────────────
window.addEventListener('load', () => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    _container = document.getElementById('video-container');
    _statusEl = document.getElementById('status-msg');
    _bannerEl = document.getElementById('engine-banner');
    (0, perf_hud_js_1.initHud)();
    _setStatus('Detecting device…');
    const selfIp = yield _getSelfIp();
    const deviceId = selfIp.replace(/\./g, '-');
    (0, logger_js_1.initLogger)(CONFIG.PI_BASE, deviceId);
    logger_js_1.logger.info(`[App] boot: ip=${selfIp} deviceId=${deviceId}`);
    _setStatus('Syncing time…');
    yield (0, ntp_client_js_1.syncTime)(CONFIG.PI_BASE).catch(() => logger_js_1.logger.warn('[App] NTP sync failed — using local clock'));
    logger_js_1.logger.info(`[App] NTP offset: ${(0, ntp_client_js_1.getNtpOffset)()}ms`);
    (0, perf_hud_js_1.updateHud)({ ntpOffsetMs: (0, ntp_client_js_1.getNtpOffset)() });
    _setStatus('Connecting to peer…');
    P2PSync.init({
        piBase: CONFIG.PI_BASE,
        deviceId,
        selfIp,
        groupId: CONFIG.GROUP_ID,
        logger: (level, msg) => {
            (0, perf_hud_js_1.updateHud)({ connectionState: level === 'error' ? 'error' : (P2PSync.getRole() === 'pending' ? 'connecting' : 'connected') });
            logger_js_1.logger[level](msg);
        },
    });
    P2PSync.onVideoUrl((msg) => {
        _videoUrl = msg.url;
        logger_js_1.logger.info(`[App] VIDEO_URL from leader: ${_videoUrl}`);
        _activateEngine(_currentEngine, _videoUrl);
    });
    P2PSync.onSetEngine((msg) => {
        logger_js_1.logger.info(`[App] SET_ENGINE: ${msg.engineMode}`);
        _switchEngine(msg.engineMode);
    });
    // Register remote key handler
    try {
        (_b = (_a = window.tizen) === null || _a === void 0 ? void 0 : _a.tvinputdevice) === null || _b === void 0 ? void 0 : _b.registerKey('ChannelUp');
    }
    catch (_c) { }
    document.addEventListener('keydown', _onKey);
    _setStatus('Fetching video…');
    _videoUrl = yield _fetchVideoUrl();
    logger_js_1.logger.info(`[App] video URL: ${_videoUrl}`);
    // Wait briefly for P2P role to be determined (peer poll up to ~4s)
    yield _waitForRole(8000);
    (0, perf_hud_js_1.updateHud)({ role: P2PSync.getRole(), engineMode: _currentEngine });
    _setBanner(_currentEngine);
    if (P2PSync.getRole() === 'leader') {
        logger_js_1.logger.info('[App] leader: sending VIDEO_URL to follower');
        // Leader pushes VIDEO_URL to follower via DataChannel (handled in p2p-sync-client internally)
        // For now, leader also activates its own player directly
        _activateEngine(_currentEngine, _videoUrl);
    }
    else {
        _setStatus('Follower — waiting for VIDEO_URL…');
        // Follower activates engine when VIDEO_URL arrives (onVideoUrl above)
        // Fallback: if we already have a URL and no DC yet, start directly after 5s
        setTimeout(() => {
            if (_videoUrl && !_container.querySelector('video, canvas')) {
                logger_js_1.logger.warn('[App] follower fallback: starting engine without leader sync');
                _activateEngine(_currentEngine, _videoUrl);
            }
        }, 5000);
    }
}));
// ── Engine management ─────────────────────────────────────────────────────────
function _activateEngine(engine, url) {
    _hideStatus();
    if (engine === 'mse') {
        (0, player_mse_js_1.initMsePlayer)(_container);
        (0, player_mse_js_1.loadVideo)(url).catch((e) => logger_js_1.logger.error(`[App] MSE load failed: ${e === null || e === void 0 ? void 0 : e.message}`));
    }
    else {
        (0, player_wasm_js_1.initWasmPlayer)(_container);
        (0, player_wasm_js_1.loadVideo)(url).catch((e) => logger_js_1.logger.error(`[App] WASM load failed: ${e === null || e === void 0 ? void 0 : e.message}`));
    }
    (0, logger_js_1.setLoggerEngine)(engine);
    (0, perf_hud_js_1.updateHud)({ engineMode: engine });
    _setBanner(engine);
}
function _switchEngine(newEngine) {
    if (newEngine === _currentEngine)
        return;
    logger_js_1.logger.info(`[App] switching engine: ${_currentEngine} → ${newEngine}`);
    _currentEngine = newEngine;
    // Teardown both (only one is active but tear both for safety)
    (0, player_mse_js_1.teardown)();
    (0, player_wasm_js_1.teardown)();
    _activateEngine(newEngine, _videoUrl);
}
// ── Remote key handler ────────────────────────────────────────────────────────
function _onKey(e) {
    var _a, _b, _c;
    // CH+ key codes: 427 (Tizen), 33 (PageUp) for dev browser
    const CH_PLUS = [427, 33];
    if (CH_PLUS.includes(e.keyCode)) {
        if (P2PSync.getRole() === 'leader') {
            const next = _currentEngine === 'mse' ? 'wasm' : 'mse';
            logger_js_1.logger.info(`[App] CH+ key → broadcastSetEngine(${next})`);
            P2PSync.broadcastSetEngine(next);
            _currentEngine = next;
        }
        else {
            logger_js_1.logger.info('[App] CH+ key ignored — follower cannot initiate engine switch');
        }
    }
    if (e.keyCode === 10009 || e.keyCode === 8) { // RETURN / BACK
        try {
            (_c = (_b = (_a = window.tizen) === null || _a === void 0 ? void 0 : _a.application) === null || _b === void 0 ? void 0 : _b.getCurrentApplication()) === null || _c === void 0 ? void 0 : _c.exit();
        }
        catch (_d) { }
    }
}
// ── Helpers ───────────────────────────────────────────────────────────────────
function _getSelfIp() {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        try {
            const sysinfo = (_a = window.tizen) === null || _a === void 0 ? void 0 : _a.systeminfo;
            if (sysinfo) {
                return yield new Promise((resolve, reject) => {
                    sysinfo.getPropertyValue('NETWORK', (net) => {
                        var _a;
                        resolve((_a = net === null || net === void 0 ? void 0 : net.ipAddress) !== null && _a !== void 0 ? _a : '0.0.0.0');
                    }, reject);
                });
            }
        }
        catch (_b) { }
        // Fallback for dev browser
        return window.location.hostname || '127.0.0.1';
    });
}
function _fetchVideoUrl() {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        try {
            const res = yield fetch(`${CONFIG.PI_BASE}/api/v1/content?type=video&limit=1`);
            const data = yield res.json();
            const item = (_b = (_a = data === null || data === void 0 ? void 0 : data.items) === null || _a === void 0 ? void 0 : _a[0]) !== null && _b !== void 0 ? _b : data === null || data === void 0 ? void 0 : data[0];
            if (item === null || item === void 0 ? void 0 : item.url)
                return item.url;
            if (item === null || item === void 0 ? void 0 : item.filePath)
                return `${CONFIG.PI_BASE}/uploads/${item.filePath}`;
        }
        catch (e) {
            logger_js_1.logger.error(`[App] fetchVideoUrl failed: ${e === null || e === void 0 ? void 0 : e.message}`);
        }
        return '';
    });
}
function _waitForRole(timeoutMs) {
    return __awaiter(this, void 0, void 0, function* () {
        const deadline = Date.now() + timeoutMs;
        while (P2PSync.getRole() === 'pending' && Date.now() < deadline) {
            yield new Promise((r) => setTimeout(r, 200));
        }
    });
}
function _setStatus(msg) {
    if (_statusEl) {
        _statusEl.textContent = msg;
        _statusEl.style.display = '';
    }
}
function _hideStatus() {
    if (_statusEl)
        _statusEl.style.display = 'none';
}
function _setBanner(engine) {
    if (_bannerEl)
        _bannerEl.textContent = engine.toUpperCase();
}
