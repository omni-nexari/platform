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

  private calendarPushHandlers = new Map<string, (events: CalendarEvent[]) => void>();
  private syncActive = false;

  // Content download / cache state (mirrors Tizen downloadContentInBackground flow)
  private lastContentSignature: string | null = null;
  private pendingItems: ScheduleItem[] | null = null;
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
    this.deviceDisplayName = info.modelName || info.modelCode || '';
    initLogger({ apiBase: this.cfg.apiBase, deviceId: info.deviceId });
    logger.info(`[Player] starting deviceId=${info.deviceId} platform=${info.platform}`);

    this.showIdle('Connecting…');
    void this.syncNtp();

    this.token = await this.ensurePaired();
    logger.info(`[Player] paired (token: ${this.token ? 'ok' : 'none'})`);

    // Try offline cache first so something shows immediately while we connect
    if (!this.tryLoadCachedSchedule()) this.showIdle('Waiting for content…');

    this.connectWs();
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
    const url = `${this.cfg.wsBase}/api/v1/devices/ws/${encodeURIComponent(this.deviceId)}${this.token ? `?token=${encodeURIComponent(this.token)}` : ''}`;
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
        const result = await this.cfg.adapter.installUpdate({
          url, version, sha256: msg['sha256'] as string|undefined,
          onProgress: p => this.sendOta(p),
        });
        this.sendOta(result);
        return;
      }
      case 'SYNC_GROUP_INIT': await this.initSyncGroup(msg); return;
      case 'VIDEOWALL_INIT':   this.initVideoWall(msg); return;
      default: return;
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
      case 'refresh_schedule': await this.loadContent(); return;
      case 'screenshot': {
        const shot = await a.screenshot();
        // Deliver via WS so the API persists it in deviceScreenshots
        if (shot) this.send({ type: 'screenshot_data', payload: { dataBase64: shot, trigger: 'manual' } });
        return;
      }
      case 'screenshot_auto': {
        const shot = await a.screenshot().catch(() => null);
        if (shot) this.send({ type: 'screenshot_data', payload: { dataBase64: shot, trigger: 'auto' } });
        return;
      }
      case 'set_volume':
        if (typeof payload?.['level'] === 'number') await a.setVolume(payload['level'] as number);
        return;
      case 'set_mute':
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
      default: logger.warn(`[Player] unhandled command: ${command}`);
    }
  }

  private async sendHeartbeat(): Promise<void> {
    if (!this.wsReady) return;
    try {
      const info  = await this.cfg.adapter.getDeviceInfo();
      const net   = await this.cfg.adapter.getNetworkInfo();
      const power = await this.cfg.adapter.getPowerState();
      await this.api.sendHeartbeat(this.deviceId, {
        playerVersion: info.playerVersion, firmwareVersion: info.firmwareVersion,
        timezone: info.timezone, resolution: info.resolution,
        powerState: power, kind: info.kind, batteryPct: info.batteryPct,
        ipAddress: net.ipAddress, macAddress: info.macAddress,
        currentContentId: this.playlistItems[this.playlistIdx]?.content?.id ?? null,
        token: this.token,
      });
    } catch { /**/ }
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

  // ── Pre-cache all media files via the browser Cache API ─────────────────────
  private async preCacheItems(items: ScheduleItem[]): Promise<void> {
    if (!('caches' in window)) return; // Cache API not available (e.g. http:// or old Android)
    const cache = await caches.open('nexari-content-v1');
    const urls = items
      .map(i => i.content?.url ?? '')
      .filter(u => u && /\.(mp4|webm|jpg|jpeg|png|gif|webp|svg)(\?|$)/i.test(u));
    const total = urls.length;
    if (!total) return;

    let done = 0;
    await Promise.allSettled(urls.map(async (url) => {
      try {
        const cached = await cache.match(url);
        if (!cached) await cache.add(url);
      } catch { /* network error — not fatal */ }
      done++;
      this.updateIdleProgress(Math.round((done / total) * 100));
    }));
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
        if (!this.playlistItems.length) this.showIdle('Waiting for content…');
        return;
      }
      const newSig    = this.getContentSignature(schedule.items);
      const isPlaying = !!this.playlistItems.length && !!(this.playbackCancel && !this.playbackCancel.signal.aborted) || this.syncActive;

      // Unchanged + still playing → skip
      if (newSig === this.lastContentSignature && this.playlistItems.length && isPlaying) {
        logger.info('[Player] content unchanged, still playing — skip');
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
    if (this.currentVideoEl) { try { this.currentVideoEl.pause(); } catch {} this.currentVideoEl.remove(); this.currentVideoEl = null; }
    this.cfg.container.innerHTML = '';
  }

  private async renderPlaylist(): Promise<void> {
    const ctrl = new AbortController();
    this.playbackCancel = ctrl;
    const items = this.playlistItems;
    if (!items.length) { this.showIdle('No content published'); return; }

    let idx = this.playlistIdx;
    while (!ctrl.signal.aborted) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const item   = items[idx]!;
      const record = toContentRecord(item);
      const durMs  = getDurationMs(item);
      logger.info(`[Player] item[${idx}] type=${record.type} id=${record.id} dur=${durMs}ms`);
      try { await this.renderContent(this.cfg.container, record, ctrl.signal); } catch (e) {
        if (ctrl.signal.aborted) break;
        logger.warn(`[Player] renderContent error: ${(e as Error)?.message}`);
      }
      if (ctrl.signal.aborted) break;
      const isLooper = ['CALENDAR','MENU_BOARD','DATASYNC','ZONE_LAYOUT'].includes(record.type.toUpperCase());
      if (!isLooper) await this.sleep(durMs, ctrl.signal);
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
    container.innerHTML = '';
    container.style.cssText = 'position:absolute;inset:0;overflow:hidden;background:#000;';
    if (this.currentHandle) { try { (this.currentHandle as CalendarHandle).destroy(); } catch {} this.currentHandle = null; }
    if (this.currentVideoEl) { try { this.currentVideoEl.pause(); } catch {} this.currentVideoEl.remove(); this.currentVideoEl = null; }

    const type = (record.type || '').toUpperCase();
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
        logger.warn(`[Player] unknown content type: ${type}`);
        this.showIdle(`Unknown type: ${escapeHtml(type)}`);
    }
  }

  private renderImage(container: HTMLElement, record: ContentRecord, signal: AbortSignal): Promise<void> {
    return new Promise(resolve => {
      if (!record.url) { resolve(); return; }
      const img = document.createElement('img');
      img.src = record.url;
      img.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#000;';
      img.onload  = () => resolve();
      img.onerror = () => { logger.warn(`[Player] image error: ${record.url}`); resolve(); };
      container.appendChild(img);
      signal.addEventListener('abort', () => { img.src=''; resolve(); });
    });
  }

  private renderVideo(container: HTMLElement, record: ContentRecord, signal: AbortSignal): Promise<void> {
    return new Promise(resolve => {
      if (!record.url) { resolve(); return; }
      const v = document.createElement('video');
      v.src = record.url; v.autoplay=true; v.loop=true; v.muted=false; v.playsInline=true;
      v.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#000;';
      container.appendChild(v);
      this.currentVideoEl = v;
      v.addEventListener('canplay', () => { v.play().catch(()=>{}); resolve(); }, { once:true });
      v.addEventListener('error',   () => { logger.warn(`[Player] video error: ${record.url}`); resolve(); }, { once:true });
      signal.addEventListener('abort', () => { try{v.pause();}catch{} v.src=''; v.remove(); this.currentVideoEl=null; resolve(); });
    });
  }

  private renderHTML(container: HTMLElement, record: ContentRecord, signal: AbortSignal): Promise<void> {
    return new Promise(resolve => {
      if (!record.url) { resolve(); return; }
      const frame = document.createElement('iframe');
      frame.src = record.url;
      frame.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;border:0;background:#000;';
      frame.sandbox.add('allow-scripts','allow-same-origin','allow-forms','allow-popups');
      frame.onload = () => resolve();
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
    await this.renderHTML(container, record, signal);
  }

  private async renderZoneLayout(container: HTMLElement, record: ContentRecord, signal: AbortSignal): Promise<void> {
    const meta = parseMetadata(record);
    type ZoneDef = { id:string; x:number; y:number; width:number; height:number; url?:string; type?:string; };
    const zones = (meta['zones'] as ZoneDef[]) || [];
    if (!zones.length) { this.showIdle('Zone layout: no zones'); return; }
    container.style.position = 'absolute';
    for (const zone of zones) {
      if (signal.aborted) break;
      const el = document.createElement('div');
      el.style.cssText = `position:absolute;left:${zone.x}%;top:${zone.y}%;width:${zone.width}%;height:${zone.height}%;overflow:hidden;`;
      container.appendChild(el);
      if (zone.url) {
        const rec: ContentRecord = { id:zone.id||'zone', type:zone.type||'HTML', url:zone.url };
        try { await this.renderContent(el, rec, signal); } catch { /**/ }
      }
    }
  }

  private async initSyncGroup(msg: Record<string, unknown>): Promise<void> {
    if (this.syncActive) { try { syncStop(); } catch {} this.syncActive = false; }
    const groupId       = String(msg['groupId'] ?? '');
    const expectedPeers = Number(msg['expectedPeers'] ?? 1);
    const wsUrl         = String(msg['relayUrl'] ?? this.cfg.wsBase.replace(/^wss?:\/\//, 'ws://') + '/sync');
    const urls = this.playlistItems.map(i => i.content?.url || '').filter(Boolean);
    if (!urls.length) { logger.warn('[Player] syncGroup: no video URLs'); return; }

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
      prepareEngine: url => prepare(url),
      schedulePlay:  epochMs => schedulePlayAt(epochMs),
      getEngineDuration: () => getDuration(),
      restartEngine: () => {
        try { destroyEngine(); } catch {}
        void initEngine(container).then(() => setPlaylist(urls));
      },
    }).catch(e => { logger.error(`[Sync] init failed: ${(e as Error)?.message}`); this.syncActive=false; });
  }

  private initVideoWall(msg: Record<string, unknown>): void {
    const srcX=Number(msg['srcX']??0), srcY=Number(msg['srcY']??0);
    const srcW=Number(msg['srcW']??window.innerWidth), srcH=Number(msg['srcH']??window.innerHeight);
    const dstW=Number(msg['dstW']??window.innerWidth), dstH=Number(msg['dstH']??window.innerHeight);
    setWallCrop(srcX, srcY, srcW, srcH, dstW, dstH);
    logger.info(`[Player] videowall crop srcX=${srcX} srcY=${srcY} srcW=${srcW} srcH=${srcH}`);
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
