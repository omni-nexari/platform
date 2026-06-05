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
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/logger.ts
var MAX_BUF = 2e3;
var ringBuffer = [];
var MAX_TAIL = 400;
var tailBuffer = [];
function appendBuf(level, message) {
  if (ringBuffer.length >= MAX_BUF) ringBuffer.shift();
  const entry = { level, message, timestamp: (/* @__PURE__ */ new Date()).toISOString() };
  ringBuffer.push(entry);
  if (tailBuffer.length >= MAX_TAIL) tailBuffer.shift();
  tailBuffer.push(entry);
}
window["LogBuffer"] = {
  drain(n) {
    const take = Math.min(n, ringBuffer.length);
    return take > 0 ? ringBuffer.splice(0, take) : [];
  },
  /** Returns the last `n` entries without consuming them — for in-app log viewers. */
  tail(n) {
    const take = Math.min(n, tailBuffer.length);
    return take > 0 ? tailBuffer.slice(tailBuffer.length - take) : [];
  },
  clear() {
    tailBuffer.length = 0;
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
    var _a, _b, _c, _d, _e, _f;
    const t = this.token();
    const [schedRes, wsRes] = await Promise.all([
      fetch(`${this.base}/devices/device/schedule${t ? `?token=${encodeURIComponent(t)}` : ""}`),
      fetch(`${this.base}/devices/device/workspace${t ? `?token=${encodeURIComponent(t)}` : ""}`).catch(() => null)
    ]);
    if (schedRes.status === 404) return null;
    if (!schedRes.ok) throw Object.assign(new Error(`schedule HTTP ${schedRes.status}`), { status: schedRes.status });
    const wsBody = (wsRes == null ? void 0 : wsRes.ok) ? await wsRes.json().catch(() => null) : null;
    const resellerBranding = (_a = wsBody == null ? void 0 : wsBody["resellerBranding"]) != null ? _a : null;
    const publishedSyncGroup = wsBody == null ? void 0 : wsBody["publishedSyncGroup"];
    if (publishedSyncGroup) {
      const sg = publishedSyncGroup;
      const sp = sg["syncPlaylist"];
      const spItems = (_b = sp == null ? void 0 : sp["items"]) != null ? _b : [];
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
            playlistName: (_c = sp["name"]) != null ? _c : "Sync Playlist",
            items: items2,
            syncGroupId: sg["id"],
            allTizen: !!sg["allTizen"],
            relayUrl: (_d = sg["relayUrl"]) != null ? _d : null,
            peers: (_e = sg["peers"]) != null ? _e : [],
            resellerBranding
          };
        }
      }
    }
    const body = await schedRes.json();
    if (!Array.isArray(body.schedules) || !body.schedules.length) return null;
    const raw = body.schedules[0];
    const slots = (_f = raw.slots) != null ? _f : [];
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
    return __spreadProps(__spreadValues({}, raw), { items, resellerBranding });
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
    } else if (type === "html") {
      const rawUrl = content["url"];
      url = rawUrl && /^https?:\/\//i.test(rawUrl) ? rawUrl : `${this.base}/devices/device/content/${id}/file${token ? `?token=${encodeURIComponent(token)}` : ""}`;
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
var VALID_LAYOUTS = ["1-col", "2-col", "3-col", "featured", "hero-banner", "magazine", "grid-cards", "split"];
var FONT_STACKS = {
  system: "-apple-system,'Segoe UI',Roboto,sans-serif",
  serif: "'Playfair Display',Georgia,'Times New Roman',serif",
  rounded: "'Nunito','Quicksand',system-ui,sans-serif",
  condensed: "'Oswald','Bebas Neue','Arial Narrow',sans-serif",
  mono: "'JetBrains Mono',ui-monospace,'Courier New',monospace"
};
function shardSections(sections, screenCount, screenIndex, strategy) {
  if (screenCount <= 1) return sections;
  const idx = Math.max(0, Math.min(screenCount - 1, screenIndex));
  if (strategy === "by-category") {
    return sections.filter((_, i) => i % screenCount === idx);
  }
  const allItems = [];
  for (const cat of sections) for (const item of cat.items) allItems.push({ item, cat });
  let slotItems;
  if (strategy === "by-item-roundrobin") {
    slotItems = allItems.filter((_, i) => i % screenCount === idx);
  } else {
    const blockSize = Math.ceil(allItems.length / screenCount);
    const start = idx * blockSize;
    slotItems = allItems.slice(start, start + blockSize);
  }
  const catMap = /* @__PURE__ */ new Map();
  for (const { item, cat } of slotItems) {
    if (!catMap.has(cat.id)) catMap.set(cat.id, __spreadProps(__spreadValues({}, cat), { items: [] }));
    catMap.get(cat.id).items.push(item);
  }
  return sections.map((c) => catMap.get(c.id)).filter(Boolean);
}
function paginateSections(sections, itemsPerPage) {
  const pages = [];
  let current = [];
  let count = 0;
  for (const cat of sections) {
    if (cat.items.length === 0) continue;
    if (count > 0 && count + cat.items.length > itemsPerPage) {
      pages.push(current);
      current = [];
      count = 0;
    }
    if (cat.items.length > itemsPerPage) {
      if (current.length > 0) {
        pages.push(current);
        current = [];
        count = 0;
      }
      for (let i = 0; i < cat.items.length; i += itemsPerPage) {
        pages.push([__spreadProps(__spreadValues({}, cat), { items: cat.items.slice(i, i + itemsPerPage) })]);
      }
    } else {
      current.push(cat);
      count += cat.items.length;
    }
  }
  if (current.length > 0) pages.push(current);
  return pages.length > 0 ? pages : [sections];
}
function resolveScreenIndex(meta, deviceDisplayIndex) {
  if (Number.isFinite(meta["_playlistScreenIndex"])) return Number(meta["_playlistScreenIndex"]);
  if (Number.isFinite(meta["screenIndex"])) return Number(meta["screenIndex"]);
  if (Number.isFinite(deviceDisplayIndex)) return Number(deviceDisplayIndex);
  return 0;
}
function buildMenuBoardHtml(content, menu, metadata, deviceDisplayIndex) {
  const layout = VALID_LAYOUTS.includes(metadata["layout"]) ? String(metadata["layout"]) : "2-col";
  const showPrices = metadata["showPrices"] !== false;
  const showImages = metadata["showImages"] !== false;
  const showDesc = metadata["showDescription"] === true;
  const showHeader = metadata["showHeader"] !== false;
  const fontScaleRaw = Number(metadata["fontScale"]);
  const fontScale = isFinite(fontScaleRaw) ? Math.min(Math.max(fontScaleRaw, 0.7), 1.6) : 1;
  const accentColor = sanitizeColor(metadata["accentColor"], "#dd6b20");
  const backgroundColor = sanitizeColor(metadata["backgroundColor"], "#0f1117");
  const textColor = sanitizeColor(metadata["textColor"], "#f7f2eb");
  const backgroundImage = typeof metadata["backgroundImage"] === "string" && /^https?:|^data:/.test(metadata["backgroundImage"]) ? metadata["backgroundImage"] : null;
  const backgroundVideoUrl = typeof metadata["backgroundVideoUrl"] === "string" && /^https?:/.test(metadata["backgroundVideoUrl"]) ? metadata["backgroundVideoUrl"] : null;
  const heroImageUrl = typeof metadata["heroImageUrl"] === "string" && /^https?:|^data:/.test(metadata["heroImageUrl"]) ? metadata["heroImageUrl"] : null;
  const fontFamily = FONT_STACKS[metadata["fontFamily"]] || FONT_STACKS["system"];
  const catHeadStyle = ["block", "underline", "bar", "pill"].includes(metadata["categoryHeaderStyle"]) ? String(metadata["categoryHeaderStyle"]) : "block";
  const eyebrow = typeof metadata["eyebrow"] === "string" ? metadata["eyebrow"] : "Live POS Menu";
  const titleOverride = typeof metadata["titleOverride"] === "string" && metadata["titleOverride"].trim() ? metadata["titleOverride"].trim() : null;
  const currency = typeof menu.currency === "string" ? menu.currency : "USD";
  const screenCount = Number.isFinite(metadata["screenCount"]) ? Math.max(1, Number(metadata["screenCount"])) : 1;
  const splitStrategy = typeof metadata["splitStrategy"] === "string" ? metadata["splitStrategy"] : "by-category";
  const screenIndex = resolveScreenIndex(metadata, deviceDisplayIndex);
  const rawSections = getSections(menu, metadata);
  const sections = shardSections(rawSections, screenCount, screenIndex, splitStrategy);
  if (!sections.length) {
    return buildStateHtml(content.name || "Menu Board", "No active POS menu items available for this board right now.");
  }
  const pagMeta = metadata["pagination"] && typeof metadata["pagination"] === "object" ? metadata["pagination"] : {};
  const pagMode = String(pagMeta["mode"] || "hybrid");
  const itemsPerPage = pagMode !== "auto-fit" ? Math.max(1, Number.isFinite(pagMeta["itemsPerPage"]) ? Number(pagMeta["itemsPerPage"]) : 8) : 9999;
  const pageSeconds = Math.max(2, Number.isFinite(pagMeta["pageSeconds"]) ? Number(pagMeta["pageSeconds"]) : 10);
  const pages = paginateSections(sections, itemsPerPage);
  const isFeatured = layout === "featured" || layout === "hero-banner" || layout === "magazine";
  function buildPageHtml(pageSections) {
    var _a, _b, _c;
    let featuredItem = null;
    if (isFeatured) {
      if (heroImageUrl) {
        const anyItem = (_b = (_a = pageSections[0]) == null ? void 0 : _a.items[0]) != null ? _b : null;
        if (anyItem) featuredItem = __spreadProps(__spreadValues({}, anyItem), { imageUrl: heroImageUrl });
      } else {
        for (const cat of pageSections) {
          featuredItem = showImages && cat.items.find((i) => !!i.imageUrl) || cat.items[0] || null;
          if (featuredItem) break;
        }
      }
    }
    const boardTitle = titleOverride || content.name || ((_c = menu.name) != null ? _c : "Menu Board");
    const subtitleParts = [];
    if (menu.name && menu.name !== boardTitle) subtitleParts.push(menu.name);
    if (menu.description) subtitleParts.push(menu.description);
    subtitleParts.push(`${pageSections.length} ${pageSections.length === 1 ? "category" : "categories"}`);
    const subtitle = subtitleParts.join(" | ");
    const sectionCols = layout === "1-col" ? 1 : layout === "3-col" || layout === "grid-cards" ? Math.min(3, pageSections.length || 1) : Math.min(2, pageSections.length || 1);
    const featuredKicker = layout === "hero-banner" ? "Today's Special" : layout === "magazine" ? "Editor's Pick" : "Featured Item";
    const featuredMarkup = isFeatured && featuredItem ? `
      <aside class="menu-board-feature">
        ${(showImages || heroImageUrl) && featuredItem.imageUrl ? `<div class="menu-board-feature-image"><img src="${escapeHtml2(featuredItem.imageUrl)}" alt="${escapeHtml2(featuredItem.name)}" /></div>` : ""}
        <div class="menu-board-feature-copy">
          <div class="menu-board-feature-kicker">${escapeHtml2(featuredKicker)}</div>
          <div class="menu-board-feature-title">${escapeHtml2(featuredItem.name)}</div>
          ${showPrices ? `<div class="menu-board-feature-price">${escapeHtml2(formatPrice(featuredItem.priceCents, currency))}</div>` : ""}
          ${showDesc && featuredItem.description ? `<div class="menu-board-feature-description">${escapeHtml2(featuredItem.description)}</div>` : ""}
        </div>
      </aside>` : "";
    const sectionsMarkup = pageSections.map((cat) => {
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
    const bgCss2 = backgroundImage ? `linear-gradient(rgba(0,0,0,0.45),rgba(0,0,0,0.45)),url("${escapeHtml2(backgroundImage)}") center/cover no-repeat,${backgroundColor}` : backgroundColor;
    const gridClass = `menu-board-grid layout-${layout} cathead-${catHeadStyle}${isFeatured ? " is-featured" : ""}`;
    return `
      <div class="menu-board-shell">
        ${showHeader ? `<header class="menu-board-header">
          <div>
            ${eyebrow ? `<div class="menu-board-eyebrow">${escapeHtml2(eyebrow)}</div>` : ""}
            <h1 class="menu-board-title">${escapeHtml2(boardTitle)}</h1>
          </div>
        </header>` : ""}
        <div class="${gridClass}">
          ${featuredMarkup}
          <div class="menu-board-sections">${sectionsMarkup}</div>
        </div>
      </div>`;
  }
  const pageHtmls = pages.map((pg, i) => `<div class="mb-page" data-page="${i}" style="display:${i === 0 ? "flex" : "none"};flex-direction:column;width:100%;height:100%;position:absolute;inset:0;">${buildPageHtml(pg)}</div>`).join("");
  const bgCss = backgroundImage ? `linear-gradient(rgba(0,0,0,0.45),rgba(0,0,0,0.45)),url("${escapeHtml2(backgroundImage)}") center/cover no-repeat,${backgroundColor}` : backgroundColor;
  const paginationScript = pages.length > 1 ? `
    <script>(function(){
      var pages=document.querySelectorAll('.mb-page');
      var cur=0;
      setInterval(function(){
        pages[cur].style.display='none';
        cur=(cur+1)%pages.length;
        pages[cur].style.display='flex';
        var ind=document.getElementById('mb-page-ind');
        if(ind)ind.textContent=(cur+1)+'/${pages.length}';
      },${pageSeconds * 1e3});
    })();<\/script>` : "";
  const pageIndicator = pages.length > 1 ? `<div id="mb-page-ind" style="position:absolute;bottom:12px;right:16px;font-size:12px;opacity:0.55;color:${textColor};z-index:20;">1/${pages.length}</div>` : "";
  return `
    <div class="menu-board-root">
      <style>
        .menu-board-root,.menu-board-root *{box-sizing:border-box;}
        .menu-board-root{--menu-board-accent:${accentColor};--menu-board-scale:${fontScale};width:100%;height:100%;color:${textColor};font-family:${fontFamily};background:${bgCss};position:relative;overflow:hidden;}
        ${backgroundVideoUrl ? `.menu-board-bgvideo{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:0;opacity:0.55;}` : ""}
        .menu-board-shell{width:100%;height:100%;display:flex;flex-direction:column;gap:calc(18px*var(--menu-board-scale));padding:calc(28px*var(--menu-board-scale));overflow:hidden;position:relative;z-index:1;}
        .menu-board-header{display:flex;align-items:flex-end;justify-content:space-between;gap:18px;}
        .menu-board-eyebrow{font-size:calc(12px*var(--menu-board-scale));font-weight:700;letter-spacing:0.16em;text-transform:uppercase;color:var(--menu-board-accent);}
        .menu-board-title{margin:6px 0 0;font-size:calc(34px*var(--menu-board-scale));line-height:1.05;letter-spacing:-0.03em;}
        .menu-board-grid{flex:1;min-height:0;display:grid;grid-template-columns:1fr;gap:calc(18px*var(--menu-board-scale));}
        .menu-board-grid.is-featured{grid-template-columns:minmax(320px,0.95fr) minmax(0,1.75fr);}
        .menu-board-grid.layout-hero-banner{grid-template-columns:1fr;grid-auto-rows:auto 1fr;}
        .menu-board-grid.layout-hero-banner .menu-board-feature{grid-column:1/-1;display:grid;grid-template-columns:1.2fr 1fr;}
        .menu-board-grid.layout-split{grid-template-columns:1fr 1fr;}
        .menu-board-grid.layout-split .menu-board-sections{grid-template-columns:1fr;}
        .menu-board-grid.layout-grid-cards .menu-board-item.has-image .menu-board-item-image{aspect-ratio:4/3;width:100%;height:auto;}
        .menu-board-feature{min-height:0;border:1px solid rgba(255,255,255,0.1);border-radius:26px;overflow:hidden;background:linear-gradient(180deg,rgba(255,255,255,0.08) 0%,rgba(255,255,255,0.03) 100%);display:flex;flex-direction:column;}
        .menu-board-feature-image{height:48%;min-height:210px;background:rgba(255,255,255,0.04);}
        .menu-board-feature-image img{width:100%;height:100%;display:block;object-fit:cover;}
        .menu-board-feature-copy{padding:calc(22px*var(--menu-board-scale));display:flex;flex-direction:column;gap:10px;}
        .menu-board-feature-kicker{font-size:calc(11px*var(--menu-board-scale));letter-spacing:0.16em;text-transform:uppercase;color:var(--menu-board-accent);font-weight:700;}
        .menu-board-feature-title{font-size:calc(30px*var(--menu-board-scale));line-height:1.05;font-weight:800;}
        .menu-board-feature-price{font-size:calc(22px*var(--menu-board-scale));font-weight:700;color:#fff4cf;}
        .menu-board-feature-description{font-size:calc(15px*var(--menu-board-scale));line-height:1.55;color:rgba(247,242,235,0.8);}
        .menu-board-sections{min-height:0;display:grid;align-content:start;gap:calc(16px*var(--menu-board-scale));overflow:hidden;}
        .menu-board-category{min-height:0;display:flex;flex-direction:column;gap:calc(14px*var(--menu-board-scale));padding:calc(18px*var(--menu-board-scale));border-radius:24px;border:1px solid rgba(255,255,255,0.09);background:linear-gradient(180deg,rgba(255,255,255,0.08) 0%,rgba(255,255,255,0.035) 100%);box-shadow:inset 4px 0 0 var(--menu-board-category-accent);}
        .cathead-underline .menu-board-category{background:transparent;box-shadow:none;border-color:transparent;border-bottom:2px solid var(--menu-board-category-accent);border-radius:0;}
        .cathead-bar .menu-board-category{box-shadow:inset 0 6px 0 var(--menu-board-category-accent);padding-top:calc(20px*var(--menu-board-scale));}
        .cathead-pill .menu-board-category{background:transparent;box-shadow:none;}
        .cathead-pill .menu-board-category-title{display:inline-block;padding:4px 14px;border-radius:999px;background:var(--menu-board-category-accent);color:#0f1117;}
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
        .mb-page{flex-direction:column;}
      </style>
      ${backgroundVideoUrl ? `<video class="menu-board-bgvideo" src="${escapeHtml2(backgroundVideoUrl)}" autoplay muted loop playsinline></video>` : ""}
      ${pageHtmls}
      ${pageIndicator}
      ${paginationScript}
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
var _wallTransform = null;
var _wallOuter = null;
var _wallInner = null;
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
function setWallTransform(t) {
  _wallTransform = t;
  _log(`[Engine] wall transform set canvas=${t.canvasW}\xD7${t.canvasH} tx=${t.translateX} ty=${t.translateY} scaleX=${t.scaleX} scaleY=${t.scaleY} rot=${t.rotation}`);
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
var _playLatencyMs = null;
async function measurePlayLatencyMs(url) {
  if (_playLatencyMs !== null) return _playLatencyMs;
  const src = url != null ? url : _playlist[0];
  if (!src) {
    _playLatencyMs = 100;
    return 100;
  }
  return new Promise((resolve) => {
    const v = document.createElement("video");
    v.muted = true;
    v.preload = "auto";
    v.src = src;
    v.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none;";
    document.body.appendChild(v);
    const done = (ms) => {
      clearTimeout(timer);
      try {
        v.pause();
        v.src = "";
        if (v.parentNode) v.parentNode.removeChild(v);
      } catch (e) {
      }
      _playLatencyMs = Math.max(10, ms);
      _log("[Engine] play-latency probe: " + _playLatencyMs + "ms");
      resolve(_playLatencyMs);
    };
    const timer = setTimeout(() => done(150), 2e3);
    v.addEventListener("canplaythrough", () => {
      const t0 = performance.now();
      if (typeof v.requestVideoFrameCallback === "function") {
        v.requestVideoFrameCallback(() => done(Math.round(performance.now() - t0)));
      } else {
        v.addEventListener("timeupdate", () => done(Math.round(performance.now() - t0)), { once: true });
      }
      v.play().catch(() => {
      });
    }, { once: true });
    v.load();
  });
}
function initEngine(container) {
  if (_videos.length) return Promise.resolve();
  _container = container;
  for (let i = 0; i < 2; i++) {
    const v = document.createElement("video");
    v.id = "nexari-player-" + (i === 0 ? "A" : "B");
    v.playsInline = true;
    v.autoplay = false;
    v.muted = false;
    v.loop = false;
    v.preload = "auto";
    _videos.push(v);
  }
  if (_wallTransform) {
    const t = _wallTransform;
    _wallOuter = document.createElement("div");
    _wallOuter.style.cssText = `position:absolute;top:0;left:0;width:${t.canvasW}px;height:${t.canvasH}px;overflow:hidden;background:#000;`;
    _wallInner = document.createElement("div");
    _wallInner.style.cssText = `position:absolute;top:0;left:0;width:100%;height:100%;transform:rotate(${t.rotation}deg) scale(${t.scaleX},${t.scaleY});transform-origin:center;`;
    _wallOuter.appendChild(_wallInner);
    container.appendChild(_wallOuter);
    for (let i = 0; i < _videos.length; i++) {
      const v = _videos[i];
      v.style.cssText = `position:absolute;top:0;left:0;width:${t.canvasW}px;height:${t.canvasH}px;transform:translate(${t.translateX}px,${t.translateY}px);transform-origin:0 0;object-fit:fill;`;
      v.style.opacity = i === _fg ? "1" : "0";
      _wallInner.appendChild(v);
    }
    _log(`[Engine] initialised (CSS wall mode, canvas=${t.canvasW}\xD7${t.canvasH})`);
  } else {
    for (let i = 0; i < _videos.length; i++) {
      const v = _videos[i];
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
  if (_wallOuter && _wallOuter.parentNode) _wallOuter.parentNode.removeChild(_wallOuter);
  _wallOuter = null;
  _wallInner = null;
  _durationMs = 0;
  _prebuffered = false;
  _looping = false;
  _firstPlay = true;
  _fg = 0;
  _idx = 0;
  _playLatencyMs = null;
}
function _log(msg) {
  logger.info(msg);
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
  if (!_wallTransform) {
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
      _startEosWatch();
    }).catch((e) => _log("[Engine] play() failed: " + e));
    return;
  }
  const bgV = _videos[1 - _fg];
  if (_playlist.length <= 1 || !bgV.src) {
    const fgV = _videos[_fg];
    _prebuffered = false;
    _looping = false;
    _log("[Engine] single-item loop \u2014 rewinding fg(" + _fgLabel() + ")");
    const doPlay = () => {
      fgV.play().then(() => {
        _durationMs = Math.round((fgV.duration || 0) * 1e3);
        _startEosWatch();
      }).catch((e) => _log("[Engine] rewind-play failed: " + e));
    };
    if (fgV.currentTime > 0.05) {
      let done = false;
      const onSeeked = () => {
        if (!done) {
          done = true;
          doPlay();
        }
      };
      fgV.addEventListener("seeked", onSeeked, { once: true });
      try {
        fgV.currentTime = 0;
      } catch (e) {
        onSeeked();
        return;
      }
      setTimeout(() => {
        fgV.removeEventListener("seeked", onSeeked);
        if (!done) {
          done = true;
          doPlay();
        }
      }, 1e3);
    } else {
      doPlay();
    }
    return;
  }
  const oldFg = _fg;
  const newFg = 1 - _fg;
  const oldV = _videos[oldFg];
  const newV = _videos[newFg];
  newV.play().then(() => {
    _log("[Engine] swap: now playing fg(" + (newFg === 0 ? "A" : "B") + ")");
    newV.style.opacity = "1";
    oldV.style.opacity = "0";
    if (!_wallTransform) {
      newV.style.zIndex = "2";
      oldV.style.zIndex = "1";
    }
    try {
      oldV.pause();
    } catch (e) {
    }
    _fg = newFg;
    _idx = (_idx + 1) % _playlist.length;
    _durationMs = Math.round((newV.duration || 0) * 1e3);
    _prebuffered = false;
    _looping = false;
    _startEosWatch();
    _preloadNext().catch((e) => _log("[Engine] preload-after-swap failed: " + e));
  }).catch((e) => {
    _log("[Engine] swap play() failed: " + e);
    oldV.style.opacity = "1";
    newV.style.opacity = "0";
    if (!_wallTransform) {
      oldV.style.zIndex = "2";
      newV.style.zIndex = "1";
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
  _rewindFgAndArm().then(() => {
    _preloadNext().catch(() => {
    });
  });
}

// ../../node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/external.js
var external_exports = {};
__export(external_exports, {
  BRAND: () => BRAND,
  DIRTY: () => DIRTY,
  EMPTY_PATH: () => EMPTY_PATH,
  INVALID: () => INVALID,
  NEVER: () => NEVER,
  OK: () => OK,
  ParseStatus: () => ParseStatus,
  Schema: () => ZodType,
  ZodAny: () => ZodAny,
  ZodArray: () => ZodArray,
  ZodBigInt: () => ZodBigInt,
  ZodBoolean: () => ZodBoolean,
  ZodBranded: () => ZodBranded,
  ZodCatch: () => ZodCatch,
  ZodDate: () => ZodDate,
  ZodDefault: () => ZodDefault,
  ZodDiscriminatedUnion: () => ZodDiscriminatedUnion,
  ZodEffects: () => ZodEffects,
  ZodEnum: () => ZodEnum,
  ZodError: () => ZodError,
  ZodFirstPartyTypeKind: () => ZodFirstPartyTypeKind,
  ZodFunction: () => ZodFunction,
  ZodIntersection: () => ZodIntersection,
  ZodIssueCode: () => ZodIssueCode,
  ZodLazy: () => ZodLazy,
  ZodLiteral: () => ZodLiteral,
  ZodMap: () => ZodMap,
  ZodNaN: () => ZodNaN,
  ZodNativeEnum: () => ZodNativeEnum,
  ZodNever: () => ZodNever,
  ZodNull: () => ZodNull,
  ZodNullable: () => ZodNullable,
  ZodNumber: () => ZodNumber,
  ZodObject: () => ZodObject,
  ZodOptional: () => ZodOptional,
  ZodParsedType: () => ZodParsedType,
  ZodPipeline: () => ZodPipeline,
  ZodPromise: () => ZodPromise,
  ZodReadonly: () => ZodReadonly,
  ZodRecord: () => ZodRecord,
  ZodSchema: () => ZodType,
  ZodSet: () => ZodSet,
  ZodString: () => ZodString,
  ZodSymbol: () => ZodSymbol,
  ZodTransformer: () => ZodEffects,
  ZodTuple: () => ZodTuple,
  ZodType: () => ZodType,
  ZodUndefined: () => ZodUndefined,
  ZodUnion: () => ZodUnion,
  ZodUnknown: () => ZodUnknown,
  ZodVoid: () => ZodVoid,
  addIssueToContext: () => addIssueToContext,
  any: () => anyType,
  array: () => arrayType,
  bigint: () => bigIntType,
  boolean: () => booleanType,
  coerce: () => coerce,
  custom: () => custom,
  date: () => dateType,
  datetimeRegex: () => datetimeRegex,
  defaultErrorMap: () => en_default,
  discriminatedUnion: () => discriminatedUnionType,
  effect: () => effectsType,
  enum: () => enumType,
  function: () => functionType,
  getErrorMap: () => getErrorMap,
  getParsedType: () => getParsedType,
  instanceof: () => instanceOfType,
  intersection: () => intersectionType,
  isAborted: () => isAborted,
  isAsync: () => isAsync,
  isDirty: () => isDirty,
  isValid: () => isValid,
  late: () => late,
  lazy: () => lazyType,
  literal: () => literalType,
  makeIssue: () => makeIssue,
  map: () => mapType,
  nan: () => nanType,
  nativeEnum: () => nativeEnumType,
  never: () => neverType,
  null: () => nullType,
  nullable: () => nullableType,
  number: () => numberType,
  object: () => objectType,
  objectUtil: () => objectUtil,
  oboolean: () => oboolean,
  onumber: () => onumber,
  optional: () => optionalType,
  ostring: () => ostring,
  pipeline: () => pipelineType,
  preprocess: () => preprocessType,
  promise: () => promiseType,
  quotelessJson: () => quotelessJson,
  record: () => recordType,
  set: () => setType,
  setErrorMap: () => setErrorMap,
  strictObject: () => strictObjectType,
  string: () => stringType,
  symbol: () => symbolType,
  transformer: () => effectsType,
  tuple: () => tupleType,
  undefined: () => undefinedType,
  union: () => unionType,
  unknown: () => unknownType,
  util: () => util,
  void: () => voidType
});

// ../../node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/helpers/util.js
var util;
(function(util2) {
  util2.assertEqual = (_) => {
  };
  function assertIs(_arg) {
  }
  util2.assertIs = assertIs;
  function assertNever(_x) {
    throw new Error();
  }
  util2.assertNever = assertNever;
  util2.arrayToEnum = (items) => {
    const obj = {};
    for (const item of items) {
      obj[item] = item;
    }
    return obj;
  };
  util2.getValidEnumValues = (obj) => {
    const validKeys = util2.objectKeys(obj).filter((k) => typeof obj[obj[k]] !== "number");
    const filtered = {};
    for (const k of validKeys) {
      filtered[k] = obj[k];
    }
    return util2.objectValues(filtered);
  };
  util2.objectValues = (obj) => {
    return util2.objectKeys(obj).map(function(e) {
      return obj[e];
    });
  };
  util2.objectKeys = typeof Object.keys === "function" ? (obj) => Object.keys(obj) : (object) => {
    const keys = [];
    for (const key in object) {
      if (Object.prototype.hasOwnProperty.call(object, key)) {
        keys.push(key);
      }
    }
    return keys;
  };
  util2.find = (arr, checker) => {
    for (const item of arr) {
      if (checker(item))
        return item;
    }
    return void 0;
  };
  util2.isInteger = typeof Number.isInteger === "function" ? (val) => Number.isInteger(val) : (val) => typeof val === "number" && Number.isFinite(val) && Math.floor(val) === val;
  function joinValues(array, separator = " | ") {
    return array.map((val) => typeof val === "string" ? `'${val}'` : val).join(separator);
  }
  util2.joinValues = joinValues;
  util2.jsonStringifyReplacer = (_, value) => {
    if (typeof value === "bigint") {
      return value.toString();
    }
    return value;
  };
})(util || (util = {}));
var objectUtil;
(function(objectUtil2) {
  objectUtil2.mergeShapes = (first, second) => {
    return __spreadValues(__spreadValues({}, first), second);
  };
})(objectUtil || (objectUtil = {}));
var ZodParsedType = util.arrayToEnum([
  "string",
  "nan",
  "number",
  "integer",
  "float",
  "boolean",
  "date",
  "bigint",
  "symbol",
  "function",
  "undefined",
  "null",
  "array",
  "object",
  "unknown",
  "promise",
  "void",
  "never",
  "map",
  "set"
]);
var getParsedType = (data) => {
  const t = typeof data;
  switch (t) {
    case "undefined":
      return ZodParsedType.undefined;
    case "string":
      return ZodParsedType.string;
    case "number":
      return Number.isNaN(data) ? ZodParsedType.nan : ZodParsedType.number;
    case "boolean":
      return ZodParsedType.boolean;
    case "function":
      return ZodParsedType.function;
    case "bigint":
      return ZodParsedType.bigint;
    case "symbol":
      return ZodParsedType.symbol;
    case "object":
      if (Array.isArray(data)) {
        return ZodParsedType.array;
      }
      if (data === null) {
        return ZodParsedType.null;
      }
      if (data.then && typeof data.then === "function" && data.catch && typeof data.catch === "function") {
        return ZodParsedType.promise;
      }
      if (typeof Map !== "undefined" && data instanceof Map) {
        return ZodParsedType.map;
      }
      if (typeof Set !== "undefined" && data instanceof Set) {
        return ZodParsedType.set;
      }
      if (typeof Date !== "undefined" && data instanceof Date) {
        return ZodParsedType.date;
      }
      return ZodParsedType.object;
    default:
      return ZodParsedType.unknown;
  }
};

// ../../node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/ZodError.js
var ZodIssueCode = util.arrayToEnum([
  "invalid_type",
  "invalid_literal",
  "custom",
  "invalid_union",
  "invalid_union_discriminator",
  "invalid_enum_value",
  "unrecognized_keys",
  "invalid_arguments",
  "invalid_return_type",
  "invalid_date",
  "invalid_string",
  "too_small",
  "too_big",
  "invalid_intersection_types",
  "not_multiple_of",
  "not_finite"
]);
var quotelessJson = (obj) => {
  const json = JSON.stringify(obj, null, 2);
  return json.replace(/"([^"]+)":/g, "$1:");
};
var ZodError = class _ZodError extends Error {
  get errors() {
    return this.issues;
  }
  constructor(issues) {
    super();
    this.issues = [];
    this.addIssue = (sub) => {
      this.issues = [...this.issues, sub];
    };
    this.addIssues = (subs = []) => {
      this.issues = [...this.issues, ...subs];
    };
    const actualProto = new.target.prototype;
    if (Object.setPrototypeOf) {
      Object.setPrototypeOf(this, actualProto);
    } else {
      this.__proto__ = actualProto;
    }
    this.name = "ZodError";
    this.issues = issues;
  }
  format(_mapper) {
    const mapper = _mapper || function(issue) {
      return issue.message;
    };
    const fieldErrors = { _errors: [] };
    const processError = (error) => {
      for (const issue of error.issues) {
        if (issue.code === "invalid_union") {
          issue.unionErrors.map(processError);
        } else if (issue.code === "invalid_return_type") {
          processError(issue.returnTypeError);
        } else if (issue.code === "invalid_arguments") {
          processError(issue.argumentsError);
        } else if (issue.path.length === 0) {
          fieldErrors._errors.push(mapper(issue));
        } else {
          let curr = fieldErrors;
          let i = 0;
          while (i < issue.path.length) {
            const el = issue.path[i];
            const terminal = i === issue.path.length - 1;
            if (!terminal) {
              curr[el] = curr[el] || { _errors: [] };
            } else {
              curr[el] = curr[el] || { _errors: [] };
              curr[el]._errors.push(mapper(issue));
            }
            curr = curr[el];
            i++;
          }
        }
      }
    };
    processError(this);
    return fieldErrors;
  }
  static assert(value) {
    if (!(value instanceof _ZodError)) {
      throw new Error(`Not a ZodError: ${value}`);
    }
  }
  toString() {
    return this.message;
  }
  get message() {
    return JSON.stringify(this.issues, util.jsonStringifyReplacer, 2);
  }
  get isEmpty() {
    return this.issues.length === 0;
  }
  flatten(mapper = (issue) => issue.message) {
    const fieldErrors = {};
    const formErrors = [];
    for (const sub of this.issues) {
      if (sub.path.length > 0) {
        const firstEl = sub.path[0];
        fieldErrors[firstEl] = fieldErrors[firstEl] || [];
        fieldErrors[firstEl].push(mapper(sub));
      } else {
        formErrors.push(mapper(sub));
      }
    }
    return { formErrors, fieldErrors };
  }
  get formErrors() {
    return this.flatten();
  }
};
ZodError.create = (issues) => {
  const error = new ZodError(issues);
  return error;
};

// ../../node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/locales/en.js
var errorMap = (issue, _ctx) => {
  let message;
  switch (issue.code) {
    case ZodIssueCode.invalid_type:
      if (issue.received === ZodParsedType.undefined) {
        message = "Required";
      } else {
        message = `Expected ${issue.expected}, received ${issue.received}`;
      }
      break;
    case ZodIssueCode.invalid_literal:
      message = `Invalid literal value, expected ${JSON.stringify(issue.expected, util.jsonStringifyReplacer)}`;
      break;
    case ZodIssueCode.unrecognized_keys:
      message = `Unrecognized key(s) in object: ${util.joinValues(issue.keys, ", ")}`;
      break;
    case ZodIssueCode.invalid_union:
      message = `Invalid input`;
      break;
    case ZodIssueCode.invalid_union_discriminator:
      message = `Invalid discriminator value. Expected ${util.joinValues(issue.options)}`;
      break;
    case ZodIssueCode.invalid_enum_value:
      message = `Invalid enum value. Expected ${util.joinValues(issue.options)}, received '${issue.received}'`;
      break;
    case ZodIssueCode.invalid_arguments:
      message = `Invalid function arguments`;
      break;
    case ZodIssueCode.invalid_return_type:
      message = `Invalid function return type`;
      break;
    case ZodIssueCode.invalid_date:
      message = `Invalid date`;
      break;
    case ZodIssueCode.invalid_string:
      if (typeof issue.validation === "object") {
        if ("includes" in issue.validation) {
          message = `Invalid input: must include "${issue.validation.includes}"`;
          if (typeof issue.validation.position === "number") {
            message = `${message} at one or more positions greater than or equal to ${issue.validation.position}`;
          }
        } else if ("startsWith" in issue.validation) {
          message = `Invalid input: must start with "${issue.validation.startsWith}"`;
        } else if ("endsWith" in issue.validation) {
          message = `Invalid input: must end with "${issue.validation.endsWith}"`;
        } else {
          util.assertNever(issue.validation);
        }
      } else if (issue.validation !== "regex") {
        message = `Invalid ${issue.validation}`;
      } else {
        message = "Invalid";
      }
      break;
    case ZodIssueCode.too_small:
      if (issue.type === "array")
        message = `Array must contain ${issue.exact ? "exactly" : issue.inclusive ? `at least` : `more than`} ${issue.minimum} element(s)`;
      else if (issue.type === "string")
        message = `String must contain ${issue.exact ? "exactly" : issue.inclusive ? `at least` : `over`} ${issue.minimum} character(s)`;
      else if (issue.type === "number")
        message = `Number must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${issue.minimum}`;
      else if (issue.type === "bigint")
        message = `Number must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${issue.minimum}`;
      else if (issue.type === "date")
        message = `Date must be ${issue.exact ? `exactly equal to ` : issue.inclusive ? `greater than or equal to ` : `greater than `}${new Date(Number(issue.minimum))}`;
      else
        message = "Invalid input";
      break;
    case ZodIssueCode.too_big:
      if (issue.type === "array")
        message = `Array must contain ${issue.exact ? `exactly` : issue.inclusive ? `at most` : `less than`} ${issue.maximum} element(s)`;
      else if (issue.type === "string")
        message = `String must contain ${issue.exact ? `exactly` : issue.inclusive ? `at most` : `under`} ${issue.maximum} character(s)`;
      else if (issue.type === "number")
        message = `Number must be ${issue.exact ? `exactly` : issue.inclusive ? `less than or equal to` : `less than`} ${issue.maximum}`;
      else if (issue.type === "bigint")
        message = `BigInt must be ${issue.exact ? `exactly` : issue.inclusive ? `less than or equal to` : `less than`} ${issue.maximum}`;
      else if (issue.type === "date")
        message = `Date must be ${issue.exact ? `exactly` : issue.inclusive ? `smaller than or equal to` : `smaller than`} ${new Date(Number(issue.maximum))}`;
      else
        message = "Invalid input";
      break;
    case ZodIssueCode.custom:
      message = `Invalid input`;
      break;
    case ZodIssueCode.invalid_intersection_types:
      message = `Intersection results could not be merged`;
      break;
    case ZodIssueCode.not_multiple_of:
      message = `Number must be a multiple of ${issue.multipleOf}`;
      break;
    case ZodIssueCode.not_finite:
      message = "Number must be finite";
      break;
    default:
      message = _ctx.defaultError;
      util.assertNever(issue);
  }
  return { message };
};
var en_default = errorMap;

// ../../node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/errors.js
var overrideErrorMap = en_default;
function setErrorMap(map) {
  overrideErrorMap = map;
}
function getErrorMap() {
  return overrideErrorMap;
}

// ../../node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/helpers/parseUtil.js
var makeIssue = (params) => {
  const { data, path, errorMaps, issueData } = params;
  const fullPath = [...path, ...issueData.path || []];
  const fullIssue = __spreadProps(__spreadValues({}, issueData), {
    path: fullPath
  });
  if (issueData.message !== void 0) {
    return __spreadProps(__spreadValues({}, issueData), {
      path: fullPath,
      message: issueData.message
    });
  }
  let errorMessage = "";
  const maps = errorMaps.filter((m) => !!m).slice().reverse();
  for (const map of maps) {
    errorMessage = map(fullIssue, { data, defaultError: errorMessage }).message;
  }
  return __spreadProps(__spreadValues({}, issueData), {
    path: fullPath,
    message: errorMessage
  });
};
var EMPTY_PATH = [];
function addIssueToContext(ctx, issueData) {
  const overrideMap = getErrorMap();
  const issue = makeIssue({
    issueData,
    data: ctx.data,
    path: ctx.path,
    errorMaps: [
      ctx.common.contextualErrorMap,
      // contextual error map is first priority
      ctx.schemaErrorMap,
      // then schema-bound map if available
      overrideMap,
      // then global override map
      overrideMap === en_default ? void 0 : en_default
      // then global default map
    ].filter((x) => !!x)
  });
  ctx.common.issues.push(issue);
}
var ParseStatus = class _ParseStatus {
  constructor() {
    this.value = "valid";
  }
  dirty() {
    if (this.value === "valid")
      this.value = "dirty";
  }
  abort() {
    if (this.value !== "aborted")
      this.value = "aborted";
  }
  static mergeArray(status, results) {
    const arrayValue = [];
    for (const s of results) {
      if (s.status === "aborted")
        return INVALID;
      if (s.status === "dirty")
        status.dirty();
      arrayValue.push(s.value);
    }
    return { status: status.value, value: arrayValue };
  }
  static async mergeObjectAsync(status, pairs) {
    const syncPairs = [];
    for (const pair of pairs) {
      const key = await pair.key;
      const value = await pair.value;
      syncPairs.push({
        key,
        value
      });
    }
    return _ParseStatus.mergeObjectSync(status, syncPairs);
  }
  static mergeObjectSync(status, pairs) {
    const finalObject = {};
    for (const pair of pairs) {
      const { key, value } = pair;
      if (key.status === "aborted")
        return INVALID;
      if (value.status === "aborted")
        return INVALID;
      if (key.status === "dirty")
        status.dirty();
      if (value.status === "dirty")
        status.dirty();
      if (key.value !== "__proto__" && (typeof value.value !== "undefined" || pair.alwaysSet)) {
        finalObject[key.value] = value.value;
      }
    }
    return { status: status.value, value: finalObject };
  }
};
var INVALID = Object.freeze({
  status: "aborted"
});
var DIRTY = (value) => ({ status: "dirty", value });
var OK = (value) => ({ status: "valid", value });
var isAborted = (x) => x.status === "aborted";
var isDirty = (x) => x.status === "dirty";
var isValid = (x) => x.status === "valid";
var isAsync = (x) => typeof Promise !== "undefined" && x instanceof Promise;

// ../../node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/helpers/errorUtil.js
var errorUtil;
(function(errorUtil2) {
  errorUtil2.errToObj = (message) => typeof message === "string" ? { message } : message || {};
  errorUtil2.toString = (message) => typeof message === "string" ? message : message == null ? void 0 : message.message;
})(errorUtil || (errorUtil = {}));

// ../../node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/types.js
var ParseInputLazyPath = class {
  constructor(parent, value, path, key) {
    this._cachedPath = [];
    this.parent = parent;
    this.data = value;
    this._path = path;
    this._key = key;
  }
  get path() {
    if (!this._cachedPath.length) {
      if (Array.isArray(this._key)) {
        this._cachedPath.push(...this._path, ...this._key);
      } else {
        this._cachedPath.push(...this._path, this._key);
      }
    }
    return this._cachedPath;
  }
};
var handleResult = (ctx, result) => {
  if (isValid(result)) {
    return { success: true, data: result.value };
  } else {
    if (!ctx.common.issues.length) {
      throw new Error("Validation failed but no issues detected.");
    }
    return {
      success: false,
      get error() {
        if (this._error)
          return this._error;
        const error = new ZodError(ctx.common.issues);
        this._error = error;
        return this._error;
      }
    };
  }
};
function processCreateParams(params) {
  if (!params)
    return {};
  const { errorMap: errorMap2, invalid_type_error, required_error, description } = params;
  if (errorMap2 && (invalid_type_error || required_error)) {
    throw new Error(`Can't use "invalid_type_error" or "required_error" in conjunction with custom error map.`);
  }
  if (errorMap2)
    return { errorMap: errorMap2, description };
  const customMap = (iss, ctx) => {
    var _a, _b;
    const { message } = params;
    if (iss.code === "invalid_enum_value") {
      return { message: message != null ? message : ctx.defaultError };
    }
    if (typeof ctx.data === "undefined") {
      return { message: (_a = message != null ? message : required_error) != null ? _a : ctx.defaultError };
    }
    if (iss.code !== "invalid_type")
      return { message: ctx.defaultError };
    return { message: (_b = message != null ? message : invalid_type_error) != null ? _b : ctx.defaultError };
  };
  return { errorMap: customMap, description };
}
var ZodType = class {
  get description() {
    return this._def.description;
  }
  _getType(input) {
    return getParsedType(input.data);
  }
  _getOrReturnCtx(input, ctx) {
    return ctx || {
      common: input.parent.common,
      data: input.data,
      parsedType: getParsedType(input.data),
      schemaErrorMap: this._def.errorMap,
      path: input.path,
      parent: input.parent
    };
  }
  _processInputParams(input) {
    return {
      status: new ParseStatus(),
      ctx: {
        common: input.parent.common,
        data: input.data,
        parsedType: getParsedType(input.data),
        schemaErrorMap: this._def.errorMap,
        path: input.path,
        parent: input.parent
      }
    };
  }
  _parseSync(input) {
    const result = this._parse(input);
    if (isAsync(result)) {
      throw new Error("Synchronous parse encountered promise.");
    }
    return result;
  }
  _parseAsync(input) {
    const result = this._parse(input);
    return Promise.resolve(result);
  }
  parse(data, params) {
    const result = this.safeParse(data, params);
    if (result.success)
      return result.data;
    throw result.error;
  }
  safeParse(data, params) {
    var _a;
    const ctx = {
      common: {
        issues: [],
        async: (_a = params == null ? void 0 : params.async) != null ? _a : false,
        contextualErrorMap: params == null ? void 0 : params.errorMap
      },
      path: (params == null ? void 0 : params.path) || [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    const result = this._parseSync({ data, path: ctx.path, parent: ctx });
    return handleResult(ctx, result);
  }
  "~validate"(data) {
    var _a, _b;
    const ctx = {
      common: {
        issues: [],
        async: !!this["~standard"].async
      },
      path: [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    if (!this["~standard"].async) {
      try {
        const result = this._parseSync({ data, path: [], parent: ctx });
        return isValid(result) ? {
          value: result.value
        } : {
          issues: ctx.common.issues
        };
      } catch (err) {
        if ((_b = (_a = err == null ? void 0 : err.message) == null ? void 0 : _a.toLowerCase()) == null ? void 0 : _b.includes("encountered")) {
          this["~standard"].async = true;
        }
        ctx.common = {
          issues: [],
          async: true
        };
      }
    }
    return this._parseAsync({ data, path: [], parent: ctx }).then((result) => isValid(result) ? {
      value: result.value
    } : {
      issues: ctx.common.issues
    });
  }
  async parseAsync(data, params) {
    const result = await this.safeParseAsync(data, params);
    if (result.success)
      return result.data;
    throw result.error;
  }
  async safeParseAsync(data, params) {
    const ctx = {
      common: {
        issues: [],
        contextualErrorMap: params == null ? void 0 : params.errorMap,
        async: true
      },
      path: (params == null ? void 0 : params.path) || [],
      schemaErrorMap: this._def.errorMap,
      parent: null,
      data,
      parsedType: getParsedType(data)
    };
    const maybeAsyncResult = this._parse({ data, path: ctx.path, parent: ctx });
    const result = await (isAsync(maybeAsyncResult) ? maybeAsyncResult : Promise.resolve(maybeAsyncResult));
    return handleResult(ctx, result);
  }
  refine(check, message) {
    const getIssueProperties = (val) => {
      if (typeof message === "string" || typeof message === "undefined") {
        return { message };
      } else if (typeof message === "function") {
        return message(val);
      } else {
        return message;
      }
    };
    return this._refinement((val, ctx) => {
      const result = check(val);
      const setError = () => ctx.addIssue(__spreadValues({
        code: ZodIssueCode.custom
      }, getIssueProperties(val)));
      if (typeof Promise !== "undefined" && result instanceof Promise) {
        return result.then((data) => {
          if (!data) {
            setError();
            return false;
          } else {
            return true;
          }
        });
      }
      if (!result) {
        setError();
        return false;
      } else {
        return true;
      }
    });
  }
  refinement(check, refinementData) {
    return this._refinement((val, ctx) => {
      if (!check(val)) {
        ctx.addIssue(typeof refinementData === "function" ? refinementData(val, ctx) : refinementData);
        return false;
      } else {
        return true;
      }
    });
  }
  _refinement(refinement) {
    return new ZodEffects({
      schema: this,
      typeName: ZodFirstPartyTypeKind.ZodEffects,
      effect: { type: "refinement", refinement }
    });
  }
  superRefine(refinement) {
    return this._refinement(refinement);
  }
  constructor(def) {
    this.spa = this.safeParseAsync;
    this._def = def;
    this.parse = this.parse.bind(this);
    this.safeParse = this.safeParse.bind(this);
    this.parseAsync = this.parseAsync.bind(this);
    this.safeParseAsync = this.safeParseAsync.bind(this);
    this.spa = this.spa.bind(this);
    this.refine = this.refine.bind(this);
    this.refinement = this.refinement.bind(this);
    this.superRefine = this.superRefine.bind(this);
    this.optional = this.optional.bind(this);
    this.nullable = this.nullable.bind(this);
    this.nullish = this.nullish.bind(this);
    this.array = this.array.bind(this);
    this.promise = this.promise.bind(this);
    this.or = this.or.bind(this);
    this.and = this.and.bind(this);
    this.transform = this.transform.bind(this);
    this.brand = this.brand.bind(this);
    this.default = this.default.bind(this);
    this.catch = this.catch.bind(this);
    this.describe = this.describe.bind(this);
    this.pipe = this.pipe.bind(this);
    this.readonly = this.readonly.bind(this);
    this.isNullable = this.isNullable.bind(this);
    this.isOptional = this.isOptional.bind(this);
    this["~standard"] = {
      version: 1,
      vendor: "zod",
      validate: (data) => this["~validate"](data)
    };
  }
  optional() {
    return ZodOptional.create(this, this._def);
  }
  nullable() {
    return ZodNullable.create(this, this._def);
  }
  nullish() {
    return this.nullable().optional();
  }
  array() {
    return ZodArray.create(this);
  }
  promise() {
    return ZodPromise.create(this, this._def);
  }
  or(option) {
    return ZodUnion.create([this, option], this._def);
  }
  and(incoming) {
    return ZodIntersection.create(this, incoming, this._def);
  }
  transform(transform) {
    return new ZodEffects(__spreadProps(__spreadValues({}, processCreateParams(this._def)), {
      schema: this,
      typeName: ZodFirstPartyTypeKind.ZodEffects,
      effect: { type: "transform", transform }
    }));
  }
  default(def) {
    const defaultValueFunc = typeof def === "function" ? def : () => def;
    return new ZodDefault(__spreadProps(__spreadValues({}, processCreateParams(this._def)), {
      innerType: this,
      defaultValue: defaultValueFunc,
      typeName: ZodFirstPartyTypeKind.ZodDefault
    }));
  }
  brand() {
    return new ZodBranded(__spreadValues({
      typeName: ZodFirstPartyTypeKind.ZodBranded,
      type: this
    }, processCreateParams(this._def)));
  }
  catch(def) {
    const catchValueFunc = typeof def === "function" ? def : () => def;
    return new ZodCatch(__spreadProps(__spreadValues({}, processCreateParams(this._def)), {
      innerType: this,
      catchValue: catchValueFunc,
      typeName: ZodFirstPartyTypeKind.ZodCatch
    }));
  }
  describe(description) {
    const This = this.constructor;
    return new This(__spreadProps(__spreadValues({}, this._def), {
      description
    }));
  }
  pipe(target) {
    return ZodPipeline.create(this, target);
  }
  readonly() {
    return ZodReadonly.create(this);
  }
  isOptional() {
    return this.safeParse(void 0).success;
  }
  isNullable() {
    return this.safeParse(null).success;
  }
};
var cuidRegex = /^c[^\s-]{8,}$/i;
var cuid2Regex = /^[0-9a-z]+$/;
var ulidRegex = /^[0-9A-HJKMNP-TV-Z]{26}$/i;
var uuidRegex = /^[0-9a-fA-F]{8}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{12}$/i;
var nanoidRegex = /^[a-z0-9_-]{21}$/i;
var jwtRegex = /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]*$/;
var durationRegex = /^[-+]?P(?!$)(?:(?:[-+]?\d+Y)|(?:[-+]?\d+[.,]\d+Y$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:(?:[-+]?\d+W)|(?:[-+]?\d+[.,]\d+W$))?(?:(?:[-+]?\d+D)|(?:[-+]?\d+[.,]\d+D$))?(?:T(?=[\d+-])(?:(?:[-+]?\d+H)|(?:[-+]?\d+[.,]\d+H$))?(?:(?:[-+]?\d+M)|(?:[-+]?\d+[.,]\d+M$))?(?:[-+]?\d+(?:[.,]\d+)?S)?)??$/;
var emailRegex = /^(?!\.)(?!.*\.\.)([A-Z0-9_'+\-\.]*)[A-Z0-9_+-]@([A-Z0-9][A-Z0-9\-]*\.)+[A-Z]{2,}$/i;
var _emojiRegex = `^(\\p{Extended_Pictographic}|\\p{Emoji_Component})+$`;
var emojiRegex;
var ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/;
var ipv4CidrRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/(3[0-2]|[12]?[0-9])$/;
var ipv6Regex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/;
var ipv6CidrRegex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/;
var base64Regex = /^([0-9a-zA-Z+/]{4})*(([0-9a-zA-Z+/]{2}==)|([0-9a-zA-Z+/]{3}=))?$/;
var base64urlRegex = /^([0-9a-zA-Z-_]{4})*(([0-9a-zA-Z-_]{2}(==)?)|([0-9a-zA-Z-_]{3}(=)?))?$/;
var dateRegexSource = `((\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-((0[13578]|1[02])-(0[1-9]|[12]\\d|3[01])|(0[469]|11)-(0[1-9]|[12]\\d|30)|(02)-(0[1-9]|1\\d|2[0-8])))`;
var dateRegex = new RegExp(`^${dateRegexSource}$`);
function timeRegexSource(args) {
  let secondsRegexSource = `[0-5]\\d`;
  if (args.precision) {
    secondsRegexSource = `${secondsRegexSource}\\.\\d{${args.precision}}`;
  } else if (args.precision == null) {
    secondsRegexSource = `${secondsRegexSource}(\\.\\d+)?`;
  }
  const secondsQuantifier = args.precision ? "+" : "?";
  return `([01]\\d|2[0-3]):[0-5]\\d(:${secondsRegexSource})${secondsQuantifier}`;
}
function timeRegex(args) {
  return new RegExp(`^${timeRegexSource(args)}$`);
}
function datetimeRegex(args) {
  let regex = `${dateRegexSource}T${timeRegexSource(args)}`;
  const opts = [];
  opts.push(args.local ? `Z?` : `Z`);
  if (args.offset)
    opts.push(`([+-]\\d{2}:?\\d{2})`);
  regex = `${regex}(${opts.join("|")})`;
  return new RegExp(`^${regex}$`);
}
function isValidIP(ip, version) {
  if ((version === "v4" || !version) && ipv4Regex.test(ip)) {
    return true;
  }
  if ((version === "v6" || !version) && ipv6Regex.test(ip)) {
    return true;
  }
  return false;
}
function isValidJWT(jwt, alg) {
  if (!jwtRegex.test(jwt))
    return false;
  try {
    const [header] = jwt.split(".");
    if (!header)
      return false;
    const base64 = header.replace(/-/g, "+").replace(/_/g, "/").padEnd(header.length + (4 - header.length % 4) % 4, "=");
    const decoded = JSON.parse(atob(base64));
    if (typeof decoded !== "object" || decoded === null)
      return false;
    if ("typ" in decoded && (decoded == null ? void 0 : decoded.typ) !== "JWT")
      return false;
    if (!decoded.alg)
      return false;
    if (alg && decoded.alg !== alg)
      return false;
    return true;
  } catch (e) {
    return false;
  }
}
function isValidCidr(ip, version) {
  if ((version === "v4" || !version) && ipv4CidrRegex.test(ip)) {
    return true;
  }
  if ((version === "v6" || !version) && ipv6CidrRegex.test(ip)) {
    return true;
  }
  return false;
}
var ZodString = class _ZodString extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = String(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.string) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.string,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    const status = new ParseStatus();
    let ctx = void 0;
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        if (input.data.length < check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            minimum: check.value,
            type: "string",
            inclusive: true,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        if (input.data.length > check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            maximum: check.value,
            type: "string",
            inclusive: true,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "length") {
        const tooBig = input.data.length > check.value;
        const tooSmall = input.data.length < check.value;
        if (tooBig || tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          if (tooBig) {
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_big,
              maximum: check.value,
              type: "string",
              inclusive: true,
              exact: true,
              message: check.message
            });
          } else if (tooSmall) {
            addIssueToContext(ctx, {
              code: ZodIssueCode.too_small,
              minimum: check.value,
              type: "string",
              inclusive: true,
              exact: true,
              message: check.message
            });
          }
          status.dirty();
        }
      } else if (check.kind === "email") {
        if (!emailRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "email",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "emoji") {
        if (!emojiRegex) {
          emojiRegex = new RegExp(_emojiRegex, "u");
        }
        if (!emojiRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "emoji",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "uuid") {
        if (!uuidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "uuid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "nanoid") {
        if (!nanoidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "nanoid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cuid") {
        if (!cuidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cuid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cuid2") {
        if (!cuid2Regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cuid2",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "ulid") {
        if (!ulidRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "ulid",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "url") {
        try {
          new URL(input.data);
        } catch (e) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "url",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "regex") {
        check.regex.lastIndex = 0;
        const testResult = check.regex.test(input.data);
        if (!testResult) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "regex",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "trim") {
        input.data = input.data.trim();
      } else if (check.kind === "includes") {
        if (!input.data.includes(check.value, check.position)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { includes: check.value, position: check.position },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "toLowerCase") {
        input.data = input.data.toLowerCase();
      } else if (check.kind === "toUpperCase") {
        input.data = input.data.toUpperCase();
      } else if (check.kind === "startsWith") {
        if (!input.data.startsWith(check.value)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { startsWith: check.value },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "endsWith") {
        if (!input.data.endsWith(check.value)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: { endsWith: check.value },
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "datetime") {
        const regex = datetimeRegex(check);
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "datetime",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "date") {
        const regex = dateRegex;
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "date",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "time") {
        const regex = timeRegex(check);
        if (!regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_string,
            validation: "time",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "duration") {
        if (!durationRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "duration",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "ip") {
        if (!isValidIP(input.data, check.version)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "ip",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "jwt") {
        if (!isValidJWT(input.data, check.alg)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "jwt",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "cidr") {
        if (!isValidCidr(input.data, check.version)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "cidr",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "base64") {
        if (!base64Regex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "base64",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "base64url") {
        if (!base64urlRegex.test(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            validation: "base64url",
            code: ZodIssueCode.invalid_string,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  _regex(regex, validation, message) {
    return this.refinement((data) => regex.test(data), __spreadValues({
      validation,
      code: ZodIssueCode.invalid_string
    }, errorUtil.errToObj(message)));
  }
  _addCheck(check) {
    return new _ZodString(__spreadProps(__spreadValues({}, this._def), {
      checks: [...this._def.checks, check]
    }));
  }
  email(message) {
    return this._addCheck(__spreadValues({ kind: "email" }, errorUtil.errToObj(message)));
  }
  url(message) {
    return this._addCheck(__spreadValues({ kind: "url" }, errorUtil.errToObj(message)));
  }
  emoji(message) {
    return this._addCheck(__spreadValues({ kind: "emoji" }, errorUtil.errToObj(message)));
  }
  uuid(message) {
    return this._addCheck(__spreadValues({ kind: "uuid" }, errorUtil.errToObj(message)));
  }
  nanoid(message) {
    return this._addCheck(__spreadValues({ kind: "nanoid" }, errorUtil.errToObj(message)));
  }
  cuid(message) {
    return this._addCheck(__spreadValues({ kind: "cuid" }, errorUtil.errToObj(message)));
  }
  cuid2(message) {
    return this._addCheck(__spreadValues({ kind: "cuid2" }, errorUtil.errToObj(message)));
  }
  ulid(message) {
    return this._addCheck(__spreadValues({ kind: "ulid" }, errorUtil.errToObj(message)));
  }
  base64(message) {
    return this._addCheck(__spreadValues({ kind: "base64" }, errorUtil.errToObj(message)));
  }
  base64url(message) {
    return this._addCheck(__spreadValues({
      kind: "base64url"
    }, errorUtil.errToObj(message)));
  }
  jwt(options) {
    return this._addCheck(__spreadValues({ kind: "jwt" }, errorUtil.errToObj(options)));
  }
  ip(options) {
    return this._addCheck(__spreadValues({ kind: "ip" }, errorUtil.errToObj(options)));
  }
  cidr(options) {
    return this._addCheck(__spreadValues({ kind: "cidr" }, errorUtil.errToObj(options)));
  }
  datetime(options) {
    var _a, _b;
    if (typeof options === "string") {
      return this._addCheck({
        kind: "datetime",
        precision: null,
        offset: false,
        local: false,
        message: options
      });
    }
    return this._addCheck(__spreadValues({
      kind: "datetime",
      precision: typeof (options == null ? void 0 : options.precision) === "undefined" ? null : options == null ? void 0 : options.precision,
      offset: (_a = options == null ? void 0 : options.offset) != null ? _a : false,
      local: (_b = options == null ? void 0 : options.local) != null ? _b : false
    }, errorUtil.errToObj(options == null ? void 0 : options.message)));
  }
  date(message) {
    return this._addCheck({ kind: "date", message });
  }
  time(options) {
    if (typeof options === "string") {
      return this._addCheck({
        kind: "time",
        precision: null,
        message: options
      });
    }
    return this._addCheck(__spreadValues({
      kind: "time",
      precision: typeof (options == null ? void 0 : options.precision) === "undefined" ? null : options == null ? void 0 : options.precision
    }, errorUtil.errToObj(options == null ? void 0 : options.message)));
  }
  duration(message) {
    return this._addCheck(__spreadValues({ kind: "duration" }, errorUtil.errToObj(message)));
  }
  regex(regex, message) {
    return this._addCheck(__spreadValues({
      kind: "regex",
      regex
    }, errorUtil.errToObj(message)));
  }
  includes(value, options) {
    return this._addCheck(__spreadValues({
      kind: "includes",
      value,
      position: options == null ? void 0 : options.position
    }, errorUtil.errToObj(options == null ? void 0 : options.message)));
  }
  startsWith(value, message) {
    return this._addCheck(__spreadValues({
      kind: "startsWith",
      value
    }, errorUtil.errToObj(message)));
  }
  endsWith(value, message) {
    return this._addCheck(__spreadValues({
      kind: "endsWith",
      value
    }, errorUtil.errToObj(message)));
  }
  min(minLength, message) {
    return this._addCheck(__spreadValues({
      kind: "min",
      value: minLength
    }, errorUtil.errToObj(message)));
  }
  max(maxLength, message) {
    return this._addCheck(__spreadValues({
      kind: "max",
      value: maxLength
    }, errorUtil.errToObj(message)));
  }
  length(len, message) {
    return this._addCheck(__spreadValues({
      kind: "length",
      value: len
    }, errorUtil.errToObj(message)));
  }
  /**
   * Equivalent to `.min(1)`
   */
  nonempty(message) {
    return this.min(1, errorUtil.errToObj(message));
  }
  trim() {
    return new _ZodString(__spreadProps(__spreadValues({}, this._def), {
      checks: [...this._def.checks, { kind: "trim" }]
    }));
  }
  toLowerCase() {
    return new _ZodString(__spreadProps(__spreadValues({}, this._def), {
      checks: [...this._def.checks, { kind: "toLowerCase" }]
    }));
  }
  toUpperCase() {
    return new _ZodString(__spreadProps(__spreadValues({}, this._def), {
      checks: [...this._def.checks, { kind: "toUpperCase" }]
    }));
  }
  get isDatetime() {
    return !!this._def.checks.find((ch) => ch.kind === "datetime");
  }
  get isDate() {
    return !!this._def.checks.find((ch) => ch.kind === "date");
  }
  get isTime() {
    return !!this._def.checks.find((ch) => ch.kind === "time");
  }
  get isDuration() {
    return !!this._def.checks.find((ch) => ch.kind === "duration");
  }
  get isEmail() {
    return !!this._def.checks.find((ch) => ch.kind === "email");
  }
  get isURL() {
    return !!this._def.checks.find((ch) => ch.kind === "url");
  }
  get isEmoji() {
    return !!this._def.checks.find((ch) => ch.kind === "emoji");
  }
  get isUUID() {
    return !!this._def.checks.find((ch) => ch.kind === "uuid");
  }
  get isNANOID() {
    return !!this._def.checks.find((ch) => ch.kind === "nanoid");
  }
  get isCUID() {
    return !!this._def.checks.find((ch) => ch.kind === "cuid");
  }
  get isCUID2() {
    return !!this._def.checks.find((ch) => ch.kind === "cuid2");
  }
  get isULID() {
    return !!this._def.checks.find((ch) => ch.kind === "ulid");
  }
  get isIP() {
    return !!this._def.checks.find((ch) => ch.kind === "ip");
  }
  get isCIDR() {
    return !!this._def.checks.find((ch) => ch.kind === "cidr");
  }
  get isBase64() {
    return !!this._def.checks.find((ch) => ch.kind === "base64");
  }
  get isBase64url() {
    return !!this._def.checks.find((ch) => ch.kind === "base64url");
  }
  get minLength() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxLength() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
};
ZodString.create = (params) => {
  var _a;
  return new ZodString(__spreadValues({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodString,
    coerce: (_a = params == null ? void 0 : params.coerce) != null ? _a : false
  }, processCreateParams(params)));
};
function floatSafeRemainder(val, step) {
  const valDecCount = (val.toString().split(".")[1] || "").length;
  const stepDecCount = (step.toString().split(".")[1] || "").length;
  const decCount = valDecCount > stepDecCount ? valDecCount : stepDecCount;
  const valInt = Number.parseInt(val.toFixed(decCount).replace(".", ""));
  const stepInt = Number.parseInt(step.toFixed(decCount).replace(".", ""));
  return valInt % stepInt / 10 ** decCount;
}
var ZodNumber = class _ZodNumber extends ZodType {
  constructor() {
    super(...arguments);
    this.min = this.gte;
    this.max = this.lte;
    this.step = this.multipleOf;
  }
  _parse(input) {
    if (this._def.coerce) {
      input.data = Number(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.number) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.number,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    let ctx = void 0;
    const status = new ParseStatus();
    for (const check of this._def.checks) {
      if (check.kind === "int") {
        if (!util.isInteger(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.invalid_type,
            expected: "integer",
            received: "float",
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "min") {
        const tooSmall = check.inclusive ? input.data < check.value : input.data <= check.value;
        if (tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            minimum: check.value,
            type: "number",
            inclusive: check.inclusive,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        const tooBig = check.inclusive ? input.data > check.value : input.data >= check.value;
        if (tooBig) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            maximum: check.value,
            type: "number",
            inclusive: check.inclusive,
            exact: false,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "multipleOf") {
        if (floatSafeRemainder(input.data, check.value) !== 0) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_multiple_of,
            multipleOf: check.value,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "finite") {
        if (!Number.isFinite(input.data)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_finite,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  gte(value, message) {
    return this.setLimit("min", value, true, errorUtil.toString(message));
  }
  gt(value, message) {
    return this.setLimit("min", value, false, errorUtil.toString(message));
  }
  lte(value, message) {
    return this.setLimit("max", value, true, errorUtil.toString(message));
  }
  lt(value, message) {
    return this.setLimit("max", value, false, errorUtil.toString(message));
  }
  setLimit(kind, value, inclusive, message) {
    return new _ZodNumber(__spreadProps(__spreadValues({}, this._def), {
      checks: [
        ...this._def.checks,
        {
          kind,
          value,
          inclusive,
          message: errorUtil.toString(message)
        }
      ]
    }));
  }
  _addCheck(check) {
    return new _ZodNumber(__spreadProps(__spreadValues({}, this._def), {
      checks: [...this._def.checks, check]
    }));
  }
  int(message) {
    return this._addCheck({
      kind: "int",
      message: errorUtil.toString(message)
    });
  }
  positive(message) {
    return this._addCheck({
      kind: "min",
      value: 0,
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  negative(message) {
    return this._addCheck({
      kind: "max",
      value: 0,
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  nonpositive(message) {
    return this._addCheck({
      kind: "max",
      value: 0,
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  nonnegative(message) {
    return this._addCheck({
      kind: "min",
      value: 0,
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  multipleOf(value, message) {
    return this._addCheck({
      kind: "multipleOf",
      value,
      message: errorUtil.toString(message)
    });
  }
  finite(message) {
    return this._addCheck({
      kind: "finite",
      message: errorUtil.toString(message)
    });
  }
  safe(message) {
    return this._addCheck({
      kind: "min",
      inclusive: true,
      value: Number.MIN_SAFE_INTEGER,
      message: errorUtil.toString(message)
    })._addCheck({
      kind: "max",
      inclusive: true,
      value: Number.MAX_SAFE_INTEGER,
      message: errorUtil.toString(message)
    });
  }
  get minValue() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxValue() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
  get isInt() {
    return !!this._def.checks.find((ch) => ch.kind === "int" || ch.kind === "multipleOf" && util.isInteger(ch.value));
  }
  get isFinite() {
    let max = null;
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "finite" || ch.kind === "int" || ch.kind === "multipleOf") {
        return true;
      } else if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      } else if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return Number.isFinite(min) && Number.isFinite(max);
  }
};
ZodNumber.create = (params) => {
  return new ZodNumber(__spreadValues({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodNumber,
    coerce: (params == null ? void 0 : params.coerce) || false
  }, processCreateParams(params)));
};
var ZodBigInt = class _ZodBigInt extends ZodType {
  constructor() {
    super(...arguments);
    this.min = this.gte;
    this.max = this.lte;
  }
  _parse(input) {
    if (this._def.coerce) {
      try {
        input.data = BigInt(input.data);
      } catch (e) {
        return this._getInvalidInput(input);
      }
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.bigint) {
      return this._getInvalidInput(input);
    }
    let ctx = void 0;
    const status = new ParseStatus();
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        const tooSmall = check.inclusive ? input.data < check.value : input.data <= check.value;
        if (tooSmall) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            type: "bigint",
            minimum: check.value,
            inclusive: check.inclusive,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        const tooBig = check.inclusive ? input.data > check.value : input.data >= check.value;
        if (tooBig) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            type: "bigint",
            maximum: check.value,
            inclusive: check.inclusive,
            message: check.message
          });
          status.dirty();
        }
      } else if (check.kind === "multipleOf") {
        if (input.data % check.value !== BigInt(0)) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.not_multiple_of,
            multipleOf: check.value,
            message: check.message
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return { status: status.value, value: input.data };
  }
  _getInvalidInput(input) {
    const ctx = this._getOrReturnCtx(input);
    addIssueToContext(ctx, {
      code: ZodIssueCode.invalid_type,
      expected: ZodParsedType.bigint,
      received: ctx.parsedType
    });
    return INVALID;
  }
  gte(value, message) {
    return this.setLimit("min", value, true, errorUtil.toString(message));
  }
  gt(value, message) {
    return this.setLimit("min", value, false, errorUtil.toString(message));
  }
  lte(value, message) {
    return this.setLimit("max", value, true, errorUtil.toString(message));
  }
  lt(value, message) {
    return this.setLimit("max", value, false, errorUtil.toString(message));
  }
  setLimit(kind, value, inclusive, message) {
    return new _ZodBigInt(__spreadProps(__spreadValues({}, this._def), {
      checks: [
        ...this._def.checks,
        {
          kind,
          value,
          inclusive,
          message: errorUtil.toString(message)
        }
      ]
    }));
  }
  _addCheck(check) {
    return new _ZodBigInt(__spreadProps(__spreadValues({}, this._def), {
      checks: [...this._def.checks, check]
    }));
  }
  positive(message) {
    return this._addCheck({
      kind: "min",
      value: BigInt(0),
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  negative(message) {
    return this._addCheck({
      kind: "max",
      value: BigInt(0),
      inclusive: false,
      message: errorUtil.toString(message)
    });
  }
  nonpositive(message) {
    return this._addCheck({
      kind: "max",
      value: BigInt(0),
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  nonnegative(message) {
    return this._addCheck({
      kind: "min",
      value: BigInt(0),
      inclusive: true,
      message: errorUtil.toString(message)
    });
  }
  multipleOf(value, message) {
    return this._addCheck({
      kind: "multipleOf",
      value,
      message: errorUtil.toString(message)
    });
  }
  get minValue() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min;
  }
  get maxValue() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max;
  }
};
ZodBigInt.create = (params) => {
  var _a;
  return new ZodBigInt(__spreadValues({
    checks: [],
    typeName: ZodFirstPartyTypeKind.ZodBigInt,
    coerce: (_a = params == null ? void 0 : params.coerce) != null ? _a : false
  }, processCreateParams(params)));
};
var ZodBoolean = class extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = Boolean(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.boolean) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.boolean,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodBoolean.create = (params) => {
  return new ZodBoolean(__spreadValues({
    typeName: ZodFirstPartyTypeKind.ZodBoolean,
    coerce: (params == null ? void 0 : params.coerce) || false
  }, processCreateParams(params)));
};
var ZodDate = class _ZodDate extends ZodType {
  _parse(input) {
    if (this._def.coerce) {
      input.data = new Date(input.data);
    }
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.date) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.date,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    if (Number.isNaN(input.data.getTime())) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_date
      });
      return INVALID;
    }
    const status = new ParseStatus();
    let ctx = void 0;
    for (const check of this._def.checks) {
      if (check.kind === "min") {
        if (input.data.getTime() < check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_small,
            message: check.message,
            inclusive: true,
            exact: false,
            minimum: check.value,
            type: "date"
          });
          status.dirty();
        }
      } else if (check.kind === "max") {
        if (input.data.getTime() > check.value) {
          ctx = this._getOrReturnCtx(input, ctx);
          addIssueToContext(ctx, {
            code: ZodIssueCode.too_big,
            message: check.message,
            inclusive: true,
            exact: false,
            maximum: check.value,
            type: "date"
          });
          status.dirty();
        }
      } else {
        util.assertNever(check);
      }
    }
    return {
      status: status.value,
      value: new Date(input.data.getTime())
    };
  }
  _addCheck(check) {
    return new _ZodDate(__spreadProps(__spreadValues({}, this._def), {
      checks: [...this._def.checks, check]
    }));
  }
  min(minDate, message) {
    return this._addCheck({
      kind: "min",
      value: minDate.getTime(),
      message: errorUtil.toString(message)
    });
  }
  max(maxDate, message) {
    return this._addCheck({
      kind: "max",
      value: maxDate.getTime(),
      message: errorUtil.toString(message)
    });
  }
  get minDate() {
    let min = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "min") {
        if (min === null || ch.value > min)
          min = ch.value;
      }
    }
    return min != null ? new Date(min) : null;
  }
  get maxDate() {
    let max = null;
    for (const ch of this._def.checks) {
      if (ch.kind === "max") {
        if (max === null || ch.value < max)
          max = ch.value;
      }
    }
    return max != null ? new Date(max) : null;
  }
};
ZodDate.create = (params) => {
  return new ZodDate(__spreadValues({
    checks: [],
    coerce: (params == null ? void 0 : params.coerce) || false,
    typeName: ZodFirstPartyTypeKind.ZodDate
  }, processCreateParams(params)));
};
var ZodSymbol = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.symbol) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.symbol,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodSymbol.create = (params) => {
  return new ZodSymbol(__spreadValues({
    typeName: ZodFirstPartyTypeKind.ZodSymbol
  }, processCreateParams(params)));
};
var ZodUndefined = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.undefined) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.undefined,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodUndefined.create = (params) => {
  return new ZodUndefined(__spreadValues({
    typeName: ZodFirstPartyTypeKind.ZodUndefined
  }, processCreateParams(params)));
};
var ZodNull = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.null) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.null,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodNull.create = (params) => {
  return new ZodNull(__spreadValues({
    typeName: ZodFirstPartyTypeKind.ZodNull
  }, processCreateParams(params)));
};
var ZodAny = class extends ZodType {
  constructor() {
    super(...arguments);
    this._any = true;
  }
  _parse(input) {
    return OK(input.data);
  }
};
ZodAny.create = (params) => {
  return new ZodAny(__spreadValues({
    typeName: ZodFirstPartyTypeKind.ZodAny
  }, processCreateParams(params)));
};
var ZodUnknown = class extends ZodType {
  constructor() {
    super(...arguments);
    this._unknown = true;
  }
  _parse(input) {
    return OK(input.data);
  }
};
ZodUnknown.create = (params) => {
  return new ZodUnknown(__spreadValues({
    typeName: ZodFirstPartyTypeKind.ZodUnknown
  }, processCreateParams(params)));
};
var ZodNever = class extends ZodType {
  _parse(input) {
    const ctx = this._getOrReturnCtx(input);
    addIssueToContext(ctx, {
      code: ZodIssueCode.invalid_type,
      expected: ZodParsedType.never,
      received: ctx.parsedType
    });
    return INVALID;
  }
};
ZodNever.create = (params) => {
  return new ZodNever(__spreadValues({
    typeName: ZodFirstPartyTypeKind.ZodNever
  }, processCreateParams(params)));
};
var ZodVoid = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.undefined) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.void,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return OK(input.data);
  }
};
ZodVoid.create = (params) => {
  return new ZodVoid(__spreadValues({
    typeName: ZodFirstPartyTypeKind.ZodVoid
  }, processCreateParams(params)));
};
var ZodArray = class _ZodArray extends ZodType {
  _parse(input) {
    const { ctx, status } = this._processInputParams(input);
    const def = this._def;
    if (ctx.parsedType !== ZodParsedType.array) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.array,
        received: ctx.parsedType
      });
      return INVALID;
    }
    if (def.exactLength !== null) {
      const tooBig = ctx.data.length > def.exactLength.value;
      const tooSmall = ctx.data.length < def.exactLength.value;
      if (tooBig || tooSmall) {
        addIssueToContext(ctx, {
          code: tooBig ? ZodIssueCode.too_big : ZodIssueCode.too_small,
          minimum: tooSmall ? def.exactLength.value : void 0,
          maximum: tooBig ? def.exactLength.value : void 0,
          type: "array",
          inclusive: true,
          exact: true,
          message: def.exactLength.message
        });
        status.dirty();
      }
    }
    if (def.minLength !== null) {
      if (ctx.data.length < def.minLength.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_small,
          minimum: def.minLength.value,
          type: "array",
          inclusive: true,
          exact: false,
          message: def.minLength.message
        });
        status.dirty();
      }
    }
    if (def.maxLength !== null) {
      if (ctx.data.length > def.maxLength.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_big,
          maximum: def.maxLength.value,
          type: "array",
          inclusive: true,
          exact: false,
          message: def.maxLength.message
        });
        status.dirty();
      }
    }
    if (ctx.common.async) {
      return Promise.all([...ctx.data].map((item, i) => {
        return def.type._parseAsync(new ParseInputLazyPath(ctx, item, ctx.path, i));
      })).then((result2) => {
        return ParseStatus.mergeArray(status, result2);
      });
    }
    const result = [...ctx.data].map((item, i) => {
      return def.type._parseSync(new ParseInputLazyPath(ctx, item, ctx.path, i));
    });
    return ParseStatus.mergeArray(status, result);
  }
  get element() {
    return this._def.type;
  }
  min(minLength, message) {
    return new _ZodArray(__spreadProps(__spreadValues({}, this._def), {
      minLength: { value: minLength, message: errorUtil.toString(message) }
    }));
  }
  max(maxLength, message) {
    return new _ZodArray(__spreadProps(__spreadValues({}, this._def), {
      maxLength: { value: maxLength, message: errorUtil.toString(message) }
    }));
  }
  length(len, message) {
    return new _ZodArray(__spreadProps(__spreadValues({}, this._def), {
      exactLength: { value: len, message: errorUtil.toString(message) }
    }));
  }
  nonempty(message) {
    return this.min(1, message);
  }
};
ZodArray.create = (schema, params) => {
  return new ZodArray(__spreadValues({
    type: schema,
    minLength: null,
    maxLength: null,
    exactLength: null,
    typeName: ZodFirstPartyTypeKind.ZodArray
  }, processCreateParams(params)));
};
function deepPartialify(schema) {
  if (schema instanceof ZodObject) {
    const newShape = {};
    for (const key in schema.shape) {
      const fieldSchema = schema.shape[key];
      newShape[key] = ZodOptional.create(deepPartialify(fieldSchema));
    }
    return new ZodObject(__spreadProps(__spreadValues({}, schema._def), {
      shape: () => newShape
    }));
  } else if (schema instanceof ZodArray) {
    return new ZodArray(__spreadProps(__spreadValues({}, schema._def), {
      type: deepPartialify(schema.element)
    }));
  } else if (schema instanceof ZodOptional) {
    return ZodOptional.create(deepPartialify(schema.unwrap()));
  } else if (schema instanceof ZodNullable) {
    return ZodNullable.create(deepPartialify(schema.unwrap()));
  } else if (schema instanceof ZodTuple) {
    return ZodTuple.create(schema.items.map((item) => deepPartialify(item)));
  } else {
    return schema;
  }
}
var ZodObject = class _ZodObject extends ZodType {
  constructor() {
    super(...arguments);
    this._cached = null;
    this.nonstrict = this.passthrough;
    this.augment = this.extend;
  }
  _getCached() {
    if (this._cached !== null)
      return this._cached;
    const shape = this._def.shape();
    const keys = util.objectKeys(shape);
    this._cached = { shape, keys };
    return this._cached;
  }
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.object) {
      const ctx2 = this._getOrReturnCtx(input);
      addIssueToContext(ctx2, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx2.parsedType
      });
      return INVALID;
    }
    const { status, ctx } = this._processInputParams(input);
    const { shape, keys: shapeKeys } = this._getCached();
    const extraKeys = [];
    if (!(this._def.catchall instanceof ZodNever && this._def.unknownKeys === "strip")) {
      for (const key in ctx.data) {
        if (!shapeKeys.includes(key)) {
          extraKeys.push(key);
        }
      }
    }
    const pairs = [];
    for (const key of shapeKeys) {
      const keyValidator = shape[key];
      const value = ctx.data[key];
      pairs.push({
        key: { status: "valid", value: key },
        value: keyValidator._parse(new ParseInputLazyPath(ctx, value, ctx.path, key)),
        alwaysSet: key in ctx.data
      });
    }
    if (this._def.catchall instanceof ZodNever) {
      const unknownKeys = this._def.unknownKeys;
      if (unknownKeys === "passthrough") {
        for (const key of extraKeys) {
          pairs.push({
            key: { status: "valid", value: key },
            value: { status: "valid", value: ctx.data[key] }
          });
        }
      } else if (unknownKeys === "strict") {
        if (extraKeys.length > 0) {
          addIssueToContext(ctx, {
            code: ZodIssueCode.unrecognized_keys,
            keys: extraKeys
          });
          status.dirty();
        }
      } else if (unknownKeys === "strip") {
      } else {
        throw new Error(`Internal ZodObject error: invalid unknownKeys value.`);
      }
    } else {
      const catchall = this._def.catchall;
      for (const key of extraKeys) {
        const value = ctx.data[key];
        pairs.push({
          key: { status: "valid", value: key },
          value: catchall._parse(
            new ParseInputLazyPath(ctx, value, ctx.path, key)
            //, ctx.child(key), value, getParsedType(value)
          ),
          alwaysSet: key in ctx.data
        });
      }
    }
    if (ctx.common.async) {
      return Promise.resolve().then(async () => {
        const syncPairs = [];
        for (const pair of pairs) {
          const key = await pair.key;
          const value = await pair.value;
          syncPairs.push({
            key,
            value,
            alwaysSet: pair.alwaysSet
          });
        }
        return syncPairs;
      }).then((syncPairs) => {
        return ParseStatus.mergeObjectSync(status, syncPairs);
      });
    } else {
      return ParseStatus.mergeObjectSync(status, pairs);
    }
  }
  get shape() {
    return this._def.shape();
  }
  strict(message) {
    errorUtil.errToObj;
    return new _ZodObject(__spreadValues(__spreadProps(__spreadValues({}, this._def), {
      unknownKeys: "strict"
    }), message !== void 0 ? {
      errorMap: (issue, ctx) => {
        var _a, _b, _c, _d;
        const defaultError = (_c = (_b = (_a = this._def).errorMap) == null ? void 0 : _b.call(_a, issue, ctx).message) != null ? _c : ctx.defaultError;
        if (issue.code === "unrecognized_keys")
          return {
            message: (_d = errorUtil.errToObj(message).message) != null ? _d : defaultError
          };
        return {
          message: defaultError
        };
      }
    } : {}));
  }
  strip() {
    return new _ZodObject(__spreadProps(__spreadValues({}, this._def), {
      unknownKeys: "strip"
    }));
  }
  passthrough() {
    return new _ZodObject(__spreadProps(__spreadValues({}, this._def), {
      unknownKeys: "passthrough"
    }));
  }
  // const AugmentFactory =
  //   <Def extends ZodObjectDef>(def: Def) =>
  //   <Augmentation extends ZodRawShape>(
  //     augmentation: Augmentation
  //   ): ZodObject<
  //     extendShape<ReturnType<Def["shape"]>, Augmentation>,
  //     Def["unknownKeys"],
  //     Def["catchall"]
  //   > => {
  //     return new ZodObject({
  //       ...def,
  //       shape: () => ({
  //         ...def.shape(),
  //         ...augmentation,
  //       }),
  //     }) as any;
  //   };
  extend(augmentation) {
    return new _ZodObject(__spreadProps(__spreadValues({}, this._def), {
      shape: () => __spreadValues(__spreadValues({}, this._def.shape()), augmentation)
    }));
  }
  /**
   * Prior to zod@1.0.12 there was a bug in the
   * inferred type of merged objects. Please
   * upgrade if you are experiencing issues.
   */
  merge(merging) {
    const merged = new _ZodObject({
      unknownKeys: merging._def.unknownKeys,
      catchall: merging._def.catchall,
      shape: () => __spreadValues(__spreadValues({}, this._def.shape()), merging._def.shape()),
      typeName: ZodFirstPartyTypeKind.ZodObject
    });
    return merged;
  }
  // merge<
  //   Incoming extends AnyZodObject,
  //   Augmentation extends Incoming["shape"],
  //   NewOutput extends {
  //     [k in keyof Augmentation | keyof Output]: k extends keyof Augmentation
  //       ? Augmentation[k]["_output"]
  //       : k extends keyof Output
  //       ? Output[k]
  //       : never;
  //   },
  //   NewInput extends {
  //     [k in keyof Augmentation | keyof Input]: k extends keyof Augmentation
  //       ? Augmentation[k]["_input"]
  //       : k extends keyof Input
  //       ? Input[k]
  //       : never;
  //   }
  // >(
  //   merging: Incoming
  // ): ZodObject<
  //   extendShape<T, ReturnType<Incoming["_def"]["shape"]>>,
  //   Incoming["_def"]["unknownKeys"],
  //   Incoming["_def"]["catchall"],
  //   NewOutput,
  //   NewInput
  // > {
  //   const merged: any = new ZodObject({
  //     unknownKeys: merging._def.unknownKeys,
  //     catchall: merging._def.catchall,
  //     shape: () =>
  //       objectUtil.mergeShapes(this._def.shape(), merging._def.shape()),
  //     typeName: ZodFirstPartyTypeKind.ZodObject,
  //   }) as any;
  //   return merged;
  // }
  setKey(key, schema) {
    return this.augment({ [key]: schema });
  }
  // merge<Incoming extends AnyZodObject>(
  //   merging: Incoming
  // ): //ZodObject<T & Incoming["_shape"], UnknownKeys, Catchall> = (merging) => {
  // ZodObject<
  //   extendShape<T, ReturnType<Incoming["_def"]["shape"]>>,
  //   Incoming["_def"]["unknownKeys"],
  //   Incoming["_def"]["catchall"]
  // > {
  //   // const mergedShape = objectUtil.mergeShapes(
  //   //   this._def.shape(),
  //   //   merging._def.shape()
  //   // );
  //   const merged: any = new ZodObject({
  //     unknownKeys: merging._def.unknownKeys,
  //     catchall: merging._def.catchall,
  //     shape: () =>
  //       objectUtil.mergeShapes(this._def.shape(), merging._def.shape()),
  //     typeName: ZodFirstPartyTypeKind.ZodObject,
  //   }) as any;
  //   return merged;
  // }
  catchall(index) {
    return new _ZodObject(__spreadProps(__spreadValues({}, this._def), {
      catchall: index
    }));
  }
  pick(mask) {
    const shape = {};
    for (const key of util.objectKeys(mask)) {
      if (mask[key] && this.shape[key]) {
        shape[key] = this.shape[key];
      }
    }
    return new _ZodObject(__spreadProps(__spreadValues({}, this._def), {
      shape: () => shape
    }));
  }
  omit(mask) {
    const shape = {};
    for (const key of util.objectKeys(this.shape)) {
      if (!mask[key]) {
        shape[key] = this.shape[key];
      }
    }
    return new _ZodObject(__spreadProps(__spreadValues({}, this._def), {
      shape: () => shape
    }));
  }
  /**
   * @deprecated
   */
  deepPartial() {
    return deepPartialify(this);
  }
  partial(mask) {
    const newShape = {};
    for (const key of util.objectKeys(this.shape)) {
      const fieldSchema = this.shape[key];
      if (mask && !mask[key]) {
        newShape[key] = fieldSchema;
      } else {
        newShape[key] = fieldSchema.optional();
      }
    }
    return new _ZodObject(__spreadProps(__spreadValues({}, this._def), {
      shape: () => newShape
    }));
  }
  required(mask) {
    const newShape = {};
    for (const key of util.objectKeys(this.shape)) {
      if (mask && !mask[key]) {
        newShape[key] = this.shape[key];
      } else {
        const fieldSchema = this.shape[key];
        let newField = fieldSchema;
        while (newField instanceof ZodOptional) {
          newField = newField._def.innerType;
        }
        newShape[key] = newField;
      }
    }
    return new _ZodObject(__spreadProps(__spreadValues({}, this._def), {
      shape: () => newShape
    }));
  }
  keyof() {
    return createZodEnum(util.objectKeys(this.shape));
  }
};
ZodObject.create = (shape, params) => {
  return new ZodObject(__spreadValues({
    shape: () => shape,
    unknownKeys: "strip",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject
  }, processCreateParams(params)));
};
ZodObject.strictCreate = (shape, params) => {
  return new ZodObject(__spreadValues({
    shape: () => shape,
    unknownKeys: "strict",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject
  }, processCreateParams(params)));
};
ZodObject.lazycreate = (shape, params) => {
  return new ZodObject(__spreadValues({
    shape,
    unknownKeys: "strip",
    catchall: ZodNever.create(),
    typeName: ZodFirstPartyTypeKind.ZodObject
  }, processCreateParams(params)));
};
var ZodUnion = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const options = this._def.options;
    function handleResults(results) {
      for (const result of results) {
        if (result.result.status === "valid") {
          return result.result;
        }
      }
      for (const result of results) {
        if (result.result.status === "dirty") {
          ctx.common.issues.push(...result.ctx.common.issues);
          return result.result;
        }
      }
      const unionErrors = results.map((result) => new ZodError(result.ctx.common.issues));
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union,
        unionErrors
      });
      return INVALID;
    }
    if (ctx.common.async) {
      return Promise.all(options.map(async (option) => {
        const childCtx = __spreadProps(__spreadValues({}, ctx), {
          common: __spreadProps(__spreadValues({}, ctx.common), {
            issues: []
          }),
          parent: null
        });
        return {
          result: await option._parseAsync({
            data: ctx.data,
            path: ctx.path,
            parent: childCtx
          }),
          ctx: childCtx
        };
      })).then(handleResults);
    } else {
      let dirty = void 0;
      const issues = [];
      for (const option of options) {
        const childCtx = __spreadProps(__spreadValues({}, ctx), {
          common: __spreadProps(__spreadValues({}, ctx.common), {
            issues: []
          }),
          parent: null
        });
        const result = option._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: childCtx
        });
        if (result.status === "valid") {
          return result;
        } else if (result.status === "dirty" && !dirty) {
          dirty = { result, ctx: childCtx };
        }
        if (childCtx.common.issues.length) {
          issues.push(childCtx.common.issues);
        }
      }
      if (dirty) {
        ctx.common.issues.push(...dirty.ctx.common.issues);
        return dirty.result;
      }
      const unionErrors = issues.map((issues2) => new ZodError(issues2));
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union,
        unionErrors
      });
      return INVALID;
    }
  }
  get options() {
    return this._def.options;
  }
};
ZodUnion.create = (types, params) => {
  return new ZodUnion(__spreadValues({
    options: types,
    typeName: ZodFirstPartyTypeKind.ZodUnion
  }, processCreateParams(params)));
};
var getDiscriminator = (type) => {
  if (type instanceof ZodLazy) {
    return getDiscriminator(type.schema);
  } else if (type instanceof ZodEffects) {
    return getDiscriminator(type.innerType());
  } else if (type instanceof ZodLiteral) {
    return [type.value];
  } else if (type instanceof ZodEnum) {
    return type.options;
  } else if (type instanceof ZodNativeEnum) {
    return util.objectValues(type.enum);
  } else if (type instanceof ZodDefault) {
    return getDiscriminator(type._def.innerType);
  } else if (type instanceof ZodUndefined) {
    return [void 0];
  } else if (type instanceof ZodNull) {
    return [null];
  } else if (type instanceof ZodOptional) {
    return [void 0, ...getDiscriminator(type.unwrap())];
  } else if (type instanceof ZodNullable) {
    return [null, ...getDiscriminator(type.unwrap())];
  } else if (type instanceof ZodBranded) {
    return getDiscriminator(type.unwrap());
  } else if (type instanceof ZodReadonly) {
    return getDiscriminator(type.unwrap());
  } else if (type instanceof ZodCatch) {
    return getDiscriminator(type._def.innerType);
  } else {
    return [];
  }
};
var ZodDiscriminatedUnion = class _ZodDiscriminatedUnion extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.object) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const discriminator = this.discriminator;
    const discriminatorValue = ctx.data[discriminator];
    const option = this.optionsMap.get(discriminatorValue);
    if (!option) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_union_discriminator,
        options: Array.from(this.optionsMap.keys()),
        path: [discriminator]
      });
      return INVALID;
    }
    if (ctx.common.async) {
      return option._parseAsync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
    } else {
      return option._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
    }
  }
  get discriminator() {
    return this._def.discriminator;
  }
  get options() {
    return this._def.options;
  }
  get optionsMap() {
    return this._def.optionsMap;
  }
  /**
   * The constructor of the discriminated union schema. Its behaviour is very similar to that of the normal z.union() constructor.
   * However, it only allows a union of objects, all of which need to share a discriminator property. This property must
   * have a different value for each object in the union.
   * @param discriminator the name of the discriminator property
   * @param types an array of object schemas
   * @param params
   */
  static create(discriminator, options, params) {
    const optionsMap = /* @__PURE__ */ new Map();
    for (const type of options) {
      const discriminatorValues = getDiscriminator(type.shape[discriminator]);
      if (!discriminatorValues.length) {
        throw new Error(`A discriminator value for key \`${discriminator}\` could not be extracted from all schema options`);
      }
      for (const value of discriminatorValues) {
        if (optionsMap.has(value)) {
          throw new Error(`Discriminator property ${String(discriminator)} has duplicate value ${String(value)}`);
        }
        optionsMap.set(value, type);
      }
    }
    return new _ZodDiscriminatedUnion(__spreadValues({
      typeName: ZodFirstPartyTypeKind.ZodDiscriminatedUnion,
      discriminator,
      options,
      optionsMap
    }, processCreateParams(params)));
  }
};
function mergeValues(a, b) {
  const aType = getParsedType(a);
  const bType = getParsedType(b);
  if (a === b) {
    return { valid: true, data: a };
  } else if (aType === ZodParsedType.object && bType === ZodParsedType.object) {
    const bKeys = util.objectKeys(b);
    const sharedKeys = util.objectKeys(a).filter((key) => bKeys.indexOf(key) !== -1);
    const newObj = __spreadValues(__spreadValues({}, a), b);
    for (const key of sharedKeys) {
      const sharedValue = mergeValues(a[key], b[key]);
      if (!sharedValue.valid) {
        return { valid: false };
      }
      newObj[key] = sharedValue.data;
    }
    return { valid: true, data: newObj };
  } else if (aType === ZodParsedType.array && bType === ZodParsedType.array) {
    if (a.length !== b.length) {
      return { valid: false };
    }
    const newArray = [];
    for (let index = 0; index < a.length; index++) {
      const itemA = a[index];
      const itemB = b[index];
      const sharedValue = mergeValues(itemA, itemB);
      if (!sharedValue.valid) {
        return { valid: false };
      }
      newArray.push(sharedValue.data);
    }
    return { valid: true, data: newArray };
  } else if (aType === ZodParsedType.date && bType === ZodParsedType.date && +a === +b) {
    return { valid: true, data: a };
  } else {
    return { valid: false };
  }
}
var ZodIntersection = class extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    const handleParsed = (parsedLeft, parsedRight) => {
      if (isAborted(parsedLeft) || isAborted(parsedRight)) {
        return INVALID;
      }
      const merged = mergeValues(parsedLeft.value, parsedRight.value);
      if (!merged.valid) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.invalid_intersection_types
        });
        return INVALID;
      }
      if (isDirty(parsedLeft) || isDirty(parsedRight)) {
        status.dirty();
      }
      return { status: status.value, value: merged.data };
    };
    if (ctx.common.async) {
      return Promise.all([
        this._def.left._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        }),
        this._def.right._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        })
      ]).then(([left, right]) => handleParsed(left, right));
    } else {
      return handleParsed(this._def.left._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      }), this._def.right._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      }));
    }
  }
};
ZodIntersection.create = (left, right, params) => {
  return new ZodIntersection(__spreadValues({
    left,
    right,
    typeName: ZodFirstPartyTypeKind.ZodIntersection
  }, processCreateParams(params)));
};
var ZodTuple = class _ZodTuple extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.array) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.array,
        received: ctx.parsedType
      });
      return INVALID;
    }
    if (ctx.data.length < this._def.items.length) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.too_small,
        minimum: this._def.items.length,
        inclusive: true,
        exact: false,
        type: "array"
      });
      return INVALID;
    }
    const rest = this._def.rest;
    if (!rest && ctx.data.length > this._def.items.length) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.too_big,
        maximum: this._def.items.length,
        inclusive: true,
        exact: false,
        type: "array"
      });
      status.dirty();
    }
    const items = [...ctx.data].map((item, itemIndex) => {
      const schema = this._def.items[itemIndex] || this._def.rest;
      if (!schema)
        return null;
      return schema._parse(new ParseInputLazyPath(ctx, item, ctx.path, itemIndex));
    }).filter((x) => !!x);
    if (ctx.common.async) {
      return Promise.all(items).then((results) => {
        return ParseStatus.mergeArray(status, results);
      });
    } else {
      return ParseStatus.mergeArray(status, items);
    }
  }
  get items() {
    return this._def.items;
  }
  rest(rest) {
    return new _ZodTuple(__spreadProps(__spreadValues({}, this._def), {
      rest
    }));
  }
};
ZodTuple.create = (schemas, params) => {
  if (!Array.isArray(schemas)) {
    throw new Error("You must pass an array of schemas to z.tuple([ ... ])");
  }
  return new ZodTuple(__spreadValues({
    items: schemas,
    typeName: ZodFirstPartyTypeKind.ZodTuple,
    rest: null
  }, processCreateParams(params)));
};
var ZodRecord = class _ZodRecord extends ZodType {
  get keySchema() {
    return this._def.keyType;
  }
  get valueSchema() {
    return this._def.valueType;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.object) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.object,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const pairs = [];
    const keyType = this._def.keyType;
    const valueType = this._def.valueType;
    for (const key in ctx.data) {
      pairs.push({
        key: keyType._parse(new ParseInputLazyPath(ctx, key, ctx.path, key)),
        value: valueType._parse(new ParseInputLazyPath(ctx, ctx.data[key], ctx.path, key)),
        alwaysSet: key in ctx.data
      });
    }
    if (ctx.common.async) {
      return ParseStatus.mergeObjectAsync(status, pairs);
    } else {
      return ParseStatus.mergeObjectSync(status, pairs);
    }
  }
  get element() {
    return this._def.valueType;
  }
  static create(first, second, third) {
    if (second instanceof ZodType) {
      return new _ZodRecord(__spreadValues({
        keyType: first,
        valueType: second,
        typeName: ZodFirstPartyTypeKind.ZodRecord
      }, processCreateParams(third)));
    }
    return new _ZodRecord(__spreadValues({
      keyType: ZodString.create(),
      valueType: first,
      typeName: ZodFirstPartyTypeKind.ZodRecord
    }, processCreateParams(second)));
  }
};
var ZodMap = class extends ZodType {
  get keySchema() {
    return this._def.keyType;
  }
  get valueSchema() {
    return this._def.valueType;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.map) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.map,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const keyType = this._def.keyType;
    const valueType = this._def.valueType;
    const pairs = [...ctx.data.entries()].map(([key, value], index) => {
      return {
        key: keyType._parse(new ParseInputLazyPath(ctx, key, ctx.path, [index, "key"])),
        value: valueType._parse(new ParseInputLazyPath(ctx, value, ctx.path, [index, "value"]))
      };
    });
    if (ctx.common.async) {
      const finalMap = /* @__PURE__ */ new Map();
      return Promise.resolve().then(async () => {
        for (const pair of pairs) {
          const key = await pair.key;
          const value = await pair.value;
          if (key.status === "aborted" || value.status === "aborted") {
            return INVALID;
          }
          if (key.status === "dirty" || value.status === "dirty") {
            status.dirty();
          }
          finalMap.set(key.value, value.value);
        }
        return { status: status.value, value: finalMap };
      });
    } else {
      const finalMap = /* @__PURE__ */ new Map();
      for (const pair of pairs) {
        const key = pair.key;
        const value = pair.value;
        if (key.status === "aborted" || value.status === "aborted") {
          return INVALID;
        }
        if (key.status === "dirty" || value.status === "dirty") {
          status.dirty();
        }
        finalMap.set(key.value, value.value);
      }
      return { status: status.value, value: finalMap };
    }
  }
};
ZodMap.create = (keyType, valueType, params) => {
  return new ZodMap(__spreadValues({
    valueType,
    keyType,
    typeName: ZodFirstPartyTypeKind.ZodMap
  }, processCreateParams(params)));
};
var ZodSet = class _ZodSet extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.set) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.set,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const def = this._def;
    if (def.minSize !== null) {
      if (ctx.data.size < def.minSize.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_small,
          minimum: def.minSize.value,
          type: "set",
          inclusive: true,
          exact: false,
          message: def.minSize.message
        });
        status.dirty();
      }
    }
    if (def.maxSize !== null) {
      if (ctx.data.size > def.maxSize.value) {
        addIssueToContext(ctx, {
          code: ZodIssueCode.too_big,
          maximum: def.maxSize.value,
          type: "set",
          inclusive: true,
          exact: false,
          message: def.maxSize.message
        });
        status.dirty();
      }
    }
    const valueType = this._def.valueType;
    function finalizeSet(elements2) {
      const parsedSet = /* @__PURE__ */ new Set();
      for (const element of elements2) {
        if (element.status === "aborted")
          return INVALID;
        if (element.status === "dirty")
          status.dirty();
        parsedSet.add(element.value);
      }
      return { status: status.value, value: parsedSet };
    }
    const elements = [...ctx.data.values()].map((item, i) => valueType._parse(new ParseInputLazyPath(ctx, item, ctx.path, i)));
    if (ctx.common.async) {
      return Promise.all(elements).then((elements2) => finalizeSet(elements2));
    } else {
      return finalizeSet(elements);
    }
  }
  min(minSize, message) {
    return new _ZodSet(__spreadProps(__spreadValues({}, this._def), {
      minSize: { value: minSize, message: errorUtil.toString(message) }
    }));
  }
  max(maxSize, message) {
    return new _ZodSet(__spreadProps(__spreadValues({}, this._def), {
      maxSize: { value: maxSize, message: errorUtil.toString(message) }
    }));
  }
  size(size, message) {
    return this.min(size, message).max(size, message);
  }
  nonempty(message) {
    return this.min(1, message);
  }
};
ZodSet.create = (valueType, params) => {
  return new ZodSet(__spreadValues({
    valueType,
    minSize: null,
    maxSize: null,
    typeName: ZodFirstPartyTypeKind.ZodSet
  }, processCreateParams(params)));
};
var ZodFunction = class _ZodFunction extends ZodType {
  constructor() {
    super(...arguments);
    this.validate = this.implement;
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.function) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.function,
        received: ctx.parsedType
      });
      return INVALID;
    }
    function makeArgsIssue(args, error) {
      return makeIssue({
        data: args,
        path: ctx.path,
        errorMaps: [ctx.common.contextualErrorMap, ctx.schemaErrorMap, getErrorMap(), en_default].filter((x) => !!x),
        issueData: {
          code: ZodIssueCode.invalid_arguments,
          argumentsError: error
        }
      });
    }
    function makeReturnsIssue(returns, error) {
      return makeIssue({
        data: returns,
        path: ctx.path,
        errorMaps: [ctx.common.contextualErrorMap, ctx.schemaErrorMap, getErrorMap(), en_default].filter((x) => !!x),
        issueData: {
          code: ZodIssueCode.invalid_return_type,
          returnTypeError: error
        }
      });
    }
    const params = { errorMap: ctx.common.contextualErrorMap };
    const fn = ctx.data;
    if (this._def.returns instanceof ZodPromise) {
      const me = this;
      return OK(async function(...args) {
        const error = new ZodError([]);
        const parsedArgs = await me._def.args.parseAsync(args, params).catch((e) => {
          error.addIssue(makeArgsIssue(args, e));
          throw error;
        });
        const result = await Reflect.apply(fn, this, parsedArgs);
        const parsedReturns = await me._def.returns._def.type.parseAsync(result, params).catch((e) => {
          error.addIssue(makeReturnsIssue(result, e));
          throw error;
        });
        return parsedReturns;
      });
    } else {
      const me = this;
      return OK(function(...args) {
        const parsedArgs = me._def.args.safeParse(args, params);
        if (!parsedArgs.success) {
          throw new ZodError([makeArgsIssue(args, parsedArgs.error)]);
        }
        const result = Reflect.apply(fn, this, parsedArgs.data);
        const parsedReturns = me._def.returns.safeParse(result, params);
        if (!parsedReturns.success) {
          throw new ZodError([makeReturnsIssue(result, parsedReturns.error)]);
        }
        return parsedReturns.data;
      });
    }
  }
  parameters() {
    return this._def.args;
  }
  returnType() {
    return this._def.returns;
  }
  args(...items) {
    return new _ZodFunction(__spreadProps(__spreadValues({}, this._def), {
      args: ZodTuple.create(items).rest(ZodUnknown.create())
    }));
  }
  returns(returnType) {
    return new _ZodFunction(__spreadProps(__spreadValues({}, this._def), {
      returns: returnType
    }));
  }
  implement(func) {
    const validatedFunc = this.parse(func);
    return validatedFunc;
  }
  strictImplement(func) {
    const validatedFunc = this.parse(func);
    return validatedFunc;
  }
  static create(args, returns, params) {
    return new _ZodFunction(__spreadValues({
      args: args ? args : ZodTuple.create([]).rest(ZodUnknown.create()),
      returns: returns || ZodUnknown.create(),
      typeName: ZodFirstPartyTypeKind.ZodFunction
    }, processCreateParams(params)));
  }
};
var ZodLazy = class extends ZodType {
  get schema() {
    return this._def.getter();
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const lazySchema = this._def.getter();
    return lazySchema._parse({ data: ctx.data, path: ctx.path, parent: ctx });
  }
};
ZodLazy.create = (getter, params) => {
  return new ZodLazy(__spreadValues({
    getter,
    typeName: ZodFirstPartyTypeKind.ZodLazy
  }, processCreateParams(params)));
};
var ZodLiteral = class extends ZodType {
  _parse(input) {
    if (input.data !== this._def.value) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_literal,
        expected: this._def.value
      });
      return INVALID;
    }
    return { status: "valid", value: input.data };
  }
  get value() {
    return this._def.value;
  }
};
ZodLiteral.create = (value, params) => {
  return new ZodLiteral(__spreadValues({
    value,
    typeName: ZodFirstPartyTypeKind.ZodLiteral
  }, processCreateParams(params)));
};
function createZodEnum(values, params) {
  return new ZodEnum(__spreadValues({
    values,
    typeName: ZodFirstPartyTypeKind.ZodEnum
  }, processCreateParams(params)));
}
var ZodEnum = class _ZodEnum extends ZodType {
  _parse(input) {
    if (typeof input.data !== "string") {
      const ctx = this._getOrReturnCtx(input);
      const expectedValues = this._def.values;
      addIssueToContext(ctx, {
        expected: util.joinValues(expectedValues),
        received: ctx.parsedType,
        code: ZodIssueCode.invalid_type
      });
      return INVALID;
    }
    if (!this._cache) {
      this._cache = new Set(this._def.values);
    }
    if (!this._cache.has(input.data)) {
      const ctx = this._getOrReturnCtx(input);
      const expectedValues = this._def.values;
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_enum_value,
        options: expectedValues
      });
      return INVALID;
    }
    return OK(input.data);
  }
  get options() {
    return this._def.values;
  }
  get enum() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  get Values() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  get Enum() {
    const enumValues = {};
    for (const val of this._def.values) {
      enumValues[val] = val;
    }
    return enumValues;
  }
  extract(values, newDef = this._def) {
    return _ZodEnum.create(values, __spreadValues(__spreadValues({}, this._def), newDef));
  }
  exclude(values, newDef = this._def) {
    return _ZodEnum.create(this.options.filter((opt) => !values.includes(opt)), __spreadValues(__spreadValues({}, this._def), newDef));
  }
};
ZodEnum.create = createZodEnum;
var ZodNativeEnum = class extends ZodType {
  _parse(input) {
    const nativeEnumValues = util.getValidEnumValues(this._def.values);
    const ctx = this._getOrReturnCtx(input);
    if (ctx.parsedType !== ZodParsedType.string && ctx.parsedType !== ZodParsedType.number) {
      const expectedValues = util.objectValues(nativeEnumValues);
      addIssueToContext(ctx, {
        expected: util.joinValues(expectedValues),
        received: ctx.parsedType,
        code: ZodIssueCode.invalid_type
      });
      return INVALID;
    }
    if (!this._cache) {
      this._cache = new Set(util.getValidEnumValues(this._def.values));
    }
    if (!this._cache.has(input.data)) {
      const expectedValues = util.objectValues(nativeEnumValues);
      addIssueToContext(ctx, {
        received: ctx.data,
        code: ZodIssueCode.invalid_enum_value,
        options: expectedValues
      });
      return INVALID;
    }
    return OK(input.data);
  }
  get enum() {
    return this._def.values;
  }
};
ZodNativeEnum.create = (values, params) => {
  return new ZodNativeEnum(__spreadValues({
    values,
    typeName: ZodFirstPartyTypeKind.ZodNativeEnum
  }, processCreateParams(params)));
};
var ZodPromise = class extends ZodType {
  unwrap() {
    return this._def.type;
  }
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    if (ctx.parsedType !== ZodParsedType.promise && ctx.common.async === false) {
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.promise,
        received: ctx.parsedType
      });
      return INVALID;
    }
    const promisified = ctx.parsedType === ZodParsedType.promise ? ctx.data : Promise.resolve(ctx.data);
    return OK(promisified.then((data) => {
      return this._def.type.parseAsync(data, {
        path: ctx.path,
        errorMap: ctx.common.contextualErrorMap
      });
    }));
  }
};
ZodPromise.create = (schema, params) => {
  return new ZodPromise(__spreadValues({
    type: schema,
    typeName: ZodFirstPartyTypeKind.ZodPromise
  }, processCreateParams(params)));
};
var ZodEffects = class extends ZodType {
  innerType() {
    return this._def.schema;
  }
  sourceType() {
    return this._def.schema._def.typeName === ZodFirstPartyTypeKind.ZodEffects ? this._def.schema.sourceType() : this._def.schema;
  }
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    const effect = this._def.effect || null;
    const checkCtx = {
      addIssue: (arg) => {
        addIssueToContext(ctx, arg);
        if (arg.fatal) {
          status.abort();
        } else {
          status.dirty();
        }
      },
      get path() {
        return ctx.path;
      }
    };
    checkCtx.addIssue = checkCtx.addIssue.bind(checkCtx);
    if (effect.type === "preprocess") {
      const processed = effect.transform(ctx.data, checkCtx);
      if (ctx.common.async) {
        return Promise.resolve(processed).then(async (processed2) => {
          if (status.value === "aborted")
            return INVALID;
          const result = await this._def.schema._parseAsync({
            data: processed2,
            path: ctx.path,
            parent: ctx
          });
          if (result.status === "aborted")
            return INVALID;
          if (result.status === "dirty")
            return DIRTY(result.value);
          if (status.value === "dirty")
            return DIRTY(result.value);
          return result;
        });
      } else {
        if (status.value === "aborted")
          return INVALID;
        const result = this._def.schema._parseSync({
          data: processed,
          path: ctx.path,
          parent: ctx
        });
        if (result.status === "aborted")
          return INVALID;
        if (result.status === "dirty")
          return DIRTY(result.value);
        if (status.value === "dirty")
          return DIRTY(result.value);
        return result;
      }
    }
    if (effect.type === "refinement") {
      const executeRefinement = (acc) => {
        const result = effect.refinement(acc, checkCtx);
        if (ctx.common.async) {
          return Promise.resolve(result);
        }
        if (result instanceof Promise) {
          throw new Error("Async refinement encountered during synchronous parse operation. Use .parseAsync instead.");
        }
        return acc;
      };
      if (ctx.common.async === false) {
        const inner = this._def.schema._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (inner.status === "aborted")
          return INVALID;
        if (inner.status === "dirty")
          status.dirty();
        executeRefinement(inner.value);
        return { status: status.value, value: inner.value };
      } else {
        return this._def.schema._parseAsync({ data: ctx.data, path: ctx.path, parent: ctx }).then((inner) => {
          if (inner.status === "aborted")
            return INVALID;
          if (inner.status === "dirty")
            status.dirty();
          return executeRefinement(inner.value).then(() => {
            return { status: status.value, value: inner.value };
          });
        });
      }
    }
    if (effect.type === "transform") {
      if (ctx.common.async === false) {
        const base = this._def.schema._parseSync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (!isValid(base))
          return INVALID;
        const result = effect.transform(base.value, checkCtx);
        if (result instanceof Promise) {
          throw new Error(`Asynchronous transform encountered during synchronous parse operation. Use .parseAsync instead.`);
        }
        return { status: status.value, value: result };
      } else {
        return this._def.schema._parseAsync({ data: ctx.data, path: ctx.path, parent: ctx }).then((base) => {
          if (!isValid(base))
            return INVALID;
          return Promise.resolve(effect.transform(base.value, checkCtx)).then((result) => ({
            status: status.value,
            value: result
          }));
        });
      }
    }
    util.assertNever(effect);
  }
};
ZodEffects.create = (schema, effect, params) => {
  return new ZodEffects(__spreadValues({
    schema,
    typeName: ZodFirstPartyTypeKind.ZodEffects,
    effect
  }, processCreateParams(params)));
};
ZodEffects.createWithPreprocess = (preprocess, schema, params) => {
  return new ZodEffects(__spreadValues({
    schema,
    effect: { type: "preprocess", transform: preprocess },
    typeName: ZodFirstPartyTypeKind.ZodEffects
  }, processCreateParams(params)));
};
var ZodOptional = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType === ZodParsedType.undefined) {
      return OK(void 0);
    }
    return this._def.innerType._parse(input);
  }
  unwrap() {
    return this._def.innerType;
  }
};
ZodOptional.create = (type, params) => {
  return new ZodOptional(__spreadValues({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodOptional
  }, processCreateParams(params)));
};
var ZodNullable = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType === ZodParsedType.null) {
      return OK(null);
    }
    return this._def.innerType._parse(input);
  }
  unwrap() {
    return this._def.innerType;
  }
};
ZodNullable.create = (type, params) => {
  return new ZodNullable(__spreadValues({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodNullable
  }, processCreateParams(params)));
};
var ZodDefault = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    let data = ctx.data;
    if (ctx.parsedType === ZodParsedType.undefined) {
      data = this._def.defaultValue();
    }
    return this._def.innerType._parse({
      data,
      path: ctx.path,
      parent: ctx
    });
  }
  removeDefault() {
    return this._def.innerType;
  }
};
ZodDefault.create = (type, params) => {
  return new ZodDefault(__spreadValues({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodDefault,
    defaultValue: typeof params.default === "function" ? params.default : () => params.default
  }, processCreateParams(params)));
};
var ZodCatch = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const newCtx = __spreadProps(__spreadValues({}, ctx), {
      common: __spreadProps(__spreadValues({}, ctx.common), {
        issues: []
      })
    });
    const result = this._def.innerType._parse({
      data: newCtx.data,
      path: newCtx.path,
      parent: __spreadValues({}, newCtx)
    });
    if (isAsync(result)) {
      return result.then((result2) => {
        return {
          status: "valid",
          value: result2.status === "valid" ? result2.value : this._def.catchValue({
            get error() {
              return new ZodError(newCtx.common.issues);
            },
            input: newCtx.data
          })
        };
      });
    } else {
      return {
        status: "valid",
        value: result.status === "valid" ? result.value : this._def.catchValue({
          get error() {
            return new ZodError(newCtx.common.issues);
          },
          input: newCtx.data
        })
      };
    }
  }
  removeCatch() {
    return this._def.innerType;
  }
};
ZodCatch.create = (type, params) => {
  return new ZodCatch(__spreadValues({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodCatch,
    catchValue: typeof params.catch === "function" ? params.catch : () => params.catch
  }, processCreateParams(params)));
};
var ZodNaN = class extends ZodType {
  _parse(input) {
    const parsedType = this._getType(input);
    if (parsedType !== ZodParsedType.nan) {
      const ctx = this._getOrReturnCtx(input);
      addIssueToContext(ctx, {
        code: ZodIssueCode.invalid_type,
        expected: ZodParsedType.nan,
        received: ctx.parsedType
      });
      return INVALID;
    }
    return { status: "valid", value: input.data };
  }
};
ZodNaN.create = (params) => {
  return new ZodNaN(__spreadValues({
    typeName: ZodFirstPartyTypeKind.ZodNaN
  }, processCreateParams(params)));
};
var BRAND = /* @__PURE__ */ Symbol("zod_brand");
var ZodBranded = class extends ZodType {
  _parse(input) {
    const { ctx } = this._processInputParams(input);
    const data = ctx.data;
    return this._def.type._parse({
      data,
      path: ctx.path,
      parent: ctx
    });
  }
  unwrap() {
    return this._def.type;
  }
};
var ZodPipeline = class _ZodPipeline extends ZodType {
  _parse(input) {
    const { status, ctx } = this._processInputParams(input);
    if (ctx.common.async) {
      const handleAsync = async () => {
        const inResult = await this._def.in._parseAsync({
          data: ctx.data,
          path: ctx.path,
          parent: ctx
        });
        if (inResult.status === "aborted")
          return INVALID;
        if (inResult.status === "dirty") {
          status.dirty();
          return DIRTY(inResult.value);
        } else {
          return this._def.out._parseAsync({
            data: inResult.value,
            path: ctx.path,
            parent: ctx
          });
        }
      };
      return handleAsync();
    } else {
      const inResult = this._def.in._parseSync({
        data: ctx.data,
        path: ctx.path,
        parent: ctx
      });
      if (inResult.status === "aborted")
        return INVALID;
      if (inResult.status === "dirty") {
        status.dirty();
        return {
          status: "dirty",
          value: inResult.value
        };
      } else {
        return this._def.out._parseSync({
          data: inResult.value,
          path: ctx.path,
          parent: ctx
        });
      }
    }
  }
  static create(a, b) {
    return new _ZodPipeline({
      in: a,
      out: b,
      typeName: ZodFirstPartyTypeKind.ZodPipeline
    });
  }
};
var ZodReadonly = class extends ZodType {
  _parse(input) {
    const result = this._def.innerType._parse(input);
    const freeze = (data) => {
      if (isValid(data)) {
        data.value = Object.freeze(data.value);
      }
      return data;
    };
    return isAsync(result) ? result.then((data) => freeze(data)) : freeze(result);
  }
  unwrap() {
    return this._def.innerType;
  }
};
ZodReadonly.create = (type, params) => {
  return new ZodReadonly(__spreadValues({
    innerType: type,
    typeName: ZodFirstPartyTypeKind.ZodReadonly
  }, processCreateParams(params)));
};
function cleanParams(params, data) {
  const p = typeof params === "function" ? params(data) : typeof params === "string" ? { message: params } : params;
  const p2 = typeof p === "string" ? { message: p } : p;
  return p2;
}
function custom(check, _params = {}, fatal) {
  if (check)
    return ZodAny.create().superRefine((data, ctx) => {
      var _a, _b;
      const r = check(data);
      if (r instanceof Promise) {
        return r.then((r2) => {
          var _a2, _b2;
          if (!r2) {
            const params = cleanParams(_params, data);
            const _fatal = (_b2 = (_a2 = params.fatal) != null ? _a2 : fatal) != null ? _b2 : true;
            ctx.addIssue(__spreadProps(__spreadValues({ code: "custom" }, params), { fatal: _fatal }));
          }
        });
      }
      if (!r) {
        const params = cleanParams(_params, data);
        const _fatal = (_b = (_a = params.fatal) != null ? _a : fatal) != null ? _b : true;
        ctx.addIssue(__spreadProps(__spreadValues({ code: "custom" }, params), { fatal: _fatal }));
      }
      return;
    });
  return ZodAny.create();
}
var late = {
  object: ZodObject.lazycreate
};
var ZodFirstPartyTypeKind;
(function(ZodFirstPartyTypeKind2) {
  ZodFirstPartyTypeKind2["ZodString"] = "ZodString";
  ZodFirstPartyTypeKind2["ZodNumber"] = "ZodNumber";
  ZodFirstPartyTypeKind2["ZodNaN"] = "ZodNaN";
  ZodFirstPartyTypeKind2["ZodBigInt"] = "ZodBigInt";
  ZodFirstPartyTypeKind2["ZodBoolean"] = "ZodBoolean";
  ZodFirstPartyTypeKind2["ZodDate"] = "ZodDate";
  ZodFirstPartyTypeKind2["ZodSymbol"] = "ZodSymbol";
  ZodFirstPartyTypeKind2["ZodUndefined"] = "ZodUndefined";
  ZodFirstPartyTypeKind2["ZodNull"] = "ZodNull";
  ZodFirstPartyTypeKind2["ZodAny"] = "ZodAny";
  ZodFirstPartyTypeKind2["ZodUnknown"] = "ZodUnknown";
  ZodFirstPartyTypeKind2["ZodNever"] = "ZodNever";
  ZodFirstPartyTypeKind2["ZodVoid"] = "ZodVoid";
  ZodFirstPartyTypeKind2["ZodArray"] = "ZodArray";
  ZodFirstPartyTypeKind2["ZodObject"] = "ZodObject";
  ZodFirstPartyTypeKind2["ZodUnion"] = "ZodUnion";
  ZodFirstPartyTypeKind2["ZodDiscriminatedUnion"] = "ZodDiscriminatedUnion";
  ZodFirstPartyTypeKind2["ZodIntersection"] = "ZodIntersection";
  ZodFirstPartyTypeKind2["ZodTuple"] = "ZodTuple";
  ZodFirstPartyTypeKind2["ZodRecord"] = "ZodRecord";
  ZodFirstPartyTypeKind2["ZodMap"] = "ZodMap";
  ZodFirstPartyTypeKind2["ZodSet"] = "ZodSet";
  ZodFirstPartyTypeKind2["ZodFunction"] = "ZodFunction";
  ZodFirstPartyTypeKind2["ZodLazy"] = "ZodLazy";
  ZodFirstPartyTypeKind2["ZodLiteral"] = "ZodLiteral";
  ZodFirstPartyTypeKind2["ZodEnum"] = "ZodEnum";
  ZodFirstPartyTypeKind2["ZodEffects"] = "ZodEffects";
  ZodFirstPartyTypeKind2["ZodNativeEnum"] = "ZodNativeEnum";
  ZodFirstPartyTypeKind2["ZodOptional"] = "ZodOptional";
  ZodFirstPartyTypeKind2["ZodNullable"] = "ZodNullable";
  ZodFirstPartyTypeKind2["ZodDefault"] = "ZodDefault";
  ZodFirstPartyTypeKind2["ZodCatch"] = "ZodCatch";
  ZodFirstPartyTypeKind2["ZodPromise"] = "ZodPromise";
  ZodFirstPartyTypeKind2["ZodBranded"] = "ZodBranded";
  ZodFirstPartyTypeKind2["ZodPipeline"] = "ZodPipeline";
  ZodFirstPartyTypeKind2["ZodReadonly"] = "ZodReadonly";
})(ZodFirstPartyTypeKind || (ZodFirstPartyTypeKind = {}));
var instanceOfType = (cls, params = {
  message: `Input not instance of ${cls.name}`
}) => custom((data) => data instanceof cls, params);
var stringType = ZodString.create;
var numberType = ZodNumber.create;
var nanType = ZodNaN.create;
var bigIntType = ZodBigInt.create;
var booleanType = ZodBoolean.create;
var dateType = ZodDate.create;
var symbolType = ZodSymbol.create;
var undefinedType = ZodUndefined.create;
var nullType = ZodNull.create;
var anyType = ZodAny.create;
var unknownType = ZodUnknown.create;
var neverType = ZodNever.create;
var voidType = ZodVoid.create;
var arrayType = ZodArray.create;
var objectType = ZodObject.create;
var strictObjectType = ZodObject.strictCreate;
var unionType = ZodUnion.create;
var discriminatedUnionType = ZodDiscriminatedUnion.create;
var intersectionType = ZodIntersection.create;
var tupleType = ZodTuple.create;
var recordType = ZodRecord.create;
var mapType = ZodMap.create;
var setType = ZodSet.create;
var functionType = ZodFunction.create;
var lazyType = ZodLazy.create;
var literalType = ZodLiteral.create;
var enumType = ZodEnum.create;
var nativeEnumType = ZodNativeEnum.create;
var promiseType = ZodPromise.create;
var effectsType = ZodEffects.create;
var optionalType = ZodOptional.create;
var nullableType = ZodNullable.create;
var preprocessType = ZodEffects.createWithPreprocess;
var pipelineType = ZodPipeline.create;
var ostring = () => stringType().optional();
var onumber = () => numberType().optional();
var oboolean = () => booleanType().optional();
var coerce = {
  string: ((arg) => ZodString.create(__spreadProps(__spreadValues({}, arg), { coerce: true }))),
  number: ((arg) => ZodNumber.create(__spreadProps(__spreadValues({}, arg), { coerce: true }))),
  boolean: ((arg) => ZodBoolean.create(__spreadProps(__spreadValues({}, arg), {
    coerce: true
  }))),
  bigint: ((arg) => ZodBigInt.create(__spreadProps(__spreadValues({}, arg), { coerce: true }))),
  date: ((arg) => ZodDate.create(__spreadProps(__spreadValues({}, arg), { coerce: true })))
};
var NEVER = INVALID;

