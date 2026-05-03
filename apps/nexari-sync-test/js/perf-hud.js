"use strict";
/**
 * perf-hud.ts
 * On-screen overlay showing sync and playback metrics.
 * Updates at ~4 Hz via setInterval.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.initHud = initHud;
exports.updateHud = updateHud;
let _el = null;
let _state = {
    role: 'pending',
    engineMode: 'mse',
    ntpOffsetMs: 0,
    positionMs: 0,
    expectedMs: 0,
    driftMs: 0,
    lastAction: '—',
    decodePercent: null,
    connectionState: 'connecting',
};
function initHud() {
    _el = document.getElementById('perf-hud');
    if (!_el) {
        _el = document.createElement('div');
        _el.id = 'perf-hud';
        _el.style.cssText = [
            'position:fixed', 'top:0', 'left:0', 'right:0',
            'background:rgba(0,0,0,0.72)', 'color:#0f0',
            'font:13px/1.6 monospace', 'padding:8px 14px',
            'z-index:9999', 'pointer-events:none',
            'white-space:pre',
        ].join(';');
        document.body.appendChild(_el);
    }
    setInterval(_render, 250);
}
function updateHud(partial) {
    Object.assign(_state, partial);
}
function _fmt(ms) { return `${(ms / 1000).toFixed(3)}s`; }
function _driftColor(ms) {
    const abs = Math.abs(ms);
    if (abs > 50)
        return '\x1b[31m'; // red in terminal; for DOM we use inline style trick
    if (abs > 20)
        return '\x1b[33m';
    return '';
}
function _render() {
    if (!_el)
        return;
    const s = _state;
    const absDrift = Math.abs(s.driftMs);
    const driftColor = absDrift > 50 ? '#f44' : absDrift > 20 ? '#fa0' : '#0f0';
    const decodeStr = s.decodePercent !== null
        ? `<span style="color:#4af">Decoding… ${s.decodePercent}%</span>  `
        : '';
    _el.innerHTML = [
        `<span style="color:#8df">ENGINE</span> <b>${s.engineMode.toUpperCase()}</b>  ` +
            `<span style="color:#8df">ROLE</span> <b>${s.role}</b>  ` +
            `<span style="color:#8df">P2P</span> ${s.connectionState}  ` +
            `<span style="color:#8df">NTP</span> ${s.ntpOffsetMs > 0 ? '+' : ''}${s.ntpOffsetMs}ms`,
        `<span style="color:#8df">POS</span>  ${_fmt(s.positionMs)}  ` +
            `<span style="color:#8df">EXP</span>  ${_fmt(s.expectedMs)}  ` +
            `<span style="color:#8df">DRIFT</span> ` +
            `<span style="color:${driftColor}">${s.driftMs > 0 ? '+' : ''}${Math.round(s.driftMs)}ms</span>  ` +
            `<span style="color:#8df">LAST</span> ${s.lastAction}`,
        decodeStr,
    ].filter(Boolean).join('\n');
}
