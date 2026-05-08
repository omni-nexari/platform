// Nexari E-Paper — Image renderer / playback loop.
//
// Responsibilities:
//  - Periodically call API.getCurrentContent() (schedule + published-target
//    override resolution — same priority chain as nexari-tizen).
//  - Filter the returned playlist to image/calendar items only.
//  - Cycle through the items, swapping #content-image on each tick.
//  - Enforce CONFIG.EPAPER_MIN_SWAP_RATE_SEC (default 15s).
//  - After each swap, ask the panel for a partial refresh via
//    webapis.epaper.screenRefreshNow().
//  - Pre-fetch the next 1-2 items to keep tick latency low.
//
// Content-type support: IMAGE and CALENDAR only.
// Video / HTML5 / web URL / channel-group items are silently skipped.

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
    lastSwapAt: 0,
    started: false,
  };

  function imgEl()  { return document.getElementById('content-image'); }
  function calEl()  { return document.getElementById('content-calendar'); }
  function frameEl(){ return document.getElementById('content-frame'); }

  // Show exactly one content element; hide the others + clean up the calendar
  // renderer so timers don't keep running while a different content is visible.
  function showContentElement(type) {
    var img   = imgEl();
    var cal   = calEl();
    var frame = frameEl();
    if (img)   img.style.display   = (type === 'image')    ? '' : 'none';
    if (cal)   cal.style.display   = (type === 'calendar') ? 'block' : 'none';
    if (frame) frame.style.display = (type === 'html5')    ? 'block' : 'none';
    // Destroy the calendar renderer when it goes off-screen
    if (type !== 'calendar' && cal && window.EpaperCalendar) {
      try { EpaperCalendar.destroy(cal); } catch (e) {}
    }
    // Clear iframe src when it goes off-screen to stop network activity
    if (type !== 'html5' && frame) {
      try { frame.src = 'about:blank'; } catch (e) {}
    }
  }

  function isRenderable(content) {
    if (!content) return false;
    var t = String(content.type || '').toLowerCase();
    // image: served directly from the file endpoint (no server processing).
    // calendar: events fetched as JSON and rendered as HTML by EpaperCalendar.
    // html5: HTML5 package served via /html5/:token/* and loaded in an iframe.
    return t === 'image' || t === 'calendar' || t === 'html5';
  }

  // Build a stable change-detection key from the resolved playlist.
  // Changes when: playlist id changes, or item content ids change.
  function playlistKey(playlist) {
    if (!playlist) return 'none';
    var ids = (playlist.items || [])
      .filter(function(it) { return it.content && isRenderable(it.content); })
      .map(function(it) { return it.contentId || (it.content && it.content.id) || ''; })
      .join(',');
    return (playlist.id || playlist.playlistName || '') + '|' + ids;
  }

  function clearTimers() {
    if (state.swapTimer) { clearTimeout(state.swapTimer); state.swapTimer = null; }
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
    var t = String((content && content.type) || '').toLowerCase();

    // ── HTML5 package: load in iframe ────────────────────────────────────────
    if (t === 'html5') {
      return new Promise(function (resolve) {
        var frame = frameEl();
        if (!frame) { resolve(); return; }
        showContentElement('html5');
        var token = state.deviceToken || '';
        var url = CONFIG.API_BASE + '/devices/device/content/' + encodeURIComponent(content.id) +
                  '/html5/' + encodeURIComponent(token) + '/index.html';
        frame.src = url;
        state.lastSwapAt = Date.now();
        resolve();
        // Request partial e-paper refresh after brief load delay
        setTimeout(function () {
          if (window.EpaperPower && EpaperPower.isAvailable()) {
            try { EpaperPower.refreshNow(); } catch (e) {}
          }
        }, 2000);
      });
    }

    // ── Calendar: render events as HTML in the DOM ───────────────────────────
    if (t === 'calendar') {
      return new Promise(function (resolve) {
        var cal = calEl();
        if (!cal) { resolve(); return; }
        showContentElement('calendar');
        if (window.EpaperCalendar) {
          EpaperCalendar.render(cal, content, state.deviceToken || '');
        }
        state.lastSwapAt = Date.now();
        resolve();
        if (window.EpaperPower && EpaperPower.isAvailable()) {
          try { EpaperPower.refreshNow(); } catch (e) {}
        }
      });
    }

    // ── Image: download file and display via <img> ────────────────────────────
    showContentElement('image');
    var fetchPromise = EpaperCache.getOrFetch(content.id, { token: state.deviceToken });

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
        if (lookahead.length > 0) EpaperCache.prefetch(lookahead, { token: state.deviceToken });
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

  // Apply a resolved playlist (from API.getCurrentContent) to the render cycle.
  // Restarts cycling only when the playlist content actually changes.
  function applyPlaylist(playlist) {
    var newKey = playlistKey(playlist);
    if (newKey === state.currentSlotKey) {
      logger.debug('[Renderer] playlist unchanged');
      return;
    }
    state.currentSlotKey = newKey;
    var items = playlist
      ? (playlist.items || []).map(function(it) { return it.content; }).filter(isRenderable)
      : [];
    if (items.length === 0) {
      logger.info('[Renderer] no renderable content for current slot');
      showContentElement('image'); // hide calendar/frame, show blank img
      var img = imgEl();
      if (img) { img.removeAttribute('src'); img.alt = 'No content'; }
      state.currentItems = [];
      state.currentIndex = 0;
      if (state.swapTimer) { clearTimeout(state.swapTimer); state.swapTimer = null; }
      return;
    }
    state.currentItems = items;
    state.currentIndex = 0;
    var typeLabel = items.map(function(it) { return String(it.type || '').toLowerCase(); }).join(', ');
    logger.info('[Renderer] "' + (playlist.playlistName || '') + '" — ' + items.length + ' item(s) [' + typeLabel + ']');
    swapToIndex(0).then(scheduleNextSwap);
  }

  // Poll the server for the currently active content.
  // Uses API.getCurrentContent() which mirrors the nexari-tizen priority chain:
  // publishedContent > publishedPlaylist > publishedSchedule > schedule > defaultPlaylist.
  function pollSchedule() {
    return API.getCurrentContent(state.deviceId, state.deviceToken)
      .then(function(playlist) { applyPlaylist(playlist); })
      .catch(function(err) {
        logger.warn('[Renderer] content poll failed: ' + (err && err.message));
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

      // Single fetch on each wake cycle. WS push handles content changes
      // during the awake window (no setInterval poll needed).
      pollSchedule();
    },

    /** Force re-fetch of the schedule (e.g. WS playlist_changed event). */
    refreshNow: function() {
      return pollSchedule();
    },

    /** Clear cycle. Used on unpair. */
    stop: function() {
      clearTimers();
      state.started = false;
      state.currentItems = [];
      state.currentSlotKey = null;
    },

    _state: state, // for debugging via console
  };
})();
