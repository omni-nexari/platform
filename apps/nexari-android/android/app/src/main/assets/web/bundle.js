var __defProp = Object.defineProperty;
var __defProps = Object.defineProperties;
var __getOwnPropDescs = Object.getOwnPropertyDescriptors;
var __getOwnPropSymbols = Object.getOwnPropertySymbols;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __propIsEnum = Object.prototype.propertyIsEnumerable;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __spreadValues = (a, b) => {
  for (var prop in b || (b = {}))
    if (__hasOwnProp.call(b, prop))
      __defNormalProp(a, prop, b[prop]);
  if (__getOwnPropSymbols)
    for (var prop of __getOwnPropSymbols(b)) {
      if (__propIsEnum.call(b, prop))
        __defNormalProp(a, prop, b[prop]);
    }
  return a;
};
var __spreadProps = (a, b) => __defProps(a, __getOwnPropDescs(b));

// src/logger.ts
var MAX_BUF = 2e3;
var ringBuffer = [];
function appendBuf(level, message) {
  if (ringBuffer.length >= MAX_BUF) ringBuffer.shift();
  ringBuffer.push({ level, message, timestamp: (/* @__PURE__ */ new Date()).toISOString() });
}
window["LogBuffer"] = {
  drain(n) {
    const take = Math.min(n, ringBuffer.length);
    return take > 0 ? ringBuffer.splice(0, take) : [];
  }
};
var _apiBase = "";
var _deviceId = "";
var _onLine = null;
var _httpQueue = [];
var _flushing = false;
function initLogger(opts) {
  var _a, _b;
  _apiBase = opts.apiBase;
  _deviceId = opts.deviceId;
  _onLine = (_a = opts.onLine) != null ? _a : null;
  setInterval(_flush, (_b = opts.flushIntervalMs) != null ? _b : 3e4);
}
function _push(level, msg) {
  const consoleFn = level === "error" ? console.error : level === "warn" ? console.warn : level === "debug" ? console.debug : console.info;
  consoleFn(`[${level.toUpperCase()}] ${msg}`);
  appendBuf(level, msg);
  if (_onLine) {
    try {
      _onLine(level, msg);
    } catch (e) {
    }
  }
  if (_apiBase && _deviceId) _httpQueue.push({ deviceId: _deviceId, level, msg, ts: Date.now() });
}
var logger = {
  debug: (msg) => _push("debug", msg),
  info: (msg) => _push("info", msg),
  warn: (msg) => _push("warn", msg),
  error: (msg) => _push("error", msg),
  /** @deprecated Use info/warn/error instead. Kept for sync engine compat. */
  drift: (msg, _driftMs) => _push("info", msg)
};
async function _flush() {
  if (_flushing || !_httpQueue.length || !_apiBase) return;
  _flushing = true;
  const batch = _httpQueue.splice(0, 50);
  try {
    await fetch(`${_apiBase}/devices/device/${encodeURIComponent(_deviceId)}/logs/ingest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entries: batch })
    });
  } catch (e) {
  } finally {
    _flushing = false;
  }
}

// src/api.ts
var Api = class {
  constructor(base, token) {
    this.base = base;
    this.token = token;
  }
  // ── Schedule / content ────────────────────────────────────────────────────
  /** Returns the schedule object for this device.  Throws on non-2xx. */
  async getCurrentContent(_deviceId2) {
    var _a, _b, _c, _d, _e;
    const t = this.token();
    const [schedRes, wsRes] = await Promise.all([
      fetch(`${this.base}/devices/device/schedule${t ? `?token=${encodeURIComponent(t)}` : ""}`),
      fetch(`${this.base}/devices/device/workspace${t ? `?token=${encodeURIComponent(t)}` : ""}`).catch(() => null)
    ]);
    if (schedRes.status === 404) return null;
    if (!schedRes.ok) throw Object.assign(new Error(`schedule HTTP ${schedRes.status}`), { status: schedRes.status });
    const wsBody = (wsRes == null ? void 0 : wsRes.ok) ? await wsRes.json().catch(() => null) : null;
    const publishedSyncGroup = wsBody == null ? void 0 : wsBody["publishedSyncGroup"];
    if (publishedSyncGroup) {
      const sg = publishedSyncGroup;
      const sp = sg["syncPlaylist"];
      const spItems = (_a = sp == null ? void 0 : sp["items"]) != null ? _a : [];
      if (spItems.length > 0) {
        const items2 = spItems.map((item) => {
          var _a2;
          const c = this.enrichContent(item["content"], t);
          if (!c) return null;
          return {
            id: item["id"],
            contentId: item["contentId"],
            duration: (_a2 = item["durationSeconds"]) != null ? _a2 : 10,
            content: c
          };
        }).filter((x) => x !== null);
        if (items2.length > 0) {
          return {
            id: sp["id"],
            playlistName: (_b = sp["name"]) != null ? _b : "Sync Playlist",
            items: items2,
            syncGroupId: sg["id"],
            allTizen: !!sg["allTizen"],
            relayUrl: (_c = sg["relayUrl"]) != null ? _c : null,
            peers: (_d = sg["peers"]) != null ? _d : []
          };
        }
      }
    }
    const body = await schedRes.json();
    if (!Array.isArray(body.schedules) || !body.schedules.length) return null;
    const raw = body.schedules[0];
    const slots = (_e = raw.slots) != null ? _e : [];
    const items = slots.flatMap((slot) => {
      var _a2;
      const playlist = slot["playlist"];
      if ((_a2 = playlist == null ? void 0 : playlist.items) == null ? void 0 : _a2.length) {
        return playlist.items.map((pi) => {
          const c2 = this.enrichContent(pi["content"], t);
          if (!c2) return null;
          return {
            id: pi["id"],
            contentId: pi["contentId"],
            duration: pi["duration"],
            content: c2
          };
        }).filter((x) => x !== null);
      }
      const c = this.enrichContent(slot["content"], t);
      if (!c) return [];
      const contentRaw = slot["content"];
      return [{
        id: slot["id"],
        contentId: slot["contentId"],
        duration: contentRaw["duration"],
        content: c
      }];
    });
    return __spreadProps(__spreadValues({}, raw), { items });
  }
  enrichContent(content, token) {
    var _a;
    if (!content) return null;
    const id = content["id"];
    const type = ((_a = content["type"]) != null ? _a : "").toLowerCase();
    let url;
    if (type === "web_url") {
      url = content["webUrl"];
    } else if (type === "html5") {
      url = token ? `${this.base}/devices/device/content/${id}/html5/${encodeURIComponent(token)}/` : void 0;
    } else {
      url = `${this.base}/devices/device/content/${id}/file${token ? `?token=${encodeURIComponent(token)}` : ""}`;
    }
    return __spreadProps(__spreadValues({}, content), { url });
  }
  /**
   * Sends a heartbeat.  The server processes heartbeats only via WebSocket
   * (type='heartbeat' message).  This method is kept as a no-op HTTP stub;
   * the Player class sends heartbeats directly over the WS connection instead.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async sendHeartbeat(_deviceId2, _payload) {
  }
  /** Uploads a base64-encoded screenshot. Best-effort (never throws). */
  async uploadScreenshot(deviceId, jpegBase64, trigger = "manual") {
    try {
      const t = this.token();
      await fetch(`${this.base}/devices/device/${encodeURIComponent(deviceId)}/screenshot`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(__spreadValues({ jpegBase64, trigger }, t ? { token: t } : {}))
      });
    } catch (e) {
    }
  }
  /** Fetches NTP server time. Returns epoch-ms or null on failure. */
  async getServerTime() {
    var _a, _b;
    try {
      const res = await fetch(`${this.base}/devices/time`);
      if (!res.ok) return null;
      const body = await res.json();
      return (_b = (_a = body.timestamp) != null ? _a : body.serverTime) != null ? _b : null;
    } catch (e) {
      return null;
    }
  }
  /** POST /devices/pair/request */
  async pairDevice(info) {
    const url = `${this.base}/devices/pair/request`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15e3);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(info),
        signal: ctrl.signal
      });
      if (!res.ok) {
        let body = "";
        try {
          body = await res.text();
        } catch (e) {
        }
        throw new Error(`pair HTTP ${res.status} ${res.statusText} \u2014 ${body.slice(0, 200)}`);
      }
      return res.json();
    } catch (e) {
      if (e.name === "AbortError") throw new Error(`pair timed out after 15s (is the API running at ${this.base}?)`);
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }
  /** GET /devices/pair/status?code=… */
  async pairStatus(code) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 1e4);
    try {
      const res = await fetch(`${this.base}/devices/pair/status?code=${encodeURIComponent(code)}`, { signal: ctrl.signal });
      if (!res.ok) return { claimed: false };
      const body = await res.json();
      return { claimed: body.status === "claimed", token: body.deviceToken };
    } catch (e) {
      return { claimed: false };
    } finally {
      clearTimeout(timer);
    }
  }
  /** GET /pos/menu?workspaceId=… */
  async getPosMenu(workspaceId) {
    try {
      const t = this.token();
      const res = await fetch(
        `${this.base}/pos/menu?workspaceId=${encodeURIComponent(workspaceId)}${t ? `&token=${encodeURIComponent(t)}` : ""}`
      );
      if (!res.ok) return null;
      return res.json();
    } catch (e) {
      return null;
    }
  }
  /** GET /devices/device/:id/content/:contentId/calendar/events */
  async getCalendarEvents(_deviceId2, contentId, from, to) {
    var _a;
    const t = this.token();
    const res = await fetch(
      `${this.base}/devices/device/content/${encodeURIComponent(contentId)}/calendar/events?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}` + (t ? `&token=${encodeURIComponent(t)}` : "")
    );
    if (!res.ok) return [];
    const body = await res.json();
    return (_a = body.events) != null ? _a : [];
  }
  // ── Logging ───────────────────────────────────────────────────────────────
  async sendLogs(deviceId, entries) {
    try {
      const t = this.token();
      await fetch(`${this.base}/devices/device/${encodeURIComponent(deviceId)}/logs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(__spreadValues({ entries }, t ? { token: t } : {}))
      });
    } catch (e) {
    }
  }
};

