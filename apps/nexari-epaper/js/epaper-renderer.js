// Nexari E-Paper — Image renderer / playback loop.
//
// Responsibilities:
//  - Periodically fetch the device schedule (or react to a WS push in Phase 2)
//  - Resolve the *currently active* slot to a flat list of image content items
//  - Cycle through the items, swapping #content-image on each tick
//  - Enforce CONFIG.EPAPER_MIN_SWAP_RATE_SEC (default 15s) — the panel can't
//    physically refresh faster than this.
//  - After each swap, ask the panel to do a partial refresh via
//    webapis.epaper.screenRefreshNow().
//  - Skip content the panel can't render. Images are streamed directly;
//    calendars are pre-rasterised by the server to a panel-sized JPEG via
//    /device/content/:id/epaper.jpg. Video / HTML5 / web URLs are skipped.
//  - Pre-fetch the next 1-2 items to keep tick latency low.
//
// All scheduling math mirrors apps/nexari-tizen so the same admin schedules
// produce the same active slot on both kinds of devices.

window.EpaperRenderer = (function() {
  'use strict';

  var state = {
    deviceId: null,
    deviceToken: null,
    workspaceId: null,
    currentSlotKey: null,    // string identifying the active slot (for change detection)
    currentItems: [],        // image content items to cycle through
    currentIndex: 0,
    swapTimer: null,         // setTimeout id for next swap
    pollTimer: null,         // setInterval id for schedule poll
    lastSwapAt: 0,
    started: false,
  };

  function imgEl() { return document.getElementById('content-image'); }

  function isRenderable(content) {
    if (!content) return false;
    var t = String(content.type || '').toLowerCase();
    // Images are streamed directly; calendars are server-rasterised to an
    // e-paper JPEG via the same /epaper.jpg endpoint.
    return t === 'image' || t === 'calendar';
  }

  // Mirrors api.js _resolveScheduledPlaylist on nexari-tizen but image-only.
  function resolveActiveSlot(schedules, defaultPlaylist) {
    var now = new Date();
    var dayOfWeek = now.getDay();
    var currentMinutes = now.getHours() * 60 + now.getMinutes();

    var fallback = null;
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

        if (slot.playlist || slot.content) {
          return { schedule: schedule, slot: slot };
        }
      }
    }

    if (defaultPlaylist) return { schedule: null, slot: { playlist: defaultPlaylist } };
    return fallback;
  }

  function flattenSlotImages(slot) {
    if (!slot) return [];
    var items = [];
    if (slot.playlist && Array.isArray(slot.playlist.items)) {
      for (var i = 0; i < slot.playlist.items.length; i++) {
        var it = slot.playlist.items[i];
        if (isRenderable(it.content)) items.push(it.content);
      }
    } else if (slot.content && isRenderable(slot.content)) {
      items.push(slot.content);
    }
    return items;
  }

  function slotKey(active) {
    if (!active || !active.slot) return 'none';
    var s = active.slot;
    return [
      s.id || 'inline',
      s.playlistId || (s.playlist && s.playlist.id) || '',
      s.contentId || (s.content && s.content.id) || '',
      s.startTime || '',
      s.endTime || '',
    ].join('|');
  }

  function clearTimers() {
    if (state.swapTimer) { clearTimeout(state.swapTimer); state.swapTimer = null; }
    if (state.pollTimer) { clearInterval(state.pollTimer); state.pollTimer = null; }
  }

  function showError(msg) {
    var errEl = document.getElementById('error-screen');
    var pairEl = document.getElementById('pairing-screen');
    var playerEl = document.getElementById('player-screen');
    if (errEl) {
      var detail = document.getElementById('error-message');
      if (detail) detail.textContent = msg || 'Unknown error';
      if (pairEl) pairEl.classList.add('hidden');
      if (playerEl) playerEl.classList.add('hidden');
      errEl.classList.remove('hidden');
    } else {
      logger.error('[Renderer] ' + msg);
    }
  }

  function swapToIndex(idx) {
    var items = state.currentItems;
    if (!items || items.length === 0) return Promise.resolve();
    var content = items[idx % items.length];

    // Calendar variants change as events do; bypass the persistent cache so
    // we always pull a fresh server-rasterised JPEG for calendars. Images are
    // immutable per contentId, so the LRU cache is the right answer for them.
    var isCalendar = content && String(content.type || '').toLowerCase() === 'calendar';
    var fetchPromise;
    if (isCalendar) {
      try { EpaperCache.invalidate(content.id); } catch (_) {}
      fetchPromise = EpaperCache.getOrFetch(content.id, { token: state.deviceToken, mode: 'contain', noPersist: true });
    } else {
      fetchPromise = EpaperCache.getOrFetch(content.id, { token: state.deviceToken, mode: 'contain' });
    }

    return fetchPromise
      .then(function(blobUrl) {
        var img = imgEl();
        if (!img) return;
        // Decode the new image off-screen first, then swap to avoid a flash of empty.
        var probe = new Image();
        probe.onload = function() {
          img.src = blobUrl;
          img.alt = content.name || '';
          state.lastSwapAt = Date.now();
          // Ask the panel to refresh (partial). Best effort.
          if (window.EpaperPower && EpaperPower.isAvailable()) {
            try { EpaperPower.refreshNow(); } catch (_) {}
          }
        };
        probe.onerror = function() {
          logger.warn('[Renderer] image decode failed for ' + content.id);
        };
        probe.src = blobUrl;

        // Pre-fetch the next 1-2 items in the background
        var lookahead = [];
        for (var k = 1; k <= 2; k++) {
          var nextIdx = (idx + k) % items.length;
          if (items[nextIdx] && items[nextIdx].id !== content.id) lookahead.push(items[nextIdx].id);
        }
        if (lookahead.length > 0) EpaperCache.prefetch(lookahead, { token: state.deviceToken, mode: 'contain' });
      })
      .catch(function(err) {
        logger.warn('[Renderer] fetch failed for ' + content.id + ': ' + (err && err.message));
      });
  }

  function scheduleNextSwap() {
    if (!state.currentItems || state.currentItems.length === 0) return;
    if (state.currentItems.length === 1) return; // single item — no cycle needed

    var current = state.currentItems[state.currentIndex % state.currentItems.length];
    var perItemSec = (current && current.duration && current.duration > 0)
      ? current.duration
      : 60; // default 60s per image
    var minSec = (CONFIG && CONFIG.EPAPER_MIN_SWAP_RATE_SEC) || 15;
    var swapInSec = Math.max(perItemSec, minSec);

    if (state.swapTimer) clearTimeout(state.swapTimer);
    state.swapTimer = setTimeout(function() {
      state.currentIndex = (state.currentIndex + 1) % state.currentItems.length;
      swapToIndex(state.currentIndex).then(scheduleNextSwap);
    }, swapInSec * 1000);
  }

  function applySchedule(payload) {
    var schedules = (payload && payload.schedules) || [];
    var defaultPlaylist = (payload && payload.defaultPlaylist) || null;
    var active = resolveActiveSlot(schedules, defaultPlaylist);
    var newKey = slotKey(active);
    if (newKey === state.currentSlotKey) {
      // Same slot — keep cycling current items
      logger.debug('[Renderer] schedule unchanged');
      return;
    }
    state.currentSlotKey = newKey;
    var items = active ? flattenSlotImages(active.slot) : [];
    if (items.length === 0) {
      logger.info('[Renderer] no image content for current slot');
      var img = imgEl();
      if (img) { img.removeAttribute('src'); img.alt = 'No content'; }
      state.currentItems = [];
      state.currentIndex = 0;
      if (state.swapTimer) { clearTimeout(state.swapTimer); state.swapTimer = null; }
      return;
    }
    state.currentItems = items;
    state.currentIndex = 0;
    logger.info('[Renderer] active slot has ' + items.length + ' image(s)');
    swapToIndex(0).then(scheduleNextSwap);
  }

  function pollSchedule() {
    return API.getSchedule(state.deviceToken)
      .then(function(payload) { applySchedule(payload); })
      .catch(function(err) {
        logger.warn('[Renderer] schedule poll failed: ' + (err && err.message));
      });
  }

  return {
    /** Start the renderer for a paired device. Idempotent. */
    start: function(device) {
      if (state.started) return;
      state.started = true;
      state.deviceId = device.id;
      state.deviceToken = device.deviceToken || (typeof localStorage !== 'undefined' && localStorage.getItem('deviceToken')) || null;
      state.workspaceId = device.workspaceId || (typeof localStorage !== 'undefined' && localStorage.getItem('workspaceId')) || null;
      logger.info('[Renderer] start');

      // Initial fetch then periodic poll. WS push (Phase 2) will replace the
      // poll cadence with event-driven updates but keep this as a fallback.
      pollSchedule();
      var pollMs = (CONFIG && CONFIG.CONTENT_REFRESH_INTERVAL) || 60000;
      state.pollTimer = setInterval(pollSchedule, pollMs);
    },

    /** Force re-fetch of the schedule (e.g. WS playlist_changed event). */
    refreshNow: function() {
      return pollSchedule();
    },

    /** Clear cycle and stop polling. Used on unpair. */
    stop: function() {
      clearTimers();
      state.started = false;
      state.currentItems = [];
      state.currentSlotKey = null;
    },

    _state: state, // for debugging via console
  };
})();