// ../../packages/shared/dist/schemas/auth.js
var LoginSchema = external_exports.object({
  email: external_exports.string().email(),
  password: external_exports.string().min(8)
});
var LoginTotpSchema = external_exports.object({
  token: external_exports.string().length(6).regex(/^\d+$/),
  tempToken: external_exports.string()
});
var ForgotPasswordSchema = external_exports.object({
  email: external_exports.string().email()
});
var ResetPasswordSchema = external_exports.object({
  token: external_exports.string().min(1),
  password: external_exports.string().min(8)
});
var AcceptInviteSchema = external_exports.object({
  name: external_exports.string().min(1).max(120),
  password: external_exports.string().min(8)
});
var AcceptOwnerInviteSchema = AcceptInviteSchema.extend({
  orgName: external_exports.string().min(2).max(100),
  orgSlug: external_exports.string().min(2).max(50).regex(/^[a-z0-9-]+$/),
  workspaceName: external_exports.string().min(2).max(100),
  workspaceTimezone: external_exports.string().min(1).default("UTC")
});

// ../../packages/shared/dist/types/roles.js
var ORG_ROLES = ["owner", "admin", "member"];
var WORKSPACE_ROLES = ["admin", "editor", "viewer"];

// ../../packages/shared/dist/schemas/user.js
var UserSchema = external_exports.object({
  id: external_exports.string().uuid(),
  orgId: external_exports.string().uuid(),
  email: external_exports.string().email(),
  name: external_exports.string(),
  avatarUrl: external_exports.string().nullable(),
  orgRole: external_exports.enum(ORG_ROLES),
  status: external_exports.enum(["active", "suspended"]),
  totpEnabled: external_exports.boolean(),
  lastLogin: external_exports.string().datetime().nullable()
});
var UpdateUserSchema = external_exports.object({
  name: external_exports.string().min(1).max(120).optional(),
  avatarUrl: external_exports.string().url().nullable().optional()
});