// src/renderers/calendar.ts
var PALETTE = ["#1a73e8", "#0f9d58", "#e67c00", "#8430ce", "#d50000", "#0097a7", "#616161", "#e91e63"];
var HOUR_PX = 64;
function escapeHtml(s) {
  return String(s != null ? s : "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function parseMetadata(content) {
  if (!content.metadata) return {};
  if (typeof content.metadata === "string") {
    try {
      return JSON.parse(content.metadata);
    } catch (e) {
      return {};
    }
  }
  return content.metadata;
}
function renderCalendar(container, content, api, deviceId, ws, registerPushHandler) {
  var _a;
  const meta = parseMetadata(content);
  const view = String(meta["view"] || "week");
  const timezone = String(meta["timezone"] || "UTC");
  const refreshSeconds = Math.max(15, Number(meta["refreshSeconds"] || 60));
  const theme = meta["theme"] || {};
  const roomMeta = meta["roomMeta"] || null;
  const accent = theme.accentColor || "#1a73e8";
  const isDark = theme.background === "dark";
  const bg = isDark ? "#1e1e2e" : "#ffffff";
  const surface = isDark ? "#2a2a3e" : "#f8f9fa";
  const border = isDark ? "#3a3a50" : "#e0e0e0";
  const text = isDark ? "#e2e8f0" : "#202124";
  const textMuted = isDark ? "#94a3b8" : "#70757a";
  const clockStyle = (_a = theme.clockStyle) != null ? _a : "digital-12";
  void surface;
  let pollTimer = null;
  let clockTimer = null;
  let midnightTimer = null;
  let boundaryTimer = null;
  let lastSig = "";
  let lastBoundaryRender = 0;
  let lastKnownEvents = [];
  let lastPushAt = 0;
  let destroyed = false;
  const reqId = `cal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const toLocal = (iso) => new Date(new Date(iso).toLocaleString("en-US", { timeZone: timezone }));
  const pad2 = (n) => (n < 10 ? "0" : "") + n;
  const getNow = () => new Date((/* @__PURE__ */ new Date()).toLocaleString("en-US", { timeZone: timezone }));
  const isoDate = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const fmtTimeFull = (d) => {
    let h = d.getHours();
    const m = d.getMinutes();
    const a = h >= 12 ? "PM" : "AM";
    h = h % 12 || 12;
    return `${h}:${pad2(m)} ${a}`;
  };
  const fmtClockTime = (d) => {
    if (clockStyle === "none") return "";
    if (clockStyle === "digital-24") return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
    let h = d.getHours();
    const m = d.getMinutes();
    const a = h >= 12 ? "PM" : "AM";
    h = h % 12 || 12;
    return `${h}:${pad2(m)} ${a}`;
  };
  const evColor = (_ev, idx) => PALETTE[idx % PALETTE.length];
  const buildHeader = (dateLabel) => {
    const now = getNow();
    const dateStr = now.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
    return `
      <header style="flex-shrink:0;display:flex;align-items:center;padding:16px 24px;background:${bg};border-bottom:1px solid ${border};gap:16px;">
        <div style="width:4px;min-height:40px;background:${accent};border-radius:2px;flex-shrink:0;"></div>
        <div style="flex:1;min-width:0;">
          <div style="font-size:13px;color:${textMuted};font-weight:500;text-transform:uppercase;letter-spacing:0.5px;">${escapeHtml(content.name || "Calendar")}</div>
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
      const el = container.querySelector("#cal-clock");
      if (el) el.textContent = fmtClockTime(getNow());
      const now = getNow();
      const minOfDay = now.getHours() * 60 + now.getMinutes();
      const pct = minOfDay / (24 * 60) * 100;
      const line = container.querySelector("#cal-now-line");
      if (line) line.style.top = `${pct}%`;
      const dot = container.querySelector("#cal-now-dot");
      if (dot) dot.style.top = `calc(${pct}% - 5px)`;
    }, 3e4);
  };
  const buildTimeGutter = () => {
    let rows = "";
    for (let h = 0; h < 24; h++) {
      const label = h === 0 ? "" : h < 12 ? `${h} AM` : h === 12 ? "12 PM" : `${h - 12} PM`;
      rows += `<div style="height:${HOUR_PX}px;box-sizing:border-box;padding-right:8px;text-align:right;font-size:11px;color:${textMuted};position:relative;top:-7px;">${escapeHtml(label)}</div>`;
    }
    return `<div style="width:52px;flex-shrink:0;border-right:1px solid ${border};overflow:hidden;">${rows}</div>`;
  };
  const buildHourLines = () => {
    let lines = "";
    for (let h = 0; h < 24; h++) {
      lines += `<div style="position:absolute;left:0;right:0;top:${h * HOUR_PX}px;border-top:1px solid ${border};pointer-events:none;"></div>`;
    }
    return lines;
  };
  const buildNowIndicator = (now) => {
    const pct = (now.getHours() * 60 + now.getMinutes()) / (24 * 60) * 100;
    return `<div id="cal-now-dot" style="position:absolute;left:-5px;width:10px;height:10px;border-radius:50%;background:${accent};z-index:10;top:calc(${pct}% - 5px);"></div>
            <div id="cal-now-line" style="position:absolute;left:0;right:0;top:${pct}%;border-top:2px solid ${accent};z-index:9;"></div>`;
  };
  const buildDayEvents = (dayEvs) => dayEvs.filter((e) => !e.allDay).map((ev, i) => {
    const s = toLocal(ev.start);
    const e2 = toLocal(ev.end);
    const startMin = s.getHours() * 60 + s.getMinutes();
    const endMin = Math.min(e2.getHours() * 60 + e2.getMinutes(), 24 * 60);
    const durMin = Math.max(endMin - startMin, 30);
    const top = startMin / 60 * HOUR_PX;
    const height = Math.max(durMin / 60 * HOUR_PX, 22);
    const color = evColor(ev, i);
    const showLoc = height > 44 && ev.location;
    return `<div style="position:absolute;left:2px;right:4px;top:${top}px;height:${height}px;background:${color};border-radius:4px;padding:3px 6px;box-sizing:border-box;overflow:hidden;z-index:5;">
        <div style="font-size:12px;font-weight:600;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(ev.title || "(no title)")}</div>
        <div style="font-size:11px;color:rgba(255,255,255,0.85);white-space:nowrap;overflow:hidden;">${fmtTimeFull(s)} \u2013 ${fmtTimeFull(e2)}</div>
        ${showLoc ? `<div style="font-size:10px;color:rgba(255,255,255,0.75);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(ev.location)}</div>` : ""}
      </div>`;
  }).join("");
  const buildAllDayStrip = (allDayEvs, cols) => {
    if (!allDayEvs.length) return "";
    const colW = 100 / cols.length;
    const chips = allDayEvs.map((ev, i) => {
      const s = toLocal(ev.start);
      const colIdx = cols.findIndex((d) => isoDate(d) === isoDate(s));
      if (colIdx < 0) return "";
      return `<div style="position:absolute;left:calc(${colIdx * colW}% + 2px);width:calc(${colW}% - 4px);top:${i * 22}px;height:20px;background:${evColor(ev, i)};border-radius:3px;padding:2px 6px;font-size:11px;color:#fff;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(ev.title || "(all day)")}</div>`;
    }).join("");
    const height = allDayEvs.length * 22 + 4;
    return `<div style="display:flex;flex-shrink:0;border-bottom:1px solid ${border};">
      <div style="width:52px;flex-shrink:0;font-size:11px;color:${textMuted};padding:4px 8px 4px 0;text-align:right;border-right:1px solid ${border};">all-day</div>
      <div style="flex:1;position:relative;height:${height}px;">${chips}</div>
    </div>`;
  };
  const renderDayView = (events) => {
    const now = getNow();
    const today = isoDate(now);
    const timedEvs = events.filter((e) => isoDate(toLocal(e.start)) === today && !e.allDay);
    const allDayEvs = events.filter((e) => isoDate(toLocal(e.start)) === today && e.allDay);
    const dateLabel = now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
    const scrollTop = Math.max(0, (now.getHours() - 1) * HOUR_PX);
    container.innerHTML = `
      <div style="position:absolute;inset:0;display:flex;flex-direction:column;background:${bg};color:${text};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;overflow:hidden;">
        ${buildHeader(dateLabel)}
        ${buildAllDayStrip(allDayEvs, [now])}
        <div style="flex:1;display:flex;overflow:hidden;">
          ${buildTimeGutter()}
          <div id="cal-scroll" style="flex:1;overflow-y:auto;position:relative;">
            <div style="position:relative;height:${24 * HOUR_PX}px;">${buildHourLines()}${buildNowIndicator(now)}${buildDayEvents(timedEvs)}</div>
          </div>
        </div>
      </div>`;
    const scroll = container.querySelector("#cal-scroll");
    if (scroll) scroll.scrollTop = scrollTop;
    startClock();
  };
  const renderWeekView = (events, numDays) => {
    const now = getNow();
    const dow = now.getDay();
    const offset = numDays === 5 ? dow === 0 ? -6 : 1 - dow : -dow;
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() + offset);
    startOfWeek.setHours(0, 0, 0, 0);
    const days = Array.from({ length: numDays }, (_, i) => {
      const d = new Date(startOfWeek);
      d.setDate(d.getDate() + i);
      return d;
    });
    const rangeLabel = `${days[0].toLocaleDateString("en-US", { month: "short", day: "numeric" })} \u2013 ${days[numDays - 1].toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
    const colW = 100 / numDays;
    const allDayEvs = events.filter((e) => e.allDay);
    const timedEvs = events.filter((e) => !e.allDay);
    const todayIso = isoDate(now);
    const dayHeaders = days.map((d) => {
      const isToday = isoDate(d) === todayIso;
      return `<div style="flex:1;text-align:center;padding:6px 4px;border-right:1px solid ${border};">
        <div style="font-size:11px;font-weight:500;color:${textMuted};text-transform:uppercase;">${d.toLocaleDateString("en-US", { weekday: "short" })}</div>
        <div style="width:30px;height:30px;margin:4px auto 0;border-radius:50%;display:flex;align-items:center;justify-content:center;background:${isToday ? accent : "transparent"};color:${isToday ? "#fff" : text};font-size:16px;font-weight:${isToday ? 700 : 400};">${d.getDate()}</div>
      </div>`;
    }).join("");
    const dayEventCols = days.map((d) => {
      const key = isoDate(d);
      const evs = timedEvs.filter((e) => isoDate(toLocal(e.start)) === key);
      return `<div style="position:absolute;left:${days.indexOf(d) * colW}%;width:${colW}%;top:0;bottom:0;">${buildDayEvents(evs)}</div>`;
    }).join("");
    const dividers = days.slice(1).map(
      (_, i) => `<div style="position:absolute;left:${(i + 1) * colW}%;top:0;bottom:0;border-left:1px solid ${border};pointer-events:none;"></div>`
    ).join("");
    const scrollTop = Math.max(0, (now.getHours() - 1) * HOUR_PX);
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
            <div style="position:relative;height:${24 * HOUR_PX}px;">${buildHourLines()}${days.some((d) => isoDate(d) === todayIso) ? buildNowIndicator(now) : ""}${dayEventCols}${dividers}</div>
          </div>
        </div>
      </div>`;
    const scroll = container.querySelector("#cal-scroll");
    if (scroll) scroll.scrollTop = scrollTop;
    startClock();
  };
  const renderMonthView = (events) => {
    const now = getNow();
    const monthLabel = now.toLocaleDateString("en-US", { month: "long", year: "numeric" });
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
    const totalDays = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const cells = [...Array(firstDay.getDay()).fill(null), ...Array.from({ length: totalDays }, (_, i) => new Date(now.getFullYear(), now.getMonth(), i + 1))];
    while (cells.length % 7 !== 0) cells.push(null);
    const weeks = [];
    for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
    const todayIso = isoDate(now);
    const numWeeks = weeks.length;
    const DAY_HEADERS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const headerRow = `<div style="display:flex;flex-shrink:0;border-bottom:2px solid ${border};">${DAY_HEADERS.map((d) => `<div style="flex:1;text-align:center;font-size:11px;font-weight:600;color:${textMuted};padding:8px 0;text-transform:uppercase;">${d}</div>`).join("")}</div>`;
    const weekRows = weeks.map(
      (week) => `<div style="display:flex;flex:1;min-height:0;">${week.map((day) => {
        if (!day) return `<div style="flex:1;border:1px solid ${border};background:${isDark ? "#1a1a28" : "#f8f9fa"};"></div>`;
        const dayIso = isoDate(day);
        const isToday = dayIso === todayIso;
        const dayEvs = events.filter((e) => isoDate(toLocal(e.start)) === dayIso).slice(0, 3);
        const chips = dayEvs.map((ev, i) => `<div style="margin:1px 4px;padding:1px 5px;border-radius:3px;font-size:11px;background:${evColor(ev, i)};color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${ev.allDay ? "" : fmtTimeFull(toLocal(ev.start)) + " "}${escapeHtml(ev.title || "(no title)")}</div>`).join("");
        return `<div style="flex:1;border:1px solid ${border};padding:4px 0;box-sizing:border-box;overflow:hidden;background:${isToday ? isDark ? "rgba(26,115,232,0.12)" : "rgba(26,115,232,0.06)" : bg};">
          <div style="text-align:center;margin-bottom:2px;"><span style="display:inline-block;width:24px;height:24px;line-height:24px;border-radius:50%;text-align:center;font-size:13px;background:${isToday ? accent : "transparent"};color:${isToday ? "#fff" : text};font-weight:${isToday ? 700 : 400};">${day.getDate()}</span></div>
          ${chips}
        </div>`;
      }).join("")}</div>`
    ).join("");
    container.innerHTML = `
      <div style="position:absolute;inset:0;display:flex;flex-direction:column;background:${bg};color:${text};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;overflow:hidden;">
        ${buildHeader(monthLabel)}
        <div style="flex:1;display:flex;flex-direction:column;overflow:hidden;">${headerRow}${weekRows}</div>
      </div>`;
    void numWeeks;
    startClock();
  };
  const renderMeetingRoom = (events) => {
    var _a2;
    const now = getNow();
    const startOfDay = /* @__PURE__ */ new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(startOfDay);
    endOfDay.setDate(endOfDay.getDate() + 1);
    const today = events.filter((e) => new Date(e.end).getTime() > startOfDay.getTime() && new Date(e.start).getTime() < endOfDay.getTime()).sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
    const currentEv = today.find((e) => new Date(e.start).getTime() <= Date.now() && new Date(e.end).getTime() > Date.now());
    const nextEv = today.find((e) => new Date(e.start).getTime() > Date.now());
    const isBusy = !!currentEv;
    const msToCurrentEnd = currentEv ? new Date(currentEv.end).getTime() - Date.now() : Infinity;
    const msToNextStart = nextEv ? new Date(nextEv.start).getTime() - Date.now() : Infinity;
    const isAmberEnding = isBusy && msToCurrentEnd < 15 * 60 * 1e3;
    const isAmberSoon = !isBusy && isFinite(msToNextStart) && msToNextStart < 15 * 60 * 1e3;
    const railColor = isBusy && !isAmberEnding ? "#d93025" : isBusy && isAmberEnding || isAmberSoon ? "#f59e0b" : "#34a853";
    const portrait = window.innerHeight > window.innerWidth;
    const roomName = (roomMeta == null ? void 0 : roomMeta.name) || content.name || "Meeting Room";
    const capacity = (_a2 = roomMeta == null ? void 0 : roomMeta.capacity) != null ? _a2 : null;
    const bookingUrl = (roomMeta == null ? void 0 : roomMeta.bookingUrl) || "";
    const logoUrl = (roomMeta == null ? void 0 : roomMeta.logoUrl) || "";
    const backgroundUrl = (roomMeta == null ? void 0 : roomMeta.backgroundUrl) || "";
    const showLoc = theme.showLocation !== false;
    const showAtt = !!theme.showAttendeeCount;
    const fmtRange = (e) => `${fmtClockTime(toLocal(e.start))} \u2013 ${fmtClockTime(toLocal(e.end))}`;
    const fmtCountdown = (ms) => {
      const m = Math.ceil(ms / 6e4);
      return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${pad2(m % 60)}m`;
    };
    const allDayEvents = today.filter((e) => e.allDay);
    const timedEvents = today.filter((e) => !e.allDay);
    const allDayHtml = allDayEvents.length === 0 ? "" : `
      <div style="display:flex;flex-wrap:wrap;gap:8px;padding:12px 36px;border-bottom:1px solid ${border};background:${isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)"}">
        ${allDayEvents.map((e) => {
      const isCancelled = e.status === "cancelled";
      const isTentative = e.status === "tentative";
      const title = e.isPrivate ? "Busy" : e.title || "Reserved";
      return `<div style="display:inline-flex;align-items:center;gap:6px;padding:4px 14px;border-radius:20px;background:${accent}22;border:1px solid ${accent}44;font-size:18px;color:${isCancelled ? textMuted : text};${isCancelled ? "text-decoration:line-through;opacity:0.55;" : ""}">
            <span>&#9656;</span><span>${escapeHtml(title)}</span>
            ${isTentative ? `<span style="font-size:14px;background:#f59e0b;color:#fff;padding:1px 6px;border-radius:3px;">?</span>` : ""}
          </div>`;
    }).join("")}
      </div>`;
    const meetingsHtml = timedEvents.length === 0 && allDayEvents.length === 0 ? `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:${textMuted};font-size:36px;letter-spacing:2px;text-transform:uppercase;text-align:center;padding:40px;">No meetings scheduled for today</div>` : timedEvents.map((e) => {
      const isCurrent = e === currentEv;
      const isCancelled = e.status === "cancelled";
      const isTentative = e.status === "tentative";
      const title = e.isPrivate ? "Busy" : e.title || "Reserved";
      const organizer = e.organizerName || e.organizerEmail || "";
      return `<div style="display:flex;gap:28px;padding:22px 36px;align-items:baseline;border-bottom:1px solid ${border};opacity:${isCancelled ? "0.45" : "1"};${isCurrent ? `background:${railColor}1a;` : ""}">
            <div style="font-variant-numeric:tabular-nums;font-size:28px;font-weight:600;color:${text};white-space:nowrap;min-width:210px;">${escapeHtml(fmtRange(e))}</div>
            <div style="flex:1;min-width:0;">
              <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
                <span style="font-size:30px;font-weight:600;color:${text};line-height:1.25;${isCancelled ? "text-decoration:line-through;" : ""}">${escapeHtml(title)}</span>
                ${isTentative ? `<span style="background:#f59e0b;color:#fff;padding:3px 10px;border-radius:4px;font-size:15px;font-weight:700;letter-spacing:0.5px;">TENTATIVE</span>` : ""}
                ${isCancelled ? `<span style="background:#6b7280;color:#fff;padding:3px 10px;border-radius:4px;font-size:15px;font-weight:700;letter-spacing:0.5px;">CANCELLED</span>` : ""}
              </div>
              <div style="display:flex;gap:18px;flex-wrap:wrap;margin-top:4px;">
                ${organizer && !e.isPrivate ? `<span style="font-size:19px;color:${textMuted};">${escapeHtml(organizer)}</span>` : ""}
                ${showLoc && e.location && !e.isPrivate ? `<span style="font-size:19px;color:${textMuted};">&#128205; ${escapeHtml(e.location)}</span>` : ""}
                ${showAtt && typeof e.attendeeCount === "number" ? `<span style="font-size:19px;color:${textMuted};">&#128101; ${e.attendeeCount}</span>` : ""}
              </div>
            </div>
            ${isCurrent ? `<div style="background:${railColor};color:#fff;padding:6px 14px;border-radius:4px;font-size:16px;text-transform:uppercase;letter-spacing:1px;align-self:center;flex-shrink:0;">Now</div>` : ""}
          </div>`;
    }).join("");
    const tappable = !!bookingUrl;
    const buttons = [
      { label: "Book", enabled: !isBusy && tappable },
      { label: "Accept", enabled: !!currentEv && tappable },
      { label: "Prolong", enabled: !!currentEv && tappable },
      { label: "End meeting", enabled: !!currentEv && tappable }
    ];
    const buttonsHtml = buttons.map((b, i) => `
      <button data-mr-action="${i}" ${!b.enabled ? "disabled" : ""}
              style="display:block;width:100%;text-align:left;padding:18px 22px;margin-bottom:12px;background:${b.enabled ? "rgba(255,255,255,0.18)" : "rgba(255,255,255,0.06)"};color:${b.enabled ? "#fff" : "rgba(255,255,255,0.35)"};border:1px solid rgba(255,255,255,0.28);border-radius:8px;font-size:20px;font-weight:600;letter-spacing:0.5px;text-transform:uppercase;cursor:${b.enabled ? "pointer" : "not-allowed"};font-family:inherit;">
        ${escapeHtml(b.label)}
      </button>`).join("");
    const statusText = isBusy ? isAmberEnding ? "ENDING SOON" : "IN USE" : isAmberSoon ? "STARTING SOON" : "AVAILABLE";
    const statusLine = currentEv ? isAmberEnding ? `Ends in ${fmtCountdown(msToCurrentEnd)}` : `Until ${fmtClockTime(toLocal(currentEv.end))}` : nextEv ? isAmberSoon ? `Starts in ${fmtCountdown(msToNextStart)}` : `Free until ${fmtClockTime(toLocal(nextEv.start))}` : "Free for the rest of the day";
    const header = `
      <div style="display:flex;align-items:center;gap:18px;padding:18px 32px;background:${isDark ? "#2a2e3e" : "#f1f3f5"};border-bottom:3px solid ${railColor};flex-shrink:0;">
        ${logoUrl ? `<img src="${escapeHtml(logoUrl)}" alt="" style="height:64px;max-width:180px;object-fit:contain;flex-shrink:0;" />` : ""}
        <div style="font-size:52px;font-weight:700;color:${text};letter-spacing:2px;text-transform:uppercase;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(roomName)}</div>
        ${(roomMeta == null ? void 0 : roomMeta.location) ? `<div style="font-size:22px;color:${textMuted};margin-left:16px;flex-shrink:0;">${escapeHtml(roomMeta.location)}</div>` : ""}
      </div>`;
    const rail = `
      <div style="background:${railColor};color:#fff;display:flex;flex-direction:column;padding:28px 26px;${portrait ? "flex-shrink:0;" : "width:360px;flex-shrink:0;"}">
        <div id="cal-clock" style="font-size:64px;font-weight:700;letter-spacing:-1px;line-height:1;">${escapeHtml(clockStyle === "none" ? "" : fmtClockTime(now))}</div>
        <div style="font-size:22px;opacity:0.9;margin-top:6px;">${now.getFullYear()}.${pad2(now.getMonth() + 1)}.${pad2(now.getDate())}</div>
        <div style="font-size:28px;font-weight:700;margin-top:22px;letter-spacing:1px;">${escapeHtml(statusText)}</div>
        <div style="font-size:18px;opacity:0.92;margin-top:6px;">${escapeHtml(statusLine)}</div>
        ${capacity ? `<div style="margin-top:24px;"><div style="font-size:15px;letter-spacing:2px;text-transform:uppercase;opacity:0.85;margin-bottom:8px;">Room capacity</div><div style="display:inline-block;background:rgba(255,255,255,0.18);border:1px solid rgba(255,255,255,0.32);padding:10px 20px;border-radius:6px;font-size:32px;font-weight:700;">${capacity}</div></div>` : ""}
        <div style="margin-top:auto;padding-top:24px;">${buttonsHtml}</div>
      </div>`;
    const body = `
      <div style="flex:1;position:relative;overflow:hidden;${backgroundUrl ? `background-image:url(${JSON.stringify(backgroundUrl)});background-size:cover;background-position:center;` : ""}">
        ${backgroundUrl ? `<div style="position:absolute;inset:0;background:${isDark ? "rgba(30,30,46,0.78)" : "rgba(255,255,255,0.78)"};"></div>` : ""}
        <div style="position:relative;height:100%;overflow-y:auto;">${allDayHtml}${meetingsHtml}</div>
      </div>`;
    const edgeOverlay = isBusy || isAmberSoon ? `<style>@keyframes mr-pulse{0%,100%{opacity:0.18}50%{opacity:0.72}}</style><div style="pointer-events:none;position:absolute;inset:0;z-index:999;box-shadow:inset 0 0 0 12px ${railColor};animation:mr-pulse 1.6s ease-in-out infinite;"></div>` : `<div style="pointer-events:none;position:absolute;inset:0;z-index:999;box-shadow:inset 0 0 0 12px ${railColor};"></div>`;
    container.innerHTML = `
      <div style="position:absolute;inset:0;display:flex;flex-direction:column;background:${bg};color:${text};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;overflow:hidden;">
        ${header}
        <div style="flex:1;display:flex;flex-direction:${portrait ? "column" : "row"};overflow:hidden;">${body}${rail}</div>
        ${edgeOverlay}
      </div>`;
    if (tappable) {
      const btns = container.querySelectorAll("[data-mr-action]");
      btns.forEach((btn) => {
        btn.addEventListener("click", () => {
          if (btn.disabled) return;
          try {
            window.open(bookingUrl, "_blank", "noopener");
          } catch (e) {
          }
        });
      });
    }
    startClock();
  };
  const renderError = (msg) => {
    container.innerHTML = `
      <div style="position:absolute;inset:0;display:flex;flex-direction:column;background:${bg};color:${text};font-family:-apple-system,sans-serif;">
        ${buildHeader("")}
        <div style="flex:1;display:flex;align-items:center;justify-content:center;opacity:0.6;"><p style="font-size:20px;">${escapeHtml(msg)}</p></div>
      </div>`;
    startClock();
  };
  const renderEvents = (events) => {
    if (destroyed) return;
    switch (view) {
      case "day":
        renderDayView(events);
        break;
      case "week":
        renderWeekView(events, 7);
        break;
      case "workweek":
        renderWeekView(events, 5);
        break;
      case "month":
        renderMonthView(events);
        break;
      case "meeting_room":
        renderMeetingRoom(events);
        break;
    }
  };
  const eventsSignature = (evs) => evs.map((e) => {
    var _a2;
    return `${e.id}|${e.start}|${e.end}|${e.title}|${(_a2 = e.location) != null ? _a2 : ""}`;
  }).join("\n");
  const boundaryCrossed = (evs, sinceMs) => {
    const nowMs = Date.now();
    for (const e of evs) {
      const s = new Date(e.start).getTime();
      const en = new Date(e.end).getTime();
      if (s > sinceMs && s <= nowMs || en > sinceMs && en <= nowMs) return true;
    }
    return false;
  };
  const maybeRender = (evs) => {
    if (destroyed || !container.isConnected) return;
    lastKnownEvents = evs;
    const sig = eventsSignature(evs);
    const needBoundary = view === "meeting_room" && lastBoundaryRender > 0 && boundaryCrossed(evs, lastBoundaryRender);
    if (lastSig !== "" && sig === lastSig && !needBoundary) return;
    lastSig = sig;
    lastBoundaryRender = Date.now();
    renderEvents(evs);
  };
  const cacheKey = `cal_events_${content.id}`;
  const fetchAndRender = async () => {
    if (destroyed) return;
    const from = /* @__PURE__ */ new Date();
    from.setHours(0, 0, 0, 0);
    const to = new Date(from);
    const days = view === "day" || view === "meeting_room" ? 1 : view === "month" ? 31 : 7;
    to.setDate(to.getDate() + days);
    try {
      const events = await api.getCalendarEvents(deviceId, content.id, from, to);
      if (destroyed || !container.isConnected) return;
      try {
        localStorage.setItem(cacheKey, JSON.stringify({ events, cachedAt: Date.now() }));
      } catch (e) {
      }
      maybeRender(events);
    } catch (e) {
      if (destroyed || !container.isConnected) return;
      if (lastSig) return;
      try {
        const cached = localStorage.getItem(cacheKey);
        if (cached) {
          const { events } = JSON.parse(cached);
          maybeRender(events);
          return;
        }
      } catch (e2) {
      }
      renderError("No calendar data available");
    }
  };
  let paintedFromCache = false;
  try {
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      const { events } = JSON.parse(cached);
      if (Array.isArray(events)) {
        maybeRender(events);
        paintedFromCache = true;
      }
    }
  } catch (e) {
  }
  if (!paintedFromCache) {
    container.innerHTML = `<div style="position:absolute;inset:0;background:${bg};display:flex;align-items:center;justify-content:center;color:${textMuted};font-family:-apple-system,sans-serif;font-size:18px;">Loading\u2026</div>`;
  }
  void fetchAndRender();
  const unregisterPush = registerPushHandler(content.id, (events) => {
    if (destroyed) return;
    lastPushAt = Date.now();
    try {
      localStorage.setItem(cacheKey, JSON.stringify({ events, cachedAt: Date.now() }));
    } catch (e) {
    }
    maybeRender(events);
  });
  const trySubscribe = () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ type: "calendar_subscribe", payload: { contentId: content.id } }));
        return true;
      } catch (e) {
        return false;
      }
    }
    return false;
  };
  let subscribed = trySubscribe();
  let subRetryTimer = null;
  if (!subscribed) {
    subRetryTimer = setInterval(() => {
      if (destroyed) {
        if (subRetryTimer) clearInterval(subRetryTimer);
        return;
      }
      if (trySubscribe()) {
        subscribed = true;
        if (subRetryTimer) clearInterval(subRetryTimer);
        subRetryTimer = null;
      }
    }, 2e3);
  }
  const mountedAt = Date.now();
  pollTimer = setInterval(() => {
    if (destroyed) return;
    const wsOpen = !!ws && ws.readyState === WebSocket.OPEN;
    const pushStale = lastPushAt > 0 ? Date.now() - lastPushAt > refreshSeconds * 2 * 1e3 : Date.now() - mountedAt > refreshSeconds * 2 * 1e3;
    const wsOk = wsOpen && subscribed && !pushStale;
    if (!wsOk) void fetchAndRender();
  }, refreshSeconds * 1e3);
  if (view === "meeting_room") {
    boundaryTimer = setInterval(() => {
      if (destroyed) return;
      if (!lastKnownEvents.length && !lastSig) return;
      maybeRender(lastKnownEvents);
    }, 3e4);
  }
  const scheduleMidnight = () => {
    if (destroyed) return;
    const now2 = /* @__PURE__ */ new Date();
    const next = new Date(now2);
    next.setDate(next.getDate() + 1);
    next.setHours(0, 0, 5, 0);
    midnightTimer = setTimeout(() => {
      if (destroyed) return;
      lastSig = "";
      void fetchAndRender();
      scheduleMidnight();
    }, next.getTime() - now2.getTime());
  };
  scheduleMidnight();
  const destroy = () => {
    destroyed = true;
    if (clockTimer) {
      clearInterval(clockTimer);
      clockTimer = null;
    }
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    if (boundaryTimer) {
      clearInterval(boundaryTimer);
      boundaryTimer = null;
    }
    if (subRetryTimer) {
      clearInterval(subRetryTimer);
      subRetryTimer = null;
    }
    if (midnightTimer) {
      clearTimeout(midnightTimer);
      midnightTimer = null;
    }
    unregisterPush();
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ type: "calendar_unsubscribe", payload: { contentId: content.id } }));
      } catch (e) {
      }
    }
  };
  return { destroy };
}

// src/renderers/menu-board.ts
function escapeHtml2(s) {
  return String(s != null ? s : "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function parseMetadata2(content) {
  if (!content.metadata) return {};
  if (typeof content.metadata === "string") {
    try {
      return JSON.parse(content.metadata);
    } catch (e) {
      return {};
    }
  }
  return content.metadata;
}
function sanitizeColor(value, fallback) {
  if (typeof value !== "string" || !value.trim()) return fallback;
  const t = value.trim();
  if (/^#[0-9a-fA-F]{3,8}$/.test(t) || /^rgba?\([^)]*\)$/.test(t) || /^hsla?\([^)]*\)$/.test(t)) return t;
  return fallback;
}
function formatPrice(cents, currency) {
  const norm = typeof currency === "string" && currency ? currency : "USD";
  const amount = Math.max(Number(cents) || 0, 0) / 100;
  const fd = norm === "JPY" ? 0 : 2;
  try {
    return new Intl.NumberFormat(void 0, { style: "currency", currency: norm, minimumFractionDigits: fd, maximumFractionDigits: fd }).format(amount);
  } catch (e) {
    return `${norm} ${amount.toFixed(fd)}`;
  }
}
function buildStateHtml(title, message) {
  return `<div style="display:flex;align-items:center;justify-content:center;height:100%;padding:32px;background:linear-gradient(160deg,#1f1510 0%,#120d0a 100%);color:#f7f2eb;font-family:'Segoe UI',Arial,sans-serif;text-align:center;box-sizing:border-box;"><div style="max-width:720px;"><div style="font-size:30px;font-weight:700;">${escapeHtml2(title)}</div><div style="margin-top:12px;font-size:16px;line-height:1.6;color:rgba(247,242,235,0.78);">${escapeHtml2(message)}</div></div></div>`;
}
function getSections(menu, metadata) {
  const ids = Array.isArray(metadata["categoryIds"]) ? metadata["categoryIds"].filter((v) => typeof v === "string") : [];
  const cats = Array.isArray(menu.categories) ? menu.categories : [];
  const filtered = ids.length > 0 ? cats.filter((c) => ids.includes(c.id)) : cats;
  return filtered.map((c) => __spreadProps(__spreadValues({}, c), { items: Array.isArray(c.items) ? c.items.filter(Boolean) : [] })).filter((c) => c.items.length > 0);
}
function buildMenuBoardHtml(content, menu, metadata) {
  var _a;
  const layout = metadata["layout"] === "1-col" || metadata["layout"] === "featured" ? String(metadata["layout"]) : "2-col";
  const showPrices = metadata["showPrices"] !== false;
  const showImages = metadata["showImages"] !== false;
  const showDesc = metadata["showDescription"] === true;
  const fontScaleRaw = Number(metadata["fontScale"]);
  const fontScale = isFinite(fontScaleRaw) ? Math.min(Math.max(fontScaleRaw, 0.8), 1.4) : 1;
  const accentColor = sanitizeColor(metadata["accentColor"], "#dd6b20");
  const currency = typeof menu.currency === "string" ? menu.currency : "USD";
  const sections = getSections(menu, metadata);
  if (!sections.length) {
    return buildStateHtml(content.name || "Menu Board", "No active POS menu items available for this board right now.");
  }
  let featuredItem = null;
  if (layout === "featured") {
    for (const cat of sections) {
      featuredItem = showImages && cat.items.find((i) => !!i.imageUrl) || cat.items[0] || null;
      if (featuredItem) break;
    }
  }
  const boardTitle = content.name || ((_a = menu.name) != null ? _a : "Menu Board");
  const subtitleParts = [];
  if (menu.name && menu.name !== boardTitle) subtitleParts.push(menu.name);
  if (menu.description) subtitleParts.push(menu.description);
  subtitleParts.push(`${sections.length} ${sections.length === 1 ? "category" : "categories"}`);
  const subtitle = subtitleParts.join(" | ");
  const sectionCols = layout === "1-col" ? 1 : Math.min(2, sections.length || 1);
  const featuredMarkup = layout === "featured" && featuredItem ? `
    <aside class="menu-board-feature">
      ${showImages && featuredItem.imageUrl ? `<div class="menu-board-feature-image"><img src="${escapeHtml2(featuredItem.imageUrl)}" alt="${escapeHtml2(featuredItem.name)}" /></div>` : ""}
      <div class="menu-board-feature-copy">
        <div class="menu-board-feature-kicker">Featured Item</div>
        <div class="menu-board-feature-title">${escapeHtml2(featuredItem.name)}</div>
        ${showPrices ? `<div class="menu-board-feature-price">${escapeHtml2(formatPrice(featuredItem.priceCents, currency))}</div>` : ""}
        ${showDesc && featuredItem.description ? `<div class="menu-board-feature-description">${escapeHtml2(featuredItem.description)}</div>` : ""}
      </div>
    </aside>` : "";
  const sectionsMarkup = sections.map((cat) => {
    const catAccent = sanitizeColor(cat.color, accentColor);
    const items = cat.items.map((item) => {
      const img = showImages && item.imageUrl ? `<div class="menu-board-item-image"><img src="${escapeHtml2(item.imageUrl)}" alt="${escapeHtml2(item.name)}" /></div>` : "";
      const price = showPrices ? `<div class="menu-board-item-price">${escapeHtml2(formatPrice(item.priceCents, currency))}</div>` : "";
      const desc = showDesc && item.description ? `<div class="menu-board-item-description">${escapeHtml2(item.description)}</div>` : "";
      return `<article class="menu-board-item ${img ? "has-image" : "no-image"}">${img}<div class="menu-board-item-copy"><div class="menu-board-item-head"><div class="menu-board-item-name">${escapeHtml2(item.name)}</div>${price}</div>${desc}</div></article>`;
    }).join("");
    return `<section class="menu-board-category" style="--menu-board-category-accent:${catAccent};">
      <div class="menu-board-category-head">
        <div>
          <div class="menu-board-category-title">${escapeHtml2(cat.name)}</div>
          ${cat.description ? `<div class="menu-board-category-description">${escapeHtml2(cat.description)}</div>` : ""}
        </div>
        <div class="menu-board-category-count">${cat.items.length}</div>
      </div>
      <div class="menu-board-item-list">${items}</div>
    </section>`;
  }).join("");
  return `
    <div class="menu-board-root">
      <style>
        .menu-board-root,.menu-board-root *{box-sizing:border-box;}
        .menu-board-root{--menu-board-accent:${accentColor};--menu-board-scale:${fontScale};width:100%;height:100%;color:#f7f2eb;font-family:'Segoe UI',Arial,sans-serif;background:linear-gradient(160deg,#231812 0%,#120d0a 62%,#241913 100%);}
        .menu-board-shell{width:100%;height:100%;display:flex;flex-direction:column;gap:calc(18px*var(--menu-board-scale));padding:calc(28px*var(--menu-board-scale));overflow:hidden;}
        .menu-board-header{display:flex;align-items:flex-end;justify-content:space-between;gap:18px;}
        .menu-board-eyebrow{font-size:calc(12px*var(--menu-board-scale));font-weight:700;letter-spacing:0.16em;text-transform:uppercase;color:var(--menu-board-accent);}
        .menu-board-title{margin:6px 0 0;font-size:calc(34px*var(--menu-board-scale));line-height:1.05;letter-spacing:-0.03em;}
        .menu-board-subtitle{margin-top:8px;font-size:calc(14px*var(--menu-board-scale));line-height:1.5;color:rgba(247,242,235,0.7);}
        .menu-board-grid{flex:1;min-height:0;display:grid;grid-template-columns:1fr;gap:calc(18px*var(--menu-board-scale));}
        .menu-board-grid.is-featured{grid-template-columns:minmax(320px,0.95fr) minmax(0,1.75fr);}
        .menu-board-feature{min-height:0;border:1px solid rgba(255,255,255,0.1);border-radius:26px;overflow:hidden;background:linear-gradient(180deg,rgba(255,255,255,0.08) 0%,rgba(255,255,255,0.03) 100%);display:flex;flex-direction:column;}
        .menu-board-feature-image{height:48%;min-height:210px;background:rgba(255,255,255,0.04);}
        .menu-board-feature-image img{width:100%;height:100%;display:block;object-fit:cover;}
        .menu-board-feature-copy{padding:calc(22px*var(--menu-board-scale));display:flex;flex-direction:column;gap:10px;}
        .menu-board-feature-kicker{font-size:calc(11px*var(--menu-board-scale));letter-spacing:0.16em;text-transform:uppercase;color:var(--menu-board-accent);font-weight:700;}
        .menu-board-feature-title{font-size:calc(30px*var(--menu-board-scale));line-height:1.05;font-weight:800;}
        .menu-board-feature-price{font-size:calc(22px*var(--menu-board-scale));font-weight:700;color:#fff4cf;}
        .menu-board-feature-description{font-size:calc(15px*var(--menu-board-scale));line-height:1.55;color:rgba(247,242,235,0.8);}
        .menu-board-sections{min-height:0;display:grid;align-content:start;grid-template-columns:repeat(${sectionCols},minmax(0,1fr));gap:calc(16px*var(--menu-board-scale));overflow:hidden;}
        .menu-board-category{min-height:0;display:flex;flex-direction:column;gap:calc(14px*var(--menu-board-scale));padding:calc(18px*var(--menu-board-scale));border-radius:24px;border:1px solid rgba(255,255,255,0.09);background:linear-gradient(180deg,rgba(255,255,255,0.08) 0%,rgba(255,255,255,0.035) 100%);box-shadow:inset 4px 0 0 var(--menu-board-category-accent);}
        .menu-board-category-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;}
        .menu-board-category-title{font-size:calc(22px*var(--menu-board-scale));line-height:1.1;font-weight:800;overflow-wrap:anywhere;}
        .menu-board-category-description{margin-top:6px;font-size:calc(12px*var(--menu-board-scale));line-height:1.45;color:rgba(247,242,235,0.62);}
        .menu-board-category-count{min-width:calc(32px*var(--menu-board-scale));height:calc(32px*var(--menu-board-scale));padding:0 10px;border-radius:999px;background:rgba(255,255,255,0.08);color:var(--menu-board-accent);display:inline-flex;align-items:center;justify-content:center;font-size:calc(12px*var(--menu-board-scale));font-weight:700;}
        .menu-board-item-list{display:flex;flex-direction:column;gap:calc(10px*var(--menu-board-scale));min-height:0;overflow:hidden;}
        .menu-board-item{display:grid;grid-template-columns:minmax(0,1fr);gap:12px;padding:calc(12px*var(--menu-board-scale));border-radius:18px;background:rgba(255,255,255,0.045);border:1px solid rgba(255,255,255,0.06);}
        .menu-board-item.has-image{grid-template-columns:calc(74px*var(--menu-board-scale)) minmax(0,1fr);}
        .menu-board-item-image{width:calc(74px*var(--menu-board-scale));height:calc(74px*var(--menu-board-scale));border-radius:14px;overflow:hidden;background:rgba(255,255,255,0.06);}
        .menu-board-item-image img{width:100%;height:100%;display:block;object-fit:cover;}
        .menu-board-item-copy{min-width:0;display:flex;flex-direction:column;gap:6px;}
        .menu-board-item-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;}
        .menu-board-item-name{min-width:0;font-size:calc(17px*var(--menu-board-scale));line-height:1.25;font-weight:700;overflow-wrap:anywhere;}
        .menu-board-item-price{white-space:nowrap;font-size:calc(14px*var(--menu-board-scale));font-weight:700;color:#fff4cf;}
        .menu-board-item-description{font-size:calc(12px*var(--menu-board-scale));line-height:1.45;color:rgba(247,242,235,0.72);overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;}
      </style>
      <div class="menu-board-shell">
        <header class="menu-board-header">
          <div>
            <div class="menu-board-eyebrow">Live POS Menu</div>
            <h1 class="menu-board-title">${escapeHtml2(boardTitle)}</h1>
            <div class="menu-board-subtitle">${escapeHtml2(subtitle)}</div>
          </div>
        </header>
        <div class="menu-board-grid ${layout === "featured" ? "is-featured" : ""}">
          ${featuredMarkup}
          <div class="menu-board-sections">${sectionsMarkup}</div>
        </div>
      </div>
    </div>`;
}
async function renderMenuBoard(container, content, api) {
  const meta = parseMetadata2(content);
  const posWorkspaceId = typeof meta["posWorkspaceId"] === "string" && meta["posWorkspaceId"] ? String(meta["posWorkspaceId"]) : null;
  if (!posWorkspaceId) {
    container.innerHTML = buildStateHtml(content.name || "Menu Board", "This menu board is missing its POS workspace source.");
    return;
  }
  const reqId = `mb-${Date.now()}`;
  container._mbReqId = reqId;
  container.innerHTML = buildStateHtml(content.name || "Menu Board", "Loading the latest POS menu\u2026");
  try {
    const menu = await api.getPosMenu(posWorkspaceId);
    if (!container.isConnected || container._mbReqId !== reqId) return;
    if (!menu) {
      container.innerHTML = buildStateHtml(content.name || "Menu Board", "The live POS menu could not be loaded.");
      return;
    }
    container.innerHTML = buildMenuBoardHtml(content, menu, meta);
  } catch (e) {
    if (!container.isConnected || container._mbReqId !== reqId) return;
    container.innerHTML = buildStateHtml(content.name || "Menu Board", "The live POS menu could not be loaded. Check the API connection or publish an active menu.");
  }
}

// src/renderers/datasync.ts
var RECONNECT_BASE = 2e3;
var MAX_RECONNECTS = 5;
function escHtml(s) {
  return String(s != null ? s : "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
async function withTimeout(p, ms) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);
}
function findCell(cells, trainId, stationId) {
  return cells.find((c) => c.trainId === trainId && c.stationId === stationId);
}
function renderCellContent(td, cell) {
  const status = (cell.status || "normal").toLowerCase();
  td.dataset["status"] = status;
  td.classList.remove("ds-cell-empty");
  let html = `<span class="ds-time">${escHtml(cell.value || "\u2013")}</span>`;
  if (cell.note) html += `<sup class="ds-note">${escHtml(cell.note)}</sup>`;
  if (status === "delayed" && cell.delayMins) html += `<span class="ds-delay">+${cell.delayMins}'</span>`;
  td.innerHTML = html;
}
var DS_STYLES = `
<style>
.ds-wrapper{display:flex;flex-direction:column;height:100%;background:#0a0e1a;color:#e2e8f0;font-family:'Segoe UI',Arial,sans-serif;overflow:hidden;}
.ds-title-bar{display:flex;align-items:baseline;justify-content:space-between;padding:16px 24px;background:#111827;border-bottom:2px solid #1e3a5f;flex-shrink:0;}
.ds-title{font-size:22px;font-weight:700;letter-spacing:0.5px;color:#93c5fd;}
.ds-subtitle{font-size:13px;color:#64748b;margin-left:16px;}
.ds-table{width:100%;border-collapse:collapse;font-size:15px;}
.ds-table thead th{background:#111827;color:#93c5fd;padding:10px 14px;text-align:center;font-weight:600;border-bottom:2px solid #1e3a5f;position:sticky;top:0;z-index:2;}
.ds-col-station{text-align:left!important;min-width:160px;}
.ds-train-number{display:block;font-size:16px;font-weight:700;}
.ds-train-days{display:block;font-size:11px;color:#64748b;margin-top:2px;}
.ds-train-delay{font-size:11px;color:#f59e0b;margin-top:2px;display:block;}
th[data-status="cancelled"]{opacity:0.5;text-decoration:line-through;}
th[data-status="delayed"]{color:#f59e0b!important;}
.ds-table tbody tr:nth-child(even){background:rgba(255,255,255,0.03);}
.ds-table tbody tr:hover{background:rgba(30,58,95,0.4);}
.ds-section-row .ds-section-header{background:#1e3a5f;color:#93c5fd;padding:6px 14px;font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase;}
.ds-station-name{padding:10px 14px;color:#cbd5e1;font-weight:500;}
.ds-cell{padding:8px 14px;text-align:center;color:#e2e8f0;}
.ds-cell-empty{color:#374151;}
td[data-status="delayed"]{background:rgba(245,158,11,0.08);}
td[data-status="cancelled"]{opacity:0.5;}
td[data-status="departed"]{color:#4ade80;}
.ds-time{font-variant-numeric:tabular-nums;}
.ds-note{color:#60a5fa;font-size:10px;margin-left:2px;}
.ds-delay{display:block;font-size:11px;color:#f59e0b;margin-top:1px;}
.ds-footer{padding:8px 24px;font-size:11px;color:#374151;border-top:1px solid #1e3a5f;flex-shrink:0;}
</style>`;
function renderDataSync(container, contentId, apiBase, deviceId) {
  let ws = null;
  let intentionalDisconnect = false;
  let reconnectAttempts = 0;
  let reconnectTimer = null;
  let pingInterval = null;
  let destroyed = false;
  const wsBase = apiBase.replace(/^http/, "ws").replace(/\/api\/v1$/, "");
  const clearPing = () => {
    if (pingInterval) {
      clearInterval(pingInterval);
      pingInterval = null;
    }
  };
  const cancelReconnect = () => {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    clearPing();
  };
  const updateFooter = () => {
    const footer = container.querySelector("#ds-footer");
    if (footer) footer.textContent = `Updated: ${(/* @__PURE__ */ new Date()).toLocaleTimeString()}`;
  };
  const patchCell = (data) => {
    var _a, _b, _c;
    const td = container.querySelector(`td[data-train="${data.trainId}"][data-station="${data.stationId}"]`);
    if (!td) return;
    switch (data.field) {
      case "value":
        td.dataset["value"] = String((_a = data.value) != null ? _a : "");
        break;
      case "note":
        td.dataset["note"] = String((_b = data.value) != null ? _b : "");
        break;
      case "status":
        td.dataset["cellStatus"] = String((_c = data.value) != null ? _c : "normal");
        break;
      case "delayMins":
        td.dataset["delayMins"] = data.value != null ? String(data.value) : "";
        break;
    }
    const cell = {
      id: "",
      trainId: data.trainId,
      stationId: data.stationId,
      value: td.dataset["value"] || null,
      note: td.dataset["note"] || null,
      status: td.dataset["cellStatus"] || "normal",
      delayMins: td.dataset["delayMins"] ? parseInt(td.dataset["delayMins"], 10) : null
    };
    renderCellContent(td, cell);
    updateFooter();
  };
  const applyTrainStatus = (data) => {
    const status = (data.status || "normal").toLowerCase();
    const th = container.querySelector(`th[data-train-id="${data.trainId}"]`);
    if (th) {
      th.dataset["status"] = status;
      let delaySpan = th.querySelector(".ds-train-delay");
      if (status === "delayed" && data.delayMins) {
        if (!delaySpan) {
          delaySpan = document.createElement("span");
          delaySpan.className = "ds-train-delay";
          th.appendChild(delaySpan);
        }
        delaySpan.textContent = `+${data.delayMins}'`;
      } else if (delaySpan) delaySpan.remove();
    }
    const dataCells = container.querySelectorAll(`td[data-train="${data.trainId}"]`);
    dataCells.forEach((td) => {
      if (td.classList.contains("ds-cell-empty")) return;
      td.dataset["status"] = status === "normal" ? td.dataset["cellStatus"] || "normal" : status;
    });
  };
  const handleWsMsg = (msg) => {
    switch (msg["event"]) {
      case "cell.update":
        if (msg["data"]) patchCell(msg["data"]);
        break;
      case "train.status":
        if (msg["data"]) applyTrainStatus(msg["data"]);
        break;
      case "table.reload":
        void start();
        break;
    }
  };
  const doConnect = () => {
    clearPing();
    if (destroyed) return;
    try {
      const fullUrl = `${wsBase}/api/v1/datasync`;
      ws = new WebSocket(fullUrl);
      ws.onopen = () => {
        reconnectAttempts = 0;
        ws.send(JSON.stringify({ event: "subscribe", contentId, deviceId }));
        pingInterval = setInterval(() => {
          if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ event: "ping" }));
        }, 2e4);
      };
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg["event"] !== "pong") handleWsMsg(msg);
        } catch (e) {
        }
      };
      ws.onerror = () => {
      };
      ws.onclose = () => {
        ws = null;
        clearPing();
        if (intentionalDisconnect || destroyed) return;
        if (reconnectAttempts < MAX_RECONNECTS) {
          const delay = RECONNECT_BASE * Math.pow(2, reconnectAttempts++);
          reconnectTimer = setTimeout(doConnect, delay);
        }
      };
    } catch (e) {
    }
  };
  const buildTable = (data) => {
    var _a, _b, _c;
    container.innerHTML = DS_STYLES;
    const wrapper = document.createElement("div");
    wrapper.className = "ds-wrapper";
    const titleBar = document.createElement("div");
    titleBar.className = "ds-title-bar";
    titleBar.innerHTML = `<span class="ds-title">${escHtml(data.title || "Schedule")}</span>${data.subtitle ? `<span class="ds-subtitle">${escHtml(data.subtitle)}</span>` : ""}`;
    wrapper.appendChild(titleBar);
    const scrollWrap = document.createElement("div");
    scrollWrap.style.cssText = "flex:1;overflow:auto;";
    const table = document.createElement("table");
    table.className = "ds-table";
    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    const stationTh = document.createElement("th");
    stationTh.className = "ds-col-station";
    stationTh.textContent = "Station";
    headRow.appendChild(stationTh);
    for (const train of data.trains) {
      const th = document.createElement("th");
      th.className = "ds-col-train";
      th.dataset["trainId"] = train.id;
      th.innerHTML = `<span class="ds-train-number">${escHtml(train.number)}</span>${train.days ? `<span class="ds-train-days">${escHtml(train.days)}</span>` : ""}`;
      if (train.status && train.status !== "normal") th.dataset["status"] = train.status;
      headRow.appendChild(th);
    }
    thead.appendChild(headRow);
    table.appendChild(thead);
    const tbody = document.createElement("tbody");
    let lastSection = null;
    for (const station of data.stations) {
      if (station.section && station.section !== lastSection) {
        lastSection = station.section;
        const sRow = document.createElement("tr");
        sRow.className = "ds-section-row";
        const sTd = document.createElement("td");
        sTd.colSpan = data.trains.length + 1;
        sTd.className = "ds-section-header";
        sTd.textContent = station.section;
        sRow.appendChild(sTd);
        tbody.appendChild(sRow);
      }
      const row = document.createElement("tr");
      row.dataset["stationId"] = station.id;
      const nameTd = document.createElement("td");
      nameTd.className = "ds-station-name";
      nameTd.innerHTML = escHtml(station.name) + (station.tag ? ` <span class="ds-station-tag" style="font-size:11px;color:#60a5fa;">${escHtml(station.tag)}</span>` : "");
      row.appendChild(nameTd);
      for (const train of data.trains) {
        const cell = findCell(data.cells, train.id, station.id);
        const td = document.createElement("td");
        td.className = "ds-cell";
        td.dataset["train"] = train.id;
        td.dataset["station"] = station.id;
        if (cell) {
          td.dataset["value"] = (_a = cell.value) != null ? _a : "";
          td.dataset["note"] = (_b = cell.note) != null ? _b : "";
          td.dataset["cellStatus"] = (_c = cell.status) != null ? _c : "normal";
          td.dataset["delayMins"] = cell.delayMins != null ? String(cell.delayMins) : "";
          renderCellContent(td, cell);
        } else {
          td.textContent = "\u2013";
          td.classList.add("ds-cell-empty");
        }
        row.appendChild(td);
      }
      tbody.appendChild(row);
    }
    table.appendChild(tbody);
    scrollWrap.appendChild(table);
    wrapper.appendChild(scrollWrap);
    const footer = document.createElement("div");
    footer.className = "ds-footer";
    footer.id = "ds-footer";
    footer.textContent = `Updated: ${(/* @__PURE__ */ new Date()).toLocaleTimeString()}`;
    wrapper.appendChild(footer);
    container.appendChild(wrapper);
  };
  const showState = (msg) => {
    container.innerHTML = `${DS_STYLES}<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#64748b;font-size:18px;">${escHtml(msg)}</div>`;
  };
  const start = async () => {
    if (destroyed) return;
    cancelReconnect();
    if (ws) {
      ws.onclose = null;
      ws.close(1e3, "re-render");
      ws = null;
    }
    intentionalDisconnect = false;
    reconnectAttempts = 0;
    showState("Loading schedule\u2026");
    try {
      const url = `${apiBase}/devices/${encodeURIComponent(deviceId)}/datasync/${encodeURIComponent(contentId)}/table`;
      const resp = await withTimeout(fetch(url, { headers: { "X-Device-Id": deviceId } }), 15e3);
      if (!resp.ok) {
        showState(`Schedule data unavailable (HTTP ${resp.status})`);
        return;
      }
      const data = await resp.json();
      if (destroyed) return;
      buildTable(data);
      doConnect();
    } catch (e) {
      if (!destroyed) showState("Could not load schedule data");
    }
  };
  void start();
  return {
    destroy() {
      destroyed = true;
      intentionalDisconnect = true;
      cancelReconnect();
      if (ws) {
        ws.onclose = null;
        ws.close(1e3, "destroy");
        ws = null;
      }
    },
    handleWsMessage(msg) {
      try {
        handleWsMsg(msg);
      } catch (e) {
      }
    }
  };
}

