/**
 * calendar.ts — Calendar widget renderer for player-web.
 *
 * Ported from apps/nexari-tizen/src/player.ts `renderCalendar()` method.
 * Supports views: day, week, workweek, month, meeting_room.
 * Fetches events from the API and subscribes to WS push updates.
 */
import type { ContentRecord, CalendarEvent as Ev } from '../api.js';
import type { Api } from '../api.js';

export interface CalendarHandle { destroy(): void; }

type CalendarView = 'day' | 'week' | 'workweek' | 'month' | 'meeting_room';

interface CalendarTheme {
  accentColor?: string;
  background?: 'light' | 'dark';
  clockStyle?: 'digital-12' | 'digital-24' | 'analog' | 'none';
  showAttendeeCount?: boolean;
  showLocation?: boolean;
}
interface RoomMeta {
  name?: string;
  capacity?: number;
  location?: string;
  bookingUrl?: string;
  backgroundUrl?: string;
  logoUrl?: string;
}

const PALETTE = ['#1a73e8','#0f9d58','#e67c00','#8430ce','#d50000','#0097a7','#616161','#e91e63'];
const HOUR_PX = 64;

function escapeHtml(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function parseMetadata(content: ContentRecord): Record<string, unknown> {
  if (!content.metadata) return {};
  if (typeof content.metadata === 'string') {
    try { return JSON.parse(content.metadata); } catch { return {}; }
  }
  return content.metadata as Record<string, unknown>;
}

export function renderCalendar(
  container: HTMLElement,
  content: ContentRecord,
  api: Api,
  deviceId: string,
  ws: WebSocket | null,
  /** Called when a calendar_events push arrives on the main WS — pass the raw msg.events array */
  registerPushHandler: (contentId: string, handler: (events: Ev[]) => void) => (() => void),
): CalendarHandle {
  const meta = parseMetadata(content);
  const view           = (String(meta['view'] || 'week')) as CalendarView;
  const timezone       = String(meta['timezone'] || 'UTC');
  const refreshSeconds = Math.max(15, Number(meta['refreshSeconds'] || 60));
  const theme          = (meta['theme'] as CalendarTheme) || {};
  const roomMeta       = (meta['roomMeta'] as RoomMeta | null) || null;
  const accent  = theme.accentColor || '#1a73e8';
  const isDark  = theme.background === 'dark';
  const bg        = isDark ? '#1e1e2e' : '#ffffff';
  const surface   = isDark ? '#2a2a3e' : '#f8f9fa';
  const border    = isDark ? '#3a3a50' : '#e0e0e0';
  const text      = isDark ? '#e2e8f0' : '#202124';
  const textMuted = isDark ? '#94a3b8' : '#70757a';
  const clockStyle = theme.clockStyle ?? 'digital-12';

  void surface; // used in month cell bg

  // Track timers/state for cleanup
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let clockTimer: ReturnType<typeof setInterval> | null = null;
  let midnightTimer: ReturnType<typeof setTimeout> | null = null;
  let boundaryTimer: ReturnType<typeof setInterval> | null = null;
  let lastSig = '';
  let lastBoundaryRender = 0;
  let lastKnownEvents: Ev[] = [];
  let lastPushAt = 0;
  let destroyed = false;

  const reqId = `cal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // ── Helpers ────────────────────────────────────────────────────────────────
  const toLocal   = (iso: string) => new Date(new Date(iso).toLocaleString('en-US', { timeZone: timezone }));
  const pad2      = (n: number) => (n < 10 ? '0' : '') + n;
  const getNow    = () => new Date(new Date().toLocaleString('en-US', { timeZone: timezone }));
  const isoDate   = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
  const fmtTimeFull = (d: Date) => { let h=d.getHours(); const m=d.getMinutes(); const a=h>=12?'PM':'AM'; h=h%12||12; return `${h}:${pad2(m)} ${a}`; };
  const fmtClockTime = (d: Date) => {
    if (clockStyle === 'none') return '';
    if (clockStyle === 'digital-24') return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
    let h=d.getHours(); const m=d.getMinutes(); const a=h>=12?'PM':'AM'; h=h%12||12;
    return `${h}:${pad2(m)} ${a}`;
  };
  const evColor = (_ev: Ev, idx: number) => PALETTE[idx % PALETTE.length];

  // ── Header ─────────────────────────────────────────────────────────────────
  const buildHeader = (dateLabel: string) => {
    const now = getNow();
    const dateStr = now.toLocaleDateString('en-US', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
    return `
      <header style="flex-shrink:0;display:flex;align-items:center;padding:16px 24px;background:${bg};border-bottom:1px solid ${border};gap:16px;">
        <div style="width:4px;min-height:40px;background:${accent};border-radius:2px;flex-shrink:0;"></div>
        <div style="flex:1;min-width:0;">
          <div style="font-size:13px;color:${textMuted};font-weight:500;text-transform:uppercase;letter-spacing:0.5px;">${escapeHtml(content.name||'Calendar')}</div>
          <div style="font-size:20px;font-weight:600;color:${text};margin-top:2px;">${escapeHtml(dateLabel)}</div>
        </div>
        <div style="text-align:right;flex-shrink:0;">
          <div id="cal-clock" style="font-size:28px;font-weight:700;color:${accent};letter-spacing:-0.5px;">${escapeHtml(fmtClockTime(now))}</div>
          <div style="font-size:13px;color:${textMuted};margin-top:2px;">${escapeHtml(dateStr)}</div>
        </div>
      </header>`;
  };

  const startClock = () => {
    if (clockTimer) clearInterval(clockTimer);
    clockTimer = setInterval(() => {
      if (destroyed) return;
      const el = container.querySelector<HTMLElement>('#cal-clock');
      if (el) el.textContent = fmtClockTime(getNow());
      const now = getNow();
      const minOfDay = now.getHours()*60 + now.getMinutes();
      const pct = (minOfDay / (24*60)) * 100;
      const line = container.querySelector<HTMLElement>('#cal-now-line');
      if (line) line.style.top = `${pct}%`;
      const dot = container.querySelector<HTMLElement>('#cal-now-dot');
      if (dot) dot.style.top = `calc(${pct}% - 5px)`;
    }, 30_000);
  };

  const buildTimeGutter = () => {
    let rows = '';
    for (let h=0; h<24; h++) {
      const label = h===0 ? '' : h<12 ? `${h} AM` : h===12 ? '12 PM' : `${h-12} PM`;
      rows += `<div style="height:${HOUR_PX}px;box-sizing:border-box;padding-right:8px;text-align:right;font-size:11px;color:${textMuted};position:relative;top:-7px;">${escapeHtml(label)}</div>`;
    }
    return `<div style="width:52px;flex-shrink:0;border-right:1px solid ${border};overflow:hidden;">${rows}</div>`;
  };

  const buildHourLines = () => {
    let lines = '';
    for (let h=0; h<24; h++) {
      lines += `<div style="position:absolute;left:0;right:0;top:${h*HOUR_PX}px;border-top:1px solid ${border};pointer-events:none;"></div>`;
    }
    return lines;
  };

  const buildNowIndicator = (now: Date) => {
    const pct = ((now.getHours()*60+now.getMinutes()) / (24*60)) * 100;
    return `<div id="cal-now-dot" style="position:absolute;left:-5px;width:10px;height:10px;border-radius:50%;background:${accent};z-index:10;top:calc(${pct}% - 5px);"></div>
            <div id="cal-now-line" style="position:absolute;left:0;right:0;top:${pct}%;border-top:2px solid ${accent};z-index:9;"></div>`;
  };

  const buildDayEvents = (dayEvs: Ev[]) =>
    dayEvs.filter(e => !e.allDay).map((ev, i) => {
      const s = toLocal(ev.start); const e2 = toLocal(ev.end);
      const startMin = s.getHours()*60+s.getMinutes();
      const endMin   = Math.min(e2.getHours()*60+e2.getMinutes(), 24*60);
      const durMin   = Math.max(endMin-startMin, 30);
      const top = (startMin/60)*HOUR_PX;
      const height = Math.max((durMin/60)*HOUR_PX, 22);
      const color = evColor(ev, i);
      const showLoc = height > 44 && ev.location;
      return `<div style="position:absolute;left:2px;right:4px;top:${top}px;height:${height}px;background:${color};border-radius:4px;padding:3px 6px;box-sizing:border-box;overflow:hidden;z-index:5;">
        <div style="font-size:12px;font-weight:600;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(ev.title||'(no title)')}</div>
        <div style="font-size:11px;color:rgba(255,255,255,0.85);white-space:nowrap;overflow:hidden;">${fmtTimeFull(s)} – ${fmtTimeFull(e2)}</div>
        ${showLoc ? `<div style="font-size:10px;color:rgba(255,255,255,0.75);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(ev.location!)}</div>` : ''}
      </div>`;
    }).join('');

  const buildAllDayStrip = (allDayEvs: Ev[], cols: Date[]) => {
    if (!allDayEvs.length) return '';
    const colW = 100 / cols.length;
    const chips = allDayEvs.map((ev, i) => {
      const s = toLocal(ev.start);
      const colIdx = cols.findIndex(d => isoDate(d) === isoDate(s));
      if (colIdx < 0) return '';
      return `<div style="position:absolute;left:calc(${colIdx*colW}% + 2px);width:calc(${colW}% - 4px);top:${i*22}px;height:20px;background:${evColor(ev,i)};border-radius:3px;padding:2px 6px;font-size:11px;color:#fff;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(ev.title||'(all day)')}</div>`;
    }).join('');
    const height = allDayEvs.length*22+4;
    return `<div style="display:flex;flex-shrink:0;border-bottom:1px solid ${border};">
      <div style="width:52px;flex-shrink:0;font-size:11px;color:${textMuted};padding:4px 8px 4px 0;text-align:right;border-right:1px solid ${border};">all-day</div>
      <div style="flex:1;position:relative;height:${height}px;">${chips}</div>
    </div>`;
  };

  // ── View renderers ─────────────────────────────────────────────────────────
  const renderDayView = (events: Ev[]) => {
    const now = getNow();
    const today = isoDate(now);
    const timedEvs = events.filter(e => isoDate(toLocal(e.start)) === today && !e.allDay);
    const allDayEvs = events.filter(e => isoDate(toLocal(e.start)) === today && e.allDay);
    const dateLabel = now.toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric', year:'numeric' });
    const scrollTop = Math.max(0, (now.getHours()-1)*HOUR_PX);
    container.innerHTML = `
      <div style="position:absolute;inset:0;display:flex;flex-direction:column;background:${bg};color:${text};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;overflow:hidden;">
        ${buildHeader(dateLabel)}
        ${buildAllDayStrip(allDayEvs, [now])}
        <div style="flex:1;display:flex;overflow:hidden;">
          ${buildTimeGutter()}
          <div id="cal-scroll" style="flex:1;overflow-y:auto;position:relative;">
            <div style="position:relative;height:${24*HOUR_PX}px;">${buildHourLines()}${buildNowIndicator(now)}${buildDayEvents(timedEvs)}</div>
          </div>
        </div>
      </div>`;
    const scroll = container.querySelector<HTMLElement>('#cal-scroll');
    if (scroll) scroll.scrollTop = scrollTop;
    startClock();
  };

  const renderWeekView = (events: Ev[], numDays: number) => {
    const now = getNow();
    const dow = now.getDay();
    const offset = numDays === 5 ? (dow===0 ? -6 : 1-dow) : -dow;
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate()+offset); startOfWeek.setHours(0,0,0,0);
    const days: Date[] = Array.from({length:numDays}, (_, i) => {
      const d = new Date(startOfWeek); d.setDate(d.getDate()+i); return d;
    });
    const rangeLabel = `${days[0]!.toLocaleDateString('en-US',{month:'short',day:'numeric'})} – ${days[numDays-1]!.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}`;
    const colW = 100/numDays;
    const allDayEvs = events.filter(e => e.allDay);
    const timedEvs = events.filter(e => !e.allDay);
    const todayIso = isoDate(now);

    const dayHeaders = days.map(d => {
      const isToday = isoDate(d) === todayIso;
      return `<div style="flex:1;text-align:center;padding:6px 4px;border-right:1px solid ${border};">
        <div style="font-size:11px;font-weight:500;color:${textMuted};text-transform:uppercase;">${d.toLocaleDateString('en-US',{weekday:'short'})}</div>
        <div style="width:30px;height:30px;margin:4px auto 0;border-radius:50%;display:flex;align-items:center;justify-content:center;background:${isToday?accent:'transparent'};color:${isToday?'#fff':text};font-size:16px;font-weight:${isToday?700:400};">${d.getDate()}</div>
      </div>`;
    }).join('');

    const dayEventCols = days.map(d => {
      const key = isoDate(d);
      const evs = timedEvs.filter(e => isoDate(toLocal(e.start)) === key);
      return `<div style="position:absolute;left:${days.indexOf(d)*colW}%;width:${colW}%;top:0;bottom:0;">${buildDayEvents(evs)}</div>`;
    }).join('');

    const dividers = days.slice(1).map((_, i) =>
      `<div style="position:absolute;left:${(i+1)*colW}%;top:0;bottom:0;border-left:1px solid ${border};pointer-events:none;"></div>`
    ).join('');

    const scrollTop = Math.max(0, (now.getHours()-1)*HOUR_PX);
    container.innerHTML = `
      <div style="position:absolute;inset:0;display:flex;flex-direction:column;background:${bg};color:${text};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;overflow:hidden;">
        ${buildHeader(rangeLabel)}
        <div style="display:flex;border-bottom:1px solid ${border};flex-shrink:0;">
          <div style="width:52px;flex-shrink:0;border-right:1px solid ${border};"></div>
          ${dayHeaders}
        </div>
        ${buildAllDayStrip(allDayEvs, days)}
        <div style="flex:1;display:flex;overflow:hidden;">
          ${buildTimeGutter()}
          <div id="cal-scroll" style="flex:1;overflow-y:auto;position:relative;">
            <div style="position:relative;height:${24*HOUR_PX}px;">${buildHourLines()}${days.some(d=>isoDate(d)===todayIso)?buildNowIndicator(now):''}${dayEventCols}${dividers}</div>
          </div>
        </div>
      </div>`;
    const scroll = container.querySelector<HTMLElement>('#cal-scroll');
    if (scroll) scroll.scrollTop = scrollTop;
    startClock();
  };

  const renderMonthView = (events: Ev[]) => {
    const now = getNow();
    const monthLabel = now.toLocaleDateString('en-US', { month:'long', year:'numeric' });
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
    const totalDays = new Date(now.getFullYear(), now.getMonth()+1, 0).getDate();
    const cells: (Date|null)[] = [...Array(firstDay.getDay()).fill(null), ...Array.from({length:totalDays}, (_, i) => new Date(now.getFullYear(), now.getMonth(), i+1))];
    while (cells.length % 7 !== 0) cells.push(null);
    const weeks: (Date|null)[][] = [];
    for (let i=0; i<cells.length; i+=7) weeks.push(cells.slice(i, i+7));
    const todayIso = isoDate(now);
    const numWeeks = weeks.length;
    const DAY_HEADERS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const headerRow = `<div style="display:flex;flex-shrink:0;border-bottom:2px solid ${border};">${DAY_HEADERS.map(d=>`<div style="flex:1;text-align:center;font-size:11px;font-weight:600;color:${textMuted};padding:8px 0;text-transform:uppercase;">${d}</div>`).join('')}</div>`;
    const weekRows = weeks.map(week =>
      `<div style="display:flex;flex:1;min-height:0;">${week.map(day => {
        if (!day) return `<div style="flex:1;border:1px solid ${border};background:${isDark?'#1a1a28':'#f8f9fa'};"></div>`;
        const dayIso = isoDate(day);
        const isToday = dayIso === todayIso;
        const dayEvs = events.filter(e => isoDate(toLocal(e.start)) === dayIso).slice(0,3);
        const chips = dayEvs.map((ev, i) => `<div style="margin:1px 4px;padding:1px 5px;border-radius:3px;font-size:11px;background:${evColor(ev,i)};color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${ev.allDay?'':fmtTimeFull(toLocal(ev.start))+' '}${escapeHtml(ev.title||'(no title)')}</div>`).join('');
        return `<div style="flex:1;border:1px solid ${border};padding:4px 0;box-sizing:border-box;overflow:hidden;background:${isToday?(isDark?'rgba(26,115,232,0.12)':'rgba(26,115,232,0.06)'):bg};">
          <div style="text-align:center;margin-bottom:2px;"><span style="display:inline-block;width:24px;height:24px;line-height:24px;border-radius:50%;text-align:center;font-size:13px;background:${isToday?accent:'transparent'};color:${isToday?'#fff':text};font-weight:${isToday?700:400};">${day.getDate()}</span></div>
          ${chips}
        </div>`;
      }).join('')}</div>`
    ).join('');
    container.innerHTML = `
      <div style="position:absolute;inset:0;display:flex;flex-direction:column;background:${bg};color:${text};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;overflow:hidden;">
        ${buildHeader(monthLabel)}
        <div style="flex:1;display:flex;flex-direction:column;overflow:hidden;">${headerRow}${weekRows}</div>
      </div>`;
    void numWeeks; // avoid TS unused warning
    startClock();
  };

  const renderMeetingRoom = (events: Ev[]) => {
    const now = getNow();
    const startOfDay = new Date(); startOfDay.setHours(0,0,0,0);
    const endOfDay = new Date(startOfDay); endOfDay.setDate(endOfDay.getDate()+1);
    const today = events
      .filter(e => new Date(e.end).getTime() > startOfDay.getTime() && new Date(e.start).getTime() < endOfDay.getTime())
      .sort((a,b) => new Date(a.start).getTime()-new Date(b.start).getTime());
    const currentEv = today.find(e => new Date(e.start).getTime() <= Date.now() && new Date(e.end).getTime() > Date.now());
    const nextEv = today.find(e => new Date(e.start).getTime() > Date.now());
    const isBusy = !!currentEv;
    const msToCurrentEnd = currentEv ? new Date(currentEv.end).getTime()-Date.now() : Infinity;
    const msToNextStart = nextEv ? new Date(nextEv.start).getTime()-Date.now() : Infinity;
    const isAmberEnding = isBusy && msToCurrentEnd < 15*60*1000;
    const isAmberSoon = !isBusy && isFinite(msToNextStart) && msToNextStart < 15*60*1000;
    const railColor = (isBusy&&!isAmberEnding) ? '#d93025' : (isBusy&&isAmberEnding)||isAmberSoon ? '#f59e0b' : '#34a853';

    const portrait     = window.innerHeight > window.innerWidth;
    const roomName     = roomMeta?.name || content.name || 'Meeting Room';
    const capacity     = roomMeta?.capacity ?? null;
    const bookingUrl   = roomMeta?.bookingUrl || '';
    const logoUrl      = roomMeta?.logoUrl || '';
    const backgroundUrl = roomMeta?.backgroundUrl || '';
    const showLoc  = theme.showLocation !== false;
    const showAtt  = !!theme.showAttendeeCount;

    const fmtRange = (e: Ev) => `${fmtClockTime(toLocal(e.start))} \u2013 ${fmtClockTime(toLocal(e.end))}`;
    const fmtCountdown = (ms: number) => { const m=Math.ceil(ms/60000); return m<60?`${m} min`:`${Math.floor(m/60)}h ${pad2(m%60)}m`; };

    const allDayEvents = today.filter(e => e.allDay);
    const timedEvents  = today.filter(e => !e.allDay);

    const allDayHtml = allDayEvents.length === 0 ? '' : `
      <div style="display:flex;flex-wrap:wrap;gap:8px;padding:12px 36px;border-bottom:1px solid ${border};background:${isDark?'rgba(255,255,255,0.04)':'rgba(0,0,0,0.03)'}">
        ${allDayEvents.map(e => {
          const isCancelled = e.status === 'cancelled';
          const isTentative = e.status === 'tentative';
          const title = e.isPrivate ? 'Busy' : (e.title || 'Reserved');
          return `<div style="display:inline-flex;align-items:center;gap:6px;padding:4px 14px;border-radius:20px;background:${accent}22;border:1px solid ${accent}44;font-size:18px;color:${isCancelled?textMuted:text};${isCancelled?'text-decoration:line-through;opacity:0.55;':''}">
            <span>&#9656;</span><span>${escapeHtml(title)}</span>
            ${isTentative?`<span style="font-size:14px;background:#f59e0b;color:#fff;padding:1px 6px;border-radius:3px;">?</span>`:''}
          </div>`;
        }).join('')}
      </div>`;

    const meetingsHtml = timedEvents.length === 0 && allDayEvents.length === 0
      ? `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:${textMuted};font-size:36px;letter-spacing:2px;text-transform:uppercase;text-align:center;padding:40px;">No meetings scheduled for today</div>`
      : timedEvents.map(e => {
          const isCurrent   = e === currentEv;
          const isCancelled = e.status === 'cancelled';
          const isTentative = e.status === 'tentative';
          const title = e.isPrivate ? 'Busy' : (e.title || 'Reserved');
          const organizer = e.organizerName || e.organizerEmail || '';
          return `<div style="display:flex;gap:28px;padding:22px 36px;align-items:baseline;border-bottom:1px solid ${border};opacity:${isCancelled?'0.45':'1'};${isCurrent?`background:${railColor}1a;`:''}">
            <div style="font-variant-numeric:tabular-nums;font-size:28px;font-weight:600;color:${text};white-space:nowrap;min-width:210px;">${escapeHtml(fmtRange(e))}</div>
            <div style="flex:1;min-width:0;">
              <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
                <span style="font-size:30px;font-weight:600;color:${text};line-height:1.25;${isCancelled?'text-decoration:line-through;':''}">${escapeHtml(title)}</span>
                ${isTentative?`<span style="background:#f59e0b;color:#fff;padding:3px 10px;border-radius:4px;font-size:15px;font-weight:700;letter-spacing:0.5px;">TENTATIVE</span>`:''}
                ${isCancelled?`<span style="background:#6b7280;color:#fff;padding:3px 10px;border-radius:4px;font-size:15px;font-weight:700;letter-spacing:0.5px;">CANCELLED</span>`:''}
              </div>
              <div style="display:flex;gap:18px;flex-wrap:wrap;margin-top:4px;">
                ${organizer&&!e.isPrivate?`<span style="font-size:19px;color:${textMuted};">${escapeHtml(organizer)}</span>`:''}
                ${showLoc&&e.location&&!e.isPrivate?`<span style="font-size:19px;color:${textMuted};">&#128205; ${escapeHtml(e.location!)}</span>`:''}
                ${showAtt&&typeof e.attendeeCount==='number'?`<span style="font-size:19px;color:${textMuted};">&#128101; ${e.attendeeCount}</span>`:''}
              </div>
            </div>
            ${isCurrent?`<div style="background:${railColor};color:#fff;padding:6px 14px;border-radius:4px;font-size:16px;text-transform:uppercase;letter-spacing:1px;align-self:center;flex-shrink:0;">Now</div>`:''}
          </div>`;
        }).join('');

    const tappable = !!bookingUrl;
    const buttons: { label: string; enabled: boolean }[] = [
      { label: 'Book',        enabled: !isBusy && tappable },
      { label: 'Accept',      enabled: !!currentEv && tappable },
      { label: 'Prolong',     enabled: !!currentEv && tappable },
      { label: 'End meeting', enabled: !!currentEv && tappable },
    ];
    const buttonsHtml = buttons.map((b, i) => `
      <button data-mr-action="${i}" ${!b.enabled?'disabled':''}
              style="display:block;width:100%;text-align:left;padding:18px 22px;margin-bottom:12px;background:${b.enabled?'rgba(255,255,255,0.18)':'rgba(255,255,255,0.06)'};color:${b.enabled?'#fff':'rgba(255,255,255,0.35)'};border:1px solid rgba(255,255,255,0.28);border-radius:8px;font-size:20px;font-weight:600;letter-spacing:0.5px;text-transform:uppercase;cursor:${b.enabled?'pointer':'not-allowed'};font-family:inherit;">
        ${escapeHtml(b.label)}
      </button>`).join('');

    const statusText = isBusy ? (isAmberEnding?'ENDING SOON':'IN USE') : (isAmberSoon?'STARTING SOON':'AVAILABLE');
    const statusLine = currentEv
      ? (isAmberEnding ? `Ends in ${fmtCountdown(msToCurrentEnd)}` : `Until ${fmtClockTime(toLocal(currentEv.end))}`)
      : nextEv
      ? (isAmberSoon ? `Starts in ${fmtCountdown(msToNextStart)}` : `Free until ${fmtClockTime(toLocal(nextEv.start))}`)
      : 'Free for the rest of the day';

    const header = `
      <div style="display:flex;align-items:center;gap:18px;padding:18px 32px;background:${isDark?'#2a2e3e':'#f1f3f5'};border-bottom:3px solid ${railColor};flex-shrink:0;">
        ${logoUrl?`<img src="${escapeHtml(logoUrl)}" alt="" style="height:64px;max-width:180px;object-fit:contain;flex-shrink:0;" />`:''}
        <div style="font-size:52px;font-weight:700;color:${text};letter-spacing:2px;text-transform:uppercase;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(roomName)}</div>
        ${roomMeta?.location?`<div style="font-size:22px;color:${textMuted};margin-left:16px;flex-shrink:0;">${escapeHtml(roomMeta.location)}</div>`:''}
      </div>`;

    const rail = `
      <div style="background:${railColor};color:#fff;display:flex;flex-direction:column;padding:28px 26px;${portrait?'flex-shrink:0;':'width:360px;flex-shrink:0;'}">
        <div id="cal-clock" style="font-size:64px;font-weight:700;letter-spacing:-1px;line-height:1;">${escapeHtml(clockStyle==='none'?'':fmtClockTime(now))}</div>
        <div style="font-size:22px;opacity:0.9;margin-top:6px;">${now.getFullYear()}.${pad2(now.getMonth()+1)}.${pad2(now.getDate())}</div>
        <div style="font-size:28px;font-weight:700;margin-top:22px;letter-spacing:1px;">${escapeHtml(statusText)}</div>
        <div style="font-size:18px;opacity:0.92;margin-top:6px;">${escapeHtml(statusLine)}</div>
        ${capacity?`<div style="margin-top:24px;"><div style="font-size:15px;letter-spacing:2px;text-transform:uppercase;opacity:0.85;margin-bottom:8px;">Room capacity</div><div style="display:inline-block;background:rgba(255,255,255,0.18);border:1px solid rgba(255,255,255,0.32);padding:10px 20px;border-radius:6px;font-size:32px;font-weight:700;">${capacity}</div></div>`:''}
        <div style="margin-top:auto;padding-top:24px;">${buttonsHtml}</div>
      </div>`;

    const body = `
      <div style="flex:1;position:relative;overflow:hidden;${backgroundUrl?`background-image:url(${JSON.stringify(backgroundUrl)});background-size:cover;background-position:center;`:''}">
        ${backgroundUrl?`<div style="position:absolute;inset:0;background:${isDark?'rgba(30,30,46,0.78)':'rgba(255,255,255,0.78)'};"></div>`:''}
        <div style="position:relative;height:100%;overflow-y:auto;">${allDayHtml}${meetingsHtml}</div>
      </div>`;

    const edgeOverlay = (isBusy||isAmberSoon)
      ? `<style>@keyframes mr-pulse{0%,100%{opacity:0.18}50%{opacity:0.72}}</style><div style="pointer-events:none;position:absolute;inset:0;z-index:999;box-shadow:inset 0 0 0 12px ${railColor};animation:mr-pulse 1.6s ease-in-out infinite;"></div>`
      : `<div style="pointer-events:none;position:absolute;inset:0;z-index:999;box-shadow:inset 0 0 0 12px ${railColor};"></div>`;

    container.innerHTML = `
      <div style="position:absolute;inset:0;display:flex;flex-direction:column;background:${bg};color:${text};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;overflow:hidden;">
        ${header}
        <div style="flex:1;display:flex;flex-direction:${portrait?'column':'row'};overflow:hidden;">${body}${rail}</div>
        ${edgeOverlay}
      </div>`;

    if (tappable) {
      const btns = container.querySelectorAll<HTMLButtonElement>('[data-mr-action]');
      btns.forEach(btn => {
        btn.addEventListener('click', () => {
          if (btn.disabled) return;
          try { window.open(bookingUrl, '_blank', 'noopener'); } catch { /**/ }
        });
      });
    }
    startClock();
  };

  const renderError = (msg: string) => {
    container.innerHTML = `
      <div style="position:absolute;inset:0;display:flex;flex-direction:column;background:${bg};color:${text};font-family:-apple-system,sans-serif;">
        ${buildHeader('')}
        <div style="flex:1;display:flex;align-items:center;justify-content:center;opacity:0.6;"><p style="font-size:20px;">${escapeHtml(msg)}</p></div>
      </div>`;
    startClock();
  };

  const renderEvents = (events: Ev[]) => {
    if (destroyed) return;
    switch (view) {
      case 'day':         renderDayView(events); break;
      case 'week':        renderWeekView(events, 7); break;
      case 'workweek':    renderWeekView(events, 5); break;
      case 'month':       renderMonthView(events); break;
      case 'meeting_room': renderMeetingRoom(events); break;
    }
  };

  const eventsSignature = (evs: Ev[]) =>
    evs.map(e => `${e.id}|${e.start}|${e.end}|${e.title}|${e.location??''}`).join('\n');

  const boundaryCrossed = (evs: Ev[], sinceMs: number) => {
    const nowMs = Date.now();
    for (const e of evs) {
      const s = new Date(e.start).getTime();
      const en = new Date(e.end).getTime();
      if ((s>sinceMs&&s<=nowMs)||(en>sinceMs&&en<=nowMs)) return true;
    }
    return false;
  };

  const maybeRender = (evs: Ev[]) => {
    if (destroyed || !container.isConnected) return;
    lastKnownEvents = evs;
    const sig = eventsSignature(evs);
    const needBoundary = view==='meeting_room' && lastBoundaryRender>0 && boundaryCrossed(evs, lastBoundaryRender);
    if (lastSig!=='' && sig===lastSig && !needBoundary) return;
    lastSig = sig;
    lastBoundaryRender = Date.now();
    renderEvents(evs);
  };

  // ── Fetch ──────────────────────────────────────────────────────────────────
  const cacheKey = `cal_events_${content.id}`;

  const fetchAndRender = async () => {
    if (destroyed) return;
    const from = new Date(); from.setHours(0,0,0,0);
    const to = new Date(from);
    const days = view==='day'||view==='meeting_room' ? 1 : view==='month' ? 31 : 7;
    to.setDate(to.getDate()+days);
    try {
      const events = await api.getCalendarEvents(deviceId, content.id, from, to);
      if (destroyed || !container.isConnected) return;
      try { localStorage.setItem(cacheKey, JSON.stringify({ events, cachedAt: Date.now() })); } catch { /**/ }
      maybeRender(events);
    } catch {
      if (destroyed || !container.isConnected) return;
      if (lastSig) return;
      try {
        const cached = localStorage.getItem(cacheKey);
        if (cached) {
          const { events } = JSON.parse(cached) as { events: Ev[] };
          maybeRender(events);
          return;
        }
      } catch { /**/ }
      renderError('No calendar data available');
    }
  };

  // First paint from cache
  let paintedFromCache = false;
  try {
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      const { events } = JSON.parse(cached) as { events: Ev[] };
      if (Array.isArray(events)) { maybeRender(events); paintedFromCache = true; }
    }
  } catch { /**/ }
  if (!paintedFromCache) {
    container.innerHTML = `<div style="position:absolute;inset:0;background:${bg};display:flex;align-items:center;justify-content:center;color:${textMuted};font-family:-apple-system,sans-serif;font-size:18px;">Loading…</div>`;
  }
  void fetchAndRender();

  // WS push
  const unregisterPush = registerPushHandler(content.id, (events) => {
    if (destroyed) return;
    lastPushAt = Date.now();
    try { localStorage.setItem(cacheKey, JSON.stringify({ events, cachedAt: Date.now() })); } catch { /**/ }
    maybeRender(events);
  });

  // Subscribe on the player WS
  const trySubscribe = () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      try { ws.send(JSON.stringify({ type: 'calendar_subscribe', payload: { contentId: content.id } })); return true; } catch { return false; }
    }
    return false;
  };
  let subscribed = trySubscribe();
  let subRetryTimer: ReturnType<typeof setInterval> | null = null;
  if (!subscribed) {
    subRetryTimer = setInterval(() => {
      if (destroyed) { if (subRetryTimer) clearInterval(subRetryTimer); return; }
      if (trySubscribe()) { subscribed=true; if (subRetryTimer) clearInterval(subRetryTimer); subRetryTimer=null; }
    }, 2000);
  }

  // Polling fallback
  const mountedAt = Date.now();
  pollTimer = setInterval(() => {
    if (destroyed) return;
    const wsOpen = !!ws && ws.readyState === WebSocket.OPEN;
    const pushStale = lastPushAt>0 ? Date.now()-lastPushAt > refreshSeconds*2*1000 : Date.now()-mountedAt > refreshSeconds*2*1000;
    const wsOk = wsOpen && subscribed && !pushStale;
    if (!wsOk) void fetchAndRender();
  }, refreshSeconds*1000);

  // Boundary timer for meeting_room
  if (view === 'meeting_room') {
    boundaryTimer = setInterval(() => {
      if (destroyed) return;
      if (!lastKnownEvents.length && !lastSig) return;
      maybeRender(lastKnownEvents);
    }, 30_000);
  }

  // Midnight rollover
  const scheduleMidnight = () => {
    if (destroyed) return;
    const now2 = new Date();
    const next = new Date(now2); next.setDate(next.getDate()+1); next.setHours(0,0,5,0);
    midnightTimer = setTimeout(() => {
      if (destroyed) return;
      lastSig = '';
      void fetchAndRender();
      scheduleMidnight();
    }, next.getTime()-now2.getTime());
  };
  scheduleMidnight();

  // ── Destroy ────────────────────────────────────────────────────────────────
  const destroy = () => {
    destroyed = true;
    if (clockTimer) { clearInterval(clockTimer); clockTimer=null; }
    if (pollTimer)  { clearInterval(pollTimer);  pollTimer=null; }
    if (boundaryTimer) { clearInterval(boundaryTimer); boundaryTimer=null; }
    if (subRetryTimer) { clearInterval(subRetryTimer); subRetryTimer=null; }
    if (midnightTimer) { clearTimeout(midnightTimer); midnightTimer=null; }
    unregisterPush();
    if (ws && ws.readyState === WebSocket.OPEN) {
      try { ws.send(JSON.stringify({ type: 'calendar_unsubscribe', payload: { contentId: content.id } })); } catch { /**/ }
    }
  };

  return { destroy };
}