// ../../packages/shared/dist/schemas/org.js
var OrgSchema = external_exports.object({
  id: external_exports.string().uuid(),
  name: external_exports.string(),
  slug: external_exports.string(),
  plan: external_exports.enum(["starter", "pro", "enterprise"]),
  suspendedAt: external_exports.string().datetime().nullable()
});
var CreateOrgSchema = external_exports.object({
  ownerEmail: external_exports.string().email(),
  ownerName: external_exports.string().min(1).max(120)
});
var InviteUserSchema = external_exports.object({
  email: external_exports.string().email(),
  orgRole: external_exports.enum(["admin", "member"])
});

// ../../packages/shared/dist/schemas/management.js
var BrandingFontPresetSchema = external_exports.enum(["modern", "editorial", "geometric", "mono"]);
var assetUrl = external_exports.string().refine((value) => {
  if (value.startsWith("/"))
    return true;
  return /^https?:\/\/\S+$/i.test(value);
}, "Enter a valid URL");
var ManagementCompanySchema = external_exports.object({
  id: external_exports.string().uuid(),
  name: external_exports.string(),
  slug: external_exports.string(),
  plan: external_exports.enum(["starter", "pro", "enterprise"]).default("starter"),
  allowedModules: external_exports.enum(["signage", "pos", "both"]).default("signage"),
  billingEmail: external_exports.string().email().nullable(),
  logoUrl: external_exports.string().nullable().optional(),
  portalTitle: external_exports.string().nullable().optional(),
  faviconUrl: external_exports.string().nullable().optional(),
  primaryColor: external_exports.string().nullable().optional(),
  accentColor: external_exports.string().nullable().optional(),
  sidebarBg: external_exports.string().nullable().optional(),
  headingFontPreset: BrandingFontPresetSchema.nullable().optional(),
  bodyFontPreset: BrandingFontPresetSchema.nullable().optional(),
  loginBackgroundUrl: external_exports.string().nullable().optional(),
  suspendedAt: external_exports.string().datetime().nullable(),
  deletedAt: external_exports.string().datetime().nullable(),
  createdAt: external_exports.string().datetime()
});
var hexColor = external_exports.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a 6-digit hex color like #1f6feb");
var optionalPortalTitle = external_exports.preprocess((value) => typeof value === "string" ? value.trim() : value, external_exports.union([external_exports.literal(""), external_exports.string().min(2, "Portal title must contain at least 2 letters").max(120)]));
var optionalAssetUrl = external_exports.union([external_exports.literal(""), assetUrl]);
var optionalHexColor = external_exports.union([external_exports.literal(""), hexColor]);
var optionalFontPreset = external_exports.union([external_exports.literal(""), BrandingFontPresetSchema]);
var ManagementCompanyBrandingSchema = external_exports.object({
  portalTitle: optionalPortalTitle.nullable().optional(),
  logoUrl: optionalAssetUrl.nullable().optional(),
  faviconUrl: optionalAssetUrl.nullable().optional(),
  primaryColor: optionalHexColor.nullable().optional(),
  accentColor: optionalHexColor.nullable().optional(),
  sidebarBg: optionalHexColor.nullable().optional(),
  headingFontPreset: optionalFontPreset.nullable().optional(),
  bodyFontPreset: optionalFontPreset.nullable().optional(),
  loginBackgroundUrl: optionalAssetUrl.nullable().optional()
});
var CreateManagementCompanySchema = external_exports.object({
  /** The SI/reseller company name — set by the superadmin at creation time */
  companyName: external_exports.string().min(2, "Company name is required").max(120),
  /** email of the first admin to invite immediately after creation */
  initialAdminEmail: external_exports.string().email(),
  initialAdminName: external_exports.string().min(1).max(120),
  plan: external_exports.enum(["starter", "pro", "enterprise"]).default("starter"),
  allowedModules: external_exports.enum(["signage", "pos", "both"]).default("signage")
});
var ManagementCompanyAdminSchema = external_exports.object({
  id: external_exports.string().uuid(),
  managementCompanyId: external_exports.string().uuid(),
  email: external_exports.string().email(),
  name: external_exports.string().nullable(),
  role: external_exports.enum(["owner", "admin", "billing"]),
  lastLogin: external_exports.string().datetime().nullable(),
  suspendedAt: external_exports.string().datetime().nullable(),
  createdAt: external_exports.string().datetime()
});
var InviteManagementCompanyAdminSchema = external_exports.object({
  email: external_exports.string().email(),
  name: external_exports.string().min(1).max(120).optional(),
  role: external_exports.enum(["owner", "admin", "billing"]).default("admin")
});
var AcceptManagementCompanyInviteSchema = external_exports.object({
  name: external_exports.string().min(1, "Your full name is required").max(120),
  password: external_exports.string().min(8, "Password must be at least 8 characters"),
  /** Filled in by the first (owner) admin when the company is still pending setup */
  companyName: external_exports.string().min(2).max(120).optional(),
  companyPortalUrl: external_exports.string().min(2).max(60).regex(/^[a-z0-9-]+$/, "Use lowercase letters, numbers and hyphens only").optional(),
  billingEmail: external_exports.string().email().optional().or(external_exports.literal("")),
  logoUrl: optionalAssetUrl.optional(),
  portalTitle: optionalPortalTitle.optional(),
  faviconUrl: optionalAssetUrl.optional(),
  primaryColor: optionalHexColor.optional(),
  accentColor: optionalHexColor.optional(),
  sidebarBg: optionalHexColor.optional(),
  headingFontPreset: optionalFontPreset.optional(),
  bodyFontPreset: optionalFontPreset.optional(),
  loginBackgroundUrl: optionalAssetUrl.optional(),
  createOwnerDashboardAccount: external_exports.boolean().optional(),
  ownerOrgName: external_exports.string().min(2).max(120).optional().or(external_exports.literal("")),
  ownerOrgSlug: external_exports.string().min(2).max(60).regex(/^[a-z0-9-]+$/, "Use lowercase letters, numbers and hyphens only").optional().or(external_exports.literal("")),
  ownerWorkspaceName: external_exports.string().min(2).max(120).optional().or(external_exports.literal("")),
  ownerWorkspaceTimezone: external_exports.string().min(1).optional().or(external_exports.literal(""))
}).superRefine((value, ctx) => {
  if (!value.createOwnerDashboardAccount)
    return;
  if (!value.ownerOrgName) {
    ctx.addIssue({ code: "custom", path: ["ownerOrgName"], message: "Organization name is required" });
  }
  if (!value.ownerOrgSlug) {
    ctx.addIssue({ code: "custom", path: ["ownerOrgSlug"], message: "Organization slug is required" });
  }
  if (!value.ownerWorkspaceName) {
    ctx.addIssue({ code: "custom", path: ["ownerWorkspaceName"], message: "Workspace name is required" });
  }
  if (!value.ownerWorkspaceTimezone) {
    ctx.addIssue({ code: "custom", path: ["ownerWorkspaceTimezone"], message: "Workspace timezone is required" });
  }
});
var InviteClientOrgOwnerSchema = external_exports.object({
  ownerEmail: external_exports.string().email(),
  ownerName: external_exports.string().min(1).max(120)
});
var AcceptClientOrgInviteSchema = external_exports.object({
  name: external_exports.string().min(1).max(120),
  password: external_exports.string().min(8),
  orgName: external_exports.string().min(2).max(100),
  orgSlug: external_exports.string().min(2).max(50).regex(/^[a-z0-9-]+$/, "Slug must be lowercase letters, numbers, and hyphens"),
  workspaceName: external_exports.string().min(2).max(100),
  workspaceTimezone: external_exports.string().min(1).default("UTC")
});