// src/sync/engine.ts
var _role = "follower";
var _playlist = [];
var _onLoop = null;
var _videos = [];
var _fg = 0;
var _container = null;
var _idx = 0;
var _durationMs = 0;
var _prebuffered = false;
var _looping = false;
var _firstPlay = true;
var _eosWatchTimer = null;
var _playTimer = null;
var _wallCrop = null;
var _canvas = null;
var _ctx = null;
var _rafId = null;
function setRole(r) {
  _role = r;
}
function setOnLoop(cb) {
  _onLoop = cb;
}
function setPlaylist(urls) {
  _playlist = urls;
  _idx = 0;
  _log("[Engine] playlist set (" + urls.length + "): " + urls.map((u) => u.split("/").pop()).join(", "));
}
function getPlaylistUrls() {
  return _playlist;
}
function setWallCrop(srcX, srcY, srcW, srcH, dstW, dstH) {
  _wallCrop = { srcX, srcY, srcW, srcH, dstW, dstH };
  _log(`[Engine] wall crop set srcX=${srcX} srcY=${srcY} srcW=${srcW} srcH=${srcH} \u2192 canvas ${dstW}\xD7${dstH}`);
  if (_canvas) {
    _canvas.width = dstW;
    _canvas.height = dstH;
  }
}
function isPlaying() {
  const v = _videos[_fg];
  return !!v && !v.paused && !v.ended && v.readyState >= 2;
}
function getCurrentPosMs() {
  const v = _videos[_fg];
  return v ? v.currentTime * 1e3 : 0;
}
function getDuration() {
  return _durationMs;
}
function initEngine(container) {
  if (_videos.length) return Promise.resolve();
  _container = container;
  for (let i = 0; i < 2; i++) {
    const v = document.createElement("video");
    v.id = "nexari-player-" + (i === 0 ? "A" : "B");
    if (!_wallCrop) {
      v.style.cssText = [
        "position:absolute",
        "top:0",
        "left:0",
        "width:100%",
        "height:100%",
        "object-fit:contain",
        "background:#000"
      ].join(";");
      v.style.zIndex = i === 0 ? "2" : "1";
      v.style.opacity = i === 0 ? "1" : "0";
      container.appendChild(v);
    }
    v.playsInline = true;
    v.autoplay = false;
    v.muted = false;
    v.loop = false;
    v.preload = "auto";
    _videos.push(v);
  }
  if (_wallCrop) {
    const { dstW, dstH } = _wallCrop;
    _canvas = document.createElement("canvas");
    _canvas.width = dstW;
    _canvas.height = dstH;
    _canvas.style.cssText = "position:absolute;top:0;left:0;width:100%;height:100%;background:#000;";
    container.appendChild(_canvas);
    _ctx = _canvas.getContext("2d");
    _log(`[Engine] initialised (canvas wall mode, ${dstW}\xD7${dstH})`);
  } else {
    _log("[Engine] initialised (HTML5 A/B-swap)");
  }
  return Promise.resolve();
}
function prepare(url) {
  if (_videos.length === 0) return Promise.reject(new Error("call initEngine first"));
  if (_playlist.length > 0) {
    const found = _playlist.indexOf(url);
    _idx = found >= 0 ? found : 0;
  }
  const fgVideo = _videos[_fg];
  if (fgVideo.src && fgVideo.src === url) {
    _log("[Engine] prepare: same src \u2014 reusing fg");
    return _rewindFgAndArm().then(() => {
      _preloadNext().catch(() => {
      });
    });
  }
  _log("[Engine] prepare: " + url.split("/").pop() + " onto fg=" + _fgLabel());
  return _loadSrc(fgVideo, url).then(() => {
    _durationMs = Math.round((fgVideo.duration || 0) * 1e3);
    _log("[Engine] prepare done \u2014 duration=" + (_durationMs / 1e3).toFixed(2) + "s");
    return _rewindFgAndArm();
  }).then(() => {
    _preloadNext().catch((e) => _log("[Engine] preload next failed: " + e));
  });
}
function schedulePlayAt(epochMs) {
  if (_playTimer !== null) clearTimeout(_playTimer);
  const waitMs = epochMs - Date.now();
  _log("[Engine] schedulePlayAt T-" + waitMs + "ms firstPlay=" + _firstPlay);
  _playTimer = setTimeout(() => {
    (function spin() {
      if (Date.now() >= epochMs) {
        _doPlayOrSwap();
        return;
      }
      setTimeout(spin, 4);
    })();
  }, Math.max(0, waitMs - 60));
}
function destroyEngine() {
  _stopEosWatch();
  _stopRaf();
  if (_playTimer !== null) {
    clearTimeout(_playTimer);
    _playTimer = null;
  }
  for (const v of _videos) {
    try {
      v.pause();
    } catch (e) {
    }
    if (v.parentNode) v.parentNode.removeChild(v);
  }
  _videos = [];
  if (_canvas && _canvas.parentNode) _canvas.parentNode.removeChild(_canvas);
  _canvas = null;
  _ctx = null;
  _durationMs = 0;
  _prebuffered = false;
  _looping = false;
  _firstPlay = true;
  _fg = 0;
  _idx = 0;
}
function _log(msg) {
  logger.info(msg);
}
function _startRaf() {
  if (!_wallCrop || !_ctx || _rafId !== null) return;
  const { srcX, srcY, srcW, srcH, dstW, dstH } = _wallCrop;
  const draw = () => {
    const v = _videos[_fg];
    if (v && v.readyState >= 2) _ctx.drawImage(v, srcX, srcY, srcW, srcH, 0, 0, dstW, dstH);
    _rafId = requestAnimationFrame(draw);
  };
  _rafId = requestAnimationFrame(draw);
}
function _stopRaf() {
  if (_rafId !== null) {
    cancelAnimationFrame(_rafId);
    _rafId = null;
  }
}
function _fgLabel() {
  return _fg === 0 ? "A" : "B";
}
function _bgLabel() {
  return _fg === 0 ? "B" : "A";
}
function _loadSrc(v, url) {
  return new Promise((resolve, reject) => {
    const onCanPlay = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      var _a;
      cleanup();
      const ve = v.error;
      reject(new Error("video error code=" + ((_a = ve == null ? void 0 : ve.code) != null ? _a : "?") + " src=" + url));
    };
    function cleanup() {
      v.removeEventListener("canplay", onCanPlay);
      v.removeEventListener("error", onError);
    }
    v.addEventListener("canplay", onCanPlay, { once: true });
    v.addEventListener("error", onError, { once: true });
    try {
      v.pause();
    } catch (e) {
    }
    v.src = url;
    v.load();
  });
}
function _rewindFgAndArm() {
  const v = _videos[_fg];
  if (_looping) return Promise.resolve();
  if (_prebuffered) {
    if (_onLoop) _onLoop();
    return Promise.resolve();
  }
  _stopEosWatch();
  _looping = true;
  _prebuffered = false;
  return new Promise((resolve) => {
    let armed = false;
    let safetyTid;
    const arm = () => {
      if (armed) return;
      armed = true;
      clearTimeout(safetyTid);
      _looping = false;
      _prebuffered = true;
      _log("[Engine] fg(" + _fgLabel() + ") armed at frame 0 \u2014 firing LOOP_READY");
      if (_onLoop) _onLoop();
      resolve();
    };
    const onSeeked = () => {
      v.removeEventListener("seeked", onSeeked);
      arm();
    };
    v.addEventListener("seeked", onSeeked, { once: true });
    try {
      v.pause();
      v.currentTime = 0;
    } catch (e) {
      v.removeEventListener("seeked", onSeeked);
      arm();
      return;
    }
    safetyTid = setTimeout(() => {
      v.removeEventListener("seeked", onSeeked);
      _log("[Engine] fg seek timeout");
      arm();
    }, 500);
  });
}
function _preloadNext() {
  if (_videos.length < 2 || _playlist.length < 2) return Promise.resolve();
  const bg = _videos[1 - _fg];
  const nextIdx = (_idx + 1) % _playlist.length;
  const nextUrl = _playlist[nextIdx];
  if (bg.src === nextUrl && bg.readyState >= 2 && Math.abs(bg.currentTime) < 0.05) return Promise.resolve();
  _log("[Engine] bg(" + _bgLabel() + ") preload: " + nextUrl.split("/").pop());
  if (!_wallCrop) {
    bg.style.opacity = "0";
    bg.style.zIndex = "1";
  }
  try {
    bg.pause();
  } catch (e) {
  }
  const loadOrReuse = bg.src === nextUrl ? Promise.resolve() : _loadSrc(bg, nextUrl);
  return loadOrReuse.then(() => new Promise((res) => {
    if (Math.abs(bg.currentTime) < 0.05) {
      res();
      return;
    }
    const onSeeked = () => {
      bg.removeEventListener("seeked", onSeeked);
      res();
    };
    bg.addEventListener("seeked", onSeeked, { once: true });
    try {
      bg.currentTime = 0;
    } catch (e) {
      res();
      return;
    }
    setTimeout(() => {
      bg.removeEventListener("seeked", onSeeked);
      res();
    }, 1500);
  })).then(() => {
    _log("[Engine] bg(" + _bgLabel() + ") prebuffered at frame 0");
  });
}
function _doPlayOrSwap() {
  if (_videos.length === 0) return;
  if (_firstPlay) {
    _firstPlay = false;
    _prebuffered = false;
    _videos[_fg].play().then(() => {
      _log("[Engine] play() fg(" + _fgLabel() + ") OK");
      _durationMs = Math.round((_videos[_fg].duration || 0) * 1e3);
      if (_wallCrop) _startRaf();
      _startEosWatch();
    }).catch((e) => _log("[Engine] play() failed: " + e));
    return;
  }
  const oldFg = _fg;
  const newFg = 1 - _fg;
  const oldV = _videos[oldFg];
  const newV = _videos[newFg];
  newV.play().then(() => {
    _log("[Engine] swap: now playing fg(" + (newFg === 0 ? "A" : "B") + ")");
    if (_wallCrop) {
      _fg = newFg;
      try {
        oldV.pause();
      } catch (e) {
      }
    } else {
      newV.style.zIndex = "2";
      newV.style.opacity = "1";
      oldV.style.zIndex = "1";
      oldV.style.opacity = "0";
      try {
        oldV.pause();
      } catch (e) {
      }
      _fg = newFg;
    }
    _idx = (_idx + 1) % _playlist.length;
    _durationMs = Math.round((newV.duration || 0) * 1e3);
    _prebuffered = false;
    _looping = false;
    _startEosWatch();
    _preloadNext().catch((e) => _log("[Engine] preload-after-swap failed: " + e));
  }).catch((e) => {
    _log("[Engine] swap play() failed: " + e);
    if (!_wallCrop) {
      oldV.style.zIndex = "2";
      oldV.style.opacity = "1";
      newV.style.zIndex = "1";
      newV.style.opacity = "0";
    }
  });
}
function _startEosWatch() {
  _stopEosWatch();
  const v = _videos[_fg];
  if (!v) return;
  const dur = v.duration;
  if (!isFinite(dur) || dur <= 0) return;
  _eosWatchTimer = setInterval(() => {
    const cv = _videos[_fg];
    if (!cv) {
      _stopEosWatch();
      return;
    }
    if (cv.ended || isFinite(cv.duration) && cv.currentTime >= cv.duration - 0.08) {
      _stopEosWatch();
      _onEos();
    }
  }, 100);
}
function _stopEosWatch() {
  if (_eosWatchTimer !== null) {
    clearInterval(_eosWatchTimer);
    _eosWatchTimer = null;
  }
}
function _onEos() {
  _log("[Engine] EOS fg(" + _fgLabel() + ") idx=" + _idx);
  _prebuffered = false;
  if (_playlist.length <= 1) {
    const v = _videos[_fg];
    try {
      v.currentTime = 0;
      v.play();
    } catch (e) {
    }
    _startEosWatch();
    return;
  }
  _rewindFgAndArm().then(() => {
    _preloadNext().catch(() => {
    });
  });
}

