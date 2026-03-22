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
const Player = {
    deviceId: null,
    deviceName: null,
    heartbeatInterval: null,
    telemetryInterval: null,
    commandPollInterval: null,
    contentRefreshInterval: null,
    wsConnection: null,
    currentContent: null,
    currentItem: null,
    currentPlaylist: null,
    currentIndex: 0,
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
    deviceToken: null,
    currentAvPlayProfileKey: null,
    isSyncPlaying: false,
    isSyncStarting: false,
    syncPlayMode: 'none',
    syncPlayListener: null,
    // NTP time synchronization
    ntpOffset: 0, // Offset in milliseconds from server time
    ntpSyncInProgress: false,
    lastNtpSync: 0,
    // Seamless AVPlay playlist support
    avPlayer1: null,
    avPlayer2: null,
    currentAvPlayer: null,
    seamlessPlaylistActive: false,
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
            // Start background tasks
            this.startHeartbeat();
            this.startTelemetry();
            this.startCommandPolling();
            this.startNtpSync(); // Periodic NTP sync to keep clocks aligned
            // Load initial content
            yield this.loadContent();
            // Setup refresh interval
            this.startContentRefresh();
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
                this.updateConnectionStatus(true);
            };
            this.wsConnection.onmessage = (event) => {
                this.handleWebSocketMessage(event.data);
            };
            this.wsConnection.onerror = (error) => {
                logger.error('WebSocket error:', error);
                this.updateConnectionStatus(false);
            };
            this.wsConnection.onclose = () => {
                logger.warn('WebSocket disconnected, reconnecting in 5s...');
                this.updateConnectionStatus(false);
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
                // ── Our API WS commands (snake_case from server → ws.ts) ───────────
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
                case 'start_live_capture':
                    this.executeCommand({ type: 'START_LIVE_CAPTURE', payload: message.payload });
                    break;
                case 'stop_live_capture':
                    this.executeCommand({ type: 'STOP_LIVE_CAPTURE' });
                    break;
                case 'update_player':
                    logger.info('update_player command received:', message.payload);
                    if (typeof AppUpdater !== 'undefined') {
                        AppUpdater.handle(message, (statusType, data) => {
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
                // ── Legacy event names (kept for compatibility) ────────────────────
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
        this.heartbeatInterval = setInterval(() => __awaiter(this, void 0, void 0, function* () {
            try {
                // Heartbeat is sent via WebSocket only
                this.sendWebSocketHeartbeat();
                logger.debug('WS heartbeat sent');
            }
            catch (error) {
                // If device was deleted (404), return to pairing
                if (error.message && error.message.includes('404')) {
                    logger.warn('Device not found during heartbeat (deleted). Returning to pairing...');
                    this.handleDeviceDeleted();
                    return;
                }
                logger.warn('Heartbeat failed:', error);
            }
        }), CONFIG.HEARTBEAT_INTERVAL);
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
        const playback = this.getHeartbeatPlaybackState();
        return {
            deviceId: this.deviceId,
            folderId,
            downloadPct,
            driftMs: this.ntpOffset || 0,
            avState,
            buffered,
            ready,
            displayRect: this.getDisplayRect(),
            currentContentId: playback.currentContentId,
            nextContentId: playback.nextContentId,
            nextStartsAt: playback.nextStartsAt,
        };
    },
    getDisplayRect() {
        return {
            left: 0,
            top: 0,
            width: Math.max(window.innerWidth || 0, 1920),
            height: Math.max(window.innerHeight || 0, 1080),
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
    getHeartbeatPlaybackState() {
        var _a, _b, _c, _d;
        const currentItem = this.currentItem;
        const currentContentId = String(((_a = currentItem === null || currentItem === void 0 ? void 0 : currentItem.content) === null || _a === void 0 ? void 0 : _a.id) || (currentItem === null || currentItem === void 0 ? void 0 : currentItem.contentId) || '') || null;
        const playlistItems = Array.isArray(this.currentPlaylist) ? this.currentPlaylist : [];
        if (!playlistItems.length || this.currentIndex < 0 || this.currentIndex >= playlistItems.length) {
            return { currentContentId, nextContentId: null, nextStartsAt: null };
        }
        if (playlistItems.length < 2) {
            return { currentContentId, nextContentId: null, nextStartsAt: null };
        }
        const nextIndex = (this.currentIndex + 1) % playlistItems.length;
        const nextItem = playlistItems[nextIndex];
        const nextContentId = String(((_b = nextItem === null || nextItem === void 0 ? void 0 : nextItem.content) === null || _b === void 0 ? void 0 : _b.id) || (nextItem === null || nextItem === void 0 ? void 0 : nextItem.contentId) || '') || null;
        const durationSeconds = Number(((_d = (_c = currentItem === null || currentItem === void 0 ? void 0 : currentItem.duration) !== null && _c !== void 0 ? _c : currentItem === null || currentItem === void 0 ? void 0 : currentItem.content) === null || _d === void 0 ? void 0 : _d.duration) || 0);
        const nextStartsAt = currentContentId && nextContentId && durationSeconds > 0
            ? new Date(Date.now() + durationSeconds * 1000).toISOString()
            : null;
        return { currentContentId, nextContentId, nextStartsAt };
    },
    // Send lightweight heartbeat over WebSocket with readiness metrics
    sendWebSocketHeartbeat() {
        if (!this.wsConnection || this.wsConnection.readyState !== WebSocket.OPEN) {
            return;
        }
        const readiness = this.buildReadinessPayload();
        const payload = {
            clockDriftMs: readiness.driftMs,
            currentContentId: readiness.currentContentId,
            nextContentId: readiness.nextContentId,
            nextStartsAt: readiness.nextStartsAt,
        };
        const serialized = JSON.stringify(payload);
        const now = Date.now();
        if (serialized === this.lastReadinessPayload && now - this.lastReadinessAt < CONFIG.HEARTBEAT_INTERVAL) {
            return;
        }
        this.wsConnection.send(JSON.stringify({ type: 'heartbeat', payload }));
        this.lastReadinessPayload = serialized;
        this.lastReadinessAt = now;
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
        // Commands arrive via WebSocket — no HTTP polling needed
        logger.debug('Command polling disabled (using WebSocket)');
    },
    // Start content refresh
    startContentRefresh() {
        this.contentRefreshInterval = setInterval(() => {
            this.loadContent();
        }, CONFIG.CONTENT_REFRESH_INTERVAL);
    },
    // Try to swap to a pending downloaded playlist
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
                logger.info('Pending playlist ready, swapping immediately');
                // Show notification when download completes
                this.showDownloadNotification(content.playlistName || 'Content');
                // Force swap as soon as download completes
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
            var _a, _b, _c, _d, _e, _f, _g, _h;
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
                    const isPlaying = !!(isLegacyPlaying || isNativeSyncPlaying);
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
                            // If the playlist/group hasn't changed and native SyncPlay is already running (or starting),
                            // do NOT re-create/re-start it on every periodic refresh. That stop/start churn can produce
                            // immediate SYNC_PLAY_STOP_DONE right after a start.
                            const desiredGroupID = Number.isFinite(Number(content.syncPlay.groupID)) ? Number(content.syncPlay.groupID) : 5;
                            const previousWantsSamsungSyncPlay = !!(((_b = this.currentContent) === null || _b === void 0 ? void 0 : _b.syncPlay) && this.currentContent.syncPlay.enabled);
                            const previousGroupID = Number.isFinite(Number((_d = (_c = this.currentContent) === null || _c === void 0 ? void 0 : _c.syncPlay) === null || _d === void 0 ? void 0 : _d.groupID))
                                ? Number((_f = (_e = this.currentContent) === null || _e === void 0 ? void 0 : _e.syncPlay) === null || _f === void 0 ? void 0 : _f.groupID)
                                : 5;
                            const isNativeSyncActive = this.syncPlayMode === 'native' &&
                                ((_g = this.isSyncplayAvailable) === null || _g === void 0 ? void 0 : _g.call(this)) &&
                                (this.isSyncPlaying || this.isSyncStarting) &&
                                !!((_h = this.syncPlaylistState) === null || _h === void 0 ? void 0 : _h.prepared);
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
                            // Keep showing current playback while we prepare in background.
                            this.pendingPlaylist = null;
                            this.pendingSignature = null;
                            const playlistItems = content.items.map((item) => ({
                                contentId: item.contentId,
                                duration: item.duration,
                                position: item.position,
                            }));
                            // Prepare native SyncPlay playlist locally.
                            const groupID = desiredGroupID;
                            const usedNative = yield this.prepareSyncPlaylistNative({
                                playlistItems,
                                groupId: groupID,
                                folderId: groupID,
                            });
                            if (usedNative) {
                                // Start native SyncPlay now; scheduling alignment is handled by the schedule start time.
                                yield this.startSyncPlayNative({ groupId: groupID, folderId: groupID });
                                this.lastContentSignature = newSignature;
                                this.currentContent = content;
                                return;
                            }
                            logger.error('Samsung SyncPlay enabled but native prepare failed; falling back to regular playback');
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
        const container = document.getElementById('content-container');
        // Disconnect any active DataSync WebSocket before switching content
        if (typeof DataSyncRenderer !== 'undefined') {
            DataSyncRenderer.disconnect();
        }
        // Clear existing content
        container.innerHTML = '';
        if (!content || !content.type) {
            this.showIdleScreen();
            return;
        }
        logger.info('Rendering content:', content.type);
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
                this.renderHTML(container, content);
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
            default:
                logger.warn('Unknown content type:', content.type);
                this.showIdleScreen();
        }
    },
    // Render image content
    renderImage(container, content) {
        return __awaiter(this, void 0, void 0, function* () {
            // For local file:// URLs, we need to read the file and create a blob URL
            if (content.url && content.url.startsWith('file://')) {
                try {
                    logger.info('Converting local file to blob URL:', content.url);
                    // Extract file path from file:// URL
                    const filePath = content.url.replace('file://', '');
                    // Read file using Tizen filesystem
                    const pathParts = filePath.split('/');
                    const fileName = pathParts[pathParts.length - 1];
                    try {
                        // Try to resolve the file
                        const file = ContentManager.storageDir.resolve(fileName);
                        if (file) {
                            // Read file and generate blob/data URL for reliable playback
                            file.openStream('r', (fs) => {
                                const fileSize = file.fileSize || fs.bytesAvailable;
                                const bytes = fs.readBytes(fileSize);
                                fs.close();
                                const buffer = new Uint8Array(bytes);
                                const mimeType = this.getMimeType(fileName, content.contentType) || 'application/octet-stream';
                                let blobUrl = null;
                                let dataUrl = null;
                                try {
                                    const blob = new Blob([buffer], { type: mimeType });
                                    blobUrl = URL.createObjectURL(blob);
                                }
                                catch (blobError) {
                                    logger.warn('Failed to create blob URL, falling back to data URL:', blobError.message);
                                    dataUrl = this.bytesToDataUrl(buffer, mimeType);
                                }
                                const img = document.createElement('img');
                                img.style.width = '100%';
                                img.style.height = '100%';
                                img.style.objectFit = 'contain';
                                img.style.backgroundColor = '#000';
                                const useDataUrlFallback = () => {
                                    if (!dataUrl) {
                                        dataUrl = this.bytesToDataUrl(buffer, mimeType);
                                    }
                                    img.src = dataUrl;
                                };
                                img.onload = () => {
                                    logger.info('Image loaded successfully from local cache');
                                    if (blobUrl) {
                                        URL.revokeObjectURL(blobUrl);
                                    }
                                };
                                img.onerror = (error) => {
                                    if (blobUrl) {
                                        logger.warn('Blob URL failed to load, retrying with data URL');
                                        URL.revokeObjectURL(blobUrl);
                                        blobUrl = null;
                                        useDataUrlFallback();
                                        return;
                                    }
                                    logger.error('Image failed to load even after data URL fallback:', error);
                                    this.showImageError(container, content);
                                };
                                if (blobUrl) {
                                    img.src = blobUrl;
                                }
                                else {
                                    useDataUrlFallback();
                                }
                                container.appendChild(img);
                            }, (error) => {
                                logger.error('Failed to open file stream:', error);
                                this.showImageError(container, content);
                            });
                        }
                        else {
                            logger.error('File not found:', fileName);
                            this.showImageError(container, content);
                        }
                    }
                    catch (error) {
                        logger.error('Failed to resolve file:', error);
                        this.showImageError(container, content);
                    }
                    return;
                }
                catch (error) {
                    logger.error('Error converting file to blob:', error);
                }
            }
            // For remote URLs, use img tag directly
            const img = document.createElement('img');
            img.src = content.url;
            img.style.width = '100%';
            img.style.height = '100%';
            img.style.objectFit = 'contain';
            img.style.backgroundColor = '#000';
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
            sanitized = (new URL(value)).pathname || sanitized;
        }
        catch (_) { }
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
            // AVPlay setDisplayRect always uses 1920x1080 CSS coordinate space per Samsung API docs:
            // "based on a 1920x1080 resolution screen, regardless of the actual application resolution"
            // Do NOT use screen.width/height â€” on some Tizen firmwares it returns physical pixels (3840)
            // which causes InvalidValuesError or renders in a small window.
            const viewportWidth = Math.max(window.innerWidth || 0, 1920);
            const viewportHeight = Math.max(window.innerHeight || 0, 1080);
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
            // AVPlay coordinate space is always 1920x1080 â€” never use screen.width (physical pixels on some Tizen)
            const viewportWidth = Math.max(window.innerWidth || 0, 1920);
            const viewportHeight = Math.max(window.innerHeight || 0, 1080);
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
    renderIptvAVPlay(container, content) {
        const url = content.url;
        const isUdp = typeof url === 'string' && (url.startsWith('udp://') || url.startsWith('rtp://'));
        if (typeof Telemetry !== 'undefined' && Telemetry.updateIptvStats) {
            Telemetry.updateIptvStats({
                url,
                protocol: isUdp ? 'UDP' : 'HTTP',
                streamType: isUdp ? 'UDP' : 'HLS/DASH',
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
                    document.body.classList.remove('avplay-active');
                    if (typeof Telemetry !== 'undefined' && Telemetry.updateIptvStats) {
                        Telemetry.updateIptvStats({ lastError: String(e || 'unknown') });
                    }
                    this.showIdleScreen();
                },
                onstreamcompleted: () => {
                    logger.info('IPTV stream completed');
                    document.body.classList.remove('avplay-active');
                },
            });
            // 4. Configure for live/UDP where applicable
            try {
                webapis.avplay.setTimeoutForBuffering(10);
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
                    logger.debug('setStreamingProperty SET_STREAMTYPE failed');
                }
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
                    // Watchdog: check if playback actually starts
                    const watchdogDelay = isUdp ? 5000 : 7000;
                    setTimeout(() => {
                        var _a, _b, _c, _d;
                        try {
                            const state = (_b = (_a = webapis.avplay).getState) === null || _b === void 0 ? void 0 : _b.call(_a);
                            const time = (_d = (_c = webapis.avplay).getCurrentTime) === null || _d === void 0 ? void 0 : _d.call(_c);
                            if (state === 'PLAYING' && time === 0) {
                                logger.warn('IPTV AVPlay appears stalled (state:', state, 'time:', time, '). Showing idle screen');
                                document.body.classList.remove('avplay-active');
                                try {
                                    webapis.avplay.stop();
                                }
                                catch (_) { }
                                try {
                                    webapis.avplay.close();
                                }
                                catch (_) { }
                                this.showIdleScreen();
                            }
                            else {
                                logger.debug('IPTV watchdog OK - state:', state, 'time:', time);
                            }
                        }
                        catch (watchErr) {
                            logger.debug('IPTV watchdog check failed', watchErr);
                        }
                    }, watchdogDelay);
                }
                catch (playErr) {
                    logger.error('IPTV play failed:', playErr);
                    document.body.classList.remove('avplay-active');
                    this.showIdleScreen();
                }
            }, (prepErr) => {
                logger.error('IPTV prepare failed:', prepErr);
                document.body.classList.remove('avplay-active');
                this.showIdleScreen();
            });
        }
        catch (error) {
            logger.error('IPTV AVPlay error, fallback to HTML5:', error);
            this.renderVideoHTML5(container, content);
        }
    },
    resetAvPlay() {
        try {
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
        const viewportWidth = Math.max(window.innerWidth || 0, 1920);
        const viewportHeight = Math.max(window.innerHeight || 0, 1080);
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
        const viewportWidth = Math.max(window.innerWidth || 0, 1920);
        const viewportHeight = Math.max(window.innerHeight || 0, 1080);
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
        const viewportWidth = Math.max(window.innerWidth || 0, 1920);
        const viewportHeight = Math.max(window.innerHeight || 0, 1080);
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
                        const deviceToken = this.deviceToken || localStorage.getItem('deviceToken') || '';
                        const headers = {
                            'Content-Type': 'application/json',
                        };
                        if (deviceToken) {
                            headers.Authorization = `Bearer ${deviceToken}`;
                        }
                        const response = yield fetch(`${CONFIG.API_BASE}/devices/time`, {
                            method: 'GET',
                            headers,
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
                // Smooth small changes to avoid jitter from single measurements
                const prev = Number(this.ntpOffset);
                const isFirst = !Number.isFinite(prev) || !this.lastNtpSync;
                const delta = isFirst ? 0 : Math.abs(best.offset - prev);
                const nextOffset = isFirst || delta > 1000 ? best.offset : (prev * 0.8 + best.offset * 0.2);
                this.ntpOffset = nextOffset;
                this.lastNtpSync = Date.now();
                logger.info(`NTP sync complete: offset=${Math.round(nextOffset)}ms (raw=${Math.round(best.offset)}ms), bestRTT=${Math.round(best.rtt)}ms, samples=${samples.length}`);
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
    // Render HTML content
    renderHTML(container, content) {
        const iframe = document.createElement('iframe');
        iframe.src = content.url;
        iframe.style.width = '100%';
        iframe.style.height = '100%';
        iframe.style.border = 'none';
        iframe.allowFullscreen = true;
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
        this.currentPlaylist = playableItems;
        this.currentIndex = 0;
        this.currentItem = playableItems.length > 0 ? playableItems[0] : null;
        container.innerHTML = ''; // Clear container - AVPlay renders to hardware layer
        // AVPlay setDisplayRect coordinate space is always 1920x1080 per Samsung API docs
        const viewportWidth = Math.max(window.innerWidth || 0, 1920);
        const viewportHeight = Math.max(window.innerHeight || 0, 1080);
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
                this.currentIndex = currentIndex;
                this.currentItem = playableItems.length > currentIndex ? playableItems[currentIndex] : null;
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
        this.currentPlaylist = playableItems;
        this.currentIndex = Math.max(0, Math.min(startIndex, Math.max(playableItems.length - 1, 0)));
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
            this.currentIndex = currentIndex;
            this.currentItem = item;
            const duration = item.duration || 10; // Default 10 seconds
            logger.info(`Playing item ${currentIndex + 1}/${playableItems.length}: ${content.name} (${content.type}) - URL: ${content.url}`);
            const itemKey = this.getPlaylistItemKey(content);
            const canReuseImage = content.type === 'IMAGE' &&
                this.lastRenderedItemKey === itemKey &&
                container.children.length > 0;
            if (!canReuseImage) {
                container.innerHTML = '';
            }
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
                case 'WEBPAGE':
                    this.renderHTML(container, content);
                    // Schedule next item
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
        container.innerHTML = `
      <div class="idle-screen">
        <div class="idle-card">
          <div class="idle-icon">ðŸ“¡</div>
          <div class="idle-title">Digital Signage</div>
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
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m;
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
                // Default to virtual standby so POWER_ON can wake the panel
                this.invokeTVControl('powerOff', Object.assign({ virtualStandby: true }, (payload || {})));
                break;
            case 'REQUEST_LOG_BURST': {
                const max = (_a = payload === null || payload === void 0 ? void 0 : payload.max) !== null && _a !== void 0 ? _a : 200;
                try {
                    const batch = (window.LogBuffer && window.LogBuffer.drain(max)) || [];
                    if (batch.length && this.deviceId) {
                        logger.info('Uploading log burst:', batch.length);
                        API.sendLog(this.deviceId, batch).catch(err => logger.warn('Log burst upload failed:', err));
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
                // Power-on from off state is not supported on this device
                logger.warn('POWER_ON command received but not supported on this device');
                break;
            case 'SET_VIRTUAL_STANDBY':
                this.invokeTVControl('setVirtualStandbyMode', (_c = (_b = payload === null || payload === void 0 ? void 0 : payload.enabled) !== null && _b !== void 0 ? _b : payload) !== null && _c !== void 0 ? _c : false);
                break;
            case 'SET_VOLUME':
                this.invokeTVControl('setVolume', (_e = (_d = payload === null || payload === void 0 ? void 0 : payload.level) !== null && _d !== void 0 ? _d : command.level) !== null && _e !== void 0 ? _e : null);
                break;
            case 'VOLUME_UP':
                this.invokeTVControl('volumeUp', (_g = (_f = payload === null || payload === void 0 ? void 0 : payload.step) !== null && _f !== void 0 ? _f : payload === null || payload === void 0 ? void 0 : payload.amount) !== null && _g !== void 0 ? _g : 2);
                break;
            case 'VOLUME_DOWN':
                this.invokeTVControl('volumeDown', (_j = (_h = payload === null || payload === void 0 ? void 0 : payload.step) !== null && _h !== void 0 ? _h : payload === null || payload === void 0 ? void 0 : payload.amount) !== null && _j !== void 0 ? _j : 2);
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
                    Telemetry.setCastReady((_m = (_l = (_k = payload === null || payload === void 0 ? void 0 : payload.ready) !== null && _k !== void 0 ? _k : payload) !== null && _l !== void 0 ? _l : command === null || command === void 0 ? void 0 : command.ready) !== null && _m !== void 0 ? _m : null);
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
            case 'SCREENSHOT':
                this.takeScreenshot();
                break;
            case 'START_LIVE_CAPTURE': {
                const ms = Math.max(1000, (payload && payload.intervalMs) || 1000);
                if (this._liveInterval) clearTimeout(this._liveInterval);
                this._liveCaptureActive = true;
                this._liveCaptureIntervalMs = ms;
                this._liveInterval = setTimeout(() => this.takeScreenshotLive(), 0);
                logger.info('[LiveCapture] started, intervalMs:', ms);
                break;
            }
            case 'STOP_LIVE_CAPTURE':
                if (this._liveInterval) {
                    clearTimeout(this._liveInterval);
                    this._liveInterval = null;
                }
                this._liveCaptureActive = false;
                this._liveCaptureBusy = false;
                logger.info('[LiveCapture] stopped');
                break;
            case 'CLEAR_CACHE':
                this.clearCache();
                break;
            case 'SYNC_PLAY':
                this.handleSyncPlayCommand(payload || command);
                break;
            default:
                logger.warn('Unknown command:', command);
        }
    },
    takeScreenshot() {
        const ws = this.wsConnection;
        if (!ws || ws.readyState !== 1) {
            logger.warn('[Screenshot] WebSocket not connected, cannot send screenshot');
            return;
        }
        const send = (dataBase64) => {
            ws.send(JSON.stringify({
                type: 'screenshot_data',
                payload: { dataBase64, trigger: 'manual', contentId: null },
            }));
            logger.info('[Screenshot] screenshot_data sent, bytes:', dataBase64.length);
        };
        // Try b2bcontrol.captureScreen first (returns file path on Samsung LFD)
        try {
            const b2b = typeof b2bapis !== 'undefined' ? b2bapis.b2bcontrol : null;
            if (b2b && typeof b2b.captureScreen === 'function') {
                b2b.captureScreen(
                    (filePath) => {
                        logger.info('[Screenshot] captureScreen succeeded, path:', filePath);
                        try {
                            tizen.filesystem.resolve(filePath, (file) => {
                                file.openStream(
                                    'r',
                                    (stream) => {
                                        try {
                                            const bytes = stream.readBytes(file.fileSize);
                                            stream.close();
                                            let binary = '';
                                            for (let i = 0; i < bytes.length; i++) {
                                                binary += String.fromCharCode(bytes[i]);
                                            }
                                            send(btoa(binary));
                                        } catch (e) {
                                            logger.warn('[Screenshot] Failed to read stream bytes:', e);
                                        }
                                    },
                                    (e) => logger.warn('[Screenshot] openStream error:', e),
                                    'ISO-8859-1',
                                );
                            }, (e) => logger.warn('[Screenshot] filesystem.resolve failed:', e), 'r');
                        } catch (e) {
                            logger.warn('[Screenshot] filesystem access failed:', e);
                        }
                    },
                    (e) => logger.warn('[Screenshot] captureScreen error:', (e && e.message) || e),
                );
                return;
            }
        } catch (e) {
            logger.warn('[Screenshot] b2b captureScreen threw:', e);
        }
        // Fallback: HTML5 canvas DOM capture
        try {
            const canvas = document.createElement('canvas');
            canvas.width = window.innerWidth || 1920;
            canvas.height = window.innerHeight || 1080;
            const ctx = canvas.getContext('2d');
            if (!ctx) throw new Error('No 2d context');
            ctx.fillStyle = '#000';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
            const base64 = dataUrl.split(',')[1];
            send(base64);
        } catch (e) {
            logger.warn('[Screenshot] Canvas fallback failed:', e);
        }
    },
    takeScreenshotLive() {
        // Samsung captureScreen cannot handle concurrent calls — skip if previous hasn't finished
        if (this._liveCaptureBusy) return;
        this._liveCaptureBusy = true;
        const ws = this.wsConnection;
        if (!ws || ws.readyState !== 1) { this._liveCaptureBusy = false; return; }
        const done = () => {
            this._liveCaptureBusy = false;
            if (this._liveCaptureActive) {
                const nextMs = Math.max(1000, this._liveCaptureIntervalMs || 1000);
                this._liveInterval = setTimeout(() => this.takeScreenshotLive(), nextMs);
            }
        };
        const send = (dataBase64) => {
            ws.send(JSON.stringify({
                type: 'screenshot_data',
                payload: { dataBase64, trigger: 'live', contentId: null },
            }));
            done();
        };
        try {
            const b2b = typeof b2bapis !== 'undefined' ? b2bapis.b2bcontrol : null;
            if (b2b && typeof b2b.captureScreen === 'function') {
                b2b.captureScreen(
                    (filePath) => {
                        logger.info('[LiveCapture] captureScreen cb, path:', filePath);
                        try {
                            tizen.filesystem.resolve(filePath, (file) => {
                                file.openStream(
                                    'r',
                                    (stream) => {
                                        try {
                                            const bytes = stream.readBytes(file.fileSize);
                                            stream.close();
                                            let binary = '';
                                            for (let i = 0; i < bytes.length; i++) {
                                                binary += String.fromCharCode(bytes[i]);
                                            }
                                            send(btoa(binary));
                                        } catch (e) {
                                            logger.warn('[LiveCapture] read stream bytes failed:', e);
                                            done();
                                        }
                                    },
                                    (e) => { logger.warn('[LiveCapture] openStream error:', e); done(); },
                                    'ISO-8859-1',
                                );
                            }, (e) => { logger.warn('[LiveCapture] filesystem.resolve failed:', e); done(); }, 'r');
                        } catch (e) {
                            logger.warn('[LiveCapture] filesystem access failed:', e);
                            done();
                        }
                    },
                    (e) => { logger.warn('[LiveCapture] captureScreen error:', (e && e.message) || e); done(); },
                );
                return;
            }
        } catch (e) {
            logger.warn('[LiveCapture] b2b captureScreen threw:', e);
        }
        // Canvas fallback
        try {
            const canvas = document.createElement('canvas');
            canvas.width = window.innerWidth || 1920;
            canvas.height = window.innerHeight || 1080;
            const ctx = canvas.getContext('2d');
            if (ctx) {
                ctx.fillStyle = '#000';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                send(canvas.toDataURL('image/jpeg', 0.75).split(',')[1]);
                return;
            }
        } catch (e) {
            logger.warn('[LiveCapture] Canvas fallback failed:', e);
        }
        done();
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
    isSyncplayAvailable() {
        var _a, _b;
        const available = typeof webapis !== 'undefined' &&
            !!webapis.syncplay &&
            typeof webapis.syncplay.start === 'function' &&
            typeof webapis.syncplay.createPlaylist === 'function' &&
            typeof webapis.syncplay.stop === 'function';
        if (available) {
            try {
                const version = (_b = (_a = webapis.syncplay).getVersion) === null || _b === void 0 ? void 0 : _b.call(_a);
                if (version)
                    logger.debug('Syncplay API version:', version);
            }
            catch (_) { }
        }
        return available;
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
        // Stable FNV-1a 32-bit hash for strings (UUIDs, folder IDs, etc.)
        let hash = 0x811c9dc5;
        for (let i = 0; i < str.length; i++) {
            hash ^= str.charCodeAt(i);
            hash = Math.imul(hash, 0x01000193);
        }
        return clampToUint16(hash >>> 0);
    },
    getSyncplayFullscreenRect() {
        const width = Math.max((screen === null || screen === void 0 ? void 0 : screen.width) || 0, window.innerWidth || 0, 1920);
        const height = Math.max((screen === null || screen === void 0 ? void 0 : screen.height) || 0, window.innerHeight || 0, 1080);
        return { x: 0, y: 0, width, height };
    },
    buildSyncplayContents() {
        return __awaiter(this, arguments, void 0, function* (playlistItems = [], opts = {}) {
            const contents = [];
            const requireLocal = opts.requireLocal !== false;
            for (let i = 0; i < playlistItems.length; i++) {
                const item = playlistItems[i];
                try {
                    // Prefer embedded content, else fetch from API. If API is temporarily unavailable,
                    // fall back to any URL carried on the playlist item.
                    let content = item.content;
                    if (!content) {
                        try {
                            content = yield API.getContent(item.contentId);
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
                    contents.push({ path: syncPath, duration });
                }
                catch (err) {
                    logger.warn('Syncplay: failed to build item', item.contentId, err);
                }
            }
            return contents;
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
            const ext = getExt(url);
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
            if (!this.isSyncplayAvailable())
                return false;
            try {
                const { playlistItems = [], groupId } = data || {};
                const contentsArr = yield this.buildSyncplayContents(playlistItems, { requireLocal: true });
                if (!contentsArr.length) {
                    logger.error('Syncplay: no playable items for native playlist');
                    return false;
                }
                try {
                    webapis.syncplay.removePlaylist((res) => logger.debug('Syncplay: pre-clean removePlaylist ok', res === null || res === void 0 ? void 0 : res.result), (err) => logger.debug('Syncplay: pre-clean removePlaylist error (ignored)', err === null || err === void 0 ? void 0 : err.message));
                }
                catch (e) {
                    logger.debug('Syncplay: removePlaylist pre-clean failed (ignored)', e);
                }
                yield new Promise((resolve, reject) => {
                    webapis.syncplay.createPlaylist(contentsArr, (res) => {
                        logger.info('Syncplay: playlist created', res === null || res === void 0 ? void 0 : res.result, res === null || res === void 0 ? void 0 : res.data);
                        resolve(true);
                    }, (err) => {
                        logger.error('Syncplay: createPlaylist failed', err === null || err === void 0 ? void 0 : err.name, err === null || err === void 0 ? void 0 : err.message, '(code:', err === null || err === void 0 ? void 0 : err.code, ')');
                        reject(err);
                    });
                });
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
                logger.error('Syncplay: prepare playlist native failed', err);
                return false;
            }
        });
    },
    startSyncPlayNative() {
        return __awaiter(this, arguments, void 0, function* (data = {}) {
            var _a, _b, _c, _d, _e, _f, _g;
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
                            (_e = (_d = video).load) === null || _e === void 0 ? void 0 : _e.call(_d);
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
            logger.info(`SyncPlay display rect: ${rect.width}x${rect.height}`);
            // SyncPlay groupID must be a small integer (16-bit on many firmwares).
            // Derive it deterministically from folderId/UUID.
            const folderIdSource = (data === null || data === void 0 ? void 0 : data.groupId) ||
                (data === null || data === void 0 ? void 0 : data.groupID) ||
                (data === null || data === void 0 ? void 0 : data.folderId) ||
                ((_f = this.syncPlaylistState) === null || _f === void 0 ? void 0 : _f.folderId) ||
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
                // Handle sync play events
                if (event === 'SYNC_PLAY_START_DONE') {
                    logger.info('Syncplay started successfully on this device');
                    this.isSyncPlaying = true;
                    this.isSyncStarting = false;
                }
                else if (event === 'SYNC_PLAY_STOP_DONE') {
                    logger.info('Syncplay stopped on this device');
                    this.isSyncPlaying = false;
                    this.isSyncStarting = false;
                    // Remove fullscreen class when playback stops
                    document.body.classList.remove('avplay-active');
                }
                else if (event === 'SYNC_PLAY_FINISH_DONE') {
                    logger.info('Syncplay finished on this device');
                    this.isSyncStarting = false;
                    // Playback completed, remove fullscreen class
                    document.body.classList.remove('avplay-active');
                }
            };
            try {
                const sp = webapis.syncplay;
                logger.info(`[SYNC TIMING] calling sp.start() now at ${Date.now()}`);
                // CRITICAL: Stop any previous SyncPlay session to unregister old listener.
                // Calling start() when a listener is already registered causes "Can't register callback".
                if (this.syncPlayListener) {
                    try {
                        logger.debug('Stopping previous SyncPlay session before starting new one');
                        sp.stop(this.syncPlayListener);
                    }
                    catch (stopErr) {
                        logger.debug('Previous SyncPlay stop failed (ignored):', stopErr);
                    }
                }
                // Samsung docs: start(syncinfo: SyncInfo, onlistener: SyncplayListener) â€” official 2-arg signature.
                // Per spec the listener receives DOMString events: SYNC_PLAY_START_DONE, SYNC_PLAY_STOP_DONE, SYNC_PLAY_FINISH_DONE.
                const invokeStart = (syncinfo) => {
                    sp.start(syncinfo, listener);
                };
                // Best-effort: some firmwares tie the video plane to tvwindow state.
                // Force fullscreen TV window before starting SyncPlay.
                try {
                    (_g = this.invokeTVControl) === null || _g === void 0 ? void 0 : _g.call(this, 'showWindow', [0, 0, baseSyncinfo.rectWidth, baseSyncinfo.rectHeight], 'MAIN');
                }
                catch (_) { }
                // UHD probe: if we only see 1920x1080, attempt 3840x2160 first to avoid quarter-screen SyncPlay.
                // If firmware rejects it (throws), immediately fall back to the base rect.
                let syncinfoToUse = baseSyncinfo;
                const canProbeUhd = Number(baseSyncinfo.rectWidth) === 1920 &&
                    Number(baseSyncinfo.rectHeight) === 1080;
                if (canProbeUhd) {
                    const uhdSyncinfo = Object.assign(Object.assign({}, baseSyncinfo), { rectWidth: 3840, rectHeight: 2160 });
                    try {
                        logger.warn('SyncPlay rect probe: trying UHD 3840x2160 (fallback to 1920x1080 if rejected)');
                        invokeStart(uhdSyncinfo);
                        syncinfoToUse = uhdSyncinfo;
                    }
                    catch (probeErr) {
                        logger.warn('SyncPlay UHD rect probe rejected; falling back to 1920x1080', probeErr);
                        // IMPORTANT: some firmwares partially register callbacks even when start() throws.
                        // Stop the just-attempted listener before retrying, otherwise fallback start can fail
                        // with "Can't register callback".
                        try {
                            if (sp && typeof sp.stop === 'function') {
                                try {
                                    sp.stop(listener);
                                }
                                catch (_) { }
                            }
                        }
                        catch (_) { }
                        invokeStart(baseSyncinfo);
                        syncinfoToUse = baseSyncinfo;
                    }
                }
                else {
                    invokeStart(baseSyncinfo);
                }
                this.syncPlayListener = listener;
                this.syncPlayMode = 'native';
                enforceSyncplayFullscreen();
                logger.debug('Ensured avplay-active class for SyncPlay fullscreen rendering');
                logger.info('Syncplay: started (native)', Object.assign(Object.assign({}, syncinfoToUse), { folderIdSource }));
                return true;
            }
            catch (err) {
                logger.error('Syncplay: start failed', err);
                // Best-effort cleanup: some firmwares keep the callback registered even after an exception.
                try {
                    const sp = webapis.syncplay;
                    if (sp && typeof sp.stop === 'function') {
                        try {
                            sp.stop(this.syncPlayListener || (() => { }));
                        }
                        catch (_) { }
                    }
                }
                catch (_) { }
                this.isSyncStarting = false;
                this.isSyncPlaying = false;
                return false;
            }
        });
    },
    stopSyncPlayNative() {
        if (!this.isSyncplayAvailable())
            return false;
        try {
            const listener = this.syncPlayListener || ((msg) => logger.info('Syncplay stop status:', msg));
            webapis.syncplay.stop(listener);
        }
        catch (err) {
            logger.warn('Syncplay: stop failed', err);
        }
        try {
            webapis.syncplay.removePlaylist((res) => logger.debug('Syncplay: removePlaylist ok', res === null || res === void 0 ? void 0 : res.result), (err) => logger.debug('Syncplay: removePlaylist error (ignored)', err === null || err === void 0 ? void 0 : err.message));
        }
        catch (err) {
            logger.debug('Syncplay: removePlaylist failed (ignored)', err);
        }
        // Remove fullscreen rendering class
        document.body.classList.remove('avplay-active');
        this.syncPlayMode = 'none';
        this.syncPlayListener = null;
        this.isSyncStarting = false;
        this.isSyncPlaying = false;
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