// ../../packages/shared/dist/schemas/workspace.js
var WorkspaceSchema = external_exports.object({
  id: external_exports.string().uuid(),
  orgId: external_exports.string().uuid(),
  name: external_exports.string(),
  slug: external_exports.string(),
  timezone: external_exports.string()
});
var SmartViewEntityTypeSchema = external_exports.enum(["content", "playlist", "schedule", "device"]);
var SmartViewFiltersSchema = external_exports.record(external_exports.unknown());
var SmartViewSchema = external_exports.object({
  id: external_exports.string().uuid(),
  workspaceId: external_exports.string().uuid(),
  entityType: SmartViewEntityTypeSchema,
  name: external_exports.string().min(1).max(80),
  filters: SmartViewFiltersSchema,
  createdBy: external_exports.string().uuid().nullable().optional(),
  createdAt: external_exports.string(),
  updatedAt: external_exports.string()
});
var CreateSmartViewSchema = external_exports.object({
  workspaceId: external_exports.string().uuid(),
  entityType: SmartViewEntityTypeSchema,
  name: external_exports.string().trim().min(1).max(80),
  filters: SmartViewFiltersSchema.default({})
});
var CreateWorkspaceSchema = external_exports.object({
  name: external_exports.string().min(2).max(100),
  slug: external_exports.string().min(2).max(50).regex(/^[a-z0-9-]+$/),
  timezone: external_exports.string().min(1).default("UTC")
});
var AddWorkspaceMemberSchema = external_exports.object({
  userId: external_exports.string().uuid(),
  role: external_exports.enum(WORKSPACE_ROLES)
});