// src/sync/sync.ts
var CLOCK_SAMPLES = 7;
var CLOCK_RESYNC_MS = 6e4;
var GO_AHEAD_MS = 5e3;
var PLAYHEAD_TICK_MS = 600;
var WS_RECONNECT_MS = 2e3;
var LEADER_SCAN_MS = 4e3;
var DEVICE_LATENCY_MS = {};
var _cfg;
var _ws = null;
var _wsReady = false;
var _stopped = false;
var _role2 = "pending";
var _peers = [];
var _offsetMs = 0;
var _selfLatency = 0;
var _leaderReady = false;
var _followerReady = /* @__PURE__ */ new Set();
var _goSent = false;
var _loadReceived = false;
var _phaseTimer = null;
var _phaseStartedAt = 0;
var _peerHeads = /* @__PURE__ */ new Map();
var _ewma = 0;
var _ewmaN = 0;
var _peerWatchTimer = null;
var _resyncInProgress = false;
var _playlistUrls = [];
var _wsGen = 0;
async function init(cfg) {
  var _a, _b;
  _cfg = cfg;
  _stopped = false;
  _peers = [];
  _leaderReady = false;
  _followerReady = /* @__PURE__ */ new Set();
  _goSent = false;
  _loadReceived = false;
  _phaseStartedAt = 0;
  _ewma = 0;
  _ewmaN = 0;
  _selfLatency = (_a = DEVICE_LATENCY_MS[cfg.deviceId]) != null ? _a : 0;
  _role2 = cfg.pinnedLeaderId ? cfg.pinnedLeaderId === cfg.deviceId ? "leader" : "follower" : "pending";
  logger.info(`[Sync] init deviceId=${cfg.deviceId} group=${cfg.groupId} role=${_role2} pinned=${(_b = cfg.pinnedLeaderId) != null ? _b : "none"}`);
  cfg.onStatus("Connecting to relay\u2026");
  setOnLoop(() => {
    if (!_stopped) {
      logger.info("[Sync] prebuffer ready \u2014 sending LOOP_READY");
      _wsSend({ type: "LOOP_READY", groupId: _cfg.groupId, deviceId: _cfg.deviceId });
    }
  });
  await _connectWs();
  await _measureClock();
  setTimeout(() => {
    if (!_stopped) _measureClock().catch(() => {
    });
  }, 3e3);
  setTimeout(() => {
    if (!_stopped) _measureClock().catch(() => {
    });
  }, 1e4);
  setInterval(() => {
    if (!_stopped) _measureClock().catch(() => {
    });
  }, CLOCK_RESYNC_MS);
  cfg.onStatus(`Waiting for ${cfg.expectedPeers} peers\u2026`);
  await _waitPeers();
  logger.info(`[Sync] role=${_role2} peers=[${_peers.join(", ")}]`);
  cfg.onStatus(`Role: ${_role2} \u2014 peer(s): ${_peers.join(", ")}`);
  const resolvedRole = _role2;
  setRole(resolvedRole);
  _playlistUrls = await _fetchPlaylistUrls();
  setPlaylist(_playlistUrls);
  if (resolvedRole === "leader") {
    await _runLeader();
    _startPeerWatch();
  } else {
    cfg.onStatus("Follower \u2014 waiting for LOAD_URL from leader\u2026");
  }
}
function stop() {
  _stopped = true;
  _stopPhase();
  _stopPeerWatch();
  if (_ws) {
    try {
      _ws.close();
    } catch (e) {
    }
    _ws = null;
  }
  logger.info("[Sync] stopped");
}
function _connectWs() {
  const myGen = ++_wsGen;
  return new Promise((resolve) => {
    const attempt = () => {
      if (_stopped || _wsGen !== myGen) return;
      logger.info(`[Sync] WS connecting \u2192 ${_cfg.wsUrl}`);
      _wsReady = false;
      try {
        const ws = new WebSocket(_cfg.wsUrl);
        _ws = ws;
        ws.onopen = () => {
          if (_wsGen !== myGen) {
            try {
              ws.close();
            } catch (e) {
            }
            return;
          }
          _wsReady = true;
          logger.info("[Sync] WS connected");
          _wsSend({ type: "WS_REGISTER", deviceId: _cfg.deviceId, groupId: _cfg.groupId, ip: _cfg.selfIp });
          resolve();
        };
        ws.onmessage = (ev) => {
          try {
            _dispatch(JSON.parse(ev.data));
          } catch (e) {
          }
        };
        ws.onerror = () => {
          logger.warn("[Sync] WS error");
        };
        ws.onclose = () => {
          _wsReady = false;
          logger.warn("[Sync] WS closed \u2014 reconnecting\u2026");
          if (!_stopped && _wsGen === myGen) setTimeout(attempt, WS_RECONNECT_MS);
        };
      } catch (e) {
        logger.error(`[Sync] WS open failed: ${e == null ? void 0 : e.message}`);
        if (!_stopped && _wsGen === myGen) setTimeout(attempt, WS_RECONNECT_MS);
      }
    };
    attempt();
  });
}
function _wsSend(msg) {
  if (!_ws || !_wsReady || _ws.readyState !== 1) return;
  try {
    _ws.send(JSON.stringify(msg));
  } catch (e) {
  }
}
function _measureClock() {
  return new Promise((resolve) => {
    const results = [];
    let remaining = CLOCK_SAMPLES;
    const finish = () => {
      if (results.length === 0) {
        resolve();
        return;
      }
      results.sort((a, b) => a.rtt - b.rtt);
      _offsetMs = results[0].offset;
      logger.info(`[Clock] offset=${_offsetMs}ms bestRtt=${results[0].rtt}ms samples=${results.length}`);
      resolve();
    };
    for (let i = 0; i < CLOCK_SAMPLES; i++) {
      setTimeout(() => {
        if (!_wsReady) {
          if (--remaining === 0) finish();
          return;
        }
        const t1 = Date.now();
        const onMsg = (ev) => {
          const msg = (() => {
            try {
              return JSON.parse(ev.data);
            } catch (e) {
              return null;
            }
          })();
          if (!msg || msg.type !== "PONG" || msg.t1 !== t1) return;
          _ws.removeEventListener("message", onMsg);
          const t3 = Date.now();
          results.push({ offset: Math.round(msg.t2 + (t3 - t1) / 2 - t3), rtt: t3 - t1 });
          if (--remaining === 0) finish();
        };
        if (_ws) _ws.addEventListener("message", onMsg);
        _wsSend({ type: "PING", t1 });
        setTimeout(() => {
          if (_ws) _ws.removeEventListener("message", onMsg);
          if (--remaining === 0) finish();
        }, 1e3);
      }, i * 60);
    }
  });
}
var _localToServer = (t) => t + _offsetMs;
var _serverToLocal = (t) => t - _offsetMs;
var PEER_WAIT_TIMEOUT_MS = 2e4;
function _waitPeers() {
  if (_role2 === "follower") return Promise.resolve();
  return new Promise((resolve) => {
    const deadline = Date.now() + PEER_WAIT_TIMEOUT_MS;
    const elect = () => {
      if (_role2 === "pending") {
        const all = [..._peers, _cfg.deviceId].sort();
        _role2 = all[all.length - 1] === _cfg.deviceId ? "leader" : "follower";
      }
    };
    const check = () => {
      if (_stopped) {
        resolve();
        return;
      }
      if (_peers.length >= _cfg.expectedPeers) {
        elect();
        resolve();
        return;
      }
      if (Date.now() >= deadline) {
        logger.warn(`[Sync] peer-wait timeout \u2014 got ${_peers.length}/${_cfg.expectedPeers} peer(s), proceeding`);
        elect();
        resolve();
        return;
      }
      setTimeout(check, 300);
    };
    check();
  });
}
function _dispatch(msg) {
  var _a, _b, _c, _d, _e, _f;
  const from = String((_a = msg["from"]) != null ? _a : "relay");
  if (msg["type"] === "PONG") return;
  if (msg["type"] === "PEERS" || msg["type"] === "HEARTBEAT_PEERS") {
    const list = msg["type"] === "PEERS" ? msg["peers"].map((p) => p.deviceId) : msg["peers"];
    const others = list.filter((id) => id !== _cfg.deviceId);
    if (JSON.stringify(others) !== JSON.stringify(_peers)) {
      const dropped = _peers.filter((id) => !others.includes(id));
      dropped.forEach((id) => _followerReady.delete(id));
      _peers = others;
      logger.info(`[Sync] peers: [${_peers.join(", ")}]`);
    }
    return;
  }
  logger.info(`[Sync] \u2190 ${msg["type"]} from=${from}`);
  if (msg["type"] === "LOAD_URL") {
    if (_role2 !== "follower") return;
    if (_loadReceived) {
      logger.info("[Sync] LOAD_URL dup \u2014 ignored");
      return;
    }
    _loadReceived = true;
    const localPlaylist = getPlaylistUrls();
    let localUrl;
    const msgIndex = typeof msg["index"] === "number" ? msg["index"] : -1;
    if (msgIndex >= 0 && localPlaylist[msgIndex]) {
      localUrl = localPlaylist[msgIndex];
    } else {
      const leaderFile = (_c = String((_b = msg["url"]) != null ? _b : "").split("/").pop()) != null ? _c : "";
      const matchIdx = localPlaylist.findIndex((u) => u.split("/").pop() === leaderFile);
      localUrl = matchIdx >= 0 ? localPlaylist[matchIdx] : (_e = localPlaylist[0]) != null ? _e : String((_d = msg["url"]) != null ? _d : "");
    }
    const startIdx = localPlaylist.indexOf(localUrl);
    if (startIdx > 0) {
      setPlaylist([...localPlaylist.slice(startIdx), ...localPlaylist.slice(0, startIdx)]);
      logger.info(`[Sync] follower playlist realigned to start at ${localUrl.split("/").pop()}`);
    } else {
      setPlaylist(localPlaylist);
    }
    _cfg.onStatus(`Follower \u2014 preparing: ${localUrl.split("/").pop()}`);
    logger.info(`[Sync] LOAD_URL \u2192 local: ${localUrl.split("/").pop()} (leader sent: ${String((_f = msg["url"]) != null ? _f : "").split("/").pop()})`);
    _cfg.prepareEngine(localUrl).then(() => {
      if (_stopped) return;
      logger.info("[Sync] follower READY \u2014 sending READY");
      _cfg.onStatus("Follower \u2014 READY sent, waiting for GO\u2026");
      _wsSend({ type: "READY" });
    }).catch((e) => {
      logger.error(`[Sync] follower prepare failed: ${e == null ? void 0 : e.message} \u2014 retry in 3s`);
      if (!_stopped) setTimeout(() => {
        _loadReceived = false;
      }, 3e3);
    });
    return;
  }
  if (msg["type"] === "READY") {
    if (_role2 !== "leader") return;
    _followerReady.add(from);
    logger.info(`[Sync] READY from ${from} (${_followerReady.size}/${_peers.length})`);
    _checkAllReady();
    return;
  }
  if (msg["type"] === "GO") {
    if (_role2 !== "follower") return;
    const serverAt = Number(msg["playAt"]);
    const localPlay = _serverToLocal(serverAt) + _selfLatency;
    logger.info(`[Sync] GO \u2192 play in T-${Math.round(localPlay - Date.now())}ms`);
    _cfg.schedulePlay(localPlay);
    _startPhase();
    return;
  }
  if (msg["type"] === "PLAYHEAD") {
    _peerHeads.set(from, {
      serverNow: Number(msg["serverNow"]),
      posMs: Number(msg["posMs"]),
      at: Date.now()
    });
    return;
  }
  if (msg["type"] === "LOOP_GO") {
    const serverAt = Number(msg["playAt"]);
    const localPlayAt = _serverToLocal(serverAt);
    logger.info(`[Sync] LOOP_GO \u2192 play in T-${Math.round(localPlayAt - Date.now())}ms`);
    _cfg.schedulePlay(localPlayAt);
    _phaseStartedAt = Date.now();
    _ewma = 0;
    _ewmaN = 0;
    return;
  }
}
async function _runLeader() {
  _cfg.onStatus("Leader \u2014 fetching video URL\u2026");
  const url = _cfg.fetchVideoUrl ? await _cfg.fetchVideoUrl() : await _fetchVideoUrl();
  logger.info(`[Sync] leader video: ${url}`);
  const _leaderAllUrls = getPlaylistUrls();
  const _leaderIdx = _leaderAllUrls.indexOf(url);
  _wsSend({ type: "LOAD_URL", url, index: _leaderIdx >= 0 ? _leaderIdx : 0 });
  _cfg.onStatus("Leader \u2014 preparing engine\u2026");
  _cfg.prepareEngine(url).then(() => {
    if (_stopped) return;
    logger.info("[Sync] leader engine READY");
    _leaderReady = true;
    _cfg.onStatus(`Leader ready \u2014 waiting for ${_peers.length} follower(s)\u2026`);
    _checkAllReady();
  }).catch((e) => {
    logger.error(`[Sync] leader prepare failed: ${e == null ? void 0 : e.message} \u2014 retry in 5s`);
    if (!_stopped) setTimeout(() => {
      if (!_stopped) _runLeader();
    }, 5e3);
  });
}
function _checkAllReady() {
  if (!_leaderReady || _followerReady.size < _peers.length || _goSent || _stopped) return;
  _goSent = true;
  const localPlay = Date.now() + GO_AHEAD_MS;
  const serverPlay = _localToServer(localPlay);
  const dur = _cfg.getEngineDuration();
  logger.info(`[Sync] ALL READY \u2192 GO epoch=${serverPlay} dur=${dur}ms`);
  _wsSend({ type: "GO", playAt: serverPlay, durationMs: dur });
  _cfg.schedulePlay(localPlay + _selfLatency);
  _startPhase();
}
function _startPeerWatch() {
  if (_peerWatchTimer || _stopped) return;
  _peerWatchTimer = setInterval(_peerScan, LEADER_SCAN_MS);
}
function _stopPeerWatch() {
  if (_peerWatchTimer) {
    clearInterval(_peerWatchTimer);
    _peerWatchTimer = null;
  }
}
function _peerScan() {
  if (_stopped || _resyncInProgress || _role2 !== "leader") return;
  const joiners = _peers.filter((id) => !_followerReady.has(id));
  if (joiners.length === 0) return;
  logger.info(`[Sync] new follower(s): [${joiners.join(",")}] \u2014 resyncing`);
  _resyncLeader().catch(() => {
  });
}
async function _resyncLeader() {
  if (_resyncInProgress || _stopped) return;
  _resyncInProgress = true;
  try {
    _stopPhase();
    _leaderReady = false;
    _followerReady = /* @__PURE__ */ new Set();
    _goSent = false;
    if (_cfg.restartEngine) {
      try {
        _cfg.restartEngine();
      } catch (e) {
      }
    }
    if (_playlistUrls.length > 0) setPlaylist(_playlistUrls);
    await _runLeader();
  } finally {
    _resyncInProgress = false;
  }
}
function _startPhase() {
  if (_phaseTimer) return;
  _phaseStartedAt = Date.now();
  _peerHeads = /* @__PURE__ */ new Map();
  _ewma = 0;
  _ewmaN = 0;
  _phaseTimer = setInterval(_phaseTick, PLAYHEAD_TICK_MS);
}
function _stopPhase() {
  if (_phaseTimer) {
    clearInterval(_phaseTimer);
    _phaseTimer = null;
  }
}
function _phaseTick() {
  if (_stopped || !isPlaying()) return;
  const pos = getCurrentPosMs();
  const serverNow = _localToServer(Date.now());
  _wsSend({ type: "PLAYHEAD", serverNow, posMs: pos });
}
async function _fetchVideoUrl() {
  const urls = getPlaylistUrls();
  if (urls.length > 0) return urls[0];
  throw new Error("[Sync] no playlist URL available");
}
async function _fetchPlaylistUrls() {
  return getPlaylistUrls();
}

