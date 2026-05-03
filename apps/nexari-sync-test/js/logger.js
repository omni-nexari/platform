"use strict";
/**
 * logger.ts
 * Wraps console.log and posts entries to the Pi test-sync /log endpoint.
 * Every entry includes engineMode and driftMs so the DS page can parse metrics.
 */
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
exports.logger = void 0;
exports.initLogger = initLogger;
exports.setLoggerEngine = setLoggerEngine;
exports.setLoggerNtpOffset = setLoggerNtpOffset;
let _piBase = '';
let _deviceId = '';
let _engineMode = 'mse';
let _ntpOffset = 0;
let _queue = [];
let _flushing = false;
const BATCH_SIZE = 20;
const FLUSH_INTERVAL_MS = 2000;
function initLogger(piBase, deviceId) {
    _piBase = piBase;
    _deviceId = deviceId;
    setInterval(_flush, FLUSH_INTERVAL_MS);
}
function setLoggerEngine(mode) { _engineMode = mode; }
function setLoggerNtpOffset(ms) { _ntpOffset = ms; }
function _push(level, msg, extra) {
    const entry = Object.assign({ deviceId: _deviceId, level,
        msg, ts: Date.now(), engineMode: _engineMode, ntpOffsetMs: _ntpOffset }, ((extra === null || extra === void 0 ? void 0 : extra.driftMs) !== undefined ? { driftMs: extra.driftMs } : {}));
    console[level](`[${level.toUpperCase()}] ${msg}`);
    if (_piBase)
        _queue.push(entry);
}
exports.logger = {
    debug: (msg) => _push('debug', msg),
    info: (msg) => _push('info', msg),
    warn: (msg) => _push('warn', msg),
    error: (msg) => _push('error', msg),
    drift: (msg, driftMs) => _push('info', msg, { driftMs }),
};
function _flush() {
    return __awaiter(this, void 0, void 0, function* () {
        if (_flushing || !_queue.length || !_piBase)
            return;
        _flushing = true;
        const batch = _queue.splice(0, BATCH_SIZE);
        try {
            for (const entry of batch) {
                yield fetch(`${_piBase}/api/v1/test-sync/log`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(entry),
                });
            }
        }
        catch ( /* silent — log delivery is best-effort */_a) { /* silent — log delivery is best-effort */ }
        finally {
            _flushing = false;
        }
    });
}