// ../../packages/shared/dist/schemas/device.js
var DeviceStatusEnum = external_exports.enum(["unclaimed", "online", "offline", "error"]);
var DeviceSchema = external_exports.object({
  id: external_exports.string().uuid(),
  orgId: external_exports.string().uuid().nullable(),
  workspaceId: external_exports.string().uuid().nullable(),
  name: external_exports.string(),
  pairingCode: external_exports.string().nullable(),
  status: DeviceStatusEnum,
  lastSeen: external_exports.string().datetime().nullable(),
  timezone: external_exports.string(),
  resolution: external_exports.string().nullable(),
  firmwareVersion: external_exports.string().nullable(),
  playerVersion: external_exports.string().nullable(),
  ipAddress: external_exports.string().nullable(),
  settings: external_exports.string(),
  // Tizen hardware identity
  duid: external_exports.string().nullable(),
  modelName: external_exports.string().nullable(),
  modelCode: external_exports.string().nullable(),
  serialNumber: external_exports.string().nullable(),
  macAddress: external_exports.string().nullable(),
  // Network
  connectionType: external_exports.enum(["wifi", "ethernet"]).nullable(),
  wifiSsid: external_exports.string().nullable(),
  wifiStrength: external_exports.number().int().nullable(),
  // Display state
  screenOrientation: external_exports.enum(["landscape", "portrait"]).nullable(),
  powerState: external_exports.enum(["on", "off", "standby"]).nullable(),
  irLock: external_exports.boolean(),
  buttonLock: external_exports.boolean(),
  autoPowerOn: external_exports.boolean(),
  // NTP
  ntpEnabled: external_exports.boolean(),
  ntpServer: external_exports.string().nullable(),
  ntpTimezone: external_exports.string().nullable(),
  clockDriftMs: external_exports.number().int().nullable(),
  // Location
  latitude: external_exports.number().nullable(),
  longitude: external_exports.number().nullable(),
  locationLabel: external_exports.string().nullable(),
  // Config
  screenshotIntervalMin: external_exports.number().int().nullable(),
  defaultPlaylistId: external_exports.string().uuid().nullable(),
  publishedContentId: external_exports.string().uuid().nullable(),
  publishedPlaylistId: external_exports.string().uuid().nullable(),
  publishedScheduleId: external_exports.string().uuid().nullable(),
  // On/Off timer slots (populated by mdc_poll, keys are slot numbers 1-7)
  timerSlots: external_exports.record(external_exports.string(), external_exports.object({
    onHour: external_exports.number(),
    onMin: external_exports.number(),
    onEnable: external_exports.boolean(),
    offHour: external_exports.number(),
    offMin: external_exports.number(),
    offEnable: external_exports.boolean(),
    repeat: external_exports.number(),
    volume: external_exports.number(),
    source: external_exports.number(),
    manualDays: external_exports.number()
  })).nullable().optional(),
  createdAt: external_exports.string().datetime(),
  updatedAt: external_exports.string().datetime()
});
var PairRequestSchema = external_exports.object({
  duid: external_exports.string().min(1).nullish(),
  modelName: external_exports.string().nullish(),
  modelCode: external_exports.string().nullish(),
  serialNumber: external_exports.string().nullish(),
  firmwareVersion: external_exports.string().nullish(),
  // ── E-paper extras (optional, sent only by nexari-epaper) ────────────────
  kind: external_exports.enum(["tv", "epaper", "android", "androidtv", "firetv"]).nullish(),
  platform: external_exports.string().nullish(),
  // 'tizen' | 'tizen-epaper' | 'tizen-sbb' | 'android' | 'androidtv' | 'firetv' | 'windows' | ...
  panelW: external_exports.number().int().positive().nullish(),
  panelH: external_exports.number().int().positive().nullish(),
  orientation: external_exports.enum(["landscape", "portrait"]).nullish(),
  epaperApiVersion: external_exports.string().nullish(),
  // ── Windows / desktop player extras (sent by nexari-windows) ─────────────────
  osVersion: external_exports.string().nullish(),
  cpuModel: external_exports.string().nullish(),
  gpuModel: external_exports.string().nullish(),
  displayCount: external_exports.number().int().positive().nullish(),
  primaryDisplayIndex: external_exports.number().int().min(0).nullish(),
  windowsBuild: external_exports.string().nullish(),
  macAddress: external_exports.string().nullish()
});
var DeviceTypeEnum = external_exports.enum(["signage", "kiosk", "kitchen", "order-pad", "menu-board", "pos"]);
var ClaimDeviceSchema = external_exports.object({
  code: external_exports.string().length(6),
  workspaceId: external_exports.string().uuid(),
  name: external_exports.string().min(1).max(255).optional(),
  type: DeviceTypeEnum.optional()
});
var ZoneSourceSchema = external_exports.discriminatedUnion("type", [
  external_exports.object({ type: external_exports.literal("playlist"), playlistId: external_exports.string().uuid(), playlistName: external_exports.string().optional() }),
  external_exports.object({ type: external_exports.literal("content"), contentId: external_exports.string().uuid(), contentName: external_exports.string().optional(), contentType: external_exports.string().optional() }),
  external_exports.object({ type: external_exports.literal("empty") })
]);
var ZoneConfigSchema = external_exports.object({
  id: external_exports.string(),
  rect: external_exports.object({ x: external_exports.number(), y: external_exports.number(), width: external_exports.number(), height: external_exports.number() }),
  label: external_exports.string().nullable().optional(),
  playlistId: external_exports.string().uuid().optional().nullable(),
  // backward compat
  source: ZoneSourceSchema.optional().nullable(),
  syncGroup: external_exports.string().nullable().optional(),
  fitMode: external_exports.enum(["fill", "contain"]).optional().nullable()
  // 'fill' = stretch to zone, 'contain' = letterbox (default)
});
var UpdateDeviceSchema = external_exports.object({
  name: external_exports.string().min(1).max(255).optional(),
  type: DeviceTypeEnum.optional(),
  timezone: external_exports.string().optional(),
  settings: external_exports.string().optional(),
  defaultPlaylistId: external_exports.string().uuid().nullable().optional(),
  screenshotIntervalMin: external_exports.number().int().min(1).nullable().optional(),
  locationLabel: external_exports.string().nullable().optional(),
  latitude: external_exports.number().nullable().optional(),
  longitude: external_exports.number().nullable().optional(),
  zones: external_exports.array(ZoneConfigSchema).nullable().optional()
});
var WindowsPlayerSettingsSchema = external_exports.object({
  /** Register HKCU\Run entry so the player auto-starts after login. */
  autoLaunch: external_exports.boolean().optional(),
  /** Daily reboot time as "HH:MM" (24h) or null to disable. */
  dailyRebootTime: external_exports.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional(),
  /** Hide the OS cursor after a few seconds of inactivity. */
  hideCursor: external_exports.boolean().optional(),
  /** Re-arm powerSaveBlocker on a watchdog so display sleep stays disabled. */
  enforceSleepBlock: external_exports.boolean().optional(),
  /** Swallow Alt+F4, Win, Ctrl+W, F11 in kiosk mode. */
  blockShortcuts: external_exports.boolean().optional(),
  /** SHA-256 hex of the PIN required to exit the kiosk shell. Empty = disabled. */
  exitPinHash: external_exports.string().nullable().optional(),
  /** Disable Chromium HW acceleration (some Intel UHD GPUs glitch on 4K H.264). */
  hardwareAcceleration: external_exports.boolean().optional(),
  /** Renderer rotation in degrees. */
  rotation: external_exports.union([external_exports.literal(0), external_exports.literal(90), external_exports.literal(180), external_exports.literal(270)]).optional(),
  /** File log retention in days (0 = no retention / keep forever). */
  logRetentionDays: external_exports.number().int().min(0).max(365).optional(),
  /** Maximum asset cache size in bytes; LRU evicts when exceeded. */
  assetCacheMaxBytes: external_exports.number().int().min(5e7).optional(),
  /** Optional HTTP proxy for `session.setProxy`. e.g. "http://proxy.lan:8080". */
  proxyUrl: external_exports.string().nullable().optional(),
  /** Display index to render on; null = primary. */
  targetDisplayIndex: external_exports.number().int().min(0).nullable().optional(),
  /** Remote DevTools port (Chromium --remote-debugging-port). null = disabled. */
  remoteDevToolsPort: external_exports.number().int().min(1024).max(65535).nullable().optional()
});
var DeviceCommandSchema = external_exports.discriminatedUnion("command", [
  external_exports.object({ command: external_exports.literal("reboot") }),
  external_exports.object({ command: external_exports.literal("screenshot") }),
  external_exports.object({ command: external_exports.literal("refresh_schedule") }),
  external_exports.object({ command: external_exports.literal("emergency_start"), payload: external_exports.object({ text: external_exports.string().optional(), contentItemId: external_exports.string().uuid().optional() }) }),
  external_exports.object({ command: external_exports.literal("emergency_clear") }),
  external_exports.object({ command: external_exports.literal("relaunch_app") }),
  external_exports.object({ command: external_exports.literal("launch_app"), payload: external_exports.object({ appId: external_exports.string().min(1) }) }),
  external_exports.object({ command: external_exports.literal("power_off") }),
  external_exports.object({ command: external_exports.literal("power_on") }),
  // ── OS-level commands (Windows + Linux desktop) ────────────────────────
  /** Suspend the OS (Windows: SetSuspendState; macOS/Linux: pmset/systemctl). */
  external_exports.object({ command: external_exports.literal("sleep") }),
  /** Toggle the display on/off (DPMS) without shutting down the OS. */
  external_exports.object({ command: external_exports.literal("display_power"), payload: external_exports.object({ on: external_exports.boolean() }) }),
  /** OS-level audio (vs MDC volume which only applies to Samsung TVs). */
  external_exports.object({ command: external_exports.literal("set_system_volume"), payload: external_exports.object({ level: external_exports.number().int().min(0).max(100) }) }),
  external_exports.object({ command: external_exports.literal("set_system_mute"), payload: external_exports.object({ mute: external_exports.boolean() }) }),
  /** DDC/CI brightness on Windows desktop monitors. */
  external_exports.object({ command: external_exports.literal("set_brightness"), payload: external_exports.object({ level: external_exports.number().int().min(0).max(100), displayIndex: external_exports.number().int().min(0).optional() }) }),
  /** Move the player window to a different attached display. */
  external_exports.object({ command: external_exports.literal("set_display"), payload: external_exports.object({ displayIndex: external_exports.number().int().min(0) }) }),
  /** Send a Wake-on-LAN magic packet from this device to the target MAC. */
  external_exports.object({ command: external_exports.literal("wake_on_lan"), payload: external_exports.object({ targetMac: external_exports.string(), broadcastIp: external_exports.string().optional() }) }),
  external_exports.object({ command: external_exports.literal("set_ntp"), payload: external_exports.object({ server: external_exports.string(), timezone: external_exports.string() }) }),
  external_exports.object({ command: external_exports.literal("set_ir_lock"), payload: external_exports.object({ lock: external_exports.boolean() }) }),
  external_exports.object({ command: external_exports.literal("set_button_lock"), payload: external_exports.object({ lock: external_exports.boolean() }) }),
  external_exports.object({ command: external_exports.literal("set_on_timer"), payload: external_exports.object({ slot: external_exports.number().int().min(1).max(7), time: external_exports.string() }) }),
  external_exports.object({ command: external_exports.literal("set_off_timer"), payload: external_exports.object({ slot: external_exports.number().int().min(1).max(7), time: external_exports.string() }) }),
  external_exports.object({ command: external_exports.literal("clear_on_timer"), payload: external_exports.object({ slot: external_exports.number().int().min(1).max(7) }) }),
  external_exports.object({ command: external_exports.literal("clear_off_timer"), payload: external_exports.object({ slot: external_exports.number().int().min(1).max(7) }) }),
  external_exports.object({ command: external_exports.literal("update_tv_firmware") }),
  external_exports.object({ command: external_exports.literal("update_player"), payload: external_exports.object({ version: external_exports.string(), downloadUrl: external_exports.string(), sha256: external_exports.string().regex(/^[a-f0-9]{64}$/i).optional() }) }),
  external_exports.object({ command: external_exports.literal("clear_cache") }),
  external_exports.object({ command: external_exports.literal("dump_logs") }),
  external_exports.object({ command: external_exports.literal("open_settings") }),
  external_exports.object({ command: external_exports.literal("set_screenshot_interval"), payload: external_exports.object({ minutes: external_exports.number().int().min(1) }) }),
  external_exports.object({ command: external_exports.literal("set_zones"), payload: external_exports.object({ zones: external_exports.array(ZoneConfigSchema) }) }),
  external_exports.object({ command: external_exports.literal("set_windows_settings"), payload: external_exports.object({ settings: WindowsPlayerSettingsSchema }) }),
  external_exports.object({
    command: external_exports.literal("mdc_control"),
    payload: external_exports.object({
      action: external_exports.enum([
        "set_volume",
        "set_mute",
        "set_source",
        "set_device_name",
        "standby_set",
        "network_standby_set",
        "remote_control_set",
        "safety_lock_set",
        "osd_display_set",
        "menu_orientation_set",
        "src_orientation_set",
        "url_launcher_address_get",
        "url_launcher_address_set"
      ]),
      level: external_exports.number().int().min(0).max(100).optional(),
      mute: external_exports.boolean().optional(),
      source: external_exports.string().optional(),
      name: external_exports.string().max(15).optional(),
      value: external_exports.number().int().min(0).max(255).optional(),
      osdType: external_exports.number().int().min(0).max(4).optional(),
      osdOnOff: external_exports.number().int().min(0).max(1).optional(),
      urlAddress: external_exports.string().max(200).optional()
    })
  })
]);
var HeartbeatSchema = external_exports.object({
  playerVersion: external_exports.string().optional(),
  firmwareVersion: external_exports.string().optional(),
  timezone: external_exports.string().optional(),
  resolution: external_exports.string().optional(),
  powerState: external_exports.enum(["on", "off", "standby", "sleeping"]).optional(),
  clockDriftMs: external_exports.number().int().optional(),
  irLock: external_exports.boolean().optional(),
  buttonLock: external_exports.boolean().optional(),
  cpuLoad: external_exports.number().min(0).max(100).optional(),
  storageFreeBytes: external_exports.number().int().optional(),
  memoryFreeBytes: external_exports.number().int().optional(),
  memoryTotalBytes: external_exports.number().int().optional(),
  deviceUptimeSec: external_exports.number().int().optional(),
  temperatureCelsius: external_exports.number().optional(),
  currentContentId: external_exports.string().uuid().nullable().optional(),
  nextContentId: external_exports.string().uuid().nullable().optional(),
  nextStartsAt: external_exports.string().datetime().nullable().optional(),
  tvName: external_exports.string().optional(),
  // ── Windows / desktop player heartbeat extras ─────────────────────────────
  systemVolume: external_exports.number().int().min(0).max(100).nullable().optional(),
  systemMuted: external_exports.boolean().nullable().optional(),
  systemBrightness: external_exports.number().int().min(0).max(100).nullable().optional(),
  primaryDisplayIndex: external_exports.number().int().min(0).optional(),
  displayCount: external_exports.number().int().positive().optional(),
  windowsBuild: external_exports.string().optional(),
  /** electron-updater progress 0–100 while a player update is downloading. */
  pendingUpdatePct: external_exports.number().int().min(0).max(100).nullable().optional(),
  // Device kind — TVs / e-paper / android variants. Optional so legacy clients can omit.
  kind: external_exports.enum(["tv", "epaper", "android", "androidtv", "firetv"]).optional(),
  batteryPct: external_exports.number().int().min(0).max(100).nullable().optional(),
  panelW: external_exports.number().int().positive().optional(),
  panelH: external_exports.number().int().positive().optional(),
  // E-paper sleep cycle fields.
  nextWakeAt: external_exports.string().datetime().nullable().optional(),
  lastWakeReason: external_exports.string().nullable().optional()
});
var HeartbeatReadinessSchema = external_exports.object({
  readiness: external_exports.object({
    driftMs: external_exports.number().optional(),
    currentContentId: external_exports.string().uuid().nullable().optional(),
    nextContentId: external_exports.string().uuid().nullable().optional(),
    nextStartsAt: external_exports.string().datetime().nullable().optional()
  })
});
var PlayLogEntrySchema = external_exports.object({
  contentId: external_exports.string().uuid().nullable(),
  playlistId: external_exports.string().uuid().nullable().optional(),
  scheduleId: external_exports.string().uuid().nullable().optional(),
  zoneId: external_exports.string().optional(),
  startedAt: external_exports.string().datetime(),
  endedAt: external_exports.string().datetime(),
  durationMs: external_exports.number().int(),
  completedFull: external_exports.boolean(),
  source: external_exports.enum(["schedule", "playlist", "default", "emergency"])
});
var DeviceMessageSchema = external_exports.discriminatedUnion("type", [
  external_exports.object({ type: external_exports.literal("heartbeat"), payload: external_exports.union([HeartbeatSchema, HeartbeatReadinessSchema]) }),
  external_exports.object({
    type: external_exports.literal("network_info"),
    payload: external_exports.object({
      mac: external_exports.string().optional(),
      ip: external_exports.string().optional(),
      gateway: external_exports.string().optional(),
      dns: external_exports.string().optional(),
      connectionType: external_exports.enum(["wifi", "ethernet"]).optional(),
      wifiSsid: external_exports.string().optional(),
      wifiStrength: external_exports.number().int().optional(),
      serialNumber: external_exports.string().optional()
    })
  }),
  external_exports.object({
    type: external_exports.literal("system_state"),
    payload: external_exports.object({ irLock: external_exports.boolean(), buttonLock: external_exports.boolean(), autoPowerOn: external_exports.boolean() })
  }),
  external_exports.object({
    type: external_exports.literal("screenshot_data"),
    payload: external_exports.object({
      dataBase64: external_exports.string(),
      contentId: external_exports.string().uuid().nullable().optional(),
      trigger: external_exports.enum(["auto_change", "auto_interval", "manual", "live", "content_change", "interval"])
    })
  }),
  external_exports.object({
    type: external_exports.literal("firmware_progress"),
    payload: external_exports.object({
      status: external_exports.enum(["downloading", "installing", "complete", "error"]),
      progressPct: external_exports.number().optional(),
      errorMessage: external_exports.string().optional()
    })
  }),
  external_exports.object({
    type: external_exports.literal("play_log"),
    payload: external_exports.object({ entries: external_exports.array(PlayLogEntrySchema) })
  }),
  external_exports.object({
    type: external_exports.literal("download_progress"),
    payload: external_exports.object({
      contentId: external_exports.string().uuid(),
      progressPct: external_exports.number(),
      bytesDownloaded: external_exports.number().int(),
      totalBytes: external_exports.number().int()
    })
  }),
  external_exports.object({
    type: external_exports.literal("device_log"),
    payload: external_exports.object({
      lines: external_exports.array(external_exports.string()),
      level: external_exports.enum(["debug", "info", "warn", "error"])
    })
  }),
  external_exports.object({
    type: external_exports.literal("ack"),
    payload: external_exports.object({
      commandId: external_exports.string().uuid(),
      success: external_exports.boolean(),
      error: external_exports.string().optional()
    })
  }),
  external_exports.object({
    type: external_exports.literal("mdc_status"),
    payload: external_exports.object({
      requestId: external_exports.string().uuid(),
      ok: external_exports.boolean(),
      nodeRunning: external_exports.boolean().optional(),
      serial: external_exports.string().optional(),
      deviceName: external_exports.string().optional(),
      modelName: external_exports.string().optional(),
      ipAddress: external_exports.string().optional(),
      remoteControl: external_exports.number().int().optional(),
      tvName: external_exports.string().optional(),
      deviceTime: external_exports.string().optional(),
      rawHex: external_exports.string().optional(),
      error: external_exports.string().optional(),
      status: external_exports.object({
        displayId: external_exports.number().int(),
        ack: external_exports.enum(["A", "N"]),
        rCmd: external_exports.number().int(),
        power: external_exports.number().int().optional(),
        volume: external_exports.number().int().optional(),
        mute: external_exports.number().int().optional(),
        input: external_exports.number().int().optional(),
        aspect: external_exports.number().int().optional(),
        nTime: external_exports.number().int().optional(),
        fTime: external_exports.number().int().optional()
      }).optional()
    })
  }),
  external_exports.object({
    type: external_exports.literal("mdc_heartbeat"),
    payload: external_exports.object({
      power: external_exports.number().int().optional(),
      volume: external_exports.number().int().optional(),
      mute: external_exports.number().int().optional(),
      input: external_exports.number().int().optional()
    })
  }),
  external_exports.object({
    type: external_exports.literal("mdc_poll"),
    payload: external_exports.record(external_exports.unknown())
  }),
  external_exports.object({
    type: external_exports.literal("mdc_id_persist"),
    payload: external_exports.object({ mdcId: external_exports.number().int().min(1).max(254) })
  }),
  external_exports.object({
    type: external_exports.literal("mdc_control_response"),
    payload: external_exports.object({
      requestId: external_exports.string(),
      ok: external_exports.boolean(),
      rawHex: external_exports.string().optional(),
      data: external_exports.array(external_exports.number().int()).optional(),
      error: external_exports.string().optional()
    }).passthrough()
  }),
  external_exports.object({
    type: external_exports.literal("tizen_probe_result"),
    payload: external_exports.object({
      requestId: external_exports.string(),
      data: external_exports.record(external_exports.unknown())
    })
  }),
  external_exports.object({
    type: external_exports.literal("tizen_command_result"),
    payload: external_exports.object({
      requestId: external_exports.string(),
      ok: external_exports.boolean(),
      value: external_exports.unknown().optional(),
      error: external_exports.string().optional()
    })
  }),
  // SyncPlay Phase 4: device→server drift/state heartbeat for portal observability.
  // Sent by the leader (and optionally followers) ~1 Hz when WS is reachable; never required for playback.
  external_exports.object({
    type: external_exports.literal("sync_heartbeat"),
    payload: external_exports.object({
      syncGroupId: external_exports.string().uuid(),
      role: external_exports.enum(["leader", "follower"]),
      itemIndex: external_exports.number().int().nonnegative(),
      currentTimeMs: external_exports.number().int().nonnegative(),
      driftMs: external_exports.number().int().optional(),
      playbackRate: external_exports.number().optional(),
      readyState: external_exports.enum(["preparing", "ready", "playing", "error"]).optional(),
      lanIp: external_exports.string().optional()
    })
  }),
  // Calendar push: device asks the server to start streaming live updates for
  // the given calendar content item. The server replies asynchronously with
  // `calendar_events` WS commands (see WsCommand union). Devices send
  // `calendar_unsubscribe` when the calendar leaves the screen.
  external_exports.object({
    type: external_exports.literal("calendar_subscribe"),
    payload: external_exports.object({ contentId: external_exports.string().uuid() })
  }),
  external_exports.object({
    type: external_exports.literal("calendar_unsubscribe"),
    payload: external_exports.object({ contentId: external_exports.string().uuid() })
  }),
  external_exports.object({
    type: external_exports.literal("installed_apps"),
    payload: external_exports.array(external_exports.object({
      id: external_exports.string(),
      name: external_exports.string(),
      version: external_exports.string().nullable().optional(),
      iconPath: external_exports.string().nullable().optional(),
      show: external_exports.boolean().optional(),
      categories: external_exports.array(external_exports.string()).optional()
    }))
  }),
  external_exports.object({
    type: external_exports.literal("ble_scan_result"),
    payload: external_exports.array(external_exports.object({
      uuid: external_exports.string(),
      major: external_exports.number().optional(),
      minor: external_exports.number().optional(),
      rssi: external_exports.number(),
      name: external_exports.string().optional()
    }))
  }),
  external_exports.object({
    type: external_exports.literal("platform_info"),
    payload: external_exports.object({ platform: external_exports.string().optional() }).passthrough()
  })
]);