// src/player.ts
function escapeHtml3(s) {
  return String(s != null ? s : "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function parseMetadata3(content) {
  if (!content.metadata) return {};
  if (typeof content.metadata === "string") {
    try {
      return JSON.parse(content.metadata);
    } catch (e) {
      return {};
    }
  }
  return content.metadata;
}
function toContentRecord(item) {
  var _a;
  return (_a = item.content) != null ? _a : item;
}
function getDurationMs(item) {
  if (item.duration && item.duration > 0) return item.duration * 1e3;
  const meta = parseMetadata3(item.content);
  const d = Number(meta["duration"] || meta["durationSeconds"]);
  return isFinite(d) && d > 0 ? d * 1e3 : 1e4;
}
var Player = class {
  constructor(cfg) {
    this.ws = null;
    this.wsReady = false;
    this.deviceId = "";
    this.token = null;
    this.heartbeatTimer = null;
    this.reconnectTimer = null;
    this.contentRefreshTimer = null;
    this.logStreamTimer = null;
    this.ntpOffset = 0;
    this.ntpSyncInProgress = false;
    this.playlistItems = [];
    this.playlistIdx = 0;
    this.playbackCancel = null;
    this.currentHandle = null;
    this.currentVideoEl = null;
    // Map of remote content URL → local object URL (blob:). Populated by
    // preCacheItems() so that renderImage/Video/HTML/Pdf can play from local
    // storage and survive transient network loss.
    this.localUrlCache = /* @__PURE__ */ new Map();
    this.calendarPushHandlers = /* @__PURE__ */ new Map();
    this.syncActive = false;
    // Screenshot state — mirrors Tizen/Windows behaviour
    this.screenshotIntervalHandle = null;
    this.liveIntervalHandle = null;
    this.liveCaptureActive = false;
    this.liveCaptureIntervalMs = 1e3;
    this.liveCaptureBusy = false;
    // Throttled content-change thumbnail: at most once per 10s
    this.thumbTimer = null;
    this.lastThumbAt = 0;
    // Content download / cache state (mirrors Tizen downloadContentInBackground flow)
    this.lastContentSignature = null;
    this.pendingItems = null;
    this._pendingSyncGroupMsg = null;
    // Relay info stored when loadContent() finds a cross-OS sync group; consumed by swapToPending().
    this._pendingSyncRelayInfo = null;
    this.pendingSignature = null;
    this.isDownloadingContent = false;
    this.deviceDisplayName = "";
    // Cache for the pdfjsLib promise so we only inject the script tag once.
    this.pdfJsLibPromise = null;
    const savedApi = localStorage.getItem("PLAYER_API_BASE");
    const savedWs = localStorage.getItem("PLAYER_WS_URL");
    this.cfg = __spreadProps(__spreadValues({}, cfg), {
      apiBase: savedApi != null ? savedApi : cfg.apiBase,
      wsBase: savedWs != null ? savedWs : cfg.wsBase
    });
    this.api = new Api(this.cfg.apiBase, () => this.token);
  }
  async start() {
    var _a;
    const info = await this.cfg.adapter.getDeviceInfo();
    this.deviceId = info.deviceId;
    this.deviceDisplayName = info.modelName || info.modelCode || "";
    initLogger({ apiBase: this.cfg.apiBase, deviceId: info.deviceId });
    logger.info(`[Player] starting deviceId=${info.deviceId} platform=${info.platform}`);
    this.showIdle("Connecting\u2026");
    void this.syncNtp();
    this.token = await this.ensurePaired();
    logger.info(`[Player] paired (token: ${this.token ? "ok" : "none"})`);
    if (!this.tryLoadCachedSchedule()) this.showIdle("Waiting for content\u2026");
    this.connectWs();
    void this.sendHeartbeat();
    this.heartbeatTimer = setInterval(
      () => this.sendHeartbeat().catch((e) => logger.warn(`[Player] heartbeat: ${e}`)),
      (_a = this.cfg.heartbeatMs) != null ? _a : 3e4
    );
    void this.loadContent();
    this.contentRefreshTimer = setInterval(() => void this.loadContent(), 5 * 6e4);
    this.logStreamTimer = setInterval(() => this.flushLogStream(), 5e3);
  }
  stop() {
    var _a, _b;
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.contentRefreshTimer) {
      clearInterval(this.contentRefreshTimer);
      this.contentRefreshTimer = null;
    }
    if (this.logStreamTimer) {
      clearInterval(this.logStreamTimer);
      this.logStreamTimer = null;
    }
    this.cancelPlayback();
    if (this.syncActive) {
      try {
        stop();
      } catch (e) {
      }
      this.syncActive = false;
    }
    try {
      (_b = (_a = window.nexari) == null ? void 0 : _a.stopRelay) == null ? void 0 : _b.call(_a);
    } catch (e) {
    }
    if (this.ws) {
      try {
        this.ws.close();
      } catch (e) {
      }
      this.ws = null;
    }
  }
  async ensurePaired() {
    var _a, _b;
    const cached = (_a = window["__nexariToken"]) != null ? _a : localStorage.getItem("nexariToken");
    if (cached) {
      logger.info("[Pairing] found cached token, skipping pair flow");
      return cached;
    }
    logger.info("[Pairing] no cached token \u2014 fetching device info");
    const info = await this.cfg.adapter.getDeviceInfo();
    const net = await this.cfg.adapter.getNetworkInfo();
    logger.info(`[Pairing] deviceId=${info.deviceId} serial=${info.serialNumber} platform=${info.platform} ip=${net.ipAddress}`);
    logger.info(`[Pairing] apiBase=${this.cfg.apiBase}`);
    this.showPairingScreen("------", info, net, "Requesting pairing code\u2026");
    let pair;
    try {
      logger.info("[Pairing] POST /devices/pair \u2026");
      pair = await this.api.pairDevice({
        duid: info.deviceId,
        modelName: info.modelName,
        modelCode: info.modelCode,
        serialNumber: info.serialNumber,
        firmwareVersion: info.firmwareVersion,
        kind: info.kind,
        platform: info.platform,
        playerVersion: info.playerVersion
      });
      logger.info(`[Pairing] pairDevice response: status=${pair.status} code=${pair.code} hasToken=${!!pair.deviceToken}`);
    } catch (e) {
      logger.error(`[Pairing] pairDevice failed: ${e.message}`);
      this.updatePairingStatus(`Failed to contact server: ${e.message}. Retrying in 10s\u2026`);
      await new Promise((r) => setTimeout(r, 1e4));
      return this.ensurePaired();
    }
    if (pair.status === "claimed" && pair.deviceToken) {
      logger.info("[Pairing] already claimed \u2014 resuming");
      try {
        localStorage.setItem("nexariToken", pair.deviceToken);
      } catch (e) {
      }
      this.hidePairingScreen();
      return pair.deviceToken;
    }
    const code = (_b = pair.code) != null ? _b : "------";
    logger.info(`[Pairing] showing code: ${code}`);
    this.showPairingScreen(code, info, net, "Waiting for confirmation in dashboard\u2026");
    for (; ; ) {
      await new Promise((r) => setTimeout(r, 3e3));
      let pb;
      try {
        pb = await this.api.pairStatus(pair.code);
        logger.info(`[Pairing] pairStatus: claimed=${pb.claimed}`);
      } catch (e) {
        logger.warn(`[Pairing] pairStatus error: ${e.message}`);
        continue;
      }
      if (pb.claimed && pb.token) {
        logger.info("[Pairing] confirmed!");
        try {
          localStorage.setItem("nexariToken", pb.token);
        } catch (e) {
        }
        this.updatePairingStatus("Paired! Starting player\u2026");
        await new Promise((r) => setTimeout(r, 800));
        this.hidePairingScreen();
        return pb.token;
      }
    }
  }
  showPairingScreen(code, info, net, status) {
    var _a;
    (_a = document.getElementById("nexari-pair-panel")) == null ? void 0 : _a.remove();
    const apiBase = this.cfg.apiBase;
    const wsBase = this.cfg.wsBase;
    const serverHost = apiBase.replace(/\/api\/v1\/?$/, "").replace(/\/api\/?$/, "");
    const p = document.createElement("div");
    p.id = "nexari-pair-panel";
    p.style.cssText = [
      "position:fixed;inset:0;z-index:99999;",
      "background:#0d0f1a;color:#fff;",
      "display:flex;flex-direction:column;align-items:center;justify-content:center;",
      "font-family:system-ui,-apple-system,sans-serif;overflow:auto;"
    ].join("");
    p.innerHTML = `
<div style="text-align:center;max-width:680px;width:90%;padding:40px 0;">

  <!-- Logo -->
  <img src="./nexari-logo.png" alt="Nexari"
       style="width:140px;margin-bottom:32px;opacity:0.95;"
       onerror="this.style.display='none'">

  <!-- Title -->
  <h1 style="font-size:36px;font-weight:800;margin:0 0 36px;letter-spacing:0.3px;">
    Nexari Signage
  </h1>

  <!-- Code card -->
  <div style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);
              border-radius:20px;padding:40px 48px;margin-bottom:32px;
              backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);
              box-shadow:0 16px 48px rgba(0,0,0,0.4);">
    <p style="font-size:14px;color:#888;letter-spacing:0.15em;text-transform:uppercase;
              margin:0 0 16px;font-weight:600;">
      Enter this code in your dashboard:
    </p>
    <div id="nexari-pair-code"
         style="font-size:80px;font-weight:900;letter-spacing:14px;
                font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;
                color:#4a9eff;padding:10px 18px;border-radius:14px;
                background:rgba(74,158,255,0.08);border:1px solid rgba(74,158,255,0.25);
                display:inline-block;min-width:4ch;text-align:center;">
      ${escapeHtml3(code)}
    </div>
    <div id="nexari-pair-status"
         style="font-size:16px;color:#888;margin-top:20px;">
      ${escapeHtml3(status)}
    </div>
  </div>

  <!-- Device info -->
  <div style="display:flex;flex-wrap:wrap;justify-content:center;gap:10px 24px;
              font-size:14px;color:#666;margin-bottom:32px;">
    <span>Model: <strong style="color:#999;">${escapeHtml3(info.modelName || info.modelCode || "\u2014")}</strong></span>
    <span>IP: <strong style="color:#999;">${escapeHtml3(net.ipAddress || "Connecting\u2026")}</strong></span>
    <span>Serial: <strong style="color:#999;">${escapeHtml3(info.serialNumber || "\u2014")}</strong></span>
    <span>Platform: <strong style="color:#999;">${escapeHtml3(info.platform || "\u2014")}</strong></span>
  </div>

  <!-- URL hint -->
  <p style="font-size:14px;color:#555;margin:0 0 32px;">
    Dashboard: <span style="color:#4a9eff;">${escapeHtml3(serverHost || "ds.chiho.app")}</span>
  </p>

  <!-- Connection settings (collapsible) -->
  <div style="text-align:left;width:100%;">
    <button id="nexari-conn-toggle"
            onclick="(function(){
              var p=document.getElementById('nexari-conn-panel');
              var a=document.getElementById('nexari-conn-arrow');
              var show=p.style.display==='none'||!p.style.display;
              p.style.display=show?'block':'none';
              a.textContent=show?'\u25B2':'\u25BC';
            })()"
            style="width:100%;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);
                   border-radius:12px;padding:14px 20px;color:#999;font-size:14px;font-weight:600;
                   cursor:pointer;display:flex;align-items:center;justify-content:space-between;
                   font-family:inherit;">
      \u2699 Connection settings <span id="nexari-conn-arrow">\u25BC</span>
    </button>
    <div id="nexari-conn-panel"
         style="display:none;background:rgba(255,255,255,0.04);
                border:1px solid rgba(255,255,255,0.1);border-top:none;
                border-radius:0 0 12px 12px;padding:20px;">
      <p style="font-size:13px;color:#666;margin:0 0 16px;">
        Override the server address this device connects to.
      </p>
      <div style="margin-bottom:12px;">
        <label style="display:block;font-size:12px;color:#777;margin-bottom:6px;font-weight:600;">
          CMS / API Base URL
        </label>
        <input id="nexari-input-api" type="text" value="${escapeHtml3(apiBase)}" spellcheck="false"
               placeholder="http://192.168.1.17:3000/api/v1"
               style="width:100%;box-sizing:border-box;background:#111;border:1px solid #333;
                      border-radius:8px;padding:10px 12px;color:#fff;font-size:14px;
                      font-family:ui-monospace,monospace;">
      </div>
      <div style="margin-bottom:16px;">
        <label style="display:block;font-size:12px;color:#777;margin-bottom:6px;font-weight:600;">
          WebSocket URL
        </label>
        <input id="nexari-input-ws" type="text" value="${escapeHtml3(wsBase)}" spellcheck="false"
               placeholder="ws://192.168.1.17:3000"
               style="width:100%;box-sizing:border-box;background:#111;border:1px solid #333;
                      border-radius:8px;padding:10px 12px;color:#fff;font-size:14px;
                      font-family:ui-monospace,monospace;">
        <span style="font-size:11px;color:#555;">Auto-derived from API URL (http\u2192ws, https\u2192wss)</span>
      </div>
      <!-- Auto-derive WS from API input -->
      <script>
        (function(){
          var api=document.getElementById('nexari-input-api');
          var ws=document.getElementById('nexari-input-ws');
          if(api&&ws){api.addEventListener('input',function(){
            try{var u=new URL(api.value.trim());
              ws.value=(u.protocol==='https:'?'wss:':'ws:')+'//'+u.host;
            }catch(_){}
          });}
        })();
      <\/script>
      <div style="display:flex;gap:10px;">
        <button onclick="(function(){
                  var apiRaw=document.getElementById('nexari-input-api').value.trim().replace(/\\/$/,'');
                  var wsRaw=document.getElementById('nexari-input-ws').value.trim().replace(/\\/$/,'');
                  try{new URL(apiRaw);}catch(_){alert('Invalid API URL');return;}
                  localStorage.setItem('PLAYER_API_BASE',apiRaw);
                  if(wsRaw)localStorage.setItem('PLAYER_WS_URL',wsRaw);
                  else localStorage.removeItem('PLAYER_WS_URL');
                  location.reload();
                })()"
                style="flex:1;background:#4a9eff;border:none;border-radius:8px;padding:10px;
                       color:#fff;font-size:13px;font-weight:600;cursor:pointer;">
          Save &amp; Reconnect
        </button>
        <button onclick="(function(){
                  localStorage.removeItem('PLAYER_API_BASE');
                  localStorage.removeItem('PLAYER_WS_URL');
                  location.reload();
                })()"
                style="flex:1;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);
                       border-radius:8px;padding:10px;color:#999;font-size:13px;font-weight:600;
                       cursor:pointer;">
          Reset to Default
        </button>
      </div>
    </div>
  </div>
</div>`;
    document.body.appendChild(p);
  }
  updatePairingStatus(msg) {
    const el = document.getElementById("nexari-pair-status");
    if (el) el.textContent = msg;
    const codeEl = document.getElementById("nexari-pair-code");
    void codeEl;
  }
  hidePairingScreen() {
    var _a;
    (_a = document.getElementById("nexari-pair-panel")) == null ? void 0 : _a.remove();
  }
  async syncNtp(samples = 5) {
    if (this.ntpSyncInProgress) return;
    this.ntpSyncInProgress = true;
    try {
      const results = [];
      for (let i = 0; i < samples; i++) {
        const t0 = Date.now();
        const ts = await this.api.getServerTime();
        const t3 = Date.now();
        if (ts && isFinite(ts)) {
          const rtt = t3 - t0;
          if (rtt < 2e3) results.push({ offset: ts - t0 - rtt / 2, rtt });
        }
        if (i < samples - 1) await new Promise((r) => setTimeout(r, 20));
      }
      if (!results.length) return;
      results.sort((a, b) => a.rtt - b.rtt);
      const best = results[0];
      const prev = this.ntpOffset;
      const delta = Math.abs(best.offset - prev);
      this.ntpOffset = delta > 50 ? Math.round(best.offset) : Math.round(prev * 0.8 + best.offset * 0.2);
      logger.info(`[NTP] offset=${this.ntpOffset}ms rtt=${best.rtt}ms samples=${results.length}`);
    } catch (e) {
    } finally {
      this.ntpSyncInProgress = false;
    }
  }
  getSyncedTime() {
    return Date.now() + this.ntpOffset;
  }
  connectWs() {
    const url = `${this.cfg.wsBase}/api/v1/devices/ws/device${this.token ? `?token=${encodeURIComponent(this.token)}` : ""}`;
    logger.info(`[Player] WS connect ${url}`);
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.addEventListener("open", () => {
      this.wsReady = true;
      logger.info("[Player] WS open");
      void this.sendHeartbeat();
    });
    ws.addEventListener("message", (ev) => void this.onWsMessage(String(ev.data)));
    ws.addEventListener("close", () => {
      this.wsReady = false;
      this.liveCaptureActive = false;
      if (this.liveIntervalHandle) {
        clearTimeout(this.liveIntervalHandle);
        this.liveIntervalHandle = null;
      }
      logger.warn("[Player] WS closed \u2014 reconnect in 2s");
      this.reconnectTimer = setTimeout(() => this.connectWs(), 2e3);
    });
    ws.addEventListener("error", () => {
      logger.warn("[Player] WS error");
    });
  }
  send(obj) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    try {
      this.ws.send(JSON.stringify(__spreadValues({ deviceId: this.deviceId }, obj)));
    } catch (e) {
    }
  }
  async onWsMessage(raw) {
    var _a, _b, _c, _d, _e, _f;
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch (e) {
      return;
    }
    const t = String((_a = msg["type"]) != null ? _a : "");
    if (t === "calendar_events") {
      const contentId = String((_b = msg["contentId"]) != null ? _b : "");
      const handler = this.calendarPushHandlers.get(contentId);
      if (handler) handler(msg["events"] || []);
      return;
    }
    if (t === "cell.update" || t === "train.status" || t === "table.reload") {
      const h = this.currentHandle;
      if (h && typeof h.handleWsMessage === "function") h.handleWsMessage(msg);
      return;
    }
    if (["PEERS", "PING", "PONG", "LOAD_URL", "READY", "GO", "LOOP_GO", "PLAYHEAD", "LOOP_READY", "HEARTBEAT_PEERS"].includes(t)) return;
    switch (t) {
      case "server_ack":
        return;
      case "command":
      case "commands": {
        const cmds = Array.isArray(msg["commands"]) ? msg["commands"] : msg["command"] ? [{ command: msg["command"], payload: msg["payload"] }] : [];
        for (const c of cmds) await this.dispatchCommand(String((_c = c["command"]) != null ? _c : ""), c["payload"]);
        return;
      }
      case "content-update":
      case "content.published":
      case "content.updated":
      case "schedule.updated":
      case "refresh_schedule":
        await this.loadContent();
        return;
      case "reload":
        await this.cfg.adapter.reloadRenderer();
        return;
      case "APP_UPDATE": {
        const url = String((_e = (_d = msg["apkUrl"]) != null ? _d : msg["wgtUrl"]) != null ? _e : "");
        const version = String((_f = msg["version"]) != null ? _f : "");
        if (!url || !version) {
          this.send({ type: "app_update_failed", error: "missing url/version" });
          return;
        }
        const result = await this.cfg.adapter.installUpdate({
          url,
          version,
          sha256: msg["sha256"],
          onProgress: (p) => this.sendOta(p)
        });
        this.sendOta(result);
        return;
      }
      case "SYNC_GROUP_INIT":
        await this.initSyncGroup(msg);
        return;
      case "VIDEOWALL_INIT":
        await this.initVideoWall(msg);
        return;
      default:
        await this.dispatchCommand(t, msg["payload"]);
        return;
    }
  }
  async dispatchCommand(command, payload) {
    var _a;
    const a = this.cfg.adapter;
    logger.info(`[Player] command ${command}`);
    switch (command) {
      case "reboot":
        await a.reboot();
        return;
      case "power_off":
        await a.powerOff();
        return;
      case "power_on":
        await a.powerOn();
        return;
      case "sleep":
        await a.powerOff();
        return;
      case "relaunch_app":
        await a.relaunch();
        return;
      case "clear_cache":
        await a.clearCache();
        return;
      case "open_settings":
        if (typeof a.openSettings === "function") await a.openSettings();
        return;
      case "refresh_schedule":
      case "SESSION_CONFIG":
        await this.loadContent();
        return;
      case "screenshot": {
        const shot = await a.screenshot().catch(() => null);
        if (shot == null ? void 0 : shot.jpegBase64) this.send({ type: "screenshot_data", payload: { dataBase64: shot.jpegBase64, trigger: "manual", contentId: null } });
        return;
      }
      case "screenshot_auto": {
        const shot = await a.screenshot().catch(() => null);
        if (shot == null ? void 0 : shot.jpegBase64) this.send({ type: "screenshot_data", payload: { dataBase64: shot.jpegBase64, trigger: "content_change", contentId: null } });
        return;
      }
      case "set_screenshot_interval": {
        if (this.screenshotIntervalHandle) {
          clearInterval(this.screenshotIntervalHandle);
          this.screenshotIntervalHandle = null;
        }
        const minutes = Math.max(1, Number(payload == null ? void 0 : payload["minutes"]) || 5);
        logger.info(`[Screenshot] interval set to ${minutes} min`);
        setTimeout(() => void this.takeScreenshot("interval"), 3e3);
        this.screenshotIntervalHandle = setInterval(() => void this.takeScreenshot("interval"), minutes * 6e4);
        return;
      }
      case "start_live_capture": {
        const intervalMs = Math.max(1e3, Number(payload == null ? void 0 : payload["intervalMs"]) || 1e3);
        logger.info(`[Screenshot] live capture, intervalMs=${intervalMs}`);
        if (this.liveIntervalHandle) {
          clearTimeout(this.liveIntervalHandle);
          this.liveIntervalHandle = null;
        }
        this.liveCaptureActive = true;
        this.liveCaptureIntervalMs = intervalMs;
        this.liveCaptureBusy = false;
        this.scheduleLiveCapture(200);
        return;
      }
      case "set_volume":
      case "set_system_volume":
        if (typeof (payload == null ? void 0 : payload["level"]) === "number") await a.setVolume(payload["level"]);
        return;
      case "set_mute":
      case "set_system_mute":
        if (typeof (payload == null ? void 0 : payload["mute"]) === "boolean") await a.setMute(payload["mute"]);
        return;
      case "set_brightness":
        if (typeof (payload == null ? void 0 : payload["level"]) === "number") await a.setBrightness(payload["level"]);
        return;
      case "mdc_control": {
        const action = String((_a = payload == null ? void 0 : payload["action"]) != null ? _a : "");
        if (action === "set_volume" && typeof (payload == null ? void 0 : payload["level"]) === "number") await a.setVolume(payload["level"]);
        if (action === "set_mute" && typeof (payload == null ? void 0 : payload["mute"]) === "boolean") await a.setMute(payload["mute"]);
        return;
      }
      case "dump_logs":
      case "request_log_burst":
        this.flushLogStream();
        return;
      default:
        logger.warn(`[Player] unhandled command: ${command}`);
    }
  }
  // ── Screenshot helpers ──────────────────────────────────────────────────────
  async takeScreenshot(trigger) {
    try {
      const shot = await this.cfg.adapter.screenshot();
      if (shot == null ? void 0 : shot.jpegBase64) {
        this.send({ type: "screenshot_data", payload: { dataBase64: shot.jpegBase64, trigger, contentId: null } });
        logger.info(`[Screenshot] sent trigger=${trigger} bytes=${shot.jpegBase64.length}`);
      }
    } catch (e) {
      logger.warn(`[Screenshot] failed: ${e.message}`);
    }
  }
  /** Throttled auto-thumbnail on content change (≤1 per 10s, fires 5s after item starts). */
  scheduleContentChangeShot() {
    const now = Date.now();
    if (now - this.lastThumbAt < 1e4) return;
    if (this.thumbTimer) {
      clearTimeout(this.thumbTimer);
      this.thumbTimer = null;
    }
    this.thumbTimer = setTimeout(() => {
      this.thumbTimer = null;
      this.lastThumbAt = Date.now();
      void this.takeScreenshot("content_change");
    }, 5e3);
  }
  /** Live-view capture loop (setTimeout chain, not setInterval — prevents concurrent calls). */
  scheduleLiveCapture(delayMs) {
    this.liveIntervalHandle = setTimeout(async () => {
      var _a;
      if (!this.liveCaptureActive) return;
      if (this.liveCaptureBusy) {
        this.scheduleLiveCapture(200);
        return;
      }
      this.liveCaptureBusy = true;
      try {
        const shot = await this.cfg.adapter.screenshot();
        if ((shot == null ? void 0 : shot.jpegBase64) && ((_a = this.ws) == null ? void 0 : _a.readyState) === WebSocket.OPEN) {
          this.send({ type: "screenshot_data", payload: { dataBase64: shot.jpegBase64, trigger: "live", contentId: null } });
        }
      } catch (e) {
      } finally {
        this.liveCaptureBusy = false;
        if (this.liveCaptureActive) this.scheduleLiveCapture(Math.max(1e3, this.liveCaptureIntervalMs));
      }
    }, delayMs);
  }
  async sendHeartbeat() {
    var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l, _m;
    if (!this.deviceId) return;
    try {
      const a = this.cfg.adapter;
      const info = await a.getDeviceInfo();
      const net = await a.getNetworkInfo();
      const power = await a.getPowerState();
      const res = a.getResources ? await a.getResources().catch(() => null) : null;
      const items = this.playlistItems;
      const curIdx = this.playlistIdx;
      const currentId = (_c = (_b = (_a = items[curIdx]) == null ? void 0 : _a.content) == null ? void 0 : _b.id) != null ? _c : null;
      let nextId = null;
      let nextStartsAt = null;
      if (items.length > 1) {
        const nIdx = (curIdx + 1) % items.length;
        nextId = (_f = (_e = (_d = items[nIdx]) == null ? void 0 : _d.content) == null ? void 0 : _e.id) != null ? _f : null;
        const durSec = Number((_h = (_g = items[curIdx]) == null ? void 0 : _g.duration) != null ? _h : 0);
        if (durSec > 0) nextStartsAt = new Date(this.getSyncedTime() + durSec * 1e3).toISOString();
      }
      logger.info(`[Heartbeat] sending res=${info.resolution} tz=${info.timezone} ver=${info.playerVersion} mac=${(_i = info.macAddress) != null ? _i : "null"} ip=${net.ipAddress} cpu=${(_j = res == null ? void 0 : res.cpuLoad) != null ? _j : "n/a"} uptime=${(_k = res == null ? void 0 : res.deviceUptimeSec) != null ? _k : "n/a"}s`);
      this.send({
        type: "heartbeat",
        payload: __spreadProps(__spreadValues(__spreadValues(__spreadValues(__spreadValues(__spreadValues({
          playerVersion: info.playerVersion,
          firmwareVersion: info.firmwareVersion,
          timezone: info.timezone,
          resolution: info.resolution,
          powerState: power,
          kind: info.kind,
          batteryPct: info.batteryPct,
          clockDriftMs: this.ntpOffset
        }, (res == null ? void 0 : res.cpuLoad) != null ? { cpuLoad: res.cpuLoad } : {}), (res == null ? void 0 : res.memoryFreeBytes) != null ? { memoryFreeBytes: res.memoryFreeBytes } : {}), (res == null ? void 0 : res.memoryTotalBytes) != null ? { memoryTotalBytes: res.memoryTotalBytes } : {}), (res == null ? void 0 : res.storageFreeBytes) != null ? { storageFreeBytes: res.storageFreeBytes } : {}), (res == null ? void 0 : res.deviceUptimeSec) != null ? { deviceUptimeSec: res.deviceUptimeSec } : {}), {
          currentContentId: currentId,
          nextContentId: nextId,
          nextStartsAt
        })
      });
      if (net.ipAddress) {
        this.send({
          type: "network_info",
          payload: __spreadValues({
            ip: net.ipAddress,
            mac: (_l = info.macAddress) != null ? _l : "",
            connectionType: (_m = net.connectionType) != null ? _m : "wifi"
          }, net.ssid ? { wifiSsid: net.ssid } : {})
        });
      }
    } catch (e) {
      logger.warn(`[Heartbeat] failed: ${e.message}`);
    }
  }
  flushLogStream() {
    var _a, _b;
    if (!this.wsReady) return;
    const buf = window["LogBuffer"];
    if (!(buf == null ? void 0 : buf.drain)) return;
    const batch = buf.drain(200);
    if (!batch.length) return;
    const byLevel = { debug: [], info: [], warn: [], error: [] };
    for (const e of batch) {
      const lvl = e.level && byLevel[e.level] ? e.level : "info";
      byLevel[lvl].push(`${(_a = e.timestamp) != null ? _a : (/* @__PURE__ */ new Date()).toISOString()} ${(_b = e.message) != null ? _b : ""}`);
    }
    for (const [level, lines] of Object.entries(byLevel)) {
      if (!lines.length) continue;
      for (let i = 0; i < lines.length; i += 50) {
        this.send({ type: "device_log", payload: { level, lines: lines.slice(i, i + 50) } });
      }
    }
  }
  // ── Content signature (mirrors Tizen getContentSignature) ──────────────────
  getContentSignature(items) {
    const parts = items.map((item) => {
      var _a, _b, _c, _d, _e;
      const c = item.content;
      const updAt = (_a = item.updatedAt) != null ? _a : "";
      return [(_b = item.id) != null ? _b : "", updAt, (_c = c == null ? void 0 : c.id) != null ? _c : "", (_d = c == null ? void 0 : c.updatedAt) != null ? _d : "", (_e = c == null ? void 0 : c.version) != null ? _e : ""].join(":");
    });
    return JSON.stringify(parts);
  }
  // ── Pre-cache every content file as a local blob: URL ──────────────────────
  // Downloads every URL referenced by the schedule via fetch() and registers
  // the resulting Blob as an object URL in localUrlCache. Renderers then call
  // resolveLocalUrl() to swap the remote URL for the local one — playback is
  // fully offline once the schedule has been cached.
  async preCacheItems(items) {
    const urls = Array.from(new Set(
      items.map((i) => {
        var _a, _b;
        return (_b = (_a = i.content) == null ? void 0 : _a.url) != null ? _b : "";
      }).filter((u) => !!u)
    ));
    const total = urls.length;
    if (!total) return;
    const nextCache = /* @__PURE__ */ new Map();
    let done = 0;
    const diskCache = await caches.open("nexari-content-v1").catch(() => null);
    await Promise.allSettled(urls.map(async (url) => {
      var _a;
      try {
        const urlKey = (_a = url.split("?")[0]) != null ? _a : url;
        const existing = this.localUrlCache.get(urlKey);
        if (existing) {
          nextCache.set(urlKey, existing);
          done++;
          this.updateIdleProgress(Math.round(done / total * 100));
          return;
        }
        let resp = diskCache ? await diskCache.match(urlKey) : void 0;
        let isHit = !!resp;
        if (!resp) {
          resp = await fetch(url, { credentials: "omit" });
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          if (diskCache) {
            try {
              await diskCache.put(urlKey, resp.clone());
            } catch (e) {
              logger.warn(`[Cache] write disk fail: ${e}`);
            }
          }
        }
        const blob = await resp.blob();
        const blobUrl = URL.createObjectURL(blob);
        nextCache.set(urlKey, blobUrl);
        if (isHit) {
          logger.info(`[Cache] local disk hit ${urlKey} (${(blob.size / 1024).toFixed(1)} KiB)`);
        } else {
          logger.info(`[Cache] downloaded ${urlKey} (${(blob.size / 1024).toFixed(1)} KiB)`);
        }
      } catch (e) {
        logger.warn(`[Cache] failed ${url.split("?")[0]}: ${e == null ? void 0 : e.message}`);
      }
      done++;
      this.updateIdleProgress(Math.round(done / total * 100));
    }));
    for (const [oldUrlKey, oldBlob] of this.localUrlCache) {
      if (!nextCache.has(oldUrlKey)) {
        try {
          URL.revokeObjectURL(oldBlob);
        } catch (e) {
        }
      }
    }
    this.localUrlCache = nextCache;
  }
  /** Swap a remote content URL for the locally cached blob: URL if available. */
  resolveLocalUrl(url) {
    var _a, _b;
    if (!url) return "";
    const urlKey = (_a = url.split("?")[0]) != null ? _a : url;
    return (_b = this.localUrlCache.get(urlKey)) != null ? _b : url;
  }
  // ── Update the idle progress bar in-place without re-rendering the screen ───
  updateIdleProgress(pct) {
    const bar = this.cfg.container.querySelector(".nexari-download-bar");
    if (bar) bar.style.width = `${pct}%`;
    const status = this.cfg.container.querySelector(".nexari-idle-status");
    if (status) status.textContent = `Downloading content\u2026 ${pct}%`;
  }
  // ── Background download → swap (mirrors Tizen downloadContentInBackground) ──
  async downloadContentInBackground(items, signature) {
    if (this.isDownloadingContent) {
      logger.info("[Player] download already in progress, skipping");
      return;
    }
    if (signature === this.pendingSignature) {
      logger.info("[Player] content already downloaded and pending");
      return;
    }
    this.isDownloadingContent = true;
    try {
      const nothingPlaying = !this.playlistItems.length && !this.syncActive;
      if (nothingPlaying) this.showIdle("Downloading content\u2026 0%", 0);
      await this.preCacheItems(items);
      this.pendingItems = items;
      this.pendingSignature = signature;
      try {
        localStorage.setItem("nexari-schedule-cache", JSON.stringify(items));
      } catch (e) {
      }
      logger.info("[Player] download complete \u2014 swapping content");
      this.swapToPending();
    } catch (err) {
      logger.error(`[Player] background download failed: ${err == null ? void 0 : err.message}`);
      if (!this.playlistItems.length) {
        if (!this.tryLoadCachedSchedule()) this.showIdle("Waiting for content\u2026");
      }
    } finally {
      this.isDownloadingContent = false;
    }
  }
  swapToPending() {
    if (!this.pendingItems) return;
    this.playlistItems = this.pendingItems;
    this.playlistIdx = 0;
    this.lastContentSignature = this.pendingSignature;
    this.pendingItems = null;
    this.pendingSignature = null;
    if (this._pendingSyncGroupMsg) {
      const syncMsg = this._pendingSyncGroupMsg;
      this._pendingSyncGroupMsg = null;
      this._pendingSyncRelayInfo = null;
      void this.initSyncGroup(syncMsg);
      return;
    }
    if (this._pendingSyncRelayInfo) {
      const info = this._pendingSyncRelayInfo;
      this._pendingSyncRelayInfo = null;
      logger.info(`[Player] swapToPending: starting cross-OS relay sync for group ${info.groupId}`);
      void this.initSyncGroup({
        groupId: info.groupId,
        relayUrl: info.relayUrl,
        leaderPriority: info.leaderPriority,
        expectedPeers: info.peerCount,
        syncRelayMode: "cloud"
        // API relay — no device-side relay server needed
      });
      return;
    }
    if (this.syncActive) return;
    this.cancelPlayback();
    void this.renderPlaylist();
  }
  tryLoadCachedSchedule() {
    try {
      const raw = localStorage.getItem("nexari-schedule-cache");
      if (!raw) return false;
      const items = JSON.parse(raw);
      if (!Array.isArray(items) || !items.length) return false;
      logger.info("[Player] using cached schedule (offline fallback)");
      this.playlistItems = items;
      this.playlistIdx = 0;
      this.lastContentSignature = this.getContentSignature(items);
      void this.preCacheItems(items).catch(() => {
      });
      if (this.syncActive) return true;
      this.cancelPlayback();
      void this.renderPlaylist();
      return true;
    } catch (e) {
      return false;
    }
  }
  // ── Main content loader (mirrors Tizen loadContent) ──────────────────────────
  async loadContent() {
    var _a, _b, _c, _d;
    logger.info("[Player] loadContent");
    try {
      const schedule = await this.api.getCurrentContent(this.deviceId);
      if (!schedule || !Array.isArray(schedule.items) || !schedule.items.length) {
        logger.warn(`[Player] loadContent: no items (schedule=${schedule ? "ok" : "null"} items=${(_b = (_a = schedule == null ? void 0 : schedule.items) == null ? void 0 : _a.length) != null ? _b : 0})`);
        this.cancelPlayback();
        this.playlistItems = [];
        this.lastContentSignature = null;
        this.showIdle("Waiting for content\u2026");
        return;
      }
      const newSig = this.getContentSignature(schedule.items);
      const isPlaying2 = !!this.playlistItems.length && !!(this.playbackCancel && !this.playbackCancel.signal.aborted) || this.syncActive;
      if (newSig === this.lastContentSignature && this.playlistItems.length && isPlaying2) {
        logger.info("[Player] content unchanged, still playing \u2014 skip");
        if (this.localUrlCache.size === 0) {
          void this.preCacheItems(this.playlistItems).catch(() => {
          });
        }
        return;
      }
      if (newSig === this.lastContentSignature && this.playlistItems.length && !isPlaying2) {
        logger.warn("[Player] same signature but not playing \u2014 forcing re-render");
        this.cancelPlayback();
        void this.renderPlaylist();
        return;
      }
      logger.info(`[Player] new content (${schedule.items.length} items), downloading\u2026`);
      const sg = schedule;
      if (sg["allTizen"] === false && sg["relayUrl"]) {
        const rawPeers = (_c = sg["peers"]) != null ? _c : [];
        const sortedPeers = [...rawPeers].sort((a, b) => {
          var _a2, _b2;
          return ((_a2 = a.leaderPriority) != null ? _a2 : 999) - ((_b2 = b.leaderPriority) != null ? _b2 : 999);
        });
        this._pendingSyncRelayInfo = {
          groupId: String((_d = sg["syncGroupId"]) != null ? _d : ""),
          relayUrl: String(sg["relayUrl"]),
          leaderPriority: sortedPeers.map((p) => p.deviceId),
          peerCount: Math.max(1, sortedPeers.length - 1)
          // count of OTHER peers
        };
        logger.info(`[Player] cross-OS sync group relay stored: ${this._pendingSyncRelayInfo.relayUrl}`);
      } else {
        this._pendingSyncRelayInfo = null;
      }
      void this.downloadContentInBackground(schedule.items, newSig);
    } catch (e) {
      logger.warn(`[Player] loadContent failed: ${e == null ? void 0 : e.message}`);
      if (!this.playlistItems.length) {
        if (!this.tryLoadCachedSchedule()) this.showIdle("Waiting for content\u2026");
      }
    }
  }
  cancelPlayback() {
    if (this.playbackCancel) {
      this.playbackCancel.abort();
      this.playbackCancel = null;
    }
    if (this.currentHandle) {
      try {
        this.currentHandle.destroy();
      } catch (e) {
      }
      this.currentHandle = null;
    }
    this.releaseVideo();
    this.cfg.container.innerHTML = "";
  }
  /**
   * Fully release a <video> element's media decoder resources.
   * On Android WebView, just .pause() + .remove() leaks the decoder buffer.
   * Must clear src, removeAttribute, call load(), then remove from DOM.
   */
  releaseVideo() {
    const v = this.currentVideoEl;
    if (!v) return;
    this.currentVideoEl = null;
    try {
      v.pause();
    } catch (e) {
    }
    try {
      v.removeAttribute("src");
      v.src = "";
    } catch (e) {
    }
    try {
      v.load();
    } catch (e) {
    }
    try {
      v.remove();
    } catch (e) {
    }
  }
  async renderPlaylist() {
    const ctrl = new AbortController();
    this.playbackCancel = ctrl;
    const items = this.playlistItems;
    if (!items.length) {
      this.showIdle("No content published");
      return;
    }
    let idx = this.playlistIdx;
    let lastRenderedId = null;
    while (!ctrl.signal.aborted) {
      const item = items[idx];
      const record = toContentRecord(item);
      const durMs = getDurationMs(item);
      const sameAsLast = record.id && record.id === lastRenderedId;
      if (!sameAsLast) {
        logger.info(`[Player] item[${idx}] type=${record.type} id=${record.id} dur=${durMs}ms`);
        try {
          await this.renderContent(this.cfg.container, record, ctrl.signal);
        } catch (e) {
          if (ctrl.signal.aborted) break;
          logger.warn(`[Player] renderContent error: ${e == null ? void 0 : e.message}`);
        }
        lastRenderedId = record.id || null;
        this.scheduleContentChangeShot();
      }
      if (ctrl.signal.aborted) break;
      await this.sleep(durMs, ctrl.signal);
      if (ctrl.signal.aborted) break;
      idx = (idx + 1) % items.length;
    }
  }
  sleep(ms, signal) {
    return new Promise((resolve) => {
      const t = setTimeout(resolve, ms);
      signal.addEventListener("abort", () => {
        clearTimeout(t);
        resolve();
      });
    });
  }
  async renderContent(container, record, signal) {
    const type = (record.type || "").toUpperCase().replace(/_/g, "").replace("HTML5", "HTML").replace("WEBURL", "HTML").replace("LIVESTREAM", "LIVE_STREAM").replace("ZONELAYOUT", "ZONE_LAYOUT").replace("MENUBOARD", "MENU_BOARD");
    if (type === "VIDEO" && this.currentVideoEl) {
      await this.transitionToVideo(container, record, signal);
      return;
    }
    container.innerHTML = "";
    container.style.cssText = "position:absolute;inset:0;overflow:hidden;background:#000;";
    if (this.currentHandle) {
      try {
        this.currentHandle.destroy();
      } catch (e) {
      }
      this.currentHandle = null;
    }
    this.releaseVideo();
    switch (type) {
      case "IMAGE":
        await this.renderImage(container, record, signal);
        break;
      case "VIDEO":
        await this.renderVideo(container, record, signal);
        break;
      case "HTML":
        await this.renderHTML(container, record, signal);
        break;
      case "CANVAS":
        await this.renderCanvas(container, record, signal);
        break;
      case "MENU_BOARD":
        await renderMenuBoard(container, record, this.api);
        break;
      case "CALENDAR":
        this.renderCalendarContent(container, record);
        break;
      case "DATASYNC":
        this.renderDataSyncContent(container, record);
        break;
      case "LIVE_STREAM":
        await this.renderLiveStream(container, record, signal);
        break;
      case "PDF":
        await this.renderPdf(container, record, signal);
        break;
      case "ZONE_LAYOUT":
        await this.renderZoneLayout(container, record, signal);
        break;
      default:
        logger.warn(`[Player] unknown content type: ${record.type}`);
        this.showIdle(`Unknown type: ${escapeHtml3(record.type)}`);
    }
  }
  renderImage(container, record, signal) {
    return new Promise((resolve) => {
      const url = this.resolveLocalUrl(record.url);
      if (!url) {
        resolve();
        return;
      }
      const img = document.createElement("img");
      img.src = url;
      img.style.cssText = "position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#000;";
      img.onload = () => resolve();
      img.onerror = () => {
        logger.warn(`[Player] image error: ${record.url}`);
        resolve();
      };
      container.appendChild(img);
      signal.addEventListener("abort", () => {
        img.src = "";
        resolve();
      });
    });
  }
  renderVideo(container, record, signal) {
    return new Promise((resolve) => {
      const url = this.resolveLocalUrl(record.url);
      if (!url) {
        resolve();
        return;
      }
      const v = document.createElement("video");
      v.src = url;
      v.autoplay = true;
      v.loop = true;
      v.playsInline = true;
      const isNexariAndroid = navigator.userAgent.includes("NexariPlayer");
      if (!isNexariAndroid) {
        v.muted = true;
        v.defaultMuted = true;
      }
      v.preload = "auto";
      v.setAttribute("disablepictureinpicture", "");
      v.setAttribute("disableremoteplayback", "");
      v.controls = false;
      const overlay = document.createElement("div");
      overlay.style.cssText = "position:absolute;inset:0;width:100%;height:100%;background:#000;z-index:3;";
      container.appendChild(overlay);
      v.style.cssText = "position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#000;";
      container.appendChild(v);
      this.currentVideoEl = v;
      let resolved = false;
      const done = () => {
        if (!resolved) {
          resolved = true;
          resolve();
        }
      };
      v.addEventListener("loadedmetadata", () => {
        v.play().catch(() => {
        });
      }, { once: true });
      v.addEventListener("playing", () => {
        if (overlay && overlay.parentNode) overlay.remove();
        if (!isNexariAndroid) v.muted = false;
        done();
      }, { once: true });
      v.addEventListener("error", () => {
        if (signal.aborted) {
          done();
          return;
        }
        if (this.currentVideoEl !== v) {
          done();
          return;
        }
        logger.warn(`[Player] video error: ${record.url}`);
        done();
      }, { once: true });
      signal.addEventListener("abort", () => {
        this.releaseVideo();
        done();
      });
    });
  }
  /**
   * Seamless VIDEO → VIDEO swap. Appends the new <video> on top of the
   * currently playing one, waits for `canplay`, then releases the old element.
   * Prevents the WebView default "play" overlay flash that appears when we
   * pause/remove the prior video before the new one is decoded.
   */
  transitionToVideo(container, record, signal) {
    return new Promise((resolve) => {
      const url = this.resolveLocalUrl(record.url);
      if (!url) {
        resolve();
        return;
      }
      const prev = this.currentVideoEl;
      const v = document.createElement("video");
      v.src = url;
      v.autoplay = true;
      v.loop = true;
      v.playsInline = true;
      const isNexariAndroid = navigator.userAgent.includes("NexariPlayer");
      if (!isNexariAndroid) {
        v.muted = true;
        v.defaultMuted = true;
      }
      v.preload = "auto";
      v.setAttribute("disablepictureinpicture", "");
      v.setAttribute("disableremoteplayback", "");
      v.controls = false;
      const overlay = document.createElement("div");
      overlay.style.cssText = "position:absolute;inset:0;width:100%;height:100%;background:#000;z-index:3;";
      container.appendChild(overlay);
      v.style.cssText = "position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#000;";
      container.appendChild(v);
      let resolved = false;
      let swapped = false;
      const done = () => {
        if (!resolved) {
          resolved = true;
          resolve();
        }
      };
      const swap = () => {
        if (swapped) return;
        swapped = true;
        this.currentVideoEl = v;
        if (overlay && overlay.parentNode) {
          overlay.remove();
        }
        if (prev && prev !== v) {
          try {
            prev.pause();
          } catch (e) {
          }
          try {
            prev.removeAttribute("src");
            prev.src = "";
          } catch (e) {
          }
          try {
            prev.load();
          } catch (e) {
          }
          try {
            prev.remove();
          } catch (e) {
          }
        }
        if (!navigator.userAgent.includes("NexariPlayer")) {
          v.muted = false;
        }
        done();
      };
      v.addEventListener("loadedmetadata", () => {
        v.play().catch(() => {
        });
      }, { once: true });
      v.addEventListener("playing", swap, { once: true });
      v.addEventListener("error", () => {
        if (signal.aborted) {
          done();
          return;
        }
        if (this.currentVideoEl !== v && swapped) {
          done();
          return;
        }
        logger.warn(`[Player] video error: ${record.url}`);
        swap();
      }, { once: true });
      signal.addEventListener("abort", () => {
        try {
          v.pause();
        } catch (e) {
        }
        try {
          v.removeAttribute("src");
          v.src = "";
        } catch (e) {
        }
        try {
          v.load();
        } catch (e) {
        }
        try {
          v.remove();
        } catch (e) {
        }
        if (this.currentVideoEl === v) this.currentVideoEl = null;
        done();
      });
    });
  }
  renderHTML(container, record, signal) {
    return new Promise((resolve) => {
      if (!record.url) {
        resolve();
        return;
      }
      const frame = document.createElement("iframe");
      frame.src = record.url;
      frame.style.cssText = "position:absolute;inset:0;width:100%;height:100%;border:0;background:#000;";
      frame.onload = () => resolve();
      frame.onerror = () => {
        logger.warn(`[Player] iframe error: ${record.url}`);
        resolve();
      };
      container.appendChild(frame);
      signal.addEventListener("abort", () => {
        frame.src = "about:blank";
        frame.remove();
        resolve();
      });
    });
  }
  async renderCanvas(container, record, signal) {
    var _a, _b;
    const meta = parseMetadata3(record);
    const url = String((_b = (_a = meta["url"]) != null ? _a : record.url) != null ? _b : "");
    if (!url) {
      this.showIdle("Canvas: no URL");
      return;
    }
    if (/\.(mp4|webm|mov|m4v)(\?|$)/i.test(url)) {
      await this.renderVideo(container, __spreadProps(__spreadValues({}, record), { url }), signal);
    } else if (/\.(jpg|jpeg|png|gif|webp|svg)(\?|$)/i.test(url)) {
      await this.renderImage(container, __spreadProps(__spreadValues({}, record), { url }), signal);
    } else {
      await this.renderHTML(container, __spreadProps(__spreadValues({}, record), { url }), signal);
    }
  }
  renderCalendarContent(container, record) {
    this.currentHandle = renderCalendar(
      container,
      record,
      this.api,
      this.deviceId,
      this.ws,
      (contentId, handler) => {
        this.calendarPushHandlers.set(contentId, handler);
        return () => {
          this.calendarPushHandlers.delete(contentId);
        };
      }
    );
  }
  renderDataSyncContent(container, record) {
    this.currentHandle = renderDataSync(container, record.id, this.cfg.apiBase, this.deviceId);
  }
  renderLiveStream(container, record, signal) {
    return new Promise((resolve) => {
      const url = record.url || "";
      if (!url) {
        resolve();
        return;
      }
      const v = document.createElement("video");
      v.autoplay = true;
      v.muted = false;
      v.playsInline = true;
      v.style.cssText = "position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#000;";
      container.appendChild(v);
      this.currentVideoEl = v;
      if (/\.m3u8/i.test(url)) {
        const Hls = window["Hls"];
        if (Hls == null ? void 0 : Hls.isSupported()) {
          const hls = new Hls();
          hls.loadSource(url);
          hls.attachMedia(v);
          v.addEventListener("canplay", () => {
            v.play().catch(() => {
            });
            resolve();
          }, { once: true });
          signal.addEventListener("abort", () => {
            try {
              v.pause();
            } catch (e) {
            }
            v.src = "";
            v.remove();
            resolve();
          });
          return;
        }
      }
      v.src = url;
      v.addEventListener("canplay", () => {
        v.play().catch(() => {
        });
        resolve();
      }, { once: true });
      v.addEventListener("error", () => {
        logger.warn(`[Player] live stream error: ${url}`);
        resolve();
      }, { once: true });
      signal.addEventListener("abort", () => {
        try {
          v.pause();
        } catch (e) {
        }
        v.src = "";
        v.remove();
        resolve();
      });
    });
  }
  async renderPdf(container, record, signal) {
    if (!record.url) {
      this.showIdle("PDF: no URL");
      return;
    }
    try {
      await this.renderPdfWithPdfJs(container, record, signal);
    } catch (e) {
      logger.warn(`[Player] PDF render failed, falling back to iframe: ${e == null ? void 0 : e.message}`);
      await this.renderHTML(container, record, signal);
    }
  }
  /**
   * PDF.js-based renderer. Mirrors the Tizen implementation: lazy-loads
   * pdfjs/pdf.min.js (shipped in android assets via sync-player-web.cjs),
   * fetches the PDF as a Uint8Array (from local blob cache when available),
   * renders each page to a canvas and auto-advances every durMs/numPages.
   */
  async renderPdfWithPdfJs(container, record, signal) {
    const lib = await this.loadPdfJs();
    const url = this.resolveLocalUrl(record.url);
    if (!url) throw new Error("no url");
    const ab = await (await fetch(url)).arrayBuffer();
    if (signal.aborted) return;
    const pdf = await lib.getDocument({ data: new Uint8Array(ab) }).promise;
    if (signal.aborted) return;
    logger.info(`[Player] PDF loaded ${pdf.numPages} page(s)`);
    let activeCanvas = null;
    let currentRenderTask = null;
    const renderPage = async (num) => {
      if (currentRenderTask == null ? void 0 : currentRenderTask.cancel) {
        try {
          currentRenderTask.cancel();
        } catch (e) {
        }
      }
      try {
        const page = await pdf.getPage(num);
        const cw = Math.max(container.offsetWidth || window.innerWidth || 1920, 1);
        const ch = Math.max(container.offsetHeight || window.innerHeight || 1080, 1);
        const nativeVp = page.getViewport({ scale: 1 });
        const scale = Math.min(cw / nativeVp.width, ch / nativeVp.height);
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(Math.floor(viewport.width), 1);
        canvas.height = Math.max(Math.floor(viewport.height), 1);
        const ctx = canvas.getContext("2d");
        if (!ctx) return null;
        const left = Math.floor((cw - viewport.width) / 2);
        const top = Math.floor((ch - viewport.height) / 2);
        canvas.style.cssText = `position:absolute;left:${left}px;top:${top}px;background:#000;`;
        currentRenderTask = page.render({ canvasContext: ctx, viewport });
        await currentRenderTask.promise;
        currentRenderTask = null;
        return canvas;
      } catch (e) {
        const name = e == null ? void 0 : e.name;
        if (name === "RenderingCancelledException") return null;
        logger.warn(`[Player] PDF page ${num} render error: ${e == null ? void 0 : e.message}`);
        return null;
      }
    };
    const first = await renderPage(1);
    if (signal.aborted) return;
    if (first) {
      container.appendChild(first);
      activeCanvas = first;
    }
    if (pdf.numPages <= 1) return;
    const durMs = getDurationMs({ content: record, duration: void 0 });
    const perPage = Math.max(Math.floor(durMs / pdf.numPages), 4e3);
    let currentPage = 1;
    const advance = async () => {
      if (signal.aborted) return;
      currentPage = currentPage % pdf.numPages + 1;
      const next = await renderPage(currentPage);
      if (signal.aborted) {
        return;
      }
      if (next && container.isConnected) {
        if (activeCanvas && activeCanvas.parentNode === container) container.replaceChild(next, activeCanvas);
        else container.appendChild(next);
        activeCanvas = next;
      }
    };
    const interval = setInterval(() => {
      void advance();
    }, perPage);
    signal.addEventListener("abort", () => {
      clearInterval(interval);
      if (currentRenderTask == null ? void 0 : currentRenderTask.cancel) {
        try {
          currentRenderTask.cancel();
        } catch (e) {
        }
      }
    });
  }
  loadPdfJs() {
    if (this.pdfJsLibPromise) return this.pdfJsLibPromise;
    this.pdfJsLibPromise = new Promise((resolve, reject) => {
      const existing = window.pdfjsLib;
      const onReady = () => {
        const lib = window.pdfjsLib;
        if (!lib) {
          reject(new Error("pdfjsLib failed to load"));
          return;
        }
        try {
          lib.GlobalWorkerOptions.workerSrc = "pdfjs/pdf.worker.min.js";
        } catch (e) {
        }
        resolve(lib);
      };
      if (existing) {
        onReady();
        return;
      }
      const s = document.createElement("script");
      s.src = "pdfjs/pdf.min.js";
      s.onload = () => onReady();
      s.onerror = () => reject(new Error("failed to load pdfjs/pdf.min.js"));
      document.head.appendChild(s);
    });
    return this.pdfJsLibPromise;
  }
  async renderZoneLayout(container, record, signal) {
    var _a, _b, _c, _d, _e, _f, _g;
    const meta = parseMetadata3(record);
    const zones = (_a = meta["zones"]) != null ? _a : [];
    if (!zones.length) {
      this.showIdle("Zone layout: no zones");
      return;
    }
    const CANVAS_W = typeof meta["canvasWidth"] === "number" ? meta["canvasWidth"] : 1920;
    const CANVAS_H = typeof meta["canvasHeight"] === "number" ? meta["canvasHeight"] : 1080;
    logger.info(`[Zone] canvas ${CANVAS_W}\xD7${CANVAS_H}, ${zones.length} zone(s)`);
    for (const zone of zones) {
      if (signal.aborted) break;
      const r = zone.rect;
      let l, t, w, h;
      if (r) {
        l = r.x / CANVAS_W * 100;
        t = r.y / CANVAS_H * 100;
        w = r.width / CANVAS_W * 100;
        h = r.height / CANVAS_H * 100;
      } else {
        l = (_b = zone.x) != null ? _b : 0;
        t = (_c = zone.y) != null ? _c : 0;
        w = (_d = zone.width) != null ? _d : 100;
        h = (_e = zone.height) != null ? _e : 100;
      }
      const el = document.createElement("div");
      el.style.cssText = `position:absolute;left:${l.toFixed(4)}%;top:${t.toFixed(4)}%;width:${w.toFixed(4)}%;height:${h.toFixed(4)}%;overflow:hidden;background:#000;`;
      container.appendChild(el);
      const src = zone.source;
      const objectFit = zone.fitMode === "fill" ? "cover" : "contain";
      if ((src == null ? void 0 : src.type) === "content" && src.contentId) {
        const tok = this.token;
        const contentType = ((_f = src.contentType) != null ? _f : "image").toLowerCase();
        if (contentType === "html5") {
          const frame = document.createElement("iframe");
          frame.src = tok ? `${this.cfg.apiBase}/devices/device/content/${encodeURIComponent(src.contentId)}/html5/${encodeURIComponent(tok)}/` : "";
          frame.style.cssText = "width:100%;height:100%;border:0;background:#000;";
          el.appendChild(frame);
          signal.addEventListener("abort", () => {
            frame.src = "about:blank";
          });
        } else if (contentType === "video") {
          const fileUrl = `${this.cfg.apiBase}/devices/device/content/${encodeURIComponent(src.contentId)}/file${tok ? `?token=${encodeURIComponent(tok)}` : ""}`;
          const v = document.createElement("video");
          v.src = fileUrl;
          v.autoplay = true;
          v.loop = true;
          v.muted = true;
          v.playsInline = true;
          v.style.cssText = `width:100%;height:100%;object-fit:${objectFit};background:#000;`;
          el.appendChild(v);
          v.play().catch(() => {
          });
          signal.addEventListener("abort", () => {
            v.pause();
            v.src = "";
          });
        } else {
          const fileUrl = contentType === "web_url" ? (_g = src["webUrl"]) != null ? _g : "" : `${this.cfg.apiBase}/devices/device/content/${encodeURIComponent(src.contentId)}/file${tok ? `?token=${encodeURIComponent(tok)}` : ""}`;
          const img = document.createElement("img");
          img.src = fileUrl;
          img.style.cssText = `width:100%;height:100%;object-fit:${objectFit};background:#000;`;
          img.onerror = () => logger.warn(`[Zone] image load error: ${src.contentId}`);
          el.appendChild(img);
        }
      } else if (zone.url) {
        const frame = document.createElement("iframe");
        frame.src = zone.url;
        frame.style.cssText = "width:100%;height:100%;border:0;background:#000;";
        el.appendChild(frame);
        signal.addEventListener("abort", () => {
          frame.src = "about:blank";
        });
      }
    }
  }
  async initSyncGroup(msg) {
    var _a, _b, _c;
    if (this.syncActive) {
      try {
        stop();
      } catch (e) {
      }
      this.syncActive = false;
    }
    const groupId = String((_a = msg["groupId"]) != null ? _a : "");
    const expectedPeers = Number((_b = msg["expectedPeers"]) != null ? _b : 1);
    const leaderPriority = Array.isArray(msg["leaderPriority"]) ? msg["leaderPriority"] : [];
    const tok = this.token;
    const wsBase = this.cfg.apiBase.replace(/\/api\/v1\/?$/, "").replace(/^http/, "ws");
    const wsUrl = `${wsBase}/api/v1/sync-relay/ws${tok ? "?token=" + encodeURIComponent(tok) : ""}`;
    logger.info(`[Sync] relay URL: ${wsUrl}`);
    let urls = this.playlistItems.map((i) => {
      var _a2;
      return this.resolveLocalUrl((_a2 = i.content) == null ? void 0 : _a2.url) || "";
    }).filter(Boolean);
    if (!urls.length) {
      logger.info("[Player] syncGroup: no video URLs yet, deferring until download completes");
      this._pendingSyncGroupMsg = msg;
      return;
    }
    this.cancelPlayback();
    const container = this.cfg.container;
    container.innerHTML = "";
    await initEngine(container);
    setPlaylist(urls);
    const net = await this.cfg.adapter.getNetworkInfo();
    this.syncActive = true;
    init({
      wsUrl,
      groupId,
      deviceId: this.deviceId,
      selfIp: (_c = net.ipAddress) != null ? _c : "",
      expectedPeers,
      onStatus: (s) => logger.info(`[Sync] ${s}`),
      prepareEngine: (url) => prepare(url),
      schedulePlay: (epochMs) => schedulePlayAt(epochMs),
      getEngineDuration: () => getDuration(),
      restartEngine: () => {
        try {
          destroyEngine();
        } catch (e) {
        }
        void initEngine(container).then(() => setPlaylist(urls));
      }
    }).catch((e) => {
      logger.error(`[Sync] init failed: ${e == null ? void 0 : e.message}`);
      this.syncActive = false;
    });
  }
  async initVideoWall(msg) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l, _m, _n, _o, _p, _q;
    let srcX = 0, srcY = 0, srcW = window.innerWidth, srcH = window.innerHeight;
    let dstW = window.innerWidth, dstH = window.innerHeight;
    const geo = msg["geometry"];
    const myCell = msg["myCell"];
    if (geo && myCell) {
      const colWidths = (_a = geo["colWidths"]) != null ? _a : [];
      const rowHeights = (_b = geo["rowHeights"]) != null ? _b : [];
      const col = Number((_c = myCell["positionCol"]) != null ? _c : 0);
      const row = Number((_d = myCell["positionRow"]) != null ? _d : 0);
      const colSpan = Number((_e = myCell["colSpan"]) != null ? _e : 1);
      const rowSpan = Number((_f = myCell["rowSpan"]) != null ? _f : 1);
      let offsetX = 0;
      for (let c = 0; c < col; c++) offsetX += colWidths[c] || 0;
      let offsetY = 0;
      for (let r = 0; r < row; r++) offsetY += rowHeights[r] || 0;
      let cellW = 0;
      for (let c = col; c < col + colSpan; c++) cellW += colWidths[c] || 0;
      let cellH = 0;
      for (let r = row; r < row + rowSpan; r++) cellH += rowHeights[r] || 0;
      srcX = offsetX;
      srcY = offsetY;
      srcW = cellW;
      srcH = cellH;
      dstW = Number((_g = geo["canvasW"]) != null ? _g : window.innerWidth);
      dstH = Number((_h = geo["canvasH"]) != null ? _h : window.innerHeight);
    } else {
      srcX = Number((_i = msg["srcX"]) != null ? _i : 0);
      srcY = Number((_j = msg["srcY"]) != null ? _j : 0);
      srcW = Number((_k = msg["srcW"]) != null ? _k : window.innerWidth);
      srcH = Number((_l = msg["srcH"]) != null ? _l : window.innerHeight);
      dstW = Number((_m = msg["dstW"]) != null ? _m : window.innerWidth);
      dstH = Number((_n = msg["dstH"]) != null ? _n : window.innerHeight);
    }
    setWallCrop(srcX, srcY, srcW, srcH, dstW, dstH);
    logger.info(`[Player] videowall crop srcX=${srcX} srcY=${srcY} srcW=${srcW} srcH=${srcH} canvas ${dstW}x${dstH}`);
    if (this.syncActive) {
      try {
        stop();
      } catch (e) {
      }
      this.syncActive = false;
    }
    const leaderPriority = Array.isArray(msg["leaderPriority"]) ? msg["leaderPriority"] : [];
    const tok2 = this.token;
    const wsBase2 = this.cfg.apiBase.replace(/\/api\/v1\/?$/, "").replace(/^http/, "ws");
    const wsUrl = `${wsBase2}/api/v1/sync-relay${tok2 ? "?token=" + encodeURIComponent(tok2) : ""}`;
    const groupId = String((_p = (_o = msg["deviceGroupId"]) != null ? _o : msg["groupId"]) != null ? _p : "");
    const peers = Array.isArray(msg["peers"]) ? msg["peers"] : [];
    const expectedPeers = peers.length - 1 || 1;
    const urls = this.playlistItems.map((i) => {
      var _a2;
      return this.resolveLocalUrl((_a2 = i.content) == null ? void 0 : _a2.url) || "";
    }).filter(Boolean);
    if (!urls.length) {
      logger.warn("[Player] videowall: no video URLs");
      return;
    }
    this.cancelPlayback();
    const container = this.cfg.container;
    container.innerHTML = "";
    await initEngine(container);
    setPlaylist(urls);
    const net = await this.cfg.adapter.getNetworkInfo();
    this.syncActive = true;
    init({
      wsUrl,
      groupId,
      deviceId: this.deviceId,
      selfIp: (_q = net.ipAddress) != null ? _q : "",
      expectedPeers,
      onStatus: (s) => logger.info(`[Sync/Wall] ${s}`),
      prepareEngine: (url) => prepare(url),
      schedulePlay: (epochMs) => schedulePlayAt(epochMs),
      getEngineDuration: () => getDuration(),
      restartEngine: () => {
        try {
          destroyEngine();
        } catch (e) {
        }
        void initEngine(container).then(() => setPlaylist(urls));
      }
    }).catch((e) => {
      logger.error(`[Sync/Wall] init: ${e == null ? void 0 : e.message}`);
      this.syncActive = false;
    });
  }
  sendOta(p) {
    this.send({ type: p.kind, version: p.version, packageId: p.packageId, pct: p.pct, error: p.error });
  }
  showIdle(msg, downloadProgress) {
    const progressBar = downloadProgress !== void 0 && downloadProgress >= 0 && downloadProgress < 100 ? `<div style="width:200px;height:8px;background:rgba(255,255,255,.15);border-radius:4px;margin:20px auto;overflow:hidden;">
           <div class="nexari-download-bar" style="width:${downloadProgress}%;height:100%;background:linear-gradient(90deg,#3a7bff,#4ff2d1);transition:width .3s;"></div>
         </div>` : "";
    const deviceLabel = escapeHtml3(this.deviceDisplayName);
    this.cfg.container.innerHTML = `
      <div style="position:absolute;inset:0;background:#0d0f1a;display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:system-ui,sans-serif;">
        <!-- bg grid -->
        <div style="position:absolute;inset:0;background-image:linear-gradient(rgba(255,255,255,.03) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.03) 1px,transparent 1px);background-size:40px 40px;pointer-events:none;"></div>

        <!-- card -->
        <div style="position:relative;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:24px;padding:48px 64px;text-align:center;min-width:340px;">

          <!-- Nexari logo -->
          <div style="display:flex;align-items:center;justify-content:center;gap:16px;margin-bottom:${deviceLabel ? "8px" : "24px"};">
            <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" style="width:48px;height:48px;" aria-hidden="true">
              <defs>
                <linearGradient id="ng" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
                  <stop offset="0%" stop-color="#3a7bff"/>
                  <stop offset="100%" stop-color="#4ff2d1"/>
                </linearGradient>
              </defs>
              <rect x="4" y="4" width="56" height="56" rx="14" stroke="url(#ng)" stroke-width="2.5"/>
              <path d="M20 44 V20 L44 44 V20" stroke="url(#ng)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <div style="font-size:28px;font-weight:700;letter-spacing:.2em;background:linear-gradient(90deg,#3a7bff,#4ff2d1);-webkit-background-clip:text;-webkit-text-fill-color:transparent;">NEXARI</div>
          </div>

          ${deviceLabel ? `<div style="font-size:13px;color:#666;margin-bottom:20px;">${deviceLabel}</div>` : ""}

          <div style="height:1px;background:rgba(255,255,255,.08);margin:0 0 20px;"></div>

          <!-- status row -->
          <div style="display:flex;align-items:center;justify-content:center;gap:8px;">
            <span style="width:8px;height:8px;border-radius:50%;background:#3a7bff;box-shadow:0 0 8px #3a7bff;animation:nexariPulse 2s ease-in-out infinite;display:inline-block;"></span>
            <span class="nexari-idle-status" style="font-size:15px;color:#888;">${escapeHtml3(msg)}</span>
          </div>
          ${progressBar}
        </div>

        <div style="position:absolute;bottom:24px;font-size:12px;color:#333;letter-spacing:.05em;">Signage Player &middot; Standby</div>
      </div>
      <style>
        @keyframes nexariPulse {
          0%,100% { opacity:1; box-shadow:0 0 8px #3a7bff; }
          50%      { opacity:.4; box-shadow:0 0 3px #3a7bff; }
        }
      </style>`;
  }
};

