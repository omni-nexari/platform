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

  var PALETTE  = ['#1a73e8', '#0f9d58', '#e67c00', '#8430ce', '#d50000', '#0097a7', '#616161', '#e91e63'];
  var HOUR_PX  = 64;  // pixels per hour — matches Tizen
  var WIN_START = 7;  // visible time window start (7 AM)
  var WIN_END   = 21; // visible time window end   (9 PM)

  // Always shows h:mm AM/PM (unlike fmtTime which drops :00)
  function fmtTimeFull(d) {
    var h = d.getHours(), m = d.getMinutes(), ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return h + ':' + pad2(m) + ' ' + ampm;
  }

  // ── time-grid shared builders (match Tizen's buildHeader / buildTimeGutter / etc.) ──

  function buildCalHeader(contentName, dateLabel, now, accent, bg, border, text, muted) {
    // No live clock — e-paper avoids setInterval redraws; show static date only.
    var dateStr = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    return '<header style="flex-shrink:0;display:flex;align-items:center;padding:16px 24px;' +
           'background:' + bg + ';border-bottom:1px solid ' + border + ';gap:16px;">' +
             '<div style="width:4px;min-height:40px;background:' + accent + ';border-radius:2px;flex-shrink:0;"></div>' +
             '<div style="flex:1;min-width:0;">' +
               '<div style="font-size:13px;color:' + muted + ';font-weight:500;text-transform:uppercase;letter-spacing:0.5px;">' + esc(contentName) + '</div>' +
               '<div style="font-size:20px;font-weight:600;color:' + text + ';margin-top:2px;">' + esc(dateLabel) + '</div>' +
             '</div>' +
             '<div style="text-align:right;flex-shrink:0;font-size:13px;color:' + muted + ';">' + esc(dateStr) + '</div>' +
           '</header>';
  }

  function buildTimeGutter(startH, endH, muted, border) {
    var rows = '';
    for (var h = startH; h <= endH; h++) {
      var label = h === 0 ? '' : (h < 12 ? (h + ' AM') : h === 12 ? '12 PM' : ((h - 12) + ' PM'));
      rows += '<div style="height:' + HOUR_PX + 'px;box-sizing:border-box;padding-right:8px;text-align:right;' +
              'font-size:11px;color:' + muted + ';position:relative;top:-7px;">' + esc(label) + '</div>';
    }
    return '<div style="width:52px;flex-shrink:0;border-right:1px solid ' + border + ';overflow:hidden;">' + rows + '</div>';
  }

  function buildHourLines(numHours, border) {
    var lines = '';
    for (var h = 0; h <= numHours; h++) {
      lines += '<div style="position:absolute;left:0;right:0;top:' + (h * HOUR_PX) + 'px;' +
               'border-top:1px solid ' + border + ';pointer-events:none;"></div>';
    }
    return lines;
  }

  function buildNowIndicator(now, startH, endH, accent) {
    var minOfDay = now.getHours() * 60 + now.getMinutes();
    var winStart = startH * 60;
    var winEnd   = endH * 60;
    if (minOfDay < winStart || minOfDay > winEnd) return '';
    var top = ((minOfDay - winStart) / 60) * HOUR_PX;
    return '<div style="position:absolute;left:-5px;width:10px;height:10px;border-radius:50%;' +
           'background:' + accent + ';z-index:10;top:' + (top - 5) + 'px;"></div>' +
           '<div style="position:absolute;left:0;right:0;top:' + top + 'px;' +
           'border-top:2px solid ' + accent + ';z-index:9;"></div>';
  }

  function buildAllDayStrip(allDayEvs, days, tz, accent, border, muted) {
    if (!allDayEvs || allDayEvs.length === 0) return '';
    var numCols = days.length;
    var colW = 100 / numCols;
    var chips = '';
    for (var i = 0; i < allDayEvs.length; i++) {
      var ev = allDayEvs[i];
      var evDay = isoDate(toLocal(ev.start, tz));
      var colIdx = 0;
      for (var j = 0; j < days.length; j++) {
        if (isoDate(days[j]) === evDay) { colIdx = j; break; }
      }
      chips += '<div style="position:absolute;left:calc(' + (colIdx * colW).toFixed(2) + '% + 2px);' +
               'width:calc(' + colW.toFixed(2) + '% - 4px);' +
               'top:' + (i * 22) + 'px;height:20px;background:' + PALETTE[i % PALETTE.length] + ';border-radius:3px;' +
               'padding:2px 6px;font-size:11px;color:#fff;font-weight:600;' +
               'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' +
               esc(ev.title || '(all day)') + '</div>';
    }
    var stripH = allDayEvs.length * 22 + 4;
    return '<div style="display:flex;flex-shrink:0;border-bottom:1px solid ' + border + ';">' +
             '<div style="width:52px;flex-shrink:0;font-size:11px;color:' + muted + ';' +
             'padding:4px 8px 4px 0;text-align:right;border-right:1px solid ' + border + ';">all-day</div>' +
             '<div style="flex:1;position:relative;height:' + stripH + 'px;">' + chips + '</div>' +
           '</div>';
  }

  function buildDayEventsHtml(dayEvs, startH, endH, tz, privacyMode) {
    var html = '';
    for (var i = 0; i < dayEvs.length; i++) {
      var ev = dayEvs[i];
      if (ev.allDay) continue;
      var s   = toLocal(ev.start, tz);
      var e2  = toLocal(ev.end,   tz);
      var startMin = s.getHours()  * 60 + s.getMinutes();
      var endMin   = Math.min(e2.getHours() * 60 + e2.getMinutes(), endH * 60);
      var durMin   = Math.max(endMin - startMin, 30);
      var top      = ((startMin - startH * 60) / 60) * HOUR_PX;
      var height   = Math.max((durMin / 60) * HOUR_PX, 22);
      // Clip events entirely outside the visible window
      if (top + height < 0 || top > (endH - startH) * HOUR_PX) continue;
      var color   = PALETTE[i % PALETTE.length];
      var title   = (ev.isPrivate || privacyMode === 'busy_only') ? 'Busy' : (ev.title || '(no title)');
      var showLoc = height > 44 && ev.location && !ev.isPrivate && privacyMode !== 'busy_only';
      html += '<div style="position:absolute;left:2px;right:2px;top:' + top + 'px;height:' + height + 'px;' +
              'background:' + color + ';border-radius:4px;padding:3px 6px;box-sizing:border-box;overflow:hidden;z-index:5;">' +
                '<div style="font-size:12px;font-weight:600;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' +
                  esc(title) +
                '</div>' +
                '<div style="font-size:11px;color:rgba(255,255,255,0.85);white-space:nowrap;overflow:hidden;">' +
                  fmtTimeFull(s) + ' \u2013 ' + fmtTimeFull(e2) +
                '</div>' +
                (showLoc ? '<div style="font-size:10px;color:rgba(255,255,255,0.75);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + esc(ev.location) + '</div>' : '') +
              '</div>';
    }
    return html;
  }

  // ── view renderers ──────────────────────────────────────────────────────────

  // ── renderDayView: time-grid for today — identical structure to Tizen renderDayView ──
  function renderDayView(container, events, content, meta, tz) {
    var accent      = (meta.theme && meta.theme.accentColor) || '#1a73e8';
    var isDark      = !!(meta.theme && meta.theme.background === 'dark');
    var bg          = isDark ? '#1e1e2e' : '#ffffff';
    var text        = isDark ? '#e2e8f0' : '#202124';
    var muted       = isDark ? '#94a3b8' : '#70757a';
    var border      = isDark ? '#3a3a50' : '#e0e0e0';
    var privacyMode = (meta.privacyMode) || 'titles';

    var now       = new Date();
    var todayKey  = isoDate(now);
    var dayEvs    = events.filter(function (e) { return isoDate(toLocal(e.start, tz)) === todayKey; });
    var allDayEvs = dayEvs.filter(function (e) { return  e.allDay; });
    var timedEvs  = dayEvs.filter(function (e) { return !e.allDay; });

    var dateLabel = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    var gridH     = (WIN_END - WIN_START) * HOUR_PX;

    container.innerHTML =
      '<div style="position:absolute;inset:0;display:flex;flex-direction:column;background:' + bg + ';color:' + text + ';' +
      'font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,sans-serif;overflow:hidden;">' +
        buildCalHeader(content.name || 'Calendar', dateLabel, now, accent, bg, border, text, muted) +
        buildAllDayStrip(allDayEvs, [now], tz, accent, border, muted) +
        '<div style="flex:1;display:flex;overflow:hidden;">' +
          buildTimeGutter(WIN_START, WIN_END, muted, border) +
          '<div style="flex:1;overflow-y:auto;position:relative;">' +
            '<div style="position:relative;height:' + gridH + 'px;">' +
              buildHourLines(WIN_END - WIN_START, border) +
              buildNowIndicator(now, WIN_START, WIN_END, accent) +
              buildDayEventsHtml(timedEvs, WIN_START, WIN_END, tz, privacyMode) +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';
  }

  // ── renderWeekView: time-grid with day columns — identical to Tizen renderWeekView ──
  function renderWeekView(container, events, content, meta, tz, numDays) {
    var accent      = (meta.theme && meta.theme.accentColor) || '#1a73e8';
    var isDark      = !!(meta.theme && meta.theme.background === 'dark');
    var bg          = isDark ? '#1e1e2e' : '#ffffff';
    var text        = isDark ? '#e2e8f0' : '#202124';
    var muted       = isDark ? '#94a3b8' : '#70757a';
    var border      = isDark ? '#3a3a50' : '#e0e0e0';
    var privacyMode = (meta.privacyMode) || 'titles';

    var now = new Date();
    var dow = now.getDay();
    // For 5-day (workweek): start Monday; for 7-day: start Sunday (matches Tizen)
    var offset = (numDays === 5) ? (dow === 0 ? -6 : 1 - dow) : -dow;
    var startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() + offset);
    startOfWeek.setHours(0, 0, 0, 0);

    var days = [];
    for (var di = 0; di < numDays; di++) {
      var d = new Date(startOfWeek);
      d.setDate(d.getDate() + di);
      days.push(d);
    }

    var rangeLabel = days[0].toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
                     ' \u2013 ' + days[numDays - 1].toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    var todayIso   = isoDate(now);
    var colW       = 100 / numDays;

    var allDayEvs = events.filter(function (e) { return  e.allDay; });
    var timedEvs  = events.filter(function (e) { return !e.allDay; });

    // Day column headers — weekday name + circle date (today highlighted)
    var dayHeaders = '';
    for (var hi = 0; hi < days.length; hi++) {
      var hd = days[hi];
      var isToday = isoDate(hd) === todayIso;
      dayHeaders +=
        '<div style="flex:1;text-align:center;padding:6px 4px;border-right:1px solid ' + border + ';">' +
          '<div style="font-size:11px;font-weight:500;color:' + muted + ';text-transform:uppercase;">' +
            hd.toLocaleDateString('en-US', { weekday: 'short' }) +
          '</div>' +
          '<div style="width:30px;height:30px;margin:4px auto 0;border-radius:50%;' +
               'display:flex;align-items:center;justify-content:center;' +
               'background:' + (isToday ? accent : 'transparent') + ';' +
               'color:' + (isToday ? '#fff' : text) + ';font-size:16px;font-weight:' + (isToday ? '700' : '400') + ';">' +
            hd.getDate() +
          '</div>' +
        '</div>';
    }

    // Events per day column
    var dayEventCols = '';
    for (var ci = 0; ci < days.length; ci++) {
      var dayKey  = isoDate(days[ci]);
      var colEvs  = timedEvs.filter(function (e) { return isoDate(toLocal(e.start, tz)) === dayKey; });
      var left    = (ci * colW).toFixed(2);
      var colWidth = colW.toFixed(2);
      dayEventCols +=
        '<div style="position:absolute;left:' + left + '%;width:' + colWidth + '%;top:0;bottom:0;">' +
          buildDayEventsHtml(colEvs, WIN_START, WIN_END, tz, privacyMode) +
        '</div>';
    }

    // Vertical day separator lines
    var separators = '';
    for (var si = 1; si < days.length; si++) {
      separators += '<div style="position:absolute;left:' + (si * colW).toFixed(2) + '%;top:0;bottom:0;border-left:1px solid ' + border + ';pointer-events:none;"></div>';
    }

    var todayInView = days.some(function (d) { return isoDate(d) === todayIso; });
    var gridH = (WIN_END - WIN_START) * HOUR_PX;

    container.innerHTML =
      '<div style="position:absolute;inset:0;display:flex;flex-direction:column;background:' + bg + ';color:' + text + ';' +
      'font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,sans-serif;overflow:hidden;">' +
        buildCalHeader(content.name || 'Calendar', rangeLabel, now, accent, bg, border, text, muted) +
        '<div style="display:flex;border-bottom:1px solid ' + border + ';flex-shrink:0;">' +
          '<div style="width:52px;flex-shrink:0;border-right:1px solid ' + border + ';"></div>' +
          dayHeaders +
        '</div>' +
        buildAllDayStrip(allDayEvs, days, tz, accent, border, muted) +
        '<div style="flex:1;display:flex;overflow:hidden;">' +
          buildTimeGutter(WIN_START, WIN_END, muted, border) +
          '<div style="flex:1;overflow-y:auto;position:relative;">' +
            '<div style="position:relative;height:' + gridH + 'px;">' +
              buildHourLines(WIN_END - WIN_START, border) +
              (todayInView ? buildNowIndicator(now, WIN_START, WIN_END, accent) : '') +
              dayEventCols +
              separators +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';
  }

  // ── renderListView (legacy agenda): day + week — kept only as internal fallback ──
  function renderListView(container, events, content, meta, tz, view) {
    var accent      = (meta.theme && meta.theme.accentColor) || '#1a73e8';
    var isDark      = !!(meta.theme && meta.theme.background === 'dark');
    var bg          = isDark ? '#1e1e2e' : '#ffffff';
    var text        = isDark ? '#e2e8f0' : '#202124';
    var muted       = isDark ? '#94a3b8' : '#70757a';
    var border      = isDark ? '#3a3a50' : '#e0e0e0';
    var surf        = isDark ? '#2a2a3e' : '#f8f9fa';
    var privacyMode = (meta.privacyMode) || 'titles';

    var now = new Date();
    var todayIso = isoDate(now);

    // Date range for this view
    var from = new Date(now); from.setHours(0, 0, 0, 0);
    var to;
    if (view === 'day') {
      to = new Date(from); to.setDate(to.getDate() + 1);
    } else {
      // week: Sun–Sat same as Tizen 7-day
      from.setDate(from.getDate() - from.getDay());
      to = new Date(from); to.setDate(to.getDate() + 7);
    }

    // Header label — matches Tizen's buildHeader dateLabel
    var dateLabel, emptyMsg;
    if (view === 'day') {
      dateLabel = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
      emptyMsg  = 'No events today';
    } else {
      var sunDate = new Date(now); sunDate.setDate(now.getDate() - now.getDay());
      var satDate = new Date(sunDate); satDate.setDate(sunDate.getDate() + 6);
      dateLabel = sunDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
                  ' \u2013 ' + satDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      emptyMsg  = 'No events this week';
    }
    var fullDateStr = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

    var filtered = events
      .filter(function (e) {
        return new Date(e.end).getTime() > from.getTime() &&
               new Date(e.start).getTime() < to.getTime();
      })
      .sort(function (a, b) { return new Date(a.start).getTime() - new Date(b.start).getTime(); });

    var rows = '';
    if (filtered.length === 0) {
      rows = '<div style="flex:1;display:flex;align-items:center;justify-content:center;opacity:0.5;">' +
             '<p style="font-size:36px;">' + emptyMsg + '</p></div>';
    } else {
      var lastDay = '';
      for (var i = 0; i < filtered.length; i++) {
        var ev = filtered[i];
        var s  = toLocal(ev.start, tz);
        var en = toLocal(ev.end, tz);
        var day = isoDate(s);
        if (day !== lastDay) {
          lastDay = day;
          var isToday = day === todayIso;
          var dayLabel = s.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
          rows += '<div style="padding:18px 40px 8px;font-size:22px;font-weight:700;' +
                  'color:' + (isToday ? accent : muted) + ';' +
                  'text-transform:uppercase;letter-spacing:1px;border-bottom:2px solid ' + border + ';' +
                  'background:' + surf + ';">' + esc(dayLabel) + '</div>';
        }
        var color       = PALETTE[i % PALETTE.length];
        var isNow       = new Date(ev.start).getTime() <= now.getTime() && new Date(ev.end).getTime() > now.getTime();
        var isCancelled = ev.status === 'cancelled';
        var isTentative = ev.status === 'tentative';
        var title       = (ev.isPrivate || privacyMode === 'busy_only') ? 'Busy' : (ev.title || '(no title)');
        var timeRange   = ev.allDay ? 'All day' : (fmtTime(s) + ' \u2013 ' + fmtTime(en));
        var locStr      = (!ev.isPrivate && privacyMode !== 'busy_only' && ev.location) ? ev.location : '';
        rows +=
          '<div style="display:flex;gap:24px;padding:24px 40px;border-bottom:1px solid ' + border + ';' +
          'opacity:' + (isCancelled ? '0.45' : '1') + ';' +
          'background:' + (isNow ? (isDark ? 'rgba(26,115,232,0.15)' : 'rgba(26,115,232,0.06)') : bg) + ';">' +
            '<div style="width:6px;min-height:48px;border-radius:3px;background:' + color + ';flex-shrink:0;margin-top:4px;"></div>' +
            '<div style="flex:1;min-width:0;">' +
              '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">' +
                '<span style="font-size:32px;font-weight:700;color:' + text + ';overflow:hidden;text-overflow:ellipsis;white-space:nowrap;' +
                (isCancelled ? 'text-decoration:line-through;' : '') + '">' + esc(title) + '</span>' +
                (isTentative ? '<span style="background:#f59e0b;color:#fff;padding:3px 10px;border-radius:4px;font-size:16px;font-weight:700;">TENTATIVE</span>' : '') +
                (isCancelled ? '<span style="background:#6b7280;color:#fff;padding:3px 10px;border-radius:4px;font-size:16px;font-weight:700;">CANCELLED</span>' : '') +
              '</div>' +
              '<div style="font-size:22px;color:' + muted + ';margin-top:6px;">' + esc(timeRange) + '</div>' +
              (locStr ? '<div style="font-size:20px;color:' + muted + ';margin-top:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">\ud83d\udccd ' + esc(locStr) + '</div>' : '') +
            '</div>' +
            (isNow ? '<div style="align-self:center;background:' + accent + ';color:#fff;padding:6px 18px;border-radius:6px;font-size:18px;font-weight:700;flex-shrink:0;">NOW</div>' : '') +
          '</div>';
      }
    }

    container.innerHTML =
      '<div style="position:absolute;inset:0;display:flex;flex-direction:column;background:' + bg + ';color:' + text + ';' +
      'font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,sans-serif;overflow:hidden;">' +
        // Header: same structure as Tizen buildHeader, but no live clock element
        '<header style="flex-shrink:0;display:flex;align-items:center;padding:16px 24px;background:' + bg + ';border-bottom:1px solid ' + border + ';gap:16px;">' +
          '<div style="width:4px;min-height:40px;background:' + accent + ';border-radius:2px;flex-shrink:0;"></div>' +
          '<div style="flex:1;min-width:0;">' +
            '<div style="font-size:13px;color:' + muted + ';font-weight:500;text-transform:uppercase;letter-spacing:0.5px;">' + esc(content.name || 'Calendar') + '</div>' +
            '<div style="font-size:20px;font-weight:600;color:' + text + ';margin-top:2px;">' + esc(dateLabel) + '</div>' +
          '</div>' +
          '<div style="text-align:right;flex-shrink:0;font-size:13px;color:' + muted + ';">' + esc(fullDateStr) + '</div>' +
        '</header>' +
        '<div style="flex:1;overflow-y:auto;">' + rows + '</div>' +
      '</div>';
  }

  // ── renderMonthGrid: month calendar grid — identical to Tizen renderMonthView ──
  function renderMonthGrid(container, events, content, meta, tz) {
    var accent      = (meta.theme && meta.theme.accentColor) || '#1a73e8';
    var isDark      = !!(meta.theme && meta.theme.background === 'dark');
    var bg          = isDark ? '#1e1e2e' : '#ffffff';
    var surface     = isDark ? '#2a2a3e' : '#f8f9fa';
    var text        = isDark ? '#e2e8f0' : '#202124';
    var muted       = isDark ? '#94a3b8' : '#70757a';
    var border      = isDark ? '#3a3a50' : '#e0e0e0';
    var privacyMode = (meta.privacyMode) || 'titles';

    var now       = new Date();
    var todayIso  = isoDate(now);
    var monthLabel   = now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

    var firstDay  = new Date(now.getFullYear(), now.getMonth(), 1);
    var lastDay   = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    var startDow  = firstDay.getDay();
    var totalDays = lastDay.getDate();

    var cells = [];
    for (var pi = 0; pi < startDow; pi++) cells.push(null);
    for (var di = 1; di <= totalDays; di++) cells.push(new Date(now.getFullYear(), now.getMonth(), di));
    while (cells.length % 7 !== 0) cells.push(null);

    var weeks = [];
    for (var wi = 0; wi < cells.length; wi += 7) weeks.push(cells.slice(wi, wi + 7));

    var DAY_HEADERS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    var headerRow =
      '<div style="display:flex;flex-shrink:0;border-bottom:2px solid ' + border + ';">' +
      DAY_HEADERS.map(function (d) {
        return '<div style="flex:1;text-align:center;font-size:11px;font-weight:600;color:' + muted + ';padding:8px 0;text-transform:uppercase;">' + d + '</div>';
      }).join('') + '</div>';

    var weekRowsHtml = '';
    for (var wri = 0; wri < weeks.length; wri++) {
      var week = weeks[wri];
      weekRowsHtml += '<div style="display:flex;flex:1;min-height:0;">';
      for (var ci = 0; ci < week.length; ci++) {
        var day = week[ci];
        if (!day) {
          weekRowsHtml += '<div style="flex:1;border:1px solid ' + border + ';background:' + surface + ';"></div>';
          continue;
        }
        var dayIso   = isoDate(day);
        var isToday  = dayIso === todayIso;
        var dayEvs   = events.filter(function (e) { return isoDate(toLocal(e.start, tz)) === dayIso; }).slice(0, 3);
        var chips    = '';
        for (var ei = 0; ei < dayEvs.length; ei++) {
          var ev     = dayEvs[ei];
          var evTitle = (ev.isPrivate || privacyMode === 'busy_only') ? 'Busy' : (ev.title || '(no title)');
          var evLocal = toLocal(ev.start, tz);
          var timePrefix = ev.allDay ? '' : '<span style="opacity:0.85;">' + fmtTimeFull(evLocal) + ' </span>';
          chips +=
            '<div style="margin:1px 4px;padding:1px 5px;border-radius:3px;font-size:11px;' +
            'background:' + PALETTE[ei % PALETTE.length] + ';color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' +
            timePrefix + esc(evTitle) + '</div>';
        }
        weekRowsHtml +=
          '<div style="flex:1;border:1px solid ' + border + ';padding:4px 0;box-sizing:border-box;overflow:hidden;' +
          'background:' + (isToday ? (isDark ? 'rgba(26,115,232,0.12)' : 'rgba(26,115,232,0.06)') : bg) + ';">' +
            '<div style="text-align:center;margin-bottom:2px;">' +
              '<span style="display:inline-block;width:24px;height:24px;line-height:24px;border-radius:50%;' +
              'text-align:center;font-size:13px;' +
              'background:' + (isToday ? accent : 'transparent') + ';' +
              'color:' + (isToday ? '#fff' : text) + ';font-weight:' + (isToday ? '700' : '400') + ';">' +
              day.getDate() + '</span>' +
            '</div>' +
            chips +
          '</div>';
      }
      weekRowsHtml += '</div>';
    }

    container.innerHTML =
      '<div style="position:absolute;inset:0;display:flex;flex-direction:column;background:' + bg + ';color:' + text + ';' +
      'font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,sans-serif;overflow:hidden;">' +
        buildCalHeader(content.name || 'Calendar', monthLabel, now, accent, bg, border, text, muted) +
        headerRow +
        '<div style="flex:1;display:flex;flex-direction:column;min-height:0;">' + weekRowsHtml + '</div>' +
      '</div>';
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

    var inst = { id: id, midnightTimer: null, boundaryTimer: null, lastSig: null, lastKnownEvents: [], lastBoundaryRender: 0, container: container, content: content };
    _instances[id] = inst;

    var doRender = function (evs) {
      if (_instances[id] !== inst) return;
      inst.lastKnownEvents = evs;
      inst.lastBoundaryRender = Date.now();
      if (view === 'meeting_room') {
        renderMeetingRoom(container, evs, content, meta, tz);
      } else if (view === 'month') {
        renderMonthGrid(container, evs, content, meta, tz);
      } else if (view === 'day') {
        renderDayView(container, evs, content, meta, tz);
      } else {
        // week / workweek / legacy 'agenda' — time-grid with day columns
        renderWeekView(container, evs, content, meta, tz, view === 'workweek' ? 5 : 7);
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
          // inst.lastSig is null until first render; always render on first fetch
          // (even empty events list) so the calendar frame is visible.
          if (inst.lastSig === null || sig !== inst.lastSig) {
            inst.lastSig = sig;
            doRender(evs);
          }
        })
        .catch(function (err) {
          logger.warn('[EpaperCalendar] fetch failed: ' + (err && err.message));
          if (inst.lastSig !== null) return; // keep existing render on screen
          // No prior render — try cache, then fall back to empty calendar
          // so the container is never left as a blank white div.
          try {
            var cached = localStorage.getItem('cal_events_' + id);
            if (cached) {
              var parsed = JSON.parse(cached);
              inst.lastSig = eventsSignature(parsed.events || []);
              doRender(parsed.events || []);
              return;
            }
          } catch (e) {}
          inst.lastSig = '';
          doRender([]);
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
    } else if (view === 'month') {
      renderMonthGrid(inst.container, events, inst.content || { id: contentId, name: '' }, meta, tz);
    } else if (view === 'day') {
      renderDayView(inst.container, events, inst.content || { id: contentId, name: '' }, meta, tz);
    } else {
      renderWeekView(inst.container, events, inst.content || { id: contentId, name: '' }, meta, tz, view === 'workweek' ? 5 : 7);
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
