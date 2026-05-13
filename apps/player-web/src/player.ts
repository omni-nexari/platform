/**
 * player.ts — Full Nexari player orchestrator for player-web.
 *
 * Platform-agnostic. Host shells (Android, Pi, browser) inject a PlatformAdapter.
 * Content rendering is identical to the Tizen player, minus AVPlay and Tizen APIs.
 * All video uses HTML5 <video>. Sync/play uses the A/B engine in ./sync/engine.ts.
 *
 * Content types supported:
 *   VIDEO, IMAGE, HTML, CANVAS, MENU_BOARD, CALENDAR, DATASYNC, LIVE_STREAM,
 *   ZONE_LAYOUT, PDF (PDF.js if available), PLAYLIST (nested)
 */

import type { PlatformAdapter, PlatformOtaProgress } from './platform-adapter.js';
import { initLogger, logger } from './logger.js';
import { Api, type ContentRecord, type ScheduleItem, type CalendarEvent } from './api.js';
import { renderCalendar,  type CalendarHandle } from './renderers/calendar.js';
import { renderMenuBoard } from './renderers/menu-board.js';
import { renderDataSync,  type DataSyncHandle } from './renderers/datasync.js';
import {
  initEngine, prepare, schedulePlayAt, playFromPrebuffer, destroyEngine,
  setPlaylist, getDuration, setWallCrop,
} from './sync/engine.js';
import { init as syncInit, stop as syncStop } from './sync/sync.js';

export interface PlayerConfig {
  apiBase:    string;
  wsBase:     string;
  adapter:    PlatformAdapter;
  container:  HTMLElement;
  heartbeatMs?: number;
}

function escapeHtml(s: unknown): string {
  return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/** Hosts permitted as origin for OTA installer downloads (player-web shells). */
const UPDATE_HOST_ALLOWLIST: readonly string[] = ['ds.chiho.app', 'updates.chiho.app'];

/** Return true if `url` is an http(s) URL whose host is in UPDATE_HOST_ALLOWLIST. */
function isAllowedUpdateUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
    return UPDATE_HOST_ALLOWLIST.indexOf(u.hostname) !== -1;
  } catch {
    return false;
  }
}

/** Strip ?token=…/access_token=… from a URL before logging. */
function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    const params = u.searchParams;
    for (const k of ['token', 'access_token', 'auth', 'apiKey', 'api_key']) {
      if (params.has(k)) params.set(k, '***');
    }
    u.search = params.toString();
    return u.toString();
  } catch {
    return url.replace(/([?&](?:token|access_token|auth|apiKey|api_key))=[^&]+/gi, '$1=***');
  }
}

function parseMetadata(content: ContentRecord): Record<string, unknown> {
  if (!content.metadata) return {};
  if (typeof content.metadata === 'string') { try { return JSON.parse(content.metadata); } catch { return {}; } }
  return content.metadata as Record<string, unknown>;
}

function toContentRecord(item: ScheduleItem): ContentRecord {
  return item.content ?? (item as unknown as ContentRecord);
}

function getDurationMs(item: ScheduleItem): number {
  if (item.duration && item.duration > 0) return item.duration * 1000;
  const meta = parseMetadata(item.content);
  const d = Number(meta['duration'] || meta['durationSeconds']);
  return isFinite(d) && d > 0 ? d * 1000 : 10_000;
}

export class Player {
  private cfg:        PlayerConfig;
  private api:        Api;
  private ws:         WebSocket | null = null;
  private wsReady     = false;
  private deviceId    = '';
  private token:      string | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout>  | null = null;
  private contentRefreshTimer: ReturnType<typeof setInterval> | null = null;
  private logStreamTimer: ReturnType<typeof setInterval>  | null = null;

  private ntpOffset        = 0;
  private ntpSyncInProgress = false;

  private playlistItems:  ScheduleItem[] = [];
  private playlistIdx     = 0;
  private playbackCancel: AbortController | null = null;
  private currentHandle:  CalendarHandle | DataSyncHandle | null = null;
  private currentVideoEl: HTMLVideoElement | null = null;

  // Map of remote content URL → local object URL (blob:). Populated by
  // preCacheItems() so that renderImage/Video/HTML/Pdf can play from local
  // storage and survive transient network loss.
  private localUrlCache = new Map<string, string>();

  private calendarPushHandlers = new Map<string, (events: CalendarEvent[]) => void>();
  private syncActive = false;
  private platform = '';

  // Screenshot state — mirrors Tizen/Windows behaviour
  private screenshotIntervalHandle: ReturnType<typeof setInterval> | null = null;
  private liveIntervalHandle: ReturnType<typeof setTimeout> | null = null;
  private liveCaptureActive   = false;
  private liveCaptureIntervalMs = 1000;
  private liveCaptureBusy     = false;
  // Throttled content-change thumbnail: at most once per 10s
  private thumbTimer: ReturnType<typeof setTimeout> | null = null;
  private lastThumbAt = 0;

  // Content download / cache state (mirrors Tizen downloadContentInBackground flow)
  private lastContentSignature: string | null = null;
  private pendingItems: ScheduleItem[] | null = null;
  private _pendingSyncGroupMsg: Record<string, unknown> | null = null;
  // Relay info stored when loadContent() finds a cross-OS sync group; consumed by swapToPending().
  private _pendingSyncRelayInfo: { groupId: string; relayUrl: string; leaderPriority: string[]; peerCount: number } | null = null;
  private pendingSignature: string | null = null;
  private isDownloadingContent = false;
  private deviceDisplayName = '';

  constructor(cfg: PlayerConfig) {
    // Allow the connection settings panel to override apiBase/wsBase via localStorage
    const savedApi = localStorage.getItem('PLAYER_API_BASE');
    const savedWs  = localStorage.getItem('PLAYER_WS_URL');
    this.cfg = {
      ...cfg,
      apiBase: savedApi ?? cfg.apiBase,
      wsBase:  savedWs  ?? cfg.wsBase,
    };
    this.api = new Api(this.cfg.apiBase, () => this.token);
  }

  async start(): Promise<void> {
    const info = await this.cfg.adapter.getDeviceInfo();
    this.deviceId = info.deviceId;
    this.platform  = info.platform || '';
    this.deviceDisplayName = info.modelName || info.modelCode || '';
    initLogger({ apiBase: this.cfg.apiBase, deviceId: info.deviceId });
    logger.info(`[Player] starting deviceId=${info.deviceId} platform=${info.platform}`);

    this.showIdle('Connecting…');
    void this.syncNtp();

    // Arm the top-left 10-tap gesture as early as possible so technicians can
    // open the settings overlay even if pairing or boot stalls.
    this.initSettingsGesture(info);

    this.token = await this.ensurePaired();
    logger.info(`[Player] paired (token: ${this.token ? 'ok' : 'none'})`);

    // Try offline cache first so something shows immediately while we connect
    if (!this.tryLoadCachedSchedule()) this.showIdle('Waiting for content…');

    this.connectWs();
    // Send first heartbeat immediately so dashboard gets resolution/timezone/etc
    // without waiting for the 30s interval tick.
    void this.sendHeartbeat();
    this.heartbeatTimer = setInterval(
      () => this.sendHeartbeat().catch(e => logger.warn(`[Player] heartbeat: ${e}`)),
      this.cfg.heartbeatMs ?? 30_000,
    );

    void this.loadContent();
    this.contentRefreshTimer = setInterval(() => void this.loadContent(), 5 * 60_000);
    this.logStreamTimer = setInterval(() => this.flushLogStream(), 5_000);
  }

  stop(): void {
    if (this.heartbeatTimer)       { clearInterval(this.heartbeatTimer);       this.heartbeatTimer = null; }
    if (this.reconnectTimer)       { clearTimeout(this.reconnectTimer);        this.reconnectTimer = null; }
    if (this.contentRefreshTimer)  { clearInterval(this.contentRefreshTimer);  this.contentRefreshTimer = null; }
    if (this.logStreamTimer)       { clearInterval(this.logStreamTimer);       this.logStreamTimer = null; }
    this.cancelPlayback();
    if (this.syncActive) { try { syncStop(); } catch {} this.syncActive = false; }
    try { (window as any).nexari?.stopRelay?.(); } catch {}
    if (this.ws) { try { this.ws.close(); } catch {} this.ws = null; }
  }

  private async ensurePaired(): Promise<string | null> {
    const cached = (window as unknown as Record<string, unknown>)['__nexariToken'] as string | undefined
      ?? localStorage.getItem('nexariToken');
    if (cached) {
      logger.info('[Pairing] found cached token, skipping pair flow');
      return cached;
    }

    logger.info('[Pairing] no cached token — fetching device info');
    const info = await this.cfg.adapter.getDeviceInfo();
    const net  = await this.cfg.adapter.getNetworkInfo();
    logger.info(`[Pairing] deviceId=${info.deviceId} serial=${info.serialNumber} platform=${info.platform} ip=${net.ipAddress}`);
    logger.info(`[Pairing] apiBase=${this.cfg.apiBase}`);

    this.showPairingScreen('------', info, net, 'Requesting pairing code…');

    let pair: { code?: string; deviceToken?: string; status?: string; deviceId?: string };
    try {
      logger.info('[Pairing] POST /devices/pair …');
      pair = await this.api.pairDevice({
        duid: info.deviceId, modelName: info.modelName, modelCode: info.modelCode,
        serialNumber: info.serialNumber, firmwareVersion: info.firmwareVersion,
        kind: info.kind, platform: info.platform, playerVersion: info.playerVersion,
      });
      logger.info(`[Pairing] pairDevice response: status=${pair.status} code=${pair.code} hasToken=${!!pair.deviceToken}`);
    } catch (e) {
      logger.error(`[Pairing] pairDevice failed: ${(e as Error).message}`);
      this.updatePairingStatus(`Failed to contact server: ${(e as Error).message}. Retrying in 10s…`);
      await new Promise(r => setTimeout(r, 10_000));
      return this.ensurePaired();
    }

    // Device already claimed for this DUID — resume immediately
    if (pair.status === 'claimed' && pair.deviceToken) {
      logger.info('[Pairing] already claimed — resuming');
      try { localStorage.setItem('nexariToken', pair.deviceToken); } catch {}
      this.hidePairingScreen();
      return pair.deviceToken;
    }

    const code = pair.code ?? '------';
    logger.info(`[Pairing] showing code: ${code}`);
    this.showPairingScreen(code, info, net, 'Waiting for confirmation in dashboard…');

    // Poll until claimed
    for (;;) {
      await new Promise(r => setTimeout(r, 3000));
      let pb: { claimed: boolean; token?: string };
      try {
        pb = await this.api.pairStatus(pair.code!);
        logger.info(`[Pairing] pairStatus: claimed=${pb.claimed}`);
      } catch (e) {
        logger.warn(`[Pairing] pairStatus error: ${(e as Error).message}`);
        continue;
      }
      if (pb.claimed && pb.token) {
        logger.info('[Pairing] confirmed!');
        try { localStorage.setItem('nexariToken', pb.token); } catch {}
        this.updatePairingStatus('Paired! Starting player…');
        await new Promise(r => setTimeout(r, 800));
        this.hidePairingScreen();
        return pb.token;
      }
    }
  }

