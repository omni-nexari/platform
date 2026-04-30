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
const Player = {
    deviceId: null,
    deviceName: null,
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
    isSyncPlaying: false,
    isSyncStarting: false,
    syncCoordinationInProgress: false,
    syncCoordinationSignature: null,
    syncPlayMode: 'none',
    syncPlayListener: null,
    syncplayBackend: null,
    /** Watchdog timer that recovers state if SYNC_PLAY_START_DONE never fires. */
    syncStartWatchdog: null,
    /** Timestamp of last createPlaylist failure; used to rate-limit retries (skip for 2 min after failure). */
    syncplayCreateListFailedAt: 0,
    deviceToken: null,
    _scannedMdcId: null, // MDC device ID found by scan; persisted to DB once WS is open
    _mdcStartupDone: false, // Set to true once Phase 1 ID scan completes; gates sendMdcHeartbeat
    _mdcHeartbeatInFlight: false, // Prevents concurrent MDC heartbeat TCP connections
    _mdcPhase2InFlight: 0, // Count of in-flight Phase 2 MDC commands; heartbeat waits until 0
    _lastMdcHeartbeatAt: 0, // Timestamp of last MDC heartbeat; rate-limit to CONFIG.HEARTBEAT_INTERVAL
    _luxSupported: true, // Set to false after first NAK; skips light_sensor_get in subsequent polls
    _onTimerSupported: true, // Set to false after first NAK; skips on_timer_get in subsequent polls
    _clockSupported: true, // Set to false after first NAK; skips get_clock / set_clock
    _liveCaptureActive: false, // live-view capture running
    _liveCaptureIntervalMs: 1000, // requested cadence
    _liveCaptureBusy: false, // captureScreen in progress — prevents overlapping calls
    _liveInterval: undefined, // setTimeout handle (NOT setInterval — Samsung captureScreen cannot overlap)
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
    // Multi-backend document support: B2BDoc (Tizen 4), webapis.document (Tizen 6.5+), PDF.js (Tizen 5–6.4)
    documentBackend: null,
    b2bDocInstance: null,
    nativeDocOpen: false,
    b2bDocAutoFlipIntervalMs: 10000,
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
            // Load initial content
            yield this.loadContent();
            // Setup refresh interval
            this.startContentRefresh();
            this.startLogStream();
            // Phase 2 MDC setup — apply initial display settings, persist MDC ID to DB
            setTimeout(() => { this.runPostPairingMdcSetup(); }, 5000);
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
            logger.info('Connecting to WebSocket:', wsUrl);
            this.wsConnection = new WebSocket(wsUrl);
            this.wsConnection.onopen = () => {
                logger.info('WebSocket connected');
                this.lastWsMessageAt = Date.now();
                this.updateConnectionStatus(true);
                void Telemetry.send(this.deviceId).catch((error) => {
                    logger.warn('Initial WebSocket telemetry failed:', error);
                });
                // Refresh MDC poll after startup MDC setup completes (Phase 1 scan can take up to 8s)
                setTimeout(() => { this.runMdcPoll(); }, 20000);
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
                    this.handleSyncPlayCommand(message.payload);
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
                case 'reboot':
                    logger.info('reboot command received');
                    this.executeCommand({ type: 'REBOOT' });
                    break;
                case 'relaunch_app':
                    logger.info('relaunch_app command received');
                    this.executeCommand({ type: 'RELAUNCH_APP' });
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
                case 'screenshot':
                    logger.info('screenshot command received');
                    this.executeCommand({ type: 'SCREENSHOT' });
                    break;
                case 'screenshot_auto':
                    logger.info('screenshot_auto command received');
                    this.executeCommand({ type: 'SCREENSHOT_AUTO' });
                    break;
                case 'start_live_capture': {
                    const intervalMs = Math.max(1000, Number((_a = message.payload) === null || _a === void 0 ? void 0 : _a.intervalMs) || 1000);
                    logger.info('start_live_capture received, intervalMs:', intervalMs);
                    // Stop any existing capture loop
                    if (this._liveInterval) {
                        clearTimeout(this._liveInterval);
                        this._liveInterval = undefined;
                    }
                    this._liveCaptureActive = true;
                    this._liveCaptureIntervalMs = intervalMs;
                    this._liveCaptureBusy = false;
                    // Use setTimeout chaining (NOT setInterval) — Samsung captureScreen cannot handle
                    // concurrent calls; each capture must complete before the next is scheduled.
                    const self = this;
                    const scheduleNext = (delayMs) => {
                        self._liveInterval = setTimeout(function liveTick() {
                            if (!self._liveCaptureActive)
                                return;
                            if (self._liveCaptureBusy) {
                                scheduleNext(200);
                                return;
                            }
                            self._liveCaptureBusy = true;
                            const ws = self.wsConnection;
                            if (!ws || ws.readyState !== WebSocket.OPEN) {
                                self._liveCaptureBusy = false;
                                scheduleNext(Math.max(1000, self._liveCaptureIntervalMs));
                                return;
                            }
                            const done = () => {
                                self._liveCaptureBusy = false;
                                if (self._liveCaptureActive)
                                    scheduleNext(Math.max(1000, self._liveCaptureIntervalMs));
                            };
                            const send = (dataBase64) => {
                                ws.send(JSON.stringify({ type: 'screenshot_data', payload: { dataBase64, trigger: 'live', contentId: null } }));
                                done();
                            };
                            const canvasFallback = () => {
                                try {
                                    const canvas = document.createElement('canvas');
                                    canvas.width = window.innerWidth || 1920;
                                    canvas.height = window.innerHeight || 1080;
                                    const ctx = canvas.getContext('2d');
                                    if (!ctx)
                                        throw new Error('No 2d context');
                                    ctx.fillStyle = '#000';
                                    ctx.fillRect(0, 0, canvas.width, canvas.height);
                                    const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
                                    const base64 = dataUrl.split(',')[1];
                                    send(base64);
                                }
                                catch (canvasErr) {
                                    logger.warn('[LiveCapture] canvas fallback failed:', canvasErr);
                                    done();
                                }
                            };
                            try {
                                const b2b = typeof window.b2bapis !== 'undefined' ? window.b2bapis.b2bcontrol : null;
                                if (b2b && typeof b2b.captureScreen === 'function') {
                                    b2b.captureScreen((filePath) => {
                                        try {
                                            const normalizedPath = String(filePath || '').replace(/^file:\/\//, '');
                                            const platform = window.Platform;
                                            if (platform && platform.isLegacy) {
                                                // Tizen 4: use filesystem.resolve + openStream
                                                window.tizen.filesystem.resolve(normalizedPath, (file) => {
                                                    file.openStream('r', (stream) => {
                                                        try {
                                                            const bytes = stream.readBytes(file.fileSize);
                                                            stream.close();
                                                            let binary = '';
                                                            for (let i = 0; i < bytes.length; i++)
                                                                binary += String.fromCharCode(bytes[i]);
                                                            send(btoa(binary));
                                                        }
                                                        catch (e) {
                                                            logger.warn('[LiveCapture] read stream bytes failed:', e);
                                                            done();
                                                        }
                                                    }, (e) => { logger.warn('[LiveCapture] openStream error:', e); done(); }, 'ISO-8859-1');
                                                }, (e) => { logger.warn('[LiveCapture] filesystem.resolve failed:', e); done(); }, 'r');
                                            }
                                            else {
                                                const fh = window.tizen.filesystem.openFile(normalizedPath, 'r');
                                                try {
                                                    const bytes = fh.readData();
                                                    let binary = '';
                                                    for (let i = 0; i < bytes.length; i++)
                                                        binary += String.fromCharCode(bytes[i]);
                                                    send(btoa(binary));
                                                }
                                                finally {
                                                    try {
                                                        fh.close();
                                                    }
                                                    catch (_) { }
                                                }
                                            }
                                        }
                                        catch (e) {
                                            logger.warn('[LiveCapture] filesystem failed:', e);
                                            canvasFallback(); // b2b captured but read failed — send canvas frame
                                        }
                                    }, (e) => {
                                        logger.warn('[LiveCapture] captureScreen error:', e);
                                        canvasFallback(); // b2b error callback — send canvas frame instead of nothing
                                    });
                                    return;
                                }
                            }
                            catch (e) {
                                logger.warn('[LiveCapture] b2b threw:', e);
                            }
                            // b2b API unavailable — canvas fallback (captures DOM/2D content, not HW-decoded video)
                            canvasFallback();
                        }, delayMs);
                    };
                    scheduleNext(0);
                    break;
                }
                case 'stop_live_capture':
                    logger.info('stop_live_capture received');
                    if (this._liveInterval) {
                        clearTimeout(this._liveInterval);
                        this._liveInterval = undefined;
                    }
                    this._liveCaptureActive = false;
                    this._liveCaptureBusy = false;
                    break;
                case 'update_player':
                    logger.info('update_player command received:', message.payload);
                    if (typeof AppUpdater !== 'undefined') {
                        AppUpdater.handle(Object.assign({ type: 'APP_UPDATE' }, message), (statusType, data) => {
                            if (this.wsConnection && this.wsConnection.readyState === this.wsConnection.OPEN) {
                                this.wsConnection.send(JSON.stringify(Object.assign({ type: statusType, deviceId: this.deviceId }, (data || {}))));
                            }
                        });
                    }
                    break;
                case 'remote_key': {
                    const keyName = ((_c = (_b = message.payload) === null || _b === void 0 ? void 0 : _b.key) !== null && _c !== void 0 ? _c : '');
                    logger.info('remote_key received:', keyName);
                    const xhr = new XMLHttpRequest();
                    xhr.open('POST', 'http://127.0.0.1:9615/remote-key', true);
                    xhr.setRequestHeader('Content-Type', 'application/json');
                    xhr.timeout = 5000;
                    xhr.onload = function () {
                        try {
                            const d = JSON.parse(xhr.responseText);
                            if (d.ok)
                                logger.info('[mdc-bridge] remote_key ok:', keyName);
                            else
                                logger.warn('[mdc-bridge] remote_key NAK:', d.error);
                        }
                        catch (e) {
                            logger.warn('[mdc-bridge] remote_key parse error');
                        }
                    };
                    xhr.onerror = function () { logger.error('[mdc-bridge] remote_key XHR error - is Node server running?'); };
                    xhr.ontimeout = function () { logger.error('[mdc-bridge] remote_key timeout'); };
                    xhr.send(JSON.stringify({ key: keyName }));
                    break;
                }
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
                case 'set_screenshot_interval':
                case 'set_zones':
                case 'update_tv_firmware':
                    logger.info(`Command received: ${messageType}`, message.payload);
                    this.executeCommand({ type: messageType.toUpperCase().replace(/-/g, '_'), payload: message.payload });
                    break;
                case 'mdc_control': {
                    const mdcPayload = message.payload;
                    if (mdcPayload && typeof mdcPayload.action === 'string') {
                        const requestId = typeof mdcPayload.requestId === 'string' ? mdcPayload.requestId : null;
                        const action = mdcPayload.action;
                        const self = this;
                        function sendMdcControlResponse(payload) {
                            const replyWs = self.wsConnection;
                            if (requestId && replyWs && replyWs.readyState === WebSocket.OPEN) {
                                replyWs.send(JSON.stringify({
                                    type: 'mdc_control_response',
                                    payload: Object.assign({ requestId }, payload),
                                }));
                                logger.info('[mdc-bridge] mdc_control_response sent:', action, 'ok=', payload.ok);
                            }
                            else {
                                logger.warn('[mdc-bridge] WS not open, cannot send mdc_control_response back', {
                                    readyState: replyWs === null || replyWs === void 0 ? void 0 : replyWs.readyState,
                                    action,
                                    requestId,
                                });
                            }
                        }
                        const xhr = new XMLHttpRequest();
                        xhr.open('POST', 'http://127.0.0.1:9615/mdc-control', true);
                        xhr.setRequestHeader('Content-Type', 'application/json');
                        // mdc_id_scan and mdc_conn_type_fix scan up to 10 IDs × 500ms each = ~5s;
                        // give a generous budget so the XHR never races the scan to timeout.
                        xhr.timeout = (action === 'mdc_id_scan' || action === 'mdc_conn_type_fix') ? 15000 : 10000;
                        xhr.onload = function () {
                            try {
                                const response = JSON.parse(xhr.responseText);
                                if (response.ok)
                                    logger.info('[mdc-bridge] mdc_control ok:', action);
                                else
                                    logger.warn('[mdc-bridge] mdc_control error:', response.error);
                                // Forward the full bridge response so fields like urlAddress, serial, etc. reach the API
                                const { ok } = response, rest = __rest(response, ["ok"]);
                                sendMdcControlResponse(Object.assign({ ok: !!ok }, rest));
                            }
                            catch (error) {
                                logger.warn('[mdc-bridge] mdc_control parse error', error);
                                sendMdcControlResponse({ ok: false, error: 'parse error' });
                            }
                        };
                        xhr.onerror = function () {
                            logger.error('[mdc-bridge] mdc_control XHR error - is Node bridge running?');
                            sendMdcControlResponse({ ok: false, error: 'XHR error' });
                        };
                        xhr.ontimeout = function () {
                            logger.error('[mdc-bridge] mdc_control timeout');
                            sendMdcControlResponse({ ok: false, error: 'timeout' });
                        };
                        xhr.send(JSON.stringify(mdcPayload));
                    }
                    break;
                }
                case 'remote_status': {
                    // Call /status-full to aggregate status, serial, device-name, model, IP and remote-ctrl
                    // in a single round-trip (server.js performs the MDC commands sequentially).
                    const rsRequestId = (_d = message.payload) === null || _d === void 0 ? void 0 : _d.requestId;
                    const rsWs = this.wsConnection;
                    function sendMdcStatusResponse(payload) {
                        if (rsRequestId && rsWs && rsWs.readyState === WebSocket.OPEN) {
                            rsWs.send(JSON.stringify({ type: 'mdc_status', payload: Object.assign({ requestId: rsRequestId }, payload) }));
                        }
                    }
                    const rsXhr = new XMLHttpRequest();
                    rsXhr.open('GET', 'http://127.0.0.1:9615/status-full', true);
                    rsXhr.timeout = 20000; // sequential MDC calls can take ~3s each × 6
                    rsXhr.onload = function () {
                        try {
                            const res = JSON.parse(rsXhr.responseText);
                            sendMdcStatusResponse(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign({ ok: !!res.ok, nodeRunning: true }, (res.status !== undefined ? { status: res.status } : {})), (res.serial !== undefined ? { serial: res.serial } : {})), (res.deviceName !== undefined ? { deviceName: res.deviceName } : {})), (res.modelName !== undefined ? { modelName: res.modelName } : {})), (res.ipAddress !== undefined ? { ipAddress: res.ipAddress } : {})), (res.remoteControl !== undefined ? { remoteControl: res.remoteControl } : {})), (res.rawHex !== undefined ? { rawHex: res.rawHex } : {})), (res.error !== undefined ? { error: res.error } : {})));
                        }
                        catch (_e) {
                            sendMdcStatusResponse({ ok: false, nodeRunning: true, error: 'parse error' });
                        }
                    };
                    rsXhr.onerror = function () {
                        sendMdcStatusResponse({ ok: false, nodeRunning: true, error: 'MDC bridge XHR error' });
                    };
                    rsXhr.ontimeout = function () {
                        sendMdcStatusResponse({ ok: false, nodeRunning: true, error: 'MDC bridge timeout' });
                    };
                    rsXhr.send();
                    break;
                }
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
    },
    // Start heartbeat
    startHeartbeat() {
        // Heartbeat is sent via WebSocket only — no HTTP call
        this.heartbeatInterval = setInterval(() => {
            this.sendWebSocketHeartbeat();
        }, CONFIG.HEARTBEAT_INTERVAL);
    },
    // Build readiness payload for orchestration/readiness UI
    buildReadinessPayload() {
        var _a, _b;
        const folderId = this.getCurrentFolderId();
        const downloadPct = Math.max(0, Math.min(100, (_a = this.lastDownloadProgress) !== null && _a !== void 0 ? _a : 0));
        // Legacy sync-orchestration removed. Keep a lightweight readiness model.
        const avState = this.syncPlayMode === 'native' && ((_b = this.isSyncplayAvailable) === null || _b === void 0 ? void 0 : _b.call(this)) && this.isSyncPlaying
            ? 'SYNCPLAY'
            : this.currentItem
                ? 'PLAYING'
                : 'IDLE';
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
    setAvPlayVisualMode(active) {
        const root = document.documentElement;
        const body = document.body;
        const playerScreen = document.getElementById('player-screen');
        const contentContainer = document.getElementById('content-container');
        const transparent = active ? 'transparent' : '';
        if (body) {
            body.classList.toggle('avplay-active', active);
            body.style.background = transparent;
            body.style.backgroundColor = transparent;
        }
        if (root) {
            root.style.background = transparent;
            root.style.backgroundColor = transparent;
        }
        if (playerScreen) {
            playerScreen.style.background = transparent;
            playerScreen.style.backgroundColor = transparent;
        }
        if (contentContainer) {
            contentContainer.style.background = transparent;
            contentContainer.style.backgroundColor = transparent;
            contentContainer.style.visibility = active ? 'hidden' : '';
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
            // Fire MDC status_get and send mdc_heartbeat (non-blocking)
            this.sendMdcHeartbeat();
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
            // Run full MDC poll after each telemetry cycle
            this.runMdcPoll();
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
    // ── MDC helpers ───────────────────────────────────────────────────────────
    // XHR to local server.js MDC bridge, returns a Promise
    sendLocalMdcXhr(action, payload = {}) {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('POST', 'http://127.0.0.1:9615/mdc-control', true);
            xhr.setRequestHeader('Content-Type', 'application/json');
            // Scan actions probe up to 10 IDs × 500ms each ≈ 5s; give a generous budget.
            xhr.timeout = (action === 'mdc_id_scan' || action === 'mdc_conn_type_fix') ? 15000 : 8000;
            xhr.onload = function () {
                try {
                    resolve(JSON.parse(xhr.responseText));
                }
                catch (_a) {
                    reject(new Error('parse error'));
                }
            };
            xhr.onerror = function () { reject(new Error('XHR error')); };
            xhr.ontimeout = function () { reject(new Error('timeout')); };
            xhr.send(JSON.stringify(Object.assign({ action }, payload)));
        });
    },
    // Phase 1: run at startup (app.js), before pairing — no WS/deviceId needed
    runStartupMdcSetup() {
        logger.info('[mdc-startup] Phase 1: conn type, ID scan, network standby...');
        const self = this;
        self.sendLocalMdcXhr('mdc_conn_type_set', { value: 1 })
            .then((r) => { logger.info('[mdc-startup] conn type RJ45:', r.ok); })
            .catch(() => { });
        self.sendLocalMdcXhr('mdc_id_scan')
            .then((r) => {
            if (r.ok) {
                logger.info('[mdc-startup] MDC ID found:', r.displayId);
                self._scannedMdcId = typeof r.displayId === 'number' ? r.displayId : null;
            }
            else {
                logger.warn('[mdc-startup] MDC ID scan failed:', r.error);
            }
            self._mdcStartupDone = true;
        })
            .catch(() => { self._mdcStartupDone = true; /* non-blocking */ });
        self.sendLocalMdcXhr('network_standby_set', { value: 1 })
            .then((r) => { logger.info('[mdc-startup] network standby ON:', r.ok); })
            .catch(() => { });
    },
    // Phase 2: run after pairing + WS connected — persists MDC ID, sets display state
    // Commands are run sequentially (not concurrently) so Samsung MDC firmware never
    // sees more than one TCP connection at a time on port 1515.
    runPostPairingMdcSetup() {
        const ws = this.wsConnection;
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            setTimeout(() => { this.runPostPairingMdcSetup(); }, 3000);
            return;
        }
        logger.info('[mdc-startup] Phase 2: persisting MDC ID, network standby on, standby off, OSD overlays off...');
        const self = this;
        if (self._scannedMdcId != null) {
            ws.send(JSON.stringify({ type: 'mdc_id_persist', payload: { mdcId: self._scannedMdcId } }));
            logger.info('[mdc-startup] mdc_id_persist sent, mdcId=', self._scannedMdcId);
        }
        // Build sequential command list — one MDC TCP connection at a time
        const phase2Commands = [
            ['network_standby_set', { value: 1 }],
            ['standby_set', { value: 0 }],
            ['osd_display_set', { osdType: 0, osdOnOff: 0 }],
            ['osd_display_set', { osdType: 2, osdOnOff: 0 }],
            ['osd_display_set', { osdType: 3, osdOnOff: 0 }],
            ['osd_display_set', { osdType: 4, osdOnOff: 0 }],
        ];
        self._mdcPhase2InFlight = phase2Commands.length;
        function runNext(idx) {
            if (idx >= phase2Commands.length)
                return;
            const [action, payload] = phase2Commands[idx];
            self.sendLocalMdcXhr(action, payload)
                .then((r) => { logger.info('[mdc-startup] phase2', action, 'ok:', r.ok); })
                .catch(() => { })
                .then(() => {
                self._mdcPhase2InFlight = Math.max(0, self._mdcPhase2InFlight - 1);
                runNext(idx + 1);
            });
        }
        runNext(0);
    },
    // Phase 3 (every 30s): get MDC status → send mdc_heartbeat WS message
    sendMdcHeartbeat() {
        if (!this._mdcStartupDone)
            return; // Wait until Phase 1 ID scan completes
        if (this._mdcHeartbeatInFlight)
            return; // Never overlap — Samsung firmware allows only one MDC TCP conn
        if (this._mdcPhase2InFlight > 0)
            return; // Wait for Phase 2 sequential commands to complete
        const now = Date.now();
        if (now - this._lastMdcHeartbeatAt < (CONFIG.HEARTBEAT_INTERVAL || 30000))
            return; // rate-limit
        const ws = this.wsConnection;
        if (!ws || ws.readyState !== WebSocket.OPEN)
            return;
        this._mdcHeartbeatInFlight = true;
        this._lastMdcHeartbeatAt = now;
        this.sendLocalMdcXhr('status_get')
            .then((r) => {
            if (!r.ok || !r.status)
                return;
            if (ws.readyState !== WebSocket.OPEN)
                return;
            const s = r.status;
            ws.send(JSON.stringify({
                type: 'mdc_heartbeat',
                payload: { power: s.power, volume: s.volume, mute: s.mute, input: s.input },
            }));
        })
            .catch(() => { })
            .then(() => { this._mdcHeartbeatInFlight = false; });
    },
    // Phase 4 (every 5min): run all MDC GETs → send mdc_poll WS message
    runMdcPoll() {
        const ws = this.wsConnection;
        if (!ws || ws.readyState !== WebSocket.OPEN)
            return;
        // Sync panel HW RTC to device (web) time every poll — fire-and-forget
        if (this._clockSupported) {
            this.sendLocalMdcXhr('set_clock', {})
                .then((r) => {
                if (r.supported === false) {
                    this._clockSupported = false;
                    logger.info('[mdc-clock] set_clock not supported on this model');
                }
                else {
                    logger.debug('[mdc-clock] HW clock sync:', r.ok);
                }
            })
                .catch(() => { });
        }
        const commands = [
            'standby_get', 'osd_display_get', 'network_standby_get',
            'menu_orientation_get', 'src_orientation_get',
            'remote_control_get', 'safety_lock_get', 'sw_version_get', 'display_status_get',
            'url_launcher_address_get',
            ...(this._clockSupported ? ['get_clock'] : []),
            ...(this._luxSupported ? ['light_sensor_get'] : []),
            ...(this._onTimerSupported ? ['on_timer_get'] : []),
        ];
        const TIMER_SLOTS = [1, 2, 3, 4, 5, 6, 7];
        const results = {};
        const self = this;
        // Build flat sequence: 9 GET actions + 7 on_timer_get slots
        // Run SEQUENTIALLY — Samsung MDC firmware allows only one TCP connection
        // at a time on port 1515; the server-side queue serialises them, but
        // concurrent XHRs can time-out while waiting in that queue.
        const sequence = [
            ...commands.map(a => ({ action: a, key: a })),
            ...TIMER_SLOTS.map(s => ({ action: 'on_timer_get', key: `timer_${s}`, payload: { slot: s } })),
        ];
        function runNext(idx) {
            var _a, _b, _c, _d, _f;
            if (idx >= sequence.length) {
                // All done — build and send mdc_poll
                if (ws.readyState !== WebSocket.OPEN)
                    return;
                const p = {};
                if (((_a = results.standby_get) === null || _a === void 0 ? void 0 : _a.ok) && results.standby_get.data)
                    p.standby = results.standby_get.data[0];
                if (((_b = results.osd_display_get) === null || _b === void 0 ? void 0 : _b.ok) && results.osd_display_get.data)
                    p.osdStatus = results.osd_display_get.data[0];
                if (((_c = results.network_standby_get) === null || _c === void 0 ? void 0 : _c.ok) && results.network_standby_get.data)
                    p.networkStandby = results.network_standby_get.data[0];
                const mo = results.menu_orientation_get;
                if ((mo === null || mo === void 0 ? void 0 : mo.ok) && mo.data && mo.data.length >= 2)
                    p.menuOrientation = mo.data[1];
                const so = results.src_orientation_get;
                p.srcOrientation = ((so === null || so === void 0 ? void 0 : so.ok) && so.data && so.data.length >= 2) ? so.data[1] : null;
                if (((_d = results.remote_control_get) === null || _d === void 0 ? void 0 : _d.ok) && results.remote_control_get.data)
                    p.remoteControl = results.remote_control_get.data[0];
                if (((_f = results.safety_lock_get) === null || _f === void 0 ? void 0 : _f.ok) && results.safety_lock_get.data)
                    p.safetyLock = results.safety_lock_get.data[0];
                const sw = results.sw_version_get;
                if ((sw === null || sw === void 0 ? void 0 : sw.ok) && sw.data) {
                    p.softwareVersion = sw.data.filter(b => b > 0).map(b => String.fromCharCode(b)).join('').trim() || null;
                }
                const ds = results.display_status_get;
                if ((ds === null || ds === void 0 ? void 0 : ds.ok) && ds.data && ds.data[4] != null)
                    p.temperatureC = ds.data[4];
                const urlR = results.url_launcher_address_get;
                if ((urlR === null || urlR === void 0 ? void 0 : urlR.ok) && urlR.data) {
                    const bytes = urlR.data;
                    const offset = bytes.length > 0 && bytes[0] === 0x82 ? 1 : 0;
                    const addr = bytes.slice(offset).filter(b => b > 0).map(b => String.fromCharCode(b)).join('');
                    if (addr)
                        p.urlLauncherAddress = addr;
                }
                const luxR = results.light_sensor_get;
                if (luxR) {
                    if (luxR.ok && typeof luxR.lux === 'number') {
                        p.luxValue = luxR.lux;
                    }
                    else if (luxR.supported === false) {
                        self._luxSupported = false; // skip on all future polls
                        logger.info('[mdc-poll] light sensor not supported on this model');
                    }
                }
                const clkR = results.get_clock;
                if (clkR) {
                    if (clkR.ok && typeof clkR.time === 'string') {
                        p.hwClock = clkR.time;
                    }
                    else if (clkR.supported === false) {
                        self._clockSupported = false;
                        logger.info('[mdc-poll] get_clock not supported on this model');
                    }
                }
                // Check if any on_timer_get NAKed — disable all slots permanently
                if (self._onTimerSupported) {
                    const anyTimerNak = TIMER_SLOTS.some(s => { var _a; return ((_a = results[`timer_${s}`]) === null || _a === void 0 ? void 0 : _a.supported) === false; });
                    if (anyTimerNak) {
                        self._onTimerSupported = false;
                        logger.info('[mdc-poll] on_timer_get not supported on this model');
                    }
                }
                p.timers = TIMER_SLOTS.map((s) => {
                    var _a, _b, _c, _d, _f, _g, _h, _j;
                    const r = results[`timer_${s}`];
                    if (!(r === null || r === void 0 ? void 0 : r.ok))
                        return null;
                    return {
                        onHour: Number((_a = r.onHour) !== null && _a !== void 0 ? _a : 0), onMin: Number((_b = r.onMin) !== null && _b !== void 0 ? _b : 0), onEnable: !!r.onEnable,
                        offHour: Number((_c = r.offHour) !== null && _c !== void 0 ? _c : 0), offMin: Number((_d = r.offMin) !== null && _d !== void 0 ? _d : 0), offEnable: !!r.offEnable,
                        repeat: Number((_f = r.repeat) !== null && _f !== void 0 ? _f : 1), volume: Number((_g = r.volume) !== null && _g !== void 0 ? _g : 20),
                        source: Number((_h = r.source) !== null && _h !== void 0 ? _h : 0x01), manualDays: Number((_j = r.manualDays) !== null && _j !== void 0 ? _j : 0),
                    };
                });
                ws.send(JSON.stringify({ type: 'mdc_poll', payload: p }));
                logger.debug('[mdc-poll] mdc_poll sent');
                return;
            }
            const { action, key, payload } = sequence[idx];
            self.sendLocalMdcXhr(action, payload || {})
                .then((r) => { results[key] = r; })
                .catch(() => { results[key] = { ok: false }; })
                .then(() => { runNext(idx + 1); });
        }
        runNext(0);
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
        this.renderPlaylist(playlistToPlay);
        this.currentContent = playlistToPlay;
        this.lastContentSignature = signatureToSet;
        this.cachePlaylist(playlistToPlay, signatureToSet);
        // Take a screenshot a few seconds after the new content starts rendering
        // so the device card thumbnail reflects the current content.
        setTimeout(() => { this.takeScreenshotWithTrigger('content_change'); }, 8000);
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
                // Show idle screen with download progress if nothing is playing
                if (!this.currentContent) {
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
                // If something is currently playing, defer the swap to the next natural
                // item-boundary so playback is never interrupted mid-item (which would
                // cause a black screen). The playlist controllers already call
                // trySwapToPendingContent at every item transition.
                // If nothing is playing (e.g. first boot / idle screen), swap immediately.
                const currentlyPlaying = (this.currentPlaylistController && !this.currentPlaylistController.cancelled) ||
                    this._zoneMode ||
                    (this.syncPlayMode === 'native' && this.isSyncPlaying);
                if (currentlyPlaying) {
                    logger.info('Pending playlist ready; will swap at next item boundary to avoid black screen');
                }
                else {
                    logger.info('Nothing currently playing; swapping to new content immediately');
                    this.trySwapToPendingContent(true);
                }
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
            var _a, _b, _c, _d, _f, _g, _h, _j;
            if (this._loadInFlight) {
                logger.debug('loadContent skipped (already in flight)');
                return;
            }
            this._loadInFlight = true;
            try {
                logger.info('Loading content...');
                const content = yield API.getCurrentContent(this.deviceId, this.deviceToken);
                if (content && content.items && content.items.length > 0) {
                    const newSignature = this.getContentSignature(content);
                    const isLegacyPlaying = this.currentPlaylistController && !this.currentPlaylistController.cancelled;
                    const isNativeSyncPlaying = this.syncPlayMode === 'native' && ((_a = this.isSyncplayAvailable) === null || _a === void 0 ? void 0 : _a.call(this)) && this.isSyncPlaying;
                    const isPlaying = !!(isLegacyPlaying || isNativeSyncPlaying || this._zoneMode);
                    logger.info(`Content signature: ${newSignature}, Last: ${this.lastContentSignature}`);
                    logger.info(`Currently playing: ${isPlaying}`);
                    // Samsung SyncPlay (per playlist) - entire playlist.
                    // When enabled, do NOT use legacy sync-group orchestration.
                    const wantsSamsungSyncPlay = !!(content.syncPlay && content.syncPlay.enabled);
                    if (wantsSamsungSyncPlay) {
                        const hasNested = (content.items || []).some((it) => !!it.nestedPlaylistId);
                        const allVideoOrImage = (content.items || []).every((it) => {
                            var _a;
                            const t = String(((_a = it === null || it === void 0 ? void 0 : it.content) === null || _a === void 0 ? void 0 : _a.type) || '').toUpperCase();
                            return t === 'VIDEO' || t === 'IMAGE';
                        });
                        if (hasNested || !allVideoOrImage) {
                            logger.warn('Samsung SyncPlay enabled but playlist is incompatible; falling back to regular playback', {
                                hasNested,
                                allVideoOrImage,
                            });
                        }
                        else {
                            logger.info(`Samsung SyncPlay enabled for playlist: ${content.playlistName}`);
                            const desiredGroupID = Number.isFinite(Number(content.syncPlay.groupID)) ? Number(content.syncPlay.groupID) : 5;
                            const previousWantsSamsungSyncPlay = !!(((_b = this.currentContent) === null || _b === void 0 ? void 0 : _b.syncPlay) && this.currentContent.syncPlay.enabled);
                            const previousGroupID = Number.isFinite(Number((_d = (_c = this.currentContent) === null || _c === void 0 ? void 0 : _c.syncPlay) === null || _d === void 0 ? void 0 : _d.groupID))
                                ? Number((_g = (_f = this.currentContent) === null || _f === void 0 ? void 0 : _f.syncPlay) === null || _g === void 0 ? void 0 : _g.groupID)
                                : 5;
                            const isNativeSyncActive = this.syncPlayMode === 'native' &&
                                ((_h = this.isSyncplayAvailable) === null || _h === void 0 ? void 0 : _h.call(this)) &&
                                (this.isSyncPlaying || this.isSyncStarting) &&
                                !!((_j = this.syncPlaylistState) === null || _j === void 0 ? void 0 : _j.prepared);
                            // Already running SyncPlay with same content — keep it
                            if (previousWantsSamsungSyncPlay &&
                                isNativeSyncActive &&
                                newSignature &&
                                this.lastContentSignature &&
                                newSignature === this.lastContentSignature &&
                                desiredGroupID === previousGroupID) {
                                logger.info('SyncPlay content unchanged; keeping existing native SyncPlay session');
                                this.lastContentSignature = newSignature;
                                this.currentContent = content;
                                return;
                            }
                            // Coordination already kicked off for this same content — don't restart
                            if (previousWantsSamsungSyncPlay &&
                                this.syncCoordinationInProgress &&
                                newSignature &&
                                this.syncCoordinationSignature &&
                                newSignature === this.syncCoordinationSignature &&
                                desiredGroupID === previousGroupID) {
                                logger.info('SyncPlay coordination already in progress for this content, skipping');
                                this.currentContent = content;
                                return;
                            }
                            this.pendingPlaylist = null;
                            this.pendingSignature = null;
                            const playlistItems = content.items.map((item) => ({
                                contentId: item.contentId,
                                duration: item.duration,
                                position: item.position,
                                content: item.content || null,
                            }));
                            const groupID = desiredGroupID;
                            // Start regular playback immediately so the screen shows content while peers download.
                            // IMPORTANT: do NOT set lastContentSignature here — that would cause trySwapToPendingContent
                            // to think content is already playing and skip rendering.
                            this.downloadContentInBackground(content, newSignature);
                            // Coordinate SyncPlay in background: download sync files, wait for all peers, then start together
                            this.syncCoordinationInProgress = true;
                            this.syncCoordinationSignature = newSignature; // used for dedup only; not lastContentSignature
                            this.currentContent = content;
                            this.coordinateSyncPlay(content, groupID, playlistItems).catch((err) => {
                                logger.error('SyncPlay coordination failed:', err);
                                this.syncCoordinationInProgress = false;
                                this.syncCoordinationSignature = null;
                            });
                            return;
                        }
                    }
                    if (newSignature &&
                        this.lastContentSignature &&
                        newSignature === this.lastContentSignature &&
                        this.currentContent &&
                        isPlaying &&
                        true) {
                        logger.info('Content unchanged since last refresh, skipping re-render');
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
        // AVPlay supports both HTTP and file:// URLs from wgt-private storage
        if (typeof webapis !== 'undefined' && webapis.avplay) {
            this.renderVideoAVPlay(container, content);
        }
        else {
            // Fallback to HTML5 video
            this.renderVideoHTML5(container, content);
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
            // AVPlay setDisplayRect always uses a fixed 1920x1080 coordinate space per Samsung API docs,
            // regardless of actual panel resolution. Passing window.innerWidth (which may be 3840 on UHD)
            // makes the video render in only the top-left quadrant of the panel.
            const viewportWidth = 1920;
            const viewportHeight = 1080;
            webapis.avplay.setDisplayRect(0, 0, viewportWidth, viewportHeight);
            logger.debug('AVPlay: Display rect set', viewportWidth, viewportHeight);
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
        const num = String(channel.number || '').padStart(2, '0');
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
        const padded = (buffer || '').padEnd(2, '-');
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
            // AVPlay coordinate space is always a fixed 1920x1080 per Samsung API docs.
            const viewportWidth = 1920;
            const viewportHeight = 1080;
            webapis.avplay.setDisplayRect(0, 0, viewportWidth, viewportHeight);
            logger.debug('AVPlay: Display rect set for stream', viewportWidth, viewportHeight);
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
        // AVPlay setDisplayRect coordinate space is always 1920x1080 per Samsung API docs
        const viewportWidth = 1920;
        const viewportHeight = 1080;
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
        // AVPlay setDisplayRect coordinate space is always 1920x1080 per Samsung API docs
        const viewportWidth = 1920;
        const viewportHeight = 1080;
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
        // AVPlay setDisplayRect coordinate space is always 1920x1080 per Samsung API docs
        const viewportWidth = 1920;
        const viewportHeight = 1080;
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
    // Get synchronized time (local time + NTP offset)
    getSyncedTime() {
        return Date.now() + this.ntpOffset;
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
    // Render PDF or Office document.
    // Dispatches to one of three backends based on Tizen version:
    //   • Tizen 4 (legacy)  → B2BDoc API (native HW layer, Samsung B2B SSSP)
    //   • Tizen 6.5+        → webapis.document (native HW layer, Document API)
    //   • Tizen 5–6.4       → PDF.js (canvas rendering, existing behaviour)
    renderDocument(container, content) {
        var _a;
        this.closeDocument();
        container.innerHTML = '';
        // Mark active immediately — prevents the playlist loop (which runs every 10s)
        // from spawning a second concurrent renderDocument while the doc is still loading.
        // On error, this is reset to false so the next tick can retry.
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
        const platform = window.Platform;
        const hasB2BDoc = typeof window.B2BDoc === 'function';
        const hasNativeDocApi = !!((_a = window.webapis) === null || _a === void 0 ? void 0 : _a.document);
        const supportsNative = (platform === null || platform === void 0 ? void 0 : platform.supportsDocumentApi) && hasNativeDocApi;
        logger.info('renderDocument backend selection:', 'tizen=' + ((platform === null || platform === void 0 ? void 0 : platform.tizenVersion) || '?'), 'isLegacy=' + !!(platform === null || platform === void 0 ? void 0 : platform.isLegacy), 'supportsDocumentApi=' + !!(platform === null || platform === void 0 ? void 0 : platform.supportsDocumentApi), 'B2BDoc=' + hasB2BDoc, 'webapis.document=' + hasNativeDocApi);
        if ((platform === null || platform === void 0 ? void 0 : platform.isLegacy) && hasB2BDoc) {
            this._renderDocumentB2BDoc(container, content, this.b2bDocAutoFlipIntervalMs);
            return;
        }
        if (supportsNative) {
            this._renderDocumentNative(container, content, slideIntervalSec);
            return;
        }
        // Default: PDF.js (Tizen 5–6.4, or any legacy device without B2BDoc as a last resort)
        this._renderDocumentPdfJs(container, content);
    },
    // Tizen 4: render via Samsung B2BDoc API (native HW layer)
    _renderDocumentB2BDoc(container, content, slideIntervalMs) {
        var _a, _b, _c, _d, _f;
        this.documentBackend = 'b2bdoc';
        document.body.classList.add('b2bdoc-active');
        container.innerHTML = '';
        const showError = (reason) => {
            logger.error('B2BDoc load failed:', content.name, reason);
            this.documentActive = false;
            this.documentItemKey = null;
            this.documentBackend = null;
            this.b2bDocInstance = null;
            document.body.classList.remove('b2bdoc-active');
            container.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:center;height:100%;color:white;background:#222;flex-direction:column;">
          <div style="font-size:48px;margin-bottom:20px;">&#9888;</div>
          <div style="font-size:24px;">Document Load Error (B2BDoc)</div>
          <div style="font-size:14px;margin-top:10px;opacity:0.6;">${content.name}</div>
          <div style="font-size:12px;margin-top:8px;opacity:0.4;">${reason}</div>
        </div>`;
        };
        try {
            const B2BDocCtor = window.B2BDoc;
            const doc = new B2BDocCtor();
            this.b2bDocInstance = doc;
            // Register full event surface
            try {
                (_a = doc.on) === null || _a === void 0 ? void 0 : _a.call(doc, 'loaded', () => {
                    var _a;
                    logger.info('B2BDoc loaded:', content.name);
                    try {
                        (_a = doc.startAutoFlip) === null || _a === void 0 ? void 0 : _a.call(doc, slideIntervalMs);
                    }
                    catch (e) {
                        logger.warn('B2BDoc startAutoFlip failed:', (e === null || e === void 0 ? void 0 : e.message) || e);
                    }
                });
            }
            catch (_) { }
            try {
                (_b = doc.on) === null || _b === void 0 ? void 0 : _b.call(doc, 'pageChanged', (p) => logger.debug('B2BDoc page changed:', p));
            }
            catch (_) { }
            try {
                (_c = doc.on) === null || _c === void 0 ? void 0 : _c.call(doc, 'error', (e) => showError('event: ' + ((e === null || e === void 0 ? void 0 : e.message) || JSON.stringify(e))));
            }
            catch (_) { }
            try {
                (_d = doc.on) === null || _d === void 0 ? void 0 : _d.call(doc, 'autoFlipStart', () => logger.debug('B2BDoc autoFlip started'));
            }
            catch (_) { }
            try {
                (_f = doc.on) === null || _f === void 0 ? void 0 : _f.call(doc, 'autoFlipStop', () => logger.debug('B2BDoc autoFlip stopped'));
            }
            catch (_) { }
            logger.info('B2BDoc opening:', content.url);
            doc.open(content.url, { cache: true });
        }
        catch (e) {
            showError('open exception: ' + ((e === null || e === void 0 ? void 0 : e.message) || e));
        }
    },
    // Tizen 6.5+: render via webapis.document (native Document API)
    _renderDocumentNative(container, content, slideIntervalSec) {
        this.documentBackend = 'native';
        this.nativeDocOpen = false;
        document.body.classList.add('b2bdoc-active');
        container.innerHTML = '';
        const docApi = window.webapis.document;
        const rect = this.getDisplayRect();
        const docinfo = {
            docpath: content.url,
            rectX: rect.left,
            rectY: rect.top,
            rectWidth: rect.width,
            rectHeight: rect.height,
        };
        const showError = (reason) => {
            logger.error('webapis.document load failed:', content.name, reason);
            this.documentActive = false;
            this.documentItemKey = null;
            this.documentBackend = null;
            this.nativeDocOpen = false;
            document.body.classList.remove('b2bdoc-active');
            container.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:center;height:100%;color:white;background:#222;flex-direction:column;">
          <div style="font-size:48px;margin-bottom:20px;">&#9888;</div>
          <div style="font-size:24px;">Document Load Error (Document API)</div>
          <div style="font-size:14px;margin-top:10px;opacity:0.6;">${content.name}</div>
          <div style="font-size:12px;margin-top:8px;opacity:0.4;">${reason}</div>
        </div>`;
        };
        logger.info('webapis.document.open:', docinfo);
        try {
            docApi.open(docinfo, () => {
                this.nativeDocOpen = true;
                logger.info('webapis.document opened, starting play with slideTime:', slideIntervalSec);
                try {
                    docApi.play(slideIntervalSec, () => logger.debug('webapis.document play started'), (err) => logger.warn('webapis.document play error:', err === null || err === void 0 ? void 0 : err.name, err === null || err === void 0 ? void 0 : err.message));
                }
                catch (e) {
                    logger.warn('webapis.document play exception:', (e === null || e === void 0 ? void 0 : e.message) || e);
                }
            }, (err) => {
                const name = (err === null || err === void 0 ? void 0 : err.name) || '';
                const msg = (err === null || err === void 0 ? void 0 : err.message) || JSON.stringify(err);
                const hint = name === 'SecurityError' ? ' (partner certificate / documentplay privilege required)' : '';
                showError(`${name}: ${msg}${hint}`);
            });
        }
        catch (e) {
            showError('open exception: ' + ((e === null || e === void 0 ? void 0 : e.message) || e));
        }
    },
    // Tizen 5–6.4 (and fallback): render via PDF.js to canvas.
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
    // Unified document control adapter — routes commands to the active backend.
    // Used by both internal logic and the tizen_command WebSocket passthrough.
    // Each method takes (ok, err) callbacks; "not supported" backends call err synchronously.
    _getDocControlAdapter() {
        var _a;
        const backend = this.documentBackend;
        const b2b = this.b2bDocInstance;
        const docApi = (_a = window.webapis) === null || _a === void 0 ? void 0 : _a.document;
        const notSupported = (op) => (_ok, err) => {
            const msg = `${op} not supported on ${backend || 'inactive'} backend`;
            try {
                err === null || err === void 0 ? void 0 : err({ name: 'NotSupportedError', message: msg });
            }
            catch (_) { }
        };
        const inactive = (op) => (_ok, err) => {
            try {
                err === null || err === void 0 ? void 0 : err({ name: 'InvalidStateError', message: `${op}: no document active` });
            }
            catch (_) { }
        };
        // Wrap a sync B2BDoc call into an (ok, err) interface
        const wrapB2B = (fn) => (ok, err) => {
            try {
                const v = fn();
                ok === null || ok === void 0 ? void 0 : ok(v !== null && v !== void 0 ? v : 'OK');
            }
            catch (e) {
                err === null || err === void 0 ? void 0 : err({ name: (e === null || e === void 0 ? void 0 : e.name) || 'UnknownError', message: (e === null || e === void 0 ? void 0 : e.message) || String(e) });
            }
        };
        const adapter = {
            getVersion: backend === 'native'
                ? () => { try {
                    return docApi.getVersion();
                }
                catch (e) {
                    return null;
                } }
                : () => null,
            open: backend === 'native'
                ? (docinfo, ok, err) => { try {
                    docApi.open(docinfo, ok, err);
                }
                catch (e) {
                    err === null || err === void 0 ? void 0 : err(e);
                } }
                : notSupported('open'),
            close: backend === 'b2bdoc' ? wrapB2B(() => { var _a; return (_a = b2b === null || b2b === void 0 ? void 0 : b2b.close) === null || _a === void 0 ? void 0 : _a.call(b2b); })
                : backend === 'native' ? (ok, err) => { try {
                    docApi.close(ok, err);
                }
                catch (e) {
                    err === null || err === void 0 ? void 0 : err(e);
                } }
                    : inactive('close'),
            play: backend === 'b2bdoc' ? (slideTime, ok, err) => {
                this.b2bDocAutoFlipIntervalMs = (slideTime || 10) * 1000;
                wrapB2B(() => { var _a; return (_a = b2b === null || b2b === void 0 ? void 0 : b2b.startAutoFlip) === null || _a === void 0 ? void 0 : _a.call(b2b, this.b2bDocAutoFlipIntervalMs); })(ok, err);
            }
                : backend === 'native' ? (slideTime, ok, err) => {
                    try {
                        docApi.play(slideTime, ok, err);
                    }
                    catch (e) {
                        err === null || err === void 0 ? void 0 : err(e);
                    }
                }
                    : inactive('play'),
            stop: backend === 'b2bdoc' ? wrapB2B(() => { var _a; return (_a = b2b === null || b2b === void 0 ? void 0 : b2b.stopAutoFlip) === null || _a === void 0 ? void 0 : _a.call(b2b); })
                : backend === 'native' ? (ok, err) => { try {
                    docApi.stop(ok, err);
                }
                catch (e) {
                    err === null || err === void 0 ? void 0 : err(e);
                } }
                    : inactive('stop'),
            pause: backend === 'b2bdoc' ? wrapB2B(() => { var _a; return (_a = b2b === null || b2b === void 0 ? void 0 : b2b.stopAutoFlip) === null || _a === void 0 ? void 0 : _a.call(b2b); }) // B2BDoc has no real pause
                : backend === 'native' ? (ok, err) => { try {
                    docApi.pause(ok, err);
                }
                catch (e) {
                    err === null || err === void 0 ? void 0 : err(e);
                } }
                    : inactive('pause'),
            resume: backend === 'b2bdoc' ? wrapB2B(() => { var _a; return (_a = b2b === null || b2b === void 0 ? void 0 : b2b.startAutoFlip) === null || _a === void 0 ? void 0 : _a.call(b2b, this.b2bDocAutoFlipIntervalMs); })
                : backend === 'native' ? (ok, err) => { try {
                    docApi.resume(ok, err);
                }
                catch (e) {
                    err === null || err === void 0 ? void 0 : err(e);
                } }
                    : inactive('resume'),
            nextPage: backend === 'b2bdoc' ? wrapB2B(() => { var _a; return (_a = b2b === null || b2b === void 0 ? void 0 : b2b.nextPage) === null || _a === void 0 ? void 0 : _a.call(b2b); })
                : backend === 'native' ? (ok, err) => { try {
                    docApi.nextPage(ok, err);
                }
                catch (e) {
                    err === null || err === void 0 ? void 0 : err(e);
                } }
                    : inactive('nextPage'),
            prevPage: backend === 'b2bdoc' ? wrapB2B(() => { var _a; return (_a = b2b === null || b2b === void 0 ? void 0 : b2b.prevPage) === null || _a === void 0 ? void 0 : _a.call(b2b); })
                : backend === 'native' ? (ok, err) => { try {
                    docApi.prevPage(ok, err);
                }
                catch (e) {
                    err === null || err === void 0 ? void 0 : err(e);
                } }
                    : inactive('prevPage'),
            gotoPage: backend === 'b2bdoc' ? (page, ok, err) => wrapB2B(() => { var _a; return (_a = b2b === null || b2b === void 0 ? void 0 : b2b.goToPage) === null || _a === void 0 ? void 0 : _a.call(b2b, page); })(ok, err)
                : backend === 'native' ? (page, ok, err) => {
                    try {
                        docApi.gotoPage(page, ok, err);
                    }
                    catch (e) {
                        err === null || err === void 0 ? void 0 : err(e);
                    }
                }
                    : inactive('gotoPage'),
            setDocumentOrientation: backend === 'native'
                ? (ok, err) => { try {
                    docApi.setDocumentOrientation(ok, err);
                }
                catch (e) {
                    err === null || err === void 0 ? void 0 : err(e);
                } }
                : notSupported('setDocumentOrientation'),
            // B2BDoc-only zoom/view methods
            zoomIn: backend === 'b2bdoc' ? wrapB2B(() => { var _a; return (_a = b2b === null || b2b === void 0 ? void 0 : b2b.zoomIn) === null || _a === void 0 ? void 0 : _a.call(b2b); }) : notSupported('zoomIn'),
            zoomOut: backend === 'b2bdoc' ? wrapB2B(() => { var _a; return (_a = b2b === null || b2b === void 0 ? void 0 : b2b.zoomOut) === null || _a === void 0 ? void 0 : _a.call(b2b); }) : notSupported('zoomOut'),
            setZoom: backend === 'b2bdoc' ? (level, ok, err) => wrapB2B(() => { var _a; return (_a = b2b === null || b2b === void 0 ? void 0 : b2b.setZoom) === null || _a === void 0 ? void 0 : _a.call(b2b, level); })(ok, err)
                : notSupported('setZoom'),
            fitToWidth: backend === 'b2bdoc' ? wrapB2B(() => { var _a; return (_a = b2b === null || b2b === void 0 ? void 0 : b2b.fitToWidth) === null || _a === void 0 ? void 0 : _a.call(b2b); }) : notSupported('fitToWidth'),
            fitToHeight: backend === 'b2bdoc' ? wrapB2B(() => { var _a; return (_a = b2b === null || b2b === void 0 ? void 0 : b2b.fitToHeight) === null || _a === void 0 ? void 0 : _a.call(b2b); }) : notSupported('fitToHeight'),
            resetView: backend === 'b2bdoc' ? wrapB2B(() => { var _a; return (_a = b2b === null || b2b === void 0 ? void 0 : b2b.resetView) === null || _a === void 0 ? void 0 : _a.call(b2b); }) : notSupported('resetView'),
            getPageCount: backend === 'b2bdoc' ? (ok, err) => {
                var _a;
                try {
                    (_a = b2b === null || b2b === void 0 ? void 0 : b2b.getPageCount) === null || _a === void 0 ? void 0 : _a.call(b2b, (n) => ok === null || ok === void 0 ? void 0 : ok(n));
                }
                catch (e) {
                    err === null || err === void 0 ? void 0 : err({ name: (e === null || e === void 0 ? void 0 : e.name) || 'UnknownError', message: (e === null || e === void 0 ? void 0 : e.message) || String(e) });
                }
            }
                : notSupported('getPageCount'),
        };
        return adapter;
    },
    // Close the currently open document (safe no-op if none open).
    // Branches on documentBackend to call the right teardown sequence.
    closeDocument() {
        var _a, _b, _c, _d, _f;
        if (!this.documentActive && !this.documentBackend)
            return;
        const backend = this.documentBackend;
        if (backend === 'b2bdoc') {
            try {
                (_b = (_a = this.b2bDocInstance) === null || _a === void 0 ? void 0 : _a.stopAutoFlip) === null || _b === void 0 ? void 0 : _b.call(_a);
            }
            catch (_) { }
            try {
                (_d = (_c = this.b2bDocInstance) === null || _c === void 0 ? void 0 : _c.close) === null || _d === void 0 ? void 0 : _d.call(_c);
            }
            catch (_) { }
            this.b2bDocInstance = null;
            try {
                document.body.classList.remove('b2bdoc-active');
            }
            catch (_) { }
        }
        else if (backend === 'native') {
            const docApi = (_f = window.webapis) === null || _f === void 0 ? void 0 : _f.document;
            if (docApi) {
                try {
                    docApi.stop(() => { }, () => { });
                }
                catch (_) { }
                try {
                    docApi.close(() => { }, () => { });
                }
                catch (_) { }
            }
            this.nativeDocOpen = false;
            try {
                document.body.classList.remove('b2bdoc-active');
            }
            catch (_) { }
        }
        else {
            // pdfjs or null
            if (this.documentPageInterval) {
                clearInterval(this.documentPageInterval);
                this.documentPageInterval = null;
            }
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
        // Filter out items without URLs
        const playableItems = playlist.items.filter(item => item.content.url);
        if (playableItems.length === 0) {
            logger.warn('Playlist has no playable items (all missing URLs)');
            this.showIdleScreen();
            return;
        }
        logger.info(`Playing playlist: ${playlist.playlistName} with ${playableItems.length} playable items (${playlist.items.length - playableItems.length} skipped)`);
        this.cancelCurrentPlayback();
        const container = document.getElementById('content-container');
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
        // AVPlay setDisplayRect coordinate space is always 1920x1080 per Samsung API docs
        const viewportWidth = 1920;
        const viewportHeight = 1080;
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
            const itemKey = this.getPlaylistItemKey(content);
            const isDocumentContent = content.type === 'PDF' || content.type === 'OFFICE';
            const canReuseImage = content.type === 'IMAGE' &&
                this.lastRenderedItemKey === itemKey &&
                container.children.length > 0;
            const canReuseDocument = isDocumentContent &&
                this.documentActive &&
                this.documentItemKey === itemKey;
            if (!canReuseDocument && this.documentActive) {
                this.closeDocument();
            }
            if (!canReuseImage && !canReuseDocument) {
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
        if (this.syncPlayMode === 'native' && this.isSyncplayAvailable() && this.isSyncPlaying) {
            this.stopSyncPlayNative();
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
        if (this.syncPlayMode === 'native' && this.isSyncplayAvailable() && this.isSyncPlaying) {
            this.stopSyncPlayNative();
        }
        this.cancelCurrentPlayback();
        this.closeDocument();
        this.currentItem = null;
        this.currentPlaylist = null;
        this.currentIndex = 0;
        this.isSyncPlaying = false;
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
        // Ensure AVPlay/SyncPlay visual state is fully reset so the content-container
        // is visible (cancelCurrentPlayback removes avplay-active class via stopSyncPlayNative,
        // but the inline visibility:hidden set by setAvPlayVisualMode(true) must also be cleared).
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
        container.innerHTML = `
      <div class="idle-screen">
        <div class="idle-card">
          <div class="idle-icon">ðŸ“¡</div>
          <div class="idle-title">Nexari</div>
          <div class="idle-subtitle">${this.deviceName || 'Device'}</div>
          <div class="idle-status">${statusText}</div>
          ${progressBar}
          <div class="idle-spinner spinner"></div>
        </div>
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
                // Use MDC standby_set via Node bridge (LFD 6.5 — no hospitality/virtualStandby)
                this.sendLocalMdcXhr('standby_set', { value: 1 })
                    .then(() => logger.info('[cmd] MDC standby_set 1 (power off)'))
                    .catch(() => {
                    // Fallback to webapis power chain
                    this.invokeTVControl('powerOff', Object.assign({}, (payload || {})));
                });
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
                // Use MDC standby_set via Node bridge (LFD 6.5)
                this.sendLocalMdcXhr('standby_set', { value: 0 })
                    .then(() => logger.info('[cmd] MDC standby_set 0 (power on)'))
                    .catch(() => {
                    // Fallback to webapis power chain
                    this.invokeTVControl('powerOn');
                });
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
            case 'SET_ON_TIMER': {
                const slot = Math.max(1, Math.min(7, Number((_d = payload === null || payload === void 0 ? void 0 : payload.slot) !== null && _d !== void 0 ? _d : 1)));
                this.sendLocalMdcXhr('on_timer_set', Object.assign({ slot }, (payload || {})))
                    .then((r) => logger.info('[cmd] SET_ON_TIMER slot', slot, r.ok))
                    .catch((e) => logger.warn('[cmd] SET_ON_TIMER failed:', e));
                break;
            }
            case 'SET_OFF_TIMER': {
                const slot = Math.max(1, Math.min(7, Number((_f = payload === null || payload === void 0 ? void 0 : payload.slot) !== null && _f !== void 0 ? _f : 1)));
                // off-timer is encoded as onEnable=0 + offEnable=1 in the same slot
                this.sendLocalMdcXhr('on_timer_set', Object.assign({ slot, onEnable: 0, offEnable: 1 }, (payload || {})))
                    .then((r) => logger.info('[cmd] SET_OFF_TIMER slot', slot, r.ok))
                    .catch((e) => logger.warn('[cmd] SET_OFF_TIMER failed:', e));
                break;
            }
            case 'CLEAR_ON_TIMER': {
                const slot = Math.max(1, Math.min(7, Number((_g = payload === null || payload === void 0 ? void 0 : payload.slot) !== null && _g !== void 0 ? _g : 1)));
                this.sendLocalMdcXhr('on_timer_set', { slot, onEnable: 0, offEnable: 0 })
                    .then((r) => logger.info('[cmd] CLEAR_ON_TIMER slot', slot, r.ok))
                    .catch((e) => logger.warn('[cmd] CLEAR_ON_TIMER failed:', e));
                break;
            }
            case 'CLEAR_OFF_TIMER': {
                const slot = Math.max(1, Math.min(7, Number((_h = payload === null || payload === void 0 ? void 0 : payload.slot) !== null && _h !== void 0 ? _h : 1)));
                this.sendLocalMdcXhr('on_timer_set', { slot, onEnable: 0, offEnable: 0 })
                    .then((r) => logger.info('[cmd] CLEAR_OFF_TIMER slot', slot, r.ok))
                    .catch((e) => logger.warn('[cmd] CLEAR_OFF_TIMER failed:', e));
                break;
            }
            case 'SCREENSHOT':
                this.takeScreenshot();
                break;
            case 'SCREENSHOT_AUTO':
                // Server-initiated on-connect shot — stored in-memory only, no disk write
                this.takeScreenshotWithTrigger('content_change');
                break;
            case 'SET_SCREENSHOT_INTERVAL': {
                // API sends { minutes: N } — set up a periodic takeScreenshot loop on the device.
                // Clears any existing timer first.
                if (this._screenshotIntervalHandle) {
                    clearInterval(this._screenshotIntervalHandle);
                    this._screenshotIntervalHandle = undefined;
                }
                const minutes = Math.max(1, Number(payload === null || payload === void 0 ? void 0 : payload.minutes) || 5);
                logger.info('[Screenshot] interval set to', minutes, 'min');
                // Take one immediately, then repeat
                setTimeout(() => this.takeScreenshotWithTrigger('interval'), 3000);
                this._screenshotIntervalHandle = setInterval(() => this.takeScreenshotWithTrigger('interval'), minutes * 60000);
                break;
            }
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
                this.handleSyncPlayCommand(payload || command);
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
        else if (type === 'PDF') {
            this._playZonePdf(zone, container, content, items, itemIndex, durationMs, token, zoneIndex);
        }
        else if (type === 'OFFICE') {
            this._playZoneOffice(zone, container, content, items, itemIndex, durationMs, token, zoneIndex);
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
    // Render Office/PPT/DOC document in a zone using webapis.document with zone rect coordinates.
    // Hardware layer — positioned like AVPlay VideoMixer.
    _playZoneOffice(zone, container, content, items, itemIndex, durationMs, token, zoneIndex) {
        var _a;
        const url = content.url || content.fileUrl || '';
        if (!url) {
            const t = setTimeout(() => this._playZoneItems(zone, container, items, itemIndex + 1, token, zoneIndex), durationMs);
            this._zoneTimers.push(t);
            return;
        }
        const docApi = (_a = window.webapis) === null || _a === void 0 ? void 0 : _a.document;
        if (!docApi) {
            logger.warn(`[Zone ${zoneIndex}] webapis.document unavailable — skipping OFFICE item`);
            const t = setTimeout(() => this._playZoneItems(zone, container, items, itemIndex + 1, token, zoneIndex), durationMs);
            this._zoneTimers.push(t);
            return;
        }
        // Only one webapis.document instance system-wide
        if (this._zoneDocumentActive) {
            logger.warn(`[Zone ${zoneIndex}] webapis.document already in use by another zone, skipping`);
            const t = setTimeout(() => this._playZoneItems(zone, container, items, itemIndex + 1, token, zoneIndex), durationMs);
            this._zoneTimers.push(t);
            return;
        }
        let advanced = false;
        const advanceOnce = () => {
            if (advanced)
                return;
            advanced = true;
            if (this._zoneDocumentActive) {
                this._zoneDocumentActive = false;
                try {
                    docApi.stop(() => { }, () => { });
                }
                catch (_) { }
                try {
                    docApi.close(() => { }, () => { });
                }
                catch (_) { }
            }
            if (this._zoneMode && container.parentNode) {
                this._playZoneItems(zone, container, items, itemIndex + 1, token, zoneIndex);
            }
        };
        const pageIntervalSecs = Math.max(5, Math.floor(durationMs / 1000 / 10)); // ~10 pages max
        const docinfo = {
            docpath: url,
            rectX: zone.rect.x,
            rectY: zone.rect.y,
            rectWidth: zone.rect.width,
            rectHeight: zone.rect.height,
        };
        logger.info(`[Zone ${zoneIndex}] Opening OFFICE document: ${url}`);
        this._zoneDocumentActive = true;
        try {
            docApi.open(docinfo, () => {
                logger.info(`[Zone ${zoneIndex}] Document opened, playing at ${pageIntervalSecs}s/page`);
                try {
                    docApi.play(pageIntervalSecs, () => {
                        logger.info(`[Zone ${zoneIndex}] Document playing`);
                    }, (err) => {
                        logger.warn(`[Zone ${zoneIndex}] Document play error:`, err);
                    });
                }
                catch (e) {
                    logger.warn(`[Zone ${zoneIndex}] docApi.play threw:`, e);
                }
            }, (err) => {
                var _a;
                logger.warn(`[Zone ${zoneIndex}] Document open error:`, err);
                this._zoneDocumentActive = false;
                const errCount = ((_a = this._zoneErrorCounts[zone.id]) !== null && _a !== void 0 ? _a : 0) + 1;
                this._zoneErrorCounts[zone.id] = errCount;
                const t = setTimeout(() => this._playZoneItems(zone, container, items, itemIndex + 1, token, zoneIndex), 3000);
                this._zoneTimers.push(t);
            });
        }
        catch (e) {
            logger.warn(`[Zone ${zoneIndex}] docApi.open threw:`, e);
            this._zoneDocumentActive = false;
        }
        // Advance after total display duration
        const t = setTimeout(advanceOnce, durationMs);
        this._zoneTimers.push(t);
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
    takeScreenshotWithTrigger(trigger) {
        this._captureScreenshot(trigger);
    },
    takeScreenshot() {
        this._captureScreenshot('manual');
    },
    _captureScreenshot(trigger) {
        const ws = this.wsConnection;
        if (!ws || ws.readyState !== 1) {
            logger.warn('[Screenshot] WebSocket not connected, cannot send screenshot');
            return;
        }
        const send = (dataBase64) => {
            ws.send(JSON.stringify({
                type: 'screenshot_data',
                payload: { dataBase64, trigger, contentId: null },
            }));
            logger.info('[Screenshot] screenshot_data sent, bytes:', dataBase64.length);
        };
        // Try b2bcontrol.captureScreen first (returns file path on Samsung LFD)
        try {
            const b2b = typeof window.b2bapis !== 'undefined' ? window.b2bapis.b2bcontrol : null;
            if (b2b && typeof b2b.captureScreen === 'function') {
                b2b.captureScreen((filePath) => {
                    logger.info('[Screenshot] captureScreen succeeded, path:', filePath);
                    try {
                        const normalizedPath = String(filePath || '').replace(/^file:\/\//, '');
                        const platform = window.Platform;
                        if (platform && platform.isLegacy) {
                            // Tizen 4: filesystem.openFile does not exist — use resolve + openStream
                            tizen.filesystem.resolve(normalizedPath, (file) => {
                                file.openStream('r', (stream) => {
                                    try {
                                        const bytes = stream.readBytes(file.fileSize);
                                        stream.close();
                                        let binary = '';
                                        for (let i = 0; i < bytes.length; i++)
                                            binary += String.fromCharCode(bytes[i]);
                                        send(btoa(binary));
                                    }
                                    catch (e) {
                                        logger.warn('[Screenshot] read stream bytes failed:', e);
                                    }
                                }, (e) => logger.warn('[Screenshot] openStream error:', e), 'ISO-8859-1');
                            }, (e) => logger.warn('[Screenshot] filesystem.resolve failed:', e), 'r');
                        }
                        else {
                            const fh = tizen.filesystem.openFile(normalizedPath, 'r');
                            try {
                                const bytes = fh.readData();
                                let binary = '';
                                for (let i = 0; i < bytes.length; i++)
                                    binary += String.fromCharCode(bytes[i]);
                                send(btoa(binary));
                            }
                            finally {
                                try {
                                    fh.close();
                                }
                                catch (_) { }
                            }
                        }
                    }
                    catch (e) {
                        logger.warn('[Screenshot] filesystem access failed:', e);
                    }
                }, (e) => logger.warn('[Screenshot] captureScreen error:', (e && e.message) || e));
                return;
            }
        }
        catch (e) {
            logger.warn('[Screenshot] b2b captureScreen threw:', e);
        }
        // Fallback: HTML5 canvas DOM capture
        try {
            const canvas = document.createElement('canvas');
            canvas.width = window.innerWidth || 1920;
            canvas.height = window.innerHeight || 1080;
            const ctx = canvas.getContext('2d');
            if (!ctx)
                throw new Error('No 2d context');
            ctx.fillStyle = '#000';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
            const base64 = dataUrl.split(',')[1];
            send(base64);
        }
        catch (e) {
            logger.warn('[Screenshot] Canvas fallback failed:', e);
        }
    },
    // Handle synchronized playback command
    handleSyncPlayCommand(data) {
        logger.info('SYNC_PLAY command received:', data);
        if (!data || !data.action) {
            logger.warn('SYNC_PLAY missing action');
            return;
        }
        switch (data.action) {
            case 'STOP':
            case 'CANCEL':
                // Legacy orchestration removed; allow server/operator to stop native SyncPlay.
                this.stopSyncPlayNative();
                break;
            case 'START_SYNCPLAY':
                // Legacy broadcast orchestration removed. Content refresh drives SyncPlay start.
                logger.warn('START_SYNCPLAY received but legacy orchestration is disabled; ignoring');
                break;
            default:
                logger.warn('Ignoring legacy SYNC_PLAY action (disabled):', data.action);
        }
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
    // --- Tizen Syncplay (native) helpers ---
    // Tizen 6.5+ (QBC and newer signage) uses webapis.syncplay; Tizen 4 SBB uses b2bapis.b2bsyncplay.
    // Detect which backend is available and store it in syncplayBackend for use across sync methods.
    isSyncplayAvailable() {
        var _a, _b;
        // Prefer webapis.syncplay (Tizen 6.5+ / SSSP6+) -- matches official Samsung sample for QBC.
        // Some Tizen 6.5 firmwares also expose b2bapis.b2bsyncplay as a legacy shim, but the modern
        // webapis.syncplay is the documented API for these devices and renders correctly fullscreen.
        if (typeof webapis !== 'undefined' &&
            !!webapis.syncplay &&
            typeof webapis.syncplay.start === 'function' &&
            typeof webapis.syncplay.createPlaylist === 'function' &&
            typeof webapis.syncplay.stop === 'function') {
            this.syncplayBackend = 'webapis';
            try {
                const version = (_b = (_a = webapis.syncplay).getVersion) === null || _b === void 0 ? void 0 : _b.call(_a);
                if (version)
                    logger.debug('Syncplay API version:', version);
            }
            catch (_) { }
            return true;
        }
        // Fallback: b2bapis.b2bsyncplay (Tizen 4 SBB / SSSP4)
        const b2b = typeof window.b2bapis !== 'undefined' ? window.b2bapis : null;
        if (b2b &&
            !!b2b.b2bsyncplay &&
            typeof b2b.b2bsyncplay.startSyncPlay === 'function' &&
            typeof b2b.b2bsyncplay.makeSyncPlayList === 'function' &&
            typeof b2b.b2bsyncplay.stopSyncPlay === 'function') {
            this.syncplayBackend = 'b2bapis';
            return true;
        }
        this.syncplayBackend = null;
        return false;
    },
    deriveSyncplayGroupId(input) {
        const clampToUint16 = (num) => {
            if (!Number.isFinite(num))
                return 1;
            const mod = ((Math.trunc(num) % 65536) + 65536) % 65536;
            return mod === 0 ? 1 : mod;
        };
        if (typeof input === 'number')
            return clampToUint16(input);
        const str = String(input !== null && input !== void 0 ? input : '').trim();
        if (!str)
            return 1;
        const asNum = Number(str);
        if (Number.isFinite(asNum))
            return clampToUint16(asNum);
        // String fallback: CRC-16/CCITT (poly 0x1021, init 0xFFFF) — must match the
        // backend allocator in apps/api/src/routes/sync-groups.ts so a player that
        // ever receives a UUID-only payload arrives at the same groupId the backend
        // would have produced. The backend should always send a numeric groupId, so
        // this path is defensive only.
        logger.warn('Syncplay: deriveSyncplayGroupId received non-numeric input, using CRC-16 fallback', { input });
        let crc = 0xFFFF;
        for (let i = 0; i < str.length; i++) {
            crc ^= str.charCodeAt(i) << 8;
            for (let j = 0; j < 8; j++) {
                crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) : (crc << 1);
            }
        }
        return clampToUint16(crc & 0xFFFF);
    },
    getSyncplayFullscreenRect() {
        const width = Math.max((screen === null || screen === void 0 ? void 0 : screen.width) || 0, window.innerWidth || 0, 1920);
        const height = Math.max((screen === null || screen === void 0 ? void 0 : screen.height) || 0, window.innerHeight || 0, 1080);
        return { x: 0, y: 0, width, height };
    },
    buildSyncplayContents() {
        return __awaiter(this, arguments, void 0, function* (playlistItems = [], opts = {}) {
            var _a, _b;
            const contents = [];
            const requireLocal = opts.requireLocal !== false;
            const suppressIdleScreen = !!opts.suppressIdleScreen;
            for (let i = 0; i < playlistItems.length; i++) {
                const item = playlistItems[i];
                try {
                    // Prefer embedded content, else fetch from API. If API is temporarily unavailable,
                    // fall back to any URL carried on the playlist item.
                    let content = item.content;
                    if (!content) {
                        try {
                            content = yield API.getContentById(item.contentId);
                        }
                        catch (_) {
                            content = null;
                        }
                    }
                    if (!content && (item.contentUrl || item.url)) {
                        content = {
                            id: item.contentId,
                            url: item.contentUrl || item.url,
                            name: item.name,
                            duration: item.duration,
                        };
                    }
                    if (!content) {
                        logger.warn('Syncplay: content missing for', item.contentId);
                        continue;
                    }
                    // SyncPlay requires IDENTICAL file paths on all devices.
                    // Use deterministic sync-N.ext naming so all devices use same path.
                    const syncFileName = yield this.getSyncPlayFileName(content, item, i);
                    if (!syncFileName) {
                        const id = content.id || item.contentId;
                        if (requireLocal) {
                            throw new Error(`Syncplay: cannot determine filename for ${id}`);
                        }
                        logger.warn('Syncplay: missing filename; skipping item', id);
                        continue;
                    }
                    // Download with sync-specific naming
                    logger.info(`Syncplay: downloading item ${i + 1}/${playlistItems.length}: ${content.name || content.id}`);
                    if (!suppressIdleScreen)
                        this.showIdleScreen && this.showIdleScreen(0);
                    let syncPath = yield ContentManager.downloadSyncContent(content, syncFileName);
                    if (!syncPath) {
                        const id = content.id || item.contentId;
                        const name = content.name || '';
                        if (requireLocal) {
                            throw new Error(`Syncplay requires locally cached media. Missing cache for ${id}${name ? ` (${name})` : ''}`);
                        }
                        logger.warn('Syncplay: missing local cache; skipping item', id);
                        continue;
                    }
                    const duration = Math.max(1, Math.round(item.duration || content.duration || 10));
                    // Per official Samsung Tizen 4 SBB sample (samsungdforum.txt page 630), b2bsyncplay
                    // makeSyncPlayList expects a RAW filesystem path (e.g. "/opt/usr/apps/.../res/wgt/...").
                    // The newer webapis.syncplay sample uses getAppSharedURI() which returns file:// URIs;
                    // strip the scheme on b2bapis backend to match the official Tizen 4 example.
                    let nativePath = String(syncPath || '');
                    if (this.syncplayBackend === 'b2bapis' && nativePath.indexOf('file://') === 0) {
                        nativePath = nativePath.replace(/^file:\/\//, '');
                    }
                    // Verify the file actually exists & has nonzero size — Samsung's native SyncPlay
                    // returns an empty error object `{}` if the file is missing/unreadable, which is
                    // the most common cause of silent createPlaylist failures.
                    let fileOk = false;
                    let fileSizeBytes = -1;
                    try {
                        const probePath = nativePath.replace(/^file:\/\//, '');
                        if ((_a = tizen === null || tizen === void 0 ? void 0 : tizen.filesystem) === null || _a === void 0 ? void 0 : _a.pathExists) {
                            fileOk = !!tizen.filesystem.pathExists(probePath);
                        }
                        if (fileOk && ((_b = tizen === null || tizen === void 0 ? void 0 : tizen.filesystem) === null || _b === void 0 ? void 0 : _b.getFileSize)) {
                            try {
                                fileSizeBytes = tizen.filesystem.getFileSize(probePath);
                            }
                            catch (_) { }
                        }
                    }
                    catch (_) { /* probe failure is non-fatal */ }
                    contents.push({ path: nativePath, duration });
                    logger.info(`Syncplay: built item ${i + 1}/${playlistItems.length}, path=${nativePath}, duration=${duration}s, exists=${fileOk}, size=${fileSizeBytes}`);
                }
                catch (err) {
                    logger.warn('Syncplay: failed to build item', item.contentId, err);
                }
            }
            logger.info(`Syncplay: buildSyncplayContents returning ${contents.length} item(s)`);
            return contents;
        });
    },
    // XHR-based HTTP helper with explicit timeout (Tizen 4 fetch to localhost is unreliable).
    syncPeerXhr(method, url, body, timeoutMs) {
        return new Promise((resolve) => {
            try {
                const xhr = new XMLHttpRequest();
                let settled = false;
                const finish = (result) => {
                    if (settled)
                        return;
                    settled = true;
                    resolve(result);
                };
                const to = setTimeout(() => {
                    try {
                        xhr.abort();
                    }
                    catch (_) { }
                    finish({ ok: false, status: 0, json: null });
                }, timeoutMs);
                xhr.onreadystatechange = () => {
                    if (xhr.readyState !== 4)
                        return;
                    clearTimeout(to);
                    let json = null;
                    try {
                        json = xhr.responseText ? JSON.parse(xhr.responseText) : null;
                    }
                    catch (_) { }
                    finish({ ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status, json });
                };
                xhr.onerror = () => { clearTimeout(to); finish({ ok: false, status: 0, json: null }); };
                xhr.ontimeout = () => { clearTimeout(to); finish({ ok: false, status: 0, json: null }); };
                xhr.open(method, url, true);
                if (body !== null && body !== undefined) {
                    xhr.setRequestHeader('Content-Type', 'application/json');
                    xhr.send(typeof body === 'string' ? body : JSON.stringify(body));
                }
                else {
                    xhr.send();
                }
            }
            catch (e) {
                resolve({ ok: false, status: 0, json: null });
            }
        });
    },
    coordinateSyncPlay(content, groupID, playlistItems) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c, _d, _f, _g;
            const NODE_PORT = 9615;
            const syncGroupId = String(((_a = content.syncPlay) === null || _a === void 0 ? void 0 : _a.syncGroupId) || content.id || groupID);
            const peers = ((_b = content.syncPlay) === null || _b === void 0 ? void 0 : _b.peers) || [];
            const myDeviceId = this.deviceId || '';
            // Leader = peer with the lowest leaderPriority (or first alphabetically if tied)
            const myPeer = peers.find((p) => p.deviceId === myDeviceId);
            const sortedByPriority = [...peers].sort((a, b) => a.leaderPriority - b.leaderPriority || a.deviceId.localeCompare(b.deviceId));
            const isLeader = !sortedByPriority.length || (sortedByPriority[0].deviceId === myDeviceId);
            // Verbose role-election diagnostics: dump my deviceId, the peer list, and the winner so we can
            // tell whether a TV self-elected as LEADER because of a missing peers array vs. an ID mismatch.
            try {
                const peersDump = peers.map((p) => `${p.deviceId.slice(0, 8)}…@${p.ipAddress || '?'}/p${p.leaderPriority}`).join(' | ');
                const winner = sortedByPriority[0];
                logger.info(`SyncPlay election: myDeviceId=${myDeviceId.slice(0, 8)}… myPeerFound=${!!myPeer} myPriority=${(_c = myPeer === null || myPeer === void 0 ? void 0 : myPeer.leaderPriority) !== null && _c !== void 0 ? _c : 'n/a'} winnerDeviceId=${(_f = (_d = winner === null || winner === void 0 ? void 0 : winner.deviceId) === null || _d === void 0 ? void 0 : _d.slice(0, 8)) !== null && _f !== void 0 ? _f : 'none'}… winnerPriority=${(_g = winner === null || winner === void 0 ? void 0 : winner.leaderPriority) !== null && _g !== void 0 ? _g : 'n/a'} peerCount=${peers.length}`);
                logger.info(`SyncPlay election peers=[${peersDump || '(empty)'}]`);
            }
            catch (_) { /* logging-only */ }
            logger.info(`SyncPlay coordination: role=${isLeader ? 'LEADER' : 'FOLLOWER'} syncGroupId=${syncGroupId} peers=${peers.length}`);
            try {
                // Rate-limit SyncPlay retries: if createPlaylist failed recently, skip and stay on regular playback.
                const msSinceFailure = Date.now() - (this.syncplayCreateListFailedAt || 0);
                const SYNCPLAY_RETRY_COOLDOWN_MS = 2 * 60 * 1000; // 2 minutes
                if (msSinceFailure < SYNCPLAY_RETRY_COOLDOWN_MS) {
                    logger.info(`SyncPlay coordination: skipping (createPlaylist failed ${Math.round(msSinceFailure / 1000)}s ago, cooldown ${SYNCPLAY_RETRY_COOLDOWN_MS / 1000}s)`);
                    this.syncCoordinationInProgress = false;
                    return;
                }
                // Prepare SyncPlay playlist (download sync files, create hardware playlist).
                // suppress idle screen since regular playback is already running.
                const prepared = yield this.prepareSyncPlaylistNative({
                    playlistItems,
                    groupId: groupID,
                    folderId: groupID,
                    suppressIdleScreen: true,
                });
                if (!prepared) {
                    logger.error('SyncPlay coordination: prepareSyncPlaylistNative failed, staying on regular playback');
                    // Ensure regular content is rendering — in case something interrupted playback during prep.
                    const isPlaying = (this.currentPlaylistController && !this.currentPlaylistController.cancelled) ||
                        this._zoneMode ||
                        (this.syncPlayMode === 'native' && this.isSyncPlaying);
                    if (!isPlaying) {
                        logger.info('SyncPlay coordination: nothing playing after failure — attempting render from pending/cache');
                        if (this.pendingPlaylist) {
                            this.trySwapToPendingContent(true);
                        }
                        else if (!this.tryRenderCachedPlaylist('syncplay-fallback')) {
                            this.showIdleScreen();
                        }
                    }
                    this.syncCoordinationInProgress = false;
                    return;
                }
                // Mark this device as ready (POST to local Node bridge via XHR + timeout)
                logger.info(`SyncPlay: posting ready to local bridge http://127.0.0.1:${NODE_PORT}/sync-peer/ready`);
                const readyResp = yield this.syncPeerXhr('POST', `http://127.0.0.1:${NODE_PORT}/sync-peer/ready`, { syncGroupId }, 5000);
                if (readyResp.ok) {
                    logger.info('SyncPlay: ready posted to local bridge OK');
                }
                else {
                    logger.warn(`SyncPlay: failed to post ready (status=${readyResp.status})`);
                }
                const TIMEOUT_MS = 120000; // 2 minutes max
                const POLL_MS = 2000;
                const HTTP_TIMEOUT_MS = 4000;
                let startAt;
                if (isLeader) {
                    // Wait for all followers to report ready
                    const followers = peers.filter((p) => p.deviceId !== myDeviceId && p.ipAddress);
                    logger.info(`SyncPlay leader: waiting for ${followers.length} follower(s) to be ready`);
                    followers.forEach((p) => logger.info(`SyncPlay leader: follower ip=${p.ipAddress} deviceId=${p.deviceId}`));
                    const deadline = Date.now() + TIMEOUT_MS;
                    while (Date.now() < deadline) {
                        const statuses = yield Promise.all(followers.map((peer) => __awaiter(this, void 0, void 0, function* () {
                            const r = yield this.syncPeerXhr('GET', `http://${peer.ipAddress}:${NODE_PORT}/sync-peer/status?syncGroupId=${encodeURIComponent(syncGroupId)}`, null, HTTP_TIMEOUT_MS);
                            return !!(r.ok && r.json && r.json.ready === true);
                        })));
                        if (followers.length === 0 || statuses.every(Boolean)) {
                            logger.info('SyncPlay leader: all followers ready');
                            break;
                        }
                        logger.info(`SyncPlay leader: waiting... (${statuses.filter(Boolean).length}/${followers.length} ready)`);
                        yield new Promise((r) => setTimeout(r, POLL_MS));
                    }
                    // Push start trigger to all followers (3s grace gives all peers time to receive)
                    startAt = Date.now() + 3000;
                    yield Promise.all(followers.map((peer) => __awaiter(this, void 0, void 0, function* () {
                        const r = yield this.syncPeerXhr('POST', `http://${peer.ipAddress}:${NODE_PORT}/sync-peer/start`, { syncGroupId, startAt }, HTTP_TIMEOUT_MS);
                        if (r.ok) {
                            logger.info(`SyncPlay leader: start pushed to ${peer.ipAddress} OK`);
                        }
                        else {
                            logger.warn(`SyncPlay leader: start push to ${peer.ipAddress} failed (status=${r.status})`);
                        }
                    })));
                    logger.info(`SyncPlay leader: start triggers sent, startAt=${startAt}`);
                }
                else {
                    // Follower: poll local bridge for start trigger from leader
                    logger.info('SyncPlay follower: polling local bridge for start trigger...');
                    startAt = 0;
                    const deadline = Date.now() + TIMEOUT_MS;
                    let pollCount = 0;
                    while (Date.now() < deadline) {
                        pollCount++;
                        const r = yield this.syncPeerXhr('GET', `http://127.0.0.1:${NODE_PORT}/sync-peer/start-trigger?syncGroupId=${encodeURIComponent(syncGroupId)}`, null, HTTP_TIMEOUT_MS);
                        if (r.ok && r.json && r.json.startAt) {
                            startAt = Number(r.json.startAt);
                            logger.info(`SyncPlay follower: received startAt=${startAt} after ${pollCount} poll(s)`);
                            break;
                        }
                        if (pollCount % 10 === 0) {
                            logger.info(`SyncPlay follower: still waiting for start trigger (poll #${pollCount})`);
                        }
                        yield new Promise((r) => setTimeout(r, 1000));
                    }
                    if (!startAt) {
                        logger.warn('SyncPlay follower: timed out waiting for start trigger; starting now');
                        startAt = Date.now() + 500;
                    }
                }
                // Wait until the coordinated start time
                const wait = Math.max(0, startAt - Date.now());
                if (wait > 0) {
                    logger.info(`SyncPlay: waiting ${wait}ms for coordinated start`);
                    yield new Promise((r) => setTimeout(r, wait));
                }
                // All devices start SyncPlay simultaneously via official Samsung API
                logger.info('SyncPlay: invoking startSyncPlayNative now (coordinated start)');
                yield this.startSyncPlayNative({ groupId: groupID, folderId: groupID });
            }
            catch (err) {
                logger.error('SyncPlay coordination error:', err);
            }
            finally {
                this.syncCoordinationInProgress = false;
                this.syncCoordinationSignature = null;
                logger.info('SyncPlay coordination: finished, in-progress flag cleared');
            }
        });
    },
    getSyncPlayFileName(content, item, index) {
        return __awaiter(this, void 0, void 0, function* () {
            const getExt = (url) => {
                if (!url || typeof url !== 'string')
                    return null;
                const clean = url.split('?')[0].split('#')[0];
                const lastSlash = clean.lastIndexOf('/');
                const base = lastSlash >= 0 ? clean.slice(lastSlash + 1) : clean;
                const dot = base.lastIndexOf('.');
                if (dot <= 0 || dot === base.length - 1)
                    return null;
                return base.slice(dot + 1).toLowerCase();
            };
            const url = (content === null || content === void 0 ? void 0 : content.url) || (item === null || item === void 0 ? void 0 : item.contentUrl) || (item === null || item === void 0 ? void 0 : item.url);
            // Try URL first, then originalName (preserves real extension like .mp4/.jpg)
            const ext = getExt(url) || getExt(content === null || content === void 0 ? void 0 : content.originalName) || getExt(item === null || item === void 0 ? void 0 : item.originalName) || (() => {
                // Last resort: derive from mimeType
                const mime = ((content === null || content === void 0 ? void 0 : content.mimeType) || '').toLowerCase();
                if (mime.includes('mp4') || mime.includes('mpeg'))
                    return 'mp4';
                if (mime.includes('webm'))
                    return 'webm';
                if (mime.includes('jpeg') || mime.includes('jpg'))
                    return 'jpg';
                if (mime.includes('png'))
                    return 'png';
                if (mime.includes('gif'))
                    return 'gif';
                if (mime.includes('pdf'))
                    return 'pdf';
                return null;
            })();
            // SyncPlay requires IDENTICAL file paths across devices.
            // Use contentId (stable across devices) rather than playlist index.
            const rawId = String((content === null || content === void 0 ? void 0 : content.id) || (item === null || item === void 0 ? void 0 : item.contentId) || index);
            const safeId = rawId.replace(/[^a-zA-Z0-9-_]/g, '_');
            if (!ext) {
                // Keep deterministic even when extension can't be derived.
                return `sync-${safeId}.bin`;
            }
            return `sync-${safeId}.${ext}`;
        });
    },
    prepareSyncPlaylistNative(data) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.isSyncplayAvailable()) {
                logger.warn('Syncplay: prepareSyncPlaylistNative called but no SyncPlay backend available');
                return false;
            }
            logger.info(`Syncplay: prepareSyncPlaylistNative starting, backend=${this.syncplayBackend}`);
            try {
                const { playlistItems = [], groupId, suppressIdleScreen } = data || {};
                logger.info(`Syncplay: building contents for ${playlistItems.length} item(s)`);
                const contentsArr = yield this.buildSyncplayContents(playlistItems, { requireLocal: true, suppressIdleScreen: !!suppressIdleScreen });
                logger.info(`Syncplay: built ${contentsArr.length} content(s) for native playlist`);
                if (!contentsArr.length) {
                    logger.error('Syncplay: no playable items for native playlist');
                    return false;
                }
                // Pre-clean: remove any existing playlist
                logger.info('Syncplay: pre-cleaning previous playlist (if any)');
                if (this.syncplayBackend === 'b2bapis') {
                    try {
                        window.b2bapis.b2bsyncplay.clearSyncPlayList((res) => logger.debug('Syncplay: pre-clean clearSyncPlayList ok', res === null || res === void 0 ? void 0 : res.result), (err) => logger.debug('Syncplay: pre-clean clearSyncPlayList error (ignored)', err === null || err === void 0 ? void 0 : err.message));
                    }
                    catch (e) {
                        logger.debug('Syncplay: clearSyncPlayList pre-clean failed (ignored)', e);
                    }
                }
                else {
                    try {
                        webapis.syncplay.removePlaylist((res) => logger.debug('Syncplay: pre-clean removePlaylist ok', res === null || res === void 0 ? void 0 : res.result), (err) => logger.debug('Syncplay: pre-clean removePlaylist error (ignored)', err === null || err === void 0 ? void 0 : err.message));
                    }
                    catch (e) {
                        logger.debug('Syncplay: removePlaylist pre-clean failed (ignored)', e);
                    }
                }
                logger.info(`Syncplay: calling ${this.syncplayBackend === 'b2bapis' ? 'b2bsyncplay.makeSyncPlayList' : 'syncplay.createPlaylist'} with ${contentsArr.length} item(s)`);
                yield Promise.race([
                    new Promise((resolve, reject) => {
                        const onSuccess = (res) => {
                            logger.info('Syncplay: playlist created', res === null || res === void 0 ? void 0 : res.result, res === null || res === void 0 ? void 0 : res.data);
                            resolve();
                        };
                        const onError = (err) => {
                            // Samsung's native error object may not have enumerable properties — extract by name.
                            const fields = {};
                            try {
                                ['name', 'message', 'code', 'type', 'data', 'result', 'reason'].forEach((k) => {
                                    try {
                                        if (err && err[k] !== undefined)
                                            fields[k] = err[k];
                                    }
                                    catch (_) { }
                                });
                            }
                            catch (_) { }
                            let typeofErr = 'unknown';
                            try {
                                typeofErr = typeof err;
                            }
                            catch (_) { }
                            let ownProps = [];
                            try {
                                ownProps = err ? Object.getOwnPropertyNames(err) : [];
                            }
                            catch (_) { }
                            logger.error(`Syncplay: createPlaylist onError fired typeof=${typeofErr} ownProps=${JSON.stringify(ownProps)} fields=${JSON.stringify(fields)}`);
                            reject(err || new Error('Syncplay: createPlaylist onError with empty error'));
                        };
                        try {
                            if (this.syncplayBackend === 'b2bapis') {
                                window.b2bapis.b2bsyncplay.makeSyncPlayList(contentsArr, onSuccess, onError);
                            }
                            else {
                                webapis.syncplay.createPlaylist(contentsArr, onSuccess, onError);
                            }
                        }
                        catch (e) {
                            logger.error('Syncplay: createPlaylist threw synchronously', e);
                            reject(e);
                        }
                    }),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Syncplay: createPlaylist timed out after 30s')), 30000)),
                ]);
                logger.info('Syncplay: createPlaylist promise resolved');
                // New playlist prepared => treat as not-started yet.
                this.isSyncStarting = false;
                this.isSyncPlaying = false;
                this.syncPlayMode = 'native';
                this.syncPlaylistState = Object.assign(Object.assign({}, (this.syncPlaylistState || {})), { items: playlistItems, prepared: true, folderId: data.folderId });
                this.showSyncNotification('Sync playlist ready (native)', 'success');
                logger.info('Syncplay: playlist prepared (native)');
                return true;
            }
            catch (err) {
                const errMsg = (err && (err.message || err.name)) || String(err);
                logger.error(`Syncplay: prepare playlist native failed: ${errMsg}`);
                this.syncplayCreateListFailedAt = Date.now();
                return false;
            }
        });
    },
    startSyncPlayNative() {
        return __awaiter(this, arguments, void 0, function* (data = {}) {
            var _a, _b, _c, _d, _f, _g;
            if (!this.isSyncplayAvailable())
                return false;
            const enforceSyncplayFullscreen = () => {
                try {
                    // Make body transparent to show SyncPlay hardware layer (like AVPlay)
                    document.body.classList.add('avplay-active');
                }
                catch (_) { }
                try {
                    const container = document.getElementById('content-container');
                    if (container)
                        container.innerHTML = '';
                }
                catch (_) { }
            };
            // Prevent duplicate start calls
            if ((this.isSyncPlaying || this.isSyncStarting) && this.syncPlayMode === 'native') {
                logger.warn('SyncPlay already started, ignoring duplicate start call');
                // Even if start is ignored, still force fullscreen rendering state.
                enforceSyncplayFullscreen();
                return true;
            }
            // In the per-playlist model we always prepare first, then start.
            if (!((_a = this.syncPlaylistState) === null || _a === void 0 ? void 0 : _a.prepared)) {
                logger.warn('SyncPlay start requested but playlist is not prepared; ignoring');
                return false;
            }
            this.isSyncStarting = true;
            this.isSyncPlaying = false;
            // Stop ONLY non-sync playback. Do not call cancelCurrentPlayback() here because it can
            // cancel the orchestration/prep flow and make devices diverge.
            try {
                (_b = this.stopSeamlessAVPlay) === null || _b === void 0 ? void 0 : _b.call(this);
            }
            catch (_) { }
            try {
                (_c = this.resetAvPlay) === null || _c === void 0 ? void 0 : _c.call(this);
            }
            catch (_) { }
            try {
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
                        try {
                            (_f = (_d = video).load) === null || _f === void 0 ? void 0 : _f.call(_d);
                        }
                        catch (_) { }
                    }
                    container.innerHTML = '';
                }
            }
            catch (_) { }
            // SyncPlay rect is in device pixels; CSS pixels can produce a quarter-screen on 4K panels.
            // Some Samsung firmwares report the web runtime size (1920x1080) even on UHD panels.
            // We will probe a UHD rect and immediately fall back if rejected.
            const display = yield this.getPhysicalDisplaySize();
            let rect = { x: 0, y: 0, width: display.width, height: display.height };
            const rotate = 'OFF';
            // NOTE: Samsung B2B firmware (Tizen 4 SBB) may use a 3840×2160 virtual coordinate
            // space even on FHD panels — productinfo:uhd-flag reports UHD and 1920×1080 renders
            // as quarter-screen. We probe both sizes in the candidates loop below.
            logger.info(`SyncPlay display rect: ${rect.width}x${rect.height} (backend=${this.syncplayBackend})`);
            // SyncPlay groupID must be a small integer (16-bit on many firmwares).
            // Derive it deterministically from folderId/UUID.
            const folderIdSource = (data === null || data === void 0 ? void 0 : data.groupId) ||
                (data === null || data === void 0 ? void 0 : data.groupID) ||
                (data === null || data === void 0 ? void 0 : data.folderId) ||
                ((_g = this.syncPlaylistState) === null || _g === void 0 ? void 0 : _g.folderId) ||
                this.getCurrentFolderId();
            const groupId = this.deriveSyncplayGroupId(folderIdSource);
            const baseSyncinfo = {
                rectX: rect.x,
                rectY: rect.y,
                rectWidth: rect.width,
                rectHeight: rect.height,
                groupID: groupId,
                rotate,
            };
            const listener = (msg) => {
                const event = typeof msg === 'string'
                    ? msg
                    : (msg && typeof msg === 'object' && msg.data)
                        ? msg.data
                        : String(msg);
                logger.info('Syncplay status:', event);
                const clearWatchdog = () => {
                    if (this.syncStartWatchdog) {
                        try {
                            clearTimeout(this.syncStartWatchdog);
                        }
                        catch (_) { }
                        this.syncStartWatchdog = null;
                    }
                };
                // Handle sync play events
                if (event === 'SYNC_PLAY_START_DONE') {
                    logger.info('Syncplay started successfully on this device');
                    this.isSyncPlaying = true;
                    this.isSyncStarting = false;
                    clearWatchdog();
                    // Re-add avplay-active here: old-session phantom STOP_DONEs (from accumulated
                    // firmware listener registrations across app restarts) may have removed it.
                    // START_DONE is the authoritative signal that video IS playing — always show it.
                    try {
                        document.body.classList.add('avplay-active');
                    }
                    catch (_) { }
                }
                else if (event === 'SYNC_PLAY_STOP_DONE') {
                    // Ignore phantom STOP events that arrive while still in probe/startup phase.
                    // stopListenerSafe() between rect candidates triggers these asynchronously;
                    // they must not tear down rendering state set up by the successful start().
                    if (this.isSyncStarting) {
                        logger.debug('Syncplay: ignoring STOP_DONE during startup phase (probe cleanup)');
                        return;
                    }
                    logger.info('Syncplay stopped on this device');
                    this.isSyncPlaying = false;
                    this.isSyncStarting = false;
                    clearWatchdog();
                    // Remove fullscreen class when playback stops
                    document.body.classList.remove('avplay-active');
                }
                else if (event === 'SYNC_PLAY_FINISH_DONE') {
                    logger.info('Syncplay finished on this device');
                    this.isSyncStarting = false;
                    clearWatchdog();
                    // Playback completed, remove fullscreen class
                    document.body.classList.remove('avplay-active');
                }
            };
            try {
                logger.info(`[SYNC TIMING] calling syncplay start now at ${Date.now()}`);
                // CRITICAL: Unconditionally clear any previously-registered firmware callback slot.
                // b2bapis (Tizen 4 SBB) keeps a SINGLE global slot. A failed startSyncPlay() leaves
                // it occupied with the listener that was passed. stopSyncPlay() MUST receive the SAME
                // listener reference to release the slot — a new `() => {}` is never recognised.
                // We use `listener` (the function defined just above) which is reused across all
                // candidates and across calls, so it matches whatever was left in the slot.
                try {
                    logger.debug('Pre-clearing SyncPlay callback slot (unconditional)');
                    if (this.syncplayBackend === 'b2bapis') {
                        window.b2bapis.b2bsyncplay.stopSyncPlay(listener);
                    }
                    else {
                        webapis.syncplay.stop(listener);
                    }
                }
                catch (_) { }
                // Give firmware time to fully de-register the old slot before calling startSyncPlay.
                // b2bapis (Tizen 4) is slower — needs 500 ms; webapis is fine with 200 ms.
                yield new Promise(r => setTimeout(r, this.syncplayBackend === 'b2bapis' ? 500 : 200));
                // b2bapis: startSyncPlay(x, y, w, h, groupID, rotate, onChange)  — positional args (Tizen 4 SBB)
                // webapis:  start(syncinfo, listener)                             — object arg   (Tizen 6.5+)
                const invokeStart = (syncinfo) => {
                    if (this.syncplayBackend === 'b2bapis') {
                        window.b2bapis.b2bsyncplay.startSyncPlay(syncinfo.rectX, syncinfo.rectY, syncinfo.rectWidth, syncinfo.rectHeight, syncinfo.groupID, syncinfo.rotate, listener);
                    }
                    else {
                        webapis.syncplay.start(syncinfo, listener);
                    }
                };
                // showWindow is called AFTER a successful start (using the actual winning rect),
                // so that we never pass an unsupported size (e.g. 3840 on an FHD-only SBB panel).
                // Detailed error description helper (Samsung WebAPIException is opaque to JSON.stringify).
                const describeError = (e) => {
                    if (!e)
                        return 'null';
                    try {
                        const fields = {};
                        ['name', 'message', 'code', 'type', 'data', 'result', 'reason'].forEach((k) => {
                            try {
                                if (e[k] !== undefined)
                                    fields[k] = e[k];
                            }
                            catch (_) { }
                        });
                        let ownProps = [];
                        try {
                            ownProps = Object.getOwnPropertyNames(e);
                        }
                        catch (_) { }
                        return `typeof=${typeof e} ownProps=${JSON.stringify(ownProps)} fields=${JSON.stringify(fields)} stringified=${String(e)}`;
                    }
                    catch (_) {
                        return String(e);
                    }
                };
                // Try a series of rect candidates for webapis (Tizen 6.5 QBC). Some Samsung firmwares
                // mis-report panel size via systeminfo:DISPLAY (returning FHD on UHD panels), so we
                // probe UHD first. Between attempts we MUST fully stop() the listener — partial
                // registration from a thrown start() leaves the listener slot occupied and the next
                // start() will throw "Can't register callback" / similar opaque errors.
                const stopListenerSafe = () => __awaiter(this, void 0, void 0, function* () {
                    try {
                        if (this.syncplayBackend === 'b2bapis') {
                            // MUST pass the same `listener` reference that was given to startSyncPlay.
                            // b2bapis firmware tracks the registered callback by reference — passing a
                            // different function (e.g. `() => {}`) is ignored and the slot stays occupied,
                            // causing all subsequent startSyncPlay calls to throw "Can't register callback".
                            try {
                                window.b2bapis.b2bsyncplay.stopSyncPlay(listener);
                            }
                            catch (_) { }
                        }
                        else {
                            try {
                                webapis.syncplay.stop(listener);
                            }
                            catch (_) { }
                        }
                    }
                    catch (_) { }
                    // Wait for firmware to fully release the slot before the next startSyncPlay() call.
                    // b2bapis (Tizen 4) is slower — needs 500 ms; webapis is fine with 200 ms.
                    yield new Promise(r => setTimeout(r, this.syncplayBackend === 'b2bapis' ? 500 : 200));
                });
                let syncinfoToUse = baseSyncinfo;
                let lastErr = null;
                // Build candidate rect list.
                //
                // b2bapis (SBB, Tizen 4): ALWAYS use 1920×1080. The 3840×2160 probe was removed
                // because b2bapis.startSyncPlay() consistently rejects 3840×2160 with "Invalid Rect"
                // on every known SBB model, but — crucially — the failed call STILL occupies the
                // singleton callback slot. stopSyncPlay() between candidates only releases the slot on
                // an ACTIVE session; after a failed start there is no session, so the slot stays taken
                // and the second candidate always fails with "Can't register callback". Skipping the
                // doomed UHD probe means only one startSyncPlay() call is needed per session.
                //
                // webapis (QBC, Tizen 6.5): also use 1920×1080 directly. The tvWindow hardware plane
                // that SyncPlay renders through is controlled by the rect in syncplay.start() — calling
                // tvWindow.show() afterward overrides that placement and causes quarter-screen rendering.
                // showWindow is therefore skipped for webapis as well.
                const candidates = [];
                if (this.syncplayBackend === 'b2bapis') {
                    // SBB: always FHD. UHD is rejected and wastes the singleton callback slot.
                    candidates.push(Object.assign(Object.assign({}, baseSyncinfo), { rectWidth: 1920, rectHeight: 1080 }));
                }
                else if (Number(baseSyncinfo.rectWidth) >= 3840) {
                    // webapis UHD panel reported: try UHD, then FHD fallback.
                    candidates.push(baseSyncinfo);
                    candidates.push(Object.assign(Object.assign({}, baseSyncinfo), { rectWidth: 1920, rectHeight: 1080 }));
                }
                else {
                    // webapis FHD panel: use detected size directly.
                    candidates.push(baseSyncinfo);
                }
                let started = false;
                for (let i = 0; i < candidates.length; i++) {
                    const candidate = candidates[i];
                    try {
                        logger.info(`SyncPlay rect attempt ${i + 1}/${candidates.length}: ${candidate.rectWidth}x${candidate.rectHeight}`);
                        invokeStart(candidate);
                        syncinfoToUse = candidate;
                        started = true;
                        // NOTE: showWindow is intentionally NOT called here for webapis (QBC).
                        // webapis.syncplay.start(syncinfo) positions the content via the syncinfo rect;
                        // a subsequent tvWindow.show() call overrides that placement and causes
                        // quarter-screen rendering. For b2bapis (SBB), showWindow was also removed
                        // since the single 1920×1080 attempt handles positioning correctly.
                        break;
                    }
                    catch (err) {
                        lastErr = err;
                        logger.warn(`SyncPlay rect ${candidate.rectWidth}x${candidate.rectHeight} rejected: ${describeError(err)}`);
                        yield stopListenerSafe();
                    }
                }
                if (!started) {
                    throw lastErr || new Error('SyncPlay start: all rect candidates rejected');
                }
                this.syncPlayListener = listener;
                this.syncPlayMode = 'native';
                enforceSyncplayFullscreen();
                logger.debug('Ensured avplay-active class for SyncPlay fullscreen rendering');
                logger.info('Syncplay: started (native)', Object.assign(Object.assign({}, syncinfoToUse), { folderIdSource }));
                // Watchdog: if SYNC_PLAY_START_DONE never fires within 30s, recover state so the
                // player can fall back to non-sync content rather than wedging on isSyncStarting.
                if (this.syncStartWatchdog) {
                    try {
                        clearTimeout(this.syncStartWatchdog);
                    }
                    catch (_) { }
                }
                this.syncStartWatchdog = setTimeout(() => {
                    if (this.isSyncStarting && !this.isSyncPlaying) {
                        logger.error('Syncplay: start watchdog fired — SYNC_PLAY_START_DONE never received, tearing down');
                        try {
                            this.stopSyncPlayNative();
                        }
                        catch (_) { }
                        this.isSyncStarting = false;
                    }
                    this.syncStartWatchdog = null;
                }, 30000);
                return true;
            }
            catch (err) {
                const fields = {};
                try {
                    ['name', 'message', 'code', 'type', 'data', 'result', 'reason'].forEach((k) => {
                        try {
                            if (err && err[k] !== undefined)
                                fields[k] = err[k];
                        }
                        catch (_) { }
                    });
                }
                catch (_) { }
                let ownProps = [];
                try {
                    ownProps = err ? Object.getOwnPropertyNames(err) : [];
                }
                catch (_) { }
                logger.error(`Syncplay: start failed typeof=${typeof err} ownProps=${JSON.stringify(ownProps)} fields=${JSON.stringify(fields)} stringified=${String(err)}`);
                // Best-effort cleanup: some firmwares keep the callback registered even after an exception.
                // Use the local `listener` reference (same one passed to startSyncPlay) so b2bapis
                // firmware can match and release the slot — `this.syncPlayListener` may be null here
                // because the successful-start assignment was never reached.
                try {
                    if (this.syncplayBackend === 'b2bapis') {
                        try {
                            window.b2bapis.b2bsyncplay.stopSyncPlay(listener);
                        }
                        catch (_) { }
                    }
                    else {
                        try {
                            webapis.syncplay.stop(listener);
                        }
                        catch (_) { }
                    }
                }
                catch (_) { }
                this.syncPlayListener = null;
                this.isSyncStarting = false;
                this.isSyncPlaying = false;
                if (this.syncStartWatchdog) {
                    try {
                        clearTimeout(this.syncStartWatchdog);
                    }
                    catch (_) { }
                    this.syncStartWatchdog = null;
                }
                return false;
            }
        });
    },
    stopSyncPlayNative() {
        if (!this.isSyncplayAvailable())
            return false;
        // Stop active SyncPlay session and unregister the listener.
        try {
            const listener = this.syncPlayListener || ((msg) => logger.info('Syncplay stop status:', msg));
            if (this.syncplayBackend === 'b2bapis') {
                window.b2bapis.b2bsyncplay.stopSyncPlay(listener);
            }
            else {
                webapis.syncplay.stop(listener);
            }
        }
        catch (err) {
            logger.warn('Syncplay: stop failed', err);
        }
        // Reset the firmware playlist so the next session can build a fresh one.
        try {
            if (this.syncplayBackend === 'b2bapis') {
                window.b2bapis.b2bsyncplay.clearSyncPlayList((res) => logger.debug('Syncplay: clearSyncPlayList ok', res === null || res === void 0 ? void 0 : res.result), (err) => logger.debug('Syncplay: clearSyncPlayList error (ignored)', err === null || err === void 0 ? void 0 : err.message));
            }
            else {
                webapis.syncplay.removePlaylist((res) => logger.debug('Syncplay: removePlaylist ok', res === null || res === void 0 ? void 0 : res.result), (err) => logger.debug('Syncplay: removePlaylist error (ignored)', err === null || err === void 0 ? void 0 : err.message));
            }
        }
        catch (err) {
            logger.debug('Syncplay: removePlaylist/clearSyncPlayList failed (ignored)', err);
        }
        // Remove fullscreen rendering class
        document.body.classList.remove('avplay-active');
        this.syncPlayMode = 'none';
        this.syncPlayListener = null;
        this.isSyncStarting = false;
        this.isSyncPlaying = false;
        if (this.syncStartWatchdog) {
            try {
                clearTimeout(this.syncStartWatchdog);
            }
            catch (_) { }
            this.syncStartWatchdog = null;
        }
        return true;
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
        // Show idle screen with message
        this.showIdleScreen();
        // Restart pairing after a short delay
        setTimeout(() => {
            if (typeof Pairing !== 'undefined') {
                location.reload(); // Reload to restart pairing process
            }
        }, 3000);
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
