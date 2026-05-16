// API Helper Functions

window.API = {
  // ── POST /devices/pair/request ────────────────────────────────────────────
  async requestPairing(deviceInfo) {
    const url = `${CONFIG.API_BASE}/devices/pair/request`;
    try {
      const body = {
        duid: deviceInfo.duid || deviceInfo.serialNumber || null,
        modelName: deviceInfo.realModel || deviceInfo.model || deviceInfo.modelName || null,
        modelCode: deviceInfo.modelCode || null,
        serialNumber: deviceInfo.serialNumber || null,
        firmwareVersion: deviceInfo.firmwareVersion || null,
      };
      logger.info('[API] requestPairing → POST ' + url);
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      return await response.json(); // { status?, deviceId, code?, expiresAt?, deviceToken? }
    } catch (error) {
      // Tizen WebKit reports network/TLS/DNS failures as bare "Failed to fetch".
      // Log the resolved URL + cause so on-device errors are diagnosable.
      const cause = (error && (error.cause || error.message)) || String(error);
      logger.error('Failed to request pairing (url=' + url + ', api_base=' + CONFIG.API_BASE + '):', cause);
      throw error;
    }
  },

  // ── GET /devices/pair/status?code=CODE ────────────────────────────────────
  async checkPairing(code) {
    try {
      const response = await fetch(
        `${CONFIG.API_BASE}/devices/pair/status?code=${encodeURIComponent(code)}`
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      return await response.json(); // { status: 'pending' | 'claimed', deviceId?, deviceToken? }
    } catch (error) {
      logger.error('Failed to check pairing:', error);
      throw error;
    }
  },

  // ── heartbeat → sent via WebSocket; this is a no-op HTTP fallback ─────────
  async heartbeat(deviceId) {
    return { ok: true };
  },

  // ── sendTelemetry → forwarded as WebSocket messages ──────────────────────
  async sendTelemetry(deviceId, data) {
    try {
      const ws = window.Player && window.Player.wsConnection;
      if (ws && ws.readyState === 1) {
        var buildInfo = window && window.PLAYER_BUILD_INFO;
        var playerVersion = (buildInfo && (buildInfo.version + ' ' + buildInfo.buildId)) || window.PLAYER_DEPLOY_VERSION || undefined;

        // network_info message
        if (data.macAddress || data.ipAddress || data.wifiSsid || data.gateway || data.networkType) {
          ws.send(JSON.stringify({
            type: 'network_info',
            payload: {
              mac: data.macAddress || '',
              ip: data.ipAddress || '',
              gateway: data.gateway || undefined,
              connectionType: (data.networkType || '').toLowerCase().includes('wifi') ? 'wifi' : 'ethernet',
              wifiSsid: data.wifiSsid || undefined,
              wifiStrength: data.wifiStrength || undefined,
            },
          }));
        }
        // heartbeat extras (cpu, storage, memory, firmware, timezone, resolution, uptime)
        if (data.cpuLoad != null || data.storageFree != null || data.storageFreeBytes != null || data.firmwareVersion || data.timezone || data.resolution || data.memoryFree != null || data.memoryTotal != null || data.deviceUptime != null) {
          ws.send(JSON.stringify({
            type: 'heartbeat',
            payload: {
              playerVersion: playerVersion,
              firmwareVersion: data.firmwareVersion || undefined,
              timezone: data.timezone || undefined,
              resolution: data.resolution || undefined,
              powerState: 'on',
              cpuLoad: data.cpuLoad != null ? data.cpuLoad : undefined,
              storageFreeBytes: data.storageFreeBytes || data.storageFree || undefined,
              memoryFreeBytes: data.memoryFree != null ? Math.round(data.memoryFree) : undefined,
              memoryTotalBytes: data.memoryTotal != null ? Math.round(data.memoryTotal) : undefined,
              deviceUptimeSec: data.deviceUptime != null ? Math.round(data.deviceUptime) : undefined,
            },
          }));
        }
      }
    } catch (err) {
      logger.warn('sendTelemetry via WS failed:', err);
    }
    return { ok: true };
  },

  // ── sendLog → kept for backward compat; real batching is in logger._flush ─
  async sendLog(deviceId, logs) {
    return { ok: true };
  },

  // ── getCommands → no-op; commands arrive via WebSocket ───────────────────
  async getCommands(deviceId) {
    return [];
  },

  // ── GET /devices/device/schedule (device-auth Bearer token) ──────────────
  async getSchedule(deviceToken) {
    const response = await fetch(`${CONFIG.API_BASE}/devices/device/schedule`, {
      headers: { 'Authorization': `Bearer ${deviceToken}` },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    return await response.json(); // { schedules: [...] }
  },

  // ── GET /devices/device/workspace (device-auth Bearer token) ─────────────
  async getWorkspaceInfo(deviceToken) {
    const response = await fetch(`${CONFIG.API_BASE}/devices/device/workspace`, {
      headers: { 'Authorization': `Bearer ${deviceToken}` },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    return await response.json(); // { workspace, defaultPlaylist }
  },

  // ── getCurrentContent: derives active playlist from schedule ─────────────
  async getCurrentContent(deviceId, deviceToken) {
    const token = deviceToken || localStorage.getItem('deviceToken');
    if (!token) throw new Error('No device token available');

    const [scheduleData, workspaceData] = await Promise.all([
      this.getSchedule(token),
      this.getWorkspaceInfo(token).catch(() => ({ workspace: null, defaultPlaylist: null })),
    ]);

    const playlist = API._resolveActivePlaylist(
      scheduleData.schedules,
      workspaceData.defaultPlaylist,
      token,
      {
        publishedContent: workspaceData.publishedContent || null,
        publishedPlaylist: workspaceData.publishedPlaylist || null,
        publishedSchedule: workspaceData.publishedSchedule || null,
        publishedSyncGroup: workspaceData.publishedSyncGroup || null,
      }
    );
    if (playlist && workspaceData.resellerBranding) {
      playlist.resellerBranding = workspaceData.resellerBranding;
    }
    return playlist || null;
  },

  // ── Find the currently-active playlist from schedules + workspace default ─
  _resolveActivePlaylist(schedules, defaultPlaylist, deviceToken, publishedTargets) {
    // Sync group takes highest priority — entire group plays in lockstep
    if (publishedTargets && publishedTargets.publishedSyncGroup) {
      const sg = publishedTargets.publishedSyncGroup;
      const sp = sg.syncPlaylist;
      if (sp && (sp.items || []).length > 0) {
        const normalized = API._normalizeSyncPlaylist(sp, sg.groupId, deviceToken, sg);
        if (normalized) {
          logger.info('Using published sync group override:', sg.id, 'groupId:', sg.groupId);
          return normalized;
        }
        // Fall through to lower-priority targets when sync payload is invalid.
      }
    }

    if (publishedTargets && publishedTargets.publishedContent) {
      logger.info('Using published content override:', publishedTargets.publishedContent.name || publishedTargets.publishedContent.id);
      return API._normalizeSingleContent(publishedTargets.publishedContent, 'Published Content', deviceToken);
    }

    if (publishedTargets && publishedTargets.publishedPlaylist && (publishedTargets.publishedPlaylist.items || []).length > 0) {
      logger.info('Using published playlist override:', publishedTargets.publishedPlaylist.name || publishedTargets.publishedPlaylist.id);
      return API._normalizePlaylist(publishedTargets.publishedPlaylist, deviceToken);
    }

    if (publishedTargets && publishedTargets.publishedSchedule) {
      logger.info('Using published schedule override:', publishedTargets.publishedSchedule.name || publishedTargets.publishedSchedule.id);
      const publishedSchedule = Object.assign({}, publishedTargets.publishedSchedule, { isActive: true });
      const publishedScheduleResult = API._resolveScheduledPlaylist([
        publishedSchedule,
      ], null, deviceToken);
      if (publishedScheduleResult) return publishedScheduleResult;
    }

    return API._resolveScheduledPlaylist(schedules, defaultPlaylist, deviceToken);
  },

  _resolveScheduledPlaylist(schedules, defaultPlaylist, deviceToken) {
    const now = new Date();
    const dayOfWeek = now.getDay(); // 0=Sun, 6=Sat
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    for (const schedule of (schedules || [])) {
      if (!schedule.isActive) continue;
      for (const slot of (schedule.slots || [])) {
        // Day-of-week check (null days = every day)
        const slotDays = slot.daysOfWeek || slot.dayOfWeek;
        if (slotDays && Array.isArray(slotDays) && !slotDays.includes(dayOfWeek)) continue;

        // Time-range check
        if (slot.startTime && slot.endTime) {
          const [startH, startM] = slot.startTime.split(':').map(Number);
          const [endH, endM] = slot.endTime.split(':').map(Number);
          const startMinutes = startH * 60 + startM;
          const endMinutes = endH * 60 + endM;
          if (currentMinutes < startMinutes || currentMinutes >= endMinutes) continue;
        }

        // Active slot found
        if (slot.playlist && (slot.playlist.items || []).length > 0) {
          return API._normalizePlaylist(slot.playlist, deviceToken);
        } else if (slot.content) {
          return API._normalizeSingleContent(slot.content, schedule.name, deviceToken);
        }
      }
    }

    // No active slot — use workspace default playlist.
    // Calendar (meeting room / day / week / month) content must be explicitly
    // published or placed in a schedule slot — it must never autoplay from the
    // workspace default because it would override intentionally-published
    // image/video content whenever the published target is missing.
    if (defaultPlaylist && (defaultPlaylist.items || []).length > 0) {
      var defaultItems = (defaultPlaylist.items || []).filter(function (item) {
        return !item.content || (item.content.type || '').toLowerCase() !== 'calendar';
      });
      if (defaultItems.length > 0) {
        return API._normalizePlaylist(Object.assign({}, defaultPlaylist, { items: defaultItems }), deviceToken);
      }
    }
    return null;
  },

  // ── Normalize playlist to format expected by Player ───────────────────────
  _normalizePlaylist(playlist, deviceToken) {
    const items = (playlist.items || []).map(item => ({
      id: item.id,
      contentId: item.contentId,
      duration: item.duration || 10,
      position: item.position || 0,
      content: item.content ? API._normalizeContent(item.content, deviceToken) : null,
    }));
    return { id: playlist.id, playlistId: playlist.id, playlistName: playlist.name, items, syncPlay: null };
  },

  // ── Normalize a sync playlist into the player's expected shape ───────────
  _normalizeSyncPlaylist(syncPlaylist, groupId, deviceToken, syncGroup) {
    // Samsung SyncPlay requires a 16-bit unsigned integer groupID (0..65535).
    // Reject out-of-range/non-numeric values up front so the firmware call site
    // gets a clean failure instead of a confusing TypeMismatchError.
    const numericGroupId = Number(groupId);
    if (!Number.isFinite(numericGroupId) || !Number.isInteger(numericGroupId) ||
        numericGroupId < 0 || numericGroupId > 65535) {
      logger.warn('Syncplay: invalid groupID from API, ignoring sync playlist', groupId);
      return null;
    }
    const items = (syncPlaylist.items || []).map((item, idx) => ({
      id: item.id,
      contentId: item.contentId,
      duration: item.durationSeconds || 10,
      position: item.sortOrder != null ? item.sortOrder : idx,
      content: item.content ? API._normalizeContent(item.content, deviceToken) : null,
    }));
    if (items.length === 0) {
      logger.warn('Syncplay: empty sync playlist, ignoring');
      return null;
    }
    return {
      id: syncPlaylist.id,
      playlistId: syncPlaylist.id,
      playlistName: syncPlaylist.name || 'Sync Playlist',
      items,
      syncPlay: { enabled: true, groupID: numericGroupId, syncGroupId: (syncGroup && syncGroup.id) || null, peers: (syncGroup && syncGroup.peers) || [], allTizen: syncGroup != null ? !!syncGroup.allTizen : true },
    };
  },

  // ── Wrap a single content item as a one-item playlist ────────────────────
  _normalizeSingleContent(content, scheduleName, deviceToken) {
    return {
      id: content.id,
      playlistName: scheduleName || 'Schedule',
      items: [{ id: content.id, contentId: content.id, duration: 10, position: 0, content: API._normalizeContent(content, deviceToken) }],
      syncPlay: null,
    };
  },

  // ── GET /devices/device/playlist/:id (device-auth Bearer token) ─────────
  async getPlaylistById(playlistId, deviceToken) {
    const token = deviceToken || localStorage.getItem('deviceToken') || '';
    const response = await fetch(`${CONFIG.API_BASE}/devices/device/playlist/${encodeURIComponent(playlistId)}`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    return await response.json();
  },

  // ── GET /devices/device/content/:id (device-auth Bearer token) ──────────
  async getContentById(contentId, deviceToken) {
    const token = deviceToken || localStorage.getItem('deviceToken') || '';
    const response = await fetch(`${CONFIG.API_BASE}/devices/device/content/${encodeURIComponent(contentId)}`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    return await response.json();
  },

  // ── Normalize content item; set url to device file endpoint ──────────────
  _normalizeContent(content, deviceToken) {
    const token = deviceToken || localStorage.getItem('deviceToken') || '';
    const fileUrl = `${CONFIG.API_BASE}/devices/device/content/${content.id}/file?token=${encodeURIComponent(token)}`;
    const normalized = {
      id: content.id,
      name: content.name,
      type: (content.type || '').toUpperCase(),
      mimeType: content.mimeType,
      url: content.url || fileUrl,
      fileUrl,
      webUrl: content.webUrl || null,
      originalName: content.originalName,
      filePath: content.filePath,
      metadata: content.metadata || '{}',
    };

    // HTML5 ZIP packages: server-side extraction — the API extracts the ZIP
    // and serves individual files at /devices/device/content/:id/html5/:token/*
    // The token is embedded in the path (not query string) so relative assets
    // (scripts, stylesheets, images) inside the HTML5 app are automatically
    // served by the same route without additional auth wiring.
    if (normalized.type === 'HTML5') {
      // Use the content's startPage from metadata (default: index.html) so
      // packages with a non-default entry point load correctly.
      let h5StartPage = 'index.html';
      try {
        const h5Meta = JSON.parse(normalized.metadata || '{}');
        if (h5Meta.startPage) h5StartPage = h5Meta.startPage.replace(/^\/+/, '');
      } catch (_e) {}
      normalized.url = `${CONFIG.API_BASE}/devices/device/content/${content.id}/html5/${encodeURIComponent(token)}/${h5StartPage}`;
      normalized.webUrl = null;
    }

    // Live Link Face: all data is in metadata; there is no server file to fetch.
    if (normalized.type === 'LIVE_LINK_FACE') {
      normalized.url = '';
    }

    // Channel groups carry an embedded list of IPTV channels in metadata —
    // surface them as first-class fields so the player can tune without
    // re-parsing JSON on every key press.
    if (normalized.type === 'CHANNEL_GROUP') {
      try {
        const meta = typeof content.metadata === 'string'
          ? JSON.parse(content.metadata || '{}')
          : (content.metadata || {});
        normalized.channels = Array.isArray(meta.channels) ? meta.channels : [];
        normalized.defaultChannelNumber = typeof meta.defaultChannelNumber === 'number'
          ? meta.defaultChannelNumber
          : (normalized.channels[0] ? normalized.channels[0].number : 1);
        // Channel groups don't have a single playable URL — clear the file URL.
        normalized.url = '';
      } catch (err) {
        normalized.channels = [];
        normalized.defaultChannelNumber = 1;
      }
    }

    return normalized;
  },
};

// Some Tizen runtimes do not reliably expose window properties as bare globals.
// Create the API alias explicitly because the rest of the player references API directly.
var API = window.API;