  private showPairingScreen(
    code: string,
    info: Awaited<ReturnType<PlatformAdapter['getDeviceInfo']>>,
    net:  Awaited<ReturnType<PlatformAdapter['getNetworkInfo']>>,
    status: string,
  ): void {
    // Remove old panel if present, then (re)build
    document.getElementById('nexari-pair-panel')?.remove();

    const apiBase = this.cfg.apiBase;
    const wsBase  = this.cfg.wsBase;
    const serverHost = apiBase.replace(/\/api\/v1\/?$/, '').replace(/\/api\/?$/, '');

    const p = document.createElement('div');
    p.id = 'nexari-pair-panel';
    p.style.cssText = [
      'position:fixed;inset:0;z-index:99999;',
      'background:#0d0f1a;color:#fff;',
      'display:flex;flex-direction:column;align-items:center;justify-content:center;',
      'font-family:system-ui,-apple-system,sans-serif;overflow:auto;',
    ].join('');

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
      ${escapeHtml(code)}
    </div>
    <div id="nexari-pair-status"
         style="font-size:16px;color:#888;margin-top:20px;">
      ${escapeHtml(status)}
    </div>
  </div>

  <!-- Device info -->
  <div style="display:flex;flex-wrap:wrap;justify-content:center;gap:10px 24px;
              font-size:14px;color:#666;margin-bottom:32px;">
    <span>Model: <strong style="color:#999;">${escapeHtml(info.modelName || info.modelCode || '—')}</strong></span>
    <span>IP: <strong style="color:#999;">${escapeHtml(net.ipAddress || 'Connecting…')}</strong></span>
    <span>Serial: <strong style="color:#999;">${escapeHtml(info.serialNumber || '—')}</strong></span>
    <span>Platform: <strong style="color:#999;">${escapeHtml(info.platform || '—')}</strong></span>
  </div>

  <!-- URL hint -->
  <p style="font-size:14px;color:#555;margin:0 0 32px;">
    Dashboard: <span style="color:#4a9eff;">${escapeHtml(serverHost || 'ds.chiho.app')}</span>
  </p>

  <!-- Connection settings (collapsible) -->
  <div style="text-align:left;width:100%;">
    <button id="nexari-conn-toggle"
            onclick="(function(){
              var p=document.getElementById('nexari-conn-panel');
              var a=document.getElementById('nexari-conn-arrow');
              var show=p.style.display==='none'||!p.style.display;
              p.style.display=show?'block':'none';
              a.textContent=show?'▲':'▼';
            })()"
            style="width:100%;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);
                   border-radius:12px;padding:14px 20px;color:#999;font-size:14px;font-weight:600;
                   cursor:pointer;display:flex;align-items:center;justify-content:space-between;
                   font-family:inherit;">
      ⚙ Connection settings <span id="nexari-conn-arrow">▼</span>
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
        <input id="nexari-input-api" type="text" value="${escapeHtml(apiBase)}" spellcheck="false"
               placeholder="http://192.168.1.17:3000/api/v1"
               style="width:100%;box-sizing:border-box;background:#111;border:1px solid #333;
                      border-radius:8px;padding:10px 12px;color:#fff;font-size:14px;
                      font-family:ui-monospace,monospace;">
      </div>
      <div style="margin-bottom:16px;">
        <label style="display:block;font-size:12px;color:#777;margin-bottom:6px;font-weight:600;">
          WebSocket URL
        </label>
        <input id="nexari-input-ws" type="text" value="${escapeHtml(wsBase)}" spellcheck="false"
               placeholder="ws://192.168.1.17:3000"
               style="width:100%;box-sizing:border-box;background:#111;border:1px solid #333;
                      border-radius:8px;padding:10px 12px;color:#fff;font-size:14px;
                      font-family:ui-monospace,monospace;">
        <span style="font-size:11px;color:#555;">Auto-derived from API URL (http→ws, https→wss)</span>
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
      </script>
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

  private updatePairingStatus(msg: string): void {
    const el = document.getElementById('nexari-pair-status');
    if (el) el.textContent = msg;
    const codeEl = document.getElementById('nexari-pair-code');
    // keep code unchanged
    void codeEl;
  }

  private hidePairingScreen(): void { document.getElementById('nexari-pair-panel')?.remove(); }

  private async syncNtp(samples = 5): Promise<void> {
    if (this.ntpSyncInProgress) return;
    this.ntpSyncInProgress = true;
    try {
      const results: { offset: number; rtt: number }[] = [];
      for (let i = 0; i < samples; i++) {
        const t0 = Date.now();
        const ts = await this.api.getServerTime();
        const t3 = Date.now();
        if (ts && isFinite(ts)) {
          const rtt = t3 - t0;
          if (rtt < 2000) results.push({ offset: ts - t0 - rtt/2, rtt });
        }
        if (i < samples - 1) await new Promise(r => setTimeout(r, 20));
      }
      if (!results.length) return;
      results.sort((a, b) => a.rtt - b.rtt);
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const best = results[0]!;
      const prev = this.ntpOffset;
      const delta = Math.abs(best.offset - prev);
      this.ntpOffset = delta > 50 ? Math.round(best.offset) : Math.round(prev*0.8 + best.offset*0.2);
      logger.info(`[NTP] offset=${this.ntpOffset}ms rtt=${best.rtt}ms samples=${results.length}`);
    } catch { /**/ }
    finally { this.ntpSyncInProgress = false; }
  }

  getSyncedTime(): number { return Date.now() + this.ntpOffset; }

  private connectWs(): void {
    // Same URL shape as Tizen + Windows players: /api/v1/devices/ws/device?token=…
    // The server resolves the deviceId from the JWT in the query param.
    const url = `${this.cfg.wsBase}/api/v1/devices/ws/device${this.token ? `?token=${encodeURIComponent(this.token)}` : ''}`;
    logger.info(`[Player] WS connect ${url}`);
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.addEventListener('open', () => {
      this.wsReady = true;
      logger.info('[Player] WS open');
      void this.sendHeartbeat();
    });
    ws.addEventListener('message', ev => void this.onWsMessage(String(ev.data)));
    ws.addEventListener('close', () => {
      this.wsReady = false;
      // Stop live-view capture loop — server won't be reading frames anyway
      this.liveCaptureActive = false;
      if (this.liveIntervalHandle) { clearTimeout(this.liveIntervalHandle); this.liveIntervalHandle = null; }
      logger.warn('[Player] WS closed — reconnect in 2s');
      this.reconnectTimer = setTimeout(() => this.connectWs(), 2000);
    });
    ws.addEventListener('error', () => { logger.warn('[Player] WS error'); });
  }

  private send(obj: Record<string, unknown>): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    try { this.ws.send(JSON.stringify({ deviceId: this.deviceId, ...obj })); } catch {}
  }

  private async onWsMessage(raw: string): Promise<void> {
    let msg: Record<string, unknown>;
    try { msg = JSON.parse(raw) as Record<string, unknown>; } catch { return; }
    const t = String(msg['type'] ?? '');

    if (t === 'calendar_events') {
      const contentId = String(msg['contentId'] ?? '');
      const handler = this.calendarPushHandlers.get(contentId);
      if (handler) handler((msg['events'] as CalendarEvent[]) || []);
      return;
    }

    if (t === 'cell.update' || t === 'train.status' || t === 'table.reload') {
      const h = this.currentHandle as DataSyncHandle | null;
      if (h && typeof h.handleWsMessage === 'function') h.handleWsMessage(msg);
      return;
    }

    if (['PEERS','PING','PONG','LOAD_URL','READY','GO','LOOP_GO','PLAYHEAD','LOOP_READY','HEARTBEAT_PEERS'].includes(t)) return;

    switch (t) {
      case 'server_ack': return;
      case 'command':
      case 'commands': {
        const cmds = Array.isArray(msg['commands']) ? msg['commands'] as Record<string,unknown>[]
          : (msg['command'] ? [{ command:msg['command'], payload:msg['payload'] }] : []);
        for (const c of cmds) await this.dispatchCommand(String(c['command']??''), c['payload'] as Record<string,unknown>|undefined);
        return;
      }
      case 'content-update': case 'content.published': case 'content.updated':
      case 'schedule.updated': case 'refresh_schedule':
        await this.loadContent(); return;
      case 'reload':
        await this.cfg.adapter.reloadRenderer(); return;
      case 'APP_UPDATE': {
        const url = String(msg['apkUrl'] ?? msg['wgtUrl'] ?? '');
        const version = String(msg['version'] ?? '');
        if (!url || !version) { this.send({ type:'app_update_failed', error:'missing url/version' }); return; }
        if (!isAllowedUpdateUrl(url)) {
          this.send({ type:'app_update_failed', error:'Download URL host not allowed' });
          return;
        }
        const result = await this.cfg.adapter.installUpdate({
          url, version, sha256: msg['sha256'] as string|undefined,
          onProgress: p => this.sendOta(p),
        });
        this.sendOta(result);
        return;
      }
      case 'SYNC_GROUP_INIT': await this.initSyncGroup(msg); return;
      case 'VIDEOWALL_INIT':   await this.initVideoWall(msg); return;
      default:
        // The API sends device commands using the command name as the WS type
        // (e.g. type='reboot', type='screenshot', type='set_system_volume').
        // Route everything that reached default through dispatchCommand so
        // player-web handles the same types as the Tizen reference player.
        await this.dispatchCommand(t, msg['payload'] as Record<string,unknown>|undefined);
        return;
    }
  }

  private async dispatchCommand(command: string, payload?: Record<string, unknown>): Promise<void> {
    const a = this.cfg.adapter;
    logger.info(`[Player] command ${command}`);
    switch (command) {
      case 'reboot':           await a.reboot(); return;
      case 'power_off':        await a.powerOff(); return;
      case 'power_on':         await a.powerOn(); return;
      case 'sleep':            await a.powerOff(); return;
      case 'relaunch_app':     await a.relaunch(); return;
      case 'clear_cache':      await a.clearCache(); return;
      case 'open_settings':    if (typeof a.openSettings === 'function') await a.openSettings(); return;
      case 'refresh_schedule':
      case 'SESSION_CONFIG': await this.loadContent(); return;
      case 'screenshot': {
        const shot = await a.screenshot().catch(() => null);
        if (shot?.jpegBase64) this.send({ type: 'screenshot_data', payload: { dataBase64: shot.jpegBase64, trigger: 'manual', contentId: null } });
        return;
      }
      case 'screenshot_auto': {
        const shot = await a.screenshot().catch(() => null);
        if (shot?.jpegBase64) this.send({ type: 'screenshot_data', payload: { dataBase64: shot.jpegBase64, trigger: 'content_change', contentId: null } });
        return;
      }
      case 'set_screenshot_interval': {
        if (this.screenshotIntervalHandle) { clearInterval(this.screenshotIntervalHandle); this.screenshotIntervalHandle = null; }
        const minutes = Math.max(1, Number(payload?.['minutes']) || 5);
        logger.info(`[Screenshot] interval set to ${minutes} min`);
        // Take one first shot after 3s then repeat
        setTimeout(() => void this.takeScreenshot('interval'), 3_000);
        this.screenshotIntervalHandle = setInterval(() => void this.takeScreenshot('interval'), minutes * 60_000);
        return;
      }
      case 'start_live_capture': {
        const intervalMs = Math.max(1000, Number(payload?.['intervalMs']) || 1000);
        logger.info(`[Screenshot] live capture, intervalMs=${intervalMs}`);
        if (this.liveIntervalHandle) { clearTimeout(this.liveIntervalHandle); this.liveIntervalHandle = null; }
        this.liveCaptureActive = true;
        this.liveCaptureIntervalMs = intervalMs;
        this.liveCaptureBusy = false;
        this.scheduleLiveCapture(200);
        return;
      }
      case 'set_volume':
      case 'set_system_volume':
        if (typeof payload?.['level'] === 'number') await a.setVolume(payload['level'] as number);
        return;
      case 'set_mute':
      case 'set_system_mute':
        if (typeof payload?.['mute'] === 'boolean') await a.setMute(payload['mute'] as boolean);
        return;
      case 'set_brightness':
        if (typeof payload?.['level'] === 'number') await a.setBrightness(payload['level'] as number);
        return;
      case 'mdc_control': {
        const action = String(payload?.['action'] ?? '');
        if (action==='set_volume' && typeof payload?.['level']==='number') await a.setVolume(payload['level'] as number);
        if (action==='set_mute'   && typeof payload?.['mute']==='boolean') await a.setMute(payload['mute'] as boolean);
        return;
      }
      case 'dump_logs': case 'request_log_burst': this.flushLogStream(); return;
      case 'update_player': {
        const url = String(payload?.['downloadUrl'] ?? payload?.['apkUrl'] ?? payload?.['wgtUrl'] ?? '');
        const version = String(payload?.['version'] ?? '');
        const sha256 = payload?.['sha256'] as string | undefined;
        if (!url || !version) { this.send({ type:'app_update_failed', error:'missing url/version' }); return; }
        if (!isAllowedUpdateUrl(url)) {
          this.send({ type:'app_update_failed', error:'Download URL host not allowed' });
          return;
        }
        const result = await a.installUpdate({ url, version, sha256, onProgress: p => this.sendOta(p) });
        this.sendOta(result);
        return;
      }
      default: logger.warn(`[Player] unhandled command: ${command}`);
    }
  }

  // ── Screenshot helpers ──────────────────────────────────────────────────────

  private async takeScreenshot(trigger: 'manual' | 'content_change' | 'interval'): Promise<void> {
    try {
      const shot = await this.cfg.adapter.screenshot();
      if (shot?.jpegBase64) {
        this.send({ type: 'screenshot_data', payload: { dataBase64: shot.jpegBase64, trigger, contentId: null } });
        logger.info(`[Screenshot] sent trigger=${trigger} bytes=${shot.jpegBase64.length}`);
      }
    } catch (e) {
      logger.warn(`[Screenshot] failed: ${(e as Error).message}`);
    }
  }

  /** Throttled auto-thumbnail on content change (≤1 per 10s, fires 5s after item starts). */
  private scheduleContentChangeShot(): void {
    const now = Date.now();
    if (now - this.lastThumbAt < 10_000) return;
    if (this.thumbTimer) { clearTimeout(this.thumbTimer); this.thumbTimer = null; }
    this.thumbTimer = setTimeout(() => {
      this.thumbTimer = null;
      this.lastThumbAt = Date.now();
      void this.takeScreenshot('content_change');
    }, 5_000);
  }

  /** Live-view capture loop (setTimeout chain, not setInterval — prevents concurrent calls). */
  private scheduleLiveCapture(delayMs: number): void {
    this.liveIntervalHandle = setTimeout(async () => {
      if (!this.liveCaptureActive) return;
      if (this.liveCaptureBusy) { this.scheduleLiveCapture(200); return; }
      this.liveCaptureBusy = true;
      try {
        const shot = await this.cfg.adapter.screenshot();
        if (shot?.jpegBase64 && this.ws?.readyState === WebSocket.OPEN) {
          this.send({ type: 'screenshot_data', payload: { dataBase64: shot.jpegBase64, trigger: 'live', contentId: null } });
        }
      } catch { /* best-effort */ } finally {
        this.liveCaptureBusy = false;
        if (this.liveCaptureActive) this.scheduleLiveCapture(Math.max(1000, this.liveCaptureIntervalMs));
      }
    }, delayMs);
  }

  private async sendHeartbeat(): Promise<void> {
    // The API only processes heartbeats via WS (handleDeviceMessage in services/ws.ts).
    // Send as WS messages matching the Tizen/Windows pattern.
    if (!this.deviceId) return;
    try {
      const a     = this.cfg.adapter;
      const info  = await a.getDeviceInfo();
      const net   = await a.getNetworkInfo();
      const power = await a.getPowerState();
      const res   = a.getResources ? await a.getResources().catch(() => null) : null;

      // Current / next content (id only — server JOINs to content table for names).
      const items = this.playlistItems;
      const curIdx = this.playlistIdx;
      const currentId = items[curIdx]?.content?.id ?? null;
      let nextId: string | null = null;
      let nextStartsAt: string | null = null;
      if (items.length > 1) {
        const nIdx = (curIdx + 1) % items.length;
        nextId = items[nIdx]?.content?.id ?? null;
        // Best-effort: assume current item's remaining duration is its full duration.
        const durSec = Number(items[curIdx]?.duration ?? 0);
        if (durSec > 0) nextStartsAt = new Date(this.getSyncedTime() + durSec * 1000).toISOString();
      }

      logger.info(`[Heartbeat] sending res=${info.resolution} tz=${info.timezone} ver=${info.playerVersion} mac=${info.macAddress ?? 'null'} ip=${net.ipAddress} cpu=${res?.cpuLoad ?? 'n/a'} uptime=${res?.deviceUptimeSec ?? 'n/a'}s`);
      // Main heartbeat — no ipAddress/macAddress (those go in network_info)
      this.send({
        type: 'heartbeat',
        payload: {
          playerVersion: info.playerVersion, firmwareVersion: info.firmwareVersion,
          timezone: info.timezone, resolution: info.resolution,
          powerState: power, kind: info.kind, batteryPct: info.batteryPct,
          clockDriftMs: this.ntpOffset,
          ...(res?.cpuLoad          != null ? { cpuLoad:          res.cpuLoad          } : {}),
          ...(res?.memoryFreeBytes  != null ? { memoryFreeBytes:  res.memoryFreeBytes  } : {}),
          ...(res?.memoryTotalBytes != null ? { memoryTotalBytes: res.memoryTotalBytes } : {}),
          ...(res?.storageFreeBytes != null ? { storageFreeBytes: res.storageFreeBytes } : {}),
          ...(res?.deviceUptimeSec  != null ? { deviceUptimeSec:  res.deviceUptimeSec  } : {}),
          currentContentId: currentId,
          nextContentId: nextId,
          nextStartsAt: nextStartsAt,
        },
      });
      // Network info — uses field names expected by the server schema (ip/mac not ipAddress/macAddress)
      if (net.ipAddress) {
        this.send({
          type: 'network_info',
          payload: {
            ip: net.ipAddress,
            mac: info.macAddress ?? '',
            connectionType: net.connectionType ?? 'wifi',
            ...(net.ssid ? { wifiSsid: net.ssid } : {}),
          },
        });
      }
    } catch (e) {
      logger.warn(`[Heartbeat] failed: ${(e as Error).message}`);
    }
  }

  /**
   * Arm the technician 10-tap gesture: ten taps inside the top-left ZONE
   * within a 3-second window open the in-player settings overlay. Uses
   * capture-phase listeners on `touchstart`, `pointerdown`, and `click` so
   * taps on fullscreen content (video, iframes, images) still register, and
   * accepts touch as well as mouse for desktop QA.
   */
  private initSettingsGesture(info: { platform?: string }): void {
    const ZONE = 120; // px from top-left corner
    const WINDOW_MS = 3000;
    const TARGET = 10;
    let count = 0;
    let resetTimer: ReturnType<typeof setTimeout> | null = null;

    const trigger = () => {
      count = 0;
      if (resetTimer) { clearTimeout(resetTimer); resetTimer = null; }
      logger.info('[Settings] 10-tap gesture fired — opening settings overlay');
      try { this.showSettingsOverlay(); } catch (e) {
        logger.warn(`[Settings] overlay failed: ${(e as Error).message}`);
      }
    };

    const note = (x: number, y: number) => {
      if (x > ZONE || y > ZONE) return;
      count++;
      logger.info(`[Settings] tap ${count}/${TARGET} at (${x | 0},${y | 0})`);
      if (resetTimer) clearTimeout(resetTimer);
      resetTimer = setTimeout(() => { count = 0; resetTimer = null; }, WINDOW_MS);
      if (count >= TARGET) trigger();
    };

    // Capture phase so fullscreen content (video, iframe, image) doesn't
    // swallow the event before it bubbles to document.
    document.addEventListener('touchstart', (e: TouchEvent) => {
      const t = e.touches[0]; if (!t) return;
      note(t.clientX, t.clientY);
    }, { capture: true, passive: true });
    document.addEventListener('pointerdown', (e: PointerEvent) => {
      note(e.clientX, e.clientY);
    }, { capture: true, passive: true });
    document.addEventListener('click', (e: MouseEvent) => {
      note(e.clientX, e.clientY);
    }, { capture: true });

    logger.info(`[Settings] 10-tap gesture armed (zone=${ZONE}px top-left, window=${WINDOW_MS}ms, platform=${info.platform})`);
  }

  /**
   * In-player settings overlay. Renders device/network/config info, a tail of
   * recent log lines, and technician actions (Re-pair, Reload, Clear logs,
   * open native system settings). Auto-refreshes the log tail every second
   * while visible.
   */
  private settingsOverlayEl: HTMLDivElement | null = null;
  private settingsLogTimer: ReturnType<typeof setInterval> | null = null;

  private async showSettingsOverlay(): Promise<void> {
    if (this.settingsOverlayEl) return; // already open

    const adapter = this.cfg.adapter;
    let info: Awaited<ReturnType<PlatformAdapter['getDeviceInfo']>> | null = null;
    let net: Awaited<ReturnType<PlatformAdapter['getNetworkInfo']>> | null = null;
    try { info = await adapter.getDeviceInfo(); } catch (e) { logger.warn(`[Settings] getDeviceInfo failed: ${(e as Error).message}`); }
    try { net  = await adapter.getNetworkInfo(); } catch (e) { logger.warn(`[Settings] getNetworkInfo failed: ${(e as Error).message}`); }

    const cachedToken = (window as unknown as Record<string, unknown>)['__nexariToken'] as string | undefined
      ?? localStorage.getItem('nexariToken');

    const overlay = document.createElement('div');
    overlay.id = 'nexari-settings-overlay';
    overlay.setAttribute('style', [
      'position:fixed', 'inset:0', 'z-index:2147483646',
      'background:rgba(0,0,0,0.92)', 'color:#e6e6e6',
      'font-family:Menlo,Consolas,monospace', 'font-size:14px',
      'display:flex', 'flex-direction:column', 'padding:24px', 'box-sizing:border-box',
    ].join(';'));

    const esc = (s: unknown): string => String(s ?? '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    } as Record<string, string>)[c] ?? c);

    const tokenDisp = cachedToken ? `${cachedToken.slice(0, 8)}…${cachedToken.slice(-6)}` : '(none)';
    const rows: [string, string][] = [
      ['Device ID',    esc(info?.deviceId)],
      ['Serial',       esc(info?.serialNumber)],
      ['Model',        esc(info?.modelName || info?.modelCode)],
      ['Platform',     esc(info?.platform)],
      ['Player ver',   esc(info?.playerVersion)],
      ['Firmware',     esc(info?.firmwareVersion)],
      ['IP',           esc(net?.ipAddress)],
      ['SSID',         esc(net?.ssid)],
      ['Conn type',    esc(net?.connectionType)],
      ['API',          esc(this.cfg.apiBase)],
      ['WS',           esc(this.cfg.wsBase)],
      ['Token',        esc(tokenDisp)],
      ['WS state',     this.wsReady ? 'connected' : 'disconnected'],
    ];

    overlay.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
        <div style="font-size:20px;font-weight:600">Nexari Player — Settings</div>
        <button id="nx-set-close" style="padding:8px 16px;background:#444;color:#fff;border:0;border-radius:4px;font-size:14px;cursor:pointer">Close ✕</button>
      </div>
      <div style="display:grid;grid-template-columns:140px 1fr;gap:4px 16px;margin-bottom:16px;background:#1a1a1a;padding:12px;border-radius:6px">
        ${rows.map(([k, v]) => `<div style="color:#888">${k}</div><div style="word-break:break-all">${v}</div>`).join('')}
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
    overlay.querySelector('#nx-set-close')?.addEventListener('click', close);
    overlay.querySelector('#nx-set-reload')?.addEventListener('click', () => {
      logger.info('[Settings] Reload requested from overlay');
      try { adapter.reloadRenderer?.(); } catch { /* ignore */ }
      setTimeout(() => { try { location.reload(); } catch { /* ignore */ } }, 300);
    });
    overlay.querySelector('#nx-set-repair')?.addEventListener('click', () => {
      if (!confirm('Clear pairing token and restart? The device will need to be paired again.')) return;
      logger.info('[Settings] Re-pair requested — clearing token');
      try { localStorage.removeItem('nexariToken'); } catch { /* ignore */ }
      delete (window as unknown as Record<string, unknown>)['__nexariToken'];
      setTimeout(() => {
        try { adapter.reloadRenderer?.(); } catch { /* ignore */ }
        try { location.reload(); } catch { /* ignore */ }
      }, 200);
    });
    overlay.querySelector('#nx-set-clearlog')?.addEventListener('click', () => {
      const buf = (window as unknown as Record<string, unknown>)['LogBuffer'] as { clear?: () => void } | undefined;
      buf?.clear?.();
      const pre = overlay.querySelector('#nx-set-logs') as HTMLPreElement | null;
      if (pre) pre.textContent = '';
    });
    overlay.querySelector('#nx-set-syspref')?.addEventListener('click', () => {
      if (typeof adapter.openSettings === 'function') {
        logger.info('[Settings] Opening native system settings');
        Promise.resolve(adapter.openSettings()).catch(e => logger.warn(`[Settings] openSettings failed: ${(e as Error).message}`));
      } else {
        logger.info('[Settings] System settings not available on this platform');
      }
    });
    const pauseBtn = overlay.querySelector('#nx-set-pause') as HTMLButtonElement | null;
    let paused = false;
    pauseBtn?.addEventListener('click', () => {
      paused = !paused;
      pauseBtn.textContent = paused ? 'Resume auto-refresh' : 'Pause auto-refresh';
    });

    const renderLogs = () => {
      if (paused) return;
      const buf = (window as unknown as Record<string, unknown>)['LogBuffer'] as
        { tail?: (n: number) => Array<{ level?: string; message?: string; timestamp?: string }> } | undefined;
      const lines = buf?.tail?.(200) ?? [];
      const pre = overlay.querySelector('#nx-set-logs') as HTMLPreElement | null;
      if (!pre) return;
      pre.textContent = lines.map(e => `${e.timestamp ?? ''} [${(e.level ?? 'info').toUpperCase()}] ${e.message ?? ''}`).join('\n');
      pre.scrollTop = pre.scrollHeight;
    };
    renderLogs();
    this.settingsLogTimer = setInterval(renderLogs, 1000);
  }

  private hideSettingsOverlay(): void {
    if (this.settingsLogTimer) { clearInterval(this.settingsLogTimer); this.settingsLogTimer = null; }
    if (this.settingsOverlayEl) {
      try { this.settingsOverlayEl.remove(); } catch { /* ignore */ }
      this.settingsOverlayEl = null;
    }
  }

  private flushLogStream(): void {
    if (!this.wsReady) return;
    type BufEntry = { level?: string; message?: string; timestamp?: string };
    const buf = (window as unknown as Record<string, unknown>)['LogBuffer'] as { drain(n: number): BufEntry[] } | undefined;
    if (!buf?.drain) return;
    const batch = buf.drain(200);
    if (!batch.length) return;
    // Group by level and send in batches of 50 lines
    const byLevel: Record<string, string[]> = { debug: [], info: [], warn: [], error: [] };
    for (const e of batch) {
      const lvl = e.level && byLevel[e.level] ? e.level : 'info';
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      byLevel[lvl]!.push(`${e.timestamp ?? new Date().toISOString()} ${e.message ?? ''}`);
    }
    for (const [level, lines] of Object.entries(byLevel)) {
      if (!lines.length) continue;
      for (let i = 0; i < lines.length; i += 50) {
        this.send({ type: 'device_log', payload: { level, lines: lines.slice(i, i + 50) } });
      }
    }
  }

  // ── Content signature (mirrors Tizen getContentSignature) ──────────────────
  private getContentSignature(items: ScheduleItem[]): string {
    const parts = items.map(item => {
      const c = item.content as (ContentRecord & { updatedAt?: string; version?: string }) | undefined;
      const updAt = (item as unknown as { updatedAt?: string }).updatedAt ?? '';
      return [item.id ?? '', updAt, c?.id ?? '', (c?.updatedAt as string | undefined) ?? '', (c?.version as string | undefined) ?? ''].join(':');
    });
    return JSON.stringify(parts);
  }

  // ── Pre-cache every content file as a local blob: URL ──────────────────────
  // Downloads every URL referenced by the schedule via fetch() and registers
  // the resulting Blob as an object URL in localUrlCache. Renderers then call
  // resolveLocalUrl() to swap the remote URL for the local one — playback is
  // fully offline once the schedule has been cached.
  private async preCacheItems(items: ScheduleItem[]): Promise<void> {
    // Collect every URL we might play. Also gather metadata URLs (zone layouts
    // reference child contentIds, but those come back as their own schedule
    // items in practice — keep this simple and trust item.content.url).
    const urls = Array.from(new Set(
      items.map(i => i.content?.url ?? '').filter(u => !!u)
    ));
    const total = urls.length;
    if (!total) return;

    const nextCache = new Map<string, string>();
    let done = 0;
    
    // Open persistent browser cache
    const diskCache = await caches.open('nexari-content-v1').catch(() => null);

    await Promise.allSettled(urls.map(async (url) => {
      try {
        const urlKey = url.split('?')[0] ?? url; // Ignore query params for cache key (presigned URLs might change tokens)
        
        // Reuse an existing blob URL if in memory.
        const existing = this.localUrlCache.get(urlKey);
        if (existing) { nextCache.set(urlKey, existing); done++; this.updateIdleProgress(Math.round((done / total) * 100)); return; }

        let resp = diskCache ? await diskCache.match(urlKey) : undefined;
        let isHit = !!resp;

        if (!resp) {
          resp = await fetch(url, { credentials: 'omit' });
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          // Put clone into persistent cache
          if (diskCache) {
            try { await diskCache.put(urlKey, resp.clone()); } catch(e) { logger.warn(`[Cache] write disk fail: ${e}`); }
          }
        }

        const blob = await resp.blob();
        const blobUrl = URL.createObjectURL(blob);
        nextCache.set(urlKey, blobUrl);
        
        if (isHit) {
          logger.info(`[Cache] local disk hit ${urlKey} (${(blob.size/1024).toFixed(1)} KiB)`);
        } else {
          logger.info(`[Cache] downloaded ${urlKey} (${(blob.size/1024).toFixed(1)} KiB)`);
        }
      } catch (e) {
        logger.warn(`[Cache] failed ${url.split('?')[0]}: ${(e as Error)?.message}`);
      }
      done++;
      this.updateIdleProgress(Math.round((done / total) * 100));
    }));

    // Revoke object URLs that are no longer referenced by the new schedule.
    for (const [oldUrlKey, oldBlob] of this.localUrlCache) {
      if (!nextCache.has(oldUrlKey)) {
        try { URL.revokeObjectURL(oldBlob); } catch {}
      }
    }
    this.localUrlCache = nextCache;
  }

  /** Swap a remote content URL for the locally cached blob: URL if available. */
  private resolveLocalUrl(url: string | undefined | null): string {
    if (!url) return '';
    const urlKey = url.split('?')[0] ?? url;
    return this.localUrlCache.get(urlKey) ?? url;
  }

  // ── Update the idle progress bar in-place without re-rendering the screen ───
  private updateIdleProgress(pct: number): void {
    const bar = this.cfg.container.querySelector<HTMLElement>('.nexari-download-bar');
    if (bar) bar.style.width = `${pct}%`;
    const status = this.cfg.container.querySelector<HTMLElement>('.nexari-idle-status');
    if (status) status.textContent = `Downloading content… ${pct}%`;
  }

  // ── Background download → swap (mirrors Tizen downloadContentInBackground) ──
  private async downloadContentInBackground(items: ScheduleItem[], signature: string): Promise<void> {
    if (this.isDownloadingContent) {
      logger.info('[Player] download already in progress, skipping');
      return;
    }
    if (signature === this.pendingSignature) {
      logger.info('[Player] content already downloaded and pending');
      return;
    }
    this.isDownloadingContent = true;
    try {
      // Only show idle with progress when nothing is on screen
      const nothingPlaying = !this.playlistItems.length && !this.syncActive;
      if (nothingPlaying) this.showIdle('Downloading content… 0%', 0);

      await this.preCacheItems(items);

      this.pendingItems     = items;
      this.pendingSignature = signature;
      // Persist schedule for offline fallback
      try { localStorage.setItem('nexari-schedule-cache', JSON.stringify(items)); } catch { /* quota */ }
      logger.info('[Player] download complete — swapping content');
      this.swapToPending();
    } catch (err) {
      logger.error(`[Player] background download failed: ${(err as Error)?.message}`);
      if (!this.playlistItems.length) {
        if (!this.tryLoadCachedSchedule()) this.showIdle('Waiting for content…');
      }
    } finally {
      this.isDownloadingContent = false;
    }
  }

  private swapToPending(): void {
    if (!this.pendingItems) return;
    this.playlistItems        = this.pendingItems;
    this.playlistIdx          = 0;
    this.lastContentSignature = this.pendingSignature;
    this.pendingItems         = null;
    this.pendingSignature     = null;
    // If a SYNC_GROUP_INIT arrived while content was downloading, retry now.
    if (this._pendingSyncGroupMsg) {
      const syncMsg = this._pendingSyncGroupMsg;
      this._pendingSyncGroupMsg = null;
      this._pendingSyncRelayInfo = null;
      void this.initSyncGroup(syncMsg);
      return;
    }
    // If loadContent() found a cross-OS sync group, init relay now that content is ready.
    if (this._pendingSyncRelayInfo) {
      const info = this._pendingSyncRelayInfo;
      this._pendingSyncRelayInfo = null;
      logger.info(`[Player] swapToPending: starting cross-OS relay sync for group ${info.groupId}`);
      void this.initSyncGroup({
        groupId: info.groupId,
        relayUrl: info.relayUrl,
        leaderPriority: info.leaderPriority,
        expectedPeers: info.peerCount,
        syncRelayMode: 'cloud', // API relay — no device-side relay server needed
      });
      return;
    }
    if (this.syncActive) return;
    this.cancelPlayback();
    void this.renderPlaylist();
  }

  private tryLoadCachedSchedule(): boolean {
    try {
      const raw = localStorage.getItem('nexari-schedule-cache');
      if (!raw) return false;
      const items = JSON.parse(raw) as ScheduleItem[];
      if (!Array.isArray(items) || !items.length) return false;
      logger.info('[Player] using cached schedule (offline fallback)');
      this.playlistItems        = items;
      this.playlistIdx          = 0;
      this.lastContentSignature = this.getContentSignature(items);
      // Best-effort: download all referenced media in the background so future
      // renders play from local blob storage (offline resilience).
      void this.preCacheItems(items).catch(() => { /* network not available is fine */ });
      if (this.syncActive) return true;
      this.cancelPlayback();
      void this.renderPlaylist();
      return true;
    } catch {
      return false;
    }
  }

  // ── Main content loader (mirrors Tizen loadContent) ──────────────────────────
  private async loadContent(): Promise<void> {
    logger.info('[Player] loadContent');
    try {
      const schedule = await this.api.getCurrentContent(this.deviceId);
      if (!schedule || !Array.isArray(schedule.items) || !schedule.items.length) {
        logger.warn(`[Player] loadContent: no items (schedule=${schedule ? 'ok' : 'null'} items=${schedule?.items?.length ?? 0})`);
        // Content was unpublished — cancel whatever is playing and show idle.
        this.cancelPlayback();
        this.playlistItems = [];
        this.lastContentSignature = null;
        this.showIdle('Waiting for content…');
        return;
      }
      const newSig    = this.getContentSignature(schedule.items);
      const isPlaying = !!this.playlistItems.length && !!(this.playbackCancel && !this.playbackCancel.signal.aborted) || this.syncActive;

      // Unchanged + still playing → skip re-render, but kick off a cache top-up
      // in case the previous boot used a cached schedule and we never downloaded.
      if (newSig === this.lastContentSignature && this.playlistItems.length && isPlaying) {
        logger.info('[Player] content unchanged, still playing — skip');
        if (this.localUrlCache.size === 0) {
          void this.preCacheItems(this.playlistItems).catch(() => {});
        }
        return;
      }

      // Unchanged but playback stopped → force re-render from current items
      if (newSig === this.lastContentSignature && this.playlistItems.length && !isPlaying) {
        logger.warn('[Player] same signature but not playing — forcing re-render');
        this.cancelPlayback();
        void this.renderPlaylist();
        return;
      }

      logger.info(`[Player] new content (${schedule.items.length} items), downloading…`);

      // If this content belongs to a cross-OS sync group, stash relay metadata
      // so swapToPending() can call initSyncGroup() instead of renderPlaylist().
      const sg = schedule as unknown as Record<string, unknown>;
      if (sg['allTizen'] === false && sg['relayUrl']) {
        const rawPeers = (sg['peers'] as Array<{ deviceId: string; leaderPriority?: number | null }>) ?? [];
        const sortedPeers = [...rawPeers].sort((a, b) => (a.leaderPriority ?? 999) - (b.leaderPriority ?? 999));
        this._pendingSyncRelayInfo = {
          groupId: String(sg['syncGroupId'] ?? ''),
          relayUrl: String(sg['relayUrl']),
          leaderPriority: sortedPeers.map(p => p.deviceId),
          peerCount: Math.max(1, sortedPeers.length - 1), // count of OTHER peers
        };
        logger.info(`[Player] cross-OS sync group relay stored: ${this._pendingSyncRelayInfo.relayUrl}`);
      } else {
        this._pendingSyncRelayInfo = null;
      }

      void this.downloadContentInBackground(schedule.items, newSig);
    } catch (e) {
      logger.warn(`[Player] loadContent failed: ${(e as Error)?.message}`);
      if (!this.playlistItems.length) {
        if (!this.tryLoadCachedSchedule()) this.showIdle('Waiting for content…');
      }
    }
  }

  private cancelPlayback(): void {
    if (this.playbackCancel) { this.playbackCancel.abort(); this.playbackCancel = null; }
    if (this.currentHandle) { try { (this.currentHandle as CalendarHandle).destroy(); } catch {} this.currentHandle = null; }
    this.releaseVideo();
    this.cfg.container.innerHTML = '';
  }

  /**
   * Fully release a <video> element's media decoder resources.
   * On Android WebView, just .pause() + .remove() leaks the decoder buffer.
   * Must clear src, removeAttribute, call load(), then remove from DOM.
   */
  private releaseVideo(): void {
    const v = this.currentVideoEl;
    if (!v) return;
    this.currentVideoEl = null;
    try { v.pause(); } catch {}
    try { v.removeAttribute('src'); v.src = ''; } catch {}
    try { v.load(); } catch {}
    try { v.remove(); } catch {}
  }

  private async renderPlaylist(): Promise<void> {
    const ctrl = new AbortController();
    this.playbackCancel = ctrl;
    const items = this.playlistItems;
    if (!items.length) { this.showIdle('No content published'); return; }

    let idx = this.playlistIdx;
    let lastRenderedId: string | null = null;
    while (!ctrl.signal.aborted) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const item   = items[idx]!;
      const record = toContentRecord(item);
      const durMs  = getDurationMs(item);
      // If the next item is the same content we are already showing (e.g. single-item
      // playlist looping, or two consecutive identical items), skip the re-render —
      // <video loop>, <iframe>, etc. continue running on their own. Re-rendering would
      // leak media decoder slots on Android WebView and eventually OOM-kill the app.
      const sameAsLast = record.id && record.id === lastRenderedId;
      if (!sameAsLast) {
        logger.info(`[Player] item[${idx}] type=${record.type} id=${record.id} dur=${durMs}ms`);
        try { await this.renderContent(this.cfg.container, record, ctrl.signal); } catch (e) {
          if (ctrl.signal.aborted) break;
          logger.warn(`[Player] renderContent error: ${(e as Error)?.message}`);
        }
        lastRenderedId = record.id || null;
        // Auto-thumbnail: throttled screenshot ~5s after each new item renders
        this.scheduleContentChangeShot();
      }
      if (ctrl.signal.aborted) break;
      await this.sleep(durMs, ctrl.signal);
      if (ctrl.signal.aborted) break;
      idx = (idx + 1) % items.length;
    }
  }

  private sleep(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise(resolve => {
      const t = setTimeout(resolve, ms);
      signal.addEventListener('abort', () => { clearTimeout(t); resolve(); });
    });
  }

  private async renderContent(container: HTMLElement, record: ContentRecord, signal: AbortSignal): Promise<void> {
    const type = (record.type || '').toUpperCase().replace(/_/g, '').replace('HTML5', 'HTML').replace('WEBURL', 'HTML').replace('LIVESTREAM', 'LIVE_STREAM').replace('ZONELAYOUT', 'ZONE_LAYOUT').replace('MENUBOARD', 'MENU_BOARD');

    // Seamless VIDEO → VIDEO transition: keep the previous <video> in the DOM
    // until the new one has `canplay`, then release the old. This hides the
    // Android WebView default "play" overlay that flashes during teardown.
    if (type === 'VIDEO' && this.currentVideoEl) {
      await this.transitionToVideo(container, record, signal);
      return;
    }

    container.innerHTML = '';
    container.style.cssText = 'position:absolute;inset:0;overflow:hidden;background:#000;';
    if (this.currentHandle) { try { (this.currentHandle as CalendarHandle).destroy(); } catch {} this.currentHandle = null; }
    this.releaseVideo();

    switch (type) {
      case 'IMAGE':      await this.renderImage(container, record, signal); break;
      case 'VIDEO':      await this.renderVideo(container, record, signal); break;
      case 'HTML':       await this.renderHTML(container, record, signal); break;
      case 'CANVAS':     await this.renderCanvas(container, record, signal); break;
      case 'MENU_BOARD': await renderMenuBoard(container, record, this.api); break;
      case 'CALENDAR':   this.renderCalendarContent(container, record); break;
      case 'DATASYNC':   this.renderDataSyncContent(container, record); break;
      case 'LIVE_STREAM': await this.renderLiveStream(container, record, signal); break;
      case 'PDF':        await this.renderPdf(container, record, signal); break;
      case 'ZONE_LAYOUT': await this.renderZoneLayout(container, record, signal); break;
      default:
        logger.warn(`[Player] unknown content type: ${record.type}`);
        this.showIdle(`Unknown type: ${escapeHtml(record.type)}`);
    }
  }

  private renderImage(container: HTMLElement, record: ContentRecord, signal: AbortSignal): Promise<void> {
    return new Promise(resolve => {
      const url = this.resolveLocalUrl(record.url);
      if (!url) { resolve(); return; }
      const img = document.createElement('img');
      img.src = url;
      img.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#000;';
      img.onload  = () => resolve();
      img.onerror = () => { logger.warn(`[Player] image error: ${record.url}`); resolve(); };
      container.appendChild(img);
      signal.addEventListener('abort', () => { img.src=''; resolve(); });
    });
  }

  private renderVideo(container: HTMLElement, record: ContentRecord, signal: AbortSignal): Promise<void> {
    return new Promise(resolve => {
      const url = this.resolveLocalUrl(record.url);
      if (!url) { resolve(); return; }
      const v = document.createElement('video');
      v.src = url; v.autoplay=true; v.loop=true; v.playsInline=true;
      const isNexariAndroid = navigator.userAgent.includes('NexariPlayer');
      if (!isNexariAndroid) {
        v.muted = true; v.defaultMuted = true;
      }
      v.preload = 'auto';
      v.setAttribute('disablepictureinpicture', '');
      v.setAttribute('disableremoteplayback', '');
      v.controls = false;

      // Black overlay hides the WebView's loading placeholder until first frame paints.
      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;background:#000;z-index:3;';
      container.appendChild(overlay);

      v.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#000;';
      container.appendChild(v);
      this.currentVideoEl = v;
      let resolved = false;
      const done = () => { if (!resolved) { resolved = true; resolve(); } };
      v.addEventListener('loadedmetadata', () => { v.play().catch(() => {}); }, { once:true });
      v.addEventListener('playing', () => {
        if (overlay && overlay.parentNode) overlay.remove();
        if (!isNexariAndroid) v.muted = false;
        done();
      }, { once:true });
      v.addEventListener('error', () => {
        if (signal.aborted) { done(); return; }
        if (this.currentVideoEl !== v) { done(); return; }
        logger.warn(`[Player] video error: ${record.url}`);
        done();
      }, { once:true });
      signal.addEventListener('abort', () => { this.releaseVideo(); done(); });
    });
  }

  /**
   * Seamless VIDEO → VIDEO swap. Appends the new <video> on top of the
   * currently playing one, waits for `canplay`, then releases the old element.
   * Prevents the WebView default "play" overlay flash that appears when we
   * pause/remove the prior video before the new one is decoded.
   */
  private transitionToVideo(container: HTMLElement, record: ContentRecord, signal: AbortSignal): Promise<void> {
    return new Promise(resolve => {
      const url = this.resolveLocalUrl(record.url);
      if (!url) { resolve(); return; }
      const prev = this.currentVideoEl;
      const v = document.createElement('video');
      v.src = url; v.autoplay=true; v.loop=true; v.playsInline=true;
      const isNexariAndroid = navigator.userAgent.includes('NexariPlayer');
      if (!isNexariAndroid) {
        v.muted = true; v.defaultMuted = true;
      }
      v.preload = 'auto';
      v.setAttribute('disablepictureinpicture', '');
      v.setAttribute('disableremoteplayback', '');
      v.controls = false;
      // Create a solid black overlay that covers the video until it paints its first frame
      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;background:#000;z-index:3;';
      container.appendChild(overlay);

      // No opacity or complex z-index CSS on the video itself! This ensures Chromium can
      // use the native hardware overlay on cheap Android TV boxes instead of mapping the
      // video through the texture renderer (which crashes on 10-bit 4K Mali drivers).
      v.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#000;';
      container.appendChild(v);
      let resolved = false;
      let swapped  = false;
      const done = () => { if (!resolved) { resolved = true; resolve(); } };
      const swap = () => {
        if (swapped) return; swapped = true;
        // Promote the new video to "current" and release the old one.
        this.currentVideoEl = v;
        if (overlay && overlay.parentNode) {
          overlay.remove();
        }
        if (prev && prev !== v) {
          try { prev.pause(); } catch {}
          try { prev.removeAttribute('src'); prev.src = ''; } catch {}
          try { prev.load(); } catch {}
          try { prev.remove(); } catch {}
        }
        if (!navigator.userAgent.includes('NexariPlayer')) {
          v.muted = false;
        }
        done();
      };
      // `playing` fires after the first frame has been painted — guarantees we
      // never reveal the WebView's loading placeholder. Kick off play() once
      // metadata is loaded so the pipeline is filling while still hidden.
      v.addEventListener('loadedmetadata', () => { v.play().catch(() => {}); }, { once:true });
      v.addEventListener('playing', swap, { once:true });
      v.addEventListener('error', () => {
        if (signal.aborted) { done(); return; }
        // If this element has been superseded by a later transition (prev teardown
        // via src=''+load() fires a synthetic error), silently discard — the
        // successor is already playing.
        if (this.currentVideoEl !== v && swapped) { done(); return; }
        logger.warn(`[Player] video error: ${record.url}`);
        // On error, still swap so we don't get stuck on the old video.
        swap();
      }, { once:true });
      signal.addEventListener('abort', () => {
        // Tear down whichever element is still being prepared.
        try { v.pause(); } catch {}
        try { v.removeAttribute('src'); v.src = ''; } catch {}
        try { v.load(); } catch {}
        try { v.remove(); } catch {}
        if (this.currentVideoEl === v) this.currentVideoEl = null;
        done();
      });
    });
  }

  private renderHTML(container: HTMLElement, record: ContentRecord, signal: AbortSignal): Promise<void> {
    return new Promise(resolve => {
      // HTML5/web_url packages must stream from the API (they contain relative
      // asset references). Don't substitute a blob URL — keep the original.
      if (!record.url) { resolve(); return; }
      const frame = document.createElement('iframe');
      frame.src = record.url;
      frame.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;border:0;background:#000;';
      // No sandbox for html5/web_url — these are trusted uploads that need full JS execution.
      // A sandboxed unique origin would break scripts that reference window.parent or use cookies.
      frame.onload = () => resolve();
      frame.onerror = () => { logger.warn(`[Player] iframe error: ${record.url}`); resolve(); };
      container.appendChild(frame);
      signal.addEventListener('abort', () => { frame.src='about:blank'; frame.remove(); resolve(); });
    });
  }

  private async renderCanvas(container: HTMLElement, record: ContentRecord, signal: AbortSignal): Promise<void> {
    const meta = parseMetadata(record);
    const url = String(meta['url'] ?? record.url ?? '');
    if (!url) { this.showIdle('Canvas: no URL'); return; }
    if (/\.(mp4|webm|mov|m4v)(\?|$)/i.test(url)) {
      await this.renderVideo(container, { ...record, url }, signal);
    } else if (/\.(jpg|jpeg|png|gif|webp|svg)(\?|$)/i.test(url)) {
      await this.renderImage(container, { ...record, url }, signal);
    } else {
      await this.renderHTML(container, { ...record, url }, signal);
    }
  }

  private renderCalendarContent(container: HTMLElement, record: ContentRecord): void {
    this.currentHandle = renderCalendar(
      container, record, this.api, this.deviceId, this.ws,
      (contentId, handler) => {
        this.calendarPushHandlers.set(contentId, handler);
        return () => { this.calendarPushHandlers.delete(contentId); };
      },
    );
  }

  private renderDataSyncContent(container: HTMLElement, record: ContentRecord): void {
    this.currentHandle = renderDataSync(container, record.id, this.cfg.apiBase, this.deviceId);
  }

  private renderLiveStream(container: HTMLElement, record: ContentRecord, signal: AbortSignal): Promise<void> {
    return new Promise(resolve => {
      const url = record.url || '';
      if (!url) { resolve(); return; }
      const v = document.createElement('video');
      v.autoplay=true; v.muted=false; v.playsInline=true;
      v.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#000;';
      container.appendChild(v);
      this.currentVideoEl = v;

      if (/\.m3u8/i.test(url)) {
        const Hls = (window as unknown as Record<string, unknown>)['Hls'] as { isSupported(): boolean; new(): { loadSource(u:string): void; attachMedia(v:HTMLVideoElement): void; }; }|undefined;
        if (Hls?.isSupported()) {
          const hls = new Hls();
          hls.loadSource(url);
          hls.attachMedia(v);
          v.addEventListener('canplay', () => { v.play().catch(()=>{}); resolve(); }, { once:true });
          signal.addEventListener('abort', () => { try{v.pause();}catch{} v.src=''; v.remove(); resolve(); });
          return;
        }
      }
      v.src = url;
      v.addEventListener('canplay', () => { v.play().catch(()=>{}); resolve(); }, { once:true });
      v.addEventListener('error',   () => { logger.warn(`[Player] live stream error: ${url}`); resolve(); }, { once:true });
      signal.addEventListener('abort', () => { try{v.pause();}catch{} v.src=''; v.remove(); resolve(); });
    });
  }

  private async renderPdf(container: HTMLElement, record: ContentRecord, signal: AbortSignal): Promise<void> {
    if (!record.url) { this.showIdle('PDF: no URL'); return; }
    try {
      await this.renderPdfWithPdfJs(container, record, signal);
    } catch (e) {
      logger.warn(`[Player] PDF render failed, falling back to iframe: ${(e as Error)?.message}`);
      await this.renderHTML(container, record, signal);
    }
  }

  /**
   * PDF.js-based renderer. Mirrors the Tizen implementation: lazy-loads
   * pdfjs/pdf.min.js (shipped in android assets via sync-player-web.cjs),
   * fetches the PDF as a Uint8Array (from local blob cache when available),
   * renders each page to a canvas and auto-advances every durMs/numPages.
   */
  private async renderPdfWithPdfJs(container: HTMLElement, record: ContentRecord, signal: AbortSignal): Promise<void> {
    const lib = await this.loadPdfJs();
    const url = this.resolveLocalUrl(record.url);
    if (!url) throw new Error('no url');

    const ab = await (await fetch(url)).arrayBuffer();
    if (signal.aborted) return;

    const pdf = await lib.getDocument({ data: new Uint8Array(ab) }).promise;
    if (signal.aborted) return;
    logger.info(`[Player] PDF loaded ${pdf.numPages} page(s)`);

    // Do NOT change container.style here — renderContent already set it to
    // position:absolute;inset:0;overflow:hidden;background:#000 which fills the
    // screen. Setting position:relative would collapse the container to 0px height
    // and overflow:hidden would clip all canvas children, causing a black screen.

    let activeCanvas: HTMLCanvasElement | null = null;
    let currentRenderTask: { cancel?: () => void; promise: Promise<unknown> } | null = null;

    const renderPage = async (num: number): Promise<HTMLCanvasElement | null> => {
      if (currentRenderTask?.cancel) { try { currentRenderTask.cancel(); } catch {} }
      try {
        const page = await pdf.getPage(num);
        const cw = Math.max(container.offsetWidth || window.innerWidth || 1920, 1);
        const ch = Math.max(container.offsetHeight || window.innerHeight || 1080, 1);
        const nativeVp = page.getViewport({ scale: 1 });
        const scale = Math.min(cw / nativeVp.width, ch / nativeVp.height);
        const viewport = page.getViewport({ scale });

        const canvas = document.createElement('canvas');
        canvas.width  = Math.max(Math.floor(viewport.width),  1);
        canvas.height = Math.max(Math.floor(viewport.height), 1);
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;

        const left = Math.floor((cw - viewport.width) / 2);
        const top  = Math.floor((ch - viewport.height) / 2);
        canvas.style.cssText = `position:absolute;left:${left}px;top:${top}px;background:#000;`;

        currentRenderTask = page.render({ canvasContext: ctx, viewport });
        await currentRenderTask.promise;
        currentRenderTask = null;
        return canvas;
      } catch (e) {
        const name = (e as { name?: string })?.name;
        if (name === 'RenderingCancelledException') return null;
        logger.warn(`[Player] PDF page ${num} render error: ${(e as Error)?.message}`);
        return null;
      }
    };

    // Show page 1
    const first = await renderPage(1);
    if (signal.aborted) return;
    if (first) { container.appendChild(first); activeCanvas = first; }

    if (pdf.numPages <= 1) return;

    // Auto-flip pages. Tie the cycle to the playlist duration: divide evenly
    // across pages, with a 4s floor so individual pages are readable.
    const durMs = getDurationMs({ content: record, duration: undefined } as ScheduleItem);
    const perPage = Math.max(Math.floor(durMs / pdf.numPages), 4000);
    let currentPage = 1;

    const advance = async () => {
      if (signal.aborted) return;
      currentPage = (currentPage % pdf.numPages) + 1;
      const next = await renderPage(currentPage);
      if (signal.aborted) { return; }
      if (next && container.isConnected) {
        if (activeCanvas && activeCanvas.parentNode === container) container.replaceChild(next, activeCanvas);
        else container.appendChild(next);
        activeCanvas = next;
      }
    };

    const interval = setInterval(() => { void advance(); }, perPage);
    signal.addEventListener('abort', () => {
      clearInterval(interval);
      if (currentRenderTask?.cancel) { try { currentRenderTask.cancel(); } catch {} }
    });
  }

  // Cache for the pdfjsLib promise so we only inject the script tag once.
  private pdfJsLibPromise: Promise<{
    getDocument: (src: { data: Uint8Array }) => { promise: Promise<{
      numPages: number;
      getPage: (n: number) => Promise<{
        getViewport: (o: { scale: number }) => { width: number; height: number };
        render: (o: { canvasContext: CanvasRenderingContext2D; viewport: unknown }) => { promise: Promise<unknown>; cancel?: () => void };
      }>;
    }> };
    GlobalWorkerOptions: { workerSrc: string };
  }> | null = null;

  private loadPdfJs(): Promise<NonNullable<typeof this.pdfJsLibPromise> extends Promise<infer T> ? T : never> {
    if (this.pdfJsLibPromise) return this.pdfJsLibPromise as Promise<never>;
    this.pdfJsLibPromise = new Promise((resolve, reject) => {
      const existing = (window as unknown as { pdfjsLib?: unknown }).pdfjsLib;
      const onReady = () => {
        const lib = (window as unknown as { pdfjsLib?: { GlobalWorkerOptions: { workerSrc: string } } }).pdfjsLib;
        if (!lib) { reject(new Error('pdfjsLib failed to load')); return; }
        try { lib.GlobalWorkerOptions.workerSrc = 'pdfjs/pdf.worker.min.js'; } catch {}
        resolve(lib as never);
      };
      if (existing) { onReady(); return; }
      const s = document.createElement('script');
      s.src = 'pdfjs/pdf.min.js';
      s.onload  = () => onReady();
      s.onerror = () => reject(new Error('failed to load pdfjs/pdf.min.js'));
      document.head.appendChild(s);
    });
    return this.pdfJsLibPromise as Promise<never>;
  }

  private async renderZoneLayout(container: HTMLElement, record: ContentRecord, signal: AbortSignal): Promise<void> {
    const meta = parseMetadata(record);
    // ZoneConfig shape from ZoneLayoutEditor: { id, rect:{x,y,width,height}, source:{type,contentId,contentType}|null }
    // rect is in absolute pixels on a 1920×1080 canvas.
    type ZoneSource = { type: 'content'; contentId: string; contentType?: string }
      | { type: 'playlist'; playlistId: string }
      | { type: 'empty' };
    type ZoneConfig = {
      id: string;
      rect?: { x: number; y: number; width: number; height: number };
      // Legacy flat format (percentages)
      x?: number; y?: number; width?: number; height?: number;
      source?: ZoneSource | null;
      url?: string;     // legacy
      type?: string;    // legacy
      fitMode?: 'fill' | 'contain' | null;
    };
    const zones = (meta['zones'] as ZoneConfig[]) ?? [];
    if (!zones.length) { this.showIdle('Zone layout: no zones'); return; }

    // Read the coordinate space this zone layout was authored in.
    // Stored by ZoneLayoutEditor as canvasWidth/canvasHeight in metadata.
    // Fallback to 1920×1080 for legacy zone layouts that pre-date this field.
    const CANVAS_W = typeof meta['canvasWidth'] === 'number' ? meta['canvasWidth'] : 1920;
    const CANVAS_H = typeof meta['canvasHeight'] === 'number' ? meta['canvasHeight'] : 1080;
    logger.info(`[Zone] canvas ${CANVAS_W}×${CANVAS_H}, ${zones.length} zone(s)`);

    for (const zone of zones) {
      if (signal.aborted) break;

      // Resolve coordinates — prefer nested rect (pixel), fall back to flat (percentage)
      const r = zone.rect;
      let l: number, t: number, w: number, h: number;
      if (r) {
        // Pixel-space 1920×1080 → percentage
        l = (r.x / CANVAS_W) * 100;
        t = (r.y / CANVAS_H) * 100;
        w = (r.width  / CANVAS_W) * 100;
        h = (r.height / CANVAS_H) * 100;
      } else {
        // Legacy: already percentage
        l = zone.x ?? 0; t = zone.y ?? 0; w = zone.width ?? 100; h = zone.height ?? 100;
      }

      const el = document.createElement('div');
      el.style.cssText = `position:absolute;left:${l.toFixed(4)}%;top:${t.toFixed(4)}%;width:${w.toFixed(4)}%;height:${h.toFixed(4)}%;overflow:hidden;background:#000;`;
      container.appendChild(el);

      const src = zone.source;
      const objectFit = zone.fitMode === 'fill' ? 'cover' : 'contain';

      if (src?.type === 'content' && src.contentId) {
        const tok = this.token;
        const contentType = (src.contentType ?? 'image').toLowerCase();
        if (contentType === 'html5') {
          const frame = document.createElement('iframe');
          frame.src = tok
            ? `${this.cfg.apiBase}/devices/device/content/${encodeURIComponent(src.contentId)}/html5/${encodeURIComponent(tok)}/`
            : '';
          frame.style.cssText = 'width:100%;height:100%;border:0;background:#000;';
          el.appendChild(frame);
          signal.addEventListener('abort', () => { frame.src = 'about:blank'; });
        } else if (contentType === 'video') {
          const fileUrl = `${this.cfg.apiBase}/devices/device/content/${encodeURIComponent(src.contentId)}/file${tok ? `?token=${encodeURIComponent(tok)}` : ''}`;
          const v = document.createElement('video');
          v.src = fileUrl; v.autoplay = true; v.loop = true; v.muted = true; v.playsInline = true;
          v.style.cssText = `width:100%;height:100%;object-fit:${objectFit};background:#000;`;
          el.appendChild(v);
          v.play().catch(() => {});
          signal.addEventListener('abort', () => { v.pause(); v.src = ''; });
        } else {
          // image (default) or web_url
          const fileUrl = contentType === 'web_url'
            ? (src as { contentId: string; contentType?: string; webUrl?: string })['webUrl'] ?? ''
            : `${this.cfg.apiBase}/devices/device/content/${encodeURIComponent(src.contentId)}/file${tok ? `?token=${encodeURIComponent(tok)}` : ''}`;
          const img = document.createElement('img');
          img.src = fileUrl;
          img.style.cssText = `width:100%;height:100%;object-fit:${objectFit};background:#000;`;
          img.onerror = () => logger.warn(`[Zone] image load error: ${src.contentId}`);
          el.appendChild(img);
        }
      } else if (zone.url) {
        // Legacy: zone has a direct URL
        const frame = document.createElement('iframe');
        frame.src = zone.url;
        frame.style.cssText = 'width:100%;height:100%;border:0;background:#000;';
        el.appendChild(frame);
        signal.addEventListener('abort', () => { frame.src = 'about:blank'; });
      }
      // type === 'playlist' or 'empty': leave zone with black background for now
    }
    // renderZoneLayout returns immediately — the player then sleeps for durMs (zone_layout is NOT a looper)
  }

  private async initSyncGroup(msg: Record<string, unknown>): Promise<void> {
    if (this.syncActive) { try { syncStop(); } catch {} this.syncActive = false; }
    const groupId       = String(msg['groupId'] ?? '');
    const expectedPeers = Number(msg['expectedPeers'] ?? 1);

    // Determine if this device is the elected leader.
    const leaderPriority = Array.isArray(msg['leaderPriority']) ? msg['leaderPriority'] as string[] : [];

    // Always derive relay URL from this device's own API base + token so it connects
    // to the same host it already uses (LAN IP or cloud). The manifest's relayUrl
    // is built server-side from APP_URL and may point to the wrong host/scheme.
    const tok = this.token;
    const wsBase = this.cfg.apiBase
      .replace(/\/api\/v1\/?$/, '')   // strip /api/v1 suffix
      .replace(/^http/, 'ws');         // http→ws, https→wss
    const wsUrl = `${wsBase}/api/v1/sync-relay/ws${tok ? '?token=' + encodeURIComponent(tok) : ''}`;
    logger.info(`[Sync] relay URL: ${wsUrl}`);

    let urls = this.playlistItems.map(i => this.resolveLocalUrl(i.content?.url) || '').filter(Boolean);
    if (!urls.length) {
      // Content not downloaded yet — store msg and retry after download completes.
      logger.info('[Player] syncGroup: no video URLs yet, deferring until download completes');
      this._pendingSyncGroupMsg = msg;
      return;
    }

    this.cancelPlayback();
    const container = this.cfg.container;
    container.innerHTML = '';
    await initEngine(container);
    setPlaylist(urls);

    const net = await this.cfg.adapter.getNetworkInfo();
    this.syncActive = true;
    syncInit({
      wsUrl, groupId, deviceId: this.deviceId, selfIp: net.ipAddress ?? '',
      expectedPeers, onStatus: s => logger.info(`[Sync] ${s}`),
      // Android WebView has higher video decode startup latency (~100ms).
      // Negative selfLatency tells the engine to call play() that many ms earlier
      // so the first rendered frame aligns with other devices.
      selfLatency: this.platform === 'android' ? -100 : 0,
      prepareEngine: url => prepare(url),
      schedulePlay:  epochMs => schedulePlayAt(epochMs),
      getEngineDuration: () => getDuration(),
      restartEngine: () => {
        try { destroyEngine(); } catch {}
        void initEngine(container).then(() => setPlaylist(urls));
      },
    }).catch(e => { logger.error(`[Sync] init failed: ${(e as Error)?.message}`); this.syncActive=false; });
  }

  private async initVideoWall(msg: Record<string, unknown>): Promise<void> {
    // 1. Compute wall crop — prefer new geometry+myCell format, fall back to legacy flat fields.
    let srcX = 0, srcY = 0, srcW = window.innerWidth, srcH = window.innerHeight;
    let dstW = window.innerWidth, dstH = window.innerHeight;
    const geo    = msg['geometry']  as Record<string, unknown> | null | undefined;
    const myCell = msg['myCell']    as Record<string, unknown> | null | undefined;
    if (geo && myCell) {
      const colWidths  = (geo['colWidths']  as number[]) ?? [];
      const rowHeights = (geo['rowHeights'] as number[]) ?? [];
      const col     = Number(myCell['positionCol'] ?? 0);
      const row     = Number(myCell['positionRow'] ?? 0);
      const colSpan = Number(myCell['colSpan']      ?? 1);
      const rowSpan = Number(myCell['rowSpan']      ?? 1);
      let offsetX = 0; for (let c = 0; c < col; c++) offsetX += (colWidths[c]  || 0);
      let offsetY = 0; for (let r = 0; r < row; r++) offsetY += (rowHeights[r] || 0);
      let cellW = 0; for (let c = col; c < col + colSpan; c++) cellW += (colWidths[c]  || 0);
      let cellH = 0; for (let r = row; r < row + rowSpan; r++) cellH += (rowHeights[r] || 0);
      srcX = offsetX; srcY = offsetY; srcW = cellW; srcH = cellH;
      dstW = Number(geo['canvasW'] ?? window.innerWidth);
      dstH = Number(geo['canvasH'] ?? window.innerHeight);
    } else {
      srcX = Number(msg['srcX'] ?? 0);              srcY = Number(msg['srcY'] ?? 0);
      srcW = Number(msg['srcW'] ?? window.innerWidth); srcH = Number(msg['srcH'] ?? window.innerHeight);
      dstW = Number(msg['dstW'] ?? window.innerWidth); dstH = Number(msg['dstH'] ?? window.innerHeight);
    }
    setWallCrop(srcX, srcY, srcW, srcH, dstW, dstH);
    logger.info(`[Player] videowall crop srcX=${srcX} srcY=${srcY} srcW=${srcW} srcH=${srcH} canvas ${dstW}x${dstH}`);

    // 2. Stop any previous sync/relay before starting new session.
    if (this.syncActive) { try { syncStop(); } catch {} this.syncActive = false; }

    // 3. Derive relay URL from this device's own API base + token.
    const leaderPriority = Array.isArray(msg['leaderPriority']) ? msg['leaderPriority'] as string[] : [];
    const tok2 = this.token;
    const wsBase2 = this.cfg.apiBase.replace(/\/api\/v1\/?$/, '').replace(/^http/, 'ws');
    const wsUrl = `${wsBase2}/api/v1/sync-relay${tok2 ? '?token=' + encodeURIComponent(tok2) : ''}`;

    // 4. Start sync engine — same flow as initSyncGroup.
    const groupId      = String(msg['deviceGroupId'] ?? msg['groupId'] ?? '');
    const peers        = Array.isArray(msg['peers']) ? msg['peers'] as unknown[] : [];
    const expectedPeers = peers.length - 1 || 1; // other peers count
    const urls = this.playlistItems.map(i => this.resolveLocalUrl(i.content?.url) || '').filter(Boolean);
    if (!urls.length) { logger.warn('[Player] videowall: no video URLs'); return; }

    this.cancelPlayback();
    const container = this.cfg.container;
    container.innerHTML = '';
    await initEngine(container);
    setPlaylist(urls);

    const net = await this.cfg.adapter.getNetworkInfo();
    this.syncActive = true;
    syncInit({
      wsUrl, groupId, deviceId: this.deviceId, selfIp: net.ipAddress ?? '',
      expectedPeers, onStatus: s => logger.info(`[Sync/Wall] ${s}`),
      selfLatency: this.platform === 'android' ? -100 : 0,
      prepareEngine: url => prepare(url),
      schedulePlay:  epochMs => schedulePlayAt(epochMs),
      getEngineDuration: () => getDuration(),
      restartEngine: () => {
        try { destroyEngine(); } catch {}
        void initEngine(container).then(() => setPlaylist(urls));
      },
    }).catch(e => { logger.error(`[Sync/Wall] init: ${(e as Error)?.message}`); this.syncActive = false; });
  }

  private sendOta(p: PlatformOtaProgress): void {
    this.send({ type:p.kind, version:p.version, packageId:p.packageId, pct:p.pct, error:p.error });
  }

  private showIdle(msg: string, downloadProgress?: number): void {
    const progressBar = (downloadProgress !== undefined && downloadProgress >= 0 && downloadProgress < 100)
      ? `<div style="width:200px;height:8px;background:rgba(255,255,255,.15);border-radius:4px;margin:20px auto;overflow:hidden;">
           <div class="nexari-download-bar" style="width:${downloadProgress}%;height:100%;background:linear-gradient(90deg,#3a7bff,#4ff2d1);transition:width .3s;"></div>
         </div>`
      : '';

    const deviceLabel = escapeHtml(this.deviceDisplayName);

    this.cfg.container.innerHTML = `
      <div style="position:absolute;inset:0;background:#0d0f1a;display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:system-ui,sans-serif;">
        <!-- bg grid -->
        <div style="position:absolute;inset:0;background-image:linear-gradient(rgba(255,255,255,.03) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.03) 1px,transparent 1px);background-size:40px 40px;pointer-events:none;"></div>

        <!-- card -->
        <div style="position:relative;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:24px;padding:48px 64px;text-align:center;min-width:340px;">

          <!-- Nexari logo -->
          <div style="display:flex;align-items:center;justify-content:center;gap:16px;margin-bottom:${deviceLabel ? '8px' : '24px'};">
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

          ${deviceLabel ? `<div style="font-size:13px;color:#666;margin-bottom:20px;">${deviceLabel}</div>` : ''}

          <div style="height:1px;background:rgba(255,255,255,.08);margin:0 0 20px;"></div>

          <!-- status row -->
          <div style="display:flex;align-items:center;justify-content:center;gap:8px;">
            <span style="width:8px;height:8px;border-radius:50%;background:#3a7bff;box-shadow:0 0 8px #3a7bff;animation:nexariPulse 2s ease-in-out infinite;display:inline-block;"></span>
            <span class="nexari-idle-status" style="font-size:15px;color:#888;">${escapeHtml(msg)}</span>
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
}
