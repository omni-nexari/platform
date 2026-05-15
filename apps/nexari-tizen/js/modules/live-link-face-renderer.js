/**
 * live-link-face-renderer.ts — Epic Live Link Face content renderer
 *
 * Renders a real-time avatar driven by ARKit blendshapes streamed from the
 * Epic Games "Live Link Face" iOS app via UDP → Node.js relay → WebSocket.
 *
 * Flow:
 *   iOS app  ──UDP──►  logic.js (port set in metadata, default 11111)
 *                          │
 *                    POST /live-link-face/start
 *                          │
 *                     UDP socket parses binary packet → JSON
 *                          │
 *              WS broadcast to groupId '__llf__' on ws://localhost:9616
 *                          │
 *   This module ◄──WS──────┘
 *      │
 *   Drives CSS/SVG avatar in #content-container
 *
 * Public API (namespace, mirrors DataSyncRenderer pattern):
 *   LiveLinkFaceRenderer.start(container, content)
 *   LiveLinkFaceRenderer.stop()
 */
var LiveLinkFaceRenderer;
(function (LiveLinkFaceRenderer) {
    // ── Types ─────────────────────────────────────────────────────────────────
    // ── Private state ─────────────────────────────────────────────────────────
    let _ws = null;
    let _container = null;
    let _meta = { udpPort: 11111, avatarPreset: 'face' };
    let _active = false;
    let _reconnectTimer = null;
    let _reconnectAttempts = 0;
    const MAX_RECONNECTS = 10;
    // ── Public API ────────────────────────────────────────────────────────────
    function start(container, content) {
        stop(); // clean up any prior session
        _container = container;
        _active = true;
        try {
            const raw = (content === null || content === void 0 ? void 0 : content.metadata) ? JSON.parse(content.metadata) : {};
            _meta = {
                udpPort: Number(raw.udpPort) || 11111,
                avatarPreset: String(raw.avatarPreset || 'face'),
                sourceIp: raw.sourceIp || undefined,
            };
        }
        catch (_) {
            _meta = { udpPort: 11111, avatarPreset: 'face' };
        }
        llfLog(`start — preset=${_meta.avatarPreset} udpPort=${_meta.udpPort}`);
        _buildAvatarDOM(container, _meta.avatarPreset);
        _showStatus('Connecting…');
        // Ask the Node.js sidecar to open the UDP socket
        _startRelay(_meta.udpPort);
        // Connect to the WS relay on the existing sync-relay server
        _connectWs();
    }
    LiveLinkFaceRenderer.start = start;
    function stop() {
        _active = false;
        _cancelReconnect();
        if (_ws) {
            _ws.onclose = null;
            _ws.onerror = null;
            _ws.onmessage = null;
            try {
                _ws.close(1000, 'stop');
            }
            catch (_) { }
            _ws = null;
        }
        // Ask relay to close the UDP socket
        _stopRelay();
        _container = null;
        llfLog('stopped');
    }
    LiveLinkFaceRenderer.stop = stop;
    // ── Relay control (HTTP to Node sidecar) ──────────────────────────────────
    function _startRelay(port) {
        const url = 'http://127.0.0.1:9616/live-link-face/start';
        fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ port }),
        }).then((r) => {
            if (r.ok) {
                llfLog(`relay started on UDP port ${port}`);
            }
            else {
                llfLog(`relay start failed: HTTP ${r.status}`);
            }
        }).catch((e) => {
            var _a;
            llfLog(`relay start error: ${(_a = e === null || e === void 0 ? void 0 : e.message) !== null && _a !== void 0 ? _a : e}`);
        });
    }
    function _stopRelay() {
        fetch('http://127.0.0.1:9616/live-link-face/stop', { method: 'POST' })
            .catch(() => { });
    }
    // ── WebSocket connection ──────────────────────────────────────────────────
    function _connectWs() {
        var _a;
        if (!_active)
            return;
        _cancelReconnect();
        try {
            const ws = new WebSocket('ws://127.0.0.1:9616');
            _ws = ws;
            ws.onopen = () => {
                llfLog('WS connected — joining __llf__ group');
                _reconnectAttempts = 0;
                ws.send(JSON.stringify({
                    type: 'WS_REGISTER',
                    deviceId: 'llf-renderer',
                    groupId: '__llf__',
                }));
                _showStatus('Waiting for Live Link Face stream…');
            };
            ws.onmessage = (ev) => {
                try {
                    const msg = JSON.parse(ev.data);
                    if (msg.type === 'LLF_FRAME' && msg.data) {
                        _applyFrame(msg.data);
                    }
                }
                catch (_) { }
            };
            ws.onclose = () => {
                if (!_active)
                    return;
                llfLog('WS closed — scheduling reconnect');
                _showStatus('Reconnecting…');
                _scheduleReconnect();
            };
            ws.onerror = () => {
                llfLog('WS error');
            };
        }
        catch (e) {
            llfLog(`WS connect failed: ${(_a = e === null || e === void 0 ? void 0 : e.message) !== null && _a !== void 0 ? _a : e}`);
            _scheduleReconnect();
        }
    }
    function _scheduleReconnect() {
        if (!_active || _reconnectAttempts >= MAX_RECONNECTS)
            return;
        _reconnectAttempts += 1;
        const delay = Math.min(2000 * _reconnectAttempts, 15000);
        _reconnectTimer = window.setTimeout(_connectWs, delay);
    }
    function _cancelReconnect() {
        if (_reconnectTimer !== null) {
            clearTimeout(_reconnectTimer);
            _reconnectTimer = null;
        }
    }
    // ── DOM helpers ───────────────────────────────────────────────────────────
    function _showStatus(msg) {
        const el = _container === null || _container === void 0 ? void 0 : _container.querySelector('.llf-status');
        if (el)
            el.textContent = msg;
    }
    function _buildAvatarDOM(container, preset) {
        container.innerHTML = '';
        container.style.cssText = 'position:relative;width:100%;height:100%;background:#000;display:flex;align-items:center;justify-content:center;overflow:hidden;';
        if (preset === 'minimal') {
            _buildMinimalAvatar(container);
        }
        else if (preset === 'emoji') {
            _buildEmojiAvatar(container);
        }
        else {
            _buildFaceAvatar(container);
        }
        // Status overlay (top-right)
        const status = document.createElement('div');
        status.className = 'llf-status';
        status.style.cssText = 'position:absolute;top:16px;right:20px;font:12px/1 monospace;color:rgba(255,255,255,0.5);pointer-events:none;';
        status.textContent = '';
        container.appendChild(status);
    }
    // ── Preset: face (SVG-based CSS face) ──────────────────────────────────────
    function _buildFaceAvatar(container) {
        container.innerHTML += `
      <div class="llf-face" style="position:relative;width:320px;height:400px;">
        <!-- Head silhouette -->
        <div class="llf-head" style="position:absolute;inset:0;border-radius:50% 50% 45% 45%;background:#f5c5a3;box-shadow:0 0 60px rgba(255,200,150,0.3);"></div>
        <!-- Left eye -->
        <div class="llf-eye llf-eye-l" style="position:absolute;top:140px;left:80px;width:56px;height:40px;background:#222;border-radius:50%;overflow:hidden;transition:transform 0.05s;">
          <div class="llf-iris llf-iris-l" style="position:absolute;inset:4px;border-radius:50%;background:radial-gradient(circle at 40% 40%,#5b8;#125);"></div>
        </div>
        <!-- Right eye -->
        <div class="llf-eye llf-eye-r" style="position:absolute;top:140px;right:80px;width:56px;height:40px;background:#222;border-radius:50%;overflow:hidden;transition:transform 0.05s;">
          <div class="llf-iris llf-iris-r" style="position:absolute;inset:4px;border-radius:50%;background:radial-gradient(circle at 40% 40%,#5b8;#125);"></div>
        </div>
        <!-- Mouth -->
        <div class="llf-mouth-wrap" style="position:absolute;bottom:100px;left:50%;transform:translateX(-50%);width:120px;height:50px;overflow:hidden;">
          <div class="llf-mouth" style="position:absolute;inset:0;background:#b44;border-radius:0 0 60px 60px;transition:border-radius 0.05s,height 0.05s;"></div>
        </div>
        <!-- Brow left -->
        <div class="llf-brow llf-brow-l" style="position:absolute;top:110px;left:68px;width:72px;height:10px;background:#8b6;border-radius:5px;transform-origin:right center;transition:transform 0.05s;"></div>
        <!-- Brow right -->
        <div class="llf-brow llf-brow-r" style="position:absolute;top:110px;right:68px;width:72px;height:10px;background:#8b6;border-radius:5px;transform-origin:left center;transition:transform 0.05s;"></div>
        <!-- Head rotation wrapper (inner) -->
      </div>
    `;
    }
    // ── Preset: emoji ───────────────────────────────────────────────────────────
    function _buildEmojiAvatar(container) {
        const wrap = document.createElement('div');
        wrap.className = 'llf-emoji-wrap';
        wrap.style.cssText = 'font-size:220px;line-height:1;user-select:none;transition:transform 0.06s;';
        wrap.textContent = '😐';
        container.appendChild(wrap);
    }
    // ── Preset: minimal (blendshape bar-graph for development/debug) ────────────
    function _buildMinimalAvatar(container) {
        const wrap = document.createElement('div');
        wrap.className = 'llf-minimal';
        wrap.style.cssText = 'display:grid;grid-template-columns:repeat(4,1fr);gap:4px;padding:20px;width:100%;box-sizing:border-box;';
        container.appendChild(wrap);
    }
    // ── Frame application ──────────────────────────────────────────────────────
    function _applyFrame(frame) {
        if (!_container || !_active)
            return;
        _showStatus('');
        const preset = _meta.avatarPreset;
        if (preset === 'face') {
            _applyFaceFrame(frame);
        }
        else if (preset === 'emoji') {
            _applyEmojiFrame(frame);
        }
        else {
            _applyMinimalFrame(frame);
        }
    }
    function _applyFaceFrame(frame) {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u;
        if (!_container)
            return;
        const bs = frame.blendshapes;
        // Eye blink: scale Y of eye div (0 = open, 1 = fully closed)
        const eyeL = _container.querySelector('.llf-eye-l');
        const eyeR = _container.querySelector('.llf-eye-r');
        if (eyeL)
            eyeL.style.transform = `scaleY(${Math.max(0.05, 1 - ((_a = bs.eyeBlinkLeft) !== null && _a !== void 0 ? _a : 0))})`;
        if (eyeR)
            eyeR.style.transform = `scaleY(${Math.max(0.05, 1 - ((_b = bs.eyeBlinkRight) !== null && _b !== void 0 ? _b : 0))})`;
        // Iris look direction
        const irisL = _container.querySelector('.llf-iris-l');
        const irisR = _container.querySelector('.llf-iris-r');
        if (irisL) {
            const x = (((_c = bs.eyeLookOutLeft) !== null && _c !== void 0 ? _c : 0) - ((_d = bs.eyeLookInLeft) !== null && _d !== void 0 ? _d : 0)) * 8;
            const y = (((_e = bs.eyeLookDownLeft) !== null && _e !== void 0 ? _e : 0) - ((_f = bs.eyeLookUpLeft) !== null && _f !== void 0 ? _f : 0)) * 8;
            irisL.style.transform = `translate(${x}px,${y}px)`;
        }
        if (irisR) {
            const x = (((_g = bs.eyeLookInRight) !== null && _g !== void 0 ? _g : 0) - ((_h = bs.eyeLookOutRight) !== null && _h !== void 0 ? _h : 0)) * 8;
            const y = (((_j = bs.eyeLookDownRight) !== null && _j !== void 0 ? _j : 0) - ((_k = bs.eyeLookUpRight) !== null && _k !== void 0 ? _k : 0)) * 8;
            irisR.style.transform = `translate(${x}px,${y}px)`;
        }
        // Mouth open: jawOpen drives mouth height
        const mouth = _container.querySelector('.llf-mouth');
        if (mouth) {
            const open = ((_l = bs.jawOpen) !== null && _l !== void 0 ? _l : 0) * 50;
            const smileL = (_m = bs.mouthSmileLeft) !== null && _m !== void 0 ? _m : 0;
            const smileR = (_o = bs.mouthSmileRight) !== null && _o !== void 0 ? _o : 0;
            const smile = (smileL + smileR) / 2;
            const frown = (((_p = bs.mouthFrownLeft) !== null && _p !== void 0 ? _p : 0) + ((_q = bs.mouthFrownRight) !== null && _q !== void 0 ? _q : 0)) / 2;
            const radPct = 60 - smile * 40 + frown * 40;
            mouth.style.height = `${10 + open}px`;
            mouth.style.borderRadius = `0 0 ${radPct}px ${radPct}px`;
        }
        // Brows: browDown / browOuterUp / browInnerUp
        const browL = _container.querySelector('.llf-brow-l');
        const browR = _container.querySelector('.llf-brow-r');
        if (browL) {
            const rot = (((_r = bs.browDownLeft) !== null && _r !== void 0 ? _r : 0) - ((_s = bs.browOuterUpLeft) !== null && _s !== void 0 ? _s : 0)) * 20;
            browL.style.transform = `rotate(${rot}deg)`;
        }
        if (browR) {
            const rot = (((_t = bs.browDownRight) !== null && _t !== void 0 ? _t : 0) - ((_u = bs.browOuterUpRight) !== null && _u !== void 0 ? _u : 0)) * -20;
            browR.style.transform = `rotate(${rot}deg)`;
        }
        // Head rotation: apply to face wrapper
        const face = _container.querySelector('.llf-face');
        if (face) {
            face.style.transform = `rotateY(${frame.headYaw * 30}deg) rotateX(${-frame.headPitch * 20}deg) rotateZ(${frame.headRoll * 15}deg)`;
        }
    }
    function _applyEmojiFrame(frame) {
        var _a, _b, _c, _d, _e, _f, _g;
        if (!_container)
            return;
        const bs = frame.blendshapes;
        const wrap = _container.querySelector('.llf-emoji-wrap');
        if (!wrap)
            return;
        const jawOpen = (_a = bs.jawOpen) !== null && _a !== void 0 ? _a : 0;
        const smileL = (_b = bs.mouthSmileLeft) !== null && _b !== void 0 ? _b : 0;
        const smileR = (_c = bs.mouthSmileRight) !== null && _c !== void 0 ? _c : 0;
        const smile = (smileL + smileR) / 2;
        const frown = (((_d = bs.mouthFrownLeft) !== null && _d !== void 0 ? _d : 0) + ((_e = bs.mouthFrownRight) !== null && _e !== void 0 ? _e : 0)) / 2;
        const blinkL = (_f = bs.eyeBlinkLeft) !== null && _f !== void 0 ? _f : 0;
        const blinkR = (_g = bs.eyeBlinkRight) !== null && _g !== void 0 ? _g : 0;
        const blinking = blinkL > 0.7 && blinkR > 0.7;
        let emoji = '😐';
        if (blinking)
            emoji = '😑';
        else if (jawOpen > 0.4 && smile > 0.3)
            emoji = '😄';
        else if (jawOpen > 0.4)
            emoji = '😮';
        else if (smile > 0.4)
            emoji = '😊';
        else if (frown > 0.4)
            emoji = '😟';
        wrap.textContent = emoji;
        wrap.style.transform = `rotateY(${frame.headYaw * 25}deg) rotateX(${-frame.headPitch * 15}deg)`;
    }
    function _applyMinimalFrame(frame) {
        if (!_container)
            return;
        const wrap = _container.querySelector('.llf-minimal');
        if (!wrap)
            return;
        // Re-render bar graph (cheap — only a few dozen divs)
        wrap.innerHTML = '';
        const entries = Object.entries(frame.blendshapes)
            .filter(([, v]) => v > 0.01)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 16);
        entries.forEach(([name, val]) => {
            const cell = document.createElement('div');
            cell.style.cssText = 'background:#111;border-radius:4px;padding:4px 6px;overflow:hidden;';
            cell.innerHTML = `
        <div style="font:9px monospace;color:#888;margin-bottom:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${name}</div>
        <div style="background:#333;border-radius:2px;height:6px;">
          <div style="background:#4af;width:${Math.round(val * 100)}%;height:100%;border-radius:2px;transition:width 0.05s;"></div>
        </div>
        <div style="font:10px monospace;color:#fff;margin-top:2px;text-align:right;">${val.toFixed(2)}</div>
      `;
            wrap.appendChild(cell);
        });
        // Head rotation display
        const rotDiv = document.createElement('div');
        rotDiv.style.cssText = 'grid-column:span 4;font:11px monospace;color:#4af;padding:4px 6px;background:#111;border-radius:4px;';
        rotDiv.textContent = `P:${frame.headPitch.toFixed(3)}  Y:${frame.headYaw.toFixed(3)}  R:${frame.headRoll.toFixed(3)}`;
        wrap.appendChild(rotDiv);
    }
    // ── Logging ───────────────────────────────────────────────────────────────
    function llfLog(msg) {
        if (typeof logger !== 'undefined') {
            logger.info('[LiveLinkFace] ' + msg);
        }
        else {
            console.log('[LiveLinkFace] ' + msg);
        }
    }
})(LiveLinkFaceRenderer || (LiveLinkFaceRenderer = {}));
