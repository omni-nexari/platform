// Nexari E-Paper — HTML Calendar Renderer
//
// Renders calendar events directly in the DOM (no server-side JPEG needed).
// Fetches events from /device/content/:id/calendar/events and renders them
// as HTML into a container element.
//
// API:
//   EpaperCalendar.render(container, content, deviceToken)
//   EpaperCalendar.destroy(container)

window.EpaperCalendar = (function () {
  'use strict';

  // ── tiny helpers ────────────────────────────────────────────────────────────
  function esc(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function fmtTime(d) {
    var h = d.getHours(), m = d.getMinutes(), ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return m === 0 ? (h + ' ' + ampm) : (h + ':' + pad2(m) + ' ' + ampm);
  }

  function isoDate(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  // Convert an ISO timestamp to local time in the given IANA timezone.
  function toLocal(iso, tz) {
    try {
      return new Date(new Date(iso).toLocaleString('en-US', { timeZone: tz }));
    } catch (e) {
      return new Date(iso);
    }
  }

  function eventsSignature(evs) {
    return evs.map(function (e) {
      return e.id + '|' + e.start + '|' + e.end + '|' + (e.title || '');
    }).join('\n');
  }

  var PALETTE = ['#1a73e8', '#0f9d58', '#e67c00', '#8430ce', '#d50000', '#0097a7', '#616161', '#e91e63'];

  // ── view renderers ──────────────────────────────────────────────────────────

  function renderAgenda(container, events, content, meta, tz) {
    var accent = (meta.theme && meta.theme.accentColor) || '#1a73e8';
    var isDark  = !!(meta.theme && meta.theme.background === 'dark');
    var bg      = isDark ? '#1e1e2e' : '#ffffff';
    var text    = isDark ? '#e2e8f0' : '#202124';
    var muted   = isDark ? '#94a3b8' : '#70757a';
    var border  = isDark ? '#3a3a50' : '#e0e0e0';
    var surf    = isDark ? '#2a2a3e' : '#f8f9fa';

    var now = new Date();
    var upcoming = events
      .filter(function (e) { return new Date(e.end).getTime() > now.getTime(); })
      .sort(function (a, b) { return new Date(a.start).getTime() - new Date(b.start).getTime(); });

    // Header: calendar name on left, full date (no clock) on right
    var dateStr = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

    var rows = '';
    if (upcoming.length === 0) {
      rows = '<div style="flex:1;display:flex;align-items:center;justify-content:center;opacity:0.5;">' +
             '<p style="font-size:36px;">No upcoming events</p></div>';
    } else {
      var lastDay = '';
      for (var i = 0; i < upcoming.length; i++) {
        var ev = upcoming[i];
        var s  = toLocal(ev.start, tz);
        var en = toLocal(ev.end, tz);
        var day = isoDate(s);
        if (day !== lastDay) {
          lastDay = day;
          var dayLabel = s.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
          rows += '<div style="padding:20px 40px 10px;font-size:22px;font-weight:700;color:' + muted + ';' +
                  'text-transform:uppercase;letter-spacing:1px;border-bottom:2px solid ' + border + ';' +
                  'background:' + surf + ';">' + esc(dayLabel) + '</div>';
        }
        var color = PALETTE[i % PALETTE.length];
        var isNow = new Date(ev.start).getTime() <= now.getTime() && new Date(ev.end).getTime() > now.getTime();
        var timeRange = ev.allDay ? 'All day' : (fmtTime(s) + ' \u2013 ' + fmtTime(en));
        rows += '<div style="display:flex;gap:24px;padding:24px 40px;border-bottom:1px solid ' + border + ';' +
                'background:' + (isNow ? (isDark ? 'rgba(26,115,232,0.15)' : 'rgba(26,115,232,0.06)') : bg) + ';">' +
                  '<div style="width:6px;min-height:48px;border-radius:3px;background:' + color + ';flex-shrink:0;margin-top:4px;"></div>' +
                  '<div style="flex:1;min-width:0;">' +
                    '<div style="font-size:32px;font-weight:700;color:' + text + ';overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(ev.title || '(no title)') + '</div>' +
                    '<div style="font-size:22px;color:' + muted + ';margin-top:6px;">' + esc(timeRange) + '</div>' +
                    (ev.location ? '<div style="font-size:20px;color:' + muted + ';margin-top:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">@ ' + esc(ev.location) + '</div>' : '') +
                  '</div>' +
                  (isNow ? '<div style="align-self:center;background:' + accent + ';color:#fff;padding:6px 18px;border-radius:6px;font-size:18px;font-weight:700;flex-shrink:0;">NOW</div>' : '') +
                '</div>';
      }
    }

    container.innerHTML =
      '<div style="position:absolute;inset:0;display:flex;flex-direction:column;background:' + bg + ';color:' + text + ';' +
      'font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,sans-serif;overflow:hidden;">' +
        '<header style="display:flex;align-items:center;padding:24px 40px;border-bottom:2px solid ' + border + ';gap:20px;flex-shrink:0;">' +
          '<div style="width:6px;min-height:56px;background:' + accent + ';border-radius:3px;flex-shrink:0;"></div>' +
          '<div style="flex:1;min-width:0;">' +
            '<div style="font-size:24px;font-weight:700;color:' + text + ';overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(content.name || 'Calendar') + '</div>' +
            '<div style="font-size:20px;color:' + muted + ';margin-top:4px;">' + esc(dateStr) + '</div>' +
          '</div>' +
        '</header>' +
        '<div style="flex:1;overflow-y:auto;">' + rows + '</div>' +
      '</div>';
    // No clock timer for agenda view — no clock element to update
  }

  function renderMeetingRoom(container, events, content, meta, tz) {
    var theme    = meta.theme || {};
    var isDark   = !!(theme.background === 'dark');
    var bg       = isDark ? '#1e1e2e' : '#ffffff';
    var text     = isDark ? '#e2e8f0' : '#202124';
    var muted    = isDark ? '#94a3b8' : '#70757a';
    var border   = isDark ? '#3a3a50' : '#e0e0e0';
    var accent   = theme.accentColor || '#1a73e8';
    var showLoc  = theme.showLocation  !== false;
    var showAtt  = !!theme.showAttendeeCount;
    var clock24  = theme.clockStyle === 'digital-24';
    var roomMeta = meta.roomMeta || {};

    function fmtRange(ev) {
      var s = toLocal(ev.start, tz), en = toLocal(ev.end, tz);
      if (clock24) {
        return pad2(s.getHours()) + ':' + pad2(s.getMinutes()) + ' \u2013 ' + pad2(en.getHours()) + ':' + pad2(en.getMinutes());
      }
      return fmtTime(s) + ' \u2013 ' + fmtTime(en);
    }
    function fmtCountdown(ms) {
      var mins = Math.ceil(ms / 60000);
      return mins < 60 ? (mins + ' min') : (Math.floor(mins / 60) + 'h ' + pad2(mins % 60) + 'm');
    }
    // Truncate long strings for e-paper readability
    function trunc(s, maxLen) {
      if (!s) return '';
      s = String(s);
      return s.length > maxLen ? s.slice(0, maxLen - 1) + '\u2026' : s;
    }

    var now = new Date();
    var startOfDay = new Date(now); startOfDay.setHours(0, 0, 0, 0);
    var endOfDay   = new Date(startOfDay); endOfDay.setDate(endOfDay.getDate() + 1);

    var today = events
      .filter(function (e) {
        return new Date(e.end).getTime() > startOfDay.getTime() &&
               new Date(e.start).getTime() < endOfDay.getTime();
      })
      .sort(function (a, b) { return new Date(a.start).getTime() - new Date(b.start).getTime(); });

    var currentEv = null, nextEv = null;
    for (var i = 0; i < today.length; i++) {
      var e = today[i];
      if (!e.allDay && new Date(e.start).getTime() <= now.getTime() && new Date(e.end).getTime() > now.getTime()) { currentEv = e; }
      if (!nextEv && !e.allDay && new Date(e.start).getTime() > now.getTime()) { nextEv = e; }
    }

    var isBusy = !!currentEv;
    var msToCurrentEnd = currentEv ? new Date(currentEv.end).getTime()  - now.getTime() : Infinity;
    var msToNextStart  = nextEv    ? new Date(nextEv.start).getTime()   - now.getTime() : Infinity;
    var isAmberEnding  = isBusy  && msToCurrentEnd < 15 * 60 * 1000;
    var isAmberSoon    = !isBusy && isFinite(msToNextStart) && msToNextStart < 15 * 60 * 1000;

    var railColor  = (isBusy && !isAmberEnding) ? '#d93025'
                   : (isBusy &&  isAmberEnding)  ? '#f59e0b'
                   : isAmberSoon                 ? '#f59e0b'
                   :                               '#34a853';

    var roomName      = roomMeta.name || content.name || 'Meeting Room';
    var logoUrl       = roomMeta.logoUrl || '';
    var backgroundUrl = roomMeta.backgroundUrl || '';
    var capacity      = roomMeta.capacity != null ? roomMeta.capacity : null;
    var isPortrait    = window.innerHeight > window.innerWidth;

    var statusText = isBusy
      ? (isAmberEnding ? 'ENDING SOON' : 'IN USE')
      : (isAmberSoon   ? 'STARTING SOON' : 'AVAILABLE');
    var statusLine = currentEv
      ? (isAmberEnding
          ? 'Ends in ' + fmtCountdown(msToCurrentEnd)
          : 'Until ' + (clock24
              ? pad2(toLocal(currentEv.end, tz).getHours()) + ':' + pad2(toLocal(currentEv.end, tz).getMinutes())
              : fmtTime(toLocal(currentEv.end, tz))))
      : nextEv
      ? (isAmberSoon
          ? 'Starts in ' + fmtCountdown(msToNextStart)
          : 'Free until ' + (clock24
              ? pad2(toLocal(nextEv.start, tz).getHours()) + ':' + pad2(toLocal(nextEv.start, tz).getMinutes())
              : fmtTime(toLocal(nextEv.start, tz))))
      : 'Free for the rest of the day';

    var dateStr = now.getFullYear() + '.' + pad2(now.getMonth() + 1) + '.' + pad2(now.getDate());

    // ── all-day strip ─────────────────────────────────────────────────────────
    var allDayEvs  = today.filter(function (ev) { return ev.allDay; });
    var timedEvs   = today.filter(function (ev) { return !ev.allDay; });

    var allDayHtml = '';
    if (allDayEvs.length > 0) {
      var chips = '';
      for (var ai = 0; ai < allDayEvs.length; ai++) {
        var ae = allDayEvs[ai];
        var aTitle = ae.isPrivate ? 'Busy' : trunc(ae.title || 'Reserved', 32);
        var isCancelled = ae.status === 'cancelled';
        chips +=
          '<span style="display:inline-flex;align-items:center;gap:5px;padding:4px 12px;border-radius:20px;' +
          'background:' + accent + '22;border:1px solid ' + accent + '44;font-size:18px;' +
          'color:' + (isCancelled ? muted : text) + ';' +
          (isCancelled ? 'text-decoration:line-through;opacity:0.55;' : '') + '">' +
            '\u25b6 ' + esc(aTitle) +
            (ae.status === 'tentative' ? ' <span style="font-size:14px;background:#f59e0b;color:#fff;padding:1px 5px;border-radius:3px;">?</span>' : '') +
          '</span>';
      }
      allDayHtml =
        '<div style="display:flex;flex-wrap:wrap;gap:8px;padding:10px 28px;' +
        'border-bottom:1px solid ' + border + ';background:' + (isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)') + ';">' +
          chips +
        '</div>';
    }

    // ── timed meetings list ───────────────────────────────────────────────────
    var meetingsHtml = '';
    if (timedEvs.length === 0 && allDayEvs.length === 0) {
      meetingsHtml = '<div style="display:flex;align-items:center;justify-content:center;height:100%;' +
        'color:' + muted + ';font-size:36px;letter-spacing:2px;text-transform:uppercase;' +
        'text-align:center;padding:40px;">No meetings scheduled for today</div>';
    } else {
      for (var ti = 0; ti < timedEvs.length; ti++) {
        var ev = timedEvs[ti];
        var isCurrent    = ev === currentEv;
        var isCancelledEv = ev.status === 'cancelled';
        var isTentativeEv = ev.status === 'tentative';
        var title = ev.isPrivate ? 'Busy' : trunc(ev.title || 'Reserved', 48);
        var org = (!ev.isPrivate && (ev.organizerName || ev.organizerEmail)) || '';
        var sub = '';
        if (!ev.isPrivate) {
          if (showLoc && ev.location) sub += '\ud83d\udccd ' + trunc(ev.location, 32) + '  ';
          if (showAtt && typeof ev.attendeeCount === 'number') sub += '\ud83d\udc65 ' + ev.attendeeCount + '  ';
        }
        if (org && !sub) sub = '(' + trunc(org, 36) + ')';

        meetingsHtml +=
          '<div style="display:flex;gap:24px;padding:20px 28px;align-items:baseline;' +
          'border-bottom:1px solid ' + border + ';' +
          'opacity:' + (isCancelledEv ? '0.45' : '1') + ';' +
          (isCurrent ? 'background:' + railColor + '1a;' : '') + '">' +
            '<div style="font-variant-numeric:tabular-nums;font-size:28px;font-weight:600;' +
            'color:' + text + ';white-space:nowrap;min-width:200px;">' + esc(fmtRange(ev)) + '</div>' +
            '<div style="flex:1;min-width:0;">' +
              '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">' +
                '<span style="font-size:28px;font-weight:600;color:' + text + ';overflow:hidden;text-overflow:ellipsis;white-space:nowrap;' +
                (isCancelledEv ? 'text-decoration:line-through;' : '') + '">' + esc(title) + '</span>' +
                (isTentativeEv ? '<span style="background:#f59e0b;color:#fff;padding:2px 8px;border-radius:4px;font-size:14px;font-weight:700;letter-spacing:0.5px;">TENTATIVE</span>' : '') +
                (isCancelledEv ? '<span style="background:#6b7280;color:#fff;padding:2px 8px;border-radius:4px;font-size:14px;font-weight:700;letter-spacing:0.5px;">CANCELLED</span>' : '') +
              '</div>' +
              (sub ? '<div style="font-size:18px;color:' + muted + ';margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(sub) + '</div>' : '') +
            '</div>' +
            (isCurrent ? '<div style="background:' + railColor + ';color:#fff;padding:5px 12px;border-radius:4px;' +
            'font-size:15px;text-transform:uppercase;letter-spacing:1px;align-self:center;flex-shrink:0;">Now</div>' : '') +
          '</div>';
      }
    }

    // ── header ────────────────────────────────────────────────────────────────
    var header =
      '<div style="display:flex;align-items:center;gap:18px;padding:18px 32px;' +
      'background:' + (isDark ? '#2a2e3e' : '#f1f3f5') + ';' +
      'border-bottom:3px solid ' + railColor + ';flex-shrink:0;">' +
        (logoUrl ? '<img src="' + esc(logoUrl) + '" alt="" style="height:64px;max-width:180px;object-fit:contain;flex-shrink:0;" />' : '') +
        '<div style="font-size:52px;font-weight:700;color:' + text + ';letter-spacing:2px;text-transform:uppercase;' +
        'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(roomName) + '</div>' +
        (roomMeta.location ? '<div style="font-size:22px;color:' + muted + ';margin-left:16px;flex-shrink:0;">' + esc(roomMeta.location) + '</div>' : '') +
      '</div>';

    // ── status rail (no live clock — e-paper avoids setInterval redraws) ──────
    var rail =
      '<div style="background:' + railColor + ';color:#fff;display:flex;flex-direction:column;' +
      'padding:28px 26px;' + (isPortrait ? 'flex-shrink:0;' : 'width:360px;flex-shrink:0;') + '">' +
        '<div style="font-size:22px;opacity:0.9;margin-top:0;">' + esc(dateStr) + '</div>' +
        '<div style="font-size:28px;font-weight:700;margin-top:22px;letter-spacing:1px;">' + esc(statusText) + '</div>' +
        '<div style="font-size:18px;opacity:0.92;margin-top:6px;">' + esc(statusLine) + '</div>' +
        (capacity != null
          ? '<div style="margin-top:24px;">' +
              '<div style="font-size:15px;letter-spacing:2px;text-transform:uppercase;opacity:0.85;margin-bottom:8px;">Room capacity</div>' +
              '<div style="display:inline-block;background:rgba(255,255,255,0.18);border:1px solid rgba(255,255,255,0.32);' +
              'padding:10px 20px;border-radius:6px;font-size:32px;font-weight:700;">' + esc(String(capacity)) + '</div>' +
            '</div>'
          : '') +
      '</div>';

    // ── body ──────────────────────────────────────────────────────────────────
    var body =
      '<div style="flex:1;position:relative;overflow:hidden;' +
      (backgroundUrl ? 'background-image:url(' + JSON.stringify(backgroundUrl) + ');background-size:cover;background-position:center;' : '') + '">' +
        (backgroundUrl ? '<div style="position:absolute;inset:0;background:' + (isDark ? 'rgba(30,30,46,0.78)' : 'rgba(255,255,255,0.78)') + ';"></div>' : '') +
        '<div style="position:relative;height:100%;overflow-y:auto;">' +
          allDayHtml +
          meetingsHtml +
        '</div>' +
      '</div>';

    // ── edge overlay (static — no animation on e-paper) ───────────────────────
    var edgeOverlay =
      '<div style="pointer-events:none;position:absolute;inset:0;z-index:999;' +
      'box-shadow:inset 0 0 0 12px ' + railColor + ';"></div>';

    container.innerHTML =
      '<div style="position:absolute;top:0;right:0;bottom:0;left:0;display:flex;flex-direction:column;' +
      'background:' + bg + ';color:' + text + ';' +
      'font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,sans-serif;overflow:hidden;">' +
        header +
        '<div style="flex:1;display:flex;flex-direction:' + (isPortrait ? 'column' : 'row') + ';overflow:hidden;">' +
          body +
          rail +
        '</div>' +
        edgeOverlay +
      '</div>';
  }

  // ── instance tracking ───────────────────────────────────────────────────────
  // keyed by content.id so multiple calendars could coexist (playlist cycling)
  var _instances = {};

  // ── public API ──────────────────────────────────────────────────────────────

  function render(container, content, deviceToken) {
    if (!container || !content) return;
    var id = content.id;

    // Tear down any prior instance on this container
    destroy(container);

    var meta = {};
    try { meta = JSON.parse(content.metadata || '{}'); } catch (e) {}
    var view          = meta.view || 'agenda';
    var tz            = meta.timezone || 'UTC';
    var lookaheadDays = (view === 'day' || view === 'meeting_room') ? 1 : (view === 'month' ? 31 : 7);

    var inst = { id: id, midnightTimer: null, boundaryTimer: null, lastSig: '', lastKnownEvents: [], lastBoundaryRender: 0, container: container, content: content };
    _instances[id] = inst;

    var doRender = function (evs) {
      if (_instances[id] !== inst) return;
      inst.lastKnownEvents = evs;
      inst.lastBoundaryRender = Date.now();
      if (view === 'meeting_room') {
        renderMeetingRoom(container, evs, content, meta, tz);
      } else {
        renderAgenda(container, evs, content, meta, tz);
        // agenda view has no clock — no timer needed
      }
    };

    var doFetch = function () {
      if (_instances[id] !== inst) return;
      // Use the same date range as the QBC/SBB Tizen player:
      // from = midnight today (local), to = midnight today + lookaheadDays.
      // This ensures e-paper and TV players show identical event sets.
      var from = new Date(); from.setHours(0, 0, 0, 0);
      var to   = new Date(from); to.setDate(to.getDate() + lookaheadDays);
      var url  = CONFIG.API_BASE + '/devices/device/content/' + encodeURIComponent(id) +
                 '/calendar/events?from=' + encodeURIComponent(from.toISOString()) +
                 '&to='   + encodeURIComponent(to.toISOString()) +
                 (deviceToken ? ('&token=' + encodeURIComponent(deviceToken)) : '');

      fetch(url)
        .then(function (res) {
          return res.ok ? res.json() : Promise.reject(new Error('HTTP ' + res.status));
        })
        .then(function (body) {
          if (_instances[id] !== inst) return;
          var evs = body.events || [];
          var sig = eventsSignature(evs);
          try { localStorage.setItem('cal_events_' + id, JSON.stringify({ events: evs, cachedAt: Date.now() })); } catch (e) {}
          if (sig !== inst.lastSig) {
            inst.lastSig = sig;
            doRender(evs);
          }
        })
        .catch(function (err) {
          logger.warn('[EpaperCalendar] fetch failed: ' + (err && err.message));
          if (inst.lastSig) return; // keep existing render on screen
          try {
            var cached = localStorage.getItem('cal_events_' + id);
            if (cached) {
              var parsed = JSON.parse(cached);
              inst.lastSig = eventsSignature(parsed.events || []);
              doRender(parsed.events || []);
            }
          } catch (e) {}
        });
    };

    // First paint: use cached events for instant display, then fetch fresh
    try {
      var cached = localStorage.getItem('cal_events_' + id);
      if (cached) {
        var parsed = JSON.parse(cached);
        inst.lastSig = eventsSignature(parsed.events || []);
        doRender(parsed.events || []);
      }
    } catch (e) {}

    doFetch();

    // Subscribe for server-pushed updates via WS (server pushes calendar_events
    // whenever the calendar connection syncs new events — no polling needed).
    if (window.EpaperWS && EpaperWS.isOpen()) {
      EpaperWS.push({ type: 'calendar_subscribe', payload: { contentId: id } });
    }

    // Schedule a re-fetch at the next local midnight so the date range rolls
    // over to the next day automatically. No periodic polling — this is the
    // only timer, keeping the e-paper battery draw minimal.
    function scheduleMidnightRefresh() {
      if (_instances[id] !== inst) return;
      var now = new Date();
      var msUntilMidnight = (new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)).getTime() - now.getTime();
      inst.midnightTimer = setTimeout(function() {
        if (_instances[id] !== inst) return;
        logger.info('[EpaperCalendar] midnight refresh for ' + id);
        doFetch();
        scheduleMidnightRefresh(); // reschedule for the next midnight
      }, msUntilMidnight + 5000); // +5s buffer past midnight
    }
    scheduleMidnightRefresh();

    // Boundary timer — checks every 30 s whether a meeting has started or ended
    // since the last render. Fixes the case where the WS broker sees no data
    // change (same event list) but the busy/free state has flipped at meeting end.
    if (view === 'meeting_room') {
      inst.boundaryTimer = setInterval(function () {
        if (_instances[id] !== inst) { clearInterval(inst.boundaryTimer); return; }
        if (!inst.lastKnownEvents.length && !inst.lastSig) return;
        var sinceMs = inst.lastBoundaryRender;
        var nowMs   = Date.now();
        var crossed = inst.lastKnownEvents.some(function (e) {
          var s  = new Date(e.start).getTime();
          var en = new Date(e.end).getTime();
          return (s > sinceMs && s <= nowMs) || (en > sinceMs && en <= nowMs);
        });
        if (crossed) {
          inst.lastSig = ''; // allow re-render
          doRender(inst.lastKnownEvents);
        }
      }, 30000);
    }
  }

  function destroy(container) {
    Object.keys(_instances).forEach(function (id) {
      if (_instances[id].container === container) {
        if (_instances[id].midnightTimer) clearTimeout(_instances[id].midnightTimer);
        if (_instances[id].boundaryTimer) clearInterval(_instances[id].boundaryTimer);
        // Unsubscribe from server-pushed calendar events for this content
        if (window.EpaperWS && EpaperWS.isOpen()) {
          EpaperWS.push({ type: 'calendar_unsubscribe', payload: { contentId: id } });
        }
        delete _instances[id];
      }
    });
    container.innerHTML = '';
  }

  // Called by EpaperWS when the server pushes calendar_events for a content id.
  // Re-renders only if the event set has actually changed (signature check).
  function pushUpdate(contentId, events) {
    var inst = _instances[contentId];
    if (!inst) return; // calendar not currently rendered — ignore
    var sig = eventsSignature(events);
    try { localStorage.setItem('cal_events_' + contentId, JSON.stringify({ events: events, cachedAt: Date.now() })); } catch (e) {}
    if (sig === inst.lastSig) return; // no change
    inst.lastSig = sig;
    inst.lastKnownEvents = events;
    inst.lastBoundaryRender = Date.now();
    logger.info('[EpaperCalendar] WS push re-render for ' + contentId + ' (' + events.length + ' events)');
    var meta = {};
    try { meta = JSON.parse((inst.content && inst.content.metadata) || '{}'); } catch (e) {}
    var view = meta.view || 'agenda';
    var tz   = meta.timezone || 'UTC';
    if (view === 'meeting_room') {
      renderMeetingRoom(inst.container, events, inst.content || { id: contentId, name: '' }, meta, tz);
    } else {
      renderAgenda(inst.container, events, inst.content || { id: contentId, name: '' }, meta, tz);
    }
  }

  // Re-send calendar_subscribe for all active instances.
  // Called by EpaperWS.onopen so subscriptions survive WS reconnects.
  function resubscribeAll() {
    if (!window.EpaperWS || !EpaperWS.isOpen()) return;
    Object.keys(_instances).forEach(function (id) {
      EpaperWS.push({ type: 'calendar_subscribe', payload: { contentId: id } });
      logger.info('[EpaperCalendar] re-subscribed ' + id + ' after WS reconnect');
    });
  }

  return { render: render, destroy: destroy, pushUpdate: pushUpdate, resubscribeAll: resubscribeAll };
}());
