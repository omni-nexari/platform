// Nexari E-Paper — API client (image-only, no avplay/syncplay)

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
        // E-paper extras (server schema accepts these as optional)
        kind: 'epaper',
        platform: 'tizen-epaper',
        panelW: deviceInfo.panelW || null,
        panelH: deviceInfo.panelH || null,
        orientation: deviceInfo.orientation || null,
        epaperApiVersion: deviceInfo.epaperApiVersion || null,
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
      return await response.json();
    } catch (error) {
      logger.error('Failed to check pairing:', error);
      throw error;
    }
  },

  // ── GET /devices/device/workspace (device-auth Bearer token) ─────────────
  async getWorkspaceInfo(deviceToken) {
    const token = deviceToken || localStorage.getItem('deviceToken') || '';
    const response = await fetch(`${CONFIG.API_BASE}/devices/device/workspace`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    return await response.json();
  },

  // ── GET /devices/device/schedule ──────────────────────────────────────────
  async getSchedule(deviceToken) {
    const token = deviceToken || localStorage.getItem('deviceToken') || '';
    const response = await fetch(`${CONFIG.API_BASE}/devices/device/schedule`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    return await response.json();
  },

  // ── GET /devices/device/epaper/policy (Phase 2) ──────────────────────────
  async getEpaperPolicy(deviceToken) {
    const token = deviceToken || localStorage.getItem('deviceToken') || '';
    const response = await fetch(`${CONFIG.API_BASE}/devices/device/epaper/policy`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!response.ok) {
      if (response.status === 404) return null;
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    return await response.json();
  },

  // ── getCurrentContent: workspace published targets + schedule resolution ─
  // Mirrors nexari-tizen getCurrentContent() but skips sync-group (N/A on e-paper).
  async getCurrentContent(deviceId, deviceToken) {
    const token = deviceToken || localStorage.getItem('deviceToken') || '';
    if (!token) throw new Error('No device token available');

    const [scheduleData, workspaceData] = await Promise.all([
      this.getSchedule(token),
      this.getWorkspaceInfo(token).catch(function() { return { workspace: null, defaultPlaylist: null }; }),
    ]);

    return this._resolveActivePlaylist(
      scheduleData.schedules,
      workspaceData.defaultPlaylist,
      {
        publishedContent:  workspaceData.publishedContent  || null,
        publishedPlaylist: workspaceData.publishedPlaylist || null,
        publishedSchedule: workspaceData.publishedSchedule || null,
      }
    );
  },

  // ── Priority: publishedContent > publishedPlaylist > publishedSchedule > schedule ──
  _resolveActivePlaylist(schedules, defaultPlaylist, publishedTargets) {
    if (publishedTargets && publishedTargets.publishedContent) {
      logger.info('[API] published content override:', publishedTargets.publishedContent.name || publishedTargets.publishedContent.id);
      return this._normalizeSingleContent(publishedTargets.publishedContent, 'Published Content');
    }

    if (publishedTargets && publishedTargets.publishedPlaylist &&
        (publishedTargets.publishedPlaylist.items || []).length > 0) {
      logger.info('[API] published playlist override:', publishedTargets.publishedPlaylist.name || publishedTargets.publishedPlaylist.id);
      return this._normalizePlaylist(publishedTargets.publishedPlaylist);
    }

    if (publishedTargets && publishedTargets.publishedSchedule) {
      logger.info('[API] published schedule override:', publishedTargets.publishedSchedule.name || publishedTargets.publishedSchedule.id);
      var ps = Object.assign({}, publishedTargets.publishedSchedule, { isActive: true });
      var psResult = this._resolveScheduledPlaylist([ps], null);
      if (psResult) return psResult;
    }

    return this._resolveScheduledPlaylist(schedules, defaultPlaylist);
  },

  _resolveScheduledPlaylist(schedules, defaultPlaylist) {
    var now = new Date();
    var dayOfWeek = now.getDay();
    var currentMinutes = now.getHours() * 60 + now.getMinutes();

    for (var i = 0; i < (schedules || []).length; i++) {
      var schedule = schedules[i];
      if (!schedule || !schedule.isActive) continue;
      for (var j = 0; j < (schedule.slots || []).length; j++) {
        var slot = schedule.slots[j];
        var slotDays = slot.daysOfWeek || slot.dayOfWeek;
        if (slotDays && Array.isArray(slotDays) && slotDays.length > 0 && slotDays.indexOf(dayOfWeek) === -1) continue;

        if (slot.startTime && slot.endTime) {
          var s = slot.startTime.split(':').map(Number);
          var e = slot.endTime.split(':').map(Number);
          var startMin = s[0] * 60 + (s[1] || 0);
          var endMin = e[0] * 60 + (e[1] || 0);
          if (currentMinutes < startMin || currentMinutes >= endMin) continue;
        }

        if (slot.playlist && (slot.playlist.items || []).length > 0) {
          return this._normalizePlaylist(slot.playlist);
        } else if (slot.content) {
          return this._normalizeSingleContent(slot.content, schedule.name);
        }
      }
    }

    if (defaultPlaylist && (defaultPlaylist.items || []).length > 0) {
      return this._normalizePlaylist(defaultPlaylist);
    }
    return null;
  },

  // ── Normalizers ───────────────────────────────────────────────────────────
  _normalizePlaylist(playlist) {
    var self = this;
    var items = (playlist.items || []).map(function(item) {
      return {
        id: item.id,
        contentId: item.contentId,
        duration: item.duration || 60,
        position: item.position || 0,
        content: item.content ? self._normalizeContent(item.content) : null,
      };
    });
    return { id: playlist.id, playlistId: playlist.id, playlistName: playlist.name || '', items: items };
  },

  _normalizeSingleContent(content, playlistName) {
    return {
      id: content.id,
      playlistName: playlistName || 'Schedule',
      items: [{
        id: content.id,
        contentId: content.id,
        duration: content.duration || 60,
        position: 0,
        content: this._normalizeContent(content),
      }],
    };
  },

  // Normalize a raw DB content row for the e-paper renderer.
  // metadata is preserved so calendar renderer gets timezone/view/theme.
  _normalizeContent(content) {
    return {
      id: content.id,
      name: content.name || '',
      type: (content.type || '').toUpperCase(),
      mimeType: content.mimeType || null,
      duration: content.duration || 60,
      metadata: content.metadata || '{}',
    };
  },

  // ── sendTelemetry: dispatch network_info + heartbeat extras via WS ────────
  // Mirrors nexari-tizen api.js sendTelemetry() but uses EpaperWS.push().
  async sendTelemetry(deviceId, data) {
    try {
      var ws = window.EpaperWS;
      if (!ws || !ws.isOpen()) return { ok: true };
      data = data || {};

      if (data.macAddress || data.ipAddress || data.networkType || data.wifiSsid) {
        ws.push({
          type: 'network_info',
          payload: {
            mac: data.macAddress || '',
            ip: data.ipAddress || '',
            gateway: data.gateway || undefined,
            connectionType: (data.networkType || '').toLowerCase().indexOf('wifi') !== -1 ? 'wifi' : 'ethernet',
            wifiSsid: data.wifiSsid || undefined,
            wifiStrength: data.wifiStrength || undefined,
          },
        });
      }

      var buildInfo = window.PLAYER_BUILD_INFO;
      var playerVersion = (buildInfo && buildInfo.version) || undefined;
      ws.push({
        type: 'heartbeat',
        payload: {
          playerVersion: playerVersion,
          firmwareVersion: data.firmwareVersion || undefined,
          timezone: data.timezone || undefined,
          resolution: data.resolution || undefined,
          powerState: 'on',
          kind: 'epaper',
          panelW: data.panelW || undefined,
          panelH: data.panelH || undefined,
          batteryPct: data.batteryPct != null ? data.batteryPct : undefined,
        },
      });
    } catch (err) {
      logger.warn('[API] sendTelemetry failed:', err && err.message);
    }
    return { ok: true };
  },
};
