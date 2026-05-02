/**
 * sync-engine.ts — SyncPlay coordinator (Phase 2)
 *
 * Owns peer mesh state on the player side. Talks to the local Node bridge
 * (mdc.js) over loopback HTTP for:
 *   - identity provisioning  POST /sync/identity
 *   - manifest persistence   POST /sync/manifest
 *   - live peer table        GET  /sync/peers
 *   - inbound peer messages  GET  /sync/messages?since=<seq>
 *   - peer NTP source        GET  http://<peerIp>:9615/time
 *   - outbound peer messages POST http://<peerIp>:9615/sync/message
 *
 * Public API (kept intentionally minimal for Phase 2):
 *   SyncEngine.init({ deviceId, getSyncedTime, getNtpOffset, setNtpOffset, logger })
 *   SyncEngine.setManifest(manifest)        // from WS SYNC_GROUP_INIT
 *   SyncEngine.handleServerSyncPlay(payload)
 *   SyncEngine.getRole()                    // 'leader' | 'follower' | 'idle'
 *   SyncEngine.isActive()
 *   SyncEngine.startGroupAt(syncedStartMs, itemIndex)   // leader-only
 *   SyncEngine.onSyncCommand(handler)       // player subscribes for sync events
 *
 * The engine does NOT itself render content — it broadcasts time-synchronized
 * cues that the player's existing playlist controller acts on.
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
var SyncEngine;
(function (SyncEngine) {
    // ── State ───────────────────────────────────────────────────────────────
    const BRIDGE_BASE = 'http://127.0.0.1:9615';
    const PEER_REFRESH_INTERVAL_MS = 2000;
    const MESSAGE_POLL_INTERVAL_MS = 1000;
    const PEER_NTP_INTERVAL_MS = 30000;
    const PEER_NTP_RTT_LIMIT_MS = 250;
    const HEARTBEAT_INTERVAL_MS = 1000;
    const DRIFT_NOOP_MS = 30; // ≤ this: do nothing (tightened for adjacent-panel visual quality)
    const DRIFT_NUDGE_MS = 200; // ≤ this: playbackRate nudge
    // > DRIFT_NUDGE_MS                       hard snap
    let opts = null;
    let manifest = null;
    let livePeers = [];
    let role = 'idle';
    let leaderDeviceId = null;
    let leaderIp = null;
    let leaderPort = 9615;
    let lastMsgSeq = 0;
    let peerRefreshTimer = null;
    let messagePollTimer = null;
    let peerNtpTimer = null;
    let heartbeatTimer = null;
    let peerNtpInProgress = false;
    let commandHandler = null;
    let playbackState = { itemIndex: -1, currentTimeMs: 0, syncGroupId: null };
    const followerViews = {};
    // ── Public: init ────────────────────────────────────────────────────────
    function init(o) {
        if (opts) {
            o.logger.warn('[SyncEngine] init called twice — ignoring');
            return;
        }
        opts = o;
        opts.logger.info('[SyncEngine] init: deviceId=' + o.deviceId);
        // Cold-start: try to load manifest from bridge cache.
        loadManifestFromBridge().then(function (m) {
            if (m) {
                opts.logger.info('[SyncEngine] cold-start manifest loaded from bridge cache');
                applyManifest(m);
            }
        });
        startTimers();
    }
    SyncEngine.init = init;
    // ── Public: subscribe to inbound sync commands ─────────────────────────
    function onSyncCommand(handler) {
        commandHandler = handler;
    }
    SyncEngine.onSyncCommand = onSyncCommand;
    // ── Public: receive manifest from API WS (SYNC_GROUP_INIT) ─────────────
    function setManifest(m) {
        if (!opts)
            return;
        if (!m || !m.groupId) {
            opts.logger.warn('[SyncEngine] setManifest: invalid manifest');
            return;
        }
        applyManifest(m);
        // Persist via bridge so it survives reboot offline.
        void bridgePost('/sync/manifest', m).catch(function (e) {
            opts.logger.warn('[SyncEngine] manifest persist to bridge failed:', e && e.message);
        });
    }
    SyncEngine.setManifest = setManifest;
    // ── Public: API push of legacy SYNC_PLAY (back-compat) ─────────────────
    function handleServerSyncPlay(payload) {
        if (!opts)
            return;
        opts.logger.info('[SyncEngine] received server SYNC_PLAY:', payload);
        // The new model uses SYNC_GROUP_INIT for manifest + leader-broadcast
        // SYNC_PLAY for start cues. If a server still sends a flat SYNC_PLAY,
        // dispatch it as a peer command so the player can react uniformly.
        dispatchSyncCommand({
            type: 'SYNC_PLAY',
            fromDeviceId: null,
            payload: payload || {},
            receivedAt: Date.now(),
        });
    }
    SyncEngine.handleServerSyncPlay = handleServerSyncPlay;
    // ── Public: introspection ──────────────────────────────────────────────
    function getRole() { return role; }
    SyncEngine.getRole = getRole;
    function isActive() { return !!manifest; }
    SyncEngine.isActive = isActive;
    function getLeader() {
        return { deviceId: leaderDeviceId, ip: leaderIp, port: leaderPort };
    }
    SyncEngine.getLeader = getLeader;
    function getManifest() { return manifest; }
    SyncEngine.getManifest = getManifest;
    function getLivePeers() { return livePeers.slice(); }
    SyncEngine.getLivePeers = getLivePeers;
    // ── Public: deterministic START broadcast (leader only) ────────────────
    // syncedStartMs: target getSyncedTime() value at which all peers begin item N.
    function startGroupAt(syncedStartMs, itemIndex) {
        if (!opts || !manifest)
            return;
        if (role !== 'leader') {
            opts.logger.warn('[SyncEngine] startGroupAt called by non-leader; refusing');
            return;
        }
        opts.logger.info('[SyncEngine] leader START broadcast: itemIndex=' + itemIndex +
            ' syncedStartMs=' + syncedStartMs);
        const cmd = {
            type: 'SYNC_PLAY',
            fromDeviceId: opts.deviceId,
            payload: {
                groupId: manifest.groupId,
                version: manifest.version,
                itemIndex: itemIndex,
                syncedStartMs: syncedStartMs,
            },
        };
        // Self-loop too: dispatch locally so the leader's player gates on the same path.
        dispatchSyncCommand({
            type: 'SYNC_PLAY',
            fromDeviceId: opts.deviceId,
            payload: cmd.payload,
            receivedAt: Date.now(),
        });
        broadcastToPeers(cmd);
    }
    SyncEngine.startGroupAt = startGroupAt;
    // ── Public: leader broadcasts next-item cue ─────────────────────────────
    function broadcastNextItem(syncedTargetMs, itemIndex) {
        if (!opts || !manifest || role !== 'leader')
            return;
        const cmd = {
            type: 'SYNC_NEXT_ITEM',
            fromDeviceId: opts.deviceId,
            payload: { groupId: manifest.groupId, syncedTargetMs: syncedTargetMs, itemIndex: itemIndex },
        };
        dispatchSyncCommand({
            type: 'SYNC_NEXT_ITEM',
            fromDeviceId: opts.deviceId,
            payload: cmd.payload,
            receivedAt: Date.now(),
        });
        broadcastToPeers(cmd);
    }
    SyncEngine.broadcastNextItem = broadcastNextItem;
    // ── Public: player reports current local playback state ────────────────
    // Called on every item transition AND on a low-frequency tick from the
    // active video element so the leader has a fresh reference frame.
    function setPlaybackState(s) {
        playbackState = {
            itemIndex: s.itemIndex,
            currentTimeMs: s.currentTimeMs,
            syncGroupId: s.syncGroupId || null,
        };
    }
    SyncEngine.setPlaybackState = setPlaybackState;
    // ── Public: shutdown (used on logout / device unpair) ──────────────────
    function shutdown() {
        if (peerRefreshTimer) {
            clearInterval(peerRefreshTimer);
            peerRefreshTimer = null;
        }
        if (messagePollTimer) {
            clearInterval(messagePollTimer);
            messagePollTimer = null;
        }
        if (peerNtpTimer) {
            clearInterval(peerNtpTimer);
            peerNtpTimer = null;
        }
        if (heartbeatTimer) {
            clearInterval(heartbeatTimer);
            heartbeatTimer = null;
        }
        role = 'idle';
        leaderDeviceId = null;
        leaderIp = null;
        livePeers = [];
        manifest = null;
    }
    SyncEngine.shutdown = shutdown;
    // ── Internal: apply manifest, provision identity, refresh peers ────────
    function applyManifest(m) {
        if (!opts)
            return;
        manifest = m;
        // Resolve self priority from manifest.peers (fallback 99).
        let myPriority = 99;
        let resolved = false;
        if (Array.isArray(m.peers)) {
            const self = m.peers.find(function (p) { return p && p.deviceId === opts.deviceId; });
            if (self && typeof self.priority === 'number') {
                myPriority = self.priority;
                resolved = true;
            }
        }
        // Fall through to leaderPriority array when peer entries don't carry a
        // numeric priority — server seeds the priority order via this array.
        if (!resolved && Array.isArray(m.leaderPriority)) {
            const idx = m.leaderPriority.indexOf(opts.deviceId);
            if (idx >= 0)
                myPriority = idx;
        }
        // Provision identity to bridge so it starts beaconing.
        void bridgePost('/sync/identity', {
            deviceId: opts.deviceId,
            groupId: m.groupId,
            priority: myPriority,
        }).catch(function (e) {
            opts.logger.warn('[SyncEngine] /sync/identity POST failed:', e && e.message);
        });
        opts.logger.info('[SyncEngine] manifest applied: groupId=' + m.groupId +
            ' version=' + m.version + ' selfPriority=' + myPriority);
        // Trigger an immediate peer refresh + leader election.
        void refreshPeersAndElectLeader();
    }
    function startTimers() {
        if (peerRefreshTimer)
            clearInterval(peerRefreshTimer);
        peerRefreshTimer = setInterval(function () {
            if (manifest)
                void refreshPeersAndElectLeader();
        }, PEER_REFRESH_INTERVAL_MS);
        if (messagePollTimer)
            clearInterval(messagePollTimer);
        messagePollTimer = setInterval(function () {
            void drainBridgeMessages();
        }, MESSAGE_POLL_INTERVAL_MS);
        if (peerNtpTimer)
            clearInterval(peerNtpTimer);
        peerNtpTimer = setInterval(function () {
            if (manifest && role === 'follower')
                void syncTimeWithLeader();
        }, PEER_NTP_INTERVAL_MS);
        if (heartbeatTimer)
            clearInterval(heartbeatTimer);
        heartbeatTimer = setInterval(function () {
            // Followers send heartbeat to leader; the leader self-evaluates on
            // each follower heartbeat (no self-heartbeat needed).
            if (manifest && role === 'follower')
                sendHeartbeatToLeader();
            // Leader expires stale follower views.
            if (manifest && role === 'leader')
                expireStaleFollowerViews();
        }, HEARTBEAT_INTERVAL_MS);
    }
    // ── Internal: peer refresh + leader election ───────────────────────────
    function refreshPeersAndElectLeader() {
        return __awaiter(this, void 0, void 0, function* () {
            if (!opts || !manifest)
                return;
            try {
                const data = yield bridgeGet('/sync/peers');
                if (data && Array.isArray(data.peers)) {
                    livePeers = data.peers;
                }
            }
            catch (e) {
                opts.logger.warn('[SyncEngine] /sync/peers GET failed:', e && e.message);
                // Continue to electLeader so manifest-declared peers are still
                // considered (no live peers ⇒ election still converges via manifest).
            }
            electLeader();
        });
    }
    function electLeader() {
        if (!opts || !manifest)
            return;
        // Resolve our own priority from manifest.
        let myPriority = 99;
        let resolvedSelf = false;
        if (Array.isArray(manifest.peers)) {
            const self = manifest.peers.find(function (p) { return p && p.deviceId === opts.deviceId; });
            if (self && typeof self.priority === 'number') {
                myPriority = self.priority;
                resolvedSelf = true;
            }
        }
        if (!resolvedSelf && Array.isArray(manifest.leaderPriority)) {
            const idx = manifest.leaderPriority.indexOf(opts.deviceId);
            if (idx >= 0)
                myPriority = idx;
        }
        const candidates = [];
        const seen = {};
        candidates.push({ deviceId: opts.deviceId, priority: myPriority, ip: '127.0.0.1', port: 9615 });
        seen[opts.deviceId] = true;
        livePeers.forEach(function (p) {
            if (!p.seen)
                return; // skip manifest-only entries
            if (seen[p.deviceId])
                return; // skip self echo
            candidates.push({ deviceId: p.deviceId, priority: p.priority, ip: p.ip, port: p.port });
            seen[p.deviceId] = true;
        });
        // Always include manifest peers so election is deterministic across
        // devices even before the bridge mesh has discovered them via UDP.
        if (Array.isArray(manifest.peers)) {
            manifest.peers.forEach(function (p, i) {
                if (!p || !p.deviceId || seen[p.deviceId])
                    return;
                let pri;
                if (typeof p.priority === 'number')
                    pri = p.priority;
                else if (Array.isArray(manifest.leaderPriority)) {
                    const idx = manifest.leaderPriority.indexOf(p.deviceId);
                    pri = idx >= 0 ? idx : 50 + i;
                }
                else
                    pri = 50 + i;
                candidates.push({
                    deviceId: p.deviceId,
                    priority: pri,
                    ip: p.lastKnownIp || null,
                    port: p.port || 9615,
                });
                seen[p.deviceId] = true;
            });
        }
        // Lowest priority wins (0 highest); tie-break by deviceId for determinism.
        candidates.sort(function (a, b) {
            if (a.priority !== b.priority)
                return a.priority - b.priority;
            return a.deviceId < b.deviceId ? -1 : 1;
        });
        const winner = candidates[0];
        const newRole = (winner.deviceId === opts.deviceId) ? 'leader' : 'follower';
        if (newRole !== role || winner.deviceId !== leaderDeviceId) {
            opts.logger.info('[SyncEngine] leader change: ' + leaderDeviceId + ' → ' + winner.deviceId +
                ' (selfRole=' + newRole + ', candidates=' + candidates.length + ')');
            role = newRole;
            leaderDeviceId = winner.deviceId;
            leaderIp = winner.ip;
            leaderPort = winner.port;
            // Followers immediately try to NTP-align with new leader.
            if (newRole === 'follower')
                void syncTimeWithLeader();
        }
    }
    // ── Internal: peer-mode NTP (5-sample best-RTT against leader bridge) ──
    function syncTimeWithLeader() {
        return __awaiter(this, void 0, void 0, function* () {
            if (!opts || !leaderIp || leaderIp === '127.0.0.1')
                return;
            if (peerNtpInProgress)
                return;
            peerNtpInProgress = true;
            try {
                const url = 'http://' + leaderIp + ':' + leaderPort + '/time';
                const samples = [];
                for (let i = 0; i < 5; i++) {
                    const t0 = Date.now();
                    const ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
                    const tid = ctrl ? setTimeout(function () { ctrl.abort(); }, 1500) : null;
                    try {
                        const r = yield fetch(url, { method: 'GET', signal: ctrl ? ctrl.signal : undefined });
                        const t3 = Date.now();
                        const json = yield r.json();
                        const ts = Number(json && json.timestamp);
                        if (!isFinite(ts))
                            continue;
                        const rtt = t3 - t0;
                        if (rtt > PEER_NTP_RTT_LIMIT_MS)
                            continue;
                        samples.push({ offset: ts - t0 - rtt / 2, rtt: rtt });
                    }
                    catch (_) { /* skip */ }
                    finally {
                        if (tid)
                            clearTimeout(tid);
                    }
                    yield new Promise(function (r) { setTimeout(r, 20); });
                }
                if (!samples.length) {
                    opts.logger.warn('[SyncEngine] peer NTP: no samples within RTT limit');
                    return;
                }
                samples.sort(function (a, b) { return a.rtt - b.rtt; });
                const best = samples[0];
                // Adjust ntpOffset toward leader's clock. Leader is the local truth for
                // sync purposes; server NTP becomes secondary while in a sync group.
                const prev = opts.getNtpOffset();
                const NTP_SNAP_MS = 50;
                const delta = Math.abs(best.offset - prev);
                const next = (delta > NTP_SNAP_MS) ? best.offset : (prev * 0.8 + best.offset * 0.2);
                opts.setNtpOffset(Math.round(next));
                opts.logger.info('[SyncEngine] peer NTP: leader=' + leaderDeviceId +
                    ' offset=' + Math.round(next) + 'ms (raw=' + Math.round(best.offset) +
                    ', rtt=' + Math.round(best.rtt) + 'ms)' +
                    (delta > NTP_SNAP_MS ? ' [SNAPPED]' : ''));
            }
            finally {
                peerNtpInProgress = false;
            }
        });
    }
    // ── Internal: drain inbound bridge messages ────────────────────────────
    function drainBridgeMessages() {
        return __awaiter(this, void 0, void 0, function* () {
            if (!opts)
                return;
            try {
                const data = yield bridgeGet('/sync/messages?since=' + lastMsgSeq);
                if (!data || !Array.isArray(data.messages))
                    return;
                data.messages.forEach(function (msg) {
                    if (typeof msg.seq === 'number' && msg.seq > lastMsgSeq)
                        lastMsgSeq = msg.seq;
                    // Ignore messages from foreign groups.
                    if (msg.payload && manifest && msg.payload.groupId &&
                        msg.payload.groupId !== manifest.groupId) {
                        return;
                    }
                    dispatchSyncCommand({
                        type: msg.type,
                        fromDeviceId: msg.fromDeviceId || null,
                        payload: msg.payload,
                        receivedAt: msg.receivedAt || Date.now(),
                    });
                });
                if (typeof data.lastSeq === 'number' && data.lastSeq > lastMsgSeq) {
                    lastMsgSeq = data.lastSeq;
                }
            }
            catch (e) {
                // Bridge may not be listening yet; tolerate quietly after first failure.
                if (drainBridgeMessages._warned)
                    return;
                opts.logger.warn('[SyncEngine] /sync/messages GET failed:', e && e.message);
                drainBridgeMessages._warned = true;
            }
        });
    }
    function dispatchSyncCommand(cmd) {
        if (!opts)
            return;
        // Leader-side intercept: SYNC_HEARTBEAT from followers feeds drift logic.
        if (cmd.type === 'SYNC_HEARTBEAT' && role === 'leader' && cmd.fromDeviceId &&
            cmd.fromDeviceId !== opts.deviceId) {
            onLeaderReceiveHeartbeat(cmd.fromDeviceId, cmd.payload || {});
            // Heartbeats are not surfaced to the player; leader only.
            return;
        }
        if (commandHandler) {
            try {
                commandHandler(cmd);
            }
            catch (e) {
                opts.logger.error('[SyncEngine] command handler threw:', e && e.message);
            }
        }
    }
    // ── Internal: follower heartbeat → leader ──────────────────────────────
    function sendHeartbeatToLeader() {
        if (!opts || !manifest || !leaderIp || leaderIp === '127.0.0.1')
            return;
        if (playbackState.itemIndex < 0)
            return; // nothing playing yet
        const url = 'http://' + leaderIp + ':' + leaderPort + '/sync/message';
        const msg = {
            type: 'SYNC_HEARTBEAT',
            fromDeviceId: opts.deviceId,
            payload: {
                groupId: manifest.groupId,
                itemIndex: playbackState.itemIndex,
                currentTimeMs: playbackState.currentTimeMs,
                syncedTime: opts.getSyncedTime(),
            },
        };
        void httpPost(url, msg).catch(function (e) {
            // Leader unreachable — non-fatal; we'll retry next tick.
            if (sendHeartbeatToLeader._warned)
                return;
            opts.logger.warn('[SyncEngine] heartbeat → leader failed:', e && e.message);
            sendHeartbeatToLeader._warned = true;
        });
    }
    // ── Internal: leader receives heartbeat → compute drift → broadcast ADJUST
    function onLeaderReceiveHeartbeat(fromDeviceId, payload) {
        if (!opts || !manifest)
            return;
        if (payload.groupId && payload.groupId !== manifest.groupId)
            return;
        if (typeof payload.itemIndex !== 'number')
            return;
        const followerSyncedTime = Number(payload.syncedTime);
        const followerCurrentMs = Number(payload.currentTimeMs);
        if (!isFinite(followerSyncedTime) || !isFinite(followerCurrentMs))
            return;
        followerViews[fromDeviceId] = {
            itemIndex: payload.itemIndex,
            currentTimeMs: followerCurrentMs,
            syncedTime: followerSyncedTime,
            receivedAt: Date.now(),
        };
        // Drift only meaningful while leader & follower play the same item.
        if (playbackState.itemIndex !== payload.itemIndex)
            return;
        // Walk leader's currentTimeMs forward to follower's syncedTime instant.
        // Assumes leader's playbackState was captured at opts.getSyncedTime() now.
        const leaderSyncedNow = opts.getSyncedTime();
        const expectedFollowerTimeMs = playbackState.currentTimeMs - (leaderSyncedNow - followerSyncedTime);
        const driftMs = followerCurrentMs - expectedFollowerTimeMs;
        let action;
        let targetMs = null;
        let playbackRate = 1.0;
        if (Math.abs(driftMs) <= DRIFT_NOOP_MS) {
            action = 'noop';
        }
        else if (Math.abs(driftMs) <= DRIFT_NUDGE_MS) {
            // Follower ahead → slow down (rate < 1); behind → speed up.
            playbackRate = driftMs > 0 ? 0.995 : 1.005;
            action = driftMs > 0 ? 'nudge_down' : 'nudge_up';
        }
        else {
            action = 'snap';
            // Account for one-way trip latency by projecting target slightly forward.
            // Leader's currentTimeMs at the moment follower receives ADJUST.
            // Assume ~50 ms RTT/2 + processing; safe because HTML5 currentTime snap
            // is itself instantaneous on Tizen Chromium.
            targetMs = playbackState.currentTimeMs + 50;
        }
        if (action === 'noop')
            return; // don't spam ADJUSTs when in tolerance
        void httpPost('http://' + (followerViewIp(fromDeviceId) || '') + ':9615/sync/message', {
            type: 'SYNC_ADJUST',
            fromDeviceId: opts.deviceId,
            payload: {
                groupId: manifest.groupId,
                itemIndex: playbackState.itemIndex,
                driftMs: Math.round(driftMs),
                action: action,
                playbackRate: playbackRate,
                targetMs: targetMs,
            },
        }).catch(function (e) {
            opts.logger.warn('[SyncEngine] ADJUST → ' + fromDeviceId + ' failed: ' + (e && e.message));
        });
    }
    function followerViewIp(deviceId) {
        for (let i = 0; i < livePeers.length; i++) {
            if (livePeers[i].deviceId === deviceId)
                return livePeers[i].ip;
        }
        return null;
    }
    function expireStaleFollowerViews() {
        const STALE_MS = 6000;
        const now = Date.now();
        Object.keys(followerViews).forEach(function (id) {
            if (now - followerViews[id].receivedAt > STALE_MS)
                delete followerViews[id];
        });
    }
    // ── Internal: outbound peer broadcast ──────────────────────────────────
    function broadcastToPeers(msg) {
        if (!opts)
            return;
        livePeers.forEach(function (p) {
            if (!p.ip || p.deviceId === opts.deviceId)
                return;
            // Send to UDP-confirmed peers AND manifest-seeded peers (best-effort).
            const url = 'http://' + p.ip + ':' + (p.port || 9615) + '/sync/message';
            void httpPost(url, msg).catch(function (e) {
                opts.logger.warn('[SyncEngine] broadcast → ' + p.deviceId + ' (' + p.ip + ') failed: ' + (e && e.message));
            });
        });
    }
    // ── Internal: bridge HTTP helpers ──────────────────────────────────────
    // Tizen 4 (SSSP6) webview rejects fetch() to 127.0.0.1 with "Failed to
    // fetch" before reaching the local bridge. XMLHttpRequest works in that
    // environment, so use it for bridge calls and reserve fetch() for LAN
    // peer-to-peer messaging where it's known to work.
    function bridgePost(path, body) {
        return xhrJson('POST', BRIDGE_BASE + path, body);
    }
    function bridgeGet(path) {
        return xhrJson('GET', BRIDGE_BASE + path, null);
    }
    function xhrJson(method, url, body) {
        return new Promise(function (resolve, reject) {
            try {
                const xhr = new XMLHttpRequest();
                xhr.open(method, url, true);
                xhr.setRequestHeader('Content-Type', 'application/json');
                xhr.timeout = 4000;
                xhr.onload = function () {
                    if (xhr.status >= 200 && xhr.status < 300) {
                        try {
                            resolve(xhr.responseText ? JSON.parse(xhr.responseText) : null);
                        }
                        catch (_) {
                            resolve(null);
                        }
                    }
                    else {
                        reject(new Error('HTTP ' + xhr.status));
                    }
                };
                xhr.onerror = function () { reject(new Error('Network error')); };
                xhr.ontimeout = function () { reject(new Error('Timeout')); };
                xhr.send(body == null ? null : JSON.stringify(body));
            }
            catch (e) {
                reject(e);
            }
        });
    }
    function loadManifestFromBridge() {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const data = yield bridgeGet('/sync/manifest');
                if (data && data.groupId)
                    return data;
            }
            catch (_) { /* no cached manifest */ }
            return null;
        });
    }
    function httpPost(url, body) {
        return __awaiter(this, void 0, void 0, function* () {
            const r = yield fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body || {}),
            });
            if (!r.ok)
                throw new Error('HTTP ' + r.status);
            return r.json().catch(function () { return null; });
        });
    }
    function httpGet(url) {
        return __awaiter(this, void 0, void 0, function* () {
            const r = yield fetch(url, { method: 'GET' });
            if (!r.ok)
                throw new Error('HTTP ' + r.status);
            return r.json();
        });
    }
})(SyncEngine || (SyncEngine = {}));
