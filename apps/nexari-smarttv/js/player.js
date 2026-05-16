// Content Player Module - TypeScript Edition
/// <reference types="tizen-tv-webapis" />
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
/** Redact sensitive query parameters (token, access_token, auth, apiKey)
 *  from a URL before logging. Returns the original string if not parseable. */
function redactUrl(url) {
    try {
        const u = new URL(url);
        const params = u.searchParams;
        const sensitive = ['token', 'access_token', 'auth', 'apiKey', 'api_key'];
        for (let i = 0; i < sensitive.length; i++) {
            if (params.has(sensitive[i]))
                params.set(sensitive[i], '***');
        }
        u.search = params.toString();
        return u.toString();
    }
    catch (_a) {
        return String(url).replace(/([?&](?:token|access_token|auth|apiKey|api_key))=[^&]+/gi, '$1=***');
    }
}
const Player = {
    deviceId: null,
    deviceName: null,
    resellerBrandingLogoUrl: null,
    heartbeatInterval: null,
    telemetryInterval: null,
    commandPollInterval: null,
    contentRefreshInterval: null,
    logStreamInterval: null,
    wsConnection: null,
    wsWatchdogInterval: null,
    lastWsMessageAt: 0,
    currentContent: null,
    lastContentSignature: null,
    lastRenderedItemKey: null,
    playlistTimeout: null,
    currentPlaylistController: null,
    pendingPlaylist: null,
    pendingSignature: null,
    isDownloadingContent: false,
    pendingContent: null,
    lastDownloadProgress: 100,
    lastReadinessPayload: null,
    lastReadinessAt: 0,
    _loadInFlight: false,
    currentAvPlayProfileKey: null,
    deviceToken: null,
    // ── IPTV channel group runtime state ───────────────────────────────────
    currentChannelGroup: null,
    _channelDigitBuffer: '',
    _channelDigitTimer: null,
    _channelBannerEl: null,
    _channelBannerHideTimer: null,
    // Reconnect / stall recovery for IPTV
    _iptvReconnectCount: 0,
    _iptvReconnectTimer: null,
    _iptvOverlayEl: null,
    _iptvWatchdogTimer: null,
    _iptvLastTime: -1,
    _iptvStallCount: 0,
    // Tune debounce — coalesces rapid CH+/CH- mashing
    _tuneSeq: 0,
    _pendingTuneTimer: null,
    IPTV_MAX_RECONNECTS: 5,
    IPTV_RECONNECT_BASE_MS: 1500,
    ntpOffset: 0, // Offset in milliseconds from server time
    ntpSyncInProgress: false,
    lastNtpSync: 0,
    // Cached panel resolution for AVPlay setDisplayRect. Populated at init via
    // getPhysicalDisplaySize() (reads tizen.systeminfo DISPLAY + productinfo flags).
    // Falls back to FHD until detection completes.
    _panelWidth: 1920,
    _panelHeight: 1080,
    // Physical panel resolution (in real device pixels) � used for the
    // b2bapis.b2bsyncplay startSyncPlay() rect, which is interpreted in
    // physical pixels (NOT AVPlay's fixed 1920�1080 logical space). On a
    // 4K signage panel this is 3840�2160; on an FHD panel 1920�1080.
    // Populated asynchronously at init() from tizen.systeminfo DISPLAY.
    _physicalPanelWidth: 0,
    _physicalPanelHeight: 0,
    // Seamless AVPlay playlist support
    avPlayer1: null,
    avPlayer2: null,
    currentAvPlayer: null,
    seamlessPlaylistActive: false,
    // Zone mode
    _zoneMode: false,
    _zoneContainers: [],
    _zoneTimers: [],
    _zoneAVPlayers: [],
    _zoneAVPlayerMap: {}, // zone.id → avplaystore player
    _zoneSyncEnabled: false, // true when any zone has syncGroup set
    _zoneDocumentActive: false, // webapis.document is single-instance
    // Serialise VideoMixer prepare() calls across zones — Samsung TV rejects
    // concurrent prepare() with PLAYER_ERROR_NOT_SUPPORTED_FILE.
    _videoMixerQueue: Promise.resolve(),
    // Intra-device zone sync: gather all zones' play() calls and fire together
    _zoneSyncReadyQueue: [],
    _zoneSyncFlushTimer: null,
    _zoneSyncExpectedCount: 0,
    // Loop re-sync: when synced zones complete their stream, wait for ALL to complete
    // then seekTo(0)+play() simultaneously to prevent drift accumulation.
    _zoneSyncLoopQueue: [],
    // Document (PDF/Office) rendering state
    documentActive: false,
    documentItemKey: null,
    documentPageInterval: null,
    // Single-backend document support: PDF.js (works on Tizen 4/5/6.5+).
    documentBackend: null,
    b2bDocAutoFlipIntervalMs: 10000,
    // SyncPlay state (set when the active playlist belongs to a sync group).
    _syncMode: false,
    _syncGroupId: null,
    _activeSyncVideo: null,
    _syncStateTickStarted: false,
    _syncCurrentItemIndex: -1,
    _syncRateRestoreTimer: null,
    _pendingSyncNextItemAt: null,
    _pendingSyncNextItemIndex: -1,
    // Samsung b2bapis.b2bsyncplay (native firmware SyncPlay) state.
    // Active when the current playlist is rendered via firmware-level sync
    // instead of the JS SyncEngine + HTML5 path. The native API auto-discovers
    // peers via the shared 16-bit groupID and aligns frames in firmware.
    _nativeSyncActive: false,
    _nativeSyncGroupId: null,
    // Videowall Phase 2 (wall-engine + wall-sync subsystem)
    _videowallCurrentUrl: null,
    _wallRelayStarted: false,
    // Mixed-platform videowall: WS relay client (used when allTizen === false)
    _mixedRelayWs: null,
    _mixedRelayStop: null,
    // Cross-OS sync group relay (same JSON protocol, separate connection)
    _syncGroupRelayWs: null,
    _syncGroupRelayStop: null,
    // Last received SYNC_GROUP_INIT manifest (for relay bootstrap from renderPlaylist)
    _lastSyncGroupManifest: null,
    // Live calendar push handlers, keyed by contentId. Populated by
    // renderCalendar when it subscribes; cleared on unsubscribe / teardown.
    // The WS dispatcher routes incoming `calendar_events` here.
    _calendarPushHandlers: new Map(),
    // Initialize player
    init(device) {
        return __awaiter(this, void 0, void 0, function* () {
            this.deviceId = device.id;
            this.deviceName = device.name;
            this.deviceToken = device.deviceToken || localStorage.getItem('deviceToken') || '';
            try {
                const deployVersion = window === null || window === void 0 ? void 0 : window.PLAYER_DEPLOY_VERSION;
                const buildInfo = window === null || window === void 0 ? void 0 : window.PLAYER_BUILD_INFO;
                logger.info('Player deploy version:', deployVersion || 'unknown');
                if (buildInfo) {
                    logger.debug('Player build info:', buildInfo);
                }
            }
            catch (e) {
                // Never block startup on version logging
            }
            // Bind logger to this device for remote logs
            if (logger && typeof logger.setDevice === 'function') {
                logger.setDevice(this.deviceId);
            }
            logger.info('Initializing player for device:', this.deviceName);
            // Samsung AVPlay setDisplayRect() always uses a fixed 1920�1080 coordinate space,
            // per the official Samsung API docs: "The 4 parameters specify the left side, top,
            // window width, and window height based on a 1920 x 1080 resolution screen,
            // regardless of the actual application resolution."
            // Previously this was set to 3840�2160 (native panel pixels) which caused video to
            // render only in the top-left quadrant (1/4 of the screen) because the rect was 4�
            // larger than the 1920�1080 coordinate space. Do NOT use native panel pixels here.
            // On commercial signage panels window.innerWidth reports 1920 even on UHD,
            this._panelWidth = 1920;
            this._panelHeight = 1080;
            logger.info('AVPlay display rect coordinate space: 1920x1080 (fixed per Samsung API spec)');
            // Query physical panel resolution for b2bsyncplay rect.
            // We AWAIT this (with a 1 s timeout) so that _physicalPanelWidth/Height
            // are set before the first renderPlaylistNativeSync() call.
            yield new Promise((resolve) => {
                var _a;
                const timer = setTimeout(() => {
                    logger.warn('[Panel] DISPLAY query timed out � using screen.* fallback');
                    resolve();
                }, 1000);
                try {
                    const tz = window.tizen;
                    if ((_a = tz === null || tz === void 0 ? void 0 : tz.systeminfo) === null || _a === void 0 ? void 0 : _a.getPropertyValue) {
                        tz.systeminfo.getPropertyValue('DISPLAY', (d) => {
                            clearTimeout(timer);
                            const w = (d && (d.resolutionWidth | 0)) || 0;
                            const h = (d && (d.resolutionHeight | 0)) || 0;
                            if (w > 0 && h > 0) {
                                this._physicalPanelWidth = w;
                                this._physicalPanelHeight = h;
                                logger.info('[Panel] physical resolution: ' + w + 'x' + h);
                            }
                            else {
                                logger.warn('[Panel] DISPLAY query returned no resolution');
                            }
                            resolve();
                        }, (err) => {
                            clearTimeout(timer);
                            logger.warn('[Panel] DISPLAY query failed: ' + ((err === null || err === void 0 ? void 0 : err.message) || err));
                            resolve();
                        });
                    }
                    else {
                        clearTimeout(timer);
                        logger.warn('[Panel] tizen.systeminfo not available');
                        resolve();
                    }
                }
                catch (e) {
                    clearTimeout(timer);
                    logger.warn('[Panel] systeminfo DISPLAY threw: ' + ((e === null || e === void 0 ? void 0 : e.message) || e));
                    resolve();
                }
            });
            // Synchronize time with server for precise video wall sync
            yield this.syncTimeWithServer();
            // Show player screen
            this.showPlayerScreen();
            // Update UI
            document.getElementById('device-name').textContent = this.deviceName;
            // Connect to WebSocket for real-time updates
            this.connectWebSocket();
            this.startWebSocketWatchdog();
            // Start background tasks
            this.startHeartbeat();
            this.startTelemetry();
            this.startCommandPolling();
            this.startNtpSync(); // Periodic NTP sync to keep clocks aligned
            // Initialize SyncPlay engine (peer mesh; manifest may arrive later via WS).
            try {
                if (typeof SyncEngine !== 'undefined') {
                    SyncEngine.init({
                        deviceId: this.deviceId,
                        getSyncedTime: () => this.getSyncedTime(),
                        getNtpOffset: () => this.ntpOffset,
                        setNtpOffset: (v) => { this.ntpOffset = v; this.lastNtpSync = Date.now(); },
                        logger: logger,
                    });
                    SyncEngine.onSyncCommand((cmd) => {
                        try {
                            this.handleSyncCommand(cmd);
                        }
                        catch (e) {
                            logger.warn('handleSyncCommand threw:', (e === null || e === void 0 ? void 0 : e.message) || e);
                        }
                    });
                    this.startSyncStateTick();
                }
            }
            catch (e) {
                logger.warn('SyncEngine init failed:', (e === null || e === void 0 ? void 0 : e.message) || e);
            }
            // Defensive: clear any leftover firmware SyncPlay state from a previous
            // app launch � the firmware retains the last registered onChange and
            // playlist across reloads, which makes startSyncPlay() throw
            // "Can't register callback" on the next call.
            try {
                const nativeApi = this._getB2bSyncPlayApi();
                if (nativeApi) {
                    try {
                        nativeApi.stopSyncPlay(() => {
                            try {
                                nativeApi.clearSyncPlayList(() => { }, () => { });
                            }
                            catch (_) { }
                        });
                    }
                    catch (_) {
                        try {
                            nativeApi.clearSyncPlayList(() => { }, () => { });
                        }
                        catch (_) { }
                    }
                    logger.info('[NativeSync] firmware sync state reset on init');
                }
            }
            catch (_) { }
            // Load initial content
            yield this.loadContent();
            // Setup refresh interval
            this.startContentRefresh();
            this.startLogStream();
            // Initialize player settings overlay
            try {
                const self = this;
                const tizSettings = window.PlayerSettings;
                if (typeof tizSettings !== 'undefined') {
                    const cfg = window.CONFIG;
                    tizSettings.init({
                        getDeviceId: () => String(self.deviceId || ''),
                        getDeviceName: () => String(self.deviceName || ''),
                        getApiBase: () => (cfg && cfg.API_BASE) ? String(cfg.API_BASE) : '',
                        getWsConnected: () => !!(self.wsConnection && self.wsConnection.readyState === 1),
                        getIpAddress: () => { var _a; return String(((_a = window.DeviceState) === null || _a === void 0 ? void 0 : _a.lastIpAddress) || ''); },
                        getCurrentVersion: () => String((window.PLAYER_BUILD_INFO || {}).version || ''),
                        onClearCache: () => self.executeCommand({ type: 'CLEAR_CACHE' }),
                        onReloadContent: () => void self.loadContent(),
                    });
                    logger.info('[PlayerSettings] overlay initialized');
                }
            }
            catch (e) {
                logger.warn('[PlayerSettings] init failed:', (e === null || e === void 0 ? void 0 : e.message) || e);
            }
            logger.info('Player initialized successfully');
        });
    },
    // Show player screen
    showPlayerScreen() {
        document.getElementById('player-screen').classList.remove('hidden');
        document.getElementById('pairing-screen').classList.add('hidden');
        document.getElementById('error-screen').classList.add('hidden');
    },
    // Connect to WebSocket
    connectWebSocket() {
        try {
            const token = this.deviceToken || localStorage.getItem('deviceToken') || '';
            const wsUrl = `${CONFIG.WS_URL}/api/v1/devices/ws/device?token=${encodeURIComponent(token)}`;
            logger.info('Connecting to WebSocket:', redactUrl(wsUrl));
            this.wsConnection = new WebSocket(wsUrl);
            this.wsConnection.onopen = () => {
                logger.info('WebSocket connected');
                this.lastWsMessageAt = Date.now();
                this.updateConnectionStatus(true);
                void Telemetry.send(this.deviceId).catch((error) => {
                    logger.warn('Initial WebSocket telemetry failed:', error);
                });
                // Re-subscribe any active calendar content items. The server drops
                // subscriptions on socket close, so we must re-send on every reconnect.
                if (this._calendarPushHandlers.size > 0) {
                    const ws = this.wsConnection;
                    for (const contentId of this._calendarPushHandlers.keys()) {
                        try {
                            ws.send(JSON.stringify({ type: 'calendar_subscribe', payload: { contentId } }));
                            logger.info('Re-subscribed calendar after WS reconnect:', contentId);
                        }
                        catch (e) {
                            logger.warn('calendar re-subscribe failed', contentId, e);
                        }
                    }
                }
                // Reload content on reconnect so any publish/unpublish that happened
                // while the socket was down is picked up immediately.
                void this.loadContent();
                // Report installed apps once per connect (list changes rarely)
                setTimeout(() => { this.reportInstalledApps(); }, 3000);
            };
            this.wsConnection.onmessage = (event) => {
                this.lastWsMessageAt = Date.now();
                this.handleWebSocketMessage(event.data);
            };
            this.wsConnection.onerror = (error) => {
                logger.error('WebSocket error:', error);
                this.updateConnectionStatus(false);
            };
            this.wsConnection.onclose = () => {
                logger.warn('WebSocket disconnected, reconnecting in 5s...');
                this.lastWsMessageAt = 0;
                this.updateConnectionStatus(false);
                this.startWebSocketWatchdog();
                setTimeout(() => {
                    this.connectWebSocket();
                }, 5000);
            };
        }
        catch (error) {
            logger.error('Failed to connect WebSocket:', error);
            this.updateConnectionStatus(false);
        }
    },
    // Handle WebSocket messages
    handleWebSocketMessage(data) {
        var _a, _b, _c, _d, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u;
        try {
            const message = JSON.parse(data);
            const messageType = message.type || message.event;
            if (messageType === 'server_ack') {
                return;
            }
            logger.debug('WebSocket message:', message);
            // Support both 'type' and 'event' field names
            switch (messageType) {
                case 'server_ack':
                    break;
                case 'content-update':
                case 'schedule.updated':
                case 'schedule.created':
                case 'schedule.deleted':
                case 'content.published':
                case 'content.updated':
                    logger.info(`${messageType} received - refreshing content immediately`);
                    this.loadContent();
                    break;
                case 'command':
                    if (Array.isArray(message.commands)) {
                        logger.info('Commands received (batch):', message.commands.length);
                        message.commands.forEach((cmd) => this.executeCommand(cmd));
                    }
                    else {
                        logger.info('Command received:', message.command || message.payload || message);
                        this.executeCommand(message.command || message.payload || message);
                    }
                    break;
                case 'commands':
                    if (Array.isArray(message.commands)) {
                        logger.info('Commands received (array):', message.commands.length);
                        message.commands.forEach((cmd) => this.executeCommand(cmd));
                    }
                    else {
                        logger.warn('Commands event missing commands array');
                    }
                    break;
                case 'SYNC_PLAY':
                    logger.info('Sync play command received:', message.payload);
                    if (typeof SyncEngine !== 'undefined') {
                        SyncEngine.handleServerSyncPlay(message.payload);
                    }
                    break;
                case 'SYNC_GROUP_INIT':
                    logger.info('Sync group init received');
                    // Store manifest for relay bootstrap when renderPlaylist runs.
                    this._lastSyncGroupManifest = message;
                    if (message.allTizen === false) {
                        // Cross-OS group: connect to the Node.js relay WS immediately.
                        // renderPlaylist will also call this but it's idempotent (stops old first).
                        this._startSyncGroupRelay(message);
                    }
                    else {
                        // Tizen-only group: feed the JS SyncEngine for fallback / diagnostics.
                        if (typeof SyncEngine !== 'undefined') {
                            SyncEngine.setManifest(message);
                            if (message.syncRelayMode === 'lan') {
                                SyncEngine.onRoleChange((r) => {
                                    if (r === 'leader') {
                                        logger.info('[player] Elected as leader — starting node relay');
                                        this._startWallNodeRelay();
                                    }
                                });
                            }
                        }
                    }
                    this.loadContent();
                    break;
                case 'VIDEOWALL_INIT':
                    // The API sends all wall data as top-level fields on the WS message
                    // (not nested under .payload). Store the whole message as the manifest.
                    logger.info('Videowall init received:', message);
                    this._videowallManifest = message;
                    // Reuse the P2P SyncEngine for wall sync – feed it the peer/priority
                    // list from the videowall manifest.  groupId is the device group UUID
                    // (treated as an opaque string by the engine).
                    if (typeof SyncEngine !== 'undefined' && message.geometry) {
                        SyncEngine.setManifest({
                            groupId: message.deviceGroupId,
                            version: Date.now(),
                            leaderPriority: message.leaderPriority,
                            peers: message.peers,
                        });
                    }
                    // Phase 2: configure WallEngine ROI + start WallSync
                    if (message.geometry && message.myCell) {
                        const geo = message.geometry;
                        const mc = message.myCell;
                        const col = mc.positionCol;
                        const row = mc.positionRow;
                        const colSpan = mc.colSpan || 1;
                        const rowSpan = mc.rowSpan || 1;
                        let offsetX = 0;
                        for (let c = 0; c < col; c++)
                            offsetX += (geo.colWidths[c] || 0);
                        let offsetY = 0;
                        for (let r = 0; r < row; r++)
                            offsetY += (geo.rowHeights[r] || 0);
                        let cellW = 0;
                        for (let c = col; c < col + colSpan; c++)
                            cellW += (geo.colWidths[c] || 0);
                        let cellH = 0;
                        for (let r = row; r < row + rowSpan; r++)
                            cellH += (geo.rowHeights[r] || 0);
                        if (geo.canvasW && geo.canvasH && typeof WallEngine !== 'undefined') {
                            WallEngine.setWallCrop(offsetX / geo.canvasW, offsetY / geo.canvasH, cellW / geo.canvasW, cellH / geo.canvasH);
                            WallEngine.initEngine();
                        }
                        if (typeof WallSync !== 'undefined' && !WallSync.isRunning()
                            && message.leaderPriority && message.peers
                            && message.allTizen !== false) {
                            const leaderDeviceId = message.leaderPriority[0];
                            const leaderPeer = message.peers.find((p) => p.deviceId === leaderDeviceId);
                            // Prefer explicit relayUrl from manifest; fall back to deriving from lastKnownIp.
                            const wsUrl = message.relayUrl
                                || ((leaderPeer === null || leaderPeer === void 0 ? void 0 : leaderPeer.lastKnownIp) ? `ws://${leaderPeer.lastKnownIp}:9616` : null);
                            if (wsUrl) {
                                this._startWallNodeRelay();
                                WallSync.init({
                                    wsUrl,
                                    groupId: message.deviceGroupId,
                                    deviceId: this.deviceId,
                                    expectedPeers: message.peers.length,
                                    onStatus: (msg) => logger.info('[WallSync] ' + msg),
                                    getContentUrl: () => this._videowallCurrentUrl || null,
                                });
                            }
                        }
                        // Mixed-platform videowall: allTizen===false → connect to RFC 6455 relay.
                        if (message.allTizen === false && message.leaderPriority && message.peers) {
                            const isLeader = message.leaderPriority[0] === this.deviceId;
                            if (isLeader)
                                this._startWallNodeRelay();
                            this._startMixedWallSync(message);
                        }
                    }
                    // Re-check content so any pending videowall content starts rendering
                    // now that the manifest (crop geometry) is available.
                    this.loadContent();
                    break;
                case 'SESSION_CONFIG':
                    logger.info('SyncPlay session config received - refreshing content');
                    this.loadContent();
                    break;
                case 'reload':
                    logger.info('Reload command received');
                    location.reload();
                    break;
                case 'cell.update':
                    if (message.data && typeof DataSyncRenderer !== 'undefined') {
                        DataSyncRenderer.handleWSMessage({ event: 'cell.update', data: message.data });
                    }
                    break;
                case 'train.status':
                    if (message.data && typeof DataSyncRenderer !== 'undefined') {
                        DataSyncRenderer.handleWSMessage({ event: 'train.status', data: message.data });
                    }
                    break;
                case 'table.reload':
                    if (typeof DataSyncRenderer !== 'undefined') {
                        DataSyncRenderer.handleWSMessage({ event: 'table.reload' });
                    }
                    break;
                case 'APP_UPDATE':
                    logger.info('App update command received:', message);
                    if (typeof AppUpdater !== 'undefined') {
                        AppUpdater.handle(message, (statusType, data) => {
                            if (this.wsConnection && this.wsConnection.readyState === this.wsConnection.OPEN) {
                                this.wsConnection.send(JSON.stringify(Object.assign({ type: statusType, deviceId: this.deviceId }, (data || {}))));
                            }
                        });
                    }
                    else {
                        logger.warn('AppUpdater module not loaded');
                    }
                    break;
                // ── Our API WS commands (snake_case from server → ws.ts) ──────────────
                case 'refresh_schedule':
                    logger.info('refresh_schedule received - reloading content');
                    this.loadContent();
                    break;
                case 'calendar_events': {
                    const p = message.payload;
                    const cid = p === null || p === void 0 ? void 0 : p.contentId;
                    const handler = cid ? this._calendarPushHandlers.get(cid) : undefined;
                    if (handler && Array.isArray(p === null || p === void 0 ? void 0 : p.events)) {
                        try {
                            handler(p.events);
                        }
                        catch (e) {
                            logger.warn('calendar_events handler threw', e);
                        }
                    }
                    break;
                }
                case 'calendar_unavailable': {
                    const p = message.payload;
                    logger.warn('calendar_unavailable for', p === null || p === void 0 ? void 0 : p.contentId, p === null || p === void 0 ? void 0 : p.error);
                    // Player keeps the last good frame on screen; no UI change.
                    break;
                }
                case 'reboot':
                    logger.info('reboot command received');
                    this.executeCommand({ type: 'REBOOT' });
                    break;
                case 'relaunch_app':
                    logger.info('relaunch_app command received');
                    this.executeCommand({ type: 'RELAUNCH_APP' });
                    break;
                case 'device_rules':
                    logger.info('device_rules received:', (message.rules || []).length, 'rules');
                    if (typeof BleManager !== 'undefined') {
                        BleManager.setRules(message.rules || []);
                    }
                    this.preloadRulesContent(message.rules || []);
                    break;
                case 'ble_scan':
                    logger.info('ble_scan command received');
                    if (typeof BleManager !== 'undefined') {
                        BleManager.triggerOnDemandScan();
                    }
                    break;
                case 'power_off':
                    logger.info('power_off command received');
                    this.executeCommand({ type: 'POWER_OFF' });
                    break;
                case 'power_on':
                    logger.info('power_on command received');
                    this.executeCommand({ type: 'POWER_ON' });
                    break;
                case 'clear_cache':
                    logger.info('clear_cache command received');
                    this.executeCommand({ type: 'CLEAR_CACHE' });
                    break;
                case 'dump_logs':
                    logger.info('dump_logs command received');
                    this.executeCommand({ type: 'REQUEST_LOG_BURST' });
                    break;
                case 'update_player':
                    logger.info('update_player command received:', message.payload);
                    if (typeof AppUpdater !== 'undefined') {
                        const p = (message.payload || {});
                        AppUpdater.handle({
                            type: 'APP_UPDATE',
                            wgtUrl: p.downloadUrl || '',
                            version: p.version || '',
                            checksum: p.sha256,
                            packageId: p.packageId || p.version || '',
                        }, (statusType, data) => {
                            if (this.wsConnection && this.wsConnection.readyState === this.wsConnection.OPEN) {
                                this.wsConnection.send(JSON.stringify(Object.assign({ type: statusType, deviceId: this.deviceId }, (data || {}))));
                            }
                        });
                    }
                    break;
                case 'emergency_start':
                    logger.info('emergency_start received:', message.payload);
                    this.loadContent();
                    break;
                case 'ntp_resync': {
                    // Rate-limit: ignore if a sync completed within the last 30s
                    const msSinceSync = this.lastNtpSync ? Date.now() - this.lastNtpSync : Infinity;
                    if (msSinceSync < 30000) {
                        logger.debug(`ntp_resync ignored — last sync was ${Math.round(msSinceSync / 1000)}s ago`);
                        break;
                    }
                    logger.info('ntp_resync received from server — syncing now');
                    void this.syncTimeWithServer();
                    break;
                }
                case 'emergency_clear':
                    logger.info('emergency_clear received');
                    this.loadContent();
                    break;
                case 'set_ntp':
                case 'set_ir_lock':
                case 'set_button_lock':
                case 'set_on_timer':
                case 'set_off_timer':
                case 'clear_on_timer':
                case 'clear_off_timer':
                case 'set_zones':
                case 'update_tv_firmware':
                    logger.info(`Command received: ${messageType}`, message.payload);
                    this.executeCommand({ type: messageType.toUpperCase().replace(/-/g, '_'), payload: message.payload });
                    break;
                case 'tizen_probe': {
                    const tpRequestId = (_f = message.payload) === null || _f === void 0 ? void 0 : _f.requestId;
                    const tpWs = this.wsConnection;
                    function sendTizenProbeResult(sections) {
                        if (tpRequestId && tpWs && tpWs.readyState === WebSocket.OPEN) {
                            tpWs.send(JSON.stringify({ type: 'tizen_probe_result', payload: { requestId: tpRequestId, data: sections } }));
                        }
                    }
                    function tpSafe(fn) {
                        try {
                            return { value: fn() };
                        }
                        catch (e) {
                            const err = e;
                            const base = (err === null || err === void 0 ? void 0 : err.name) && (err === null || err === void 0 ? void 0 : err.message) ? `${err.name}: ${err.message}` : String(e);
                            const hint = (err === null || err === void 0 ? void 0 : err.name) === 'SecurityError' ? ' (partner certificate required or device not in developer mode — may also be LFD-only method)' : '';
                            return { error: base + hint };
                        }
                    }
                    // Like tpSafe but returns null on SecurityError (skip the entry entirely)
                    function tpPartner(fn) {
                        try {
                            return { value: fn() };
                        }
                        catch (e) {
                            const err = e;
                            if ((err === null || err === void 0 ? void 0 : err.name) === 'SecurityError')
                                return null;
                            const base = (err === null || err === void 0 ? void 0 : err.name) && (err === null || err === void 0 ? void 0 : err.message) ? `${err.name}: ${err.message}` : String(e);
                            return { error: base };
                        }
                    }
                    function tpJson(v, depth = 0) {
                        if (depth > 4)
                            return '[MaxDepth]';
                        if (v == null)
                            return v;
                        if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')
                            return v;
                        if (Array.isArray(v))
                            return v.map((x) => tpJson(x, depth + 1));
                        if (typeof v === 'object') {
                            const out = {};
                            for (const [k, xv] of Object.entries(v)) {
                                if (typeof xv !== 'function')
                                    out[k] = tpJson(xv, depth + 1);
                            }
                            return out;
                        }
                        return String(v);
                    }
                    const sections = {};
                    const rw = window;
                    const webapis = rw['webapis'];
                    // ProductInfo
                    const piEntries = [];
                    const pi = webapis === null || webapis === void 0 ? void 0 : webapis['productinfo'];
                    if (!pi) {
                        piEntries.push({ label: 'webapis.productinfo', error: 'Not available on this runtime' });
                    }
                    else {
                        piEntries.push(Object.assign({ label: 'Plugin version' }, tpSafe(() => pi['getVersion']())));
                        piEntries.push(Object.assign({ label: 'Firmware' }, tpSafe(() => pi['getFirmware']())));
                        piEntries.push(Object.assign({ label: 'DUID' }, tpSafe(() => pi['getDuid']())));
                        piEntries.push(Object.assign({ label: 'Model code' }, tpSafe(() => pi['getModelCode']())));
                        piEntries.push(Object.assign({ label: 'Model' }, tpSafe(() => pi['getModel']())));
                        piEntries.push(Object.assign({ label: 'Real model' }, tpSafe(() => pi['getRealModel']())));
                        piEntries.push(Object.assign({ label: 'Local set' }, tpSafe(() => pi['getLocalSet']())));
                        piEntries.push(Object.assign({ label: 'Licensed vendor' }, tpSafe(() => pi['getLicensedVendor']())));
                        piEntries.push(Object.assign({ label: 'Licensed brand' }, tpSafe(() => pi['getLicensedBrand']())));
                        piEntries.push(Object.assign({ label: 'SmartTV server type' }, tpSafe(() => pi['getSmartTVServerType']())));
                        piEntries.push(Object.assign({ label: 'SmartTV server version' }, tpSafe(() => pi['getSmartTVServerVersion']())));
                        piEntries.push(Object.assign({ label: 'UD panel' }, tpSafe(() => pi['isUdPanelSupported']())));
                        piEntries.push(Object.assign({ label: '8K panel' }, tpSafe(() => pi['is8KPanelSupported']())));
                        piEntries.push(Object.assign({ label: 'UHD premium' }, tpSafe(() => pi['isUHDAModel']())));
                        piEntries.push(Object.assign({ label: 'Wall model' }, tpSafe(() => pi['isWallModel']())));
                        piEntries.push(Object.assign({ label: 'Display rotator' }, tpSafe(() => pi['isDisplayRotatorSupported']())));
                        piEntries.push(Object.assign({ label: 'OLED panel' }, tpSafe(() => pi['isOledPanelSupported']())));
                    }
                    sections['productInfo'] = piEntries;
                    // Samsung SystemInfo
                    const siEntries = [];
                    const si = webapis === null || webapis === void 0 ? void 0 : webapis['systeminfo'];
                    if (!si) {
                        siEntries.push({ label: 'webapis.systeminfo', error: 'Not available on this runtime' });
                    }
                    else {
                        siEntries.push(Object.assign({ label: 'Plugin version' }, tpSafe(() => si['getVersion']())));
                        const audioCodecs = ['AAC', 'HE-AAC', 'AC3', 'E-AC3', 'OPUS', 'PCM'];
                        const audioResult = {};
                        for (const ac of audioCodecs) {
                            try {
                                audioResult[ac] = Boolean(si['isSupportedAudioCodec'](ac));
                            }
                            catch (e) {
                                audioResult[ac] = `Error: ${(_g = e === null || e === void 0 ? void 0 : e.message) !== null && _g !== void 0 ? _g : String(e)}`;
                            }
                        }
                        siEntries.push({ label: 'Audio codec support', value: audioResult });
                        const videoCodecs = ['H264', 'HEVC', 'VP9', 'MPEG4', 'JPEG', 'MJPEG'];
                        const videoResult = {};
                        for (const vc of videoCodecs) {
                            try {
                                videoResult[vc] = Boolean(si['isSupportedVideoCodec'](vc));
                            }
                            catch (e) {
                                videoResult[vc] = `Error: ${(_h = e === null || e === void 0 ? void 0 : e.message) !== null && _h !== void 0 ? _h : String(e)}`;
                            }
                        }
                        siEntries.push({ label: 'Video codec support', value: videoResult });
                    }
                    sections['samsungSystemInfo'] = siEntries;
                    // SystemControl
                    const scEntries = [];
                    const sc = webapis === null || webapis === void 0 ? void 0 : webapis['systemcontrol'];
                    if (!sc) {
                        scEntries.push({ label: 'webapis.systemcontrol', error: 'Not available on this runtime' });
                    }
                    else {
                        scEntries.push(Object.assign({ label: 'Plugin version' }, tpSafe(() => sc['getVersion']())));
                        const scPartnerFields = [
                            ['Serial number', () => sc['getSerialNumber']()],
                            ['Panel mute', () => sc['getPanelMute']()],
                            ['Safety lock', () => sc['getSafetyLock']()],
                            ['OSD orientation', () => sc['getOnScreenMenuOrientation']()],
                            ['PC connection', () => sc['getPCConnection']()],
                            ['Message display', () => sc['getMessageDisplay']()],
                            ['IR lock', () => sc['getIRLock']()],
                            ['Button lock', () => sc['getButtonLock']()],
                            ['Auto power on', () => sc['getAutoPowerOn']()],
                            ['Screen lamp schedule', () => tpJson(sc['getScreenLampSchedule']())],
                            ['Custom app info', () => tpJson(sc['getCustomAppInfo']())],
                            ['MagicInfo server info', () => tpJson(sc['getMagicinfoServerInfo']())],
                        ];
                        for (const [label, fn] of scPartnerFields) {
                            const r = tpPartner(fn);
                            if (r !== null)
                                scEntries.push(Object.assign({ label }, r));
                        }
                        if (scEntries.length === 1) {
                            scEntries.push({ label: 'Partner APIs', error: 'All SystemControl partner methods returned SecurityError — partner certificate required' });
                        }
                        const srcTypes = ['HDMI1', 'HDMI2', 'HDMI3', 'DP', 'MAGICINFO', 'INTERNAL_USB', 'URL_LAUNCHER'];
                        const srcOrient = {};
                        for (const stt of srcTypes) {
                            try {
                                srcOrient[stt] = sc['getSourceOrientation'](stt);
                            }
                            catch (e) {
                                srcOrient[stt] = `Error: ${(_j = e === null || e === void 0 ? void 0 : e.message) !== null && _j !== void 0 ? _j : String(e)}`;
                            }
                        }
                        scEntries.push({ label: 'Source orientations', value: srcOrient });
                    }
                    sections['systemControl'] = scEntries;
                    // Timer — tizen.time (standard, no partner privilege) + webapis.timer (partner-only, best-effort)
                    const tmEntries = [];
                    // tizen.time: standard Tizen Time API — always available without partner privilege
                    const tztime = (typeof tizen !== 'undefined' && tizen.time);
                    if (!tztime) {
                        tmEntries.push({ label: 'tizen.time', error: 'tizen.time not available on this runtime' });
                    }
                    else {
                        tmEntries.push(Object.assign({ label: 'Current date/time' }, tpSafe(() => String(tztime['getCurrentDateTime']()))));
                        tmEntries.push(Object.assign({ label: 'Local timezone' }, tpSafe(() => tztime['getLocalTimezone']())));
                        tmEntries.push(Object.assign({ label: 'Date format' }, tpSafe(() => tztime['getDateFormat']())));
                        tmEntries.push(Object.assign({ label: 'Time format' }, tpSafe(() => tztime['getTimeFormat']())));
                        tmEntries.push(Object.assign({ label: 'Available timezones (count)' }, tpSafe(() => { const z = tztime['getAvailableTimezones'](); return `${z.length} zones`; })));
                    }
                    // webapis.timer: Samsung partner-only API — requires Samsung partner privilege (SecurityError if not whitelisted)
                    const tm = webapis === null || webapis === void 0 ? void 0 : webapis['timer'];
                    if (!tm) {
                        tmEntries.push({ label: 'webapis.timer', error: 'Not available — Samsung partner privilege required' });
                    }
                    else {
                        tmEntries.push(Object.assign({ label: 'Plugin version' }, tpSafe(() => tm['getVersion']())));
                        tmEntries.push(Object.assign({ label: 'NTP settings (getNTP)' }, tpSafe(() => tpJson(tm['getNTP']()))));
                        tmEntries.push(Object.assign({ label: 'Current time (getCurrentTime)' }, tpSafe(() => String(tm['getCurrentTime']()))));
                        tmEntries.push(Object.assign({ label: 'Current timezone (getCurrentTimeZone)' }, tpSafe(() => tm['getCurrentTimeZone']())));
                    }
                    sections['timer'] = tmEntries;
                    // Remote Power
                    const rpEntries = [];
                    const rp = webapis === null || webapis === void 0 ? void 0 : webapis['remotepower'];
                    if (!rp) {
                        rpEntries.push({ label: 'webapis.remotepower', error: 'Not available — Samsung partner privilege required' });
                    }
                    else {
                        rpEntries.push(Object.assign({ label: 'Plugin version' }, tpSafe(() => rp['getVersion']())));
                        // getRemoteConfiguration — LFD only. Controls whether remote power is enabled.
                        rpEntries.push(Object.assign({ label: 'Remote Configuration ON/OFF (getRemoteConfiguration) [LFD]' }, tpSafe(() => rp['getRemoteConfiguration']())));
                        // getPowerState / getVirtualStandbyMode
                        rpEntries.push(Object.assign({ label: 'Power state (getPowerState)' }, tpSafe(() => rp['getPowerState']())));
                        rpEntries.push(Object.assign({ label: 'Virtual standby mode (getVirtualStandbyMode)' }, tpSafe(() => rp['getVirtualStandbyMode']())));
                    }
                    sections['remotePower'] = rpEntries;
                    // Custom App Info (webapis.systemcontrol — already available from sc above)
                    const caEntries = [];
                    if (!sc) {
                        caEntries.push({ label: 'webapis.systemcontrol', error: 'Not available — Samsung partner privilege required' });
                    }
                    else {
                        caEntries.push(Object.assign({ label: 'Custom app info (getCustomAppInfo)' }, tpSafe(() => tpJson(sc['getCustomAppInfo']()))));
                        if (typeof sc['getURLLauncherAddress'] === 'function') {
                            caEntries.push(Object.assign({ label: 'URL launcher address (getURLLauncherAddress)' }, tpSafe(() => sc['getURLLauncherAddress']())));
                        }
                        else {
                            caEntries.push({ label: 'URL launcher address (getURLLauncherAddress)', error: 'Not available on this model' });
                        }
                        if (typeof sc['getURLLauncherTimeOut'] === 'function') {
                            caEntries.push(Object.assign({ label: 'URL launcher timeout (getURLLauncherTimeOut)' }, tpSafe(() => sc['getURLLauncherTimeOut']())));
                        }
                        else {
                            caEntries.push({ label: 'URL launcher timeout (getURLLauncherTimeOut)', error: 'Not available on this model' });
                        }
                    }
                    sections['customAppInfo'] = caEntries;
                    // Tizen SystemInfo (async callbacks)
                    const tzEntries = [];
                    const tzsi = (typeof tizen !== 'undefined' && tizen.systeminfo);
                    if (!tzsi) {
                        tzEntries.push({ label: 'tizen.systeminfo', error: 'Not available on this runtime' });
                        sections['tizenSystemInfo'] = tzEntries;
                        sendTizenProbeResult(sections);
                    }
                    else {
                        const tzsiTyped = tzsi;
                        tzEntries.push(Object.assign({ label: 'Total memory (bytes)' }, tpSafe(() => tzsiTyped['getTotalMemory']())));
                        tzEntries.push(Object.assign({ label: 'Available memory (bytes)' }, tpSafe(() => tzsiTyped['getAvailableMemory']())));
                        try {
                            tzEntries.push({ label: 'Device uptime (seconds)', value: tzsiTyped['getDeviceUptime']() });
                        }
                        catch (e) {
                            tzEntries.push({ label: 'Device uptime (seconds)', error: `${(_k = e === null || e === void 0 ? void 0 : e.name) !== null && _k !== void 0 ? _k : 'Error'}: ${(_l = e === null || e === void 0 ? void 0 : e.message) !== null && _l !== void 0 ? _l : String(e)}` });
                        }
                        const capabilityKeys = [
                            'http://tizen.org/feature/screen',
                            'http://tizen.org/feature/network.wifi',
                            'http://tizen.org/feature/network.ethernet',
                            'http://tizen.org/feature/network.net_proxy',
                            'http://tizen.org/feature/battery',
                        ];
                        const capabilities = {};
                        for (const ck of capabilityKeys) {
                            try {
                                capabilities[ck] = tzsiTyped['getCapability'](ck);
                            }
                            catch (e) {
                                capabilities[ck] = `Error: ${(_m = e === null || e === void 0 ? void 0 : e.message) !== null && _m !== void 0 ? _m : String(e)}`;
                            }
                        }
                        tzEntries.push({ label: 'Capabilities', value: capabilities });
                        const propertyIds = ['BUILD', 'DISPLAY', 'LOCALE', 'NETWORK', 'WIFI_NETWORK', 'ETHERNET_NETWORK', 'STORAGE', 'MEMORY', 'PERIPHERAL', 'VIDEOSOURCE', 'PANEL'];
                        let propIndex = 0;
                        const fetchNextProperty = () => {
                            var _a, _b;
                            if (propIndex >= propertyIds.length) {
                                sections['tizenSystemInfo'] = tzEntries;
                                sendTizenProbeResult(sections);
                                return;
                            }
                            const propId = propertyIds[propIndex++];
                            try {
                                tzsiTyped['getPropertyValue'](propId, (val) => { tzEntries.push({ label: `Property: ${propId}`, value: tpJson(val) }); fetchNextProperty(); }, (err) => {
                                    var _a, _b;
                                    const e = err;
                                    tzEntries.push({ label: `Property: ${propId}`, error: `${(_a = e === null || e === void 0 ? void 0 : e.name) !== null && _a !== void 0 ? _a : 'Error'}: ${(_b = e === null || e === void 0 ? void 0 : e.message) !== null && _b !== void 0 ? _b : String(err)}` });
                                    fetchNextProperty();
                                });
                            }
                            catch (e) {
                                const ee = e;
                                tzEntries.push({ label: `Property: ${propId}`, error: `${(_a = ee === null || ee === void 0 ? void 0 : ee.name) !== null && _a !== void 0 ? _a : 'Error'}: ${(_b = ee === null || ee === void 0 ? void 0 : ee.message) !== null && _b !== void 0 ? _b : String(e)}` });
                                fetchNextProperty();
                            }
                        };
                        fetchNextProperty();
                    }
                    break;
                }
                case 'tizen_command': {
                    const tcPayload = message.payload;
                    const tcRequestId = tcPayload === null || tcPayload === void 0 ? void 0 : tcPayload.requestId;
                    const tcAction = tcPayload === null || tcPayload === void 0 ? void 0 : tcPayload.action;
                    const tcParams = tcPayload === null || tcPayload === void 0 ? void 0 : tcPayload.params;
                    const tcWs = this.wsConnection;
                    function sendTizenCommandResult(ok, value, error) {
                        if (tcRequestId && tcWs && tcWs.readyState === WebSocket.OPEN) {
                            tcWs.send(JSON.stringify({
                                type: 'tizen_command_result',
                                payload: Object.assign(Object.assign({ requestId: tcRequestId, ok }, (value !== undefined ? { value } : {})), (error !== undefined ? { error } : {})),
                            }));
                        }
                    }
                    function tcSafe(fn) {
                        try {
                            return { ok: true, value: fn() };
                        }
                        catch (e) {
                            const err = e;
                            const base = (err === null || err === void 0 ? void 0 : err.name) && (err === null || err === void 0 ? void 0 : err.message) ? `${err.name}: ${err.message}` : String(e);
                            const hint = (err === null || err === void 0 ? void 0 : err.name) === 'SecurityError' ? ' (partner certificate required or device not in developer mode — may also be LFD-only method)' : '';
                            return { ok: false, error: base + hint };
                        }
                    }
                    const rw2 = window;
                    const webapis2 = rw2['webapis'];
                    if (!tcAction) {
                        sendTizenCommandResult(false, undefined, 'Missing action');
                        break;
                    }
                    // ── Remote Power ──────────────────────────────────────────────────
                    if (tcAction === 'remotepower.setRemoteConfiguration') {
                        // LFD-only: enables (ON) or disables (OFF) remote power control
                        const rp2 = webapis2 === null || webapis2 === void 0 ? void 0 : webapis2['remotepower'];
                        if (!rp2) {
                            sendTizenCommandResult(false, undefined, 'webapis.remotepower not available');
                            break;
                        }
                        const configValue = (tcParams === 'ON' || tcParams === 'OFF') ? tcParams : 'ON';
                        const r = tcSafe(() => rp2['setRemoteConfiguration'](configValue));
                        sendTizenCommandResult(r.ok, r.ok ? `Remote configuration set to ${configValue}` : undefined, !r.ok ? r.error : undefined);
                        break;
                    }
                    if (tcAction === 'remotepower.powerOn') {
                        const rp2 = webapis2 === null || webapis2 === void 0 ? void 0 : webapis2['remotepower'];
                        if (!rp2) {
                            sendTizenCommandResult(false, undefined, 'webapis.remotepower not available');
                            break;
                        }
                        // Send result first — powerOn may cut the connection before a response could be sent
                        sendTizenCommandResult(true, 'Power on command sent');
                        setTimeout(() => { try {
                            rp2['powerOn']();
                        }
                        catch (_e) { /* best effort */ } }, 100);
                        break;
                    }
                    if (tcAction === 'remotepower.powerOff') {
                        // LFD + HTV. Requires Remote Configuration = ON. Turns off completely (or to standby if VirtualStandby active).
                        const rp2 = webapis2 === null || webapis2 === void 0 ? void 0 : webapis2['remotepower'];
                        if (!rp2) {
                            sendTizenCommandResult(false, undefined, 'webapis.remotepower not available');
                            break;
                        }
                        // Send result first — powerOff kills the WebSocket connection immediately
                        sendTizenCommandResult(true, 'Power off command sent');
                        setTimeout(() => { try {
                            rp2['powerOff']();
                        }
                        catch (_e) { /* best effort */ } }, 100);
                        break;
                    }
                    // ── Timer ─────────────────────────────────────────────────────────
                    if (tcAction === 'timer.setNTP') {
                        const tm2 = webapis2 === null || webapis2 === void 0 ? void 0 : webapis2['timer'];
                        if (!tm2) {
                            sendTizenCommandResult(false, undefined, 'webapis.timer not available');
                            break;
                        }
                        const r = tcSafe(() => tm2['setNTP'](tcParams));
                        sendTizenCommandResult(r.ok, r.ok ? r.value : undefined, !r.ok ? r.error : undefined);
                        break;
                    }
                    if (tcAction === 'timer.setCurrentTime') {
                        const tm2 = webapis2 === null || webapis2 === void 0 ? void 0 : webapis2['timer'];
                        if (!tm2) {
                            sendTizenCommandResult(false, undefined, 'webapis.timer not available');
                            break;
                        }
                        // tcParams expected to be a date string or timestamp; convert to Date
                        const dateArg = tcParams != null ? new Date(tcParams) : new Date();
                        const r = tcSafe(() => tm2['setCurrentTime'](dateArg));
                        sendTizenCommandResult(r.ok, r.ok ? r.value : undefined, !r.ok ? r.error : undefined);
                        break;
                    }
                    if (tcAction === 'timer.setCurrentTimeZone') {
                        const tm2 = webapis2 === null || webapis2 === void 0 ? void 0 : webapis2['timer'];
                        if (!tm2) {
                            sendTizenCommandResult(false, undefined, 'webapis.timer not available');
                            break;
                        }
                        const r = tcSafe(() => tm2['setCurrentTimeZone'](tcParams));
                        sendTizenCommandResult(r.ok, r.ok ? r.value : undefined, !r.ok ? r.error : undefined);
                        break;
                    }
                    // ── System Control (Custom App Info) ──────────────────────────────
                    if (tcAction === 'systemcontrol.setCustomAppInfo') {
                        const sc2 = webapis2 === null || webapis2 === void 0 ? void 0 : webapis2['systemcontrol'];
                        if (!sc2) {
                            sendTizenCommandResult(false, undefined, 'webapis.systemcontrol not available');
                            break;
                        }
                        const r = tcSafe(() => sc2['setCustomAppInfo'](tcParams));
                        sendTizenCommandResult(r.ok, r.ok ? r.value : undefined, !r.ok ? r.error : undefined);
                        break;
                    }
                    if (tcAction === 'systemcontrol.setURLLauncherAddress') {
                        const sc2 = webapis2 === null || webapis2 === void 0 ? void 0 : webapis2['systemcontrol'];
                        if (!sc2) {
                            sendTizenCommandResult(false, undefined, 'webapis.systemcontrol not available');
                            break;
                        }
                        const r = tcSafe(() => sc2['setURLLauncherAddress'](tcParams));
                        sendTizenCommandResult(r.ok, r.ok ? r.value : undefined, !r.ok ? r.error : undefined);
                        break;
                    }
                    if (tcAction === 'systemcontrol.setURLLauncherTimeOut') {
                        const sc2 = webapis2 === null || webapis2 === void 0 ? void 0 : webapis2['systemcontrol'];
                        if (!sc2) {
                            sendTizenCommandResult(false, undefined, 'webapis.systemcontrol not available');
                            break;
                        }
                        const r = tcSafe(() => sc2['setURLLauncherTimeOut'](tcParams));
                        sendTizenCommandResult(r.ok, r.ok ? r.value : undefined, !r.ok ? r.error : undefined);
                        break;
                    }
                    // ── Document API — routes through unified adapter (B2BDoc on Tizen 4, webapis.document on 6.5+) ──
                    if (tcAction && tcAction.indexOf('document.') === 0) {
                        const adapter = this._getDocControlAdapter();
                        const op = tcAction.slice('document.'.length);
                        const ok = (val) => sendTizenCommandResult(true, val !== null && val !== void 0 ? val : 'OK');
                        const err = (e) => {
                            const e2 = e;
                            const msg = (e2 === null || e2 === void 0 ? void 0 : e2.name) && (e2 === null || e2 === void 0 ? void 0 : e2.message) ? `${e2.name}: ${e2.message}` : String(e);
                            const hint = (e2 === null || e2 === void 0 ? void 0 : e2.name) === 'SecurityError' ? ' (partner certificate required or LFD-only method)' : '';
                            sendTizenCommandResult(false, undefined, msg + hint);
                        };
                        try {
                            switch (op) {
                                case 'getVersion': {
                                    const v = adapter.getVersion();
                                    if (v == null)
                                        sendTizenCommandResult(false, undefined, 'getVersion not supported on current backend');
                                    else
                                        sendTizenCommandResult(true, v);
                                    break;
                                }
                                case 'open': {
                                    const p = tcParams;
                                    const docinfo = {
                                        docpath: (_o = p === null || p === void 0 ? void 0 : p.docpath) !== null && _o !== void 0 ? _o : '',
                                        rectX: (_p = p === null || p === void 0 ? void 0 : p.rectX) !== null && _p !== void 0 ? _p : 0,
                                        rectY: (_q = p === null || p === void 0 ? void 0 : p.rectY) !== null && _q !== void 0 ? _q : 0,
                                        rectWidth: (_r = p === null || p === void 0 ? void 0 : p.rectWidth) !== null && _r !== void 0 ? _r : (window.innerWidth || 1920),
                                        rectHeight: (_s = p === null || p === void 0 ? void 0 : p.rectHeight) !== null && _s !== void 0 ? _s : (window.innerHeight || 1080),
                                    };
                                    adapter.open(docinfo, ok, err);
                                    break;
                                }
                                case 'close':
                                    adapter.close(ok, err);
                                    break;
                                case 'play': {
                                    const slideTime = typeof tcParams === 'number' ? tcParams : 10;
                                    adapter.play(slideTime, ok, err);
                                    break;
                                }
                                case 'stop':
                                    adapter.stop(ok, err);
                                    break;
                                case 'pause':
                                    adapter.pause(ok, err);
                                    break;
                                case 'resume':
                                    adapter.resume(ok, err);
                                    break;
                                case 'nextPage':
                                    adapter.nextPage(ok, err);
                                    break;
                                case 'prevPage':
                                    adapter.prevPage(ok, err);
                                    break;
                                case 'gotoPage': {
                                    const page = typeof tcParams === 'number' ? tcParams : 1;
                                    adapter.gotoPage(page, ok, err);
                                    break;
                                }
                                case 'setDocumentOrientation':
                                    adapter.setDocumentOrientation(ok, err);
                                    break;
                                // B2BDoc-only (Tizen 4)
                                case 'zoomIn':
                                    adapter.zoomIn(ok, err);
                                    break;
                                case 'zoomOut':
                                    adapter.zoomOut(ok, err);
                                    break;
                                case 'setZoom': {
                                    const level = typeof tcParams === 'number' ? tcParams : 1.0;
                                    adapter.setZoom(level, ok, err);
                                    break;
                                }
                                case 'fitToWidth':
                                    adapter.fitToWidth(ok, err);
                                    break;
                                case 'fitToHeight':
                                    adapter.fitToHeight(ok, err);
                                    break;
                                case 'resetView':
                                    adapter.resetView(ok, err);
                                    break;
                                case 'getPageCount':
                                    adapter.getPageCount(ok, err);
                                    break;
                                default:
                                    sendTizenCommandResult(false, undefined, `Unknown document action: ${op}`);
                            }
                        }
                        catch (e) {
                            const e2 = e;
                            sendTizenCommandResult(false, undefined, ((e2 === null || e2 === void 0 ? void 0 : e2.name) ? e2.name + ': ' : '') + ((e2 === null || e2 === void 0 ? void 0 : e2.message) || String(e)));
                        }
                        break;
                    }
                    // ── B2BControl API ─────────────────────────────────────────────────────
                    if (tcAction && tcAction.indexOf('b2b.') === 0) {
                        const rw3 = window;
                        const b2bc = (_u = (_t = rw3['b2bapis']) === null || _t === void 0 ? void 0 : _t.b2bcontrol) !== null && _u !== void 0 ? _u : null;
                        if (!b2bc) {
                            sendTizenCommandResult(false, undefined, 'b2bapis.b2bcontrol not available on this device');
                            break;
                        }
                        const b2bOk = (val) => sendTizenCommandResult(true, val !== undefined ? val : 'OK');
                        const b2bErr = (e) => {
                            var _a;
                            const e2 = e;
                            const base = (e2 === null || e2 === void 0 ? void 0 : e2.name) && (e2 === null || e2 === void 0 ? void 0 : e2.message) ? `${e2.name}: ${e2.message}` : ((_a = e2 === null || e2 === void 0 ? void 0 : e2.message) !== null && _a !== void 0 ? _a : String(e));
                            const hint = (e2 === null || e2 === void 0 ? void 0 : e2.name) === 'SecurityError' ? ' (partner certificate required or LFD-only)' : '';
                            sendTizenCommandResult(false, undefined, base + hint);
                        };
                        try {
                            switch (tcAction) {
                                // ── Power ────────────────────────────────────────────────────────
                                case 'b2b.setPower': {
                                    const on = tcParams === 'on' || tcParams === true || tcParams === 'ON';
                                    const methods = on
                                        ? [['panelOn', []], ['setPower', [true]], ['setDisplayOnOff', [true]], ['setPowerState', ['ON']]]
                                        : [['panelOff', []], ['setPower', [false]], ['setDisplayOnOff', [false]], ['setPowerState', ['OFF']], ['setPowerOff', []]];
                                    let dispatched = false;
                                    for (const [m, args] of methods) {
                                        if (typeof b2bc[m] === 'function') {
                                            b2bc[m](...args, () => b2bOk(`Power ${on ? 'on' : 'off'} via ${m}`), b2bErr);
                                            dispatched = true;
                                            break;
                                        }
                                    }
                                    if (!dispatched)
                                        sendTizenCommandResult(false, undefined, 'No suitable setPower method found on this device');
                                    break;
                                }
                                case 'b2b.getPower': {
                                    const methods = ['getPower', 'getPowerState', 'getPanelMuteStatus'];
                                    let dispatched = false;
                                    for (const m of methods) {
                                        if (typeof b2bc[m] === 'function') {
                                            b2bc[m]((val) => b2bOk(val), b2bErr);
                                            dispatched = true;
                                            break;
                                        }
                                    }
                                    if (!dispatched)
                                        sendTizenCommandResult(false, undefined, 'No getPower method found on this device');
                                    break;
                                }
                                // ── Input Source ─────────────────────────────────────────────────
                                case 'b2b.setInputSource': {
                                    if (typeof b2bc.setInputSource === 'function') {
                                        b2bc.setInputSource(tcParams, () => b2bOk(`Input set to ${tcParams}`), b2bErr);
                                    }
                                    else {
                                        sendTizenCommandResult(false, undefined, 'b2bcontrol.setInputSource not available');
                                    }
                                    break;
                                }
                                case 'b2b.getInputSource': {
                                    if (typeof b2bc.getInputSource === 'function') {
                                        b2bc.getInputSource((val) => b2bOk(val), b2bErr);
                                    }
                                    else {
                                        sendTizenCommandResult(false, undefined, 'b2bcontrol.getInputSource not available');
                                    }
                                    break;
                                }
                                // ── Volume ───────────────────────────────────────────────────────
                                case 'b2b.setVolume': {
                                    const vol = typeof tcParams === 'number' ? Math.max(0, Math.min(100, tcParams)) : 30;
                                    if (typeof b2bc.setVolume === 'function') {
                                        b2bc.setVolume(vol, () => b2bOk(`Volume set to ${vol}`), b2bErr);
                                    }
                                    else {
                                        sendTizenCommandResult(false, undefined, 'b2bcontrol.setVolume not available');
                                    }
                                    break;
                                }
                                case 'b2b.getVolume': {
                                    if (typeof b2bc.getVolume === 'function') {
                                        b2bc.getVolume((val) => b2bOk(val), b2bErr);
                                    }
                                    else {
                                        sendTizenCommandResult(false, undefined, 'b2bcontrol.getVolume not available');
                                    }
                                    break;
                                }
                                case 'b2b.setMute': {
                                    const mute = tcParams === true || tcParams === 'true';
                                    const muteMethod = ['setMute', 'setPanelMute', 'setPanelMuteStatus'].find(n => typeof b2bc[n] === 'function');
                                    if (muteMethod) {
                                        b2bc[muteMethod](mute, () => b2bOk(`Mute set to ${mute}`), b2bErr);
                                    }
                                    else {
                                        sendTizenCommandResult(false, undefined, 'No setMute method found on this device');
                                    }
                                    break;
                                }
                                // ── Brightness ───────────────────────────────────────────────────
                                case 'b2b.setBrightness': {
                                    const lum = typeof tcParams === 'number' ? Math.max(0, Math.min(100, tcParams)) : 70;
                                    const lumMethod = ['setDisplayBrightness', 'setBrightness'].find(n => typeof b2bc[n] === 'function');
                                    if (lumMethod) {
                                        b2bc[lumMethod](lum, () => b2bOk(`Brightness set to ${lum}`), b2bErr);
                                    }
                                    else {
                                        sendTizenCommandResult(false, undefined, 'No setBrightness method found on this device');
                                    }
                                    break;
                                }
                                case 'b2b.getBrightness': {
                                    const lumGetMethod = ['getDisplayBrightness', 'getBrightness'].find(n => typeof b2bc[n] === 'function');
                                    if (lumGetMethod) {
                                        b2bc[lumGetMethod]((val) => b2bOk(val), b2bErr);
                                    }
                                    else {
                                        sendTizenCommandResult(false, undefined, 'No getBrightness method found on this device');
                                    }
                                    break;
                                }
                                // ── Device Info ──────────────────────────────────────────────────
                                case 'b2b.getDeviceInfo': {
                                    if (typeof b2bc.getDeviceInfo === 'function') {
                                        b2bc.getDeviceInfo((val) => b2bOk(val), b2bErr);
                                    }
                                    else {
                                        sendTizenCommandResult(false, undefined, 'b2bcontrol.getDeviceInfo not available');
                                    }
                                    break;
                                }
                                // ── Reboot ───────────────────────────────────────────────────────
                                case 'b2b.reboot': {
                                    const rebootMethod = ['reboot', 'rebootDevice', 'setSystemReboot'].find(n => typeof b2bc[n] === 'function');
                                    if (rebootMethod) {
                                        // Send response first — reboot will cut the WebSocket connection
                                        sendTizenCommandResult(true, `Reboot initiated via b2bcontrol.${rebootMethod}`);
                                        setTimeout(() => { try {
                                            b2bc[rebootMethod]();
                                        }
                                        catch (_e) { /* best effort */ } }, 200);
                                    }
                                    else {
                                        sendTizenCommandResult(false, undefined, 'No reboot method found on this device');
                                    }
                                    break;
                                }
                                // ── App Control ──────────────────────────────────────────────────
                                case 'b2b.launchApp': {
                                    if (typeof b2bc.launchApp === 'function') {
                                        b2bc.launchApp(tcParams, () => b2bOk(`App launched: ${tcParams}`), b2bErr);
                                    }
                                    else {
                                        sendTizenCommandResult(false, undefined, 'b2bcontrol.launchApp not available');
                                    }
                                    break;
                                }
                                case 'b2b.stopApp': {
                                    if (typeof b2bc.stopApp === 'function') {
                                        b2bc.stopApp(() => b2bOk('App stopped'), b2bErr);
                                    }
                                    else {
                                        sendTizenCommandResult(false, undefined, 'b2bcontrol.stopApp not available');
                                    }
                                    break;
                                }
                                case 'b2b.getRunningApp': {
                                    if (typeof b2bc.getRunningApp === 'function') {
                                        b2bc.getRunningApp((val) => b2bOk(val), b2bErr);
                                    }
                                    else {
                                        sendTizenCommandResult(false, undefined, 'b2bcontrol.getRunningApp not available');
                                    }
                                    break;
                                }
                                // ── OSD & Kiosk Controls ─────────────────────────────────────────
                                case 'b2b.setOsdDisplay.show':
                                case 'b2b.setOsdDisplay.hide': {
                                    const show = tcAction === 'b2b.setOsdDisplay.show';
                                    if (typeof b2bc.setOsdDisplay === 'function') {
                                        b2bc.setOsdDisplay(show, () => b2bOk(`OSD ${show ? 'shown' : 'hidden'}`), b2bErr);
                                    }
                                    else {
                                        sendTizenCommandResult(false, undefined, 'b2bcontrol.setOsdDisplay not available');
                                    }
                                    break;
                                }
                                case 'b2b.setKeyLock.on':
                                case 'b2b.setKeyLock.off': {
                                    const lock = tcAction === 'b2b.setKeyLock.on';
                                    if (typeof b2bc.setKeyLock === 'function') {
                                        b2bc.setKeyLock(lock, () => b2bOk(`Key lock ${lock ? 'on' : 'off'}`), b2bErr);
                                    }
                                    else {
                                        sendTizenCommandResult(false, undefined, 'b2bcontrol.setKeyLock not available');
                                    }
                                    break;
                                }
                                case 'b2b.setButtonLock.on':
                                case 'b2b.setButtonLock.off': {
                                    const lock = tcAction === 'b2b.setButtonLock.on';
                                    if (typeof b2bc.setButtonLock === 'function') {
                                        b2bc.setButtonLock(lock, () => b2bOk(`Button lock ${lock ? 'on' : 'off'}`), b2bErr);
                                    }
                                    else {
                                        sendTizenCommandResult(false, undefined, 'b2bcontrol.setButtonLock not available');
                                    }
                                    break;
                                }
                                default:
                                    sendTizenCommandResult(false, undefined, `Unknown b2b action: ${tcAction}`);
                            }
                        }
                        catch (e) {
                            const e2 = e;
                            const hint = (e2 === null || e2 === void 0 ? void 0 : e2.name) === 'SecurityError' ? ' (partner certificate required)' : '';
                            sendTizenCommandResult(false, undefined, ((e2 === null || e2 === void 0 ? void 0 : e2.name) && (e2 === null || e2 === void 0 ? void 0 : e2.message) ? `${e2.name}: ${e2.message}` : String(e)) + hint);
                        }
                        break;
                    }
                    sendTizenCommandResult(false, undefined, `Unknown action: ${tcAction}`);
                    break;
                }
                default:
                    logger.debug('Unknown message type:', messageType);
            }
        }
        catch (error) {
            logger.error('Failed to parse WebSocket message:', error);
        }
    },
    // Update connection status indicator
    updateConnectionStatus(connected) {
        const statusIndicator = document.getElementById('connection-status');
        if (statusIndicator) {
            statusIndicator.style.color = connected ? '#10b981' : '#ef4444';
            statusIndicator.title = connected ? 'Connected' : 'Disconnected';
        }
        try {
            const tizSettings = window.PlayerSettings;
            if (typeof tizSettings !== 'undefined')
                tizSettings.setWsStatus(connected);
        }
        catch (_) { }
    },
    // Start heartbeat
    startHeartbeat() {
        // Heartbeat is sent via WebSocket only — no HTTP call
        this.heartbeatInterval = setInterval(() => {
            this.sendWebSocketHeartbeat();
        }, CONFIG.HEARTBEAT_INTERVAL);
    },
    // Report installed applications to the server via WebSocket (once per connect)
    reportInstalledApps() {
        try {
            if (typeof tizen === 'undefined' || !tizen.application) return;
            tizen.application.getAppsInfo(
                (apps) => {
                    const list = apps.map(a => ({
                        id: a.id,
                        name: a.name,
                        version: a.version || null,
                        iconPath: a.iconPath || null,
                        show: a.show,
                        categories: a.categories || [],
                    }));
                    if (this.wsConnection && this.wsConnection.readyState === 1) {
                        this.wsConnection.send(JSON.stringify({
                            type: 'installed_apps',
                            payload: list,
                        }));
                        logger.info('[Apps] Reported ' + list.length + ' installed apps to server');
                    }
                },
                (err) => { logger.warn('[Apps] getAppsInfo failed:', err.message); }
            );
        } catch (e) {
            logger.warn('[Apps] reportInstalledApps error:', e);
        }
    },
    // Build readiness payload for orchestration/readiness UI
    buildReadinessPayload() {
        var _a;
        const folderId = this.getCurrentFolderId();
        const downloadPct = Math.max(0, Math.min(100, (_a = this.lastDownloadProgress) !== null && _a !== void 0 ? _a : 0));
        // Legacy sync-orchestration removed. Keep a lightweight readiness model.
        const avState = this.currentItem ? 'PLAYING' : 'IDLE';
        const buffered = downloadPct >= 100 && !this.isDownloadingContent;
        const ready = buffered;
        return {
            deviceId: this.deviceId,
            folderId,
            downloadPct,
            driftMs: 0, // offset is already applied; residual drift is ~0 after sync
            avState,
            buffered,
            ready,
            displayRect: this.getDisplayRect(),
        };
    },
    getDisplayRect() {
        // AVPlay coordinate space is fixed at 1920x1080 per Samsung API docs.
        return {
            left: 0,
            top: 0,
            width: 1920,
            height: 1080,
        };
    },
    // -- Samsung native SyncPlay (b2bapis.b2bsyncplay) ------------------------
    // Returns the b2bsyncplay module if the firmware exposes it, else null.
    // Privilege http://developer.samsung.com/privilege/b2bsyncplay must be
    // declared in config.xml (already present). Tested on Tizen 4 SBB and
    // Tizen 6.5 QBC commercial signage firmware.
    _getB2bSyncPlayApi() {
        try {
            const w = window;
            const api = w.b2bapis && w.b2bapis.b2bsyncplay;
            if (api && typeof api.makeSyncPlayList === 'function' &&
                typeof api.startSyncPlay === 'function' &&
                typeof api.stopSyncPlay === 'function' &&
                typeof api.clearSyncPlayList === 'function') {
                return api;
            }
        }
        catch (_) { }
        return null;
    },
    // Returns the rect and rotation to pass to b2bsyncplay.startSyncPlay().
    // Samsung firmware spec: rect MUST be (0,0,1920,1080) — portrait/other dims
    // are out of spec ("Invalid Rect"). For portrait-mounted panels, pass
    // rotation='ON' so the firmware rotates the 1920x1080 plane to fit the
    // physical 1080x1920 screen. Landscape uses rotation='OFF'.
    _getSyncPlayRect() {
        const vw = window.innerWidth || 1920;
        const vh = window.innerHeight || 1080;
        const rotation = vh > vw ? 'ON' : 'OFF';
        return { x: 0, y: 0, w: 1920, h: 1080, rotation };
    },
    // Render a sync-group playlist via Samsung firmware SyncPlay. All TVs that
    // share the same numeric groupID and call startSyncPlay() with the same
    // playlist play in lockstep � firmware handles peer discovery, clock
    // alignment, and frame correction. Audio is left at firmware default
    // (multi-room audio sync is out of scope for this build).
    renderPlaylistNativeSync(playableItems, groupId, container) {
        const api = this._getB2bSyncPlayApi();
        if (!api) {
            logger.warn('[NativeSync] API unavailable at render time');
            return;
        }
        // Native SyncPlay owns the firmware video plane until stopped. Just drop
        // the JS-side playlist controller; do not call cancelCurrentPlayback()
        // (it would tear down AVPlay paths we are not using).
        if (this.currentPlaylistController) {
            this.currentPlaylistController.cancelled = true;
            this.currentPlaylistController = null;
        }
        if (this.playlistTimeout) {
            clearTimeout(this.playlistTimeout);
            this.playlistTimeout = null;
        }
        // Build the SyncPlayContents array. Native API expects { path, duration }
        // with file:// paths and integer seconds. content.url is already a
        // file:// path after content-manager has downloaded the asset.
        const syncPlayContents = [];
        for (const item of playableItems) {
            let url = item && item.content && item.content.url;
            if (!url)
                continue;
            // b2bsyncplay requires a `file://` URI (per Samsung b2bsync sample).
            // content-manager normally returns one already, but defensively prepend
            // the scheme if missing � without it the firmware silently drops the
            // makeSyncPlayList call (no success / no error callback fires).
            if (typeof url === 'string' && !url.startsWith('file://')) {
                url = 'file://' + (url.startsWith('/') ? url : ('/' + url));
            }
            const dur = Math.max(1, Math.round(Number(item.duration) || 10));
            syncPlayContents.push({ path: url, duration: dur });
        }
        if (syncPlayContents.length === 0) {
            logger.warn('[NativeSync] No items with usable file:// URLs � aborting');
            this.showIdleScreen();
            return;
        }
        logger.info('[NativeSync] Building playlist (' + syncPlayContents.length +
            ' items, groupID=' + groupId + ')');
        // Promote per-item log to info so the actual paths show up in remote
        // logs while we are diagnosing native-sync engagement.
        syncPlayContents.forEach((c, i) => logger.info('[NativeSync]   [' + i + '] ' + c.path + ' (' + c.duration + 's)'));
        // Hide the DOM content container so the firmware video plane is visible.
        this.setAvPlayVisualMode(true);
        if (container) {
            try {
                container.innerHTML = '';
            }
            catch (_) { }
        }
        const startNativeSync = () => {
            try {
                api.makeSyncPlayList(syncPlayContents, () => {
                    logger.info('[NativeSync] makeSyncPlayList ok');
                    this._startNativeSyncPlay(api, groupId);
                }, (err) => {
                    logger.warn('[NativeSync] makeSyncPlayList failed: ' +
                        (err && (err.message || err.name)) + ' � reverting visual mode');
                    this._nativeSyncActive = false;
                    this._nativeSyncGroupId = null;
                    this.setAvPlayVisualMode(false);
                });
            }
            catch (e) {
                logger.warn('[NativeSync] makeSyncPlayList threw: ' + ((e === null || e === void 0 ? void 0 : e.message) || e));
                this._nativeSyncActive = false;
                this._nativeSyncGroupId = null;
                this.setAvPlayVisualMode(false);
            }
        };
        // Sequential teardown -> rebuild -> start prevents "Can't register callback".
        // stopSyncPlay unregisters any live firmware onChange from a previous session
        // (including ghost sessions after a page reload). clearSyncPlayList resets the
        // playlist. Only after both complete do we call makeSyncPlayList + startSyncPlay.
        // Per-step fallback timeouts prevent stalls if a callback never fires.
        let cleared = false;
        const doClear = (reason) => {
            if (cleared)
                return;
            cleared = true;
            logger.info('[NativeSync] doClear (' + reason + ') -> clearSyncPlayList');
            let started = false;
            const begin = (r) => {
                if (started)
                    return;
                started = true;
                logger.info('[NativeSync] begin (' + r + ') -> makeSyncPlayList');
                startNativeSync();
            };
            try {
                api.clearSyncPlayList(() => { logger.info('[NativeSync] clearSyncPlayList ok'); begin('clear-ok'); }, () => { logger.warn('[NativeSync] clearSyncPlayList err'); begin('clear-err'); });
            }
            catch (e) {
                logger.warn('[NativeSync] clearSyncPlayList threw: ' + ((e === null || e === void 0 ? void 0 : e.message) || e));
                begin('clear-throw');
            }
            setTimeout(() => begin('clear-timeout'), 500);
        };
        // Always stop first: unregisters any live onChange callback in the firmware.
        try {
            api.stopSyncPlay(() => { logger.info('[NativeSync] stopSyncPlay ok'); setTimeout(() => doClear('stop-ok'), 50); }, () => { logger.warn('[NativeSync] stopSyncPlay err'); doClear('stop-err'); });
        }
        catch (e) {
            logger.warn('[NativeSync] stopSyncPlay threw: ' + ((e === null || e === void 0 ? void 0 : e.message) || e));
            doClear('stop-throw');
        }
        setTimeout(() => doClear('stop-timeout'), 600);
    },
    // Start the on-TV Node relay (b2bcontrol.startNodeServer → js/logic.js on :9616).
    // Safe to call multiple times — guarded by _wallRelayStarted flag.
    _startWallNodeRelay() {
        var _a, _b;
        if (this._wallRelayStarted)
            return;
        this._wallRelayStarted = true;
        const b2b = window.b2bapis && window.b2bapis.b2bcontrol;
        if (!b2b || typeof b2b.startNodeServer !== 'function') {
            logger.warn('[WallRelay] b2bcontrol.startNodeServer unavailable — relay not started');
            return;
        }
        let pv = '6.0';
        try {
            pv = ((_b = (_a = window.tizen) === null || _a === void 0 ? void 0 : _a.systeminfo) === null || _b === void 0 ? void 0 : _b.getCapability('http://tizen.org/feature/platform.version')) || pv;
        }
        catch (_c) { }
        const stub = pv.startsWith('4.') ? '../lib/server2018.js.signed'
            : pv.startsWith('5.') ? '../lib/server2019.js.signed'
                : '../lib/server2022.js.signed';
        logger.info(`[WallRelay] starting ${stub}`);
        try {
            b2b.startNodeServer(stub, 'nexari-wall-relay', () => logger.info('[WallRelay] running on :9616'), (e) => logger.warn('[WallRelay] start failed: ' + (e && e.message ? e.message : e)));
        }
        catch (e) {
            logger.warn('[WallRelay] startNodeServer threw: ' + (e && e.message ? e.message : e));
        }
    },
    /**
     * Mixed-platform videowall sync — connects to the RFC 6455 relay as a WS
     * client using the same JSON protocol as sync.ts (cloud relay).
     * Used when allTizen===false (Windows/Android leader or mixed group).
     */
    _startMixedWallSync(manifest) {
        // Tear down any previous connection.
        if (this._mixedRelayStop) {
            try {
                this._mixedRelayStop();
            }
            catch (_a) { }
            this._mixedRelayStop = null;
        }
        // Derive relay URL from this device's own API base (not manifest.relayUrl which may
        // be the cloud domain while devices are on a local network).
        const tizenApiBase = (typeof CONFIG !== 'undefined' && CONFIG.API_BASE) || '';
        const tizenWsBase = tizenApiBase.replace(/^http/, 'ws').replace(/\/api\/v1\/?$/, '');
        const tizenToken = this.deviceToken || localStorage.getItem('deviceToken') || '';
        const relayUrl = tizenWsBase
            ? `${tizenWsBase}/api/v1/sync-relay/ws?token=${encodeURIComponent(tizenToken)}`
            : manifest.relayUrl;
        const groupId = manifest.deviceGroupId;
        const deviceId = this.deviceId;
        if (!relayUrl)
            return;
        const self = this;
        let stopped = false;
        let goTimer = null;
        let reconnTimer = null;
        let readySent = false;
        const sendIfOpen = (ws, obj) => {
            if (ws.readyState === 1)
                try {
                    ws.send(JSON.stringify(obj));
                }
                catch (_a) { }
        };
        const connect = () => {
            if (stopped)
                return;
            const ws = new WebSocket(relayUrl);
            self._mixedRelayWs = ws;
            ws.onopen = () => {
                readySent = false;
                sendIfOpen(ws, { type: 'WS_REGISTER', deviceId, groupId });
                logger.info('[MixedWall] registered → ' + relayUrl);
                // Poll until content is loaded, then send READY.
                const pollReady = () => {
                    if (stopped || readySent)
                        return;
                    if (self._videowallCurrentUrl) {
                        readySent = true;
                        sendIfOpen(ws, { type: 'READY' });
                        logger.info('[MixedWall] READY sent');
                    }
                    else {
                        setTimeout(pollReady, 500);
                    }
                };
                pollReady();
            };
            ws.onmessage = (ev) => {
                let msg;
                try {
                    msg = JSON.parse(ev.data);
                }
                catch (_a) {
                    return;
                }
                if (msg.type === 'LOAD_URL') {
                    // Leader says "load this URL" — Tizen already loads from schedule,
                    // but reset readySent so we re-confirm when our content is ready.
                    readySent = false;
                    const pollReady = () => {
                        if (stopped || readySent)
                            return;
                        if (self._videowallCurrentUrl) {
                            readySent = true;
                            sendIfOpen(ws, { type: 'READY' });
                            logger.info('[MixedWall] READY re-sent (LOAD_URL trigger)');
                        }
                        else {
                            setTimeout(pollReady, 500);
                        }
                    };
                    setTimeout(pollReady, 100);
                    return;
                }
                if (msg.type === 'GO' || msg.type === 'LOOP_GO') {
                    const playAt = Number(msg.playAt);
                    const delay = Math.max(0, playAt - Date.now());
                    logger.info('[MixedWall] ' + msg.type + ' in ' + delay + 'ms');
                    if (goTimer)
                        clearTimeout(goTimer);
                    goTimer = setTimeout(() => {
                        // Seek current AVPlay instance to 0 and play for synchronized start.
                        const player = self.currentAvPlayer === 'player1' ? self.avPlayer1 : self.avPlayer2;
                        if (player) {
                            try {
                                player.seek(0);
                            }
                            catch (_a) { }
                            try {
                                player.play();
                            }
                            catch (_b) { }
                        }
                        logger.info('[MixedWall] play triggered');
                        // After loop starts playing, send LOOP_READY for next loop barrier.
                        const dur = player ? (player.getDuration() || 10000) : 10000;
                        setTimeout(() => {
                            if (!stopped && ws.readyState === 1) {
                                sendIfOpen(ws, { type: 'LOOP_READY', groupId, deviceId });
                                logger.info('[MixedWall] LOOP_READY sent');
                            }
                        }, Math.max(dur - 1000, 500));
                    }, delay);
                    return;
                }
            };
            ws.onerror = () => logger.warn('[MixedWall] WS error');
            ws.onclose = () => {
                self._mixedRelayWs = null;
                if (!stopped) {
                    reconnTimer = setTimeout(connect, 2000);
                    logger.warn('[MixedWall] WS closed — reconnecting');
                }
            };
        };
        this._mixedRelayStop = () => {
            stopped = true;
            if (goTimer)
                clearTimeout(goTimer);
            if (reconnTimer)
                clearTimeout(reconnTimer);
            if (self._mixedRelayWs) {
                try {
                    self._mixedRelayWs.close();
                }
                catch (_a) { }
                self._mixedRelayWs = null;
            }
        };
        connect();
    },
    /**
     * Cross-OS sync group relay — WS client using the same Node.js relay JSON
     * protocol as Android/Windows (WS_REGISTER, PING/PONG, READY/GO, LOOP_READY/LOOP_GO).
     * Used when allTizen===false (mixed Tizen + Android/Windows group).
     *
     * This keeps Tizen in step with the relay leader (usually Android or Windows)
     * without any Samsung b2bsyncplay API calls.
     */
    _startSyncGroupRelay(manifest) {
        // Tear down any previous connection.
        if (this._syncGroupRelayStop) {
            try {
                this._syncGroupRelayStop();
            }
            catch (_a) { }
            this._syncGroupRelayStop = null;
        }
        const groupId = manifest.syncGroupId || manifest.groupId || '';
        const deviceId = this.deviceId;
        const token = this.deviceToken || localStorage.getItem('deviceToken') || '';
        // Always derive the relay URL from the device's own API base so it uses the
        // same host/IP the device is already connected to (LAN or cloud).
        // The manifest's relayUrl is unreliable (built from APP_URL, may be cloud domain
        // even when devices are on a local network).
        const apiBase = (typeof CONFIG !== 'undefined' && CONFIG.API_BASE) || '';
        const wsBase = apiBase.replace(/^http/, 'ws').replace(/\/api\/v1\/?$/, '');
        const relayUrl = wsBase
            ? `${wsBase}/api/v1/sync-relay/ws?token=${encodeURIComponent(token)}`
            : null;
        if (!relayUrl) {
            logger.warn('[SyncRelay] cannot derive relayUrl from CONFIG.API_BASE, aborting');
            return;
        }
        // Determine if this device is the relay leader.
        const leaderPriority = Array.isArray(manifest.leaderPriority) ? manifest.leaderPriority : [];
        const isLeader = leaderPriority.length > 0 && leaderPriority[0] === deviceId;
        // If this Tizen device is the leader, start the Node relay server (b2bcontrol).
        if (isLeader)
            this._startWallNodeRelay();
        const self = this;
        let stopped = false;
        let goTimer = null;
        let loopTimer = null;
        let reconnTimer = null;
        let readySent = false;
        let currentItemIndex = 0;
        // Clock offset: serverTime = localTime + _relayClockOffset
        let _relayClockOffset = 0;
        const sendIfOpen = (ws, obj) => {
            if (ws.readyState === 1)
                try {
                    ws.send(JSON.stringify(obj));
                }
                catch (_a) { }
        };
        // Measure server clock offset via PING/PONG (5 samples, best RTT wins).
        const measureClockOffset = (ws) => {
            return new Promise((resolve) => {
                const SAMPLES = 5;
                const results = [];
                let remaining = SAMPLES;
                const finish = () => {
                    if (results.length > 0) {
                        results.sort((a, b) => a.rtt - b.rtt);
                        _relayClockOffset = results[0].offset;
                        logger.info('[SyncRelay] clock offset=' + _relayClockOffset + 'ms rtt=' + results[0].rtt + 'ms');
                    }
                    resolve();
                };
                for (let i = 0; i < SAMPLES; i++) {
                    setTimeout(() => {
                        if (stopped || ws.readyState !== 1) {
                            if (--remaining === 0)
                                finish();
                            return;
                        }
                        const t1 = Date.now();
                        const handler = (ev2) => {
                            let m;
                            try {
                                m = JSON.parse(ev2.data);
                            }
                            catch (_a) {
                                return;
                            }
                            if (!m || m.type !== 'PONG' || m.t1 !== t1)
                                return;
                            ws.removeEventListener('message', handler);
                            const t3 = Date.now();
                            results.push({ offset: Math.round(m.t2 + (t3 - t1) / 2 - t3), rtt: t3 - t1 });
                            if (--remaining === 0)
                                finish();
                        };
                        ws.addEventListener('message', handler);
                        sendIfOpen(ws, { type: 'PING', t1 });
                        setTimeout(() => { ws.removeEventListener('message', handler); if (--remaining === 0)
                            finish(); }, 1000);
                    }, i * 60);
                }
            });
        };
        // Poll until the current video is ready (src set and can play), then send READY.
        const pollAndSendReady = (ws) => {
            var _a;
            if (stopped || readySent)
                return;
            const video = self._activeSyncVideo ||
                ((_a = document.getElementById('content-container')) === null || _a === void 0 ? void 0 : _a.querySelector('video'));
            if (video && (video.readyState >= 2 || video.src)) {
                readySent = true;
                sendIfOpen(ws, { type: 'READY', groupId, deviceId });
                logger.info('[SyncRelay] READY sent (item ' + currentItemIndex + ')');
            }
            else {
                setTimeout(() => pollAndSendReady(ws), 300);
            }
        };
        // Schedule playback at an absolute epoch ms (server time from relay).
        const schedulePlayAt = (serverPlayAt) => {
            // Convert server epoch to local time using measured clock offset.
            const localPlayAt = serverPlayAt - _relayClockOffset;
            const delay = Math.max(0, localPlayAt - Date.now());
            logger.info('[SyncRelay] scheduled play in ' + delay + 'ms (serverEpoch=' + serverPlayAt + ' offset=' + _relayClockOffset + ')');
            if (goTimer)
                clearTimeout(goTimer);
            goTimer = setTimeout(() => {
                var _a;
                if (stopped)
                    return;
                // Seek current video to 0 and play for a synchronized start.
                const video = self._activeSyncVideo ||
                    ((_a = document.getElementById('content-container')) === null || _a === void 0 ? void 0 : _a.querySelector('video'));
                if (video) {
                    try {
                        video.currentTime = 0;
                    }
                    catch (_b) { }
                    video.play().catch(() => { });
                    // Schedule LOOP_READY ~800 ms before video ends.
                    const durMs = (video.duration || 10) * 1000;
                    if (loopTimer)
                        clearTimeout(loopTimer);
                    loopTimer = setTimeout(() => {
                        if (!stopped) {
                            readySent = false;
                            sendIfOpen(ws, { type: 'LOOP_READY', groupId, deviceId });
                            logger.info('[SyncRelay] LOOP_READY sent');
                        }
                    }, Math.max(durMs - 800, 200));
                }
                logger.info('[SyncRelay] play triggered (item ' + currentItemIndex + ')');
            }, delay);
        };
        let ws;
        const connect = () => {
            if (stopped)
                return;
            ws = new WebSocket(relayUrl);
            self._syncGroupRelayWs = ws;
            ws.onopen = () => {
                readySent = false;
                // Measure clock offset first, then register + start polling.
                measureClockOffset(ws).then(() => {
                    if (stopped)
                        return;
                    sendIfOpen(ws, { type: 'WS_REGISTER', deviceId, groupId });
                    logger.info('[SyncRelay] registered → ' + relayUrl);
                    pollAndSendReady(ws);
                });
            };
            ws.onmessage = (ev) => {
                let msg;
                try {
                    msg = JSON.parse(ev.data);
                }
                catch (_a) {
                    return;
                }
                const t = msg && msg.type;
                if (t === 'PING') {
                    sendIfOpen(ws, { type: 'PONG', t1: msg.t1, t2: Date.now() });
                    return;
                }
                if (t === 'LOAD_URL') {
                    // Leader broadcast a content index — reset READY flag and re-confirm when video is ready.
                    readySent = false;
                    setTimeout(() => pollAndSendReady(ws), 100);
                    return;
                }
                if (t === 'GO' || t === 'LOOP_GO') {
                    logger.info('[SyncRelay] ' + t + ' playAt=' + msg.playAt);
                    if (t === 'LOOP_GO')
                        currentItemIndex = (currentItemIndex + 1);
                    schedulePlayAt(Number(msg.playAt));
                    return;
                }
                if (t === 'PEERS') {
                    logger.info('[SyncRelay] PEERS: ' + JSON.stringify(msg.peers));
                    return;
                }
                if (t === 'HEARTBEAT_PEERS')
                    return; // informational
            };
            ws.onerror = () => logger.warn('[SyncRelay] WS error');
            ws.onclose = () => {
                self._syncGroupRelayWs = null;
                if (!stopped) {
                    reconnTimer = setTimeout(connect, 2000);
                    logger.warn('[SyncRelay] WS closed — reconnecting in 2s');
                }
            };
        };
        this._syncGroupRelayStop = () => {
            stopped = true;
            if (goTimer)
                clearTimeout(goTimer);
            if (loopTimer)
                clearTimeout(loopTimer);
            if (reconnTimer)
                clearTimeout(reconnTimer);
            if (self._syncGroupRelayWs) {
                try {
                    self._syncGroupRelayWs.close();
                }
                catch (_a) { }
                self._syncGroupRelayWs = null;
            }
            logger.info('[SyncRelay] stopped');
        };
        connect();
    },
    // (sample uses 5 for full-screen, 7 for rotated) is mirrored from the
    // Samsung b2bsync sample.
    _startNativeSyncPlay(api, groupId) {
        const onChange = (data) => {
            try {
                const code = data && data.code;
                const payload = data && data.data;
                const errName = data && data.errorName;
                const errMsg = data && data.errorMessage;
                // The firmware reports errorName="success" on normal lifecycle events;
                // only warn when code is non-zero or errorName is something else.
                const isError = (typeof code === 'number' && code !== 0) ||
                    (errName && errName !== 'success');
                if (isError) {
                    logger.warn('[NativeSync] onChange code=' + code + ' err=' + errName + ' msg=' + errMsg);
                }
                else {
                    logger.debug('[NativeSync] onChange code=' + code + ' data=' + payload);
                }
            }
            catch (_) { }
        };
        // -- Rect & rotation -------------------------------------------------
        // Use CSS viewport dimensions so the video fills the physical panel.
        // _getSyncPlayRect() auto-detects portrait (innerHeight > innerWidth) and
        // returns rotation='90' with swapped dims so b2bsyncplay fills the screen.
        const { x: rectX, y: rectY, w: rectW, h: rectH, rotation } = this._getSyncPlayRect();
        // -- Diagnostic: log everything about the display coordinate space -----
        try {
            const dpr = window.devicePixelRatio || 1;
            const sw = screen.width || '?';
            const sh = screen.height || '?';
            const iw = window.innerWidth || '?';
            const ih = window.innerHeight || '?';
            const docW = document.documentElement ? document.documentElement.clientWidth : '?';
            const docH = document.documentElement ? document.documentElement.clientHeight : '?';
            const bodyW = document.body ? document.body.clientWidth : '?';
            const bodyH = document.body ? document.body.clientHeight : '?';
            logger.info('[NativeSync-DIAG] screen=' + sw + 'x' + sh + ' inner=' + iw + 'x' + ih + ' dpr=' + dpr + ' docClient=' + docW + 'x' + docH + ' body=' + bodyW + 'x' + bodyH);
            // Try Tizen system display info
            try {
                const ti = window.tizen;
                if (ti && ti.systeminfo && ti.systeminfo.getPropertyValue) {
                    ti.systeminfo.getPropertyValue('DISPLAY', (info) => {
                        logger.info('[NativeSync-DIAG] tizen DISPLAY resW=' + (info && info.resolutionWidth) + ' resH=' + (info && info.resolutionHeight) + ' dotsPerInch=' + (info && info.dotsPerInch));
                    }, (err) => {
                        logger.warn('[NativeSync-DIAG] tizen DISPLAY err: ' + (err && err.message));
                    });
                }
            }
            catch (tizenErr) {
                logger.warn('[NativeSync-DIAG] tizen sysinfo threw: ' + tizenErr.message);
            }
            // Log DOM state of player-screen at moment of startSyncPlay
            const ps = document.getElementById('player-screen');
            if (ps) {
                const psCR = ps.getBoundingClientRect();
                logger.info('[NativeSync-DIAG] player-screen classList="' + ps.className + '" display="' + ps.style.display + '" rect=' + psCR.left + ',' + psCR.top + ',' + psCR.width + 'x' + psCR.height);
            }
            const body = document.body;
            if (body) {
                logger.info('[NativeSync-DIAG] body style: w=' + body.style.width + ' h=' + body.style.height + ' bg=' + body.style.background);
            }
            const html = document.documentElement;
            if (html) {
                logger.info('[NativeSync-DIAG] html style: w=' + html.style.width + ' h=' + html.style.height);
            }
        }
        catch (diagErr) {
            logger.warn('[NativeSync-DIAG] diagnostic threw: ' + diagErr.message);
        }
        // ----------------------------------------------------------------------
        try {
            logger.info('[NativeSync] startSyncPlay rect=' + rectX + ',' + rectY + ',' + rectW + ',' + rectH + ' rotation=' + rotation + ' groupID=' + groupId);
            const handle = api.startSyncPlay(rectX, rectY, rectW, rectH, 1, rotation, onChange);
            this._nativeSyncActive = true;
            this._nativeSyncGroupId = groupId;
            logger.info('[NativeSync] startSyncPlay invoked (groupID=' + groupId + ', handle=' + handle + ')');
        }
        catch (e) {
            logger.warn('[NativeSync] startSyncPlay threw: ' + ((e === null || e === void 0 ? void 0 : e.message) || e));
            this._nativeSyncActive = false;
            this._nativeSyncGroupId = null;
            this.setAvPlayVisualMode(false);
        }
    },
    // Stop and clear any active firmware SyncPlay session. Idempotent.
    stopNativeSyncPlay() {
        if (!this._nativeSyncActive)
            return;
        const api = this._getB2bSyncPlayApi();
        this._nativeSyncActive = false;
        this._nativeSyncGroupId = null;
        if (!api)
            return;
        try {
            api.stopSyncPlay((data) => {
                logger.info('[NativeSync] stopSyncPlay onChange code=' + (data && data.code));
                try {
                    api.clearSyncPlayList(() => {
                        logger.debug('[NativeSync] playlist cleared after stop');
                    }, () => { });
                }
                catch (_) { }
            });
        }
        catch (e) {
            logger.warn('[NativeSync] stopSyncPlay threw: ' + ((e === null || e === void 0 ? void 0 : e.message) || e));
        }
    },
    setAvPlayVisualMode(active) {
        const root = document.documentElement;
        const body = document.body;
        const playerScreen = document.getElementById('player-screen');
        const pairingScreen = document.getElementById('pairing-screen');
        const errorScreen = document.getElementById('error-screen');
        const contentContainer = document.getElementById('content-container');
        const transparent = active ? 'transparent' : '';
        if (body) {
            body.classList.toggle('avplay-active', active);
            body.style.background = transparent;
            body.style.backgroundColor = transparent;
            // Force document canvas to 1920x1080 when sync active so the b2bsyncplay
            // rect (0,0,1920,1080) is not clipped by a portrait viewport (1080 wide).
            // Firmware rotation='ON' then maps this 1920x1080 plane to the panel.
            if (active) {
                body.style.width = '1920px';
                body.style.height = '1080px';
                body.style.minWidth = '1920px';
                body.style.minHeight = '1080px';
                body.style.overflow = 'hidden';
            }
            else {
                body.style.width = '';
                body.style.height = '';
                body.style.minWidth = '';
                body.style.minHeight = '';
                body.style.overflow = '';
            }
        }
        if (root) {
            root.style.background = transparent;
            root.style.backgroundColor = transparent;
            if (active) {
                root.style.width = '1920px';
                root.style.height = '1080px';
                root.style.overflow = 'hidden';
            }
            else {
                root.style.width = '';
                root.style.height = '';
                root.style.overflow = '';
            }
        }
        // Aggressively hide ALL screen divs when sync is active so the hardware
        // video overlay plane has no DOM layout above it that could constrain its
        // rendering region. Restore prior display values on deactivate.
        const screens = [playerScreen, pairingScreen, errorScreen];
        for (const el of screens) {
            if (!el)
                continue;
            if (active) {
                if (!el.dataset.prevDisplay) {
                    el.dataset.prevDisplay = el.style.display || '';
                }
                // Strip the .screen class entirely while active so the
                // `.screen { width:100vw; height:100vh }` rule cannot constrain
                // the hardware overlay plane to portrait viewport bounds.
                if (el.classList.contains('screen')) {
                    el.dataset.prevHadScreenClass = '1';
                    el.classList.remove('screen');
                }
                el.style.background = transparent;
                el.style.backgroundColor = transparent;
                el.style.display = 'none';
            }
            else {
                el.style.background = '';
                el.style.backgroundColor = '';
                el.style.display = el.dataset.prevDisplay || '';
                delete el.dataset.prevDisplay;
                if (el.dataset.prevHadScreenClass === '1') {
                    el.classList.add('screen');
                    delete el.dataset.prevHadScreenClass;
                }
            }
        }
        if (contentContainer) {
            contentContainer.style.background = transparent;
            contentContainer.style.backgroundColor = transparent;
            contentContainer.style.display = active ? 'none' : '';
            if (active) {
                try {
                    contentContainer.innerHTML = '';
                }
                catch (_) { }
            }
        }
        if (body) {
            void body.offsetHeight;
        }
    },
    // Send lightweight heartbeat over WebSocket with readiness metrics
    sendWebSocketHeartbeat() {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.wsConnection || this.wsConnection.readyState !== WebSocket.OPEN) {
                return;
            }
            const readiness = this.buildReadinessPayload();
            // Collect lightweight resource snapshot (CPU, memory, storage) for every heartbeat
            let resources = {
                cpuLoad: null, storageFreeBytes: null, memoryFreeBytes: null, memoryTotalBytes: null,
            };
            try {
                resources = yield Telemetry.getResourcesQuick();
            }
            catch (e) {
                // Non-fatal — heartbeat still sends without resource data
            }
            const payload = {
                clockDriftMs: readiness.driftMs,
                currentContentId: readiness.currentContentId,
                nextContentId: readiness.nextContentId,
                nextStartsAt: readiness.nextStartsAt,
                cpuLoad: resources.cpuLoad,
                storageFreeBytes: resources.storageFreeBytes,
                memoryFreeBytes: resources.memoryFreeBytes,
                memoryTotalBytes: resources.memoryTotalBytes,
            };
            const serialized = JSON.stringify(payload);
            const now = Date.now();
            if (serialized === this.lastReadinessPayload && now - this.lastReadinessAt < CONFIG.HEARTBEAT_INTERVAL) {
                return;
            }
            this.wsConnection.send(JSON.stringify({ type: 'heartbeat', payload }));
            this.lastReadinessPayload = serialized;
            this.lastReadinessAt = now;
        });
    },
    // Track download progress for readiness reporting
    handleDownloadProgress(percent) {
        this.lastDownloadProgress = percent;
        // Update idle screen with download progress if currently showing
        const container = document.getElementById('content-container');
        const idleScreen = container === null || container === void 0 ? void 0 : container.querySelector('.idle-screen');
        if (idleScreen && this.isDownloadingContent) {
            // Update the status text and progress bar
            const statusElement = idleScreen.querySelector('.idle-status');
            if (statusElement) {
                statusElement.textContent = `Downloading content... ${percent}%`;
            }
            // Update or create progress bar
            let progressContainer = idleScreen.querySelector('.download-progress-container');
            if (!progressContainer && percent < 100) {
                // Create progress bar if it doesn't exist
                const spinner = idleScreen.querySelector('.idle-spinner');
                if (spinner) {
                    progressContainer = document.createElement('div');
                    progressContainer.className = 'download-progress-container';
                    progressContainer.style.cssText = 'width: 200px; height: 8px; background: rgba(255,255,255,0.2); border-radius: 4px; margin: 20px auto; overflow: hidden;';
                    progressContainer.innerHTML = '<div class="download-progress-bar" style="width: 0%; height: 100%; background: linear-gradient(90deg, #3b82f6, #06b6d4); transition: width 0.3s ease;"></div>';
                    spinner.parentNode.insertBefore(progressContainer, spinner);
                }
            }
            // Update progress bar width
            const progressBar = idleScreen.querySelector('.download-progress-bar');
            if (progressBar) {
                progressBar.style.width = `${percent}%`;
            }
        }
        // Force next heartbeat to emit updated readiness
        this.lastReadinessPayload = null;
        this.lastReadinessAt = 0;
        this.sendWebSocketHeartbeat();
    },
    // Start telemetry updates
    startTelemetry() {
        // Send telemetry every 5 minutes
        this.telemetryInterval = setInterval(() => __awaiter(this, void 0, void 0, function* () {
            try {
                yield Telemetry.send(this.deviceId);
                logger.debug('Telemetry sent');
            }
            catch (error) {
                logger.warn('Telemetry failed:', error);
            }
        }), CONFIG.TELEMETRY_INTERVAL);
    },
    // Start command polling
    startCommandPolling() {
        // Commands arrive via WebSocket — HTTP polling is disabled
        logger.debug('Command polling disabled; commands arrive via WebSocket');
    },
    // Start content refresh
    startContentRefresh() {
        this.contentRefreshInterval = setInterval(() => {
            this.loadContent();
        }, CONFIG.CONTENT_REFRESH_INTERVAL);
    },
    // Stream buffered console logs to the API every 5 s via device_log WS message
    startLogStream() {
        if (this.logStreamInterval)
            return;
        this.logStreamInterval = setInterval(() => {
            var _a, _b;
            const ws = this.wsConnection;
            if (!ws || ws.readyState !== WebSocket.OPEN)
                return;
            const batch = (window.LogBuffer && window.LogBuffer.drain(100)) || [];
            if (!batch.length)
                return;
            // Group by real level; line text is "timestamp message" only—
            // buildLogText on the dashboard already prepends [LEVEL].
            const byLevel = { debug: [], info: [], warn: [], error: [] };
            for (const e of batch) {
                const lvl = (e.level && byLevel[e.level]) ? e.level : 'info';
                const ts = (_a = e.timestamp) !== null && _a !== void 0 ? _a : new Date().toISOString();
                const msg = Array.isArray(e.message)
                    ? e.message.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')
                    : String((_b = e.message) !== null && _b !== void 0 ? _b : '');
                byLevel[lvl].push(`${ts} ${msg}`);
            }
            for (const [level, lines] of Object.entries(byLevel)) {
                if (!lines.length)
                    continue;
                for (let i = 0; i < lines.length; i += 50) {
                    ws.send(JSON.stringify({ type: 'device_log', payload: { level, lines: lines.slice(i, i + 50) } }));
                }
            }
        }, 5000);
    },
    startWebSocketWatchdog() {
        if (this.wsWatchdogInterval) {
            return;
        }
        const staleAfterMs = Math.max((CONFIG.HEARTBEAT_INTERVAL || 30000) * 3, 90000);
        this.wsWatchdogInterval = setInterval(() => {
            if (!this.wsConnection || this.wsConnection.readyState !== WebSocket.OPEN) {
                return;
            }
            if (!this.lastWsMessageAt) {
                return;
            }
            if (Date.now() - this.lastWsMessageAt <= staleAfterMs) {
                return;
            }
            logger.warn('WebSocket appears stale despite open state; forcing reconnect');
            this.updateConnectionStatus(false);
            try {
                this.wsConnection.close();
            }
            catch (error) {
                logger.debug('Failed to close stale WebSocket:', error);
            }
        }, CONFIG.HEARTBEAT_INTERVAL || 30000);
    },
    trySwapToPendingContent(force = false) {
        if (!this.pendingPlaylist || !this.pendingSignature) {
            return;
        }
        // If already playing this signature, clear pending and exit
        if (this.lastContentSignature && this.lastContentSignature === this.pendingSignature) {
            this.pendingPlaylist = null;
            this.pendingSignature = null;
            return;
        }
        // If currently playing and not forcing, wait (unless nothing is playing)
        const isPlaying = this.currentPlaylistController && !this.currentPlaylistController.cancelled;
        if (!force && isPlaying) {
            logger.info('Content currently playing, pending swap will occur between items');
            return;
        }
        logger.info('Switching to pending playlist');
        // Capture and clear pending before swap to avoid re-entrancy loops
        const playlistToPlay = this.pendingPlaylist;
        const signatureToSet = this.pendingSignature;
        this.pendingPlaylist = null;
        this.pendingSignature = null;
        this.cancelCurrentPlayback();
        // If we were running zone-mode (multi-runner), tear it down so the new
        // playlist gets a clean container.
        if (this._zoneMode)
            this.stopZoneMode();
        this.renderPlaylist(playlistToPlay);
        this.currentContent = playlistToPlay;
        this.lastContentSignature = signatureToSet;
        this.cachePlaylist(playlistToPlay, signatureToSet);
    },
    // Download content in background without interrupting playback
    downloadContentInBackground(content, newSignature) {
        return __awaiter(this, void 0, void 0, function* () {
            // Prevent concurrent downloads or duplicate downloads
            if (this.isDownloadingContent) {
                logger.info('Download already in progress, skipping...');
                return;
            }
            // Skip if already downloaded and pending, or already playing
            if (newSignature === this.lastContentSignature) {
                logger.info('Content already playing, skipping download');
                return;
            }
            if (newSignature === this.pendingSignature) {
                logger.info('Content already downloaded and pending, skipping download');
                return;
            }
            this.isDownloadingContent = true;
            try {
                logger.info('Downloading content in background...');
                // Show idle screen with download progress only on true first-boot (no content
                // has ever been set). If documentActive, a playlist controller is running, or
                // zones are active we leave the screen alone to avoid a black flash mid-download.
                const nothingOnScreen = !this.currentContent &&
                    !this.documentActive &&
                    !(this.currentPlaylistController && !this.currentPlaylistController.cancelled) &&
                    !this._zoneMode;
                if (nothingOnScreen) {
                    this.showIdleScreen(0);
                }
                const downloadedPlaylist = yield ContentManager.downloadPlaylist(content);
                // Content downloaded successfully
                logger.info('Background download complete');
                // Only queue if signature still matches the one we started with
                this.pendingPlaylist = downloadedPlaylist;
                this.pendingSignature = newSignature;
                // Show notification when download completes
                this.showDownloadNotification(content.playlistName || 'Content');
                // Swap immediately regardless of what is currently playing.
                logger.info('Download complete; swapping to new content immediately');
                this.trySwapToPendingContent(true);
            }
            catch (error) {
                logger.error('Background download failed:', error);
                // On error, try to use cached content or show idle
                if (!this.currentContent) {
                    if (this.tryRenderCachedPlaylist('offline-fallback')) {
                        return;
                    }
                    this.showIdleScreen();
                }
            }
            finally {
                this.isDownloadingContent = false;
            }
        });
    },
    // Load current content
    loadContent() {
        return __awaiter(this, void 0, void 0, function* () {
            if (this._loadInFlight) {
                logger.debug('loadContent skipped (already in flight)');
                return;
            }
            this._loadInFlight = true;
            try {
                logger.info('Loading content...');
                // BLE rule override takes priority over the normal schedule
                const content = this._bleOverrideContent
                    ? this._bleOverrideContent
                    : yield API.getCurrentContent(this.deviceId, this.deviceToken);
                if (content && content.resellerBranding && content.resellerBranding.logoUrl) {
                    this.resellerBrandingLogoUrl = content.resellerBranding.logoUrl;
                }
                if (content && content.items && content.items.length > 0) {
                    const newSignature = this.getContentSignature(content);
                    const isPlaying = !!(this.currentPlaylistController && !this.currentPlaylistController.cancelled) || this._zoneMode || this._nativeSyncActive;
                    logger.info(`Content signature: ${newSignature}, Last: ${this.lastContentSignature}`);
                    logger.info(`Currently playing: ${isPlaying} (controller=${!!(this.currentPlaylistController && !this.currentPlaylistController.cancelled)}, zone=${this._zoneMode}, nativeSync=${this._nativeSyncActive})`);
                    if (newSignature &&
                        this.lastContentSignature &&
                        newSignature === this.lastContentSignature &&
                        this.currentContent &&
                        isPlaying &&
                        true) {
                        logger.info('Content unchanged since last refresh, skipping re-render');
                        return;
                    }
                    // Same signature but nothing is rendering (e.g. native-sync session
                    // never started, or playback ended). Re-render existing content
                    // instead of falling into downloadContentInBackground (which would
                    // see the same signature and skip).
                    if (newSignature &&
                        this.lastContentSignature &&
                        newSignature === this.lastContentSignature &&
                        this.currentContent &&
                        !isPlaying) {
                        logger.warn('Same signature but not playing � forcing re-render from currentContent');
                        this.cancelCurrentPlayback();
                        if (this._zoneMode)
                            this.stopZoneMode();
                        this.renderPlaylist(this.currentContent);
                        return;
                    }
                    // Got a regular playlist with items
                    logger.info(`Loaded playlist: ${content.playlistName} with ${content.items.length} items`);
                    // Download in background without interrupting current playback
                    this.downloadContentInBackground(content, newSignature);
                }
                else {
                    // No content or empty playlist - stop playback and show idle screen
                    logger.info('No content available, showing idle screen');
                    this.cancelCurrentPlayback();
                    if (this._zoneMode)
                        this.stopZoneMode();
                    this.clearPlaylistCache();
                    this.currentContent = null;
                    this.lastContentSignature = null;
                    this.pendingPlaylist = null;
                    this.pendingSignature = null;
                    this.showIdleScreen();
                }
            }
            catch (error) {
                // If device was deleted (404), return to pairing
                if (error.message && error.message.includes('404')) {
                    logger.warn('Device not found during content load (deleted). Returning to pairing...');
                    this.handleDeviceDeleted();
                    return;
                }
                logger.error('Failed to load content:', error);
                if (this.tryRenderCachedPlaylist('offline-fallback')) {
                    return;
                }
                this.showIdleScreen();
            }
            finally {
                this._loadInFlight = false;
            }
        });
    },
    // Render content
    renderContent(content) {
        var _a, _b;
        const container = document.getElementById('content-container');
        // Disconnect any active DataSync WebSocket before switching content
        if (typeof DataSyncRenderer !== 'undefined') {
            DataSyncRenderer.disconnect();
        }
        // Stop any active Live Link Face renderer
        if (typeof LiveLinkFaceRenderer !== 'undefined') {
            LiveLinkFaceRenderer.stop();
        }
        // Clear existing content
        container.innerHTML = '';
        container._menuBoardRequestId = undefined;
        if (!content || !content.type) {
            this.showIdleScreen();
            return;
        }
        logger.info('Rendering content:', content.type);
        // Clean up any active channel group when transitioning to a different
        // content item. (renderChannelGroup re-creates the state when needed.)
        if (this.currentChannelGroup && content.type !== 'CHANNEL_GROUP') {
            this._cleanupChannelGroup({ keepContainer: false });
        }
        switch (content.type) {
            case 'IMAGE':
                this.renderImage(container, content);
                break;
            case 'VIDEO':
                this.renderVideo(container, content);
                break;
            case 'IPTV':
                this.renderIptv(container, content);
                break;
            case 'CHANNEL_GROUP':
                this.renderChannelGroup(container, content);
                break;
            case 'LIVE_STREAM':
                // HLS/DASH streams - use AVPlay for best performance
                this.renderLiveStream(container, content);
                break;
            case 'OVERLAY':
                // Video with alpha channel - AVPlay supports WebM/VP8/VP9
                this.renderVideo(container, content);
                break;
            case 'PRESENTATION':
                // Video presentations - use AVPlay
                this.renderVideo(container, content);
                break;
            case 'HTML':
            case 'HTML5':
                this.renderHTML(container, content);
                break;
            case 'MENU_BOARD':
                this.renderMenuBoard(container, content);
                break;
            case 'CANVAS':
                this.renderCanvas(container, content);
                break;
            case 'DATASYNC':
                this.renderDataSync(container, content);
                break;
            case 'PLAYLIST':
                this.renderPlaylist(container, content);
                break;
            case 'PDF':
            case 'OFFICE':
                this.renderDocument(container, content);
                break;
            case 'VIDEOWALL':
                // Full-wall video: CSS-crop this panel's region using the manifest geometry.
                // The manifest must have been received via VIDEOWALL_INIT before this renders.
                this.renderVideo(container, content);
                break;
            case 'ZONE_LAYOUT': {
                // Zone layout content: activate multi-zone mode using zones from metadata
                let zones = [];
                try {
                    zones = (_b = JSON.parse((_a = content.metadata) !== null && _a !== void 0 ? _a : '{}').zones) !== null && _b !== void 0 ? _b : [];
                }
                catch (_) { }
                if (zones.length > 0) {
                    this.activateZoneMode(zones);
                }
                else {
                    logger.warn('ZONE_LAYOUT: no zones in metadata, showing idle');
                    this.showIdleScreen();
                }
                break;
            }
            case 'CALENDAR': {
                void this.renderCalendar(container, content);
                break;
            }
            case 'LIVE_LINK_FACE':
                this.renderLiveLinkFace(container, content);
                break;
            default:
                logger.warn('Unknown content type:', content.type);
                this.showIdleScreen();
        }
    },
    // Render image content
    renderImage(container, content) {
        return __awaiter(this, void 0, void 0, function* () {
            const img = document.createElement('img');
            img.style.width = '100%';
            img.style.height = '100%';
            img.style.objectFit = 'contain';
            img.style.backgroundColor = '#000';
            // For local file:// URLs, try direct src first (works on Tizen for wgt-private files),
            // then fall back to blob via ContentManager.readPathBytes if direct load fails.
            if (content.url && content.url.startsWith('file://')) {
                logger.info('Loading local image:', content.url);
                const tryBlobFallback = () => {
                    var _a;
                    try {
                        const urlParts = content.url.split('/');
                        const fileName = urlParts[urlParts.length - 1];
                        const storagePath = ((_a = window.ContentManager) === null || _a === void 0 ? void 0 : _a.storagePath) || 'wgt-private/content';
                        const virtualPath = storagePath + '/' + fileName;
                        logger.info('Trying blob fallback via readPathBytes:', virtualPath);
                        const buffer = window.ContentManager.readPathBytes(virtualPath);
                        const mimeType = this.getMimeType(fileName, content.contentType) || 'image/jpeg';
                        try {
                            const blob = new Blob([buffer], { type: mimeType });
                            img.src = URL.createObjectURL(blob);
                            img.onload = () => { logger.info('Image loaded via blob fallback'); };
                            img.onerror = () => {
                                logger.error('Image failed to load via blob, trying data URL');
                                img.src = this.bytesToDataUrl(buffer, mimeType);
                            };
                        }
                        catch (blobErr) {
                            img.src = this.bytesToDataUrl(buffer, mimeType);
                        }
                    }
                    catch (err) {
                        const msg = (err === null || err === void 0 ? void 0 : err.message) || String(err);
                        logger.error('Blob fallback failed:', msg);
                        this.showImageError(container, content);
                    }
                };
                img.onload = () => { logger.info('Image loaded successfully from local file'); };
                img.onerror = () => {
                    logger.warn('Direct file:// load failed, attempting blob fallback');
                    tryBlobFallback();
                };
                img.src = content.url;
                container.appendChild(img);
                return;
            }
            // Remote URLs — use img tag directly
            img.src = content.url;
            img.onerror = (error) => {
                logger.error('Image failed to load:', content.url, error);
                this.showImageError(container, content);
            };
            img.onload = () => {
                logger.info('Image loaded successfully:', content.url);
            };
            container.appendChild(img);
        });
    },
    // Show image error message
    showImageError(container, content) {
        container.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: center; height: 100%; color: white; background: #333; flex-direction: column;">
        <div style="font-size: 48px; margin-bottom: 20px;">âš ï¸</div>
        <div style="font-size: 24px;">Image Load Error</div>
        <div style="font-size: 14px; margin-top: 10px; opacity: 0.7;">${content.name}</div>
      </div>
    `;
    },
    // Infer MIME type for locally cached files (helps the browser decode blob URLs)
    getMimeType(fileName, fallback) {
        if (fallback) {
            return fallback;
        }
        if (!fileName || fileName.indexOf('.') === -1) {
            return null;
        }
        const extension = fileName.split('.').pop().toLowerCase();
        switch (extension) {
            case 'jpg':
            case 'jpeg':
                return 'image/jpeg';
            case 'png':
                return 'image/png';
            case 'gif':
                return 'image/gif';
            case 'bmp':
                return 'image/bmp';
            case 'webp':
                return 'image/webp';
            default:
                return null;
        }
    },
    getFileExtension(value) {
        if (!value || typeof value !== 'string') {
            return '';
        }
        let sanitized = value.split('?')[0].split('#')[0];
        try {
            sanitized = new URL(value).pathname || sanitized;
        }
        catch (_) {
            // Keep the existing fallback for non-URL values.
        }
        if (sanitized.indexOf('.') === -1) {
            return '';
        }
        return sanitized.split('.').pop().toLowerCase();
    },
    isImageExtension(ext) {
        if (!ext) {
            return false;
        }
        return ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg', 'avif'].includes(ext);
    },
    isHtmlUrl(url) {
        if (!url || typeof url !== 'string') {
            return false;
        }
        if (url.startsWith('data:text/html')) {
            return true;
        }
        const ext = this.getFileExtension(url);
        return ext === 'html' || ext === 'htm';
    },
    resolveCanvasUrl(content) {
        if (!content) {
            return null;
        }
        let metadata = content.metadata || {};
        if (typeof metadata === 'string') {
            try {
                metadata = JSON.parse(metadata);
            }
            catch (error) {
                logger.warn('Failed to parse canvas metadata JSON:', error);
                metadata = {};
            }
        }
        const candidates = [
            content.url,
            metadata.packageUrl,
            metadata.publicUrl,
            metadata.canvasUrl,
            metadata.htmlUrl,
            metadata.previewUrl,
            metadata.thumbnailUrl,
            metadata.thumbnail,
        ];
        return candidates.find(url => typeof url === 'string' && url.length > 0) || null;
    },
    bytesToDataUrl(uint8Array, mimeType) {
        const base64 = this.uint8ToBase64(uint8Array);
        return `data:${mimeType || 'application/octet-stream'};base64,${base64}`;
    },
    uint8ToBase64(uint8Array) {
        let binary = '';
        const chunkSize = 0x8000;
        for (let i = 0; i < uint8Array.length; i += chunkSize) {
            const chunk = uint8Array.subarray(i, i + chunkSize);
            binary += String.fromCharCode.apply(null, chunk);
        }
        return btoa(binary);
    },
    // Render video content using Samsung AVPlay API for better performance
    renderVideo(container, content) {
        // Clean up wall subsystem when switching away from VIDEOWALL content
        if (!content || content.type !== 'VIDEOWALL') {
            if (typeof WallSync !== 'undefined' && WallSync.isRunning()) {
                try {
                    WallSync.stop();
                }
                catch (_a) { }
            }
            if (typeof WallEngine !== 'undefined' && WallEngine.isInitialised()) {
                try {
                    WallEngine.destroyEngine();
                }
                catch (_b) { }
            }
            if (this._mixedRelayStop) {
                try {
                    this._mixedRelayStop();
                }
                catch (_c) { }
                this._mixedRelayStop = null;
            }
            this._videowallCurrentUrl = null;
        }
        // Videowall mode: CSS-crop the full-wall video to this panel's region.
        // Guard on content.type so regular video items in a playlist aren't
        // accidentally rendered in crop mode if a manifest is still in memory.
        if (this._videowallManifest && content && content.type === 'VIDEOWALL') {
            this._renderVideowallContent(container, content);
            return;
        }
        // SyncPlay forces HTML5 path (per-frame currentTime control + playbackRate
        // are not portably exposed by webapis.avplay).
        if (this._syncMode) {
            this.renderVideoHTML5(container, content);
            return;
        }
        // AVPlay supports both HTTP and file:// URLs from wgt-private storage
        if (typeof webapis !== 'undefined' && webapis.avplay) {
            this.renderVideoAVPlay(container, content);
        }
        else {
            // Fallback to HTML5 video
            this.renderVideoHTML5(container, content);
        }
    },
    // -- Videowall AVPlay setVideoRoi renderer (Tizen 6.0+ B2B/LFD) -------------
    // All panels in the wall download the same full-canvas-resolution video.
    // Each panel uses AVPlay setVideoRoi to crop its assigned sub-rectangle of
    // the decoded frame � no DOM/CSS clipping, no HW overlay mismatch.
    // SyncEngine handles P2P drift correction so frames stay aligned.
    _renderVideowallContent(container, content) {
        const mf = this._videowallManifest;
        if (!mf || !mf.geometry || !mf.myCell) {
            logger.warn('[Videowall] manifest incomplete � falling back to normal AVPlay');
            this.renderVideoAVPlay(container, content);
            return;
        }
        const geo = mf.geometry; // { colWidths, rowHeights, canvasW, canvasH }
        const myCell = mf.myCell; // { positionCol, positionRow, colSpan, rowSpan, ... }
        const col = myCell.positionCol;
        const row = myCell.positionRow;
        const colSpan = myCell.colSpan || 1;
        const rowSpan = myCell.rowSpan || 1;
        // Compute this cell's top-left offset and size on the virtual canvas.
        let offsetX = 0;
        for (let c = 0; c < col; c++)
            offsetX += (geo.colWidths[c] || 0);
        let offsetY = 0;
        for (let r = 0; r < row; r++)
            offsetY += (geo.rowHeights[r] || 0);
        let cellW = 0;
        for (let c = col; c < col + colSpan; c++)
            cellW += (geo.colWidths[c] || 0);
        let cellH = 0;
        for (let r = row; r < row + rowSpan; r++)
            cellH += (geo.rowHeights[r] || 0);
        const canvasW = geo.canvasW;
        const canvasH = geo.canvasH;
        logger.info(`[Videowall] cell(${col},${row}) offset(${offsetX},${offsetY}) cell(${cellW}x${cellH}) canvas(${canvasW}x${canvasH})`);
        if (!canvasW || !canvasH) {
            logger.warn('[Videowall] canvas dimensions zero � falling back to normal AVPlay');
            this.renderVideoAVPlay(container, content);
            return;
        }
        // Store ROI ratios; consumed once inside renderVideoAVPlay's prepareAsync
        // callback after the player reaches READY state.
        this._pendingVideoRoi = {
            xR: offsetX / canvasW,
            yR: offsetY / canvasH,
            wR: cellW / canvasW,
            hR: cellH / canvasH,
        };
        logger.info(`[Videowall] ROI ratios x=${this._pendingVideoRoi.xR.toFixed(4)}` +
            ` y=${this._pendingVideoRoi.yR.toFixed(4)}` +
            ` w=${this._pendingVideoRoi.wR.toFixed(4)}` +
            ` h=${this._pendingVideoRoi.hR.toFixed(4)}`);
        // Phase 2: if WallSync is running, hand the URL to the sync engine
        // (it will call WallEngine.prepare + schedule play via LOAD_URL/GO).
        // Otherwise fall back to Phase 1 direct AVPlay rendering.
        this._videowallCurrentUrl = content.url;
        if (typeof WallSync !== 'undefined' && WallSync.isRunning()) {
            container.innerHTML = '';
            WallSync.handleNewContent(content.url);
        }
        else {
            // Phase 1 fallback: direct AVPlay with setVideoRoi via _pendingVideoRoi
            this.renderVideoAVPlay(container, content);
        }
    },
    // Render video using Samsung AVPlay API
    renderVideoAVPlay(container, content) {
        try {
            logger.info('Using Samsung AVPlay for video:', content.url);
            this.resetAvPlay();
            // Clear container - AVPlay renders directly to screen, not DOM
            container.innerHTML = '';
            // Use full screen coordinates for AVPlay display rect
            const fallbackToHtml5 = (reason) => {
                logger.error('AVPlay failed, falling back to HTML5:', reason);
                this.avplayReady = false;
                this.renderVideoHTML5(container, content);
            };
            // CRITICAL: Follow Samsung's official sequence from sample code
            // 1. Open FIRST
            logger.info('AVPlay: Opening URL:', content.url);
            webapis.avplay.open(content.url);
            logger.debug('AVPlay: Open complete');
            // Apply profile after open (more reliable on some firmwares)
            this.applyAvPlayProfile(content);
            // 2. Set display rect SECOND (Samsung samples do this before setListener)
            // Samsung docs claim setDisplayRect uses a fixed 1920x1080 coordinate space, but on
            // commercial signage panels the rect maps to native panel pixels — passing 1920x1080
            // on a 4K panel renders in the top-left quadrant. Use the cached panel resolution
            // detected at init via tizen.systeminfo / productinfo.
            const viewportWidth = this._panelWidth;
            const viewportHeight = this._panelHeight;
            webapis.avplay.setDisplayRect(0, 0, viewportWidth, viewportHeight);
            logger.info('AVPlay: Display rect set', viewportWidth, viewportHeight);
            // 3. Set listener THIRD (after open and setDisplayRect, before prepare)
            webapis.avplay.setListener({
                onbufferingstart: () => {
                    logger.debug('AVPlay buffering started');
                },
                onbufferingprogress: (percent) => {
                    logger.debug('AVPlay buffering:', percent + '%');
                },
                onbufferingcomplete: () => {
                    logger.debug('AVPlay buffering complete');
                },
                onstreamcompleted: () => {
                    logger.info('AVPlay stream completed');
                    // Let the playlist handler decide whether it can loop/transition seamlessly.
                    // If it returns true, it handled looping/transition itself.
                    let handled = false;
                    if (this.currentVideoEndedCallback) {
                        try {
                            handled = this.currentVideoEndedCallback() === true;
                        }
                        catch (err) {
                            logger.warn('currentVideoEndedCallback failed:', err);
                        }
                    }
                    if (!handled) {
                        this.setAvPlayVisualMode(false);
                    }
                },
                oncurrentplaytime: (currentTime) => {
                    // Optional: track playback time
                },
                onerror: (eventType) => {
                    this.setAvPlayVisualMode(false);
                    fallbackToHtml5(eventType);
                },
                onevent: (eventType, eventData) => {
                    logger.debug('AVPlay event:', eventType, eventData);
                }
            });
            const isLocalFile = content.url && content.url.startsWith('file:///');
            // Configure buffering only for network streams (not needed for local files)
            if (!isLocalFile) {
                try {
                    webapis.avplay.setTimeoutForBuffering(10);
                    logger.debug('AVPlay: Buffering timeout set to 10s');
                }
                catch (err) {
                    logger.debug('setTimeoutForBuffering not supported');
                }
            }
            logger.debug('AVPlay: Starting prepareAsync...');
            webapis.avplay.prepareAsync(() => {
                try {
                    logger.debug('AVPlay: Prepare complete, setting display mode');
                    // Set display method after prepare succeeds
                    webapis.avplay.setDisplayMethod('PLAYER_DISPLAY_MODE_FULL_SCREEN');
                    // Re-apply display rect after prepare in case resolution changed
                    try {
                        webapis.avplay.setDisplayRect(0, 0, viewportWidth, viewportHeight);
                        logger.debug('AVPlay: Display rect set after prepare', viewportWidth, viewportHeight);
                    }
                    catch (rectErr) {
                        logger.warn('AVPlay: setDisplayRect after prepare failed', rectErr);
                    }
                    // Apply videowall ROI crop when this is a wall tile.
                    // setVideoRoi is B2B/LFD only (Tizen 6.0+) and must be called after
                    // prepareAsync completes (player is in READY state).
                    if (this._pendingVideoRoi) {
                        try {
                            const roi = this._pendingVideoRoi;
                            this._pendingVideoRoi = null;
                            webapis.avplay.setVideoRoi(roi.xR, roi.yR, roi.wR, roi.hR);
                            logger.info(`[Videowall] setVideoRoi applied: x=${roi.xR.toFixed(4)}` +
                                ` y=${roi.yR.toFixed(4)}` +
                                ` w=${roi.wR.toFixed(4)}` +
                                ` h=${roi.hR.toFixed(4)}`);
                        }
                        catch (roiErr) {
                            logger.warn('[Videowall] setVideoRoi failed (not B2B/LFD or Tizen <6):', roiErr);
                        }
                    }
                    this.setAvPlayVisualMode(true);
                    logger.debug('Enabled AVPlay visual mode');
                    // Start playback
                    logger.debug('AVPlay: Calling play()');
                    webapis.avplay.play();
                    this.avplayReady = true;
                    logger.info('AVPlay playback started');
                    // Watchdog: check if playback actually starts
                    // Local files should start immediately, network streams may take a few seconds
                    const watchdogDelay = isLocalFile ? 3000 : 5000;
                    setTimeout(() => {
                        var _a, _b, _c, _d;
                        try {
                            const state = (_b = (_a = webapis.avplay).getState) === null || _b === void 0 ? void 0 : _b.call(_a);
                            const time = (_d = (_c = webapis.avplay).getCurrentTime) === null || _d === void 0 ? void 0 : _d.call(_c);
                            // Only fallback if state is PLAYING but time hasn't progressed at all
                            if (state === 'PLAYING' && time === 0) {
                                logger.warn('AVPlay appears stalled (state:', state, 'time:', time, '). Falling back to HTML5');
                                this.setAvPlayVisualMode(false);
                                fallbackToHtml5('stalled');
                            }
                            else {
                                logger.debug('AVPlay watchdog OK - state:', state, 'time:', time);
                            }
                        }
                        catch (watchErr) {
                            logger.debug('Watchdog check failed', watchErr);
                        }
                    }, watchdogDelay);
                }
                catch (playErr) {
                    this.setAvPlayVisualMode(false);
                    fallbackToHtml5(playErr);
                }
            }, (prepErr) => {
                this.setAvPlayVisualMode(false);
                fallbackToHtml5(prepErr);
            });
        }
        catch (error) {
            logger.error('AVPlay error, falling back to HTML5:', error);
            this.renderVideoHTML5(container, content);
        }
    },
    // Render IPTV (UDP/HLS/DASH). Prefer AVPlay; fall back to HTML5.
    renderIptv(container, content) {
        if (typeof webapis !== 'undefined' && webapis.avplay) {
            this.renderIptvAVPlay(container, content);
            return;
        }
        logger.warn('AVPlay unavailable; falling back to HTML5 video for IPTV');
        this.renderVideoHTML5(container, content);
    },
    // ── Channel group (IPTV bundle) ──────────────────────────────────────────
    // A channel group is a content item of type CHANNEL_GROUP whose metadata
    // carries an ordered list of `channels`. The player keeps the active
    // channel on `Player.currentChannelGroup` and re-uses `renderIptvAVPlay`
    // to play the selected stream. CH+/CH-/digit keys (wired in
    // remote-control.js) call `tuneChannel`, `nextChannel`, `prevChannel`.
    renderChannelGroup(container, content) {
        const channels = Array.isArray(content.channels) ? content.channels.slice() : [];
        if (!channels.length) {
            logger.warn('CHANNEL_GROUP: no channels in metadata, showing idle');
            this.showIdleScreen();
            return;
        }
        // Sort by channel number for deterministic CH+/CH- iteration.
        channels.sort((a, b) => (a.number || 0) - (b.number || 0));
        // Resolve starting channel: persisted last-played → author default → first.
        const lastKey = `iptv:lastChannel:${content.id}`;
        let startNumber = null;
        try {
            const persisted = localStorage.getItem(lastKey);
            if (persisted)
                startNumber = Number(persisted);
        }
        catch (_) { }
        if (!startNumber || !channels.find((c) => c.number === startNumber)) {
            startNumber = content.defaultChannelNumber || channels[0].number;
        }
        this._cleanupChannelGroup({ keepContainer: true });
        this.currentChannelGroup = {
            contentId: content.id,
            name: content.name,
            channels,
            container,
            lastKey,
            failureCount: 0,
        };
        this.tuneChannel(startNumber);
    },
    /** Play the channel with `number` from the active group. */
    tuneChannel(number) {
        const group = this.currentChannelGroup;
        if (!group)
            return;
        const channel = group.channels.find((c) => c.number === number);
        if (!channel) {
            logger.warn('tuneChannel: channel not found:', number);
            return;
        }
        group.currentChannelNumber = channel.number;
        try {
            localStorage.setItem(group.lastKey, String(channel.number));
        }
        catch (_) { }
        // Telemetry: surface current channel for monitoring.
        if (typeof Telemetry !== 'undefined' && Telemetry.updateIptvStats) {
            Telemetry.updateIptvStats({
                channelGroupId: group.contentId,
                currentChannelNumber: channel.number,
                currentChannelName: channel.name,
            });
        }
        // Show banner immediately for snappy feedback while we debounce.
        this._showChannelBanner(channel);
        // Cancel any prior pending tune AND any in-flight reconnect cycle.
        if (this._pendingTuneTimer) {
            try {
                clearTimeout(this._pendingTuneTimer);
            }
            catch (_) { }
            this._pendingTuneTimer = null;
        }
        this._clearIptvReconnect();
        this._stopIptvWatchdog();
        // Debounce 250ms — coalesces rapid CH+/CH- presses into one AVPlay open.
        const seq = ++this._tuneSeq;
        this._pendingTuneTimer = setTimeout(() => {
            this._pendingTuneTimer = null;
            if (seq !== this._tuneSeq)
                return; // a newer tune superseded us
            const g = this.currentChannelGroup;
            if (!g)
                return;
            // Tear down any prior AVPlay session before opening the new URL.
            try {
                this.resetAvPlay();
            }
            catch (_) { }
            // Synthesize a content shape compatible with renderIptvAVPlay.
            const synthetic = {
                id: `${g.contentId}:${channel.number}`,
                name: `${channel.number} ${channel.name}`,
                type: 'IPTV',
                url: channel.url,
                protocol: channel.protocol,
                _channelGroupContentId: g.contentId,
                _channelNumber: channel.number,
            };
            // Clear container DOM (renderIptvAVPlay re-creates the AVPlay container).
            try {
                g.container.innerHTML = '';
            }
            catch (_) { }
            this.renderIptvAVPlay(g.container, synthetic);
        }, 250);
    },
    /** Move to the next channel (wraps around). */
    nextChannel() {
        const group = this.currentChannelGroup;
        if (!group || !group.channels.length)
            return;
        const idx = group.channels.findIndex((c) => c.number === group.currentChannelNumber);
        const nextIdx = idx < 0 ? 0 : (idx + 1) % group.channels.length;
        this.tuneChannel(group.channels[nextIdx].number);
    },
    /** Move to the previous channel (wraps around). */
    prevChannel() {
        const group = this.currentChannelGroup;
        if (!group || !group.channels.length)
            return;
        const idx = group.channels.findIndex((c) => c.number === group.currentChannelNumber);
        const prevIdx = idx < 0
            ? group.channels.length - 1
            : (idx - 1 + group.channels.length) % group.channels.length;
        this.tuneChannel(group.channels[prevIdx].number);
    },
    /**
     * Append a digit to the channel-tuning buffer. Commits after a 1.5 s
     * inactivity window, or immediately when the buffer reaches 4 digits.
     */
    bufferDigit(digit) {
        const group = this.currentChannelGroup;
        if (!group)
            return;
        if (typeof digit !== 'number' || digit < 0 || digit > 9)
            return;
        this._channelDigitBuffer = (this._channelDigitBuffer || '') + String(digit);
        if (this._channelDigitBuffer.length > 4) {
            this._channelDigitBuffer = this._channelDigitBuffer.slice(-4);
        }
        this._showChannelBuffer(this._channelDigitBuffer);
        if (this._channelDigitTimer) {
            clearTimeout(this._channelDigitTimer);
        }
        const commit = () => {
            const num = Number(this._channelDigitBuffer || '0');
            this._channelDigitBuffer = '';
            this._channelDigitTimer = null;
            if (num > 0) {
                const exists = group.channels.find((c) => c.number === num);
                if (exists) {
                    this.tuneChannel(num);
                }
                else {
                    this._showChannelBanner({ number: num, name: 'No channel' });
                }
            }
        };
        if (this._channelDigitBuffer.length >= 4) {
            commit();
        }
        else {
            this._channelDigitTimer = setTimeout(commit, 1500);
        }
    },
    /** Remove banner + state when a channel group is no longer active. */
    _cleanupChannelGroup(opts) {
        if (this._channelDigitTimer) {
            try {
                clearTimeout(this._channelDigitTimer);
            }
            catch (_) { }
            this._channelDigitTimer = null;
        }
        this._channelDigitBuffer = '';
        if (this._channelBannerEl && this._channelBannerEl.parentNode) {
            try {
                this._channelBannerEl.parentNode.removeChild(this._channelBannerEl);
            }
            catch (_) { }
        }
        this._channelBannerEl = null;
        if (this._channelBannerHideTimer) {
            try {
                clearTimeout(this._channelBannerHideTimer);
            }
            catch (_) { }
            this._channelBannerHideTimer = null;
        }
        if (this._pendingTuneTimer) {
            try {
                clearTimeout(this._pendingTuneTimer);
            }
            catch (_) { }
            this._pendingTuneTimer = null;
        }
        this._tuneSeq = (this._tuneSeq || 0) + 1; // invalidate any in-flight tune
        this._clearIptvReconnect();
        this._stopIptvWatchdog();
        this._hideIptvOverlay();
        if (!opts || !opts.keepContainer) {
            this.currentChannelGroup = null;
        }
    },
    _ensureChannelBannerEl() {
        if (this._channelBannerEl)
            return this._channelBannerEl;
        const el = document.createElement('div');
        el.id = 'iptv-channel-banner';
        el.style.cssText = [
            'position:fixed', 'right:48px', 'bottom:48px',
            'z-index:99999', 'pointer-events:none',
            'padding:18px 28px', 'border-radius:14px',
            'background:rgba(10,10,18,0.82)', 'color:#fff',
            'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif',
            'box-shadow:0 12px 36px rgba(0,0,0,0.45)',
            'transition:opacity 220ms ease',
            'opacity:0',
            'min-width:220px',
        ].join(';');
        document.body.appendChild(el);
        this._channelBannerEl = el;
        return el;
    },
    _showChannelBanner(channel) {
        const el = this._ensureChannelBannerEl();
        const num = (String(channel.number || '').length < 2 ? '0' : '') + String(channel.number || '');
        el.innerHTML = `
      <div style="font-size:14px;opacity:0.7;letter-spacing:0.06em;text-transform:uppercase;">Channel</div>
      <div style="display:flex;align-items:baseline;gap:14px;margin-top:4px;">
        <div style="font-size:42px;font-weight:700;line-height:1;">${num}</div>
        <div style="font-size:22px;font-weight:500;line-height:1;">${this._escapeHtml(channel.name || '')}</div>
      </div>
    `;
        el.style.opacity = '1';
        if (this._channelBannerHideTimer) {
            try {
                clearTimeout(this._channelBannerHideTimer);
            }
            catch (_) { }
        }
        this._channelBannerHideTimer = setTimeout(() => {
            if (this._channelBannerEl)
                this._channelBannerEl.style.opacity = '0';
            this._channelBannerHideTimer = null;
        }, 3000);
    },
    _showChannelBuffer(buffer) {
        const el = this._ensureChannelBannerEl();
        const b = (buffer || '');
        const padded = b.length >= 2 ? b : b + '--'.slice(b.length);
        el.innerHTML = `
      <div style="font-size:14px;opacity:0.7;letter-spacing:0.06em;text-transform:uppercase;">Tune</div>
      <div style="font-size:42px;font-weight:700;line-height:1;margin-top:4px;letter-spacing:0.08em;">${this._escapeHtml(padded)}</div>
    `;
        el.style.opacity = '1';
        if (this._channelBannerHideTimer) {
            try {
                clearTimeout(this._channelBannerHideTimer);
            }
            catch (_) { }
            this._channelBannerHideTimer = null;
        }
    },
    _escapeHtml(s) {
        return String(s || '').replace(/[&<>"']/g, (ch) => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
        }[ch]));
    },
    // ── IPTV resilience helpers ─────────────────────────────────────────────
    // Show / hide a non-blocking overlay used for "Reconnecting…" / "No signal".
    _showIptvOverlay(message) {
        let el = this._iptvOverlayEl;
        if (!el) {
            el = document.createElement('div');
            el.id = 'iptv-status-overlay';
            el.style.cssText = [
                'position:fixed', 'left:50%', 'top:50%', 'transform:translate(-50%,-50%)',
                'z-index:99998', 'pointer-events:none',
                'padding:18px 28px', 'border-radius:14px',
                'background:rgba(10,10,18,0.82)', 'color:#fff',
                'font:600 22px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif',
                'box-shadow:0 12px 36px rgba(0,0,0,0.5)',
            ].join(';');
            document.body.appendChild(el);
            this._iptvOverlayEl = el;
        }
        el.textContent = String(message || '');
        el.style.opacity = '1';
    },
    _hideIptvOverlay() {
        const el = this._iptvOverlayEl;
        if (!el)
            return;
        try {
            if (el.parentNode)
                el.parentNode.removeChild(el);
        }
        catch (_) { }
        this._iptvOverlayEl = null;
    },
    _clearIptvReconnect() {
        if (this._iptvReconnectTimer) {
            try {
                clearTimeout(this._iptvReconnectTimer);
            }
            catch (_) { }
            this._iptvReconnectTimer = null;
        }
        this._iptvReconnectCount = 0;
    },
    /** Schedule an IPTV reconnect with linear backoff; auto-skip channel after max retries. */
    _scheduleIptvReconnect(reason) {
        var _a, _b;
        const group = this.currentChannelGroup;
        if (!group)
            return;
        if (this._iptvReconnectTimer)
            return; // already pending
        this._iptvReconnectCount += 1;
        const attempt = this._iptvReconnectCount;
        // Telemetry
        if (typeof Telemetry !== 'undefined' && Telemetry.updateIptvStats) {
            const total = (((_b = (_a = Telemetry.runtime) === null || _a === void 0 ? void 0 : _a.iptv) === null || _b === void 0 ? void 0 : _b.reconnectCount) || 0) + 1;
            Telemetry.updateIptvStats({
                reconnectCount: total,
                lastReconnectReason: String(reason || 'unknown'),
                lastReconnectAt: Date.now(),
            });
        }
        if (attempt > this.IPTV_MAX_RECONNECTS) {
            logger.warn('IPTV: max reconnects reached; skipping to next channel');
            this._showIptvOverlay('No signal — skipping channel');
            this._iptvReconnectCount = 0;
            this._iptvReconnectTimer = setTimeout(() => {
                this._iptvReconnectTimer = null;
                this._hideIptvOverlay();
                try {
                    this.nextChannel();
                }
                catch (_) { }
            }, 1500);
            return;
        }
        const delay = this.IPTV_RECONNECT_BASE_MS * attempt;
        this._showIptvOverlay(`Reconnecting… (${attempt}/${this.IPTV_MAX_RECONNECTS})`);
        logger.warn(`IPTV: scheduling reconnect attempt ${attempt} in ${delay}ms (reason: ${reason})`);
        this._iptvReconnectTimer = setTimeout(() => {
            this._iptvReconnectTimer = null;
            const g = this.currentChannelGroup;
            if (!g)
                return;
            try {
                this.tuneChannel(g.currentChannelNumber);
            }
            catch (err) {
                logger.error('IPTV reconnect tuneChannel failed', err);
            }
        }, delay);
    },
    /** Periodic stall watchdog. 2 consecutive ticks with no playhead progress → reconnect. */
    _startIptvWatchdog(isUdp) {
        this._stopIptvWatchdog();
        this._iptvLastTime = -1;
        this._iptvStallCount = 0;
        const interval = isUdp ? 3000 : 5000;
        this._iptvWatchdogTimer = setInterval(() => {
            var _a, _b, _c, _d, _f, _g;
            try {
                const state = (_b = (_a = webapis.avplay) === null || _a === void 0 ? void 0 : _a.getState) === null || _b === void 0 ? void 0 : _b.call(_a);
                const time = (_d = (_c = webapis.avplay) === null || _c === void 0 ? void 0 : _c.getCurrentTime) === null || _d === void 0 ? void 0 : _d.call(_c);
                // Bitrate telemetry — best-effort, ignore failures.
                try {
                    const bw = (_g = (_f = webapis.avplay) === null || _f === void 0 ? void 0 : _f.getStreamingProperty) === null || _g === void 0 ? void 0 : _g.call(_f, 'CURRENT_BANDWIDTH');
                    if (bw && typeof Telemetry !== 'undefined' && Telemetry.updateIptvStats) {
                        Telemetry.updateIptvStats({ currentBitrate: Number(bw) || 0 });
                    }
                }
                catch (_) { }
                if (state !== 'PLAYING')
                    return;
                if (typeof time !== 'number')
                    return;
                if (time === this._iptvLastTime) {
                    this._iptvStallCount += 1;
                    logger.debug('IPTV watchdog: stall tick', this._iptvStallCount, 'time:', time);
                    if (this._iptvStallCount >= 2) {
                        this._stopIptvWatchdog();
                        this._scheduleIptvReconnect('stall');
                    }
                }
                else {
                    this._iptvStallCount = 0;
                    this._iptvLastTime = time;
                }
            }
            catch (err) {
                logger.debug('IPTV watchdog error', err);
            }
        }, interval);
    },
    _stopIptvWatchdog() {
        if (this._iptvWatchdogTimer) {
            try {
                clearInterval(this._iptvWatchdogTimer);
            }
            catch (_) { }
            this._iptvWatchdogTimer = null;
        }
        this._iptvLastTime = -1;
        this._iptvStallCount = 0;
    },
    // Render live streams (HLS/DASH/RTMP)
    renderLiveStream(container, content) {
        if (typeof webapis !== 'undefined' && webapis.avplay) {
            this.renderStreamAVPlay(container, content);
            return;
        }
        logger.warn('AVPlay unavailable; falling back to HTML5 video for live stream');
        this.renderVideoHTML5(container, content);
    },
    // Render live stream using AVPlay (HLS/DASH/RTMP)
    renderStreamAVPlay(container, content) {
        try {
            logger.info('Using Samsung AVPlay for live stream:', content.url);
            this.resetAvPlay();
            container.innerHTML = '';
            const fallbackToHtml5 = (reason) => {
                logger.error('AVPlay stream failed, falling back to HTML5:', reason);
                this.avplayReady = false;
                this.renderVideoHTML5(container, content);
            };
            // Detect stream type from URL or metadata
            const url = content.url || content.liveStreamUrl || '';
            const streamType = content.liveStreamType || this.detectStreamType(url);
            if (!url) {
                fallbackToHtml5('missing_url');
                return;
            }
            // CRITICAL: Follow Samsung's official sequence
            // 1. Open FIRST
            logger.info('AVPlay: Opening stream URL:', url);
            webapis.avplay.open(url);
            logger.debug('AVPlay: Open complete (stream)');
            // Apply profile after open (more reliable on some firmwares)
            this.applyAvPlayProfile(content);
            // 2. Set display rect SECOND (Samsung samples do this before setListener)
            // Use cached panel resolution — see comment in renderVideoAVPlay above.
            const viewportWidth = this._panelWidth;
            const viewportHeight = this._panelHeight;
            webapis.avplay.setDisplayRect(0, 0, viewportWidth, viewportHeight);
            logger.info('AVPlay: Display rect set for stream', viewportWidth, viewportHeight);
            // 3. Set listener THIRD (after open and setDisplayRect, before prepare)
            webapis.avplay.setListener({
                onbufferingstart: () => logger.debug('Stream buffering started'),
                onbufferingprogress: (p) => logger.debug('Stream buffering:', p + '%'),
                onbufferingcomplete: () => logger.debug('Stream buffering complete'),
                onstreamcompleted: () => {
                    logger.info('Stream ended');
                    document.body.classList.remove('avplay-active');
                    if (this.currentVideoEndedCallback) {
                        this.currentVideoEndedCallback();
                    }
                },
                onerror: (error) => {
                    logger.error('AVPlay stream error:', error);
                    document.body.classList.remove('avplay-active');
                    fallbackToHtml5(error);
                },
                onevent: (eventType, eventData) => {
                    logger.debug('AVPlay stream event:', eventType, eventData);
                }
            });
            // 4. Configure for streaming
            try {
                webapis.avplay.setTimeoutForBuffering(15); // Longer timeout for network streams
                logger.debug('AVPlay: Buffering timeout set to 15s for live stream');
            }
            catch (err) {
                logger.debug('setTimeoutForBuffering not supported');
            }
            // Set streaming properties based on type
            try {
                if (streamType === 'HLS') {
                    webapis.avplay.setStreamingProperty('ADAPTIVE_INFO', 'FIXED_MAX_RESOLUTION=FULL_HD');
                    logger.debug('AVPlay: Configured for HLS streaming');
                }
                else if (streamType === 'DASH') {
                    webapis.avplay.setStreamingProperty('ADAPTIVE_INFO', 'FIXED_MAX_RESOLUTION=FULL_HD');
                    logger.debug('AVPlay: Configured for DASH streaming');
                }
            }
            catch (err) {
                logger.debug('Stream property configuration not supported:', err);
            }
            logger.debug('AVPlay: Starting prepareAsync for stream...');
            webapis.avplay.prepareAsync(() => {
                try {
                    logger.debug('AVPlay: Stream prepare complete, setting display mode');
                    webapis.avplay.setDisplayMethod('PLAYER_DISPLAY_MODE_FULL_SCREEN');
                    // Re-apply display rect after prepare to match current resolution
                    try {
                        webapis.avplay.setDisplayRect(0, 0, viewportWidth, viewportHeight);
                        logger.debug('AVPlay: Display rect set after prepare (stream)', viewportWidth, viewportHeight);
                    }
                    catch (rectErr) {
                        logger.warn('AVPlay: setDisplayRect after prepare (stream) failed', rectErr);
                    }
                    // Make body transparent to show AVPlay hardware layer
                    document.body.classList.add('avplay-active');
                    logger.debug('Added avplay-active class for stream');
                    logger.debug('AVPlay: Starting stream playback');
                    webapis.avplay.play();
                    this.avplayReady = true;
                    logger.info('AVPlay live stream playback started');
                    // Watchdog: check if playback actually starts
                    // Live streams may buffer; give it a few seconds before deciding it's stalled.
                    const watchdogDelay = 5000;
                    setTimeout(() => {
                        var _a, _b, _c, _d;
                        try {
                            const state = (_b = (_a = webapis.avplay).getState) === null || _b === void 0 ? void 0 : _b.call(_a);
                            const time = (_d = (_c = webapis.avplay).getCurrentTime) === null || _d === void 0 ? void 0 : _d.call(_c);
                            if (state === 'PLAYING' && time === 0) {
                                logger.warn('AVPlay live stream appears stalled (state:', state, 'time:', time, '). Falling back to HTML5');
                                document.body.classList.remove('avplay-active');
                                fallbackToHtml5('stalled');
                            }
                            else {
                                logger.debug('AVPlay stream watchdog OK - state:', state, 'time:', time);
                            }
                        }
                        catch (watchErr) {
                            logger.debug('Stream watchdog check failed', watchErr);
                        }
                    }, watchdogDelay);
                }
                catch (playErr) {
                    document.body.classList.remove('avplay-active');
                    fallbackToHtml5(playErr);
                }
            }, (prepErr) => {
                logger.error('AVPlay stream prepare failed:', prepErr);
                document.body.classList.remove('avplay-active');
                fallbackToHtml5(prepErr);
            });
        }
        catch (error) {
            logger.error('AVPlay stream error, falling back to HTML5:', error);
            this.renderVideoHTML5(container, content);
        }
    },
    // Detect stream type from URL
    detectStreamType(url) {
        if (!url)
            return 'UNKNOWN';
        const urlLower = url.toLowerCase();
        if (urlLower.includes('.m3u8') || urlLower.includes('hls'))
            return 'HLS';
        if (urlLower.includes('.mpd') || urlLower.includes('dash'))
            return 'DASH';
        if (urlLower.startsWith('rtmp://') || urlLower.includes('rtmp'))
            return 'RTMP';
        return 'UNKNOWN';
    },
    // Detect IPTV protocol family from URL (and optional schema-supplied hint).
    // Returns one of: 'udp' | 'rtp' | 'rtsp' | 'hls' | 'dash' | 'http'.
    detectIptvProtocol(url, hint) {
        if (hint && typeof hint === 'string')
            return hint.toLowerCase();
        const s = String(url || '').toLowerCase();
        if (s.startsWith('udp://'))
            return 'udp';
        if (s.startsWith('rtp://'))
            return 'rtp';
        if (s.startsWith('rtsp://'))
            return 'rtsp';
        if (s.includes('.m3u8') || s.includes('hls'))
            return 'hls';
        if (s.includes('.mpd') || s.includes('dash'))
            return 'dash';
        return 'http';
    },
    renderIptvAVPlay(container, content) {
        const url = content.url;
        const proto = this.detectIptvProtocol(url, content.protocol);
        const isUdp = proto === 'udp' || proto === 'rtp';
        const isRtsp = proto === 'rtsp';
        const isHls = proto === 'hls';
        const isDash = proto === 'dash';
        if (typeof Telemetry !== 'undefined' && Telemetry.updateIptvStats) {
            Telemetry.updateIptvStats({
                url,
                protocol: proto.toUpperCase(),
                streamType: proto.toUpperCase(),
                bufferingEvents: 0,
                lastError: null,
            });
        }
        try {
            logger.info('Starting IPTV via AVPlay:', url);
            this.resetAvPlay();
            logger.info('IPTV AVPlay init');
            const videoContainer = document.createElement('div');
            videoContainer.id = 'avplay-iptv-container';
            videoContainer.style.position = 'absolute';
            videoContainer.style.width = '100%';
            videoContainer.style.height = '100%';
            videoContainer.style.top = '0';
            videoContainer.style.left = '0';
            container.appendChild(videoContainer);
            const rect = videoContainer.getBoundingClientRect();
            // CRITICAL: Follow Samsung's official sequence
            // 1. Open FIRST
            webapis.avplay.open(url);
            // Apply profile after open (more reliable on some firmwares)
            this.applyAvPlayProfile(content);
            // 2. Set display rect SECOND (Samsung samples do this before setListener)
            webapis.avplay.setDisplayRect(rect.left, rect.top, rect.width, rect.height);
            logger.debug('AVPlay: Display rect set for IPTV', rect);
            // 3. Set listener THIRD (after open and setDisplayRect, before prepare)
            webapis.avplay.setListener({
                onbufferingstart: () => {
                    var _a, _b;
                    logger.debug('IPTV buffering start');
                    if (typeof Telemetry !== 'undefined' && Telemetry.updateIptvStats) {
                        const current = (((_b = (_a = Telemetry.runtime) === null || _a === void 0 ? void 0 : _a.iptv) === null || _b === void 0 ? void 0 : _b.bufferingEvents) || 0) + 1;
                        Telemetry.updateIptvStats({ bufferingEvents: current });
                    }
                },
                onbufferingprogress: (p) => logger.debug('IPTV buffering', p + '%'),
                onbufferingcomplete: () => logger.debug('IPTV buffering complete'),
                onerror: (e) => {
                    logger.error('IPTV AVPlay error:', e);
                    if (typeof Telemetry !== 'undefined' && Telemetry.updateIptvStats) {
                        Telemetry.updateIptvStats({ lastError: String(e || 'unknown') });
                    }
                    this._stopIptvWatchdog();
                    // If we're inside a channel group, attempt reconnect; else fall back to idle.
                    if (this.currentChannelGroup) {
                        this._scheduleIptvReconnect('avplay-error');
                    }
                    else {
                        document.body.classList.remove('avplay-active');
                        this.showIdleScreen();
                    }
                },
                onstreamcompleted: () => {
                    logger.info('IPTV stream completed');
                    this._stopIptvWatchdog();
                    if (this.currentChannelGroup) {
                        // Multicast streams shouldn't "complete"; treat as drop and reconnect.
                        this._scheduleIptvReconnect('stream-completed');
                    }
                    else {
                        document.body.classList.remove('avplay-active');
                    }
                },
            });
            // 4. Configure per protocol. UDP/RTP need a tighter buffer timeout for
            //    low-latency multicast; HLS/DASH need their streamtype hint plus the
            //    adaptive resolution clamp; RTSP relies on AVPlay defaults.
            try {
                webapis.avplay.setTimeoutForBuffering(isUdp ? 4 : 10);
            }
            catch (err) {
                logger.debug('setTimeoutForBuffering not supported');
            }
            try {
                webapis.avplay.setBufferingParam('PLAYER_BUFFER_FOR_PLAY', '1000');
                webapis.avplay.setBufferingParam('PLAYER_BUFFER_FOR_RESUME', '3000');
            }
            catch (err) {
                logger.debug('setBufferingParam not supported');
            }
            if (isUdp) {
                try {
                    webapis.avplay.setStreamingProperty('SET_STREAMTYPE', 'UDP');
                }
                catch (err) {
                    logger.debug('setStreamingProperty UDP failed');
                }
            }
            else if (isHls) {
                try {
                    webapis.avplay.setStreamingProperty('SET_STREAMTYPE', 'HLS');
                    webapis.avplay.setStreamingProperty('ADAPTIVE_INFO', 'FIXED_MAX_RESOLUTION=FULL_HD');
                }
                catch (err) {
                    logger.debug('setStreamingProperty HLS failed');
                }
            }
            else if (isDash) {
                try {
                    webapis.avplay.setStreamingProperty('ADAPTIVE_INFO', 'FIXED_MAX_RESOLUTION=FULL_HD');
                }
                catch (err) {
                    logger.debug('setStreamingProperty DASH failed');
                }
            }
            else if (isRtsp) {
                logger.debug('IPTV: RTSP stream — using AVPlay defaults');
            }
            webapis.avplay.prepareAsync(() => {
                try {
                    // Align with the other AVPlay flows: set display method after prepare succeeds
                    try {
                        webapis.avplay.setDisplayMethod('PLAYER_DISPLAY_MODE_FULL_SCREEN');
                    }
                    catch (methodErr) {
                        logger.warn('AVPlay: setDisplayMethod failed (IPTV)', methodErr);
                    }
                    document.body.classList.add('avplay-active');
                    logger.debug('Added avplay-active class for IPTV');
                    // Re-apply rect after prepare in case layout changed
                    try {
                        webapis.avplay.setDisplayRect(rect.left, rect.top, rect.width, rect.height);
                        logger.debug('AVPlay: Display rect set after prepare (IPTV)', rect);
                    }
                    catch (rectErr) {
                        logger.warn('AVPlay: setDisplayRect after prepare (IPTV) failed', rectErr);
                    }
                    webapis.avplay.play();
                    logger.info('IPTV playback started');
                    // Successful start — clear any prior reconnect cycle and start the
                    // periodic stall watchdog (UDP=3s tick, others=5s tick).
                    this._clearIptvReconnect();
                    this._hideIptvOverlay();
                    this._startIptvWatchdog(isUdp);
                }
                catch (playErr) {
                    logger.error('IPTV play failed:', playErr);
                    this._stopIptvWatchdog();
                    if (this.currentChannelGroup) {
                        this._scheduleIptvReconnect('play-failed');
                    }
                    else {
                        document.body.classList.remove('avplay-active');
                        this.showIdleScreen();
                    }
                }
            }, (prepErr) => {
                logger.error('IPTV prepare failed:', prepErr);
                this._stopIptvWatchdog();
                if (this.currentChannelGroup) {
                    this._scheduleIptvReconnect('prepare-failed');
                }
                else {
                    document.body.classList.remove('avplay-active');
                    this.showIdleScreen();
                }
            });
        }
        catch (error) {
            logger.error('IPTV AVPlay error, fallback to HTML5:', error);
            this.renderVideoHTML5(container, content);
        }
    },
    resetAvPlay() {
        try {
            this._stopIptvWatchdog();
            if (typeof webapis !== 'undefined' && webapis.avplay) {
                try {
                    webapis.avplay.stop();
                }
                catch (e) { }
                try {
                    webapis.avplay.close();
                }
                catch (e) { }
                this.setAvPlayVisualMode(false);
                this.currentAvPlayProfileKey = null;
            }
        }
        catch (error) {
            logger.debug('resetAvPlay noop');
        }
    },
    // Initialize dual AVPlay players for seamless playback
    initSeamlessAVPlay() {
        try {
            if (typeof webapis === 'undefined' || !webapis.avplaystore) {
                logger.warn('AVPlay store not available for seamless playback');
                return false;
            }
            // Clean up existing players
            this.stopSeamlessAVPlay();
            // Get two player instances for seamless switching
            this.avPlayer1 = webapis.avplaystore.getPlayer();
            this.avPlayer2 = webapis.avplaystore.getPlayer();
            this.currentAvPlayer = null;
            this.seamlessPlaylistActive = true;
            logger.info('Dual AVPlay players initialized for seamless playback');
            return true;
        }
        catch (error) {
            logger.error('Failed to initialize seamless AVPlay:', error);
            return false;
        }
    },
    // Stop and cleanup seamless AVPlay players
    stopSeamlessAVPlay() {
        this.seamlessPlaylistActive = false;
        if (this.avPlayer1) {
            try {
                this.avPlayer1.stop();
            }
            catch (e) { }
            try {
                this.avPlayer1.close();
            }
            catch (e) { }
            this.avPlayer1 = null;
        }
        if (this.avPlayer2) {
            try {
                this.avPlayer2.stop();
            }
            catch (e) { }
            try {
                this.avPlayer2.close();
            }
            catch (e) { }
            this.avPlayer2 = null;
        }
        this.currentAvPlayer = null;
        this.setAvPlayVisualMode(false);
        logger.debug('Seamless AVPlay players stopped');
    }, // Get the active and next player for seamless switching
    getSeamlessPlayers() {
        if (!this.seamlessPlaylistActive) {
            return { current: null, next: null };
        }
        if (this.currentAvPlayer === 'player1') {
            return { current: this.avPlayer1, next: this.avPlayer2 };
        }
        else if (this.currentAvPlayer === 'player2') {
            return { current: this.avPlayer2, next: this.avPlayer1 };
        }
        else {
            // First play - use player1
            this.currentAvPlayer = 'player1';
            return { current: this.avPlayer1, next: this.avPlayer2 };
        }
    },
    // Switch to the next player for seamless playback
    switchSeamlessPlayer() {
        if (this.currentAvPlayer === 'player1') {
            this.currentAvPlayer = 'player2';
            logger.debug('Switched to AVPlay player 2');
        }
        else {
            this.currentAvPlayer = 'player1';
            logger.debug('Switched to AVPlay player 1');
        }
    },
    // Simplified seamless video rendering following Samsung's official pattern
    // Configure player on completion, not in advance
    renderVideoSeamlessSimple(content, onComplete) {
        var _a;
        if (!this.seamlessPlaylistActive) {
            logger.error('Seamless AVPlay not initialized');
            return;
        }
        const { current } = this.getSeamlessPlayers();
        if (!current) {
            logger.error('No current player available');
            return;
        }
        // Use cached panel resolution for AVPlay setDisplayRect — see renderVideoAVPlay comment.
        const viewportWidth = this._panelWidth;
        const viewportHeight = this._panelHeight;
        try {
            logger.info('[Seamless Simple] Playing video:', content.url);
            // Clean up previous state if player was used before
            try {
                const state = (_a = current.getState) === null || _a === void 0 ? void 0 : _a.call(current);
                if (state && state !== 'NONE' && state !== 'IDLE') {
                    logger.debug('[Seamless] Cleaning up previous player state:', state);
                    current.stop();
                    current.close();
                }
            }
            catch (err) {
                logger.debug('[Seamless] Player cleanup (expected):', err.message);
            }
            // Samsung sequence: open â†’ setDisplayRect â†’ setListener â†’ prepare â†’ play
            current.open(content.url);
            current.setDisplayRect(0, 0, viewportWidth, viewportHeight);
            current.setListener({
                onbufferingstart: () => logger.debug('[Seamless] Buffering started'),
                onbufferingprogress: (percent) => logger.debug('[Seamless] Buffering:', percent + '%'),
                onbufferingcomplete: () => logger.debug('[Seamless] Buffering complete'),
                onstreamcompleted: () => {
                    logger.info('[Seamless] Stream completed');
                    // Samsung pattern: stop current player and switch
                    try {
                        current.stop();
                        this.switchSeamlessPlayer();
                    }
                    catch (err) {
                        logger.debug('[Seamless] Stop error (expected):', err);
                    }
                    // Notify completion
                    if (onComplete) {
                        onComplete();
                    }
                },
                onerror: (eventType) => {
                    logger.error('[Seamless] AVPlay error:', eventType);
                    document.body.classList.remove('avplay-active');
                    if (onComplete) {
                        onComplete();
                    }
                },
                onevent: (eventType, eventData) => logger.debug('[Seamless] Event:', eventType, eventData)
            });
            current.prepareAsync(() => {
                logger.debug('[Seamless] Prepare complete, starting playback');
                document.body.classList.add('avplay-active');
                current.play();
                logger.info('[Seamless] Playback started');
            }, (error) => {
                logger.error('[Seamless] Prepare failed:', error);
                document.body.classList.remove('avplay-active');
                if (onComplete) {
                    onComplete();
                }
            });
        }
        catch (error) {
            logger.error('[Seamless] Failed to render video:', error);
            document.body.classList.remove('avplay-active');
            if (onComplete) {
                onComplete();
            }
        }
    },
    // Original complex seamless video rendering with pre-buffering (kept for reference)
    renderVideoSeamless(content, onComplete, nextContent = null) {
        var _a;
        if (!this.seamlessPlaylistActive) {
            logger.error('Seamless AVPlay not initialized');
            return;
        }
        const { current, next } = this.getSeamlessPlayers();
        if (!current) {
            logger.error('No current player available');
            return;
        }
        // Use cached panel resolution for AVPlay setDisplayRect — see renderVideoAVPlay comment.
        const viewportWidth = this._panelWidth;
        const viewportHeight = this._panelHeight;
        // Track if seamless transition will happen
        let seamlessTransitioned = false;
        try {
            logger.info('Playing seamless video:', content.url);
            // Close current player if it was previously used (for looping)
            try {
                const state = (_a = current.getState) === null || _a === void 0 ? void 0 : _a.call(current);
                if (state && state !== 'NONE' && state !== 'IDLE') {
                    logger.debug('Closing previous player state before reuse:', state);
                    current.stop();
                    current.close();
                }
            }
            catch (err) {
                logger.debug('Player cleanup (expected):', err.message);
            }
            // CRITICAL: Follow Samsung's official sequence from sample code
            // 1. Open FIRST
            current.open(content.url);
            // 2. Set display rect SECOND (Samsung samples do this before setListener)
            current.setDisplayRect(0, 0, viewportWidth, viewportHeight);
            logger.debug('Seamless AVPlay: Display rect set', viewportWidth, viewportHeight);
            // 3. Set listener THIRD (after open and setDisplayRect, before prepare)
            current.setListener({
                onbufferingstart: () => {
                    logger.debug('AVPlay buffering started');
                },
                onbufferingprogress: (percent) => {
                    logger.debug('AVPlay buffering:', percent + '%');
                },
                onbufferingcomplete: () => {
                    logger.debug('AVPlay buffering complete');
                },
                onstreamcompleted: () => {
                    logger.info('AVPlay stream completed');
                    // Enable still mode to freeze last frame
                    try {
                        current.setVideoStillMode('true');
                        logger.debug('Still mode enabled on current player');
                    }
                    catch (err) {
                        logger.warn('Failed to set still mode:', err);
                    }
                    // Stop current player (still mode keeps last frame visible)
                    try {
                        current.stop();
                    }
                    catch (err) {
                        logger.debug('Stop error (expected):', err);
                    }
                    // If next content was prepared, switch to it
                    if (nextContent) {
                        logger.info('Switching to next video:', nextContent.url);
                        this.switchSeamlessPlayer();
                        seamlessTransitioned = true;
                        // Start next player
                        try {
                            next.setVideoStillMode('false');
                            next.play();
                            logger.debug('Next player started - seamless transition complete');
                        }
                        catch (playErr) {
                            logger.error('Failed to start next player:', playErr);
                        }
                    }
                    // Always notify completion so playlist controller can advance index
                    if (onComplete) {
                        onComplete(seamlessTransitioned);
                    }
                },
                oncurrentplaytime: (currentTime) => {
                    // Optional: track playback time
                },
                onerror: (eventType) => {
                    logger.error('AVPlay error:', eventType);
                    document.body.classList.remove('avplay-active');
                    if (onComplete) {
                        onComplete();
                    }
                },
                onevent: (eventType, eventData) => {
                    logger.debug('AVPlay event:', eventType, eventData);
                }
            });
            // Use prepareAsync for proper playback
            current.prepareAsync(() => {
                // Success callback - player is ready
                logger.debug('AVPlay prepare complete, starting playback');
                // Make body transparent to show AVPlay hardware layer
                document.body.classList.add('avplay-active');
                // Start playback
                current.play();
                logger.info('Seamless AVPlay playback started');
            }, (error) => {
                // Error callback
                logger.error('AVPlay prepare failed:', error);
                document.body.classList.remove('avplay-active');
                if (onComplete) {
                    onComplete();
                }
            });
            // If next content is provided, prepare it in background
            if (nextContent && next) {
                setTimeout(() => {
                    try {
                        logger.info('Preparing next video in background:', nextContent.url);
                        // Follow Samsung sequence: open() FIRST
                        next.open(nextContent.url);
                        // Set listener SECOND (after open, before prepare)
                        next.setListener({
                            onbufferingstart: () => {
                                logger.debug('[Next] AVPlay buffering started');
                            },
                            onbufferingprogress: (percent) => {
                                logger.debug('[Next] AVPlay buffering:', percent + '%');
                            },
                            onbufferingcomplete: () => {
                                logger.debug('[Next] AVPlay buffering complete');
                            },
                            onstreamcompleted: () => {
                                logger.info('[Next] AVPlay stream completed');
                                // This will be the current player when it completes
                                const players = this.getSeamlessPlayers();
                                const nextPlayer = players.next;
                                // Enable still mode
                                try {
                                    players.current.setVideoStillMode('true');
                                    logger.debug('[Next] Still mode enabled');
                                }
                                catch (err) {
                                    logger.warn('[Next] Failed to set still mode:', err);
                                }
                                // Stop
                                try {
                                    players.current.stop();
                                }
                                catch (err) {
                                    logger.debug('[Next] Stop error (expected):', err);
                                }
                                // Notify completion
                                if (onComplete) {
                                    onComplete();
                                }
                            },
                            oncurrentplaytime: (currentTime) => {
                                // Optional: track playback time
                            },
                            onerror: (eventType) => {
                                logger.error('[Next] AVPlay error:', eventType);
                            },
                            onevent: (eventType, eventData) => {
                                logger.debug('[Next] AVPlay event:', eventType, eventData);
                            }
                        });
                        // Set display rect THIRD
                        next.setDisplayRect(0, 0, viewportWidth, viewportHeight);
                        // Use prepareAsync FOURTH
                        next.prepareAsync(() => {
                            logger.debug('Next video prepared and ready');
                        }, (error) => {
                            logger.warn('Failed to prepare next video:', error);
                        });
                    }
                    catch (prepErr) {
                        logger.warn('Failed to prepare next video:', prepErr);
                    }
                }, 1000); // Delay to avoid conflicting with current video start
            }
        }
        catch (error) {
            logger.error('Failed to render seamless video:', error);
            document.body.classList.remove('avplay-active');
            if (onComplete) {
                onComplete();
            }
        }
    },
    // Prepare next video in seamless player (for background buffering during playback)
    prepareSeamlessNextVideo(nextContent) {
        if (!this.seamlessPlaylistActive) {
            logger.warn('Cannot prepare next video - seamless mode not active');
            return;
        }
        const { current, next } = this.getSeamlessPlayers();
        if (!next) {
            logger.warn('No next player available for preparation');
            return;
        }
        // Use cached panel resolution for AVPlay setDisplayRect — see renderVideoAVPlay comment.
        const viewportWidth = this._panelWidth;
        const viewportHeight = this._panelHeight;
        try {
            logger.info('[Seamless] Preparing next video:', nextContent.url);
            // Follow Samsung sequence for background preparation
            next.open(nextContent.url);
            next.setListener({
                onbufferingstart: () => logger.debug('[Next] Buffering started'),
                onbufferingprogress: (percent) => logger.debug('[Next] Buffering:', percent + '%'),
                onbufferingcomplete: () => logger.debug('[Next] Buffering complete'),
                onstreamcompleted: () => {
                    logger.info('[Next] Stream completed');
                    // This will be handled by the playlist controller when this becomes current
                },
                onerror: (eventType) => logger.error('[Next] Error:', eventType),
                onevent: (eventType, eventData) => logger.debug('[Next] Event:', eventType, eventData)
            });
            next.setDisplayRect(0, 0, viewportWidth, viewportHeight);
            next.prepareAsync(() => logger.info('[Seamless] Next video prepared and ready for transition'), (error) => logger.warn('[Seamless] Failed to prepare next video:', error));
        }
        catch (error) {
            logger.warn('[Seamless] Error preparing next video:', error);
        }
    },
    // Render video using HTML5 video element (fallback)
    renderVideoHTML5(container, content) {
        logger.info('Using HTML5 video for:', content.url);
        const video = document.createElement('video');
        video.src = content.url;
        video.style.width = '100%';
        video.style.height = '100%';
        video.style.objectFit = 'contain';
        video.autoplay = true;
        video.loop = content.loop || false;
        video.muted = content.muted || false;
        // Track this <video> as the active sync target so SyncEngine drift
        // corrections can address it. Only meaningful in sync mode.
        if (this._syncMode) {
            this._activeSyncVideo = video;
        }
        // Explicitly play the video
        video.onloadedmetadata = () => {
            logger.info('Video loaded, starting playback:', content.url);
            video.play().catch(error => {
                logger.error('Failed to play video:', error);
            });
        };
        video.onerror = (error) => {
            logger.error('Video error:', error);
        };
        container.appendChild(video);
    },
    // High-precision timer using requestAnimationFrame for better sync accuracy
    waitForPreciseTime(targetTime, callback) {
        const checkTime = () => {
            const now = Date.now();
            const remaining = targetTime - now;
            if (remaining <= 0) {
                // Time reached, execute callback
                callback();
            }
            else if (remaining < 100) {
                // Less than 100ms remaining, use requestAnimationFrame for precision
                requestAnimationFrame(checkTime);
            }
            else {
                // More than 100ms remaining, use setTimeout to avoid busy-waiting
                setTimeout(checkTime, Math.max(10, remaining - 50));
            }
        };
        checkTime();
    },
    // High-precision timer using NTP-synchronized time
    waitForPreciseSyncedTime(targetSyncedTime, callback) {
        const checkTime = () => {
            const nowSynced = this.getSyncedTime();
            const remaining = targetSyncedTime - nowSynced;
            if (remaining <= 0) {
                // Time reached, execute callback
                callback();
            }
            else if (remaining < 100) {
                // Less than 100ms remaining, use requestAnimationFrame for precision
                requestAnimationFrame(checkTime);
            }
            else {
                // More than 100ms remaining, use setTimeout to avoid busy-waiting
                setTimeout(checkTime, Math.max(10, remaining - 50));
            }
        };
        checkTime();
    },
    // Synchronize time with server using NTP-like protocol
    syncTimeWithServer() {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.ntpSyncInProgress) {
                return;
            }
            this.ntpSyncInProgress = true;
            try {
                const sampleCount = 5;
                const maxAcceptableRttMs = 250;
                const samples = [];
                for (let i = 0; i < sampleCount; i++) {
                    const t0 = Date.now(); // Client time before request
                    // Best-effort timeout so one bad request doesn't stall all samples
                    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
                    const timeoutId = controller ? setTimeout(() => controller.abort(), 3000) : null;
                    try {
                        const response = yield fetch(`${CONFIG.API_BASE}/devices/time`, {
                            method: 'GET',
                            headers: {
                                'Content-Type': 'application/json',
                            },
                            signal: controller ? controller.signal : undefined,
                        });
                        const t3 = Date.now(); // Client time after response
                        const data = yield response.json();
                        const serverTime = Number(data === null || data === void 0 ? void 0 : data.timestamp);
                        if (!Number.isFinite(serverTime))
                            continue;
                        // Calculate offset assuming symmetric delay
                        const roundTripTime = t3 - t0;
                        const offset = serverTime - t0 - (roundTripTime / 2);
                        // Ignore very high RTT samples (downloads/jitter) to avoid polluting the offset
                        if (roundTripTime <= maxAcceptableRttMs) {
                            samples.push({ offset, rtt: roundTripTime });
                        }
                    }
                    catch (e) {
                        // Ignore failed samples
                    }
                    finally {
                        if (timeoutId)
                            clearTimeout(timeoutId);
                    }
                    // Tiny gap to avoid hammering the server/network stack
                    yield new Promise((r) => setTimeout(r, 20));
                }
                if (!samples.length) {
                    logger.warn(`NTP sync skipped: no samples with RTT <= ${maxAcceptableRttMs}ms`);
                    return;
                }
                // Pick the lowest-RTT sample (least network asymmetry/jitter)
                samples.sort((a, b) => a.rtt - b.rtt);
                const best = samples[0];
                const prev = Number(this.ntpOffset);
                const isFirst = !Number.isFinite(prev) || !this.lastNtpSync;
                const delta = isFirst ? 0 : Math.abs(best.offset - prev);
                // Snap immediately when drift exceeds ±50ms — don't smooth it away
                // For tiny adjustments (< 50ms) use gentle smoothing to avoid jitter
                const NTP_SNAP_THRESHOLD_MS = 50;
                const nextOffset = (isFirst || delta > NTP_SNAP_THRESHOLD_MS)
                    ? best.offset
                    : (prev * 0.8 + best.offset * 0.2);
                this.ntpOffset = Math.round(nextOffset);
                this.lastNtpSync = Date.now();
                logger.info(`NTP sync complete: offset=${Math.round(nextOffset)}ms (raw=${Math.round(best.offset)}ms), bestRTT=${Math.round(best.rtt)}ms, samples=${samples.length}${delta > NTP_SNAP_THRESHOLD_MS ? ' [SNAPPED]' : ''}`);
            }
            catch (error) {
                logger.error('Failed to sync time with server:', error);
            }
            finally {
                this.ntpSyncInProgress = false;
            }
        });
    },
    // Start periodic NTP synchronization
    startNtpSync() {
        // Only fire immediately if init() hasn't just completed a sync.
        // init() awaits syncTimeWithServer() before calling startNtpSync(), so
        // lastNtpSync will already be set â€” avoid hammering the server twice on startup.
        const msSinceLastSync = this.lastNtpSync ? Date.now() - this.lastNtpSync : Infinity;
        if (msSinceLastSync > 10000) {
            this.syncTimeWithServer();
        }
        // Resync every 30 seconds to keep clocks aligned
        setInterval(() => __awaiter(this, void 0, void 0, function* () {
            yield this.syncTimeWithServer();
        }), 30000);
        logger.info('Periodic NTP sync started (every 30s)');
    },
    // Get synchronized time (local time + NTP offset).
    // Uses a monotonic performance.now() base so wall-clock jumps (e.g. OS NTP
    // corrections) don't cause a step discontinuity mid-session. The bases are
    // captured lazily on first call so they're always close to init time.
    getSyncedTime() {
        if (this._monoPerfBase === undefined) {
            this._monoPerfBase = performance.now();
            this._monoDateBase = Date.now();
        }
        return (this._monoDateBase + (performance.now() - this._monoPerfBase)) + this.ntpOffset;
    },
    // Drift monitoring disabled - causes more problems than it solves
    // Loop-based resync is the correct approach for video walls
    parseContentMetadata(content) {
        if (!content || content.metadata == null) {
            return {};
        }
        if (typeof content.metadata === 'string') {
            try {
                return JSON.parse(content.metadata);
            }
            catch (error) {
                logger.warn('Failed to parse content metadata JSON:', error);
                return {};
            }
        }
        if (typeof content.metadata === 'object' && !Array.isArray(content.metadata)) {
            return Object.assign({}, content.metadata);
        }
        return {};
    },
    sanitizeMenuBoardColor(value, fallback) {
        if (typeof value !== 'string') {
            return fallback;
        }
        const trimmed = value.trim();
        if (!trimmed) {
            return fallback;
        }
        if (/^#[0-9a-fA-F]{3,8}$/.test(trimmed)) {
            return trimmed;
        }
        if (/^rgba?\([^)]*\)$/.test(trimmed) || /^hsla?\([^)]*\)$/.test(trimmed)) {
            return trimmed;
        }
        return fallback;
    },
    escapeHtml(value) {
        return String(value !== null && value !== void 0 ? value : '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/\"/g, '&quot;')
            .replace(/'/g, '&#39;');
    },
    formatMenuBoardPrice(cents, currency) {
        const normalizedCurrency = typeof currency === 'string' && currency ? currency : 'USD';
        const amount = Math.max(Number(cents) || 0, 0) / 100;
        const fractionDigits = normalizedCurrency === 'JPY' ? 0 : 2;
        try {
            return new Intl.NumberFormat(undefined, {
                style: 'currency',
                currency: normalizedCurrency,
                minimumFractionDigits: fractionDigits,
                maximumFractionDigits: fractionDigits,
            }).format(amount);
        }
        catch (_) {
            const prefixMap = {
                USD: '$',
                EUR: 'EUR ',
                GBP: 'GBP ',
                CAD: 'CAD ',
                AUD: 'AUD ',
                CHF: 'CHF ',
                SGD: 'SGD ',
                HKD: 'HKD ',
                JPY: 'JPY ',
            };
            const prefix = prefixMap[normalizedCurrency] || `${normalizedCurrency} `;
            return `${prefix}${amount.toFixed(fractionDigits)}`;
        }
    },
    getMenuBoardSections(menu, metadata) {
        const selectedCategoryIds = Array.isArray(metadata.categoryIds)
            ? metadata.categoryIds.filter((value) => typeof value === 'string')
            : [];
        const sourceCategories = menu && Array.isArray(menu.categories) ? menu.categories : [];
        const filteredCategories = selectedCategoryIds.length > 0
            ? sourceCategories.filter((category) => selectedCategoryIds.indexOf(category.id) !== -1)
            : sourceCategories;
        return filteredCategories
            .map((category) => (Object.assign(Object.assign({}, category), { items: Array.isArray(category.items) ? category.items.filter(Boolean) : [] })))
            .filter((category) => category.items.length > 0);
    },
    buildMenuBoardStateHtml(title, message) {
        return `
      <div style="display:flex;align-items:center;justify-content:center;height:100%;padding:32px;background:linear-gradient(160deg,#1f1510 0%,#120d0a 100%);color:#f7f2eb;font-family:'Segoe UI',Arial,sans-serif;text-align:center;box-sizing:border-box;">
        <div style="max-width:720px;">
          <div style="font-size:30px;font-weight:700;letter-spacing:0.02em;">${this.escapeHtml(title)}</div>
          <div style="margin-top:12px;font-size:16px;line-height:1.6;color:rgba(247,242,235,0.78);">${this.escapeHtml(message)}</div>
        </div>
      </div>
    `;
    },
    buildMenuBoardHtml(content, menu, metadata) {
        const layout = metadata.layout === '1-col' || metadata.layout === 'featured'
            ? metadata.layout
            : '2-col';
        const showPrices = metadata.showPrices !== false;
        const showImages = metadata.showImages !== false;
        const showDescription = metadata.showDescription === true;
        const fontScaleRaw = Number(metadata.fontScale);
        const fontScale = Number.isFinite(fontScaleRaw)
            ? Math.min(Math.max(fontScaleRaw, 0.8), 1.4)
            : 1;
        const accentColor = this.sanitizeMenuBoardColor(metadata.accentColor, '#dd6b20');
        const sections = this.getMenuBoardSections(menu, metadata);
        const currency = menu && typeof menu.currency === 'string' ? menu.currency : 'USD';
        if (sections.length === 0) {
            return this.buildMenuBoardStateHtml(content && content.name ? content.name : 'Menu Board', 'No active POS menu items are available for this board right now.');
        }
        let featuredItem = null;
        if (layout === 'featured') {
            for (const category of sections) {
                const preferred = category.items.find((item) => showImages && !!item.imageUrl) || category.items[0];
                if (preferred) {
                    featuredItem = preferred;
                    break;
                }
            }
        }
        const boardTitle = content && content.name ? content.name : (menu && menu.name ? menu.name : 'Menu Board');
        const subtitleParts = [];
        if (menu && menu.name && menu.name !== boardTitle) {
            subtitleParts.push(menu.name);
        }
        if (menu && menu.description) {
            subtitleParts.push(menu.description);
        }
        subtitleParts.push(`${sections.length} ${sections.length === 1 ? 'category' : 'categories'}`);
        const subtitle = subtitleParts.join(' | ');
        const sectionColumnCount = layout === '1-col' ? 1 : Math.min(2, sections.length || 1);
        const featuredMarkup = layout === 'featured' && featuredItem
            ? `
        <aside class="menu-board-feature">
          ${showImages && featuredItem.imageUrl ? `<div class="menu-board-feature-image"><img src="${this.escapeHtml(featuredItem.imageUrl)}" alt="${this.escapeHtml(featuredItem.name)}" /></div>` : ''}
          <div class="menu-board-feature-copy">
            <div class="menu-board-feature-kicker">Featured Item</div>
            <div class="menu-board-feature-title">${this.escapeHtml(featuredItem.name)}</div>
            ${showPrices ? `<div class="menu-board-feature-price">${this.escapeHtml(this.formatMenuBoardPrice(featuredItem.priceCents, currency))}</div>` : ''}
            ${showDescription && featuredItem.description ? `<div class="menu-board-feature-description">${this.escapeHtml(featuredItem.description)}</div>` : ''}
          </div>
        </aside>
      `
            : '';
        const sectionsMarkup = sections.map((category) => {
            const categoryAccent = this.sanitizeMenuBoardColor(category.color, accentColor);
            const itemsMarkup = category.items.map((item) => {
                const imageMarkup = showImages && item.imageUrl
                    ? `<div class="menu-board-item-image"><img src="${this.escapeHtml(item.imageUrl)}" alt="${this.escapeHtml(item.name)}" /></div>`
                    : '';
                const priceMarkup = showPrices
                    ? `<div class="menu-board-item-price">${this.escapeHtml(this.formatMenuBoardPrice(item.priceCents, currency))}</div>`
                    : '';
                const descriptionMarkup = showDescription && item.description
                    ? `<div class="menu-board-item-description">${this.escapeHtml(item.description)}</div>`
                    : '';
                return `
          <article class="menu-board-item ${imageMarkup ? 'has-image' : 'no-image'}">
            ${imageMarkup}
            <div class="menu-board-item-copy">
              <div class="menu-board-item-head">
                <div class="menu-board-item-name">${this.escapeHtml(item.name)}</div>
                ${priceMarkup}
              </div>
              ${descriptionMarkup}
            </div>
          </article>
        `;
            }).join('');
            return `
        <section class="menu-board-category" style="--menu-board-category-accent:${categoryAccent};">
          <div class="menu-board-category-head">
            <div>
              <div class="menu-board-category-title">${this.escapeHtml(category.name)}</div>
              ${category.description ? `<div class="menu-board-category-description">${this.escapeHtml(category.description)}</div>` : ''}
            </div>
            <div class="menu-board-category-count">${category.items.length}</div>
          </div>
          <div class="menu-board-item-list">${itemsMarkup}</div>
        </section>
      `;
        }).join('');
        return `
      <div class="menu-board-root">
        <style>
          .menu-board-root, .menu-board-root * { box-sizing: border-box; }
          .menu-board-root {
            --menu-board-accent: ${accentColor};
            --menu-board-scale: ${fontScale};
            width: 100%;
            height: 100%;
            color: #f7f2eb;
            font-family: 'Segoe UI', Arial, sans-serif;
            background: linear-gradient(160deg, #231812 0%, #120d0a 62%, #241913 100%);
          }
          .menu-board-shell {
            width: 100%;
            height: 100%;
            display: flex;
            flex-direction: column;
            gap: calc(18px * var(--menu-board-scale));
            padding: calc(28px * var(--menu-board-scale));
            overflow: hidden;
          }
          .menu-board-header {
            display: flex;
            align-items: flex-end;
            justify-content: space-between;
            gap: 18px;
          }
          .menu-board-eyebrow {
            font-size: calc(12px * var(--menu-board-scale));
            font-weight: 700;
            letter-spacing: 0.16em;
            text-transform: uppercase;
            color: var(--menu-board-accent);
          }
          .menu-board-title {
            margin: 6px 0 0;
            font-size: calc(34px * var(--menu-board-scale));
            line-height: 1.05;
            letter-spacing: -0.03em;
          }
          .menu-board-subtitle {
            margin-top: 8px;
            font-size: calc(14px * var(--menu-board-scale));
            line-height: 1.5;
            color: rgba(247, 242, 235, 0.7);
          }
          .menu-board-grid {
            flex: 1;
            min-height: 0;
            display: grid;
            grid-template-columns: 1fr;
            gap: calc(18px * var(--menu-board-scale));
          }
          .menu-board-grid.is-featured {
            grid-template-columns: minmax(320px, 0.95fr) minmax(0, 1.75fr);
          }
          .menu-board-feature {
            min-height: 0;
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 26px;
            overflow: hidden;
            background: linear-gradient(180deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.03) 100%);
            display: flex;
            flex-direction: column;
          }
          .menu-board-feature-image {
            height: 48%;
            min-height: 210px;
            background: rgba(255,255,255,0.04);
          }
          .menu-board-feature-image img {
            width: 100%;
            height: 100%;
            display: block;
            object-fit: cover;
          }
          .menu-board-feature-copy {
            padding: calc(22px * var(--menu-board-scale));
            display: flex;
            flex-direction: column;
            gap: 10px;
          }
          .menu-board-feature-kicker {
            font-size: calc(11px * var(--menu-board-scale));
            letter-spacing: 0.16em;
            text-transform: uppercase;
            color: var(--menu-board-accent);
            font-weight: 700;
          }
          .menu-board-feature-title {
            font-size: calc(30px * var(--menu-board-scale));
            line-height: 1.05;
            font-weight: 800;
          }
          .menu-board-feature-price {
            font-size: calc(22px * var(--menu-board-scale));
            font-weight: 700;
            color: #fff4cf;
          }
          .menu-board-feature-description {
            font-size: calc(15px * var(--menu-board-scale));
            line-height: 1.55;
            color: rgba(247, 242, 235, 0.8);
          }
          .menu-board-sections {
            min-height: 0;
            display: grid;
            align-content: start;
            grid-template-columns: repeat(${sectionColumnCount}, minmax(0, 1fr));
            gap: calc(16px * var(--menu-board-scale));
            overflow: hidden;
          }
          .menu-board-category {
            min-height: 0;
            display: flex;
            flex-direction: column;
            gap: calc(14px * var(--menu-board-scale));
            padding: calc(18px * var(--menu-board-scale));
            border-radius: 24px;
            border: 1px solid rgba(255,255,255,0.09);
            background: linear-gradient(180deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.035) 100%);
            box-shadow: inset 4px 0 0 var(--menu-board-category-accent);
          }
          .menu-board-category-head {
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            gap: 14px;
          }
          .menu-board-category-title {
            font-size: calc(22px * var(--menu-board-scale));
            line-height: 1.1;
            font-weight: 800;
            overflow-wrap: anywhere;
          }
          .menu-board-category-description {
            margin-top: 6px;
            font-size: calc(12px * var(--menu-board-scale));
            line-height: 1.45;
            color: rgba(247, 242, 235, 0.62);
          }
          .menu-board-category-count {
            min-width: calc(32px * var(--menu-board-scale));
            height: calc(32px * var(--menu-board-scale));
            padding: 0 10px;
            border-radius: 999px;
            background: rgba(255,255,255,0.08);
            color: var(--menu-board-accent);
            display: inline-flex;
            align-items: center;
            justify-content: center;
            font-size: calc(12px * var(--menu-board-scale));
            font-weight: 700;
          }
          .menu-board-item-list {
            display: flex;
            flex-direction: column;
            gap: calc(10px * var(--menu-board-scale));
            min-height: 0;
            overflow: hidden;
          }
          .menu-board-item {
            display: grid;
            grid-template-columns: minmax(0, 1fr);
            gap: 12px;
            padding: calc(12px * var(--menu-board-scale));
            border-radius: 18px;
            background: rgba(255,255,255,0.045);
            border: 1px solid rgba(255,255,255,0.06);
          }
          .menu-board-item.has-image {
            grid-template-columns: calc(74px * var(--menu-board-scale)) minmax(0, 1fr);
          }
          .menu-board-item-image {
            width: calc(74px * var(--menu-board-scale));
            height: calc(74px * var(--menu-board-scale));
            border-radius: 14px;
            overflow: hidden;
            background: rgba(255,255,255,0.06);
          }
          .menu-board-item-image img {
            width: 100%;
            height: 100%;
            display: block;
            object-fit: cover;
          }
          .menu-board-item-copy {
            min-width: 0;
            display: flex;
            flex-direction: column;
            gap: 6px;
          }
          .menu-board-item-head {
            display: flex;
            align-items: baseline;
            justify-content: space-between;
            gap: 12px;
          }
          .menu-board-item-name {
            min-width: 0;
            font-size: calc(17px * var(--menu-board-scale));
            line-height: 1.25;
            font-weight: 700;
            overflow-wrap: anywhere;
          }
          .menu-board-item-price {
            white-space: nowrap;
            font-size: calc(14px * var(--menu-board-scale));
            font-weight: 700;
            color: #fff4cf;
          }
          .menu-board-item-description {
            font-size: calc(12px * var(--menu-board-scale));
            line-height: 1.45;
            color: rgba(247, 242, 235, 0.72);
            overflow: hidden;
            display: -webkit-box;
            -webkit-line-clamp: 2;
            -webkit-box-orient: vertical;
          }
          @media (max-width: 1280px) {
            .menu-board-grid.is-featured {
              grid-template-columns: 1fr;
            }
            .menu-board-sections {
              grid-template-columns: 1fr;
            }
          }
        </style>
        <div class="menu-board-shell">
          <header class="menu-board-header">
            <div>
              <div class="menu-board-eyebrow">Live POS Menu</div>
              <h1 class="menu-board-title">${this.escapeHtml(boardTitle)}</h1>
              <div class="menu-board-subtitle">${this.escapeHtml(subtitle)}</div>
            </div>
          </header>
          <div class="menu-board-grid ${layout === 'featured' ? 'is-featured' : ''}">
            ${featuredMarkup}
            <div class="menu-board-sections">${sectionsMarkup}</div>
          </div>
        </div>
      </div>
    `;
    },
    renderMenuBoard(container, content) {
        return __awaiter(this, void 0, void 0, function* () {
            const metadata = this.parseContentMetadata(content);
            const posWorkspaceId = typeof metadata.posWorkspaceId === 'string' && metadata.posWorkspaceId
                ? metadata.posWorkspaceId
                : null;
            if (!posWorkspaceId) {
                logger.warn('Menu board is missing posWorkspaceId metadata:', content && content.id);
                container.innerHTML = this.buildMenuBoardStateHtml(content && content.name ? content.name : 'Menu Board', 'This menu board is missing its POS workspace source.');
                return;
            }
            const menuBoardContainer = container;
            const requestId = `menu-board-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            menuBoardContainer._menuBoardRequestId = requestId;
            container.innerHTML = this.buildMenuBoardStateHtml(content && content.name ? content.name : 'Menu Board', 'Loading the latest POS menu...');
            try {
                const response = yield fetch(`${CONFIG.API_BASE}/pos/menu?workspaceId=${encodeURIComponent(posWorkspaceId)}`);
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }
                const menu = yield response.json();
                if (!container.isConnected || menuBoardContainer._menuBoardRequestId !== requestId) {
                    return;
                }
                container.innerHTML = this.buildMenuBoardHtml(content, menu, metadata);
            }
            catch (error) {
                logger.error('Failed to load menu board data:', error);
                if (!container.isConnected || menuBoardContainer._menuBoardRequestId !== requestId) {
                    return;
                }
                container.innerHTML = this.buildMenuBoardStateHtml(content && content.name ? content.name : 'Menu Board', 'The live POS menu could not be loaded. Check the API connection or publish an active menu.');
            }
        });
    },
    // -- Calendar content ----------------------------------------------------
    // Polls /content/{id}/calendar/events on a refresh interval and renders a
    // Google/Outlook-style calendar grid (day, week, month, meeting_room views).
    renderCalendar(container, content) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            const meta = this.parseContentMetadata(content);
            const view = meta.view || 'week';
            const timezone = meta.timezone || 'UTC';
            const refreshSeconds = Math.max(15, Number(meta.refreshSeconds) || 60);
            const theme = meta.theme || {};
            const accent = theme.accentColor || '#1a73e8';
            const isDark = theme.background === 'dark';
            const roomMeta = meta.roomMeta;
            const bg = isDark ? '#1e1e2e' : '#ffffff';
            const surface = isDark ? '#2a2a3e' : '#f8f9fa';
            const border = isDark ? '#3a3a50' : '#e0e0e0';
            const text = isDark ? '#e2e8f0' : '#202124';
            const textMuted = isDark ? '#94a3b8' : '#70757a';
            const escapeHtml = (s) => this.escapeHtml(s);
            const calContainer = container;
            if (calContainer._calendarTimer) {
                clearInterval(calContainer._calendarTimer);
                calContainer._calendarTimer = undefined;
            }
            if (calContainer._clockTimer) {
                clearInterval(calContainer._clockTimer);
                calContainer._clockTimer = undefined;
            }
            if (calContainer._calendarUnsub) {
                try {
                    calContainer._calendarUnsub();
                }
                catch ( /**/_b) { /**/ }
                calContainer._calendarUnsub = undefined;
            }
            const reqId = `cal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            calContainer._calendarReqId = reqId;
            // -- helpers ----------------------------------------------------------------
            const toLocal = (iso) => new Date(new Date(iso).toLocaleString('en-US', { timeZone: timezone }));
            const pad2 = (n) => (n < 10 ? '0' : '') + n;
            const fmtTime = (d) => {
                let h = d.getHours();
                const m = d.getMinutes();
                const ampm = h >= 12 ? 'PM' : 'AM';
                h = h % 12 || 12;
                return m === 0 ? `${h} ${ampm}` : `${h}:${pad2(m)} ${ampm}`;
            };
            const fmtTimeFull = (d) => {
                let h = d.getHours();
                const m = d.getMinutes();
                const ampm = h >= 12 ? 'PM' : 'AM';
                h = h % 12 || 12;
                return `${h}:${pad2(m)} ${ampm}`;
            };
            const clockStyle = (_a = theme.clockStyle) !== null && _a !== void 0 ? _a : 'digital-12';
            const fmtClockTime = (d) => {
                if (clockStyle === 'digital-24')
                    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
                let h = d.getHours();
                const m = d.getMinutes();
                const ampm = h >= 12 ? 'PM' : 'AM';
                h = h % 12 || 12;
                return `${h}:${pad2(m)} ${ampm}`;
            };
            const fmtDate = (d) => d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
            const isoDate = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
            const getNow = () => new Date(new Date().toLocaleString('en-US', { timeZone: timezone }));
            const HOUR_PX = 64; // pixels per hour in time-grid views
            // -- event colour palette (cycle through like Google Calendar) -------------
            const PALETTE = ['#1a73e8', '#0f9d58', '#e67c00', '#8430ce', '#d50000', '#0097a7', '#616161', '#e91e63'];
            const evColor = (ev, idx) => PALETTE[idx % PALETTE.length];
            // -- shared header (title + date nav area + clock) -------------------------
            const buildHeader = (dateLabel) => {
                const now = getNow();
                const timeStr = fmtTimeFull(now);
                const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
                return `
        <header style="flex-shrink:0;display:flex;align-items:center;padding:16px 24px;
                        background:${bg};border-bottom:1px solid ${border};gap:16px;">
          <div style="width:4px;min-height:40px;background:${accent};border-radius:2px;flex-shrink:0;"></div>
          <div style="flex:1;min-width:0;">
            <div style="font-size:13px;color:${textMuted};font-weight:500;text-transform:uppercase;letter-spacing:0.5px;">
              ${escapeHtml(content.name || 'Calendar')}
            </div>
            <div style="font-size:20px;font-weight:600;color:${text};margin-top:2px;">${escapeHtml(dateLabel)}</div>
          </div>
          <div style="text-align:right;flex-shrink:0;">
            <div id="cal-clock" style="font-size:28px;font-weight:700;color:${accent};letter-spacing:-0.5px;">${escapeHtml(timeStr)}</div>
            <div style="font-size:13px;color:${textMuted};margin-top:2px;">${escapeHtml(dateStr)}</div>
          </div>
        </header>`;
            };
            // -- start live clock -------------------------------------------------------
            const startClock = () => {
                if (calContainer._clockTimer)
                    clearInterval(calContainer._clockTimer);
                calContainer._clockTimer = window.setInterval(() => {
                    if (calContainer._calendarReqId !== reqId) {
                        clearInterval(calContainer._clockTimer);
                        return;
                    }
                    const el = container.querySelector('#cal-clock');
                    if (el)
                        el.textContent = clockStyle === 'none' ? '' : fmtClockTime(getNow());
                    // Update current-time indicator position
                    const now = getNow();
                    const minOfDay = now.getHours() * 60 + now.getMinutes();
                    const pct = (minOfDay / (24 * 60)) * 100;
                    const indicator = container.querySelector('#cal-now-line');
                    if (indicator)
                        indicator.style.top = `${pct}%`;
                    const dot = container.querySelector('#cal-now-dot');
                    if (dot)
                        dot.style.top = `calc(${pct}% - 5px)`;
                }, 30000);
            };
            // -- time-grid left gutter (hours 0�23) -------------------------------------
            const buildTimeGutter = () => {
                let rows = '';
                for (let h = 0; h < 24; h++) {
                    const label = h === 0 ? '' : (h < 12 ? `${h} AM` : h === 12 ? '12 PM' : `${h - 12} PM`);
                    rows += `<div style="height:${HOUR_PX}px;box-sizing:border-box;padding-right:8px;text-align:right;
                              font-size:11px;color:${textMuted};position:relative;top:-7px;">${escapeHtml(label)}</div>`;
                }
                return `<div style="width:52px;flex-shrink:0;border-right:1px solid ${border};overflow:hidden;">${rows}</div>`;
            };
            // -- hour lines background --------------------------------------------------
            const buildHourLines = () => {
                let lines = '';
                for (let h = 0; h < 24; h++) {
                    lines += `<div style="position:absolute;left:0;right:0;top:${h * HOUR_PX}px;
                               border-top:1px solid ${border};pointer-events:none;"></div>`;
                }
                return lines;
            };
            // -- current-time indicator ------------------------------------------------
            const buildNowIndicator = (now) => {
                const minOfDay = now.getHours() * 60 + now.getMinutes();
                const pct = (minOfDay / (24 * 60)) * 100;
                return `
        <div id="cal-now-dot" style="position:absolute;left:-5px;width:10px;height:10px;
              border-radius:50%;background:${accent};z-index:10;top:calc(${pct}% - 5px);"></div>
        <div id="cal-now-line" style="position:absolute;left:0;right:0;top:${pct}%;
              border-top:2px solid ${accent};z-index:9;"></div>`;
            };
            // -- place events in a single day column ------------------------------------
            const buildDayEvents = (dayEvs, colWidth = '100%', colLeft = '0%') => {
                return dayEvs.map((ev, i) => {
                    if (ev.allDay)
                        return '';
                    const s = toLocal(ev.start);
                    const e2 = toLocal(ev.end);
                    const startMin = s.getHours() * 60 + s.getMinutes();
                    const endMin = Math.min(e2.getHours() * 60 + e2.getMinutes(), 24 * 60);
                    const durMin = Math.max(endMin - startMin, 30);
                    const top = (startMin / 60) * HOUR_PX;
                    const height = Math.max((durMin / 60) * HOUR_PX, 22);
                    const color = evColor(ev, i);
                    const showLoc = height > 44 && ev.location;
                    return `
          <div style="position:absolute;left:calc(${colLeft} + 2px);width:calc(${colWidth} - 4px);
                       top:${top}px;height:${height}px;background:${color};border-radius:4px;
                       padding:3px 6px;box-sizing:border-box;overflow:hidden;z-index:5;cursor:default;">
            <div style="font-size:12px;font-weight:600;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
              ${escapeHtml(ev.title || '(no title)')}
            </div>
            <div style="font-size:11px;color:rgba(255,255,255,0.85);white-space:nowrap;overflow:hidden;">
              ${fmtTimeFull(s)} � ${fmtTimeFull(e2)}
            </div>
            ${showLoc ? `<div style="font-size:10px;color:rgba(255,255,255,0.75);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(ev.location)}</div>` : ''}
          </div>`;
                }).join('');
            };
            // -- ALL-DAY strip ----------------------------------------------------------
            const buildAllDayStrip = (allDayEvs, cols) => {
                if (allDayEvs.length === 0)
                    return '';
                const colW = 100 / cols.length;
                const chips = allDayEvs.map((ev, i) => {
                    const s = toLocal(ev.start);
                    const colIdx = cols.findIndex((d) => isoDate(d) === isoDate(s));
                    if (colIdx < 0)
                        return '';
                    return `<div style="position:absolute;left:calc(${colIdx * colW}% + 2px);width:calc(${colW}% - 4px);
                             top:${i * 22}px;height:20px;background:${evColor(ev, i)};border-radius:3px;
                             padding:2px 6px;font-size:11px;color:#fff;font-weight:600;
                             white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                  ${escapeHtml(ev.title || '(all day)')}
                </div>`;
                }).join('');
                const height = allDayEvs.length * 22 + 4;
                return `
        <div style="display:flex;flex-shrink:0;border-bottom:1px solid ${border};">
          <div style="width:52px;flex-shrink:0;font-size:11px;color:${textMuted};padding:4px 8px 4px 0;text-align:right;border-right:1px solid ${border};">all-day</div>
          <div style="flex:1;position:relative;height:${height}px;">${chips}</div>
        </div>`;
            };
            // ---------------------------------------------------------------------------
            // VIEW RENDERERS
            // ---------------------------------------------------------------------------
            const renderDayView = (events) => {
                const now = getNow();
                const dateLabel = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
                const today = isoDate(now);
                const dayEvs = events.filter((e) => isoDate(toLocal(e.start)) === today);
                const allDayEvs = dayEvs.filter((e) => e.allDay);
                const timedEvs = dayEvs.filter((e) => !e.allDay);
                const scrollTop = Math.max(0, (now.getHours() - 1) * HOUR_PX);
                container.innerHTML = `
        <div style="position:absolute;top:0;right:0;bottom:0;left:0;display:flex;flex-direction:column;
                     background:${bg};color:${text};
                     font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;overflow:hidden;">
          ${buildHeader(dateLabel)}
          ${buildAllDayStrip(allDayEvs, [now])}
          <div style="flex:1;display:flex;overflow:hidden;">
            ${buildTimeGutter()}
            <div id="cal-scroll" style="flex:1;overflow-y:auto;position:relative;">
              <div style="position:relative;height:${24 * HOUR_PX}px;">
                ${buildHourLines()}
                ${buildNowIndicator(now)}
                ${buildDayEvents(timedEvs)}
              </div>
            </div>
          </div>
        </div>`;
                const scroll = container.querySelector('#cal-scroll');
                if (scroll)
                    scroll.scrollTop = scrollTop;
                startClock();
            };
            const renderWeekView = (events, numDays) => {
                const now = getNow();
                const startOfWeek = new Date(now);
                // For 5-day: start Monday; for 7-day: start Sunday
                const dow = now.getDay();
                const offset = numDays === 5 ? (dow === 0 ? -6 : 1 - dow) : -dow;
                startOfWeek.setDate(now.getDate() + offset);
                startOfWeek.setHours(0, 0, 0, 0);
                const days = Array.from({ length: numDays }, (_, i) => {
                    const d = new Date(startOfWeek);
                    d.setDate(d.getDate() + i);
                    return d;
                });
                const rangeLabel = `${days[0].toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} � ${days[numDays - 1].toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
                const colW = 100 / numDays;
                const allDayEvs = events.filter((e) => e.allDay);
                const timedEvs = events.filter((e) => !e.allDay);
                // day column headers
                const dayHeaders = days.map((d) => {
                    const isToday = isoDate(d) === isoDate(now);
                    const num = d.getDate();
                    return `
          <div style="flex:1;text-align:center;padding:6px 4px;border-right:1px solid ${border};">
            <div style="font-size:11px;font-weight:500;color:${textMuted};text-transform:uppercase;">
              ${d.toLocaleDateString('en-US', { weekday: 'short' })}
            </div>
            <div style="width:30px;height:30px;margin:4px auto 0;border-radius:50%;
                         display:flex;align-items:center;justify-content:center;
                         background:${isToday ? accent : 'transparent'};
                         color:${isToday ? '#fff' : text};font-size:16px;font-weight:${isToday ? 700 : 400};">
              ${num}
            </div>
          </div>`;
                }).join('');
                // timed events per day column
                const dayEventCols = days.map((d) => {
                    const key = isoDate(d);
                    const evs = timedEvs.filter((e) => isoDate(toLocal(e.start)) === key);
                    return `<div style="position:absolute;left:${days.indexOf(d) * colW}%;width:${colW}%;top:0;bottom:0;">
          ${buildDayEvents(evs)}
        </div>`;
                }).join('');
                const scrollTop = Math.max(0, (now.getHours() - 1) * HOUR_PX);
                container.innerHTML = `
        <div style="position:absolute;top:0;right:0;bottom:0;left:0;display:flex;flex-direction:column;
                     background:${bg};color:${text};
                     font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;overflow:hidden;">
          ${buildHeader(rangeLabel)}
          <div style="display:flex;border-bottom:1px solid ${border};flex-shrink:0;">
            <div style="width:52px;flex-shrink:0;border-right:1px solid ${border};"></div>
            ${dayHeaders}
          </div>
          ${buildAllDayStrip(allDayEvs, days)}
          <div style="flex:1;display:flex;overflow:hidden;">
            ${buildTimeGutter()}
            <div id="cal-scroll" style="flex:1;overflow-y:auto;position:relative;">
              <div style="position:relative;height:${24 * HOUR_PX}px;">
                ${buildHourLines()}
                ${days.some((d) => isoDate(d) === isoDate(now)) ? buildNowIndicator(now) : ''}
                ${dayEventCols}
                ${ /* vertical day separators */days.slice(1).map((d, i) => `<div style="position:absolute;left:${(i + 1) * colW}%;top:0;bottom:0;border-left:1px solid ${border};pointer-events:none;"></div>`).join('')}
              </div>
            </div>
          </div>
        </div>`;
                const scroll = container.querySelector('#cal-scroll');
                if (scroll)
                    scroll.scrollTop = scrollTop;
                startClock();
            };
            const renderMonthView = (events) => {
                const now = getNow();
                const monthLabel = now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
                const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
                const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
                const startDow = firstDay.getDay(); // 0=Sun
                const totalDays = lastDay.getDate();
                const cells = [
                    ...Array(startDow).fill(null),
                    ...Array.from({ length: totalDays }, (_, i) => new Date(now.getFullYear(), now.getMonth(), i + 1)),
                ];
                while (cells.length % 7 !== 0)
                    cells.push(null);
                const weeks = [];
                for (let i = 0; i < cells.length; i += 7)
                    weeks.push(cells.slice(i, i + 7));
                const DAY_HEADERS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
                const todayIso = isoDate(now);
                const numWeeks = weeks.length;
                const cellH = `calc((100% - 32px) / ${numWeeks})`; // 32px = header row height
                const headerRow = `<div style="display:flex;flex-shrink:0;border-bottom:2px solid ${border};">` +
                    DAY_HEADERS.map((d) => `<div style="flex:1;text-align:center;font-size:11px;font-weight:600;color:${textMuted};
                        padding:8px 0;text-transform:uppercase;">${d}</div>`).join('') + '</div>';
                const weekRows = weeks.map((week) => `<div style="display:flex;flex:1;min-height:0;">` +
                    week.map((day) => {
                        if (!day)
                            return `<div style="flex:1;border:1px solid ${border};background:${surface};"></div>`;
                        const dayIso = isoDate(day);
                        const isToday = dayIso === todayIso;
                        const dayEvs = events.filter((e) => isoDate(toLocal(e.start)) === dayIso).slice(0, 3);
                        const chips = dayEvs.map((ev, i) => `
            <div style="margin:1px 4px;padding:1px 5px;border-radius:3px;font-size:11px;
                         background:${evColor(ev, i)};color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
              ${ev.allDay ? '' : `<span style="opacity:0.85;">${fmtTimeFull(toLocal(ev.start))} </span>`}${escapeHtml(ev.title || '(no title)')}
            </div>`).join('');
                        return `
            <div style="flex:1;border:1px solid ${border};padding:4px 0;box-sizing:border-box;overflow:hidden;
                         background:${isToday ? (isDark ? 'rgba(26,115,232,0.12)' : 'rgba(26,115,232,0.06)') : bg};">
              <div style="text-align:center;margin-bottom:2px;">
                <span style="display:inline-block;width:24px;height:24px;line-height:24px;border-radius:50%;
                              text-align:center;font-size:13px;
                              background:${isToday ? accent : 'transparent'};
                              color:${isToday ? '#fff' : text};font-weight:${isToday ? 700 : 400};">
                  ${day.getDate()}
                </span>
              </div>
              ${chips}
            </div>`;
                    }).join('') + '</div>').join('');
                container.innerHTML = `
        <div style="position:absolute;top:0;right:0;bottom:0;left:0;display:flex;flex-direction:column;
                     background:${bg};color:${text};
                     font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;overflow:hidden;">
          ${buildHeader(monthLabel)}
          <div style="flex:1;display:flex;flex-direction:column;overflow:hidden;">
            ${headerRow}
            ${weekRows}
          </div>
        </div>`;
                startClock();
            };
            const renderMeetingRoom = (events) => {
                var _a;
                const now = getNow();
                const startOfDay = new Date();
                startOfDay.setHours(0, 0, 0, 0);
                const endOfDay = new Date(startOfDay);
                endOfDay.setDate(endOfDay.getDate() + 1);
                const today = events
                    .filter((e) => new Date(e.end).getTime() > startOfDay.getTime()
                    && new Date(e.start).getTime() < endOfDay.getTime())
                    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
                const currentEv = today.find((e) => new Date(e.start).getTime() <= Date.now()
                    && new Date(e.end).getTime() > Date.now());
                const nextEv = today.find((e) => new Date(e.start).getTime() > Date.now());
                const isBusy = !!currentEv;
                // Amber state: within 15 min of current meeting ending or next meeting starting
                const msToCurrentEnd = currentEv ? new Date(currentEv.end).getTime() - Date.now() : Infinity;
                const msToNextStart = nextEv ? new Date(nextEv.start).getTime() - Date.now() : Infinity;
                const isAmberEnding = isBusy && msToCurrentEnd < 15 * 60 * 1000;
                const isAmberSoon = !isBusy && isFinite(msToNextStart) && msToNextStart < 15 * 60 * 1000;
                const railColor = (isBusy && !isAmberEnding) ? '#d93025'
                    : (isBusy && isAmberEnding) ? '#f59e0b'
                        : isAmberSoon ? '#f59e0b'
                            : '#34a853';
                const portrait = window.innerHeight > window.innerWidth;
                const roomName = (roomMeta === null || roomMeta === void 0 ? void 0 : roomMeta.name) || content.name || 'Meeting Room';
                const capacity = (_a = roomMeta === null || roomMeta === void 0 ? void 0 : roomMeta.capacity) !== null && _a !== void 0 ? _a : null;
                const bookingUrl = (roomMeta === null || roomMeta === void 0 ? void 0 : roomMeta.bookingUrl) || '';
                const logoUrl = (roomMeta === null || roomMeta === void 0 ? void 0 : roomMeta.logoUrl) || '';
                const backgroundUrl = (roomMeta === null || roomMeta === void 0 ? void 0 : roomMeta.backgroundUrl) || '';
                const showLoc = theme.showLocation !== false;
                const showAtt = !!theme.showAttendeeCount;
                const fmtRange = (e) => {
                    const s = toLocal(e.start), en = toLocal(e.end);
                    return `${fmtClockTime(s)} \u2013 ${fmtClockTime(en)}`;
                };
                const fmtCountdown = (ms) => {
                    const mins = Math.ceil(ms / 60000);
                    return mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)}h ${pad2(mins % 60)}m`;
                };
                // All-day events shown as a compact strip above timed events
                const allDayEvents = today.filter((e) => e.allDay);
                const timedEvents = today.filter((e) => !e.allDay);
                const allDayHtml = allDayEvents.length === 0 ? '' : `
        <div style="display:flex;flex-wrap:wrap;gap:8px;padding:12px 36px;
                     border-bottom:1px solid ${border};background:${isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)'}">
          ${allDayEvents.map((e) => {
                    const isCancelled = e.status === 'cancelled';
                    const isTentative = e.status === 'tentative';
                    const title = e.isPrivate ? 'Busy' : (e.title || 'Reserved');
                    return `<div style="display:inline-flex;align-items:center;gap:6px;
                                 padding:4px 14px;border-radius:20px;
                                 background:${accent}22;border:1px solid ${accent}44;
                                 font-size:18px;color:${isCancelled ? textMuted : text};
                                 ${isCancelled ? 'text-decoration:line-through;opacity:0.55;' : ''}">
              <span>&#9656;</span>
              <span>${escapeHtml(title)}</span>
              ${isTentative ? `<span style="font-size:14px;background:#f59e0b;color:#fff;padding:1px 6px;border-radius:3px;">?</span>` : ''}
            </div>`;
                }).join('')}
        </div>`;
                const meetingsHtml = timedEvents.length === 0 && allDayEvents.length === 0
                    ? `<div style="display:flex;align-items:center;justify-content:center;height:100%;
                       color:${textMuted};font-size:36px;letter-spacing:2px;text-transform:uppercase;
                       text-align:center;padding:40px;">
             No meetings scheduled for today
           </div>`
                    : timedEvents.map((e) => {
                        const isCurrent = e === currentEv;
                        const isCancelled = e.status === 'cancelled';
                        const isTentative = e.status === 'tentative';
                        const title = e.isPrivate ? 'Busy' : (e.title || 'Reserved');
                        const organizer = e.organizerName || e.organizerEmail || '';
                        return `
              <div style="display:flex;gap:28px;padding:22px 36px;align-items:baseline;
                           border-bottom:1px solid ${border};
                           opacity:${isCancelled ? '0.45' : '1'};
                           ${isCurrent ? `background:${railColor}1a;` : ''}">
                <div style="font-variant-numeric:tabular-nums;font-size:28px;font-weight:600;
                             color:${text};white-space:nowrap;min-width:210px;">
                  ${escapeHtml(fmtRange(e))}
                </div>
                <div style="flex:1;min-width:0;">
                  <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
                    <span style="font-size:30px;font-weight:600;color:${text};line-height:1.25;
                                  ${isCancelled ? 'text-decoration:line-through;' : ''}">
                      ${escapeHtml(title)}
                    </span>
                    ${isTentative ? `<span style="background:#f59e0b;color:#fff;padding:3px 10px;
                                              border-radius:4px;font-size:15px;font-weight:700;
                                              letter-spacing:0.5px;">TENTATIVE</span>` : ''}
                    ${isCancelled ? `<span style="background:#6b7280;color:#fff;padding:3px 10px;
                                              border-radius:4px;font-size:15px;font-weight:700;
                                              letter-spacing:0.5px;">CANCELLED</span>` : ''}
                  </div>
                  <div style="display:flex;gap:18px;flex-wrap:wrap;margin-top:4px;">
                    ${organizer && !e.isPrivate ? `<span style="font-size:19px;color:${textMuted};">${escapeHtml(organizer)}</span>` : ''}
                    ${showLoc && e.location && !e.isPrivate ? `<span style="font-size:19px;color:${textMuted};">&#128205; ${escapeHtml(e.location)}</span>` : ''}
                    ${showAtt && typeof e.attendeeCount === 'number' ? `<span style="font-size:19px;color:${textMuted};">&#128101; ${e.attendeeCount}</span>` : ''}
                  </div>
                </div>
                ${isCurrent ? `
                  <div style="background:${railColor};color:#fff;padding:6px 14px;border-radius:4px;
                               font-size:16px;text-transform:uppercase;letter-spacing:1px;
                               align-self:center;flex-shrink:0;">Now</div>` : ''}
              </div>`;
                    }).join('');
                const tappable = !!bookingUrl;
                const buttons = [
                    { label: 'Book', enabled: !isBusy && tappable },
                    { label: 'Accept', enabled: !!currentEv && tappable },
                    { label: 'Prolong', enabled: !!currentEv && tappable },
                    { label: 'End meeting', enabled: !!currentEv && tappable },
                ];
                const buttonsHtml = buttons.map((b, i) => `
        <button data-mr-action="${i}" ${!b.enabled ? 'disabled' : ''}
                style="display:block;width:100%;text-align:left;padding:18px 22px;margin-bottom:12px;
                        background:${b.enabled ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.06)'};
                        color:${b.enabled ? '#fff' : 'rgba(255,255,255,0.35)'};
                        border:1px solid rgba(255,255,255,0.28);border-radius:8px;
                        font-size:20px;font-weight:600;letter-spacing:0.5px;text-transform:uppercase;
                        cursor:${b.enabled ? 'pointer' : 'not-allowed'};font-family:inherit;">
          ${escapeHtml(b.label)}
        </button>`).join('');
                const header = `
        <div style="display:flex;align-items:center;gap:18px;padding:18px 32px;
                     background:${isDark ? '#2a2e3e' : '#f1f3f5'};
                     border-bottom:3px solid ${railColor};flex-shrink:0;">
          ${logoUrl ? `<img src="${escapeHtml(logoUrl)}" alt=""
                            style="height:64px;max-width:180px;object-fit:contain;flex-shrink:0;" />` : ''}
          <div style="font-size:52px;font-weight:700;color:${text};letter-spacing:2px;
                       text-transform:uppercase;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
            ${escapeHtml(roomName)}
          </div>
          ${(roomMeta === null || roomMeta === void 0 ? void 0 : roomMeta.location) ? `
            <div style="font-size:22px;color:${textMuted};margin-left:16px;flex-shrink:0;">
              ${escapeHtml(roomMeta.location)}
            </div>` : ''}
        </div>`;
                // Smart countdown / status line
                const statusText = isBusy
                    ? (isAmberEnding ? 'ENDING SOON' : 'IN USE')
                    : (isAmberSoon ? 'STARTING SOON' : 'AVAILABLE');
                const statusLine = currentEv
                    ? (isAmberEnding
                        ? `Ends in ${escapeHtml(fmtCountdown(msToCurrentEnd))}`
                        : `Until ${escapeHtml(fmtClockTime(toLocal(currentEv.end)))}`)
                    : nextEv
                        ? (isAmberSoon
                            ? `Starts in ${escapeHtml(fmtCountdown(msToNextStart))}`
                            : `Free until ${escapeHtml(fmtClockTime(toLocal(nextEv.start)))}`)
                        : 'Free for the rest of the day';
                const rail = `
        <div style="background:${railColor};color:#fff;display:flex;flex-direction:column;
                     padding:28px 26px;${portrait ? 'flex-shrink:0;' : 'width:360px;flex-shrink:0;'}">
          <div id="cal-clock" style="font-size:64px;font-weight:700;letter-spacing:-1px;line-height:1;">
            ${clockStyle === 'none' ? '' : fmtClockTime(now)}
          </div>
          <div style="font-size:22px;opacity:0.9;margin-top:6px;">
            ${now.getFullYear()}.${pad2(now.getMonth() + 1)}.${pad2(now.getDate())}
          </div>
          <div style="font-size:28px;font-weight:700;margin-top:22px;letter-spacing:1px;">
            ${statusText}
          </div>
          <div style="font-size:18px;opacity:0.92;margin-top:6px;">${statusLine}</div>
          ${capacity ? `
            <div style="margin-top:24px;">
              <div style="font-size:15px;letter-spacing:2px;text-transform:uppercase;
                           opacity:0.85;margin-bottom:8px;">Room capacity</div>
              <div style="display:inline-block;background:rgba(255,255,255,0.18);
                           border:1px solid rgba(255,255,255,0.32);
                           padding:10px 20px;border-radius:6px;font-size:32px;font-weight:700;">
                ${capacity}
              </div>
            </div>` : ''}
          <div style="margin-top:auto;padding-top:24px;">
            ${buttonsHtml}
          </div>
        </div>`;
                const body = `
        <div style="flex:1;position:relative;overflow:hidden;
                     ${backgroundUrl ? `background-image:url(${JSON.stringify(backgroundUrl)});background-size:cover;background-position:center;` : ''}">
          ${backgroundUrl ? `<div style="position:absolute;inset:0;background:${isDark ? 'rgba(30,30,46,0.78)' : 'rgba(255,255,255,0.78)'};"></div>` : ''}
          <div style="position:relative;height:100%;overflow-y:auto;">
            ${allDayHtml}
            ${meetingsHtml}
          </div>
        </div>`;
                // Edge overlay: amber/red pulsing when in a meeting or starting soon, solid green when free
                const edgeColor = railColor;
                const edgeOverlay = (isBusy || isAmberSoon)
                    ? `<style>
            @keyframes mr-pulse {
              0%,100% { opacity:0.18; }
              50%      { opacity:0.72; }
            }
          </style>
          <div style="pointer-events:none;position:absolute;inset:0;z-index:999;
                       box-shadow:inset 0 0 0 12px ${edgeColor};
                       animation:mr-pulse 1.6s ease-in-out infinite;"></div>`
                    : `<div style="pointer-events:none;position:absolute;inset:0;z-index:999;
                        box-shadow:inset 0 0 0 12px ${edgeColor};"></div>`;
                container.innerHTML = `
        <div style="position:absolute;top:0;right:0;bottom:0;left:0;display:flex;flex-direction:column;
                     background:${bg};color:${text};
                     font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;overflow:hidden;">
          ${header}
          <div style="flex:1;display:flex;flex-direction:${portrait ? 'column' : 'row'};overflow:hidden;">
            ${body}
            ${rail}
          </div>
          ${edgeOverlay}
        </div>`;
                if (tappable) {
                    const btns = container.querySelectorAll('[data-mr-action]');
                    btns.forEach((btn) => {
                        btn.addEventListener('click', () => {
                            if (btn.disabled)
                                return;
                            try {
                                window.open(bookingUrl, '_blank', 'noopener');
                            }
                            catch ( /**/_a) { /**/ }
                        });
                    });
                }
                startClock();
            };
            // -- dispatch to view -------------------------------------------------------
            const renderEvents = (events) => {
                if (calContainer._calendarReqId !== reqId || !container.isConnected)
                    return;
                if (view === 'meeting_room') {
                    renderMeetingRoom(events);
                    return;
                }
                if (view === 'day') {
                    renderDayView(events);
                    return;
                }
                if (view === 'month') {
                    renderMonthView(events);
                    return;
                }
                // week / workweek
                renderWeekView(events, view === 'workweek' ? 5 : 7);
            };
            const renderError = (msg) => {
                container.innerHTML = `
        <div style="position:absolute;top:0;right:0;bottom:0;left:0;display:flex;flex-direction:column;
                     background:${bg};color:${text};
                     font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
          ${buildHeader('')}
          <div style="flex:1;display:flex;align-items:center;justify-content:center;opacity:0.6;">
            <p style="font-size:20px;">${escapeHtml(msg)}</p>
          </div>
        </div>`;
                startClock();
            };
            // -- fetch ------------------------------------------------------------------
            const cacheKey = `cal_events_${content.id}`;
            // Signature of the last successfully-rendered event set, used to skip
            // re-rendering when nothing has actually changed (avoids the visual flash
            // every refresh and preserves scroll position).
            let lastSig = '';
            let lastBoundaryRender = 0;
            let lastKnownEvents = [];
            const eventsSignature = (evs) => evs.map((e) => { var _a; return `${e.id}|${e.start}|${e.end}|${e.title}|${(_a = e.location) !== null && _a !== void 0 ? _a : ''}`; }).join('\n');
            // For meeting-room view we still must re-render when a meeting starts or
            // ends (busy/free rail + "Now" highlight change), even if the event list
            // is byte-identical.
            const boundaryCrossed = (evs, sinceMs) => {
                const nowMs = Date.now();
                for (const e of evs) {
                    const s = new Date(e.start).getTime();
                    const en = new Date(e.end).getTime();
                    if ((s > sinceMs && s <= nowMs) || (en > sinceMs && en <= nowMs))
                        return true;
                }
                return false;
            };
            const maybeRender = (evs) => {
                if (calContainer._calendarReqId !== reqId || !container.isConnected)
                    return;
                lastKnownEvents = evs;
                const sig = eventsSignature(evs);
                const needBoundary = view === 'meeting_room' && lastBoundaryRender > 0
                    && boundaryCrossed(evs, lastBoundaryRender);
                if (lastSig !== '' && sig === lastSig && !needBoundary)
                    return; // no-op
                lastSig = sig;
                lastBoundaryRender = Date.now();
                renderEvents(evs);
            };
            const fetchAndRender = () => __awaiter(this, void 0, void 0, function* () {
                if (calContainer._calendarReqId !== reqId)
                    return;
                const from = new Date();
                from.setHours(0, 0, 0, 0);
                const to = new Date(from);
                const days = view === 'day' || view === 'meeting_room' ? 1 : view === 'month' ? 31 : 7;
                to.setDate(to.getDate() + days);
                try {
                    const token = this.deviceToken || localStorage.getItem('deviceToken') || '';
                    const res = yield fetch(`${CONFIG.API_BASE}/devices/device/content/${encodeURIComponent(content.id)}/calendar/events`
                        + `?from=${encodeURIComponent(from.toISOString())}`
                        + `&to=${encodeURIComponent(to.toISOString())}`
                        + (token ? `&token=${encodeURIComponent(token)}` : ''));
                    if (!res.ok)
                        throw new Error(`HTTP ${res.status}`);
                    const body = yield res.json();
                    if (calContainer._calendarReqId !== reqId || !container.isConnected)
                        return;
                    try {
                        localStorage.setItem(cacheKey, JSON.stringify({ events: body.events || [], cachedAt: Date.now() }));
                    }
                    catch ( /**/_a) { /**/ }
                    maybeRender((body.events || []));
                }
                catch (err) {
                    logger.warn('Calendar fetch failed, using cached data:', err);
                    if (calContainer._calendarReqId !== reqId || !container.isConnected)
                        return;
                    // On a transient fetch error, do NOT wipe what's already on screen.
                    if (lastSig)
                        return;
                    try {
                        const cached = localStorage.getItem(cacheKey);
                        if (cached) {
                            const { events, cachedAt } = JSON.parse(cached);
                            maybeRender(events);
                            const badge = document.createElement('div');
                            badge.style.cssText = 'position:absolute;bottom:8px;right:12px;font-size:11px;opacity:0.4;pointer-events:none;z-index:100;';
                            badge.textContent = `Cached � ${Math.round((Date.now() - cachedAt) / 60000)}m ago`;
                            container.appendChild(badge);
                            return;
                        }
                    }
                    catch ( /**/_b) { /**/ }
                    renderError('No calendar data available');
                }
            });
            // -- WS push subscription ---------------------------------------------------
            // Server polls upstream once per content item and pushes diff'd updates.
            // The HTTP path above is kept as a fallback (first paint, WS offline).
            let lastPushReceivedAt = 0; // ms timestamp of last calendar_events push from server
            const pushHandler = (rawEvents) => {
                if (calContainer._calendarReqId !== reqId || !container.isConnected)
                    return;
                lastPushReceivedAt = Date.now();
                const evs = rawEvents || [];
                try {
                    localStorage.setItem(cacheKey, JSON.stringify({ events: evs, cachedAt: Date.now() }));
                }
                catch ( /**/_a) { /**/ }
                maybeRender(evs);
            };
            this._calendarPushHandlers.set(content.id, pushHandler);
            const trySubscribe = () => {
                const ws = this.wsConnection;
                if (ws && ws.readyState === WebSocket.OPEN) {
                    try {
                        ws.send(JSON.stringify({ type: 'calendar_subscribe', payload: { contentId: content.id } }));
                        return true;
                    }
                    catch (e) {
                        logger.warn('calendar_subscribe send failed', e);
                    }
                }
                return false;
            };
            let subscribed = trySubscribe();
            // If WS isn't open yet (page just mounted), retry briefly until it is.
            let subRetryTimer;
            if (!subscribed) {
                subRetryTimer = window.setInterval(() => {
                    if (calContainer._calendarReqId !== reqId) {
                        if (subRetryTimer)
                            clearInterval(subRetryTimer);
                        return;
                    }
                    if (trySubscribe()) {
                        subscribed = true;
                        if (subRetryTimer)
                            clearInterval(subRetryTimer);
                        subRetryTimer = undefined;
                    }
                }, 2000);
            }
            calContainer._calendarUnsub = () => {
                this._calendarPushHandlers.delete(content.id);
                if (subRetryTimer) {
                    clearInterval(subRetryTimer);
                    subRetryTimer = undefined;
                }
                const ws = this.wsConnection;
                if (ws && ws.readyState === WebSocket.OPEN) {
                    try {
                        ws.send(JSON.stringify({ type: 'calendar_unsubscribe', payload: { contentId: content.id } }));
                    }
                    catch ( /**/_a) { /**/ }
                }
            };
            // First-paint: prefer last-known events from localStorage so we render
            // the previous frame instantly instead of flashing a "Loading..." placeholder.
            // The fresh fetchAndRender() / WS push that follows will replace it the
            // moment new data arrives (and dedupe via maybeRender's signature check).
            let paintedFromCache = false;
            try {
                const cached = localStorage.getItem(cacheKey);
                if (cached) {
                    const { events } = JSON.parse(cached);
                    if (Array.isArray(events) && events.length >= 0) {
                        maybeRender(events);
                        paintedFromCache = true;
                    }
                }
            }
            catch ( /* ignore cache errors */_c) { /* ignore cache errors */ }
            if (!paintedFromCache) {
                container.innerHTML = `<div style="position:absolute;top:0;right:0;bottom:0;left:0;background:${bg};display:flex;
        align-items:center;justify-content:center;color:${textMuted};
        font-family:-apple-system,sans-serif;font-size:18px;">Loading�</div>`;
            }
            void fetchAndRender();
            // Polling fallback — fires when:
            //   a) WS socket is not open or subscribe message was never sent, OR
            //   b) WS is open and subscribe was sent, but no push has arrived in the
            //      last 2× refresh interval — meaning the server silently dropped the
            //      subscription (old API build, schema mismatch, etc.).
            calContainer._calendarTimer = window.setInterval(() => {
                const ws = this.wsConnection;
                const wsOpen = !!ws && ws.readyState === WebSocket.OPEN;
                const pushStale = lastPushReceivedAt > 0
                    ? Date.now() - lastPushReceivedAt > refreshSeconds * 2 * 1000
                    : Date.now() - calContainer['_mountedAt'] > refreshSeconds * 2 * 1000;
                const wsOk = wsOpen && subscribed && !pushStale;
                if (!wsOk)
                    void fetchAndRender();
            }, refreshSeconds * 1000);
            // Record mount time so the stale-push check has a reference before first push arrives
            calContainer['_mountedAt'] = Date.now();
            // Boundary timer — re-evaluates the current event list every 30 s so that
            // meeting start/end transitions (IN USE ↔ AVAILABLE, red ↔ green) update
            // the display even when the WS broker sees no data change and stays silent.
            // We do NOT clear lastSig — maybeRender's own boundaryCrossed check decides
            // whether a re-render is needed, so there is no flash when nothing changed.
            if (view === 'meeting_room') {
                const boundaryTimer = window.setInterval(() => {
                    if (calContainer._calendarReqId !== reqId) {
                        clearInterval(boundaryTimer);
                        return;
                    }
                    if (lastKnownEvents.length === 0 && lastSig === '')
                        return;
                    maybeRender(lastKnownEvents);
                }, 30000);
                const origUnsub2 = calContainer._calendarUnsub;
                calContainer._calendarUnsub = () => { origUnsub2(); clearInterval(boundaryTimer); };
            }
            // Midnight rollover — re-fetch even if WS data hasn't changed, so the day
            // window advances to the new date. Reschedules itself each time.
            const scheduleMidnight = () => {
                if (calContainer._calendarReqId !== reqId)
                    return;
                const now2 = new Date();
                const nextMidnight = new Date(now2);
                nextMidnight.setDate(nextMidnight.getDate() + 1);
                nextMidnight.setHours(0, 0, 5, 0); // 5 s past midnight
                const msUntil = nextMidnight.getTime() - now2.getTime();
                const t = window.setTimeout(() => {
                    if (calContainer._calendarReqId !== reqId)
                        return;
                    lastSig = ''; // force re-render even if event list is identical
                    void fetchAndRender();
                    scheduleMidnight();
                }, msUntil);
                // Store so teardown can clear it
                calContainer['_midnightTimer'] = t;
            };
            scheduleMidnight();
            // Patch teardown to also cancel midnight timer
            const origUnsub = calContainer._calendarUnsub;
            calContainer._calendarUnsub = () => {
                origUnsub();
                const mt = calContainer['_midnightTimer'];
                if (typeof mt === 'number')
                    window.clearTimeout(mt);
            };
        });
    },
    // Render HTML content
    renderHTML(container, content) {
        const url = content.url || content.webUrl || '';
        if (!url) {
            return;
        }
        const iframe = document.createElement('iframe');
        iframe.style.cssText = [
            'position:absolute',
            'top:0',
            'left:0',
            'width:100%',
            'height:100%',
            'border:none',
            'display:block',
            'pointer-events:auto',
            'background:transparent',
        ].join(';');
        iframe.setAttribute('allowfullscreen', 'true');
        iframe.setAttribute('scrolling', 'no');
        iframe.src = url;
        container.appendChild(iframe);
    },
    // Render Canvas content (prefer HTML runtime, fall back to thumbnail image)
    renderCanvas(container, content) {
        const resolvedUrl = this.resolveCanvasUrl(content);
        if (!resolvedUrl) {
            logger.warn('Canvas content missing playable URL, showing idle screen');
            this.showIdleScreen();
            return;
        }
        const extension = this.getFileExtension(resolvedUrl);
        const isDataImage = resolvedUrl.startsWith('data:image');
        const isHtml = this.isHtmlUrl(resolvedUrl);
        const isImage = isDataImage || this.isImageExtension(extension);
        const playableContent = Object.assign(Object.assign({}, content), { url: resolvedUrl });
        if (isHtml && !isDataImage) {
            this.renderHTML(container, playableContent);
            return;
        }
        this.renderImage(container, playableContent);
    },
    // Render DataSync live transport schedule
    renderDataSync(container, content) {
        if (typeof DataSyncRenderer === 'undefined') {
            logger.warn('DataSyncRenderer not loaded â€“ ensure js/modules/datasync-renderer.js is included');
            this.showIdleScreen();
            return;
        }
        const cmsUrl = (CONFIG.API_BASE || '').replace(/\/api\/v1\/?$/, '');
        DataSyncRenderer.render(String(content.id), cmsUrl, this.deviceId);
    },
    renderLiveLinkFace(container, content) {
        if (typeof window.LiveLinkFaceRenderer === 'undefined') {
            logger.warn('LiveLinkFaceRenderer not loaded — ensure js/modules/live-link-face-renderer.js is included');
            this.showIdleScreen();
            return;
        }
        // Ensure the Node sidecar (port 9616) is running — needed for UDP relay and WS
        this._startWallNodeRelay();
        window.LiveLinkFaceRenderer.start(container, content);
    },
    // Render PDF or Office document via PDF.js (single backend, works on Tizen 4/5/6.5+).
    // Office docs are expected to be pre-converted to PDF on the server side.
    renderDocument(container, content) {
        this.closeDocument();
        container.innerHTML = '';
        // Mark active immediately so the playlist loop does not spawn a second
        // concurrent renderDocument while the doc is still loading. Reset on error.
        this.documentActive = true;
        this.documentItemKey = this.getPlaylistItemKey(content);
        // Slide interval: read from metadata.pageInterval (seconds), default 10
        let slideIntervalSec = 10;
        try {
            const md = (content === null || content === void 0 ? void 0 : content.metadata) ? JSON.parse(content.metadata) : null;
            const pi = parseInt(md === null || md === void 0 ? void 0 : md.pageInterval, 10);
            if (!isNaN(pi) && pi > 0)
                slideIntervalSec = pi;
        }
        catch (_) { }
        this.b2bDocAutoFlipIntervalMs = slideIntervalSec * 1000;
        this._renderDocumentPdfJs(container, content);
    },
    // PDF.js renderer (single backend across Tizen 4/5/6.5+).
    // Office documents are expected to be pre-converted to PDF on the server.
    // Handles both:
    //   pdfjs v1.x (global: window.PDFJS, Tizen 4 — pdf-legacy.min.js)
    //   pdfjs v2.x (global: window.pdfjsLib, Tizen 5+ — pdf.min.js)
    _renderDocumentPdfJs(container, content) {
        var _a;
        this.documentBackend = 'pdfjs';
        const localUrl = content.url || ''; // file:///opt/usr/home/owner/apps_rw/.../uuid.pdf
        const fileName = localUrl.split('/').pop() || '';
        // v2.x exposes pdfjsLib; v1.x exposes PDFJS
        const pdfLib = window.pdfjsLib; // v2.x
        const pdfLibV1 = window.PDFJS; // v1.x
        const lib = pdfLib || pdfLibV1;
        const isV1 = !pdfLib && !!pdfLibV1;
        if (!lib) {
            logger.error('pdfjsLib not loaded — cannot render PDF:', content.name);
            container.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:center;height:100%;color:white;background:#333;flex-direction:column;">
          <div style="font-size:24px;">PDF Viewer Not Available</div>
          <div style="font-size:14px;margin-top:10px;opacity:0.7;">${content.name}</div>
        </div>`;
            return;
        }
        logger.info('PDF.js version:', isV1 ? 'v1 (PDFJS global)' : 'v2 (pdfjsLib global)');
        // Worker path and global config differ between v1 and v2
        if (isV1) {
            // v1.x: workerSrc is a top-level property on PDFJS
            lib.workerSrc = 'js/modules/pdf-legacy.worker.min.js';
        }
        else {
            // v2.x: workerSrc is nested under GlobalWorkerOptions
            lib.GlobalWorkerOptions.workerSrc = 'js/modules/pdf.worker.min.js';
        }
        // getViewport API differs between v1 and v2
        const getViewport = (page, scale) => isV1 ? page.getViewport(scale) : page.getViewport({ scale });
        // Black background while loading
        container.style.position = 'relative';
        container.style.background = '#000';
        let pdfDoc = null;
        let currentPage = 1;
        let activeCanvas = null;
        let nextCanvas = null; // pre-rendered next page
        let currentRenderTask = null;
        let advanceInProgress = false;
        // Render page num into an off-DOM canvas and return it (does NOT touch the DOM).
        const renderToOffscreen = (num) => __awaiter(this, void 0, void 0, function* () {
            if (currentRenderTask) {
                try {
                    currentRenderTask.cancel();
                }
                catch (_) { }
                currentRenderTask = null;
            }
            try {
                const page = yield pdfDoc.getPage(num);
                const cw = Math.max(container.offsetWidth || window.innerWidth || 1920, 1);
                const ch = Math.max(container.offsetHeight || window.innerHeight || 1080, 1);
                const nativeVp = getViewport(page, 1);
                const scale = Math.min(cw / nativeVp.width, ch / nativeVp.height);
                const viewport = getViewport(page, scale);
                const offscreen = document.createElement('canvas');
                offscreen.width = Math.max(Math.floor(viewport.width), 1);
                offscreen.height = Math.max(Math.floor(viewport.height), 1);
                const ctx = offscreen.getContext('2d');
                if (!ctx) {
                    logger.error('PDF canvas 2d context unavailable for page', num);
                    return null;
                }
                const left = Math.floor((cw - viewport.width) / 2);
                const top = Math.floor((ch - viewport.height) / 2);
                offscreen.style.cssText = `position:absolute;left:${left}px;top:${top}px;background:#000;`;
                currentRenderTask = page.render({ canvasContext: ctx, viewport });
                yield currentRenderTask.promise;
                currentRenderTask = null;
                logger.debug('PDF page', num, '/', pdfDoc.numPages, 'pre-rendered');
                return offscreen;
            }
            catch (e) {
                if ((e === null || e === void 0 ? void 0 : e.name) === 'RenderingCancelledException')
                    return null;
                logger.error('PDF page render error p' + num + ':', (e === null || e === void 0 ? void 0 : e.message) || e);
                return null;
            }
        });
        // Swap nextCanvas (already rendered) into the DOM, then start rendering the page after.
        const showPrerenderedAndAdvance = () => __awaiter(this, void 0, void 0, function* () {
            if (!container.isConnected || advanceInProgress)
                return;
            advanceInProgress = true;
            try {
                // Swap in the pre-rendered canvas immediately — no waiting, no black flash
                if (nextCanvas) {
                    if (activeCanvas && activeCanvas.parentNode === container) {
                        container.replaceChild(nextCanvas, activeCanvas);
                    }
                    else {
                        container.appendChild(nextCanvas);
                    }
                    activeCanvas = nextCanvas;
                    nextCanvas = null;
                    currentPage = (currentPage % pdfDoc.numPages) + 1;
                }
                // Pre-render the page after the one currently showing.
                const nextPage = (currentPage % pdfDoc.numPages) + 1;
                nextCanvas = yield renderToOffscreen(nextPage);
            }
            finally {
                advanceInProgress = false;
            }
        });
        // getDocument returns a task; .promise works on both pdfjs v1.10+ and v2.x
        const getDocPromise = (data) => lib.getDocument({ data }).promise;
        const onPdfLoaded = (pdf) => __awaiter(this, void 0, void 0, function* () {
            pdfDoc = pdf;
            // documentActive already set true at renderDocument start
            logger.info('PDF loaded:', content.name, pdf.numPages, 'pages');
            // Render and show page 1
            const first = yield renderToOffscreen(1);
            if (first) {
                container.appendChild(first);
                activeCanvas = first;
            }
            if (pdf.numPages > 1) {
                // Pre-render page 2 while page 1 is displayed
                nextCanvas = yield renderToOffscreen(2);
                currentPage = 1;
                this.documentPageInterval = setInterval(() => {
                    if (!container.isConnected) {
                        clearInterval(this.documentPageInterval);
                        return;
                    }
                    showPrerenderedAndAdvance();
                }, this.b2bDocAutoFlipIntervalMs);
            }
        });
        const showError = (reason) => {
            logger.error('PDF load failed:', content.name, reason);
            // Reset so the playlist loop can retry on the next tick
            this.documentActive = false;
            this.documentItemKey = null;
            this.documentBackend = null;
            container.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:center;height:100%;color:white;background:#222;flex-direction:column;">
          <div style="font-size:48px;margin-bottom:20px;">&#9888;</div>
          <div style="font-size:24px;">PDF Load Error</div>
          <div style="font-size:14px;margin-top:10px;opacity:0.6;">${content.name}</div>
          <div style="font-size:12px;margin-top:8px;opacity:0.4;">${reason}</div>
        </div>`;
        };
        // Fallback: load via XHR with raw file:// URL.
        // xhr.open() with invalid schemes throws synchronously, so wrap in try-catch.
        const loadViaXhr = (url) => {
            logger.info('PDF XHR load:', url);
            try {
                const xhr = new XMLHttpRequest();
                xhr.open('GET', url);
                xhr.responseType = 'arraybuffer';
                xhr.timeout = 20000;
                xhr.onload = () => {
                    if (xhr.response && xhr.response.byteLength > 0) {
                        logger.info('PDF XHR ok, bytes:', xhr.response.byteLength);
                        getDocPromise(new Uint8Array(xhr.response))
                            .then(onPdfLoaded).catch((e) => showError('parse: ' + ((e === null || e === void 0 ? void 0 : e.message) || e)));
                    }
                    else {
                        showError('XHR empty response');
                    }
                };
                xhr.onerror = () => showError('XHR error');
                xhr.ontimeout = () => showError('XHR timeout');
                xhr.send();
            }
            catch (e) {
                showError('XHR exception: ' + ((e === null || e === void 0 ? void 0 : e.message) || e));
            }
        };
        // Primary: tizen.filesystem API — reads from wgt-private/content/<uuid>.pdf as Uint8Array.
        // This is the correct Tizen-native way; virtual root paths like "wgt-private/content/file"
        // are NOT valid URL schemes and cannot be used with XHR.
        // Tizen 4 (legacy) has NO openFile() — must use resolve() + openStream() + readBytes().
        const platform = window.Platform;
        const tzFs = (_a = window.tizen) === null || _a === void 0 ? void 0 : _a.filesystem;
        const tzfsPath = fileName ? `wgt-private/content/${fileName}` : '';
        // Legacy (Tizen 4) byte-read via resolve+openStream
        const loadLegacy = () => {
            logger.info('PDF reading via legacy filesystem.resolve+openStream:', tzfsPath);
            try {
                tzFs.resolve(tzfsPath, (file) => {
                    try {
                        file.openStream('r', (stream) => {
                            try {
                                const fileSize = file.fileSize;
                                const raw = stream.readBytes(fileSize);
                                try {
                                    stream.close();
                                }
                                catch (_) { }
                                // readBytes returns a numeric array; PDF.js wants Uint8Array
                                const data = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
                                logger.info('PDF read ok (legacy), bytes:', data.byteLength);
                                getDocPromise(data)
                                    .then(onPdfLoaded).catch((e) => showError('parse: ' + ((e === null || e === void 0 ? void 0 : e.message) || e)));
                            }
                            catch (e) {
                                try {
                                    stream.close();
                                }
                                catch (_) { }
                                logger.warn('legacy readBytes failed:', (e === null || e === void 0 ? void 0 : e.message) || e, '— trying XHR fallback');
                                loadViaXhr(localUrl);
                            }
                        }, (err) => {
                            logger.warn('legacy openStream error:', (err === null || err === void 0 ? void 0 : err.message) || err, '— trying XHR fallback');
                            loadViaXhr(localUrl);
                        }, 'ISO-8859-1');
                    }
                    catch (e) {
                        logger.warn('legacy openStream exception:', (e === null || e === void 0 ? void 0 : e.message) || e, '— trying XHR fallback');
                        loadViaXhr(localUrl);
                    }
                }, (err) => {
                    logger.warn('legacy filesystem.resolve error:', (err === null || err === void 0 ? void 0 : err.message) || err, '— trying XHR fallback');
                    loadViaXhr(localUrl);
                }, 'r');
            }
            catch (e) {
                logger.warn('legacy filesystem.resolve exception:', (e === null || e === void 0 ? void 0 : e.message) || e, '— trying XHR fallback');
                loadViaXhr(localUrl);
            }
        };
        if ((platform === null || platform === void 0 ? void 0 : platform.isLegacy) && tzFs && typeof tzFs.resolve === 'function' && tzfsPath) {
            loadLegacy();
        }
        else if (tzFs && typeof tzFs.openFile === 'function' && tzfsPath) {
            logger.info('PDF reading via tizen.filesystem.openFile:', tzfsPath);
            try {
                const fileHandle = tzFs.openFile(tzfsPath, 'r');
                fileHandle.readDataNonBlocking((data) => {
                    try {
                        fileHandle.close();
                    }
                    catch (_) { }
                    logger.info('PDF read ok, bytes:', data.byteLength);
                    getDocPromise(data)
                        .then(onPdfLoaded).catch((e) => showError('parse: ' + ((e === null || e === void 0 ? void 0 : e.message) || e)));
                }, (err) => {
                    try {
                        fileHandle.close();
                    }
                    catch (_) { }
                    logger.warn('tizen.filesystem read error:', (err === null || err === void 0 ? void 0 : err.message) || err, '— trying XHR fallback');
                    loadViaXhr(localUrl);
                });
            }
            catch (e) {
                logger.warn('tizen.filesystem open error:', (e === null || e === void 0 ? void 0 : e.message) || e, '— trying XHR fallback');
                loadViaXhr(localUrl);
            }
        }
        else {
            loadViaXhr(localUrl);
        }
    },
    // Document control adapter � PDF.js is the only backend now.
    // Most navigation operations are not exposed because PDF.js is rendered via
    // a self-managed setInterval auto-flip; tizen_command document.* calls return
    // NotSupportedError so the portal can show a friendly message.
    _getDocControlAdapter() {
        const notSupported = (op) => (_ok, err) => {
            try {
                err === null || err === void 0 ? void 0 : err({ name: 'NotSupportedError', message: `${op} not supported on PDF.js backend` });
            }
            catch (_) { }
        };
        return {
            getVersion: () => null,
            open: notSupported('open'),
            close: notSupported('close'),
            play: notSupported('play'),
            stop: notSupported('stop'),
            pause: notSupported('pause'),
            resume: notSupported('resume'),
            nextPage: notSupported('nextPage'),
            prevPage: notSupported('prevPage'),
            gotoPage: notSupported('gotoPage'),
            setDocumentOrientation: notSupported('setDocumentOrientation'),
            zoomIn: notSupported('zoomIn'),
            zoomOut: notSupported('zoomOut'),
            setZoom: notSupported('setZoom'),
            fitToWidth: notSupported('fitToWidth'),
            fitToHeight: notSupported('fitToHeight'),
            resetView: notSupported('resetView'),
            getPageCount: notSupported('getPageCount'),
        };
    },
    // Close the currently open document (safe no-op if none open).
    closeDocument() {
        if (!this.documentActive && !this.documentBackend)
            return;
        if (this.documentPageInterval) {
            clearInterval(this.documentPageInterval);
            this.documentPageInterval = null;
        }
        this.documentActive = false;
        this.documentItemKey = null;
        this.documentBackend = null;
    },
    // Render playlist (simplified - real implementation would handle transitions)
    renderPlaylist(playlist) {
        if (!playlist || !playlist.items || playlist.items.length === 0) {
            this.showIdleScreen();
            return;
        }
        // Content types that don't use a static URL (they fetch/render data themselves)
        const urlNotRequired = new Set(['CALENDAR', 'DATASYNC', 'ZONE_LAYOUT', 'MENU_BOARD', 'LIVE_LINK_FACE']);
        // Filter out items without URLs, but keep types that don't need one
        const playableItems = playlist.items.filter(item => item.content.url || urlNotRequired.has(item.content.type));
        if (playableItems.length === 0) {
            logger.warn('Playlist has no playable items (all missing URLs)');
            this.showIdleScreen();
            return;
        }
        logger.info(`Playing playlist: ${playlist.playlistName} with ${playableItems.length} playable items (${playlist.items.length - playableItems.length} skipped)`);
        this.cancelCurrentPlayback();
        const container = document.getElementById('content-container');
        // SyncPlay mode: if the playlist belongs to a sync group, force HTML5
        // path (AVPlay's per-frame currentTime control is not exposed) and let
        // the SyncEngine gate item boundaries.
        // The schedule API delivers sync info under `playlist.syncPlay`
        // (see API._normalizeSyncPlaylist); accept either shape so the player
        // works with both legacy and Phase-4 servers.
        const syncPlayInfo = playlist.syncPlay || null;
        const syncGroupId = playlist.syncGroupId || (syncPlayInfo && syncPlayInfo.syncGroupId) || null;
        // Always log what we see so we can diagnose why _syncMode may be false.
        try {
            logger.info('[Sync] renderPlaylist diag: hasSyncPlay=' + !!syncPlayInfo +
                ' syncPlay.syncGroupId=' + (syncPlayInfo && syncPlayInfo.syncGroupId) +
                ' syncPlay.groupID=' + (syncPlayInfo && syncPlayInfo.groupID) +
                ' playlist.syncGroupId=' + playlist.syncGroupId +
                ' resolved=' + syncGroupId);
        }
        catch (_a) { }
        this._syncMode = !!syncGroupId;
        this._syncGroupId = syncGroupId;
        if (this._syncMode) {
            logger.info('[Sync] Playlist belongs to sync group ' + syncGroupId);
            // Prefer Samsung firmware-level SyncPlay (b2bapis.b2bsyncplay) when
            // available � it does frame-accurate alignment without JS-side leader
            // election, peer NTP, or HTTP messaging. Falls back to the JS engine
            // path below when the API is missing or the groupID is invalid.
            const nativeGroupId = (syncPlayInfo && Number.isInteger(syncPlayInfo.groupID)) ? syncPlayInfo.groupID : null;
            const nativeApi = this._getB2bSyncPlayApi();
            // Only use firmware b2bsyncplay when ALL peers are Samsung Tizen devices.
            // Cross-OS groups (Tizen + Android + Windows) must use the relay engine.
            const isAllTizen = (syncPlayInfo === null || syncPlayInfo === void 0 ? void 0 : syncPlayInfo.allTizen) !== false;
            if (nativeApi && nativeGroupId !== null && isAllTizen) {
                logger.info('[NativeSync] Using b2bapis.b2bsyncplay (groupID=' + nativeGroupId + ')');
                this.renderPlaylistNativeSync(playableItems, nativeGroupId, container);
                return;
            }
            if (!isAllTizen) {
                logger.info('[Sync] Cross-OS group detected (allTizen=false) — connecting to Node.js relay WS');
                // Connect (or reconnect) to the relay WS for this cross-OS sync group.
                // Use the manifest cached from SYNC_GROUP_INIT if available, otherwise
                // derive relayUrl from the peer IP list in syncPlayInfo.
                const manifest = this._lastSyncGroupManifest;
                const relayUrl = (manifest && manifest['relayUrl']) ||
                    (() => {
                        var _a, _b;
                        // Derive from the leader peer's IP (first in sorted leaderPriority list)
                        const peers = Array.isArray(syncPlayInfo && syncPlayInfo.peers) ? syncPlayInfo.peers : [];
                        if (!peers.length)
                            return null;
                        const sorted = [...peers].sort((a, b) => { var _a, _b; return ((_a = a.leaderPriority) !== null && _a !== void 0 ? _a : 0) - ((_b = b.leaderPriority) !== null && _b !== void 0 ? _b : 0); });
                        const leaderIp = ((_a = sorted[0]) === null || _a === void 0 ? void 0 : _a.ipAddress) || ((_b = sorted[0]) === null || _b === void 0 ? void 0 : _b.lastKnownIp) || null;
                        return leaderIp ? `ws://${leaderIp}:9616` : null;
                    })();
                if (relayUrl) {
                    this._startSyncGroupRelay(Object.assign(Object.assign({}, (manifest || {})), { relayUrl, syncGroupId: syncGroupId || (manifest && manifest['syncGroupId']), leaderPriority: (manifest && manifest['leaderPriority']) ||
                            (() => {
                                const peers = Array.isArray(syncPlayInfo && syncPlayInfo.peers) ? syncPlayInfo.peers : [];
                                return [...peers]
                                    .sort((a, b) => { var _a, _b; return ((_a = a.leaderPriority) !== null && _a !== void 0 ? _a : 0) - ((_b = b.leaderPriority) !== null && _b !== void 0 ? _b : 0); })
                                    .map((p) => p.deviceId);
                            })() }));
                }
                else {
                    logger.warn('[Sync] Cross-OS group: no relayUrl available, falling back to standard render');
                }
                this.renderPlaylistStandard(playableItems, container);
                return;
            }
            logger.info('[Sync] b2bsyncplay unavailable (api=' + !!nativeApi +
                ' groupID=' + nativeGroupId + ') — falling back to HTML5 + JS SyncEngine');
            // Tizen-only fallback: seed the JS SyncEngine.
            try {
                if (typeof SyncEngine !== 'undefined' && SyncEngine.setManifest) {
                    const peers = Array.isArray(syncPlayInfo && syncPlayInfo.peers) ? syncPlayInfo.peers : [];
                    const sortedPeers = [...peers].sort((a, b) => { var _a, _b; return ((_a = a.leaderPriority) !== null && _a !== void 0 ? _a : 0) - ((_b = b.leaderPriority) !== null && _b !== void 0 ? _b : 0); });
                    const manifest = {
                        groupId: syncGroupId,
                        version: 0,
                        leaderPriority: sortedPeers.map((p) => p.deviceId),
                        peers: sortedPeers.map((p) => ({
                            deviceId: p.deviceId,
                            lastKnownIp: p.ipAddress || p.lastKnownIp || null,
                            port: 9615,
                        })),
                        playlist: {
                            id: playlist.id || playlist.playlistId,
                            items: (playableItems || []).map((it, idx) => ({
                                id: it.id,
                                contentId: it.contentId,
                                duration: it.duration || 10,
                                position: idx,
                            })),
                        },
                    };
                    SyncEngine.setManifest(manifest);
                    logger.info('[Sync] Manifest seeded from schedule payload (peers=' +
                        manifest.peers.length + ', items=' + manifest.playlist.items.length + ')');
                }
            }
            catch (e) {
                logger.warn('[Sync] setManifest from schedule failed:', (e === null || e === void 0 ? void 0 : e.message) || e);
            }
            this.renderPlaylistStandard(playableItems, container);
            return;
        }
        // Check if this is an all-video(-like) playlist for seamless playback
        // (Some CMS flows may label video assets as PRESENTATION/OVERLAY but still render via AVPlay.)
        const videoLikeTypes = new Set(['VIDEO', 'PRESENTATION', 'OVERLAY']);
        const allVideos = playableItems.every(item => videoLikeTypes.has(item.content.type));
        const hasMultipleVideos = allVideos && playableItems.length > 1;
        // Try to use seamless AVPlay for all-video playlists
        if (hasMultipleVideos) {
            if (this.initSeamlessAVPlay()) {
                // Regular seamless playback
                logger.info('Using seamless AVPlay for video playlist');
                this.renderPlaylistSeamless(playableItems, container);
                return;
            }
        }
        // Fall back to standard playlist rendering
        this.renderPlaylistStandard(playableItems, container);
    },
    // Render playlist with seamless AVPlay (gapless video playback)
    // Uses two AVPlayStore players: while one plays, the other is prepared with the next item.
    renderPlaylistSeamless(playableItems, container) {
        var _a, _b;
        let currentIndex = 0;
        const controller = { cancelled: false };
        this.currentPlaylistController = controller;
        container.innerHTML = ''; // Clear container - AVPlay renders to hardware layer
        // Use cached panel resolution for AVPlay setDisplayRect — see renderVideoAVPlay comment.
        const viewportWidth = this._panelWidth;
        const viewportHeight = this._panelHeight;
        const wrapIndex = (index) => {
            const n = playableItems.length;
            return ((index % n) + n) % n;
        };
        const safeStopClose = (player) => {
            try {
                player.stop();
            }
            catch (_) { }
            try {
                player.close();
            }
            catch (_) { }
        };
        // Track readiness across the two avplaystore player objects.
        const prepared = typeof WeakMap !== 'undefined' ? new WeakMap() : null;
        const opened = typeof WeakMap !== 'undefined' ? new WeakMap() : null;
        const markPrepared = (player, value) => {
            try {
                prepared === null || prepared === void 0 ? void 0 : prepared.set(player, value);
            }
            catch (_) { }
        };
        const isPrepared = (player) => {
            try {
                return (prepared === null || prepared === void 0 ? void 0 : prepared.get(player)) === true;
            }
            catch (_) {
                return false;
            }
        };
        const markOpened = (player, value) => {
            try {
                opened === null || opened === void 0 ? void 0 : opened.set(player, value);
            }
            catch (_) { }
        };
        const isOpened = (player) => {
            try {
                return (opened === null || opened === void 0 ? void 0 : opened.get(player)) === true;
            }
            catch (_) {
                return false;
            }
        };
        const ensurePreparedThenPlay = (player, onStarted, onFailed) => {
            try {
                const state = typeof player.getState === 'function' ? player.getState() : undefined;
                logger.debug('[Seamless] Next player state before play:', state);
                if (isPrepared(player) || state === 'READY' || state === 'PAUSED' || state === 'PLAYING') {
                    player.play();
                    onStarted();
                    return;
                }
            }
            catch (_) {
                // ignore
            }
            let done = false;
            const timeoutId = setTimeout(() => {
                if (done)
                    return;
                done = true;
                onFailed('prepare timeout');
            }, 3000);
            try {
                player.prepareAsync(() => {
                    if (done)
                        return;
                    done = true;
                    clearTimeout(timeoutId);
                    markPrepared(player, true);
                    try {
                        player.play();
                        onStarted();
                    }
                    catch (err) {
                        onFailed(err);
                    }
                }, (err) => {
                    if (done)
                        return;
                    done = true;
                    clearTimeout(timeoutId);
                    onFailed(err);
                });
            }
            catch (err) {
                if (done)
                    return;
                done = true;
                clearTimeout(timeoutId);
                onFailed(err);
            }
        };
        const preparePlayer = (player, content, forPlayback, onStreamCompleted) => {
            try {
                safeStopClose(player);
            }
            catch (_) { }
            try {
                markPrepared(player, false);
                markOpened(player, false);
                player.open(content.url);
                player.setDisplayRect(0, 0, viewportWidth, viewportHeight);
                player.setListener({
                    onbufferingstart: () => logger.debug('[Seamless] Buffering started'),
                    onbufferingprogress: (percent) => logger.debug('[Seamless] Buffering:', percent + '%'),
                    onbufferingcomplete: () => logger.debug('[Seamless] Buffering complete'),
                    onstreamcompleted: () => {
                        if (typeof onStreamCompleted === 'function') {
                            onStreamCompleted();
                        }
                    },
                    onerror: (eventType) => {
                        logger.error('[Seamless] AVPlay error:', eventType);
                        // Hard fallback to standard playlist.
                        if (!controller.cancelled) {
                            controller.cancelled = true;
                            try {
                                this.stopSeamlessAVPlay();
                            }
                            catch (_) { }
                            this.renderPlaylistStandard(playableItems, container);
                        }
                    },
                    onevent: (eventType, eventData) => logger.debug('[Seamless] Event:', eventType, eventData)
                });
                const isLocalFile = typeof (content === null || content === void 0 ? void 0 : content.url) === 'string' && content.url.startsWith('file:///');
                // On many firmwares, background prepareAsync for file:// content is unreliable.
                // For local files, open now and defer prepareAsync until switch-time.
                if (!forPlayback && isLocalFile) {
                    markOpened(player, true);
                    logger.debug('[Seamless] Next video opened (file); will prepare at switch');
                    return;
                }
                player.prepareAsync(() => {
                    if (controller.cancelled) {
                        return;
                    }
                    markPrepared(player, true);
                    markOpened(player, true);
                    if (forPlayback) {
                        try {
                            document.body.classList.add('avplay-active');
                        }
                        catch (_) { }
                        try {
                            player.setVideoStillMode('false');
                        }
                        catch (_) { }
                        try {
                            player.play();
                            logger.info('[Seamless] Playback started');
                        }
                        catch (err) {
                            logger.error('[Seamless] Play failed:', err);
                            if (!controller.cancelled) {
                                controller.cancelled = true;
                                try {
                                    this.stopSeamlessAVPlay();
                                }
                                catch (_) { }
                                this.renderPlaylistStandard(playableItems, container);
                            }
                        }
                    }
                    else {
                        logger.debug('[Seamless] Next video prepared');
                    }
                }, (error) => {
                    logger.error('[Seamless] Prepare failed:', error);
                    if (!controller.cancelled) {
                        controller.cancelled = true;
                        try {
                            this.stopSeamlessAVPlay();
                        }
                        catch (_) { }
                        this.renderPlaylistStandard(playableItems, container);
                    }
                });
            }
            catch (error) {
                logger.error('[Seamless] Failed to open/prepare:', error);
                if (!controller.cancelled) {
                    controller.cancelled = true;
                    try {
                        this.stopSeamlessAVPlay();
                    }
                    catch (_) { }
                    this.renderPlaylistStandard(playableItems, container);
                }
            }
        };
        const handleCompletedAndSwitch = () => {
            var _a, _b, _c;
            if (controller.cancelled) {
                return;
            }
            // If a pending playlist is ready, swap immediately.
            if (this.pendingPlaylist) {
                logger.info('Pending playlist ready; switching from seamless playlist');
                controller.cancelled = true;
                try {
                    this.stopSeamlessAVPlay();
                }
                catch (_) { }
                this.trySwapToPendingContent(true);
                return;
            }
            const playersBefore = this.getSeamlessPlayers();
            const current = playersBefore.current;
            const next = playersBefore.next;
            logger.info('[Seamless] Stream completed; switching players');
            // Freeze last frame and stop current.
            try {
                (_a = current === null || current === void 0 ? void 0 : current.setVideoStillMode) === null || _a === void 0 ? void 0 : _a.call(current, 'true');
            }
            catch (_) { }
            try {
                (_b = current === null || current === void 0 ? void 0 : current.stop) === null || _b === void 0 ? void 0 : _b.call(current);
            }
            catch (_) { }
            const nextIndex = wrapIndex(currentIndex + 1);
            const upcomingIndex = wrapIndex(nextIndex + 1);
            try {
                (_c = next === null || next === void 0 ? void 0 : next.setVideoStillMode) === null || _c === void 0 ? void 0 : _c.call(next, 'false');
            }
            catch (_) { }
            // Some firmwares won't let the "next" player reach READY until the current is stopped.
            // Ensure it's prepared (or prepare now) before calling play.
            ensurePreparedThenPlay(next, () => {
                var _a;
                // Switch logical current only after next actually starts.
                currentIndex = nextIndex;
                try {
                    this.switchSeamlessPlayer();
                }
                catch (_) { }
                logger.info(`[Seamless] Now playing ${currentIndex + 1}/${playableItems.length}`);
                const playersAfter = this.getSeamlessPlayers();
                const idle = playersAfter.next;
                const upcoming = (_a = playableItems[upcomingIndex]) === null || _a === void 0 ? void 0 : _a.content;
                if (upcoming && idle) {
                    logger.debug(`[Seamless] Preparing upcoming ${upcomingIndex + 1}/${playableItems.length}: ${upcoming.name}`);
                    preparePlayer(idle, upcoming, false, handleCompletedAndSwitch);
                }
            }, (reason) => {
                logger.error('[Seamless] Failed to start next player:', reason);
                controller.cancelled = true;
                try {
                    this.stopSeamlessAVPlay();
                }
                catch (_) { }
                // Fallback: continue from the next item (donâ€™t restart at item 1).
                this.renderPlaylistStandard(playableItems, container, nextIndex);
            });
        };
        // Initial start: play index 0 on current, prepare index 1 on next.
        const firstIndex = 0;
        const secondIndex = wrapIndex(1);
        const { current, next } = this.getSeamlessPlayers();
        const first = (_a = playableItems[firstIndex]) === null || _a === void 0 ? void 0 : _a.content;
        const second = (_b = playableItems[secondIndex]) === null || _b === void 0 ? void 0 : _b.content;
        logger.info(`[Seamless] Starting seamless playlist (${playableItems.length} items)`);
        if (first && current) {
            preparePlayer(current, first, true, handleCompletedAndSwitch);
        }
        if (second && next) {
            // Small delay reduces resource contention during initial startup.
            setTimeout(() => {
                if (controller.cancelled)
                    return;
                logger.debug(`[Seamless] Prebuffering next ${secondIndex + 1}/${playableItems.length}: ${second.name}`);
                preparePlayer(next, second, false, handleCompletedAndSwitch);
            }, 250);
        }
    },
    // Standard playlist rendering (mixed content or fallback)
    renderPlaylistStandard(playableItems, container, startIndex = 0) {
        let currentIndex = startIndex;
        const isSingleItem = playableItems.length === 1;
        const controller = { cancelled: false };
        this.currentPlaylistController = controller;
        const scheduleNext = (delayMs) => {
            if (isSingleItem) {
                // For single-item playlists, check for pending content before looping
                if (this.playlistTimeout) {
                    clearTimeout(this.playlistTimeout);
                }
                this.playlistTimeout = setTimeout(() => {
                    if (controller.cancelled) {
                        return;
                    }
                    // Check if pending playlist is ready
                    if (this.pendingPlaylist) {
                        logger.info('Pending playlist ready; switching from looping single item');
                        this.trySwapToPendingContent(true);
                        return;
                    }
                    // Continue looping same item
                    playNext();
                }, delayMs);
                return;
            }
            if (this.playlistTimeout) {
                clearTimeout(this.playlistTimeout);
            }
            this.playlistTimeout = setTimeout(() => {
                if (controller.cancelled) {
                    return;
                }
                currentIndex++;
                playNext();
            }, delayMs);
        };
        const playNext = () => {
            var _a, _b;
            if (controller.cancelled) {
                return;
            }
            if (currentIndex >= playableItems.length) {
                currentIndex = 0; // Loop back to start
            }
            // If a pending playlist is ready, swap before playing next item
            if (this.pendingPlaylist) {
                logger.info('Pending playlist ready; switching before next item');
                this.trySwapToPendingContent(true);
                return;
            }
            const item = playableItems[currentIndex];
            const content = item.content;
            const duration = item.duration || 10; // Default 10 seconds
            // Stop zone mode if we are transitioning away from a zone layout item
            if (this._zoneMode && content.type !== 'ZONE_LAYOUT') {
                this.stopZoneMode();
            }
            logger.info(`Playing item ${currentIndex + 1}/${playableItems.length}: ${content.name} (${content.type}) - URL: ${content.url}`);
            // SyncPlay: clear any previous video reference before rendering the new
            // item, and remember the active item index so heartbeats & ADJUSTs can
            // be matched up.
            if (this._syncMode) {
                this._activeSyncVideo = null;
                this._syncCurrentItemIndex = currentIndex;
            }
            const itemKey = this.getPlaylistItemKey(content);
            const isDocumentContent = content.type === 'PDF' || content.type === 'OFFICE';
            const canReuseImage = content.type === 'IMAGE' &&
                this.lastRenderedItemKey === itemKey &&
                container.children.length > 0;
            const canReuseDocument = isDocumentContent &&
                this.documentActive &&
                this.documentItemKey === itemKey;
            // Calendar items keep an internal poll/WS-push lifecycle on the
            // container; tearing the DOM every playlist cycle would force a fresh
            // "Loading..." flash and re-subscribe. Reuse the existing mount when
            // the same calendar item loops.
            const canReuseCalendar = content.type === 'CALENDAR' &&
                this.lastRenderedItemKey === itemKey &&
                container._calendarReqId !== undefined;
            if (!canReuseDocument && this.documentActive) {
                this.closeDocument();
            }
            if (!canReuseImage && !canReuseDocument && !canReuseCalendar) {
                container.innerHTML = '';
            }
            container._menuBoardRequestId = undefined;
            // Render based on content type
            switch (content.type) {
                case 'IMAGE':
                    if (!canReuseImage) {
                        this.renderImage(container, content);
                        this.lastRenderedItemKey = itemKey;
                    }
                    else {
                        logger.debug('Skipping image re-render, identical item already displayed');
                    }
                    // Schedule next item
                    scheduleNext(duration * 1000);
                    break;
                case 'VIDEO':
                    if (!isSingleItem) {
                        // Store the callback for AVPlay
                        this.currentVideoEndedCallback = () => {
                            if (controller.cancelled) {
                                return;
                            }
                            logger.info('Video ended, playing next item');
                            currentIndex++;
                            playNext();
                        };
                    }
                    else {
                        // For single-item playlists, check for pending content on loop
                        this.currentVideoEndedCallback = () => {
                            if (controller.cancelled) {
                                return;
                            }
                            // Check if pending playlist is ready
                            if (this.pendingPlaylist) {
                                logger.info('Pending playlist ready; switching from looping video');
                                // Keep last frame visible while swapping.
                                try {
                                    if (typeof webapis !== 'undefined' && webapis.avplay && typeof webapis.avplay.setVideoStillMode === 'function') {
                                        webapis.avplay.setVideoStillMode('true');
                                    }
                                }
                                catch (_) {
                                    // ignore
                                }
                                this.trySwapToPendingContent(true);
                                return true;
                            }
                            logger.debug('Video loop iteration, no pending content');
                            // Prefer seamless loop for AVPlay by seeking back to 0 without stop/close.
                            // This avoids the black gap caused by tearing down and re-preparing.
                            try {
                                if (typeof webapis !== 'undefined' && webapis.avplay) {
                                    const av = webapis.avplay;
                                    const stateBefore = typeof av.getState === 'function' ? av.getState() : undefined;
                                    const timeBefore = typeof av.getCurrentTime === 'function' ? av.getCurrentTime() : undefined;
                                    logger.debug('AVPlay loop: state/time before restart:', stateBefore, timeBefore);
                                    const fallbackToRerender = (reason) => {
                                        logger.warn('AVPlay loop: falling back to re-render:', reason);
                                        try {
                                            document.body.classList.remove('avplay-active');
                                        }
                                        catch (_) {
                                            // ignore
                                        }
                                        setTimeout(() => {
                                            if (controller.cancelled) {
                                                return;
                                            }
                                            playNext();
                                        }, 0);
                                    };
                                    const startPlaybackAfterSeek = () => {
                                        try {
                                            if (typeof av.setVideoStillMode === 'function') {
                                                av.setVideoStillMode('false');
                                            }
                                        }
                                        catch (_) {
                                            // ignore
                                        }
                                        try {
                                            logger.debug('AVPlay loop: calling play() after seek');
                                            av.play();
                                        }
                                        catch (playErr) {
                                            fallbackToRerender((playErr === null || playErr === void 0 ? void 0 : playErr.message) || playErr);
                                            return;
                                        }
                                        // Watchdog: if playback doesn't actually resume, fallback.
                                        setTimeout(() => {
                                            try {
                                                const stateAfter = typeof av.getState === 'function' ? av.getState() : undefined;
                                                const timeAfter = typeof av.getCurrentTime === 'function' ? av.getCurrentTime() : undefined;
                                                logger.debug('AVPlay loop watchdog - state/time:', stateAfter, timeAfter);
                                                if (stateAfter && stateAfter !== 'PLAYING') {
                                                    fallbackToRerender(`watchdog state=${stateAfter}`);
                                                }
                                            }
                                            catch (watchErr) {
                                                logger.debug('AVPlay loop watchdog failed:', (watchErr === null || watchErr === void 0 ? void 0 : watchErr.message) || watchErr);
                                            }
                                        }, 800);
                                    };
                                    // Hold last frame to mask the restart.
                                    try {
                                        if (typeof av.setVideoStillMode === 'function') {
                                            av.setVideoStillMode('true');
                                        }
                                    }
                                    catch (_) {
                                        // ignore
                                    }
                                    // Some firmwares behave better if we pause before seeking.
                                    try {
                                        if (typeof av.pause === 'function') {
                                            av.pause();
                                        }
                                    }
                                    catch (_) {
                                        // ignore
                                    }
                                    let seekStarted = false;
                                    if (typeof av.seekTo === 'function') {
                                        try {
                                            // Prefer callback form when supported.
                                            av.seekTo(0, () => {
                                                logger.debug('AVPlay loop: seekTo(0) success callback');
                                                startPlaybackAfterSeek();
                                            }, (seekErr) => {
                                                fallbackToRerender((seekErr === null || seekErr === void 0 ? void 0 : seekErr.message) || seekErr);
                                            });
                                            seekStarted = true;
                                        }
                                        catch (seekErr) {
                                            logger.debug('AVPlay loop: seekTo callback form not supported:', (seekErr === null || seekErr === void 0 ? void 0 : seekErr.message) || seekErr);
                                            try {
                                                av.seekTo(0);
                                                seekStarted = true;
                                                setTimeout(startPlaybackAfterSeek, 60);
                                            }
                                            catch (seekErr2) {
                                                logger.debug('AVPlay loop: seekTo(0) failed:', (seekErr2 === null || seekErr2 === void 0 ? void 0 : seekErr2.message) || seekErr2);
                                            }
                                        }
                                    }
                                    if (!seekStarted && typeof av.jumpBackward === 'function') {
                                        try {
                                            // Best-effort fallback for older firmwares.
                                            av.jumpBackward(24 * 60 * 60 * 1000);
                                            seekStarted = true;
                                            setTimeout(startPlaybackAfterSeek, 60);
                                        }
                                        catch (jumpErr) {
                                            logger.debug('AVPlay loop: jumpBackward failed:', (jumpErr === null || jumpErr === void 0 ? void 0 : jumpErr.message) || jumpErr);
                                        }
                                    }
                                    if (seekStarted) {
                                        return true;
                                    }
                                }
                            }
                            catch (err) {
                                logger.debug('Seamless AVPlay loop failed; falling back to re-open:', (err === null || err === void 0 ? void 0 : err.message) || err);
                            }
                            // Fallback: re-render via existing playlist logic (may show a gap).
                            setTimeout(() => {
                                if (controller.cancelled) {
                                    return;
                                }
                                playNext();
                            }, 0);
                            return false;
                        };
                    }
                    const videoContent = Object.assign(Object.assign({}, content), { loop: isSingleItem ? true : content.loop });
                    this.renderVideo(container, videoContent);
                    if (!isSingleItem) {
                        // For HTML5 video fallback, also set onended
                        setTimeout(() => {
                            if (controller.cancelled) {
                                return;
                            }
                            const video = container.querySelector('video');
                            if (video) {
                                video.onended = this.currentVideoEndedCallback;
                            }
                        }, 100);
                    }
                    else {
                        // For single-item looping, set onended to check for pending content
                        setTimeout(() => {
                            if (controller.cancelled) {
                                return;
                            }
                            const video = container.querySelector('video');
                            if (video) {
                                video.onended = this.currentVideoEndedCallback;
                            }
                        }, 100);
                    }
                    break;
                case 'HTML':
                case 'HTML5':
                case 'WEBPAGE':
                    this.renderHTML(container, content);
                    // Schedule next item
                    scheduleNext(duration * 1000);
                    break;
                case 'MENU_BOARD':
                    this.renderMenuBoard(container, content);
                    scheduleNext(duration * 1000);
                    break;
                case 'CANVAS':
                    this.renderCanvas(container, content);
                    scheduleNext(duration * 1000);
                    break;
                case 'DATASYNC':
                    this.renderDataSync(container, content);
                    scheduleNext(duration * 1000);
                    break;
                case 'PDF':
                case 'OFFICE': {
                    // Keep the active document mounted while the same playlist item loops.
                    if (!canReuseDocument) {
                        this.renderDocument(container, content);
                        this.lastRenderedItemKey = itemKey;
                    }
                    else {
                        logger.debug('Skipping document re-render, same item already playing');
                    }
                    scheduleNext(duration * 1000);
                    break;
                }
                case 'ZONE_LAYOUT': {
                    // Zone layout content item: activate multi-zone mode for item duration
                    let zoneItems = [];
                    try {
                        zoneItems = (_b = JSON.parse((_a = content.metadata) !== null && _a !== void 0 ? _a : '{}').zones) !== null && _b !== void 0 ? _b : [];
                    }
                    catch (_) { }
                    if (zoneItems.length > 0) {
                        this.activateZoneMode(zoneItems);
                        // After item duration expires, stop zone mode and advance
                        scheduleNext(duration * 1000);
                    }
                    else {
                        logger.warn('ZONE_LAYOUT playlist item: no zones in metadata, skipping');
                        scheduleNext(1000);
                    }
                    break;
                }
                case 'CALENDAR': {
                    if (!canReuseCalendar) {
                        void this.renderCalendar(container, content);
                        this.lastRenderedItemKey = itemKey;
                    }
                    else {
                        logger.debug('Skipping calendar re-render, same item already mounted');
                    }
                    scheduleNext(duration * 1000);
                    break;
                }
                case 'LIVE_LINK_FACE': {
                    this.renderLiveLinkFace(container, content);
                    this.lastRenderedItemKey = itemKey;
                    scheduleNext(duration * 1000);
                    break;
                }
                default:
                    logger.warn('Unknown content type:', content.type);
                    // Skip to next item
                    scheduleNext(1000);
            }
        };
        playNext();
    },
    cancelCurrentPlayback() {
        if (this.currentPlaylistController) {
            this.currentPlaylistController.cancelled = true;
            this.currentPlaylistController = null;
        }
        // Stop Live Link Face renderer (closes UDP socket + WS connection)
        if (typeof window.LiveLinkFaceRenderer !== 'undefined') {
            try {
                window.LiveLinkFaceRenderer.stop();
            }
            catch (_) { }
        }
        // Tear down any firmware SyncPlay session � idempotent / no-op if not
        // active. Must come before AVPlay close so the video plane is released.
        if (this._nativeSyncActive) {
            this.stopNativeSyncPlay();
        }
        // Stop cross-OS sync group relay if active.
        if (this._syncGroupRelayStop) {
            try {
                this._syncGroupRelayStop();
            }
            catch (_a) { }
            this._syncGroupRelayStop = null;
        }
        // Drop any sync-mode references; the next renderPlaylist re-establishes them.
        this._activeSyncVideo = null;
        this._syncCurrentItemIndex = -1;
        if (this._syncRateRestoreTimer) {
            clearTimeout(this._syncRateRestoreTimer);
            this._syncRateRestoreTimer = null;
        }
        // Stop seamless AVPlay if active
        if (this.seamlessPlaylistActive) {
            this.stopSeamlessAVPlay();
        }
        if (this.playlistTimeout) {
            clearTimeout(this.playlistTimeout);
            this.playlistTimeout = null;
        }
        this.currentVideoEndedCallback = null;
        this.lastRenderedItemKey = null;
        // NOTE: do NOT call closeDocument() here — it resets documentActive and kills
        // the PDF page interval on every loop tick. closeDocument() is called inside
        // renderDocument() when a new document starts, and the canvas isConnected guard
        // cleans up if the container is replaced by non-PDF content.
        // Stop AVPlay if currently running (standard single instance)
        try {
            if (typeof webapis !== 'undefined' && webapis.avplay) {
                webapis.avplay.stop();
                webapis.avplay.close();
            }
        }
        catch (error) {
            logger.debug('AVPlay stop during cancel failed:', (error === null || error === void 0 ? void 0 : error.message) || error);
        }
        const container = document.getElementById('content-container');
        if (container) {
            const video = container.querySelector('video');
            if (video) {
                try {
                    video.pause();
                }
                catch (_) { }
                try {
                    video.removeAttribute('src');
                }
                catch (_) { }
                if (typeof video.load === 'function') {
                    try {
                        video.load();
                    }
                    catch (_) { }
                }
            }
        }
    },
    // Stop any current playback (AVPlay or HTML5) and reset pointers
    stop() {
        logger.info('Stopping current playback');
        this.cancelCurrentPlayback();
        this.closeDocument();
        this.currentItem = null;
        this.currentPlaylist = null;
        this.currentIndex = 0;
    },
    getPlaylistItemKey(content) {
        if (!content)
            return null;
        const contentId = content.id || content.contentId || content.url || '';
        const version = content.updatedAt ||
            content.updated_at ||
            content.version ||
            content.hash ||
            '';
        return `${contentId}:${version}`;
    },
    // Show idle screen when no content
    showIdleScreen(downloadProgress = null) {
        this.cancelCurrentPlayback();
        // Ensure AVPlay visual state is fully reset so the content-container is visible.
        this.setAvPlayVisualMode(false);
        const container = document.getElementById('content-container');
        let statusText = 'Waiting for content...';
        let progressBar = '';
        if (downloadProgress !== null && downloadProgress >= 0 && downloadProgress < 100) {
            statusText = `Downloading content... ${downloadProgress}%`;
            progressBar = `
        <div class="download-progress-container" style="width: 200px; height: 8px; background: rgba(255,255,255,0.2); border-radius: 4px; margin: 20px auto; overflow: hidden;">
          <div class="download-progress-bar" style="width: ${downloadProgress}%; height: 100%; background: linear-gradient(90deg, #3b82f6, #06b6d4); transition: width 0.3s ease;"></div>
        </div>
      `;
        }
        container._menuBoardRequestId = undefined;
        const deviceLabel = (this.deviceName || '').trim();
        const brandHtml = this.resellerBrandingLogoUrl
            ? `<img src="${this.resellerBrandingLogoUrl}" alt="Logo" style="max-height:56px;max-width:240px;object-fit:contain;" onerror="this.style.display='none'">`
            : `<svg class="idle-logo" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <defs>
                <linearGradient id="nexariGrad" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
                  <stop offset="0%" stop-color="#3a7bff"/>
                  <stop offset="100%" stop-color="#4ff2d1"/>
                </linearGradient>
              </defs>
              <rect x="4" y="4" width="56" height="56" rx="14" stroke="url(#nexariGrad)" stroke-width="2.5"/>
              <path d="M20 44 V20 L44 44 V20" stroke="url(#nexariGrad)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <div class="idle-wordmark">NEXARI</div>`;
        container.innerHTML = `
      <div class="idle-screen">
        <div class="idle-bg-grid"></div>
        <div class="idle-card">
          <div class="idle-brand">
            ${brandHtml}
          </div>
          ${deviceLabel ? `<div class="idle-device">${deviceLabel}</div>` : ''}
          <div class="idle-divider"></div>
          <div class="idle-status-row">
            <span class="idle-status-dot"></span>
            <span class="idle-status">${statusText}</span>
          </div>
          ${progressBar}
        </div>
        <div class="idle-footer">Signage Player &middot; Standby</div>
      </div>
    `;
    },
    getContentSignature(content) {
        if (!content) {
            return null;
        }
        const playlistId = content.playlistId || content.id || '';
        const playlistUpdatedAt = content.updatedAt || content.updated_at || '';
        const itemSignature = (content.items || []).map(item => {
            var _a, _b, _c, _d;
            const itemId = item.id || item.contentId || '';
            const itemUpdatedAt = item.updatedAt || item.updated_at || '';
            const contentId = ((_a = item.content) === null || _a === void 0 ? void 0 : _a.id) || '';
            const contentUpdatedAt = ((_b = item.content) === null || _b === void 0 ? void 0 : _b.updatedAt) || ((_c = item.content) === null || _c === void 0 ? void 0 : _c.updated_at) || '';
            const contentVersion = ((_d = item.content) === null || _d === void 0 ? void 0 : _d.version) || '';
            return `${itemId}:${itemUpdatedAt}:${contentId}:${contentUpdatedAt}:${contentVersion}`;
        });
        return JSON.stringify({
            playlistId,
            playlistUpdatedAt,
            items: itemSignature
        });
    },
    // Execute command
    executeCommand(command) {
        var _a, _b, _c, _d, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s;
        logger.info('Executing command:', command);
        const type = typeof command === 'string' ? command : command.type;
        const payload = typeof command === 'string' ? null : (command.payload || command.options || null);
        switch (type) {
            case 'RELOAD':
                location.reload();
                break;
            case 'REBOOT':
                // Prefer full TV reboot; fallback to app reload if not supported
                if (!this.invokeTVControl('rebootTv')) {
                    location.reload();
                }
                break;
            case 'RELAUNCH_APP': {
                // Schedule re-launch via Tizen Alarm, then exit so Tizen restarts us
                try {
                    const app = tizen.application.getCurrentApplication();
                    const alarm = new tizen.AlarmRelative(3);
                    tizen.alarm.add(alarm, app.appInfo.id);
                    logger.info('RELAUNCH_APP: alarm set, exiting');
                    app.exit();
                }
                catch (e) {
                    logger.warn('RELAUNCH_APP alarm failed, falling back to reload:', e);
                    location.reload();
                }
                break;
            }
            case 'POWER_OFF':
                this.invokeTVControl('powerOff', Object.assign({}, (payload || {})));
                break;
            case 'REQUEST_LOG_BURST': {
                const max = (_a = payload === null || payload === void 0 ? void 0 : payload.max) !== null && _a !== void 0 ? _a : 200;
                try {
                    const batch = (window.LogBuffer && window.LogBuffer.drain(max)) || [];
                    if (batch.length && this.deviceId) {
                        logger.info('Uploading log burst:', batch.length);
                        const ws = this.wsConnection;
                        if (ws && ws.readyState === WebSocket.OPEN) {
                            // Group by real level; line text is "timestamp message" only—
                            // buildLogText on the dashboard already prepends [LEVEL].
                            const byLevel = { debug: [], info: [], warn: [], error: [] };
                            for (const e of batch) {
                                const lvl = (e.level && byLevel[e.level]) ? e.level : 'info';
                                const ts = (_b = e.timestamp) !== null && _b !== void 0 ? _b : new Date().toISOString();
                                const msg = Array.isArray(e.message)
                                    ? e.message.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')
                                    : String((_c = e.message) !== null && _c !== void 0 ? _c : '');
                                byLevel[lvl].push(`${ts} ${msg}`);
                            }
                            for (const [level, lines] of Object.entries(byLevel)) {
                                if (!lines.length)
                                    continue;
                                for (let i = 0; i < lines.length; i += 50) {
                                    ws.send(JSON.stringify({ type: 'device_log', payload: { level, lines: lines.slice(i, i + 50) } }));
                                }
                            }
                        }
                    }
                    else {
                        logger.info('No logs to upload in burst');
                    }
                }
                catch (err) {
                    logger.warn('Failed to handle REQUEST_LOG_BURST:', err);
                }
                break;
            }
            case 'POWER_ON':
                this.invokeTVControl('powerOn');
                break;
            case 'SET_NTP':
                this.applyNtpSettings(payload || {});
                break;
            case 'SET_IR_LOCK':
                this.applyLockSetting('irLock', payload === null || payload === void 0 ? void 0 : payload.lock);
                break;
            case 'SET_BUTTON_LOCK':
                this.applyLockSetting('buttonLock', payload === null || payload === void 0 ? void 0 : payload.lock);
                break;
            case 'SET_ON_TIMER':
            case 'SET_OFF_TIMER':
            case 'CLEAR_ON_TIMER':
            case 'CLEAR_OFF_TIMER':
                logger.info('[cmd] ' + messageType + ' not supported (MDC removed)');
                break;
            case 'SET_VOLUME':
                this.invokeTVControl('setVolume', (_k = (_j = payload === null || payload === void 0 ? void 0 : payload.level) !== null && _j !== void 0 ? _j : command.level) !== null && _k !== void 0 ? _k : null);
                break;
            case 'VOLUME_UP':
                this.invokeTVControl('volumeUp', (_m = (_l = payload === null || payload === void 0 ? void 0 : payload.step) !== null && _l !== void 0 ? _l : payload === null || payload === void 0 ? void 0 : payload.amount) !== null && _m !== void 0 ? _m : 2);
                break;
            case 'VOLUME_DOWN':
                this.invokeTVControl('volumeDown', (_p = (_o = payload === null || payload === void 0 ? void 0 : payload.step) !== null && _o !== void 0 ? _o : payload === null || payload === void 0 ? void 0 : payload.amount) !== null && _p !== void 0 ? _p : 2);
                break;
            case 'MUTE':
                this.invokeTVControl('setMute', true);
                break;
            case 'UNMUTE':
                this.invokeTVControl('setMute', false);
                break;
            case 'TOGGLE_MUTE':
                this.invokeTVControl('toggleMute');
                break;
            case 'SET_INPUT':
            case 'SWITCH_INPUT':
                if (!payload) {
                    logger.warn('SET_INPUT command missing payload');
                    break;
                }
                this.invokeTVControl('setInputSource', payload);
                break;
            case 'CHANNEL_UP':
                this.invokeTVControl('channelUp');
                break;
            case 'CHANNEL_DOWN':
                this.invokeTVControl('channelDown');
                break;
            case 'SET_CHANNEL':
            case 'TUNE_CHANNEL':
                this.invokeTVControl('tuneChannel', payload || command);
                break;
            case 'SHOW_TV_WINDOW':
                this.invokeTVControl('showWindow', (payload === null || payload === void 0 ? void 0 : payload.rect) || undefined, payload === null || payload === void 0 ? void 0 : payload.zOrder);
                break;
            case 'HIDE_TV_WINDOW':
                this.invokeTVControl('hideWindow', payload === null || payload === void 0 ? void 0 : payload.zOrder);
                break;
            case 'CAST_READY':
            case 'CAST_STATUS':
                if (typeof Telemetry !== 'undefined' && Telemetry.setCastReady) {
                    Telemetry.setCastReady((_s = (_r = (_q = payload === null || payload === void 0 ? void 0 : payload.ready) !== null && _q !== void 0 ? _q : payload) !== null && _r !== void 0 ? _r : command === null || command === void 0 ? void 0 : command.ready) !== null && _s !== void 0 ? _s : null);
                }
                break;
            case 'OTT_STATUS':
                if (typeof Telemetry !== 'undefined' && Telemetry.setOttStatus) {
                    Telemetry.setOttStatus(payload || command || null);
                }
                break;
            case 'CLONE_STATUS':
                if (typeof Telemetry !== 'undefined' && Telemetry.setCloneStatus) {
                    Telemetry.setCloneStatus(payload || command || null);
                }
                break;
            case 'IPTV_STATS':
                if (typeof Telemetry !== 'undefined' && Telemetry.updateIptvStats) {
                    Telemetry.updateIptvStats(payload || command || {});
                }
                break;
            case 'INSTALL_OTT_APP':
            case 'LAUNCH_OTT_APP':
                // Placeholder: backend/UI currently requests install only; actual app control TBD
                logger.info('OTT app request received', payload || command);
                break;
            case 'REFRESH_CONTENT':
                this.loadContent();
                break;
            case 'CLEAR_CACHE':
                this.clearCache();
                break;
            case 'SYNC_PLAY':
                logger.info('SYNC_PLAY command received (SyncPlay removed from player; ignored)');
                break;
            case 'SET_ZONES':
                // Zone layout is now a content type — ignore legacy SET_ZONES push from server
                logger.info('[zones] SET_ZONES ignored (zones are now content items)');
                break;
            default:
                logger.warn('Unknown command:', command);
        }
    },
    // ── Zone mode ──────────────────────────────────────────────────────────────
    _zoneErrorCounts: {},
    activateZoneMode(zones) {
        this.stopZoneMode();
        if (!zones || zones.length === 0) {
            this._zoneMode = false;
            this.loadContent();
            return;
        }
        // Stop regular full-screen playback (including singleton AVPlay)
        this.cancelCurrentPlayback();
        this.resetAvPlay();
        const contentContainer = document.getElementById('content-container');
        if (contentContainer)
            contentContainer.style.display = 'none';
        this._zoneMode = true;
        // Detect whether any zone has sync enabled (syncGroup = 'A'|'B'|'C'|'D').
        // Sync zones use AVPlay VideoMixer (hardware-decoded, local files, sync start).
        // Non-sync zones use HTML5 <video> (more flexible, no transparent body needed).
        const activeZones = zones.filter((z) => z.source || z.playlistId);
        this._zoneSyncEnabled = activeZones.some((z) => !!z.syncGroup);
        // Count how many zones participate in sync so we can flush as soon as ALL of
        // them are prepared, regardless of download/prepare timing differences.
        this._zoneSyncExpectedCount = activeZones.filter((z) => !!z.syncGroup).length;
        if (this._zoneSyncEnabled) {
            logger.info(`[Zones] Sync mode enabled — HTML5 path with synchronized start/loop (expecting ${this._zoneSyncExpectedCount})`);
        }
        else {
            logger.info(`[Zones] No sync groups — using HTML5 <video> for all zones`);
        }
        const token = this.deviceToken || localStorage.getItem('deviceToken') || '';
        activeZones.forEach((zone, index) => {
            void this._playZoneSource(zone, token, index);
        });
    },
    stopZoneMode() {
        var _a, _b, _c, _d, _f;
        this._zoneMode = false; // Set early so in-flight ping-pong callbacks abort immediately
        this._zoneSyncReadyQueue = [];
        this._zoneSyncFlushTimer = null;
        this._zoneSyncExpectedCount = 0;
        this._zoneSyncLoopQueue = [];
        this._videoMixerQueue = Promise.resolve(); // Reset queue so stale prepare() callbacks don't fire
        for (const timer of this._zoneTimers)
            clearTimeout(timer);
        this._zoneTimers = [];
        this._zoneErrorCounts = {};
        for (const avp of this._zoneAVPlayers) {
            try {
                avp.stop();
            }
            catch (_) { }
            try {
                avp.close();
            }
            catch (_) { }
        }
        this._zoneAVPlayers = [];
        this._zoneAVPlayerMap = {};
        this._zoneSyncEnabled = false;
        // Close any webapis.document instance used by a document zone
        if (this._zoneDocumentActive) {
            this._zoneDocumentActive = false;
            try {
                (_b = (_a = window.webapis) === null || _a === void 0 ? void 0 : _a.document) === null || _b === void 0 ? void 0 : _b.stop(() => { }, () => { });
            }
            catch (_) { }
            try {
                (_d = (_c = window.webapis) === null || _c === void 0 ? void 0 : _c.document) === null || _d === void 0 ? void 0 : _d.close(() => { }, () => { });
            }
            catch (_) { }
        }
        for (const el of this._zoneContainers) {
            // Pause any <video> children before tearing down to avoid play() promise rejection noise
            el.querySelectorAll('video').forEach((v) => { try {
                v.pause();
                v.src = '';
            }
            catch (_) { } });
            try {
                (_f = el.parentNode) === null || _f === void 0 ? void 0 : _f.removeChild(el);
            }
            catch (_) { }
        }
        this._zoneContainers = [];
        // Restore regular content container visibility
        const contentContainer = document.getElementById('content-container');
        if (contentContainer)
            contentContainer.style.display = '';
        this.setAvPlayVisualMode(false);
        this._zoneMode = false;
    },
    // Collect all zones' first play() callbacks and fire them together in one JS tick.
    // Zones that finish prepare() within the 150ms gather window start simultaneously,
    // so same-duration videos stay frame-aligned on every loop iteration.
    _enqueueZoneSync(playFn) {
        this._zoneSyncReadyQueue.push(playFn);
        // Count-based flush: once all expected sync zones have prepared and enqueued,
        // start them ALL immediately. This works regardless of download/prepare timing —
        // Zone 0 might prepare 2s before Zone 2, but we wait until Zone 2 is also ready.
        if (this._zoneSyncExpectedCount > 0 &&
            this._zoneSyncReadyQueue.length >= this._zoneSyncExpectedCount) {
            if (this._zoneSyncFlushTimer !== null) {
                clearTimeout(this._zoneSyncFlushTimer);
                const idx = this._zoneTimers.indexOf(this._zoneSyncFlushTimer);
                if (idx >= 0)
                    this._zoneTimers.splice(idx, 1);
                this._zoneSyncFlushTimer = null;
            }
            this._flushZoneSyncQueue();
            return;
        }
        // Fallback timer: if a sync zone fails to prepare (AVPlay error) it won't
        // enqueue, so we flush whatever arrived after a generous wait.
        if (this._zoneSyncFlushTimer !== null) {
            clearTimeout(this._zoneSyncFlushTimer);
            const idx = this._zoneTimers.indexOf(this._zoneSyncFlushTimer);
            if (idx >= 0)
                this._zoneTimers.splice(idx, 1);
            this._zoneSyncFlushTimer = null;
        }
        const t = setTimeout(() => {
            this._zoneSyncFlushTimer = null;
            if (this._zoneSyncReadyQueue.length > 0)
                this._flushZoneSyncQueue();
        }, 10000);
        this._zoneSyncFlushTimer = t;
        this._zoneTimers.push(t);
    },
    _flushZoneSyncQueue() {
        if (!this._zoneMode) {
            this._zoneSyncReadyQueue = [];
            return;
        }
        const queue = this._zoneSyncReadyQueue.splice(0);
        logger.info(`[Zone sync] Starting ${queue.length} zone(s) simultaneously`);
        for (const fn of queue) {
            try {
                fn();
            }
            catch (e) {
                logger.warn('[Zone sync] play callback threw:', e);
            }
        }
    },
    _playZoneSource(zone, token, zoneIndex) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c, _d;
            const playerScreen = document.getElementById('player-screen');
            if (!playerScreen)
                return;
            const container = document.createElement('div');
            container.id = `zone-${zone.id}`;
            container.style.cssText = [
                'position:absolute',
                `left:${((zone.rect.x / 1920) * 100).toFixed(4)}%`,
                `top:${((zone.rect.y / 1080) * 100).toFixed(4)}%`,
                `width:${((zone.rect.width / 1920) * 100).toFixed(4)}%`,
                `height:${((zone.rect.height / 1080) * 100).toFixed(4)}%`,
                'overflow:hidden',
                'background:#000',
            ].join(';');
            playerScreen.appendChild(container);
            this._zoneContainers.push(container);
            let items = [];
            try {
                const source = zone.source;
                if ((source === null || source === void 0 ? void 0 : source.type) === 'playlist') {
                    const pl = yield API.getPlaylistById(source.playlistId, token);
                    if (pl)
                        items = (_a = API._normalizePlaylist(pl, token).items) !== null && _a !== void 0 ? _a : [];
                }
                else if ((source === null || source === void 0 ? void 0 : source.type) === 'content') {
                    const ct = yield API.getContentById(source.contentId, token);
                    if (ct)
                        items = [{ id: ct.id, contentId: ct.id, duration: (_b = ct.duration) !== null && _b !== void 0 ? _b : 10, content: API._normalizeContent(ct, token) }];
                }
                else if (zone.playlistId) {
                    const pl = yield API.getPlaylistById(zone.playlistId, token);
                    if (pl)
                        items = (_c = API._normalizePlaylist(pl, token).items) !== null && _c !== void 0 ? _c : [];
                }
            }
            catch (e) {
                logger.warn(`[Zone ${zoneIndex}] Failed to load source:`, e);
            }
            if (items.length === 0) {
                logger.warn(`[Zone ${zoneIndex}] No playable items found`);
                return;
            }
            // Download all media files to local storage before playback,
            // exactly like the regular playlist/schedule flow.
            try {
                const cm = window.ContentManager;
                if (cm && typeof cm.downloadPlaylist === 'function') {
                    logger.info(`[Zone ${zoneIndex}] Downloading ${items.length} item(s) to local storage...`);
                    const downloaded = yield cm.downloadPlaylist({ id: zone.id, items });
                    items = (_d = downloaded.items) !== null && _d !== void 0 ? _d : items;
                    logger.info(`[Zone ${zoneIndex}] Download complete for zone`);
                }
            }
            catch (e) {
                logger.warn(`[Zone ${zoneIndex}] ContentManager download failed, falling back to remote URLs:`, e);
            }
            this._playZoneItems(zone, container, items, 0, token, zoneIndex);
        });
    },
    _playZoneItems(zone, container, items, itemIndex, token, zoneIndex) {
        var _a, _b, _c;
        if (!this._zoneMode)
            return;
        if (!container.parentNode)
            return;
        // At each zone item transition, check whether new content has been published.
        // This is the zone-mode equivalent of the playlist controller calling
        // trySwapToPendingContent() between items � without this, a pending playlist
        // set while zones are running would never be applied.
        if (this.pendingPlaylist) {
            logger.info(`[Zone ${zoneIndex}] Pending content ready � swapping at zone item boundary`);
            this.trySwapToPendingContent(true);
            return;
        }
        // Circuit breaker: stop zone after 5 consecutive failures
        const errKey = zone.id + ':' + (itemIndex % items.length);
        if (((_a = this._zoneErrorCounts[zone.id]) !== null && _a !== void 0 ? _a : 0) >= 5) {
            logger.warn(`[Zone ${zoneIndex}] Too many errors, stopping zone`);
            return;
        }
        const item = items[itemIndex % items.length];
        const content = item === null || item === void 0 ? void 0 : item.content;
        if (!content) {
            const t = setTimeout(() => this._playZoneItems(zone, container, items, itemIndex + 1, token, zoneIndex), 3000);
            this._zoneTimers.push(t);
            return;
        }
        const durationMs = ((_c = (_b = item.duration) !== null && _b !== void 0 ? _b : content.duration) !== null && _c !== void 0 ? _c : 10) * 1000;
        const type = (content.type || '').toUpperCase();
        // Tear down previous media safely.
        // Stop AVPlay VideoMixer player for this zone if one is active.
        const prevAvp = this._zoneAVPlayerMap[zone.id];
        if (prevAvp) {
            try {
                prevAvp.stop();
            }
            catch (_) { }
            try {
                prevAvp.close();
            }
            catch (_) { }
            const aidx = this._zoneAVPlayers.indexOf(prevAvp);
            if (aidx >= 0)
                this._zoneAVPlayers.splice(aidx, 1);
            delete this._zoneAVPlayerMap[zone.id];
        }
        // Restore opaque background for non-video content (images/HTML need it black).
        container.style.background = '#000';
        container.querySelectorAll('video').forEach((v) => { try {
            v.pause();
            v.src = '';
        }
        catch (_) { } });
        container.innerHTML = '';
        if (type === 'IMAGE' || type === 'JPEG' || type === 'PNG' || type === 'GIF' || type === 'WEBP') {
            const objectFit = zone.fitMode === 'fill' ? 'fill' : 'contain';
            const img = document.createElement('img');
            img.src = content.url || content.fileUrl || '';
            img.style.cssText = `width:100%;height:100%;object-fit:${objectFit};display:block;`;
            img.onerror = () => {
                var _a;
                this._zoneErrorCounts[zone.id] = ((_a = this._zoneErrorCounts[zone.id]) !== null && _a !== void 0 ? _a : 0) + 1;
                logger.warn(`[Zone ${zoneIndex}] Image load error (${this._zoneErrorCounts[zone.id]}/5): ${img.src}`);
                const t = setTimeout(() => this._playZoneItems(zone, container, items, itemIndex + 1, token, zoneIndex), 3000);
                this._zoneTimers.push(t);
            };
            img.onload = () => { this._zoneErrorCounts[zone.id] = 0; };
            container.appendChild(img);
            const t = setTimeout(() => {
                if (this._zoneMode && container.parentNode) {
                    this._playZoneItems(zone, container, items, itemIndex + 1, token, zoneIndex);
                }
            }, durationMs);
            this._zoneTimers.push(t);
        }
        else if (type === 'VIDEO' || type === 'MP4' || type === 'WEBM') {
            this._playZoneVideo(zone, container, content, items, itemIndex, durationMs, token, zoneIndex);
        }
        else if (type === 'PDF' || type === 'OFFICE') {
            // OFFICE files are pre-converted to PDF on the server, so route through PDF.js.
            this._playZonePdf(zone, container, content, items, itemIndex, durationMs, token, zoneIndex);
        }
        else if (type === 'MENU_BOARD') {
            this.renderMenuBoard(container, content);
            const t = setTimeout(() => {
                if (this._zoneMode && container.parentNode) {
                    this._playZoneItems(zone, container, items, itemIndex + 1, token, zoneIndex);
                }
            }, durationMs);
            this._zoneTimers.push(t);
        }
        else {
            // Unsupported type — advance
            const t = setTimeout(() => {
                if (this._zoneMode && container.parentNode) {
                    this._playZoneItems(zone, container, items, itemIndex + 1, token, zoneIndex);
                }
            }, durationMs);
            this._zoneTimers.push(t);
        }
    },
    _playZoneVideo(zone, container, content, items, itemIndex, durationMs, token, zoneIndex) {
        const url = content.url || content.fileUrl || '';
        const httpUrl = content.originalUrl || content.fileUrl || url;
        const isLocalFile = url.startsWith('file://');
        // Prefer local file:// (already downloaded by ContentManager) — no HTTP streaming.
        const videoUrl = isLocalFile ? url : httpUrl;
        if (!videoUrl) {
            const t = setTimeout(() => this._playZoneItems(zone, container, items, itemIndex + 1, token, zoneIndex), durationMs);
            this._zoneTimers.push(t);
            return;
        }
        // VideoMixer (avplaystore) compositing does not work on Tizen 4.0/SSSP6 —
        // both planes render full-screen, ignoring SET_MIXEDFRAME rect.
        // Use HTML5 <video> in CSS-positioned zone containers which works reliably.
        const useSyncAvPlay = false;
        if (useSyncAvPlay) {
            this._playZoneVideoAVPlay(zone, container, content, items, itemIndex, durationMs, token, zoneIndex, videoUrl, isLocalFile, httpUrl);
        }
        else {
            this._playZoneVideoHTML5(zone, container, content, items, itemIndex, durationMs, token, zoneIndex, videoUrl, isLocalFile, httpUrl);
        }
    },
    // ── HTML5 <video> path — sync-aware, works on all displays ────────────────
    _playZoneVideoHTML5(zone, container, content, items, itemIndex, durationMs, token, zoneIndex, videoUrl, isLocalFile, httpUrl) {
        let advanced = false;
        const advanceOnce = () => {
            if (advanced)
                return;
            advanced = true;
            if (this._zoneMode && container.parentNode) {
                this._playZoneItems(zone, container, items, itemIndex + 1, token, zoneIndex);
            }
        };
        const isSingleVideoLoop = items.length === 1;
        const useSyncLoop = isSingleVideoLoop && !!zone.syncGroup && this._zoneSyncExpectedCount > 1;
        const objectFit = zone.fitMode === 'fill' ? 'fill' : 'contain';
        logger.info(`[Zone ${zoneIndex}] Playing video (HTML5): ${videoUrl} [${isLocalFile ? 'local' : 'http'}] fit=${objectFit} syncLoop=${useSyncLoop}`);
        const video = document.createElement('video');
        // For 'contain': object-fit: contain is universally supported.
        // For 'fill':    Tizen's hardware video overlay sometimes ignores object-fit,
        //               causing letterboxing even when fill is requested. We apply
        //               a CSS transform:scale() in 'loadedmetadata' below which the
        //               hardware overlay DOES respect.
        const initialFit = objectFit === 'fill' ? 'contain' : objectFit;
        video.style.cssText = `position:absolute;left:0;top:0;width:100%;height:100%;object-fit:${initialFit};display:block;background:#000;`;
        video.setAttribute('playsinline', '');
        if (zoneIndex > 0)
            video.muted = true;
        // Only use native loop when there is no sync partner — otherwise we manage
        // re-looping manually so all zones restart in the same JS tick.
        if (isSingleVideoLoop && !useSyncLoop)
            video.loop = true;
        if (objectFit === 'fill') {
            const applyStretch = () => {
                const cw = container.clientWidth;
                const ch = container.clientHeight;
                const vw = video.videoWidth;
                const vh = video.videoHeight;
                if (!cw || !ch || !vw || !vh)
                    return;
                // Pin video at top-left at its natural pixel size, then scale that to
                // exactly fill the container. The hardware overlay honors transform.
                video.style.width = vw + 'px';
                video.style.height = vh + 'px';
                video.style.transformOrigin = 'top left';
                video.style.transform = `scale(${(cw / vw).toFixed(6)}, ${(ch / vh).toFixed(6)})`;
                video.style.objectFit = 'fill';
                logger.info(`[Zone ${zoneIndex}] Fill stretch applied: ${vw}x${vh} → ${cw}x${ch}`);
            };
            video.addEventListener('loadedmetadata', applyStretch);
            // Re-apply if first attempt fired before container was laid out.
            video.addEventListener('canplay', applyStretch, { once: true });
        }
        video.addEventListener('ended', () => {
            this._zoneErrorCounts[zone.id] = 0;
            // If a new playlist is queued, swap before re-looping (otherwise zone
            // sync mode will loop the current video forever and never honor a
            // pending publish).
            if (this.pendingPlaylist) {
                logger.info('[Zone sync] Pending playlist ready; swapping at zone item end');
                this.trySwapToPendingContent(true);
                return;
            }
            if (isSingleVideoLoop) {
                if (useSyncLoop) {
                    // Synchronized re-loop — same queue/flush pattern as AVPlay path
                    const fn = () => {
                        video.currentTime = 0;
                        video.play().catch(() => { advanceOnce(); });
                    };
                    this._zoneSyncLoopQueue.push({ fn, zoneIndex });
                    const flushLoopQueue = () => {
                        if (this._zoneSyncLoopFlushTimer !== null) {
                            clearTimeout(this._zoneSyncLoopFlushTimer);
                            this._zoneSyncLoopFlushTimer = null;
                        }
                        if (this._zoneSyncLoopQueue.length === 0)
                            return;
                        const batch = this._zoneSyncLoopQueue.splice(0);
                        logger.info(`[Zone sync] Re-looping ${batch.length} zone(s) simultaneously`);
                        for (const entry of batch) {
                            try {
                                entry.fn();
                            }
                            catch (_) {
                                logger.warn(`[Zone ${entry.zoneIndex}] re-loop failed`);
                            }
                        }
                    };
                    if (this._zoneSyncLoopQueue.length >= this._zoneSyncExpectedCount) {
                        flushLoopQueue();
                    }
                    else {
                        if (this._zoneSyncLoopFlushTimer !== null)
                            clearTimeout(this._zoneSyncLoopFlushTimer);
                        this._zoneSyncLoopFlushTimer = setTimeout(flushLoopQueue, 500);
                    }
                }
                // else: native loop=true handles it
            }
            else {
                advanceOnce();
            }
        });
        video.addEventListener('error', () => {
            var _a;
            const errCount = ((_a = this._zoneErrorCounts[zone.id]) !== null && _a !== void 0 ? _a : 0) + 1;
            this._zoneErrorCounts[zone.id] = errCount;
            logger.warn(`[Zone ${zoneIndex}] HTML5 video error (${errCount}/5): ${videoUrl}`);
            if (isLocalFile && errCount <= 1) {
                logger.info(`[Zone ${zoneIndex}] Retrying with HTTP URL: ${httpUrl}`);
                video.src = httpUrl;
                video.play().catch(() => { });
                return;
            }
            const t = setTimeout(advanceOnce, Math.min(errCount * 2000, 10000));
            this._zoneTimers.push(t);
        });
        container.appendChild(video);
        video.src = videoUrl;
        // For synced zones: wait for canplay then register with zone-sync queue so
        // ALL zones fire play() in the same JS tick (no per-zone head-start drift).
        if (zone.syncGroup) {
            let readyCalled = false;
            const startVideo = () => {
                if (readyCalled)
                    return;
                readyCalled = true;
                this._enqueueZoneSync(() => {
                    if (!this._zoneMode)
                        return;
                    video.play().catch((e) => {
                        const msg = (e instanceof Error) ? e.message : String(e);
                        if (msg.includes('interrupted') || msg.includes('pause') || msg.includes('load'))
                            return;
                        logger.warn(`[Zone ${zoneIndex}] video.play() rejected: ${msg}`);
                    });
                    logger.info(`[Zone ${zoneIndex}] HTML5 video playing (synced start)`);
                });
            };
            video.addEventListener('canplay', startVideo, { once: true });
            if (video.readyState >= 3)
                startVideo();
        }
        else {
            video.play().catch((e) => {
                const msg = (e instanceof Error) ? e.message : String(e);
                if (msg.includes('interrupted') || msg.includes('pause') || msg.includes('load'))
                    return;
                logger.warn(`[Zone ${zoneIndex}] video.play() rejected: ${msg}`);
            });
        }
        if (!isSingleVideoLoop && durationMs > 0 && durationMs < 3600000) {
            const t = setTimeout(advanceOnce, durationMs + 2000);
            this._zoneTimers.push(t);
        }
    },
    // ── AVPlay VideoMixer path — sync enabled, hardware-decoded local files ────
    _playZoneVideoAVPlay(zone, container, content, items, itemIndex, durationMs, token, zoneIndex, videoUrl, isLocalFile, httpUrl) {
        let advanced = false;
        const advanceOnce = () => {
            if (advanced)
                return;
            advanced = true;
            const avp = this._zoneAVPlayerMap[zone.id];
            if (avp) {
                try {
                    avp.stop();
                }
                catch (_) { }
                try {
                    avp.close();
                }
                catch (_) { }
                const aidx = this._zoneAVPlayers.indexOf(avp);
                if (aidx >= 0)
                    this._zoneAVPlayers.splice(aidx, 1);
                delete this._zoneAVPlayerMap[zone.id];
            }
            if (this._zoneMode && container.parentNode) {
                this._playZoneItems(zone, container, items, itemIndex + 1, token, zoneIndex);
            }
        };
        const isSingleVideoLoop = items.length === 1;
        // Make zone container transparent so AVPlay hardware layer shows through.
        container.style.background = 'transparent';
        container.innerHTML = '';
        const rect = zone.rect || { x: 0, y: 0, width: 1920, height: 1080 };
        logger.info(`[Zone ${zoneIndex}] AVPlay VideoMixer open: ${videoUrl} [${isLocalFile ? 'local' : 'http'}] rect=${rect.x},${rect.y} ${rect.width}x${rect.height} syncGroup=${zone.syncGroup}`);
        // Serialize VideoMixer prepare() calls — Samsung rejects concurrent prepare().
        this._videoMixerQueue = this._videoMixerQueue.then(() => {
            if (!this._zoneMode)
                return;
            return new Promise((resolve) => {
                try {
                    const playerId = `zone_${zoneIndex}_${Date.now()}`;
                    const avp = window.webapis.avplaystore.getPlayer(playerId);
                    // open() first, then USE_VIDEOMIXER — Samsung requires this order
                    avp.open(videoUrl);
                    avp.setStreamingProperty('USE_VIDEOMIXER', 'TRUE');
                    avp.setListener({
                        onstreamcompleted: () => {
                            logger.info(`[Zone ${zoneIndex}] AVPlay stream completed`);
                            this._zoneErrorCounts[zone.id] = 0;
                            // Swap pending playlist before re-looping so a fresh publish
                            // actually takes over the screen.
                            if (this.pendingPlaylist) {
                                logger.info('[Zone sync] Pending playlist ready; swapping at zone item end (AVPlay)');
                                this.trySwapToPendingContent(true);
                                return;
                            }
                            if (isSingleVideoLoop) {
                                // Synchronized re-loop: wait for ALL sync zones to complete,
                                // then seekTo(0)+play() all at once to prevent drift accumulation.
                                if (zone.syncGroup && this._zoneSyncExpectedCount > 1) {
                                    this._zoneSyncLoopQueue.push({ fn: () => { try {
                                            avp.seekTo(0);
                                            avp.play();
                                        }
                                        catch (_) {
                                            advanceOnce();
                                        } }, zoneIndex });
                                    if (this._zoneSyncLoopQueue.length >= this._zoneSyncExpectedCount) {
                                        const batch = this._zoneSyncLoopQueue.splice(0);
                                        logger.info(`[Zone sync] Re-looping ${batch.length} zone(s) simultaneously`);
                                        for (const entry of batch) {
                                            try {
                                                entry.fn();
                                            }
                                            catch (_) {
                                                logger.warn(`[Zone ${entry.zoneIndex}] seekTo/play failed on re-loop`);
                                            }
                                        }
                                    }
                                }
                                else {
                                    try {
                                        avp.seekTo(0);
                                        avp.play();
                                    }
                                    catch (_) {
                                        advanceOnce();
                                    }
                                }
                            }
                            else {
                                advanceOnce();
                            }
                        },
                        onerror: (err) => {
                            var _a;
                            logger.warn(`[Zone ${zoneIndex}] AVPlay error: ${err}`);
                            this._zoneErrorCounts[zone.id] = ((_a = this._zoneErrorCounts[zone.id]) !== null && _a !== void 0 ? _a : 0) + 1;
                            advanceOnce();
                        },
                        onbufferingstart: () => { logger.debug(`[Zone ${zoneIndex}] AVPlay buffering start`); },
                        onbufferingprogress: (p) => { logger.debug(`[Zone ${zoneIndex}] AVPlay buffering ${p}%`); },
                        onbufferingcomplete: () => { logger.debug(`[Zone ${zoneIndex}] AVPlay buffering done`); },
                        oncurrentplaytime: () => { },
                        onevent: (evtType, evtData) => { logger.debug(`[Zone ${zoneIndex}] AVPlay event: ${evtType} ${evtData}`); },
                    });
                    avp.prepareAsync(() => {
                        if (!this._zoneMode) {
                            try {
                                avp.close();
                            }
                            catch (_) { }
                            resolve();
                            return;
                        }
                        try {
                            avp.setStreamingProperty('SET_MIXEDFRAME', `${rect.x}|${rect.y}|${rect.width}|${rect.height}`);
                            avp.setDisplayRect(rect.x, rect.y, rect.width, rect.height);
                            const displayMode = zone.fitMode === 'fill'
                                ? 'PLAYER_DISPLAY_MODE_FULL_SCREEN'
                                : 'PLAYER_DISPLAY_MODE_LETTER_BOX';
                            try {
                                avp.setDisplayMethod(displayMode);
                            }
                            catch (_) { }
                            this._zoneAVPlayers.push(avp);
                            this._zoneAVPlayerMap[zone.id] = avp;
                            // Use zone-sync queue so all synced video zones start together
                            this._enqueueZoneSync(() => {
                                if (!this._zoneMode)
                                    return;
                                try {
                                    avp.play();
                                    logger.info(`[Zone ${zoneIndex}] AVPlay VideoMixer playing at ${rect.x},${rect.y} ${rect.width}x${rect.height}`);
                                }
                                catch (playErr) {
                                    logger.warn(`[Zone ${zoneIndex}] AVPlay play() failed: ${playErr}`);
                                    advanceOnce();
                                }
                            });
                        }
                        catch (setupErr) {
                            logger.warn(`[Zone ${zoneIndex}] AVPlay post-prepare failed: ${setupErr}`);
                            try {
                                avp.close();
                            }
                            catch (_) { }
                            advanceOnce();
                        }
                        resolve();
                    }, (prepErr) => {
                        var _a;
                        logger.warn(`[Zone ${zoneIndex}] AVPlay prepare failed: ${prepErr}`);
                        try {
                            avp.close();
                        }
                        catch (_) { }
                        this._zoneErrorCounts[zone.id] = ((_a = this._zoneErrorCounts[zone.id]) !== null && _a !== void 0 ? _a : 0) + 1;
                        advanceOnce();
                        resolve();
                    });
                }
                catch (err) {
                    logger.warn(`[Zone ${zoneIndex}] AVPlay setup error: ${err}`);
                    advanceOnce();
                    resolve();
                }
            });
        });
        if (!isSingleVideoLoop && durationMs > 0 && durationMs < 3600000) {
            const t = setTimeout(advanceOnce, durationMs + 2000);
            this._zoneTimers.push(t);
        }
    },
    // Render PDF into zone container using PDF.js canvas rendering.
    // DOM-based — renders on top of AVPlay VideoMixer hardware layer.
    _playZonePdf(zone, container, content, items, itemIndex, durationMs, token, zoneIndex) {
        const url = content.url || content.fileUrl || '';
        if (!url) {
            const t = setTimeout(() => this._playZoneItems(zone, container, items, itemIndex + 1, token, zoneIndex), durationMs);
            this._zoneTimers.push(t);
            return;
        }
        const pdfLib = window.pdfjsLib || window.PDFJS;
        if (!pdfLib) {
            logger.warn(`[Zone ${zoneIndex}] pdfjs unavailable — cannot render PDF in zone`);
            const t = setTimeout(() => this._playZoneItems(zone, container, items, itemIndex + 1, token, zoneIndex), durationMs);
            this._zoneTimers.push(t);
            return;
        }
        // worker src and API compat (v1 / v2) handled inside loadAndPlay
        let pageInterval = null;
        let advanced = false;
        let fallbackTimer = null;
        const cleanup = () => {
            if (pageInterval !== null) {
                clearInterval(pageInterval);
                pageInterval = null;
            }
            if (fallbackTimer !== null) {
                clearTimeout(fallbackTimer);
                fallbackTimer = null;
            }
        };
        const advanceOnce = () => {
            if (advanced)
                return;
            advanced = true;
            cleanup();
            if (this._zoneMode && container.parentNode) {
                this._playZoneItems(zone, container, items, itemIndex + 1, token, zoneIndex);
            }
        };
        const loadAndPlay = () => __awaiter(this, void 0, void 0, function* () {
            var _a, _b;
            try {
                // Support both pdfjs v1 (window.PDFJS) and v2 (window.pdfjsLib)
                const pdfLibV2 = window.pdfjsLib;
                const pdfLibV1 = window.PDFJS;
                const lib = pdfLibV2 || pdfLibV1;
                const isV1 = !pdfLibV2 && !!pdfLibV1;
                if (!lib) {
                    logger.warn(`[Zone ${zoneIndex}] pdfjsLib not loaded — cannot render PDF`);
                    advanceOnce();
                    return;
                }
                const loadingTask = lib.getDocument(url);
                const pdf = yield loadingTask.promise;
                if (!this._zoneMode || !container.parentNode)
                    return;
                logger.info(`[Zone ${zoneIndex}] PDF loaded: ${(_a = content.name) !== null && _a !== void 0 ? _a : url} (${pdf.numPages} pages)`);
                const numPages = pdf.numPages;
                const pageDurationMs = numPages > 1 ? Math.max(3000, Math.floor(durationMs / numPages)) : durationMs;
                const getVp = (page, scale) => isV1 ? page.getViewport(scale) : page.getViewport({ scale });
                const renderPage = (pageNum) => __awaiter(this, void 0, void 0, function* () {
                    if (!this._zoneMode || !container.parentNode)
                        return;
                    try {
                        const page = yield pdf.getPage(pageNum);
                        const cw = container.offsetWidth || zone.rect.width;
                        const ch = container.offsetHeight || zone.rect.height;
                        const nativeVp = getVp(page, 1);
                        const scale = Math.min(cw / nativeVp.width, ch / nativeVp.height);
                        const viewport = getVp(page, scale);
                        const canvas = document.createElement('canvas');
                        canvas.width = Math.max(Math.floor(viewport.width), 1);
                        canvas.height = Math.max(Math.floor(viewport.height), 1);
                        canvas.style.cssText = [
                            'position:absolute',
                            `left:${Math.floor((cw - viewport.width) / 2)}px`,
                            `top:${Math.floor((ch - viewport.height) / 2)}px`,
                            'background:#000',
                        ].join(';');
                        const ctx = canvas.getContext('2d');
                        if (!ctx)
                            return;
                        yield page.render({ canvasContext: ctx, viewport }).promise;
                        if (!this._zoneMode || !container.parentNode)
                            return;
                        container.innerHTML = '';
                        container.appendChild(canvas);
                        this._zoneErrorCounts[zone.id] = 0;
                    }
                    catch (e) {
                        if ((e === null || e === void 0 ? void 0 : e.name) === 'RenderingCancelledException')
                            return;
                        logger.warn(`[Zone ${zoneIndex}] PDF page ${pageNum} render error:`, (e === null || e === void 0 ? void 0 : e.message) || e);
                    }
                });
                yield renderPage(1);
                if (numPages > 1) {
                    let currentPage = 1;
                    pageInterval = setInterval(() => {
                        if (!this._zoneMode || !container.parentNode) {
                            cleanup();
                            return;
                        }
                        currentPage = (currentPage % numPages) + 1;
                        void renderPage(currentPage);
                    }, pageDurationMs);
                }
                // For single-item zones: cycle pages forever via setInterval — no fallback timer.
                // For multi-item zones: advance to the next item after total duration.
                const isSingleLoop = items.length === 1;
                if (!isSingleLoop) {
                    fallbackTimer = setTimeout(advanceOnce, durationMs);
                    this._zoneTimers.push(fallbackTimer);
                }
            }
            catch (e) {
                const errCount = ((_b = this._zoneErrorCounts[zone.id]) !== null && _b !== void 0 ? _b : 0) + 1;
                this._zoneErrorCounts[zone.id] = errCount;
                logger.warn(`[Zone ${zoneIndex}] PDF load error (${errCount}/5): ${e}`);
                const delay = Math.min(errCount * 2000, 10000);
                const t = setTimeout(() => this._playZoneItems(zone, container, items, itemIndex + 1, token, zoneIndex), delay);
                this._zoneTimers.push(t);
            }
        });
        void loadAndPlay();
    },
    // Inbound from SyncEngine (mesh-relayed or self-loop).
    handleSyncCommand(cmd) {
        const type = cmd && cmd.type;
        const payload = (cmd && cmd.payload) || {};
        switch (type) {
            case 'SYNC_PLAY': {
                const startAt = Number(payload.syncedStartMs);
                if (!isFinite(startAt) || startAt <= 0) {
                    logger.info('[Sync] SYNC_PLAY without syncedStartMs � noop');
                    return;
                }
                const remaining = startAt - this.getSyncedTime();
                logger.info('[Sync] SYNC_PLAY scheduled itemIndex=' + payload.itemIndex +
                    ' in ' + Math.round(remaining) + 'ms (from=' + cmd.fromDeviceId + ')');
                this.waitForPreciseSyncedTime(startAt, () => {
                    logger.info('[Sync] SYNC_PLAY fire-time reached (itemIndex=' + payload.itemIndex + ')');
                    // Followers begin/resume playback at the same wall instant.
                    const v = this._activeSyncVideo;
                    if (v) {
                        try {
                            v.play().catch(() => { });
                        }
                        catch (_) { }
                    }
                });
                break;
            }
            case 'SYNC_NEXT_ITEM': {
                const target = Number(payload.syncedTargetMs);
                if (!isFinite(target))
                    return;
                logger.info('[Sync] SYNC_NEXT_ITEM itemIndex=' + payload.itemIndex +
                    ' target=' + target + ' from=' + cmd.fromDeviceId);
                // Follower side: schedule the controller's playNext at the leader's
                // target instant. Until per-controller wiring lands, this is
                // surfaced via a hook the controller can listen on.
                this._pendingSyncNextItemAt = target;
                this._pendingSyncNextItemIndex = payload.itemIndex;
                this.waitForPreciseSyncedTime(target, () => {
                    this._pendingSyncNextItemAt = null;
                    if (typeof this.currentVideoEndedCallback === 'function') {
                        // Re-use existing item-advance pathway (used by AVPlay onstreamcompleted).
                        try {
                            this.currentVideoEndedCallback();
                        }
                        catch (_) { }
                    }
                });
                break;
            }
            case 'SYNC_ADJUST': {
                // Leader-issued correction: { driftMs, action, playbackRate, targetMs }
                const v = this._activeSyncVideo;
                if (!v) {
                    logger.debug && logger.debug('[Sync] SYNC_ADJUST received but no active video');
                    return;
                }
                const action = String(payload.action || '');
                if (action === 'snap') {
                    const targetMs = Number(payload.targetMs);
                    if (isFinite(targetMs) && targetMs >= 0) {
                        try {
                            v.currentTime = targetMs / 1000;
                            v.playbackRate = 1.0;
                            logger.info('[Sync] ADJUST snap ? currentTime=' + (targetMs / 1000).toFixed(3) +
                                's (drift=' + payload.driftMs + 'ms)');
                        }
                        catch (e) {
                            logger.warn('[Sync] currentTime snap failed:', (e === null || e === void 0 ? void 0 : e.message) || e);
                        }
                    }
                }
                else if (action === 'nudge_up' || action === 'nudge_down') {
                    const rate = Number(payload.playbackRate);
                    if (isFinite(rate) && rate > 0.5 && rate < 2.0) {
                        try {
                            v.playbackRate = rate;
                            logger.debug && logger.debug('[Sync] ADJUST nudge ? playbackRate=' + rate +
                                ' (drift=' + payload.driftMs + 'ms)');
                        }
                        catch (e) {
                            logger.warn('[Sync] playbackRate nudge failed:', (e === null || e === void 0 ? void 0 : e.message) || e);
                        }
                        // Schedule rate restore once close to the leader.
                        if (this._syncRateRestoreTimer)
                            clearTimeout(this._syncRateRestoreTimer);
                        this._syncRateRestoreTimer = setTimeout(() => {
                            try {
                                if (this._activeSyncVideo)
                                    this._activeSyncVideo.playbackRate = 1.0;
                            }
                            catch (_) { }
                        }, 5000);
                    }
                }
                // 'noop' is normally not sent (engine filters), but tolerate.
                break;
            }
            case 'SYNC_HEARTBEAT':
            case 'SYNC_RESET':
            case 'SYNC_STOP':
                logger.debug && logger.debug('[Sync] ' + type + ' received', payload);
                break;
            default:
                logger.debug && logger.debug('[Sync] unknown command type:', type);
        }
    },
    // Periodic tick to feed SyncEngine the active <video>'s currentTime so the
    // leader/followers can compute drift. Ticks at 1 Hz; engine debounces
    // internally and only acts in sync mode.
    startSyncStateTick() {
        if (this._syncStateTickStarted)
            return;
        this._syncStateTickStarted = true;
        setInterval(() => {
            if (!this._syncMode || typeof SyncEngine === 'undefined')
                return;
            const v = this._activeSyncVideo;
            if (!v)
                return;
            try {
                SyncEngine.setPlaybackState({
                    itemIndex: this._syncCurrentItemIndex,
                    currentTimeMs: Math.max(0, Math.round((v.currentTime || 0) * 1000)),
                    syncGroupId: this._syncGroupId,
                });
            }
            catch (_) { }
        }, 1000);
    },
    applyNtpSettings(payload) {
        try {
            const server = (payload && payload.server) || 'pool.ntp.org';
            const timezone = (payload && payload.timezone) || 'UTC';
            localStorage.setItem('PLAYER_NTP_SERVER', server);
            localStorage.setItem('PLAYER_NTP_TIMEZONE', timezone);
            logger.info('Stored requested NTP settings', { server, timezone });
            this.syncTimeWithServer();
        }
        catch (error) {
            logger.warn('Failed to store NTP settings:', error);
        }
    },
    applyLockSetting(kind, enabled) {
        const value = !!enabled;
        try {
            localStorage.setItem(kind === 'irLock' ? 'PLAYER_IR_LOCK' : 'PLAYER_BUTTON_LOCK', value ? 'true' : 'false');
        }
        catch (error) {
            logger.debug('Failed to persist lock state:', error);
        }
        logger.info(kind + ' updated', { enabled: value });
    },
    // Select an AVPlay profile based on resolution and stream type
    selectAvPlayProfile(content) {
        var _a, _b, _c;
        if (!content)
            return null;
        const width = ((_a = content === null || content === void 0 ? void 0 : content.metadata) === null || _a === void 0 ? void 0 : _a.width) || (content === null || content === void 0 ? void 0 : content.width) || 0;
        const height = ((_b = content === null || content === void 0 ? void 0 : content.metadata) === null || _b === void 0 ? void 0 : _b.height) || (content === null || content === void 0 ? void 0 : content.height) || 0;
        const mime = (((_c = content === null || content === void 0 ? void 0 : content.metadata) === null || _c === void 0 ? void 0 : _c.mimeType) || (content === null || content === void 0 ? void 0 : content.mimeType) || '').toLowerCase();
        const url = content.url || content.liveStreamUrl || '';
        const ext = this.getFileExtension(url);
        const isHls = ext === 'm3u8' || mime.includes('application/vnd.apple.mpegurl');
        const isDash = ext === 'mpd' || mime.includes('dash+xml');
        const isUhd = width >= 2560 || height >= 1440;
        const isLive = ((content === null || content === void 0 ? void 0 : content.type) || '').toLowerCase() === 'live' || content.liveStreamType;
        const baseKey = isUhd ? 'uhd' : 'fhd';
        const streamKey = isDash ? 'dash' : isHls ? 'hls' : 'file';
        const profileKey = `${baseKey}-${streamKey}`;
        const profile = {
            key: profileKey,
            isUhd,
            streamType: streamKey,
            settings: {
                adaptive: isUhd ? 'FIXED_MAX_RESOLUTION=UHD' : 'FIXED_MAX_RESOLUTION=FULL_HD',
                mode4k: isUhd,
                bufferPlay: isUhd ? '2000' : '500',
                bufferResume: isUhd ? '2500' : '1000',
                bufferSeconds: isUhd ? '4' : '2',
                timeoutSeconds: isLive || isDash || isHls ? '15' : '10',
            },
            meta: { width, height, mime, ext, isLive },
        };
        return profile;
    },
    // Apply selected AVPlay profile once per change
    applyAvPlayProfile(content) {
        if (typeof webapis === 'undefined' || !webapis.avplay)
            return;
        const url = (content === null || content === void 0 ? void 0 : content.url) || (content === null || content === void 0 ? void 0 : content.liveStreamUrl) || '';
        const profile = this.selectAvPlayProfile(content);
        if (!profile)
            return;
        if (this.currentAvPlayProfileKey === profile.key) {
            logger.debug('AVPlay profile unchanged; skipping reapply:', profile.key);
            return;
        }
        if (profile.streamType !== 'file') {
            try {
                webapis.avplay.setStreamingProperty('ADAPTIVE_INFO', profile.settings.adaptive);
            }
            catch (err) {
                logger.warn('Failed to set ADAPTIVE_INFO:', (err === null || err === void 0 ? void 0 : err.message) || err);
            }
            try {
                webapis.avplay.setStreamingProperty('SET_MODE_4K', profile.settings.mode4k ? 'TRUE' : 'FALSE');
            }
            catch (err) {
                logger.warn('Failed to set SET_MODE_4K:', (err === null || err === void 0 ? void 0 : err.message) || err);
            }
            try {
                webapis.avplay.setBufferingParam('PLAYER_BUFFER_FOR_PLAY', profile.settings.bufferPlay);
                webapis.avplay.setBufferingParam('PLAYER_BUFFER_FOR_RESUME', profile.settings.bufferResume);
                webapis.avplay.setBufferingParam('PLAYER_BUFFER_SIZE_IN_SECOND', profile.settings.bufferSeconds);
            }
            catch (err) {
                logger.warn('Failed to set buffering params:', (err === null || err === void 0 ? void 0 : err.message) || err);
            }
        }
        else {
            logger.debug('Skipping streaming-only AVPlay profile settings for file playback');
        }
        // Avoid setting timeout for local files; AVPlay throws on some firmwares
        if (!url.startsWith('file:///')) {
            try {
                webapis.avplay.setTimeoutForBuffering(Number(profile.settings.timeoutSeconds));
            }
            catch (err) {
                logger.debug('setTimeoutForBuffering not supported');
            }
        }
        this.currentAvPlayProfileKey = profile.key;
        logger.info('Applied AVPlay profile', {
            key: profile.key,
            resolution: profile.isUhd ? 'UHD' : 'FHD',
            streamType: profile.streamType,
            width: profile.meta.width,
            height: profile.meta.height,
            mime: profile.meta.mime || 'unknown',
            ext: profile.meta.ext || 'none',
        });
    },
    // Backwards compatibility for existing calls
    applySyncAvPlaySettings(content) {
        this.applyAvPlayProfile(content);
    },
    // Get cached content URL
    getCachedContentUrl(content) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                if (typeof ContentManager !== 'undefined' && ContentManager.getCachedUrl) {
                    return yield ContentManager.getCachedUrl(content);
                }
                return null;
            }
            catch (error) {
                logger.error('Error getting cached URL:', error);
                return null;
            }
        });
    },
    // Get current folder ID (from device assignment or schedule)
    getCurrentFolderId() {
        // Try to get from device state or current schedule
        if (typeof DeviceState !== 'undefined' && DeviceState.folderId) {
            return DeviceState.folderId;
        }
        // Could also parse from current schedule if available
        return null;
    },
    getPhysicalDisplaySize() {
        return __awaiter(this, void 0, void 0, function* () {
            const cssWidth = Math.max(window.innerWidth || 0, (screen === null || screen === void 0 ? void 0 : screen.width) || 0, 1920);
            const cssHeight = Math.max(window.innerHeight || 0, (screen === null || screen === void 0 ? void 0 : screen.height) || 0, 1080);
            const ratio = Math.max(1, Number(window.devicePixelRatio) || 1);
            // Default: assume CSS pixels * DPR approximates physical pixels on 4K panels.
            let width = Math.round(cssWidth * ratio);
            let height = Math.round(cssHeight * ratio);
            let source = `css*dpr(${ratio})`;
            const parseResolution = (value) => {
                if (!value)
                    return null;
                if (typeof value === 'string') {
                    const m = value.match(/(\d{3,5})\s*[xX]\s*(\d{3,5})/);
                    if (m) {
                        const w = Number(m[1]);
                        const h = Number(m[2]);
                        if (w > 0 && h > 0)
                            return { w, h };
                    }
                }
                if (typeof value === 'object') {
                    const w = Number(value.width || value.w || value.resolutionWidth || value.resolutionWidthInPixels || 0);
                    const h = Number(value.height || value.h || value.resolutionHeight || value.resolutionHeightInPixels || 0);
                    if (w > 0 && h > 0)
                        return { w, h };
                }
                return null;
            };
            const upgradeIfLarger = (candidate, candidateSource) => {
                if (!candidate)
                    return;
                if (candidate.w > 0 && candidate.h > 0 && (candidate.w > width || candidate.h > height)) {
                    width = candidate.w;
                    height = candidate.h;
                    source = candidateSource;
                }
            };
            // Prefer Tizen DISPLAY info when available (gives panel resolution in pixels).
            try {
                if (typeof tizen !== 'undefined' && tizen.systeminfo && typeof tizen.systeminfo.getPropertyValue === 'function') {
                    const displayInfo = yield new Promise((resolve, reject) => {
                        try {
                            tizen.systeminfo.getPropertyValue('DISPLAY', resolve, reject);
                        }
                        catch (e) {
                            reject(e);
                        }
                    });
                    const reportedWidth = Number(displayInfo === null || displayInfo === void 0 ? void 0 : displayInfo.resolutionWidth) ||
                        Number(displayInfo === null || displayInfo === void 0 ? void 0 : displayInfo.resolutionWidthInPixels) ||
                        Number(displayInfo === null || displayInfo === void 0 ? void 0 : displayInfo.width) ||
                        0;
                    const reportedHeight = Number(displayInfo === null || displayInfo === void 0 ? void 0 : displayInfo.resolutionHeight) ||
                        Number(displayInfo === null || displayInfo === void 0 ? void 0 : displayInfo.resolutionHeightInPixels) ||
                        Number(displayInfo === null || displayInfo === void 0 ? void 0 : displayInfo.height) ||
                        0;
                    if (reportedWidth > 0 && reportedHeight > 0) {
                        width = Math.round(reportedWidth);
                        height = Math.round(reportedHeight);
                        source = 'systeminfo:DISPLAY';
                    }
                }
            }
            catch (e) {
                // Ignore and keep fallback
            }
            // Some Samsung firmwares expose resolution via webapis.tvinfo/webapis.avinfo as a string like "3840x2160".
            // Prefer explicit APIs over heuristics.
            try {
                const tvinfo = typeof webapis !== 'undefined' ? webapis.tvinfo : null;
                if (tvinfo) {
                    if (typeof tvinfo.getResolution === 'function') {
                        upgradeIfLarger(parseResolution(tvinfo.getResolution()), 'webapis:tvinfo.getResolution');
                    }
                    if (typeof tvinfo.getCurrentResolution === 'function') {
                        upgradeIfLarger(parseResolution(tvinfo.getCurrentResolution()), 'webapis:tvinfo.getCurrentResolution');
                    }
                }
            }
            catch (_) {
                // ignore
            }
            try {
                const avinfo = typeof webapis !== 'undefined' ? webapis.avinfo : null;
                if (avinfo) {
                    if (typeof avinfo.getResolution === 'function') {
                        upgradeIfLarger(parseResolution(avinfo.getResolution()), 'webapis:avinfo.getResolution');
                    }
                    if (typeof avinfo.getCurrentResolution === 'function') {
                        upgradeIfLarger(parseResolution(avinfo.getCurrentResolution()), 'webapis:avinfo.getCurrentResolution');
                    }
                }
            }
            catch (_) {
                // ignore
            }
            // Samsung signage firmwares sometimes report the web runtime size (e.g. 1920x1080)
            // even on UHD panels, which makes SyncPlay appear centered "windowed". Use
            // productinfo hints to upgrade to true panel resolution when available.
            try {
                const pi = typeof webapis !== 'undefined' ? webapis.productinfo : null;
                // 1) Try explicit system config keys (some models expose PanelResolution like "3840x2160").
                if (pi && typeof pi.getSystemConfig === 'function') {
                    const candidates = ['PanelResolution', 'panelResolution', 'DisplayResolution', 'displayResolution', 'Resolution', 'resolution'];
                    for (const key of candidates) {
                        try {
                            upgradeIfLarger(parseResolution(pi.getSystemConfig(key)), `webapis:productinfo.getSystemConfig(${key})`);
                        }
                        catch (_) {
                            // ignore
                        }
                    }
                }
                // 2) If still small, use UHD/8K capability flags as a last-resort bump.
                if (width <= 1920 || height <= 1080) {
                    const is8k = !!(pi && typeof pi.is8KPanelSupported === 'function' && pi.is8KPanelSupported());
                    const uhdFlagFns = [
                        'isUHDAModel',
                        'isUHDModel',
                        'isUHDPanelSupported',
                        'isUhdPanelSupported',
                        'isUdPanelSupported',
                        'isUDPanelSupported',
                        'isUHDSupported',
                        'isUhdSupported',
                    ];
                    const isUhd = !!(pi && uhdFlagFns.some((fn) => {
                        try {
                            return typeof pi[fn] === 'function' && !!pi[fn]();
                        }
                        catch (_) {
                            return false;
                        }
                    }));
                    if (is8k) {
                        width = Math.max(width, 7680);
                        height = Math.max(height, 4320);
                        source = 'productinfo:8k-flag';
                    }
                    else if (isUhd) {
                        width = Math.max(width, 3840);
                        height = Math.max(height, 2160);
                        source = 'productinfo:uhd-flag';
                    }
                }
            }
            catch (_) {
                // ignore
            }
            try {
                logger.info('Physical display size resolved', { cssWidth, cssHeight, ratio, width, height, source });
            }
            catch (_) {
                // ignore
            }
            return { width, height };
        });
    },
    // Show sync notification overlay
    showSyncNotification(message, type = 'info') {
        // Remove existing notification
        const existing = document.getElementById('sync-notification');
        if (existing)
            existing.remove();
        const overlay = document.createElement('div');
        overlay.id = 'sync-notification';
        overlay.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: ${type === 'error' ? 'rgba(220, 38, 38, 0.95)' : type === 'success' ? 'rgba(34, 197, 94, 0.95)' : 'rgba(59, 130, 246, 0.95)'};
      backdrop-filter: blur(20px);
      border: 2px solid ${type === 'error' ? 'rgba(220, 38, 38, 0.5)' : type === 'success' ? 'rgba(34, 197, 94, 0.5)' : 'rgba(59, 130, 246, 0.5)'};
      border-radius: 12px;
      padding: 20px 30px;
      color: white;
      font-size: 18px;
      font-weight: 600;
      z-index: 9998;
      box-shadow: 0 0 30px ${type === 'error' ? 'rgba(220, 38, 38, 0.3)' : type === 'success' ? 'rgba(34, 197, 94, 0.3)' : 'rgba(59, 130, 246, 0.3)'};
      animation: slideIn 0.3s ease-out;
    `;
        overlay.textContent = message;
        document.body.appendChild(overlay);
        // Auto-remove after 5 seconds
        setTimeout(() => {
            if (overlay && overlay.parentNode) {
                overlay.style.animation = 'slideOut 0.3s ease-in';
                setTimeout(() => overlay.remove(), 300);
            }
        }, 5000);
    },
    // Show sync countdown overlay
    showSyncCountdown(seconds, label = 'Sync Play') {
        const overlay = document.createElement('div');
        overlay.id = 'sync-countdown';
        overlay.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: rgba(0, 0, 0, 0.9);
      backdrop-filter: blur(20px);
      border: 2px solid rgba(59, 130, 246, 0.5);
      border-radius: 20px;
      padding: 40px 60px;
      color: white;
      font-size: 48px;
      font-weight: bold;
      text-align: center;
      z-index: 9999;
      box-shadow: 0 0 40px rgba(59, 130, 246, 0.3);
    `;
        const labelDiv = document.createElement('div');
        labelDiv.textContent = `${label} Starting In`;
        labelDiv.style.cssText = 'font-size: 24px; margin-bottom: 20px; opacity: 0.8;';
        const counter = document.createElement('div');
        counter.textContent = seconds;
        counter.style.cssText = 'font-size: 72px; color: #3b82f6;';
        overlay.appendChild(labelDiv);
        overlay.appendChild(counter);
        document.body.appendChild(overlay);
        let remaining = seconds;
        const interval = setInterval(() => {
            remaining--;
            if (remaining > 0) {
                counter.textContent = remaining;
            }
            else {
                clearInterval(interval);
                overlay.remove();
            }
        }, 1000);
    },
    // Show notification using Tizen Notification API
    showDownloadNotification(playlistName) {
        try {
            if (typeof tizen !== 'undefined' && tizen.notification) {
                const notificationDict = {
                    content: `Downloaded: ${playlistName}`,
                    iconPath: 'icon.png',
                    soundPath: '',
                    vibration: false,
                    appControl: null,
                };
                const notification = new tizen.StatusNotification('SIMPLE', 'Content Ready', notificationDict);
                tizen.notification.post(notification);
                logger.info('Notification posted:', playlistName);
                // Auto-dismiss after 5 seconds
                setTimeout(() => {
                    try {
                        tizen.notification.remove(notification.id);
                    }
                    catch (removeError) {
                        // Notification may have already been dismissed
                    }
                }, 5000);
            }
        }
        catch (error) {
            logger.debug('Failed to show notification:', error.message);
        }
    },
    // Bridge helper so Player does not directly depend on TVControl internals
    invokeTVControl(method, ...args) {
        if (typeof TVControl === 'undefined' || typeof TVControl[method] !== 'function') {
            logger.warn(`TVControl.${method} unavailable`);
            return false;
        }
        try {
            return TVControl[method](...args);
        }
        catch (error) {
            logger.error(`TVControl.${method} failed:`, (error === null || error === void 0 ? void 0 : error.message) || error);
            return false;
        }
    },
    // Clear cache
    clearCache() {
        try {
            localStorage.removeItem('contentCache');
            this.clearPlaylistCache();
            logger.info('Cache cleared');
            this.loadContent();
        }
        catch (error) {
            logger.error('Failed to clear cache:', error);
        }
    },
    cachePlaylist(playlist, signature) {
        try {
            const payload = {
                playlist,
                signature: signature || null,
                savedAt: Date.now(),
            };
            localStorage.setItem('contentCache', JSON.stringify(payload));
            logger.info('Cached playlist for offline playback');
        }
        catch (error) {
            logger.warn('Failed to cache playlist:', error);
        }
    },
    loadCachedPlaylist() {
        try {
            const raw = localStorage.getItem('contentCache');
            if (!raw) {
                return null;
            }
            return JSON.parse(raw);
        }
        catch (error) {
            logger.warn('Failed to parse cached playlist:', error);
            return null;
        }
    },
    tryRenderCachedPlaylist(reason) {
        const cached = this.loadCachedPlaylist();
        if (!cached || !cached.playlist || !cached.playlist.items || cached.playlist.items.length === 0) {
            return false;
        }
        const savedAt = cached.savedAt ? new Date(cached.savedAt).toISOString() : 'unknown time';
        logger.info(`Rendering cached playlist (${reason}) with ${cached.playlist.items.length} items saved at ${savedAt}`);
        this.cancelCurrentPlayback();
        this.renderPlaylist(cached.playlist);
        this.currentContent = cached.playlist;
        this.lastContentSignature = cached.signature || null;
        return true;
    },
    clearPlaylistCache() {
        try {
            localStorage.removeItem('contentCache');
        }
        catch (error) {
            logger.warn('Failed to clear playlist cache:', error);
        }
    },
    // Handle device deletion - cleanup and return to pairing
    handleDeviceDeleted() {
        logger.info('Device was deleted. Cleaning up and returning to pairing...');
        // Stop all polling and intervals
        this.destroy();
        // Clear device info from storage
        if (typeof localStorage !== 'undefined') {
            localStorage.removeItem('deviceId');
            localStorage.removeItem('deviceName');
        }
        // Reset device info
        this.deviceId = null;
        this.deviceName = null;
        this.resellerBrandingLogoUrl = null;
        // Show idle screen with message
        this.showIdleScreen();
        // Restart pairing after a short delay
        setTimeout(() => {
            if (typeof Pairing !== 'undefined') {
                location.reload(); // Reload to restart pairing process
            }
        }, 3000);
    },
    // ── BLE Rule override ──────────────────────────────────────────────────
    // Pre-download content for all enabled rules so it plays instantly when triggered.
    preloadRulesContent(rules) {
        if (!rules || !rules.length) return;
        const token = this.deviceToken || localStorage.getItem('deviceToken') || '';
        for (const rule of rules) {
            if (!rule.enabled || !rule.action) continue;
            try {
                if (rule.action.type === 'play_playlist' && rule.action.playlistId) {
                    API.getPlaylistById(rule.action.playlistId, token)
                        .then(playlist => {
                            const normalized = API._normalizePlaylist(playlist, token);
                            if (normalized && normalized.items && normalized.items.length > 0) {
                                ContentManager.downloadPlaylist(normalized)
                                    .then(() => logger.info('[BLE] Pre-cached playlist for rule:', rule.name))
                                    .catch(e => logger.warn('[BLE] Pre-cache playlist failed:', e));
                            }
                        })
                        .catch(e => logger.warn('[BLE] Pre-cache fetch playlist failed:', e));
                } else if (rule.action.type === 'play_content' && rule.action.contentId) {
                    API.getContentById(rule.action.contentId, token)
                        .then(content => {
                            const normalized = API._normalizeSingleContent(content, 'BLE Rule', token);
                            if (normalized && normalized.items && normalized.items.length > 0) {
                                ContentManager.downloadPlaylist(normalized)
                                    .then(() => logger.info('[BLE] Pre-cached content for rule:', rule.name))
                                    .catch(e => logger.warn('[BLE] Pre-cache content failed:', e));
                            }
                        })
                        .catch(e => logger.warn('[BLE] Pre-cache fetch content failed:', e));
                }
            } catch (e) {
                logger.warn('[BLE] preloadRulesContent error for rule', rule.name, e);
            }
        }
    },
    // Called by BleManager when a proximity rule matches.
    // Fetches the rule's target playlist/content and starts playing it
    // immediately, bypassing the normal schedule until the beacon leaves.
    overridePlaylistForRule(ruleId, playlistId, contentId) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                logger.info('[BLE] Applying rule override: ruleId=' + ruleId +
                    ', playlistId=' + playlistId + ', contentId=' + contentId);
                const token = this.deviceToken || localStorage.getItem('deviceToken') || '';
                // Save the currently-playing content so we can restore it instantly
                // when the rule ends. Only save if we are NOT already in an override
                // (switching between rules should keep the original pre-rule content).
                if (!this._bleOverrideContent && this.currentContent) {
                    this._preOverrideContent = this.currentContent;
                    this._preOverrideSignature = this.lastContentSignature;
                    logger.info('[BLE] Saved pre-override content for restore: ' +
                        (this.currentContent.playlistName || '(unnamed)'));
                }
                let overrideContent = null;
                if (playlistId) {
                    const playlist = yield API.getPlaylistById(playlistId, token);
                    overrideContent = API._normalizePlaylist(playlist, token);
                } else if (contentId) {
                    const content = yield API.getContentById(contentId, token);
                    overrideContent = API._normalizeSingleContent(content, 'BLE Rule', token);
                }
                if (!overrideContent || !overrideContent.items || overrideContent.items.length === 0) {
                    logger.warn('[BLE] overridePlaylistForRule: no content resolved for rule ' + ruleId);
                    return;
                }
                this._bleOverrideContent = overrideContent;
                // Clear signature cache so loadContent doesn't skip the new content
                this.lastContentSignature = null;
                this.pendingSignature = null;
                this._loadInFlight = false;
                yield this.loadContent();
            }
            catch (e) {
                logger.error('[BLE] overridePlaylistForRule error:', e);
            }
        });
    },
    // Called by BleManager when no rule is active (beacon left the zone).
    // Reverts to the normal schedule.
    clearRuleOverride() {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                logger.info('[BLE] Clearing rule override, reverting to normal schedule');
                this._bleOverrideContent = null;
                // Grab the saved pre-rule content (if any) and clear the saved refs
                const restore = this._preOverrideContent;
                const restoreSig = this._preOverrideSignature;
                this._preOverrideContent = null;
                this._preOverrideSignature = null;
                this.lastContentSignature = null;
                this.pendingSignature = null;
                this._loadInFlight = false;
                if (restore && restore.items && restore.items.length > 0) {
                    // Instantly swap back — content is already on disk, no re-download needed
                    logger.info('[BLE] Restoring pre-override content: ' +
                        (restore.playlistName || '(unnamed)'));
                    this.pendingPlaylist = restore;
                    this.pendingSignature = restoreSig || this.getContentSignature(restore);
                    this.trySwapToPendingContent(true);
                    // Background refresh: if the schedule changed while the rule was
                    // active, loadContent() will detect the new signature and swap.
                    void this.loadContent();
                } else {
                    // No saved pre-override content (e.g. device booted straight into a
                    // rule) — fetch fresh from the API
                    yield this.loadContent();
                }
            }
            catch (e) {
                logger.error('[BLE] clearRuleOverride error:', e);
            }
        });
    },
    // Cleanup
    destroy() {
        if (this.heartbeatInterval)
            clearInterval(this.heartbeatInterval);
        if (this.telemetryInterval)
            clearInterval(this.telemetryInterval);
        if (this.commandPollInterval)
            clearInterval(this.commandPollInterval);
        if (this.contentRefreshInterval)
            clearInterval(this.contentRefreshInterval);
        if (this.logStreamInterval)
            clearInterval(this.logStreamInterval);
        if (this.wsConnection)
            this.wsConnection.close();
        // Stop AVPlay if active
        try {
            if (typeof webapis !== 'undefined' && webapis.avplay) {
                webapis.avplay.stop();
                webapis.avplay.close();
            }
        }
        catch (error) {
            logger.warn('Error stopping AVPlay:', error);
        }
    }
};
// Export to window
window.Player = Player;
// BLE manager references the player as NexariPlayer
window.NexariPlayer = Player;