// src/renderers/index.ts
var VideoRenderer = class {
  constructor() {
    this.type = "VIDEO";
    this.el = null;
  }
  async mount(container, item) {
    if (!item.url) throw new Error("VideoRenderer: item.url required");
    const v = document.createElement("video");
    v.src = item.url;
    v.autoplay = true;
    v.loop = true;
    v.muted = false;
    v.playsInline = true;
    v.style.cssText = "position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#000;";
    container.appendChild(v);
    this.el = v;
    await new Promise((resolve, reject) => {
      v.addEventListener("canplay", () => resolve(), { once: true });
      v.addEventListener("error", () => reject(new Error("video load error")), {
        once: true
      });
    });
    try {
      await v.play();
    } catch (e) {
      logger.warn(`[VideoRenderer] autoplay blocked: ${e.message}`);
    }
  }
  pause() {
    var _a;
    (_a = this.el) == null ? void 0 : _a.pause();
  }
  destroy() {
    if (this.el) {
      try {
        this.el.pause();
      } catch (e) {
      }
      this.el.remove();
      this.el = null;
    }
  }
};
var ImageRenderer = class {
  constructor() {
    this.type = "IMAGE";
    this.el = null;
  }
  async mount(container, item) {
    if (!item.url) throw new Error("ImageRenderer: item.url required");
    const img = document.createElement("img");
    img.src = item.url;
    img.style.cssText = "position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#000;";
    container.appendChild(img);
    this.el = img;
    await new Promise((resolve, reject) => {
      img.addEventListener("load", () => resolve(), { once: true });
      img.addEventListener("error", () => reject(new Error("image load error")), {
        once: true
      });
    });
  }
  pause() {
  }
  destroy() {
    var _a;
    (_a = this.el) == null ? void 0 : _a.remove();
    this.el = null;
  }
};
var HtmlRenderer = class {
  constructor() {
    this.type = "HTML";
    this.el = null;
  }
  async mount(container, item) {
    if (!item.url) throw new Error("HtmlRenderer: item.url required");
    const f = document.createElement("iframe");
    f.src = item.url;
    f.setAttribute(
      "sandbox",
      "allow-scripts allow-same-origin allow-forms allow-popups"
    );
    f.style.cssText = "position:absolute;inset:0;width:100%;height:100%;border:0;background:#000;";
    container.appendChild(f);
    this.el = f;
    await new Promise((resolve) => {
      f.addEventListener("load", () => resolve(), { once: true });
    });
  }
  pause() {
  }
  destroy() {
    var _a;
    (_a = this.el) == null ? void 0 : _a.remove();
    this.el = null;
  }
};
var CanvasRenderer = class {
  constructor() {
    this.type = "CANVAS";
  }
  async mount(container, _item) {
    logger.warn("[CanvasRenderer] not yet ported \u2014 see player-web/README.md");
    const div = document.createElement("div");
    div.textContent = "CANVAS renderer not yet ported";
    div.style.cssText = "position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#888;font:14px monospace;";
    container.appendChild(div);
  }
  pause() {
  }
  destroy() {
  }
};
var contentRenderers = {
  VIDEO: () => new VideoRenderer(),
  IMAGE: () => new ImageRenderer(),
  HTML: () => new HtmlRenderer(),
  CANVAS: () => new CanvasRenderer()
};
export {
  Player,
  contentRenderers
};