// ../../packages/shared/dist/schemas/iptv.js
var IptvProtocolEnum = external_exports.enum(["udp", "rtp", "rtsp", "hls", "dash", "http"]);
var IPV4_OCTET = "(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)";
var IPV4_RE = new RegExp(`^${IPV4_OCTET}(?:\\.${IPV4_OCTET}){3}$`);
function isValidIptvUrl(url, protocol) {
  var _a, _b, _c, _d, _e, _f;
  const m = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\/([^/?#]*)([^?#]*)(\?[^#]*)?(#.*)?$/.exec(url);
  if (!m)
    return false;
  const scheme = ((_a = m[1]) != null ? _a : "").toLowerCase();
  const authority = (_b = m[2]) != null ? _b : "";
  const pathQuery = ((_c = m[3]) != null ? _c : "") + ((_d = m[4]) != null ? _d : "");
  const hostPortMatch = /^(?:[^@]*@)?([^:]+)(?::(\d+))?$/.exec(authority);
  const hostname = (_e = hostPortMatch == null ? void 0 : hostPortMatch[1]) != null ? _e : "";
  const port = (_f = hostPortMatch == null ? void 0 : hostPortMatch[2]) != null ? _f : "";
  switch (protocol) {
    case "udp":
    case "rtp":
      if (scheme !== protocol)
        return false;
      if (!hostname || !port)
        return false;
      return true;
    case "rtsp":
      return scheme === "rtsp" && !!hostname;
    case "hls":
      return (scheme === "http" || scheme === "https") && /\.m3u8(\?|$)/i.test(pathQuery);
    case "dash":
      return (scheme === "http" || scheme === "https") && /\.mpd(\?|$)/i.test(pathQuery);
    case "http":
      return scheme === "http" || scheme === "https";
    default:
      return false;
  }
}
var IptvChannelSchema = external_exports.object({
  /** 1-based channel number used for direct tuning. Must be unique within a group. */
  number: external_exports.number().int().min(1).max(9999),
  /** Display name shown in the channel banner. */
  name: external_exports.string().min(1).max(120),
  /** Stream URL appropriate for `protocol`. */
  url: external_exports.string().min(1).max(2048),
  protocol: IptvProtocolEnum,
  /** Optional content item id for a per-channel logo (image content). */
  logoContentId: external_exports.string().uuid().nullish(),
  /** Audio-only / radio channel flag (player may show a static placeholder). */
  audioOnly: external_exports.boolean().optional().default(false),
  /** Hint passed to AVPlay when known (e.g. 'h264', 'hevc'); free-form. */
  codecHint: external_exports.string().max(64).nullish()
}).superRefine((ch, ctx) => {
  if (!isValidIptvUrl(ch.url, ch.protocol)) {
    ctx.addIssue({
      code: external_exports.ZodIssueCode.custom,
      path: ["url"],
      message: `Invalid ${ch.protocol.toUpperCase()} URL`
    });
  }
});
var MAX_CHANNELS_PER_GROUP = 256;
var ChannelGroupMetadataSchema = external_exports.object({
  channels: external_exports.array(IptvChannelSchema).min(1).max(MAX_CHANNELS_PER_GROUP),
  /** Author-set "cold start" channel number; runtime last-played overrides this. */
  defaultChannelNumber: external_exports.number().int().min(1).max(9999)
}).superRefine((meta, ctx) => {
  const seen = /* @__PURE__ */ new Set();
  for (const [i, ch] of meta.channels.entries()) {
    if (seen.has(ch.number)) {
      ctx.addIssue({
        code: external_exports.ZodIssueCode.custom,
        path: ["channels", i, "number"],
        message: `Duplicate channel number ${ch.number}`
      });
    }
    seen.add(ch.number);
  }
  if (!seen.has(meta.defaultChannelNumber)) {
    ctx.addIssue({
      code: external_exports.ZodIssueCode.custom,
      path: ["defaultChannelNumber"],
      message: "defaultChannelNumber must reference an existing channel"
    });
  }
});
var CreateChannelGroupSchema = external_exports.object({
  workspaceId: external_exports.string().uuid(),
  name: external_exports.string().min(1).max(255),
  description: external_exports.string().max(2e3).nullish(),
  folderId: external_exports.string().uuid().nullish(),
  channels: external_exports.array(IptvChannelSchema).min(1).max(MAX_CHANNELS_PER_GROUP),
  defaultChannelNumber: external_exports.number().int().min(1).max(9999)
});
var UpdateChannelGroupSchema = external_exports.object({
  name: external_exports.string().min(1).max(255).optional(),
  description: external_exports.string().max(2e3).nullish(),
  channels: external_exports.array(IptvChannelSchema).min(1).max(MAX_CHANNELS_PER_GROUP).optional(),
  defaultChannelNumber: external_exports.number().int().min(1).max(9999).optional()
});
var ImportM3USchema = external_exports.object({
  /** Raw `#EXTM3U` text body (max 1 MiB). */
  text: external_exports.string().min(7).max(1 * 1024 * 1024)
});

// ../../packages/shared/dist/videowall.js
var DEFAULT_PANEL_W = 1920;
var DEFAULT_PANEL_H = 1080;
function panelLogicalW(m) {
  var _a, _b, _c;
  const rot = (_a = m.tileRotation) != null ? _a : "0";
  const w = (_b = m.nativeWidthPx) != null ? _b : DEFAULT_PANEL_W;
  const h = (_c = m.nativeHeightPx) != null ? _c : DEFAULT_PANEL_H;
  return rot === "90" || rot === "270" ? h : w;
}
function panelLogicalH(m) {
  var _a, _b, _c;
  const rot = (_a = m.tileRotation) != null ? _a : "0";
  const w = (_b = m.nativeWidthPx) != null ? _b : DEFAULT_PANEL_W;
  const h = (_c = m.nativeHeightPx) != null ? _c : DEFAULT_PANEL_H;
  return rot === "90" || rot === "270" ? w : h;
}
function computeCanvasSize(colWidths, rowHeights) {
  const canvasW = colWidths.reduce((s, w) => s + w, 0);
  const canvasH = rowHeights.reduce((s, h) => s + h, 0);
  return { canvasW, canvasH };
}
function computeCellRect(m, colWidths, rowHeights) {
  var _a, _b, _c, _d, _e, _f;
  const col = m.positionCol;
  const row = m.positionRow;
  const colSpan = (_a = m.colSpan) != null ? _a : 1;
  const rowSpan = (_b = m.rowSpan) != null ? _b : 1;
  let x = 0;
  for (let c = 0; c < col; c++)
    x += (_c = colWidths[c]) != null ? _c : 0;
  let y = 0;
  for (let r = 0; r < row; r++)
    y += (_d = rowHeights[r]) != null ? _d : 0;
  let w = 0;
  for (let c = col; c < col + colSpan; c++)
    w += (_e = colWidths[c]) != null ? _e : 0;
  let h = 0;
  for (let r = row; r < row + rowSpan; r++)
    h += (_f = rowHeights[r]) != null ? _f : 0;
  return { x, y, w, h };
}
function computeTileCssTransform(member, colWidths, rowHeights, bezelOffsets) {
  var _a;
  const rect = computeCellRect(member, colWidths, rowHeights);
  const { canvasW, canvasH } = computeCanvasSize(colWidths, rowHeights);
  const panelW = panelLogicalW(member);
  const panelH = panelLogicalH(member);
  const scaleX = bezelOffsets ? (panelW + bezelOffsets.left + bezelOffsets.right) / panelW : 1;
  const scaleY = bezelOffsets ? (panelH + bezelOffsets.top + bezelOffsets.bottom) / panelH : 1;
  const rotation = parseInt((_a = member.tileRotation) != null ? _a : "0", 10) || 0;
  return {
    canvasW,
    canvasH,
    translateX: -rect.x,
    translateY: -rect.y,
    scaleX,
    scaleY,
    rotation
  };
}

// ../../packages/shared/dist/schemas/support.js
var SUPPORT_CATEGORIES = ["bug", "feature_request", "billing", "general"];
var SUPPORT_STATUSES = ["open", "in_progress", "resolved", "closed"];
var SUPPORT_PRIORITIES = ["low", "medium", "high", "urgent"];
var SUPPORT_PARTY_TYPES = ["management_company", "client_org"];
var CreateSupportTicketSchema = external_exports.object({
  partyType: external_exports.enum(SUPPORT_PARTY_TYPES),
  /** Must be provided when partyType='management_company' */
  companyId: external_exports.string().uuid().optional(),
  /** Must be provided when partyType='client_org' */
  orgId: external_exports.string().uuid().optional(),
  /**
   * When a reseller opens a ticket *on behalf of* one of their client orgs
   * the companyId holds the reseller and orgId holds the client org.
   */
  category: external_exports.enum(SUPPORT_CATEGORIES).default("general"),
  subject: external_exports.string().min(5).max(200),
  priority: external_exports.enum(SUPPORT_PRIORITIES).default("medium"),
  /** Optional first message body */
  message: external_exports.string().min(1).max(1e4).optional()
});
var ReplyToTicketSchema = external_exports.object({
  body: external_exports.string().min(1).max(1e4),
  /** Optional array of already-uploaded attachment URLs */
  attachmentUrls: external_exports.array(external_exports.string().url()).max(5).optional()
});
var UpdateTicketSchema = external_exports.object({
  status: external_exports.enum(SUPPORT_STATUSES).optional(),
  priority: external_exports.enum(SUPPORT_PRIORITIES).optional(),
  assignedToOwnerId: external_exports.string().uuid().nullable().optional()
});

// ../../packages/shared/dist/schemas/ruleset.js
var BleBeaconConditionSchema = external_exports.object({
  type: external_exports.literal("ble_beacon"),
  uuid: external_exports.string().uuid(),
  major: external_exports.number().int().optional(),
  minor: external_exports.number().int().optional(),
  name: external_exports.string().optional(),
  rssiThreshold: external_exports.number().optional(),
  distanceMinCm: external_exports.number().nullable().optional(),
  distanceMaxCm: external_exports.number().nullable().optional()
});
var TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
var TimeWindowConditionSchema = external_exports.object({
  type: external_exports.literal("time_window"),
  start: external_exports.string().regex(TIME_RE, "Must be HH:MM"),
  end: external_exports.string().regex(TIME_RE, "Must be HH:MM")
});
var DayOfWeekConditionSchema = external_exports.object({
  type: external_exports.literal("day_of_week"),
  days: external_exports.array(external_exports.number().int().min(0).max(6))
});
var SensorValueConditionSchema = external_exports.object({
  type: external_exports.literal("sensor_value"),
  sensorId: external_exports.string().uuid(),
  field: external_exports.enum(["value", "hour", "day_of_week"]),
  operator: external_exports.enum([">", "<", ">=", "<=", "==", "!="]),
  value: external_exports.number()
});
var DeviceOnlineConditionSchema = external_exports.object({ type: external_exports.literal("device_online") });
var DeviceOfflineConditionSchema = external_exports.object({ type: external_exports.literal("device_offline") });
var COMP_OP = external_exports.enum([">", "<", ">=", "<=", "==", "!="]);
var NUM_OP = external_exports.enum([">", "<", ">=", "<="]);
var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
var WeatherConditionSchema = external_exports.object({
  type: external_exports.literal("weather"),
  field: external_exports.enum(["temperature_c", "humidity_pct", "wind_kph", "condition"]),
  operator: COMP_OP,
  value: external_exports.union([external_exports.number(), external_exports.string()]),
  locationId: external_exports.string().optional()
});
var DateRangeConditionSchema = external_exports.object({
  type: external_exports.literal("date_range"),
  start: external_exports.string().regex(DATE_RE, "Must be YYYY-MM-DD"),
  end: external_exports.string().regex(DATE_RE, "Must be YYYY-MM-DD")
});
var OccupancyConditionSchema = external_exports.object({
  type: external_exports.literal("occupancy"),
  sourceId: external_exports.string().optional(),
  operator: external_exports.enum([">", "<", ">=", "<=", "=="]),
  count: external_exports.number().int().min(0)
});
var DeviceIdleConditionSchema = external_exports.object({
  type: external_exports.literal("device_idle"),
  idleSeconds: external_exports.number().int().min(1)
});
var ScheduleActiveConditionSchema = external_exports.object({
  type: external_exports.literal("schedule_active"),
  scheduleId: external_exports.string().uuid(),
  negate: external_exports.boolean().optional()
});
var ContentFinishedConditionSchema = external_exports.object({
  type: external_exports.literal("content_finished"),
  contentId: external_exports.string().uuid().optional()
});
var HolidayConditionSchema = external_exports.object({
  type: external_exports.literal("holiday"),
  countryCode: external_exports.string().min(2).max(3),
  region: external_exports.string().optional()
});
var SunConditionSchema = external_exports.object({
  type: external_exports.literal("sun"),
  phase: external_exports.enum(["sunrise", "sunset", "before_sunrise", "after_sunset", "daytime", "nighttime"]),
  offsetMinutes: external_exports.number().int().optional()
});
var DeviceGroupStateConditionSchema = external_exports.object({
  type: external_exports.literal("device_group_state"),
  groupId: external_exports.string().uuid(),
  state: external_exports.enum(["all_online", "any_offline", "all_offline", "any_online"])
});
var TagMatchConditionSchema = external_exports.object({
  type: external_exports.literal("tag_match"),
  tagIds: external_exports.array(external_exports.string().uuid()).min(1),
  logic: external_exports.enum(["any", "all"]).optional()
});
var NetworkSpeedConditionSchema = external_exports.object({
  type: external_exports.literal("network_speed"),
  operator: NUM_OP,
  mbps: external_exports.number().min(0)
});
var AudioLevelConditionSchema = external_exports.object({
  type: external_exports.literal("audio_level"),
  operator: NUM_OP,
  db: external_exports.number()
});
var WebhookConditionSchema = external_exports.object({
  type: external_exports.literal("webhook"),
  webhookKey: external_exports.string().min(1).max(100)
});
var BatteryLevelConditionSchema = external_exports.object({
  type: external_exports.literal("battery_level"),
  operator: NUM_OP,
  percent: external_exports.number().min(0).max(100)
});
var DeviceOrientationConditionSchema = external_exports.object({
  type: external_exports.literal("device_orientation"),
  orientation: external_exports.enum(["portrait", "landscape"])
});
var RecurringCronConditionSchema = external_exports.object({
  type: external_exports.literal("recurring_cron"),
  cron: external_exports.string().min(1),
  timezone: external_exports.string().optional()
});
var TemperatureConditionSchema = external_exports.object({
  type: external_exports.literal("temperature"),
  sensorId: external_exports.string().uuid().optional(),
  operator: NUM_OP,
  celsius: external_exports.number()
});
var HumidityConditionSchema = external_exports.object({
  type: external_exports.literal("humidity"),
  sensorId: external_exports.string().uuid().optional(),
  operator: NUM_OP,
  percent: external_exports.number().min(0).max(100)
});
var FaceDetectedConditionSchema = external_exports.object({
  type: external_exports.literal("face_detected"),
  minCount: external_exports.number().int().min(1).optional(),
  ageMin: external_exports.number().int().min(0).max(120).optional(),
  ageMax: external_exports.number().int().min(0).max(120).optional(),
  gender: external_exports.enum(["male", "female", "any"]).optional()
});
var GestureConditionSchema = external_exports.object({
  type: external_exports.literal("gesture"),
  gesture: external_exports.enum(["wave", "swipe_left", "swipe_right", "point", "thumbs_up"])
});
var QrScanConditionSchema = external_exports.object({
  type: external_exports.literal("qr_scan"),
  qrCodeId: external_exports.string().optional()
});
var NfcTapConditionSchema = external_exports.object({
  type: external_exports.literal("nfc_tap"),
  tagId: external_exports.string().optional()
});
var StockLevelConditionSchema = external_exports.object({
  type: external_exports.literal("stock_level"),
  sku: external_exports.string().min(1),
  operator: COMP_OP,
  quantity: external_exports.number().min(0)
});
var PosSaleConditionSchema = external_exports.object({
  type: external_exports.literal("pos_sale"),
  metric: external_exports.enum(["total_amount", "transaction_count", "avg_ticket"]),
  window: external_exports.enum(["minute", "hour", "today"]),
  operator: NUM_OP,
  value: external_exports.number()
});
var TrafficConditionSchema = external_exports.object({
  type: external_exports.literal("traffic"),
  routeId: external_exports.string().min(1),
  operator: NUM_OP,
  delayMinutes: external_exports.number().min(0)
});
var FlightStatusConditionSchema = external_exports.object({
  type: external_exports.literal("flight_status"),
  flightNumber: external_exports.string().optional(),
  gate: external_exports.string().optional(),
  status: external_exports.enum(["on_time", "delayed", "cancelled", "boarding", "departed"])
});
var SocialMentionConditionSchema = external_exports.object({
  type: external_exports.literal("social_mention"),
  platform: external_exports.enum(["twitter", "instagram", "facebook", "tiktok"]),
  handle: external_exports.string().min(1),
  keyword: external_exports.string().optional()
});
var CalendarEventConditionSchema = external_exports.object({
  type: external_exports.literal("calendar_event"),
  calendarId: external_exports.string().min(1),
  eventType: external_exports.enum(["event_active", "event_starting_soon", "event_ended"]),
  windowMinutes: external_exports.number().int().min(0).optional()
});
var StreamHealthConditionSchema = external_exports.object({
  type: external_exports.literal("stream_health"),
  streamId: external_exports.string().min(1),
  state: external_exports.enum(["healthy", "unhealthy"])
});
var GeofenceConditionSchema = external_exports.object({
  type: external_exports.literal("geofence"),
  geofenceId: external_exports.string().min(1),
  transition: external_exports.enum(["enter", "exit", "inside", "outside"])
});
var RuleSetConditionLeafSchema = external_exports.discriminatedUnion("type", [
  BleBeaconConditionSchema,
  TimeWindowConditionSchema,
  DayOfWeekConditionSchema,
  SensorValueConditionSchema,
  DeviceOnlineConditionSchema,
  DeviceOfflineConditionSchema,
  // MVP
  WeatherConditionSchema,
  DateRangeConditionSchema,
  OccupancyConditionSchema,
  DeviceIdleConditionSchema,
  ScheduleActiveConditionSchema,
  ContentFinishedConditionSchema,
  // Nice-to-have
  HolidayConditionSchema,
  SunConditionSchema,
  DeviceGroupStateConditionSchema,
  TagMatchConditionSchema,
  NetworkSpeedConditionSchema,
  AudioLevelConditionSchema,
  WebhookConditionSchema,
  BatteryLevelConditionSchema,
  DeviceOrientationConditionSchema,
  RecurringCronConditionSchema,
  TemperatureConditionSchema,
  HumidityConditionSchema,
  // Good-to-have
  FaceDetectedConditionSchema,
  GestureConditionSchema,
  QrScanConditionSchema,
  NfcTapConditionSchema,
  StockLevelConditionSchema,
  PosSaleConditionSchema,
  TrafficConditionSchema,
  FlightStatusConditionSchema,
  SocialMentionConditionSchema,
  CalendarEventConditionSchema,
  StreamHealthConditionSchema,
  GeofenceConditionSchema
]);
var RuleSetConditionGroupSchema = external_exports.lazy(() => external_exports.object({
  type: external_exports.literal("group"),
  logic: external_exports.enum(["AND", "OR"]),
  children: external_exports.array(external_exports.union([RuleSetConditionLeafSchema, RuleSetConditionGroupSchema])).min(1)
}));
var PlayContentActionSchema = external_exports.object({
  type: external_exports.literal("play_content"),
  contentId: external_exports.string().uuid()
});
var PlayPlaylistActionSchema = external_exports.object({
  type: external_exports.literal("play_playlist"),
  playlistId: external_exports.string().uuid()
});
var PlayScheduleActionSchema = external_exports.object({
  type: external_exports.literal("play_schedule"),
  scheduleId: external_exports.string().uuid()
});
var MessageOverlayActionSchema = external_exports.object({
  type: external_exports.literal("message_overlay"),
  text: external_exports.string().min(1).max(500),
  bgColor: external_exports.string(),
  textColor: external_exports.string(),
  fontSize: external_exports.number().int().min(8).max(200),
  position: external_exports.enum(["top", "bottom", "center", "full"]),
  durationSec: external_exports.number().int().min(0)
});
var DeviceControlActionSchema = external_exports.object({
  type: external_exports.literal("device_control"),
  command: external_exports.enum(["volume", "brightness", "input_source", "power"]),
  value: external_exports.union([external_exports.number(), external_exports.string()])
});
var SendNotificationActionSchema = external_exports.object({
  type: external_exports.literal("send_notification"),
  message: external_exports.string().min(1).max(1e3),
  severity: external_exports.enum(["info", "warn", "critical"]).optional()
});
var EmergencyOverrideActionSchema = external_exports.object({
  type: external_exports.literal("emergency_override"),
  contentId: external_exports.string().uuid(),
  expireAfterSec: external_exports.number().int().min(0).optional()
});
var LaunchAppActionSchema = external_exports.object({
  type: external_exports.literal("launch_app"),
  appId: external_exports.string().min(1),
  appName: external_exports.string().optional()
});
var SetBrightnessScheduleActionSchema = external_exports.object({
  type: external_exports.literal("set_brightness_schedule"),
  mode: external_exports.enum(["auto", "manual", "follow_sun"]),
  manualValue: external_exports.number().int().min(0).max(100).optional()
});
var LogEventActionSchema = external_exports.object({
  type: external_exports.literal("log_event"),
  eventName: external_exports.string().min(1).max(100),
  meta: external_exports.record(external_exports.string(), external_exports.unknown()).optional()
});
var WebhookCallActionSchema = external_exports.object({
  type: external_exports.literal("webhook_call"),
  url: external_exports.string().url(),
  method: external_exports.enum(["GET", "POST", "PUT", "DELETE"]),
  body: external_exports.string().optional(),
  headers: external_exports.record(external_exports.string(), external_exports.string()).optional()
});
var SwitchZoneContentActionSchema = external_exports.object({
  type: external_exports.literal("switch_zone_content"),
  zoneId: external_exports.string().min(1),
  contentId: external_exports.string().uuid()
});
var RecordAnalyticsActionSchema = external_exports.object({
  type: external_exports.literal("record_analytics"),
  metric: external_exports.string().min(1).max(100),
  value: external_exports.number(),
  tags: external_exports.record(external_exports.string(), external_exports.string()).optional()
});
var ChainRuleSetActionSchema = external_exports.object({
  type: external_exports.literal("chain_rule_set"),
  ruleSetId: external_exports.string().uuid()
});
var DelayActionSchema = external_exports.object({
  type: external_exports.literal("delay"),
  seconds: external_exports.number().min(0)
});
var StopPlaybackActionSchema = external_exports.object({ type: external_exports.literal("stop_playback") });
var PausePlaybackActionSchema = external_exports.object({ type: external_exports.literal("pause_playback") });
var FadeVolumeActionSchema = external_exports.object({
  type: external_exports.literal("fade_volume"),
  targetVolume: external_exports.number().int().min(0).max(100),
  durationSeconds: external_exports.number().min(0)
});
var RuleSetActionSchema = external_exports.discriminatedUnion("type", [
  PlayContentActionSchema,
  PlayPlaylistActionSchema,
  PlayScheduleActionSchema,
  MessageOverlayActionSchema,
  DeviceControlActionSchema,
  SendNotificationActionSchema,
  EmergencyOverrideActionSchema,
  LaunchAppActionSchema,
  // MVP
  SetBrightnessScheduleActionSchema,
  LogEventActionSchema,
  WebhookCallActionSchema,
  SwitchZoneContentActionSchema,
  // Nice-to-have
  RecordAnalyticsActionSchema,
  ChainRuleSetActionSchema,
  DelayActionSchema,
  StopPlaybackActionSchema,
  PausePlaybackActionSchema,
  FadeVolumeActionSchema
]);
var CreateRuleSetSchema = external_exports.object({
  workspaceId: external_exports.string().uuid(),
  name: external_exports.string().min(1).max(100),
  description: external_exports.string().max(500).optional(),
  enabled: external_exports.boolean().optional().default(true),
  priority: external_exports.number().int().min(0).max(100).optional().default(0),
  conditions: RuleSetConditionGroupSchema,
  action: RuleSetActionSchema,
  cooldownSeconds: external_exports.number().int().min(0).optional().default(0),
  /** Initial target list — optional on create */
  targets: external_exports.array(external_exports.object({
    targetType: external_exports.enum(["device", "group", "workspace"]),
    targetId: external_exports.string().uuid()
  })).optional().default([])
});
var UpdateRuleSetSchema = CreateRuleSetSchema.omit({ workspaceId: true }).partial();
var SetRuleSetTargetsSchema = external_exports.object({
  targets: external_exports.array(external_exports.object({
    targetType: external_exports.enum(["device", "group", "workspace"]),
    targetId: external_exports.string().uuid()
  }))
});
var CompiledRuleSetSchema = external_exports.object({
  id: external_exports.string().uuid(),
  name: external_exports.string(),
  enabled: external_exports.boolean(),
  priority: external_exports.number().int(),
  conditions: RuleSetConditionGroupSchema,
  action: RuleSetActionSchema,
  cooldownSeconds: external_exports.number().int()
});

// src/sync/sync.ts
var CLOCK_SAMPLES = 7;
var CLOCK_RESYNC_MS = 6e4;
var GO_AHEAD_MS = 1500;
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
var _loopingPhase = false;
var _phaseTimer = null;
var _phaseStartedAt = 0;
var _peerHeads = /* @__PURE__ */ new Map();
var _ewma = 0;
var _ewmaN = 0;
var _peerWatchTimer = null;
var _resyncInProgress = false;
var _playlistUrls = [];
var _wsGen = 0;
var _followerResyncTimer = null;
var _ownLatencyMs = 0;
var _peerLatencies = /* @__PURE__ */ new Map();
async function init(cfg) {
  var _a, _b, _c, _d;
  _cfg = cfg;
  _stopped = false;
  _peers = [];
  _leaderReady = false;
  _followerReady = /* @__PURE__ */ new Set();
  _goSent = false;
  _loadReceived = false;
  _loopingPhase = false;
  _phaseStartedAt = 0;
  _ewma = 0;
  _ewmaN = 0;
  if (_followerResyncTimer) {
    clearTimeout(_followerResyncTimer);
    _followerResyncTimer = null;
  }
  _ownLatencyMs = (_a = cfg.playLatencyMs) != null ? _a : 0;
  _peerLatencies = /* @__PURE__ */ new Map();
  _selfLatency = (_c = cfg.selfLatency) != null ? _c : cfg.playLatencyMs == null ? (_b = DEVICE_LATENCY_MS[cfg.deviceId]) != null ? _b : 0 : 0;
  _role2 = cfg.pinnedLeaderId ? cfg.pinnedLeaderId === cfg.deviceId ? "leader" : "follower" : "pending";
  logger.info(`[Sync] init deviceId=${cfg.deviceId} group=${cfg.groupId} role=${_role2} pinned=${(_d = cfg.pinnedLeaderId) != null ? _d : "none"}`);
  cfg.onStatus("Connecting to relay\u2026");
  setOnLoop(() => {
    if (!_stopped && _loopingPhase) {
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
    _scheduleFollowerResync();
  }
}
function stop() {
  _stopped = true;
  _stopPhase();
  _stopPeerWatch();
  if (_followerResyncTimer) {
    clearTimeout(_followerResyncTimer);
    _followerResyncTimer = null;
  }
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
          _wsSend({ type: "WS_REGISTER", deviceId: _cfg.deviceId, groupId: _cfg.groupId, ip: _cfg.selfIp, playLatencyMs: _ownLatencyMs });
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
var PEER_WAIT_TIMEOUT_MS = 6e3;
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
    if (msg["type"] === "PEERS" && _cfg.playLatencyMs != null) {
      for (const p of msg["peers"]) {
        if (p.deviceId !== _cfg.deviceId && p.playLatencyMs != null) {
          _peerLatencies.set(p.deviceId, p.playLatencyMs);
        }
      }
      _recomputeSelfLatency();
    }
    return;
  }
  logger.info(`[Sync] \u2190 ${msg["type"]} from=${from}`);
  if (msg["type"] === "LOAD_URL") {
    if (_role2 !== "follower") return;
    _loadReceived = true;
    if (_followerResyncTimer) {
      clearTimeout(_followerResyncTimer);
      _followerResyncTimer = null;
    }
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
    _goSent = true;
    _loopingPhase = true;
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
  if (msg["type"] === "RESYNC_REQUEST") {
    if (_role2 !== "leader") return;
    logger.info(`[Sync] RESYNC_REQUEST from ${from} \u2014 resyncing`);
    _resyncLeader().catch(() => {
    });
    return;
  }
  if (msg["type"] === "LOOP_GO") {
    const serverAt = Number(msg["playAt"]);
    const localPlayAt = _serverToLocal(serverAt);
    logger.info(`[Sync] LOOP_GO \u2192 play in T-${Math.round(localPlayAt - Date.now())}ms`);
    _cfg.schedulePlay(localPlayAt);
    _loopingPhase = true;
    _phaseStartedAt = Date.now();
    _ewma = 0;
    _ewmaN = 0;
    return;
  }
}
function _recomputeSelfLatency() {
  if (_cfg.selfLatency != null) return;
  const allMs = [..._peerLatencies.values(), _ownLatencyMs];
  const maxMs = Math.max(...allMs, 0);
  const prev = _selfLatency;
  _selfLatency = Math.max(0, maxMs - _ownLatencyMs);
  if (_selfLatency !== prev) {
    logger.info(`[Sync] latency-cal own=${_ownLatencyMs}ms max=${maxMs}ms selfLatency=${_selfLatency}ms peers=${JSON.stringify(Object.fromEntries(_peerLatencies))}`);
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
  try {
    await _cfg.prepareEngine(url);
  } catch (e) {
    logger.error(`[Sync] leader prepare failed: ${e == null ? void 0 : e.message} \u2014 will retry on next peer scan`);
    return;
  }
  if (_stopped) return;
  logger.info("[Sync] leader engine READY");
  _leaderReady = true;
  _cfg.onStatus(`Leader ready \u2014 waiting for ${_peers.length} follower(s)\u2026`);
  _checkAllReady();
}
function _checkAllReady() {
  if (!_leaderReady || _followerReady.size < _peers.length || _goSent || _stopped) return;
  _goSent = true;
  _loopingPhase = true;
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
    _loopingPhase = false;
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
function _scheduleFollowerResync(delayMs = 4e3) {
  if (_followerResyncTimer) clearTimeout(_followerResyncTimer);
  _followerResyncTimer = setTimeout(() => {
    _followerResyncTimer = null;
    if (_loadReceived || _stopped) return;
    if (_peers.length === 0) {
      _scheduleFollowerResync(3e3);
      return;
    }
    logger.info("[Sync] follower: no LOAD_URL after timeout \u2014 sending RESYNC_REQUEST");
    _wsSend({ type: "RESYNC_REQUEST", groupId: _cfg.groupId, deviceId: _cfg.deviceId });
    _scheduleFollowerResync(5e3);
  }, delayMs);
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
var UPDATE_HOST_ALLOWLIST = ["ds.chiho.app", "updates.chiho.app"];
function isAllowedUpdateUrl(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    return UPDATE_HOST_ALLOWLIST.indexOf(u.hostname) !== -1;
  } catch (e) {
    return false;
  }
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
    this.platform = "";
    /** DB UUID decoded from JWT sub — used as sync relay deviceId so leaderPriority comparison works. */
    this.dbDeviceId = "";
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
    // Stored VIDEOWALL_INIT payload — re-used when fresh content arrives via refresh_schedule.
    this._lastWallMsg = null;
    // Relay info stored when loadContent() finds a cross-OS sync group; consumed by swapToPending().
    this._pendingSyncRelayInfo = null;
    this.pendingSignature = null;
    this.isDownloadingContent = false;
    this.deviceDisplayName = "";
    this.resellerBrandingLogoUrl = null;
    /**
     * In-player settings overlay. Renders device/network/config info, a tail of
     * recent log lines, and technician actions (Re-pair, Reload, Clear logs,
     * open native system settings). Auto-refreshes the log tail every second
     * while visible.
     */
    this.settingsOverlayEl = null;
    this.settingsLogTimer = null;
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
    var _a, _b;
    const info = await this.cfg.adapter.getDeviceInfo();
    this.deviceId = info.deviceId;
    this.platform = info.platform || "";
    this.deviceDisplayName = info.modelName || info.modelCode || "";
    initLogger({ apiBase: this.cfg.apiBase, deviceId: info.deviceId });
    logger.info(`[Player] starting deviceId=${info.deviceId} platform=${info.platform}`);
    this.showIdle("Connecting\u2026");
    void this.syncNtp();
    this.initSettingsGesture(info);
    this.token = await this.ensurePaired();
    logger.info(`[Player] paired (token: ${this.token ? "ok" : "none"})`);
    if (this.token) {
      try {
        const payload = JSON.parse(atob(this.token.split(".")[1]));
        this.dbDeviceId = String((_a = payload["sub"]) != null ? _a : "");
      } catch (e) {
      }
    }
    if (!this.tryLoadCachedSchedule()) this.showIdle("Waiting for content\u2026");
    this.connectWs();
    void this.sendHeartbeat();
    this.heartbeatTimer = setInterval(
      () => this.sendHeartbeat().catch((e) => logger.warn(`[Player] heartbeat: ${e}`)),
      (_b = this.cfg.heartbeatMs) != null ? _b : 3e4
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
        if (!isAllowedUpdateUrl(url)) {
          this.send({ type: "app_update_failed", error: "Download URL host not allowed" });
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
        this._lastWallMsg = msg;
        await this.initVideoWall(msg);
        return;
      case "DEVICE_DELETED":
        logger.warn("[Player] DEVICE_DELETED received \u2014 clearing token and reloading");
        try {
          localStorage.removeItem("nexariToken");
        } catch (e) {
        }
        delete window["__nexariToken"];
        this.token = null;
        try {
          await this.cfg.adapter.reloadRenderer();
        } catch (e) {
        }
        return;
      default:
        await this.dispatchCommand(t, msg["payload"]);
        return;
    }
  }
  async dispatchCommand(command, payload) {
    var _a, _b, _c, _d, _e;
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
      case "update_player": {
        const url = String((_d = (_c = (_b = payload == null ? void 0 : payload["downloadUrl"]) != null ? _b : payload == null ? void 0 : payload["apkUrl"]) != null ? _c : payload == null ? void 0 : payload["wgtUrl"]) != null ? _d : "");
        const version = String((_e = payload == null ? void 0 : payload["version"]) != null ? _e : "");
        const sha256 = payload == null ? void 0 : payload["sha256"];
        if (!url || !version) {
          this.send({ type: "app_update_failed", error: "missing url/version" });
          return;
        }
        if (!isAllowedUpdateUrl(url)) {
          this.send({ type: "app_update_failed", error: "Download URL host not allowed" });
          return;
        }
        const result = await a.installUpdate({ url, version, sha256, onProgress: (p) => this.sendOta(p) });
        this.sendOta(result);
        return;
      }
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
  /**
   * Arm the technician 10-tap gesture: ten taps inside the top-left ZONE
   * within a 3-second window open the in-player settings overlay. Uses
   * capture-phase listeners on `touchstart`, `pointerdown`, and `click` so
   * taps on fullscreen content (video, iframes, images) still register, and
   * accepts touch as well as mouse for desktop QA.
   */
  initSettingsGesture(info) {
    const ZONE = 120;
    const WINDOW_MS = 3e3;
    const TARGET = 10;
    let count = 0;
    let resetTimer = null;
    const trigger = () => {
      count = 0;
      if (resetTimer) {
        clearTimeout(resetTimer);
        resetTimer = null;
      }
      logger.info("[Settings] 10-tap gesture fired \u2014 opening settings overlay");
      try {
        this.showSettingsOverlay();
      } catch (e) {
        logger.warn(`[Settings] overlay failed: ${e.message}`);
      }
    };
    const note = (x, y) => {
      if (x > ZONE || y > ZONE) return;
      count++;
      logger.info(`[Settings] tap ${count}/${TARGET} at (${x | 0},${y | 0})`);
      if (resetTimer) clearTimeout(resetTimer);
      resetTimer = setTimeout(() => {
        count = 0;
        resetTimer = null;
      }, WINDOW_MS);
      if (count >= TARGET) trigger();
    };
    document.addEventListener("touchstart", (e) => {
      const t = e.touches[0];
      if (!t) return;
      note(t.clientX, t.clientY);
    }, { capture: true, passive: true });
    document.addEventListener("pointerdown", (e) => {
      note(e.clientX, e.clientY);
    }, { capture: true, passive: true });
    document.addEventListener("click", (e) => {
      note(e.clientX, e.clientY);
    }, { capture: true });
    logger.info(`[Settings] 10-tap gesture armed (zone=${ZONE}px top-left, window=${WINDOW_MS}ms, platform=${info.platform})`);
  }
  async showSettingsOverlay() {
    var _a, _b, _c, _d, _e, _f;
    if (this.settingsOverlayEl) return;
    const adapter = this.cfg.adapter;
    let info = null;
    let net = null;
    try {
      info = await adapter.getDeviceInfo();
    } catch (e) {
      logger.warn(`[Settings] getDeviceInfo failed: ${e.message}`);
    }
    try {
      net = await adapter.getNetworkInfo();
    } catch (e) {
      logger.warn(`[Settings] getNetworkInfo failed: ${e.message}`);
    }
    const cachedToken = (_a = window["__nexariToken"]) != null ? _a : localStorage.getItem("nexariToken");
    const overlay = document.createElement("div");
    overlay.id = "nexari-settings-overlay";
    overlay.setAttribute("style", [
      "position:fixed",
      "inset:0",
      "z-index:2147483646",
      "background:rgba(0,0,0,0.92)",
      "color:#e6e6e6",
      "font-family:Menlo,Consolas,monospace",
      "font-size:14px",
      "display:flex",
      "flex-direction:column",
      "padding:24px",
      "box-sizing:border-box"
    ].join(";"));
    const esc = (s) => String(s != null ? s : "").replace(/[&<>"']/g, (c) => {
      var _a2;
      return (_a2 = {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
      }[c]) != null ? _a2 : c;
    });
    const tokenDisp = cachedToken ? `${cachedToken.slice(0, 8)}\u2026${cachedToken.slice(-6)}` : "(none)";
    const rows = [
      ["Device ID", esc(info == null ? void 0 : info.deviceId)],
      ["Serial", esc(info == null ? void 0 : info.serialNumber)],
      ["Model", esc((info == null ? void 0 : info.modelName) || (info == null ? void 0 : info.modelCode))],
      ["Platform", esc(info == null ? void 0 : info.platform)],
      ["Player ver", esc(info == null ? void 0 : info.playerVersion)],
      ["Firmware", esc(info == null ? void 0 : info.firmwareVersion)],
      ["IP", esc(net == null ? void 0 : net.ipAddress)],
      ["SSID", esc(net == null ? void 0 : net.ssid)],
      ["Conn type", esc(net == null ? void 0 : net.connectionType)],
      ["API", esc(this.cfg.apiBase)],
      ["WS", esc(this.cfg.wsBase)],
      ["Token", esc(tokenDisp)],
      ["WS state", this.wsReady ? "connected" : "disconnected"]
    ];
    overlay.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
        <div style="font-size:20px;font-weight:600">Nexari Player \u2014 Settings</div>
        <button id="nx-set-close" style="padding:8px 16px;background:#444;color:#fff;border:0;border-radius:4px;font-size:14px;cursor:pointer">Close \u2715</button>
      </div>
      <div style="display:grid;grid-template-columns:140px 1fr;gap:4px 16px;margin-bottom:16px;background:#1a1a1a;padding:12px;border-radius:6px">
        ${rows.map(([k, v]) => `<div style="color:#888">${k}</div><div style="word-break:break-all">${v}</div>`).join("")}
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
        <button id="nx-set-repair" style="padding:10px 16px;background:#a02020;color:#fff;border:0;border-radius:4px;font-size:14px;cursor:pointer">Re-pair (clear token)</button>
        <button id="nx-set-reload" style="padding:10px 16px;background:#2c5fa0;color:#fff;border:0;border-radius:4px;font-size:14px;cursor:pointer">Reload player</button>
        <button id="nx-set-clearlog" style="padding:10px 16px;background:#444;color:#fff;border:0;border-radius:4px;font-size:14px;cursor:pointer">Clear logs</button>
        <button id="nx-set-syspref" style="padding:10px 16px;background:#444;color:#fff;border:0;border-radius:4px;font-size:14px;cursor:pointer">System settings</button>
        <button id="nx-set-pause" style="padding:10px 16px;background:#444;color:#fff;border:0;border-radius:4px;font-size:14px;cursor:pointer">Pause auto-refresh</button>
      </div>
      <div style="color:#888;font-size:12px;margin-bottom:4px">Recent logs (latest at bottom):</div>
      <pre id="nx-set-logs" style="flex:1;overflow:auto;background:#0a0a0a;padding:12px;border-radius:6px;margin:0;white-space:pre-wrap;word-break:break-all;font-size:12px;line-height:1.4"></pre>
    `;
    document.body.appendChild(overlay);
    this.settingsOverlayEl = overlay;
    const close = () => this.hideSettingsOverlay();
    (_b = overlay.querySelector("#nx-set-close")) == null ? void 0 : _b.addEventListener("click", close);
    (_c = overlay.querySelector("#nx-set-reload")) == null ? void 0 : _c.addEventListener("click", () => {
      var _a2;
      logger.info("[Settings] Reload requested from overlay");
      try {
        (_a2 = adapter.reloadRenderer) == null ? void 0 : _a2.call(adapter);
      } catch (e) {
      }
      setTimeout(() => {
        try {
          location.reload();
        } catch (e) {
        }
      }, 300);
    });
    (_d = overlay.querySelector("#nx-set-repair")) == null ? void 0 : _d.addEventListener("click", () => {
      if (!confirm("Clear pairing token and restart? The device will need to be paired again.")) return;
      logger.info("[Settings] Re-pair requested \u2014 clearing token");
      try {
        localStorage.removeItem("nexariToken");
      } catch (e) {
      }
      delete window["__nexariToken"];
      setTimeout(() => {
        var _a2;
        try {
          (_a2 = adapter.reloadRenderer) == null ? void 0 : _a2.call(adapter);
        } catch (e) {
        }
        try {
          location.reload();
        } catch (e) {
        }
      }, 200);
    });
    (_e = overlay.querySelector("#nx-set-clearlog")) == null ? void 0 : _e.addEventListener("click", () => {
      var _a2;
      const buf = window["LogBuffer"];
      (_a2 = buf == null ? void 0 : buf.clear) == null ? void 0 : _a2.call(buf);
      const pre = overlay.querySelector("#nx-set-logs");
      if (pre) pre.textContent = "";
    });
    (_f = overlay.querySelector("#nx-set-syspref")) == null ? void 0 : _f.addEventListener("click", () => {
      if (typeof adapter.openSettings === "function") {
        logger.info("[Settings] Opening native system settings");
        Promise.resolve(adapter.openSettings()).catch((e) => logger.warn(`[Settings] openSettings failed: ${e.message}`));
      } else {
        logger.info("[Settings] System settings not available on this platform");
      }
    });
    const pauseBtn = overlay.querySelector("#nx-set-pause");
    let paused = false;
    pauseBtn == null ? void 0 : pauseBtn.addEventListener("click", () => {
      paused = !paused;
      pauseBtn.textContent = paused ? "Resume auto-refresh" : "Pause auto-refresh";
    });
    const renderLogs = () => {
      var _a2, _b2;
      if (paused) return;
      const buf = window["LogBuffer"];
      const lines = (_b2 = (_a2 = buf == null ? void 0 : buf.tail) == null ? void 0 : _a2.call(buf, 200)) != null ? _b2 : [];
      const pre = overlay.querySelector("#nx-set-logs");
      if (!pre) return;
      pre.textContent = lines.map((e) => {
        var _a3, _b3, _c2;
        return `${(_a3 = e.timestamp) != null ? _a3 : ""} [${((_b3 = e.level) != null ? _b3 : "info").toUpperCase()}] ${(_c2 = e.message) != null ? _c2 : ""}`;
      }).join("\n");
      pre.scrollTop = pre.scrollHeight;
    };
    renderLogs();
    this.settingsLogTimer = setInterval(renderLogs, 1e3);
  }
  hideSettingsOverlay() {
    if (this.settingsLogTimer) {
      clearInterval(this.settingsLogTimer);
      this.settingsLogTimer = null;
    }
    if (this.settingsOverlayEl) {
      try {
        this.settingsOverlayEl.remove();
      } catch (e) {
      }
      this.settingsOverlayEl = null;
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
        syncRelayMode: info.syncRelayMode
      });
      return;
    }
    if (this.syncActive) return;
    if (this._lastWallMsg) {
      void this.initVideoWall(this._lastWallMsg);
      return;
    }
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
      this.preCacheItems(items).catch(() => {
      }).finally(() => {
        if (this.syncActive) return;
        this.cancelPlayback();
        void this.renderPlaylist();
      });
      return true;
    } catch (e) {
      return false;
    }
  }
  // ── Main content loader (mirrors Tizen loadContent) ──────────────────────────
  async loadContent() {
    var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j;
    logger.info("[Player] loadContent");
    try {
      const schedule = await this.api.getCurrentContent(this.deviceId);
      if ((_a = schedule == null ? void 0 : schedule.resellerBranding) == null ? void 0 : _a.logoUrl) {
        this.resellerBrandingLogoUrl = schedule.resellerBranding.logoUrl;
      }
      if (!schedule || !Array.isArray(schedule.items) || !schedule.items.length) {
        logger.warn(`[Player] loadContent: no items (schedule=${schedule ? "ok" : "null"} items=${(_c = (_b = schedule == null ? void 0 : schedule.items) == null ? void 0 : _b.length) != null ? _c : 0})`);
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
        const sg2 = schedule;
        if (!this.syncActive && sg2["allTizen"] === false && sg2["relayUrl"]) {
          logger.info("[Player] re-entering sync group after restart");
          void this.initSyncGroup({
            groupId: String((_d = sg2["syncGroupId"]) != null ? _d : ""),
            relayUrl: String(sg2["relayUrl"]),
            leaderPriority: ((_e = sg2["peers"]) != null ? _e : []).sort((a, b) => {
              var _a2, _b2;
              return ((_a2 = a.leaderPriority) != null ? _a2 : 999) - ((_b2 = b.leaderPriority) != null ? _b2 : 999);
            }).map((p) => p.deviceId),
            expectedPeers: Math.max(1, ((_f = sg2["peers"]) != null ? _f : []).length - 1),
            syncRelayMode: String((_g = sg2["syncRelayMode"]) != null ? _g : "cloud")
          });
        } else if (this.localUrlCache.size === 0) {
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
        const rawPeers = (_h = sg["peers"]) != null ? _h : [];
        const sortedPeers = [...rawPeers].sort((a, b) => {
          var _a2, _b2;
          return ((_a2 = a.leaderPriority) != null ? _a2 : 999) - ((_b2 = b.leaderPriority) != null ? _b2 : 999);
        });
        this._pendingSyncRelayInfo = {
          groupId: String((_i = sg["syncGroupId"]) != null ? _i : ""),
          relayUrl: String(sg["relayUrl"]),
          leaderPriority: sortedPeers.map((p) => p.deviceId),
          peerCount: Math.max(1, sortedPeers.length - 1),
          // count of OTHER peers
          syncRelayMode: String((_j = sg["syncRelayMode"]) != null ? _j : "cloud")
        };
        logger.info(`[Player] cross-OS sync group relay stored: ${this._pendingSyncRelayInfo.relayUrl}`);
      } else {
        this._pendingSyncRelayInfo = null;
      }
      void this.downloadContentInBackground(schedule.items, newSig);
    } catch (e) {
      const err = e;
      logger.warn(`[Player] loadContent failed: ${err == null ? void 0 : err.message}`);
      if ((err == null ? void 0 : err.status) === 401) {
        logger.warn("[Player] 401 on schedule \u2014 device deleted, clearing token and reloading");
        try {
          localStorage.removeItem("nexariToken");
        } catch (e2) {
        }
        delete window["__nexariToken"];
        this.token = null;
        try {
          await this.cfg.adapter.reloadRenderer();
        } catch (e2) {
        }
        return;
      }
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
      case "VIDEOWALL":
        if (this._lastWallMsg) {
          await this.initVideoWall(this._lastWallMsg);
          return;
        }
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
    var _a, _b, _c, _d, _e, _f;
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
    const syncRelayMode = String((_c = msg["syncRelayMode"]) != null ? _c : "cloud");
    const lanRelayUrl = String((_d = msg["relayUrl"]) != null ? _d : "");
    let wsUrl;
    if (syncRelayMode === "lan" && lanRelayUrl) {
      wsUrl = lanRelayUrl;
    } else {
      const wsBase = this.cfg.apiBase.replace(/\/api\/v1\/?$/, "").replace(/^http/, "ws");
      wsUrl = `${wsBase}/api/v1/sync-relay/ws${tok ? "?token=" + encodeURIComponent(tok) : ""}`;
    }
    logger.info(`[Sync] relay URL (mode=${syncRelayMode}): ${wsUrl}`);
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
    const pinnedLeaderId = (_e = leaderPriority[0]) != null ? _e : "";
    this.syncActive = true;
    const syncDeviceId = this.dbDeviceId || this.deviceId;
    const playLatencyMs = await Promise.race([
      measurePlayLatencyMs(urls[0]),
      new Promise((res) => setTimeout(() => res(150), 800))
      // 150 ms Android WebView default
    ]);
    init({
      wsUrl,
      groupId,
      deviceId: syncDeviceId,
      selfIp: (_f = net.ipAddress) != null ? _f : "",
      expectedPeers,
      pinnedLeaderId,
      onStatus: (s) => logger.info(`[Sync] ${s}`),
      playLatencyMs,
      // auto-cal: relay distributes all latencies, each device computes offset
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
    var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l, _m;
    const geo = msg["geometry"];
    const myCell = msg["myCell"];
    if (!geo || !myCell) {
      logger.warn("[Player] videowall: missing geometry/myCell");
      return;
    }
    const colWidths = (_a = geo["colWidths"]) != null ? _a : [];
    const rowHeights = (_b = geo["rowHeights"]) != null ? _b : [];
    const bezelOffsets = (_c = geo["bezelOffsets"]) != null ? _c : null;
    const member = {
      positionCol: Number((_d = myCell["positionCol"]) != null ? _d : 0),
      positionRow: Number((_e = myCell["positionRow"]) != null ? _e : 0),
      colSpan: Number((_f = myCell["colSpan"]) != null ? _f : 1),
      rowSpan: Number((_g = myCell["rowSpan"]) != null ? _g : 1),
      tileRotation: String((_h = myCell["tileRotation"]) != null ? _h : "0"),
      nativeWidthPx: Number((_i = myCell["nativeWidthPx"]) != null ? _i : 1920),
      nativeHeightPx: Number((_j = myCell["nativeHeightPx"]) != null ? _j : 1080)
    };
    const t = computeTileCssTransform(member, colWidths, rowHeights, bezelOffsets);
    setWallTransform(t);
    logger.info(`[Player] videowall transform set canvas=${t.canvasW}\xD7${t.canvasH} tx=${t.translateX} ty=${t.translateY}`);
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
    const groupId = String((_l = (_k = msg["deviceGroupId"]) != null ? _k : msg["groupId"]) != null ? _l : "");
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
    const wallPlayLatencyMs = await Promise.race([
      measurePlayLatencyMs(urls[0]),
      new Promise((res) => setTimeout(() => res(150), 800))
    ]);
    init({
      wsUrl,
      groupId,
      deviceId: this.deviceId,
      selfIp: (_m = net.ipAddress) != null ? _m : "",
      expectedPeers,
      onStatus: (s) => logger.info(`[Sync/Wall] ${s}`),
      playLatencyMs: wallPlayLatencyMs,
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

          <!-- Logo -->
          <div style="display:flex;align-items:center;justify-content:center;gap:16px;margin-bottom:${deviceLabel ? "8px" : "24px"};">
            ${this.resellerBrandingLogoUrl ? `<img src="${this.resellerBrandingLogoUrl}" alt="Logo" style="max-height:48px;max-width:200px;object-fit:contain;" onerror="this.style.display='none'">` : `<svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" style="width:48px;height:48px;" aria-hidden="true">
              <defs>
                <linearGradient id="ng" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
                  <stop offset="0%" stop-color="#3a7bff"/>
                  <stop offset="100%" stop-color="#4ff2d1"/>
                </linearGradient>
              </defs>
              <rect x="4" y="4" width="56" height="56" rx="14" stroke="url(#ng)" stroke-width="2.5"/>
              <path d="M20 44 V20 L44 44 V20" stroke="url(#ng)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <div style="font-size:28px;font-weight:700;letter-spacing:.2em;background:linear-gradient(90deg,#3a7bff,#4ff2d1);-webkit-background-clip:text;-webkit-text-fill-color:transparent;">NEXARI</div>`}
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
