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
    var isDark   = !!(meta.theme && meta.theme.background === 'dark');
    var bg       = isDark ? '#1e1e2e' : '#ffffff';
    var text     = isDark ? '#e2e8f0' : '#202124';
    var muted    = isDark ? '#94a3b8' : '#70757a';
    var border   = isDark ? '#3a3a50' : '#e0e0e0';
    var roomMeta = meta.roomMeta || {};

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
      if (new Date(e.start).getTime() <= now.getTime() && new Date(e.end).getTime() > now.getTime()) { currentEv = e; }
      if (!nextEv && new Date(e.start).getTime() > now.getTime()) { nextEv = e; }
    }
    var isBusy     = !!currentEv;
    var railColor  = isBusy ? '#d93025' : '#34a853';
    var roomName   = (roomMeta.name || content.name || 'Meeting Room');

    var fmtRange = function (ev) {
      var s = toLocal(ev.start, tz), en = toLocal(ev.end, tz);
      return pad2(s.getHours()) + ':' + pad2(s.getMinutes()) + ' \u2013 ' + pad2(en.getHours()) + ':' + pad2(en.getMinutes());
    };

    var statusLine = currentEv
      ? ('Until ' + fmtTime(toLocal(currentEv.end, tz)))
      : (nextEv ? 'Free until ' + fmtTime(toLocal(nextEv.start, tz)) : 'Free for the rest of the day');

    var meetingsHtml = today.length === 0
      ? '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:' + muted + ';font-size:22px;text-align:center;padding:40px;">No meetings scheduled for today</div>'
      : today.map(function (ev) {
          var isCurrent = ev === currentEv;
          var org = ev.organizerName || ev.organizerEmail || '';
          return '<div style="display:flex;gap:20px;padding:16px 24px;align-items:baseline;border-bottom:1px solid ' + border + ';' +
                 (isCurrent ? 'background:' + railColor + '1a;' : '') + '">' +
                   '<div style="font-size:20px;font-weight:600;color:' + text + ';white-space:nowrap;min-width:160px;">' + esc(fmtRange(ev)) + '</div>' +
                   '<div style="flex:1;min-width:0;">' +
                     '<div style="font-size:20px;font-weight:600;color:' + text + ';">' + esc(ev.title || 'Reserved') + '</div>' +
                     (org ? '<div style="font-size:14px;color:' + muted + ';margin-top:2px;">(' + esc(org) + ')</div>' : '') +
                   '</div>' +
                   (isCurrent ? '<div style="background:' + railColor + ';color:#fff;padding:4px 10px;border-radius:4px;font-size:11px;font-weight:700;align-self:center;flex-shrink:0;">Now</div>' : '') +
                 '</div>';
        }).join('');

    container.innerHTML =
      '<div style="position:absolute;inset:0;display:flex;flex-direction:column;background:' + bg + ';color:' + text + ';' +
      'font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,sans-serif;overflow:hidden;">' +
        '<div style="display:flex;align-items:center;gap:16px;padding:16px 28px;' +
             'background:' + (isDark ? '#2a2e3e' : '#f1f3f5') + ';border-bottom:3px solid ' + railColor + ';flex-shrink:0;">' +
          '<div style="font-size:28px;font-weight:700;color:' + text + ';letter-spacing:1px;text-transform:uppercase;">' + esc(roomName) + '</div>' +
          (roomMeta.location ? '<div style="font-size:14px;color:' + muted + ';">' + esc(roomMeta.location) + '</div>' : '') +
        '</div>' +
        '<div style="flex:1;display:flex;overflow:hidden;">' +
          '<div style="flex:1;overflow-y:auto;">' + meetingsHtml + '</div>' +
          '<div style="background:' + railColor + ';color:#fff;width:260px;flex-shrink:0;display:flex;flex-direction:column;padding:24px 20px;">' +
            '<div id="cal-clock" style="font-size:44px;font-weight:700;letter-spacing:-1px;line-height:1;">' + esc(fmtTime(now)) + '</div>' +
            '<div style="font-size:14px;opacity:0.9;margin-top:4px;">' + esc(now.toLocaleDateString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit' })) + '</div>' +
            '<div style="font-size:18px;font-weight:700;margin-top:16px;letter-spacing:1px;">' + (isBusy ? 'IN USE' : 'AVAILABLE') + '</div>' +
            '<div style="font-size:13px;opacity:0.9;margin-top:4px;">' + esc(statusLine) + '</div>' +
          '</div>' +
        '</div>' +
      '</div>';
  }

  // ── instance tracking ───────────────────────────────────────────────────────
  // keyed by content.id so multiple calendars could coexist (playlist cycling)
  var _instances = {};
  var _clockTimers = {};

  function startClock(container) {
    var key = container.id || '_cal';
    if (_clockTimers[key]) clearInterval(_clockTimers[key]);
    _clockTimers[key] = setInterval(function () {
      var el = container.querySelector('#cal-clock');
      if (el) el.textContent = fmtTime(new Date());
    }, 30000);
  }

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
    var refreshSec    = Math.max(15, Number(meta.refreshSeconds) || 60);
    var lookaheadDays = (view === 'day' || view === 'meeting_room') ? 1 : (view === 'month' ? 31 : 7);

    var inst = { id: id, timer: null, lastSig: '', container: container };
    _instances[id] = inst;

    var doRender = function (evs) {
      if (_instances[id] !== inst) return;
      if (view === 'meeting_room') {
        renderMeetingRoom(container, evs, content, meta, tz);
        startClock(container); // meeting room has a live clock widget
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
          } else {
            // Even if events haven't changed, refresh "now" indicators
            startClock(container);
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
    inst.timer = setInterval(doFetch, refreshSec * 1000);
  }

  function destroy(container) {
    Object.keys(_instances).forEach(function (id) {
      if (_instances[id].container === container) {
        if (_instances[id].timer) clearInterval(_instances[id].timer);
        delete _instances[id];
      }
    });
    var key = container.id || '_cal';
    if (_clockTimers[key]) { clearInterval(_clockTimers[key]); delete _clockTimers[key]; }
    container.innerHTML = '';
  }

  return { render: render, destroy: destroy };
}());
