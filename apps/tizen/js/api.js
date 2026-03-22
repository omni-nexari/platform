// API Helper Functions

window.API = {
  // ── POST /devices/pair/request ────────────────────────────────────────────
  async requestPairing(deviceInfo) {
    try {
      const body = {
        duid: deviceInfo.duid || deviceInfo.serialNumber || null,
        modelName: deviceInfo.model || deviceInfo.modelName || null,
        modelCode: deviceInfo.modelCode || null,
        serialNumber: deviceInfo.serialNumber || null,
        firmwareVersion: deviceInfo.firmwareVersion || null,
      };
      const response = await fetch(`${CONFIG.API_BASE}/devices/pair/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      return await response.json(); // { status?, deviceId, code?, expiresAt?, deviceToken? }
    } catch (error) {
      logger.error('Failed to request pairing:', error);
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
        // network_info message
        if (data.macAddress || data.ipAddress) {
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
        // heartbeat extras (cpu, storage, firmware, timezone, resolution)
        if (data.cpuLoad != null || data.storageFree != null || data.storageFreeBytes != null || data.firmwareVersion || data.timezone || data.resolution) {
          ws.send(JSON.stringify({
            type: 'heartbeat',
            payload: {
              playerVersion: window.PLAYER_DEPLOY_VERSION || undefined,
              firmwareVersion: data.firmwareVersion || undefined,
              timezone: data.timezone || undefined,
              resolution: data.resolution || undefined,
              powerState: 'on',
              cpuLoad: data.cpuLoad != null ? data.cpuLoad : undefined,
              storageFreeBytes: data.storageFreeBytes || data.storageFree || undefined,
            },
          }));
        }
      }
    } catch (err) {
      logger.warn('sendTelemetry via WS failed:', err);
    }
    return { ok: true };
  },

  // ── sendLog → no-op; remote logging uses WS heartbeat instead ────────────
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

    return API._resolveActivePlaylist(
      scheduleData.schedules,
      workspaceData.defaultPlaylist,
      token,
      {
        publishedContent: workspaceData.publishedContent || null,
        publishedPlaylist: workspaceData.publishedPlaylist || null,
        publishedSchedule: workspaceData.publishedSchedule || null,
      }
    );
  },

  // ── Find the currently-active playlist from schedules + workspace default ─
  _resolveActivePlaylist(schedules, defaultPlaylist, deviceToken, publishedTargets) {
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

    // No active slot — use workspace default playlist
    if (defaultPlaylist && (defaultPlaylist.items || []).length > 0) {
      return API._normalizePlaylist(defaultPlaylist, deviceToken);
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

  // ── Wrap a single content item as a one-item playlist ────────────────────
  _normalizeSingleContent(content, scheduleName, deviceToken) {
    return {
      id: content.id,
      playlistName: scheduleName || 'Schedule',
      items: [{ id: content.id, contentId: content.id, duration: 10, position: 0, content: API._normalizeContent(content, deviceToken) }],
      syncPlay: null,
    };
  },

  // ── Normalize content item; set url to device file endpoint ──────────────
  _normalizeContent(content, deviceToken) {
    const token = deviceToken || localStorage.getItem('deviceToken') || '';
    const fileUrl = `${CONFIG.API_BASE}/devices/device/content/${content.id}/file?token=${encodeURIComponent(token)}`;
    return {
      id: content.id,
      name: content.name,
      type: (content.type || '').toUpperCase(),
      mimeType: content.mimeType,
      url: content.url || fileUrl,
      fileUrl,
      originalName: content.originalName,
      filePath: content.filePath,
    };
  },
};

// Some Tizen runtimes do not reliably expose window properties as bare globals.
// Create the API alias explicitly because the rest of the player references API directly.
var API = window.API;
