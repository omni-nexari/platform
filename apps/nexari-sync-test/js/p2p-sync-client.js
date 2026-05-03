"use strict";
/**
 * p2p-sync-client.ts
 * WebRTC DataChannel P2P sync coordinator.
 *
 * Role determination: both devices register at Pi relay; the device with the
 * lexicographically lower IP becomes the leader. The leader drives the sync
 * protocol; the follower waits for cues.
 *
 * Pi relay is used ONLY for WebRTC SDP/ICE signaling. Once the DataChannel
 * is open all messages are direct device-to-device.
 *
 * Public API:
 *   P2PSync.init(opts)
 *   P2PSync.setVideoReady(itemIndex, engineMode)     // called by player after load/decode
 *   P2PSync.setPlaybackState(itemIndex, currentTimeMs, engineMode)  // called every 1s
 *   P2PSync.onSyncPlay(handler)                      // player subscribes for SYNC_PLAY
 *   P2PSync.onVideoUrl(handler)                      // follower subscribes for VIDEO_URL
 *   P2PSync.onSetEngine(handler)                     // both subscribe for engine toggle
 *   P2PSync.onAdjust(handler)                        // follower subscribes for SYNC_ADJUST
 *   P2PSync.broadcastSetEngine(mode)                 // leader-only: toggle engines
 *   P2PSync.getRole()                                // 'leader' | 'follower' | 'pending'
 *   P2PSync.shutdown()
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
exports.getRole = getRole;
exports.onSyncPlay = onSyncPlay;
exports.onVideoUrl = onVideoUrl;
exports.onSetEngine = onSetEngine;
exports.onAdjust = onAdjust;
exports.init = init;
exports.setVideoReady = setVideoReady;
exports.setPlaybackState = setPlaybackState;
exports.broadcastSetEngine = broadcastSetEngine;
exports.shutdown = shutdown;
const ntp_client_js_1 = require("./ntp-client.js");
// ── Constants ──────────────────────────────────────────────────────────────────
const REGISTER_INTERVAL_MS = 5000; // keep-alive re-registration
const PEER_POLL_INTERVAL_MS = 2000; // poll /peers until partner found
const SIGNAL_POLL_INTERVAL_MS = 500; // drain /signals while negotiating
const HEARTBEAT_INTERVAL_MS = 1000; // follower sends heartbeat
const DRIFT_NOOP_MS = 30;
const DRIFT_NUDGE_MS = 200;
const LEADER_START_AHEAD_MS = 5000; // leader fires SYNC_PLAY this far ahead
// Drift correction rates — smooth nudge for MSE (HTML5 supports fractional rates)
const NUDGE_FAST = 1.005;
const NUDGE_SLOW = 0.995;
// ── Module state ──────────────────────────────────────────────────────────────
let _opts = null;
let _role = 'pending';
let _peerIp = null;
let _peerDeviceId = null;
let _groupId = 'synctest-001';
let _pc = null;
let _dc = null;
let _dcOpen = false;
// Pending READY flag — set by player after load/decode, consumed when dc opens
let _readyItemIndex = -1;
let _readyEngineMode = 'mse';
// Playback state for heartbeat/drift
let _pbItemIndex = -1;
let _pbCurrentMs = 0;
let _pbEngineMode = 'mse';
const _followerViews = {};
let _signalPollSince = 0;
let _registerTimer = null;
let _peerPollTimer = null;
let _signalPollTimer = null;
let _heartbeatTimer = null;
// Handlers set by the player
let _onSyncPlay = null;
let _onVideoUrl = null;
let _onSetEngine = null;
let _onAdjust = null;
// ── Public API ────────────────────────────────────────────────────────────────
function getRole() { return _role; }
function onSyncPlay(h) { _onSyncPlay = h; }
function onVideoUrl(h) { _onVideoUrl = h; }
function onSetEngine(h) { _onSetEngine = h; }
function onAdjust(h) { _onAdjust = h; }
function init(opts) {
    var _a;
    _opts = opts;
    _groupId = (_a = opts.groupId) !== null && _a !== void 0 ? _a : 'synctest-001';
    _opts.logger('info', `[P2P] init: deviceId=${opts.deviceId} ip=${opts.selfIp}`);
    _startRegister();
    _startPeerPoll();
    _startSignalDrain();
}
/** Player calls this once the video is loaded/pre-decoded and ready to play. */
function setVideoReady(itemIndex, engineMode) {
    _readyItemIndex = itemIndex;
    _readyEngineMode = engineMode;
    if (_dcOpen && _role === 'follower') {
        _send({ type: 'READY', deviceId: _opts.deviceId, engineMode });
        _opts === null || _opts === void 0 ? void 0 : _opts.logger('info', `[P2P] follower READY sent (itemIndex=${itemIndex})`);
    }
    // If leader and dc not open yet, READY is sent once channel opens (in _onDcOpen)
}
/** Player calls this on a 1s tick to update playback state. */
function setPlaybackState(itemIndex, currentTimeMs, engineMode) {
    _pbItemIndex = itemIndex;
    _pbCurrentMs = currentTimeMs;
    _pbEngineMode = engineMode;
}
/** Leader-only: trigger an engine switch broadcast (CH+ remote key handler). */
function broadcastSetEngine(mode) {
    if (_role !== 'leader')
        return;
    _send({ type: 'SET_ENGINE', engineMode: mode });
    _opts === null || _opts === void 0 ? void 0 : _opts.logger('info', `[P2P] leader broadcast SET_ENGINE: ${mode}`);
    // Also fire locally so leader's own player switches
    _onSetEngine === null || _onSetEngine === void 0 ? void 0 : _onSetEngine({ type: 'SET_ENGINE', engineMode: mode });
}
function shutdown() {
    clearInterval(_registerTimer);
    clearInterval(_peerPollTimer);
    clearInterval(_signalPollTimer);
    clearInterval(_heartbeatTimer);
    _dc === null || _dc === void 0 ? void 0 : _dc.close();
    _pc === null || _pc === void 0 ? void 0 : _pc.close();
    _dc = null;
    _pc = null;
    _dcOpen = false;
    _role = 'pending';
    _opts === null || _opts === void 0 ? void 0 : _opts.logger('info', '[P2P] shutdown');
}
// ── Registration keep-alive ───────────────────────────────────────────────────
function _startRegister() {
    _doRegister();
    _registerTimer = setInterval(_doRegister, REGISTER_INTERVAL_MS);
}
function _doRegister() {
    if (!_opts)
        return;
    fetch(`${_opts.piBase}/api/v1/test-sync/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId: _opts.deviceId, role: 'peer', ip: _opts.selfIp, groupId: _groupId }),
    }).catch(() => { });
}
// ── Peer discovery ────────────────────────────────────────────────────────────
function _startPeerPoll() {
    _peerPollTimer = setInterval(_doPeerPoll, PEER_POLL_INTERVAL_MS);
}
function _doPeerPoll() {
    return __awaiter(this, void 0, void 0, function* () {
        if (_dcOpen) {
            clearInterval(_peerPollTimer);
            return;
        }
        if (!_opts)
            return;
        try {
            const res = yield fetch(`${_opts.piBase}/api/v1/test-sync/peers?groupId=${_groupId}`);
            const data = yield res.json();
            const peers = data.peers.filter((p) => p.deviceId !== _opts.deviceId);
            if (!peers.length)
                return; // wait for partner
            const peer = peers[0];
            _peerIp = peer.ip;
            _peerDeviceId = peer.deviceId;
            // Role: lower IP (lexicographic) is leader
            _role = _opts.selfIp < peer.ip ? 'leader' : 'follower';
            _opts.logger('info', `[P2P] peer found: ${peer.ip} → self is ${_role}`);
            clearInterval(_peerPollTimer);
            _initWebRTC();
        }
        catch (e) {
            _opts === null || _opts === void 0 ? void 0 : _opts.logger('warn', `[P2P] peer poll failed: ${e === null || e === void 0 ? void 0 : e.message}`);
        }
    });
}
// ── WebRTC ────────────────────────────────────────────────────────────────────
function _initWebRTC() {
    const config = {
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
        ],
    };
    _pc = new RTCPeerConnection(config);
    _pc.onicecandidate = (ev) => {
        if (ev.candidate)
            _sendSignal({ type: 'ice', candidate: ev.candidate.toJSON() });
    };
    _pc.ondatachannel = (ev) => {
        _dc = ev.channel;
        _setupDc();
    };
    if (_role === 'leader') {
        _dc = _pc.createDataChannel('sync', { ordered: true });
        _setupDc();
        _pc.createOffer()
            .then((offer) => _pc.setLocalDescription(offer))
            .then(() => _sendSignal({ type: 'offer', sdp: _pc.localDescription.toJSON() }))
            .catch((e) => _opts === null || _opts === void 0 ? void 0 : _opts.logger('error', `[P2P] offer failed: ${e === null || e === void 0 ? void 0 : e.message}`));
    }
}
function _setupDc() {
    if (!_dc)
        return;
    _dc.onopen = _onDcOpen;
    _dc.onclose = () => { _dcOpen = false; _opts === null || _opts === void 0 ? void 0 : _opts.logger('warn', '[P2P] DataChannel closed'); };
    _dc.onmessage = (ev) => {
        try {
            _handleMessage(JSON.parse(ev.data));
        }
        catch ( /* ignore malformed */_a) { /* ignore malformed */ }
    };
}
function _onDcOpen() {
    _dcOpen = true;
    _opts === null || _opts === void 0 ? void 0 : _opts.logger('info', `[P2P] DataChannel open — role=${_role}`);
    if (_role === 'leader') {
        // Send READY if player already signalled readiness before dc opened
        if (_readyItemIndex >= 0) {
            _send({ type: 'READY', deviceId: _opts.deviceId, engineMode: _readyEngineMode });
        }
        _startHeartbeat();
    }
    else {
        // Follower: send READY if already loaded
        if (_readyItemIndex >= 0) {
            _send({ type: 'READY', deviceId: _opts.deviceId, engineMode: _readyEngineMode });
        }
        _startHeartbeat();
    }
}
function _handleMessage(msg) {
    if (!_opts)
        return;
    switch (msg.type) {
        case 'READY':
            if (_role === 'leader') {
                _opts.logger('info', `[P2P] follower READY received (engine=${msg.engineMode})`);
                // Schedule SYNC_PLAY 5s ahead so both have time to react
                const startMs = (0, ntp_client_js_1.getSyncedTime)() + LEADER_START_AHEAD_MS;
                _send({ type: 'SYNC_PLAY', syncedStartMs: startMs, itemIndex: _pbItemIndex >= 0 ? _pbItemIndex : 0 });
                // Also deliver to leader's own player
                _onSyncPlay === null || _onSyncPlay === void 0 ? void 0 : _onSyncPlay({ type: 'SYNC_PLAY', syncedStartMs: startMs, itemIndex: _pbItemIndex >= 0 ? _pbItemIndex : 0 });
                _opts.logger('info', `[P2P] leader broadcast SYNC_PLAY at +5s (syncedStartMs=${startMs})`);
            }
            break;
        case 'VIDEO_URL':
            _onVideoUrl === null || _onVideoUrl === void 0 ? void 0 : _onVideoUrl(msg);
            break;
        case 'SET_ENGINE':
            _opts.logger('info', `[P2P] SET_ENGINE received: ${msg.engineMode}`);
            _onSetEngine === null || _onSetEngine === void 0 ? void 0 : _onSetEngine(msg);
            break;
        case 'SYNC_PLAY':
            _opts.logger('info', `[P2P] SYNC_PLAY received: startMs=${msg.syncedStartMs}`);
            _onSyncPlay === null || _onSyncPlay === void 0 ? void 0 : _onSyncPlay(msg);
            break;
        case 'HEARTBEAT':
            if (_role === 'leader')
                _handleHeartbeat(msg);
            break;
        case 'SYNC_ADJUST':
            _onAdjust === null || _onAdjust === void 0 ? void 0 : _onAdjust(msg);
            break;
    }
}
// ── Heartbeat + drift correction (leader receives, follower sends) ─────────────
function _startHeartbeat() {
    _heartbeatTimer = setInterval(() => {
        if (!_dcOpen)
            return;
        if (_role === 'follower') {
            _send({
                type: 'HEARTBEAT',
                deviceId: _opts.deviceId,
                itemIndex: _pbItemIndex,
                currentTimeMs: _pbCurrentMs,
                syncedTime: (0, ntp_client_js_1.getSyncedTime)(),
                engineMode: _pbEngineMode,
            });
        }
        else {
            _expireStaleFollowers();
        }
    }, HEARTBEAT_INTERVAL_MS);
}
function _handleHeartbeat(msg) {
    if (_pbItemIndex < 0 || msg.itemIndex !== _pbItemIndex)
        return;
    _followerViews[msg.deviceId] = {
        currentMs: msg.currentTimeMs,
        syncedTime: msg.syncedTime,
        itemIndex: msg.itemIndex,
        receivedAt: Date.now(),
    };
    const leaderNow = (0, ntp_client_js_1.getSyncedTime)();
    const expectedMs = _pbCurrentMs - (leaderNow - msg.syncedTime);
    const driftMs = msg.currentTimeMs - expectedMs;
    const absDrift = Math.abs(driftMs);
    let action = 'noop';
    let driftRate = 1.0;
    let targetMs;
    if (absDrift > DRIFT_NUDGE_MS) {
        action = 'snap';
        targetMs = _pbCurrentMs + 60; // project 60ms forward for one-way trip
    }
    else if (absDrift > DRIFT_NOOP_MS) {
        action = 'nudge';
        driftRate = driftMs > 0 ? NUDGE_SLOW : NUDGE_FAST;
    }
    if (action === 'noop')
        return;
    _send({ type: 'SYNC_ADJUST', itemIndex: _pbItemIndex, driftMs: Math.round(driftMs), action, driftRate, targetMs });
    _opts === null || _opts === void 0 ? void 0 : _opts.logger('info', `[P2P] SYNC_ADJUST → ${msg.deviceId}: drift=${Math.round(driftMs)}ms action=${action}`);
}
function _expireStaleFollowers() {
    const STALE = 6000;
    const now = Date.now();
    Object.keys(_followerViews).forEach((id) => {
        if (now - _followerViews[id].receivedAt > STALE)
            delete _followerViews[id];
    });
}
// ── Signal drain (SDP + ICE from Pi relay) ────────────────────────────────────
function _startSignalDrain() {
    _signalPollTimer = setInterval(_doSignalDrain, SIGNAL_POLL_INTERVAL_MS);
}
function _doSignalDrain() {
    return __awaiter(this, void 0, void 0, function* () {
        if (_dcOpen)
            return;
        if (!_opts || !_pc)
            return;
        try {
            const res = yield fetch(`${_opts.piBase}/api/v1/test-sync/signals/${_opts.deviceId}?since=${_signalPollSince}`);
            const data = yield res.json();
            _signalPollSince = data.nextSince;
            for (const entry of data.entries) {
                const { body } = entry;
                if (body.type === 'offer' && _role === 'follower') {
                    yield _pc.setRemoteDescription(new RTCSessionDescription(body.sdp));
                    const answer = yield _pc.createAnswer();
                    yield _pc.setLocalDescription(answer);
                    _sendSignal({ type: 'answer', sdp: _pc.localDescription.toJSON() });
                }
                else if (body.type === 'answer' && _role === 'leader') {
                    yield _pc.setRemoteDescription(new RTCSessionDescription(body.sdp));
                }
                else if (body.type === 'ice') {
                    yield _pc.addIceCandidate(new RTCIceCandidate(body.candidate)).catch(() => { });
                }
            }
        }
        catch ( /* silent – network errors are non-fatal during negotiation */_a) { /* silent – network errors are non-fatal during negotiation */ }
    });
}
function _sendSignal(body) {
    if (!_opts || !_peerDeviceId)
        return;
    fetch(`${_opts.piBase}/api/v1/test-sync/signal/${_peerDeviceId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: _opts.deviceId, seq: Date.now(), body }),
    }).catch(() => { });
}
function _send(msg) {
    if (!_dc || !_dcOpen)
        return;
    try {
        _dc.send(JSON.stringify(msg));
    }
    catch (e) {
        _opts === null || _opts === void 0 ? void 0 : _opts.logger('warn', `[P2P] send failed: ${e === null || e === void 0 ? void 0 : e.message}`);
    }
}
