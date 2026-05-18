/**
 * player.ts — full-featured Windows player renderer.
 *
 * Feature parity with the Tizen player:
 *  IMAGE, VIDEO, LIVE_STREAM (HLS), IPTV, CHANNEL_GROUP, HTML, HTML5,
 *  CANVAS, PDF, OFFICE, DATASYNC, MENU_BOARD, VIDEOWALL, ZONE_LAYOUT,
 *  CALENDAR, OVERLAY, PRESENTATION
 *
 * Scheduling: fetches GET /devices/device/schedule every 60 s, applies
 * time-slot logic identically to the Tizen player.
 *
 * Syncplay: connects to wss://…/api/v1/sync-relay?token=… for WS group sync.
 *
 * IPC from main process: CMD_LOAD_URL, CMD_SLEEP, CMD_DISPLAY_POWER,
 *   UPDATE_AVAILABLE, UPDATE_PROGRESS, UPDATE_DOWNLOADED, WS_MESSAGE.
 */

import Hls from 'hls.js';
import * as PdfjsLib from 'pdfjs-dist';
import * as ApiClient from './api.js';
import type { Playlist, PlaylistItem, NormalizedContent } from './api.js';
import { computeTileCssTransform, type WallMember } from '@signage/shared';
import {
  initPlayerSettings,
  onAutoUpdateAvailable,
  onAutoUpdateDownloaded,
  setWsStatus as psSetWsStatus,
} from './player-settings.js';

// PDF.js worker (Vite copies the worker asset)
PdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

// ---------------------------------------------------------------------------
// Remote log ring buffer (mirrors nexari-tizen LogBuffer)
// ---------------------------------------------------------------------------
const LOG_MAX = 300;
type LogLevel = 'debug' | 'info' | 'warn' | 'error';
interface LogEntry { level: LogLevel; line: string; }
const _logRing: LogEntry[] = [];
let _liveLogTimer: ReturnType<typeof setInterval> | null = null;

function logArgs(args: unknown[]): string {
  return args.map((a) => {
    if (typeof a === 'string') return a;
    if (a instanceof Error) return a.message + (a.stack ? '\n' + a.stack.split('\n').slice(1, 3).join('\n') : '');
    try { return JSON.stringify(a); } catch { return String(a); }
  }).join(' ');
}

function appendLog(level: LogLevel, args: unknown[]) {
  const raw  = logArgs(args);
  // Don't double-prefix: messages already tagged with [Player] are stored as-is
  const line = raw.startsWith('[') ? raw : `[Player] ${raw}`;
  _logRing.push({ level, line });
  if (_logRing.length > LOG_MAX) _logRing.splice(0, _logRing.length - LOG_MAX);
}

function flushLogs(maxEntries = 200) {
  const count = Math.min(maxEntries, _logRing.length);
  if (count === 0) return;
  const entries = _logRing.splice(_logRing.length - count, count);

  // Group by level and send as batches
  const byLevel: Partial<Record<LogLevel, string[]>> = {};
  for (const e of entries) {
    (byLevel[e.level] ??= []).push(e.line);
  }
  for (const [level, lines] of Object.entries(byLevel) as [LogLevel, string[]][]) {
    if (lines.length > 0) window.nexari.sendDeviceLog(level, lines);
  }
}

// Intercept console methods
const _origLog   = console.log.bind(console);
const _origInfo  = console.info.bind(console);
const _origWarn  = console.warn.bind(console);
const _origError = console.error.bind(console);
const _origDebug = console.debug.bind(console);

console.log   = (...a) => { _origLog(...a);   appendLog('info',  a); };
console.info  = (...a) => { _origInfo(...a);  appendLog('info',  a); };
console.warn  = (...a) => { _origWarn(...a);  appendLog('warn',  a); };
console.error = (...a) => { _origError(...a); appendLog('error', a); };
console.debug = (...a) => { _origDebug(...a); appendLog('debug', a); };

// ---------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------
const root   = document.getElementById('player-root')!;
const banner = document.getElementById('update-banner')!;

/** Remove all content from the player root. */
function clearRoot() {
  root.innerHTML = '';
}

// ---------------------------------------------------------------------------
// Idle screen (identical to nexari-tizen showIdleScreen)
// ---------------------------------------------------------------------------
function showIdle(statusText = 'Waiting for content…') {
  clearRoot();
  root.style.background = '';
  const deviceName = localStorage.getItem('deviceName') || '';
  const resellerLogoUrl = localStorage.getItem('resellerBrandingLogoUrl');
  const brandHtml = resellerLogoUrl
    ? `<img class="idle-logo" src="${resellerLogoUrl}" alt="Logo" style="max-height:56px;max-width:240px;object-fit:contain;" onerror="this.style.display='none'">`
    : `<svg class="idle-logo" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <defs>
              <linearGradient id="nexariGrad" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stop-color="#3a7bff"/>
                <stop offset="100%" stop-color="#4ff2d1"/>
              </linearGradient>
            </defs>
            <rect x="4" y="4" width="56" height="56" rx="14" stroke="url(#nexariGrad)" stroke-width="2.5"/>
            <path d="M20 44 V20 L44 44 V20" stroke="url(#nexariGrad)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <div class="idle-wordmark">NEXARI</div>`;
  root.innerHTML = `
    <div class="idle-screen">
      <div class="idle-bg-grid"></div>
      <div class="idle-card">
        <div class="idle-brand">
          ${brandHtml}
        </div>
        ${deviceName ? `<div class="idle-device">${deviceName}</div>` : ''}
        <div class="idle-divider"></div>
        <div class="idle-status-row">
          <span class="idle-status-dot"></span>
          <span class="idle-status">${statusText}</span>
        </div>
      </div>
      <div class="idle-footer">Signage Player &middot; Standby</div>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Playlist state
// ---------------------------------------------------------------------------
let _playlist: Playlist | null     = null;
let _currentIdx                    = 0;
let _playTimer: ReturnType<typeof setTimeout> | null = null;
let _contentSignature              = '';
let _isPlaying                     = false;
let _loadInFlight                  = false;
let _activeItemId: string | null   = null;   // tracks which playlist item is currently rendered

// Cross-platform sync/videowall manifest received via WS
let _wallManifest: any = null;
let _syncGroupManifest: any = null;
let _syncActive = false;

// Content types whose DOM/iframe manages its own data refresh internally.
// When the playlist wraps back to the same item, we skip the teardown+rebuild.
const SELF_REFRESH_TYPES = new Set([
  'CALENDAR', 'HTML', 'HTML5', 'MENU_BOARD', 'CANVAS', 'DATASYNC', 'LIVE_STREAM', 'IPTV',
]);

function cancelPlayback() {
  if (_playTimer !== null) { clearTimeout(_playTimer); _playTimer = null; }
  _isPlaying  = false;
  _activeItemId = null;
}

async function stopSyncIfActive() {
  if (!_syncActive) return;
  _syncActive = false;
  try {
    const { stopSync } = await import('./sync-coordinator.js');
    stopSync();
  } catch { /* ignore */ }
}

function getSignature(pl: Playlist | null): string {
  if (!pl) return '';
  return JSON.stringify({ id: pl.id, items: pl.items.map((i) => i.id), syncGroupId: pl.syncGroupId ?? null });
}

// ---------------------------------------------------------------------------
// Content loading / schedule resolution
// ---------------------------------------------------------------------------
async function loadContent() {
  if (_loadInFlight) return;
  _loadInFlight = true;
  try {
    const content = await ApiClient.getCurrentContent();

    if (!content || content.items.length === 0) {
      await stopSyncIfActive();
      cancelPlayback();
      _playlist = null;
      _contentSignature = '';
      console.info('[Player] No content assigned — showing idle screen');
      showIdle();
      return;
    }

    const sig = getSignature(content);
    if (sig === _contentSignature && (_isPlaying || _syncActive)) {
      console.debug('[Player] Content unchanged, continuing playback');
      return;
    }

    console.info(`[Player] Playlist loaded: id=${content.id} items=${content.items.length}`);
    await stopSyncIfActive();
    cancelPlayback();
    _playlist  = content;
    _currentIdx = 0;
    _contentSignature = sig;

    // Cross-OS sync group: use the relay engine instead of solo playback.
    if (content.syncGroupId && content.allTizen === false) {
      void startSyncGroupPlayback(content);
      return;
    }

    playCurrentItem();
  } catch (err: any) {
    console.error('[Player] loadContent failed:', err?.message || err);
    if (!_isPlaying && !_syncActive) showIdle();
  } finally {
    _loadInFlight = false;
  }
}

async function startSyncGroupPlayback(content: Playlist) {
  try {
    const { startSync } = await import('./sync-coordinator.js');
    const cfg = await window.nexari.getConfig();
    const deviceId  = cfg.deviceId  || localStorage.getItem('deviceId')  || '';
    const token     = cfg.deviceToken || localStorage.getItem('deviceToken') || '';
    const apiBase   = cfg.apiBase   || localStorage.getItem('apiBase')   || 'https://ds.chiho.app/api/v1';

    const peers = (content.syncPlay?.peers ?? []) as Array<{ deviceId: string; leaderPriority?: number | null }>;
    const expectedPeers = Math.max(1, peers.length - 1);
    // peers is already sorted by leaderPriority asc from the API; peers[0] is the designated leader.
    const pinnedLeaderId = peers[0]?.deviceId ?? '';
    // In cross-OS groups (allTizen===false), the Tizen relay implementation is
    // follower-only: it can't send LOAD_URL or GO. The Windows player must be
    // the leader so it broadcasts LOAD_URL and sends GO. Force ourselves as
    // leader by pinning to our own deviceId whenever allTizen===false.
    const effectiveLeaderId = (content.allTizen === false) ? deviceId : pinnedLeaderId;
    // In dev mode force cloud relay so sync goes through the local API server
    // (192.168.1.17) rather than a direct LAN connection to the leader device,
    // which may not be in the CSP allowlist.
    const syncRelayMode = cfg.isDev ? 'cloud' : ((content as any).syncRelayMode ?? 'cloud');
    const relayUrl      = cfg.isDev ? null     : ((content as any).relayUrl ?? null);

    const urls = content.items
      .map(i => i.content?.url || i.content?.fileUrl || '')
      .filter(Boolean);

    if (!urls.length) { console.warn('[Sync] no video URLs'); playCurrentItem(); return; }

    console.info(`[Sync] starting relay sync groupId=${content.syncGroupId} peers=${expectedPeers} pinnedLeader=${effectiveLeaderId} (manifest=${pinnedLeaderId} allTizen=${content.allTizen})`);
    _syncActive = true;
    await startSync({
      apiBase,
      token,
      deviceId,
      groupId: content.syncGroupId!,
      expectedPeers,
      pinnedLeaderId: effectiveLeaderId,
      syncRelayMode,
      relayUrl,
      // selfLatency is auto-calibrated via measurePlayLatencyMs + PEERS broadcast
      container: root,
      playlist: urls,
      onStatus: (s) => console.info(`[Sync] ${s}`),
    });
  } catch (e: any) {
    console.error('[Sync] startSyncGroupPlayback failed:', e?.message || e);
    _syncActive = false;
    playCurrentItem();
  }
}

// Refresh schedule every 60 s
setInterval(loadContent, 60_000);

// ---------------------------------------------------------------------------
// Playlist advancement
// ---------------------------------------------------------------------------
function playCurrentItem() {
  if (!_playlist || _playlist.items.length === 0) { showIdle(); return; }
  if (_currentIdx >= _playlist.items.length) _currentIdx = 0;

  const item = _playlist.items[_currentIdx];
  if (!item?.content) { advancePlaylist(); return; }

  // For live content (calendar, HTML, streams) that manages its own internal
  // refresh loop, skip tearing down and rebuilding the DOM/iframe when the
  // single-item playlist wraps back to the same item. Just reschedule the
  // advance timer so multi-item playlists still cycle correctly.
  if (_activeItemId === item.id && _isPlaying && SELF_REFRESH_TYPES.has(item.content.type)) {
    scheduleAdvance(item.duration || 10);
    return;
  }

  _activeItemId = item.id;
  _isPlaying = true;
  console.info(`[Player] Playing item ${_currentIdx + 1}/${_playlist.items.length}: type=${item.content.type} duration=${item.duration}s id=${item.id}`);
  renderContent(item);
}

function advancePlaylist() {
  if (!_playlist) return;
  _currentIdx = (_currentIdx + 1) % _playlist.items.length;
  playCurrentItem();
}

function scheduleAdvance(durationSec: number) {
  if (_playTimer) clearTimeout(_playTimer);
  _playTimer = setTimeout(advancePlaylist, Math.max(3, durationSec) * 1000);
}

// ---------------------------------------------------------------------------
// Content router
// ---------------------------------------------------------------------------
function renderContent(item: PlaylistItem) {
  const c = item.content!;
  const durationSec = item.duration || 10;

  // For VIDEO→VIDEO transitions, don't clear root first — renderVideo will
  // append the new element on top and remove the old one only after first frame.
  // For all other types, clear root immediately.
  const isVideo = c.type === 'VIDEO' || c.type === 'OVERLAY' || c.type === 'PRESENTATION';
  const hasExistingVideo = isVideo && !!root.querySelector('video');
  if (!hasExistingVideo) clearRoot();

  switch (c.type) {
    case 'IMAGE':
      renderImage(c, durationSec);
      break;

    case 'VIDEO':
    case 'OVERLAY':
    case 'PRESENTATION':
      // If a VIDEOWALL_INIT has been received, this device is a wall tile — use wall renderer
      // even for VIDEO-typed content (videowall playlist slots are regular VIDEO items).
      if (_wallManifest) { renderVideowall(c, durationSec); break; }
      renderVideo(c, durationSec);
      break;

    case 'LIVE_STREAM':
    case 'IPTV':
      renderLiveStream(c, durationSec);
      break;

    case 'CHANNEL_GROUP':
      renderChannelGroup(c, durationSec);
      break;

    case 'HTML':
    case 'HTML5':
    case 'CANVAS':
      renderHTML(c, durationSec);
      break;

    case 'MENU_BOARD':
      renderMenuBoard(c, durationSec);
      break;

    case 'DATASYNC':
      renderDataSync(c, durationSec);
      break;

    case 'PDF':
    case 'OFFICE':
      renderPdf(c, durationSec);
      break;

    case 'VIDEOWALL':
      renderVideowall(c, durationSec);
      break;

    case 'ZONE_LAYOUT':
      renderZoneLayout(c, durationSec);
      break;

    case 'CALENDAR':
      renderCalendar(c, durationSec);
      break;

    default:
      console.warn('[Player] Unknown content type:', c.type);
      scheduleAdvance(durationSec);
  }
}

// ---------------------------------------------------------------------------
// Asset pre-download — IMAGE, VIDEO, PDF, OFFICE, VIDEOWALL are downloaded
// to disk before playback. LIVE_STREAM, IPTV, CHANNEL_GROUP, HTML and any
// IP-multicast / web URLs are always streamed live.
// ---------------------------------------------------------------------------
function isStreamingUrl(url: string): boolean {
  if (!url) return true;
  if (/^(udp|rtp|rtsp|rtmp|igmp|mms):\/\//i.test(url)) return true; // multicast / RTSP
  if (/\.m3u8(\?|$)/i.test(url)) return true;                        // HLS playlist
  return false;
}

async function downloadFirst(url: string): Promise<string> {
  if (!url || isStreamingUrl(url)) return url;
  try {
    const localPath = await window.nexari.downloadAsset(url);
    // Convert Windows path to a file:// URL the renderer can use
    return 'file:///' + localPath.replace(/\\/g, '/');
  } catch (e) {
    console.warn('[Player] Asset download failed, will stream:', url, e);
    return url; // fall back to network URL
  }
}

// ---------------------------------------------------------------------------
// IMAGE
// ---------------------------------------------------------------------------
async function renderImage(c: NormalizedContent, durationSec: number) {
  const url = await downloadFirst(c.url);
  const img = document.createElement('img');
  Object.assign(img.style, {
    width: '100%', height: '100%', objectFit: 'contain', background: '#000',
    display: 'block',
  });
  img.src = url;
  img.onerror = () => { img.remove(); scheduleAdvance(durationSec); };
  root.appendChild(img);
  scheduleAdvance(durationSec);
}

// ---------------------------------------------------------------------------
// VIDEO (HTML5 native — supports MP4, WebM, MKV)
// ---------------------------------------------------------------------------
async function renderVideo(c: NormalizedContent, durationSec: number) {
  const url = await downloadFirst(c.url);
  const prev = root.querySelector('video') as HTMLVideoElement | null;
  const vid = document.createElement('video');
  Object.assign(vid.style, {
    width: '100%', height: '100%', objectFit: 'contain', background: '#000', display: 'block',
    position: 'absolute', inset: '0',
  });
  vid.src    = url;
  vid.autoplay  = true;
  vid.loop      = false;
  vid.playsInline = true;
  vid.controls  = false;

  // Cancel the safety timer before advancing so it cannot fire a second time
  // and corrupt the playlist index.
  vid.onended = () => { cancelPlayback(); advancePlaylist(); };
  vid.onerror = () => {
    console.error('[Player] Video error:', c.url);
    cancelPlayback();
    advancePlaylist();
  };

  // Seamless swap: append new video on top, wait for first frame, then remove old.
  // This prevents the black flash that occurs during the async downloadFirst() gap.
  root.style.position = 'relative';
  root.appendChild(vid);

  const removeOld = () => {
    if (prev && prev.parentNode) {
      try { prev.pause(); } catch { /* ignore */ }
      prev.remove();
    }
  };

  vid.addEventListener('playing', removeOld, { once: true });
  vid.addEventListener('error', removeOld, { once: true });
  // Safety: remove old after 2 s regardless
  setTimeout(removeOld, 2000);

  // Videos play to their natural end (onended). The playlist-configured
  // `durationSec` is only a floor for the safety fallback — if the video's
  // intrinsic duration is longer, we extend the timer to match. This way a
  // 30-second clip set to "5s" in the playlist still plays in full.
  // Clear the initial 60 s fallback before setting the accurate one so we
  // never have two overlapping timers.
  vid.onloadedmetadata = () => {
    const intrinsic = isFinite(vid.duration) ? vid.duration : 0;
    const safety = Math.max(durationSec, Math.ceil(intrinsic) + 2);
    scheduleAdvance(safety);
  };
  // Initial fallback in case metadata never loads
  scheduleAdvance(Math.max(durationSec, 60));
  vid.play().catch(e => {
    // Autoplay blocked (unlikely in Electron but guard it): advance so we don't stall.
    console.warn('[Player] Video play() rejected:', e);
    cancelPlayback();
    advancePlaylist();
  });
}

// ---------------------------------------------------------------------------
// LIVE_STREAM / IPTV (HLS via hls.js, fallback to native <video> for MP4)
// ---------------------------------------------------------------------------
function renderLiveStream(c: NormalizedContent, durationSec: number) {
  const url = c.url || c.webUrl || '';
  const vid  = document.createElement('video');
  Object.assign(vid.style, {
    width: '100%', height: '100%', objectFit: 'contain', background: '#000', display: 'block',
  });
  vid.autoplay = true;
  vid.playsInline = true;
  vid.controls = false;

  const isHls = /\.m3u8(\?|$)/i.test(url) || url.includes('/playlist');
  if (isHls && Hls.isSupported()) {
    const hls = new Hls({ enableWorker: false });
    hls.loadSource(url);
    hls.attachMedia(vid);
    hls.on(Hls.Events.ERROR, (_ev, data) => {
      if (data.fatal) { hls.destroy(); scheduleAdvance(durationSec); }
    });
  } else {
    vid.src = url;
    vid.onerror = () => scheduleAdvance(durationSec);
  }

  root.appendChild(vid);
  vid.play().catch(() => {});
  scheduleAdvance(durationSec);
}

// ---------------------------------------------------------------------------
// CHANNEL_GROUP (multi-channel IPTV with digit-buffer channel switching)
// ---------------------------------------------------------------------------
interface Channel { number: number; name: string; url: string; }
let _chGroup: Channel[] = [];
let _chCurrent = 0;
let _chDigitBuf = '';
let _chDigitTimer: ReturnType<typeof setTimeout> | null = null;
let _chVideo: HTMLVideoElement | null = null;
let _chHls: Hls | null = null;

function renderChannelGroup(c: NormalizedContent, durationSec: number) {
  _chGroup   = (c.channels || []) as Channel[];
  _chCurrent = 0;
  if (_chGroup.length === 0) { scheduleAdvance(durationSec); return; }

  // Find default channel
  const defaultNum = c.defaultChannelNumber ?? _chGroup[0]?.number ?? 1;
  const defaultIdx = _chGroup.findIndex((ch) => ch.number === defaultNum);
  if (defaultIdx >= 0) _chCurrent = defaultIdx;

  const vid = document.createElement('video');
  Object.assign(vid.style, {
    width: '100%', height: '100%', objectFit: 'contain', background: '#000', display: 'block',
  });
  vid.autoplay = true;
  vid.playsInline = true;
  _chVideo = vid;

  root.appendChild(vid);
  tuneChannel(_chCurrent);
  scheduleAdvance(durationSec);

  // Channel banner overlay
  const banner = document.createElement('div');
  Object.assign(banner.style, {
    position: 'absolute', bottom: '60px', left: '40px',
    background: 'rgba(0,0,0,0.7)', color: '#fff', padding: '12px 24px',
    fontFamily: 'sans-serif', fontSize: '32px', borderRadius: '8px',
    display: 'none', zIndex: '10',
  });
  root.appendChild(banner);

  // Keyboard / IR channel input
  const onKey = (e: KeyboardEvent) => {
    if (e.key >= '0' && e.key <= '9') {
      _chDigitBuf += e.key;
      banner.textContent = 'CH ' + _chDigitBuf;
      banner.style.display = 'block';
      if (_chDigitTimer) clearTimeout(_chDigitTimer);
      _chDigitTimer = setTimeout(() => {
        const num = parseInt(_chDigitBuf, 10);
        const idx = _chGroup.findIndex((ch) => ch.number === num);
        if (idx >= 0) { _chCurrent = idx; tuneChannel(idx); }
        _chDigitBuf = '';
        banner.style.display = 'none';
      }, 1500);
    }
    if (e.key === 'ArrowUp') { _chCurrent = (_chCurrent + 1) % _chGroup.length; tuneChannel(_chCurrent); }
    if (e.key === 'ArrowDown') { _chCurrent = (_chCurrent - 1 + _chGroup.length) % _chGroup.length; tuneChannel(_chCurrent); }
  };
  document.addEventListener('keydown', onKey);
  // Detach listener on next advance
  const origAdvance = advancePlaylist;
  (_playTimer as any) && (() => { document.removeEventListener('keydown', onKey); })();
}

function tuneChannel(idx: number) {
  const ch = _chGroup[idx];
  if (!ch || !_chVideo) return;
  if (_chHls) { _chHls.destroy(); _chHls = null; }
  const url = ch.url || '';
  if (/\.m3u8(\?|$)/i.test(url) && Hls.isSupported()) {
    _chHls = new Hls({ enableWorker: false });
    _chHls.loadSource(url);
    _chHls.attachMedia(_chVideo);
  } else {
    _chVideo.src = url;
  }
  _chVideo.play().catch(() => {});
}

// ---------------------------------------------------------------------------
// HTML / HTML5 / MENU_BOARD / CANVAS → iframe
// ---------------------------------------------------------------------------
function renderHTML(c: NormalizedContent, durationSec: number) {
  const url = c.url || c.webUrl || '';
  if (!url) { scheduleAdvance(durationSec); return; }

  const iframe = document.createElement('iframe');
  Object.assign(iframe.style, {
    position: 'absolute', top: '0', left: '0', width: '100%', height: '100%',
    border: 'none', background: 'transparent',
  });
  iframe.allow = 'autoplay; fullscreen; clipboard-write; microphone; camera';
  iframe.setAttribute('scrolling', 'no');
  iframe.src = url;
  root.appendChild(iframe);
  scheduleAdvance(durationSec);
}

// ---------------------------------------------------------------------------
// MENU_BOARD — fetch live POS menu and render inline HTML
// ---------------------------------------------------------------------------
function _mbEscHtml(s: unknown): string {
  const d = document.createElement('div');
  d.textContent = String(s ?? '');
  return d.innerHTML;
}

function _mbSanitizeColor(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const v = value.trim();
  if (!v) return fallback;
  if (/^(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\)|hsla?\([^)]+\)|[a-zA-Z]+)$/.test(v)) return v;
  return fallback;
}

function _mbFormatPrice(cents: number, currency: string): string {
  const norm = (currency || 'USD').toUpperCase();
  const amount = cents / 100;
  const fd = ['JPY', 'KRW', 'VND'].includes(norm) ? 0 : 2;
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency', currency: norm,
      minimumFractionDigits: fd, maximumFractionDigits: fd,
    }).format(amount);
  } catch {
    return `${norm} ${amount.toFixed(fd)}`;
  }
}

function _mbBuildStateHtml(title: string, message: string): string {
  return `<div style="display:flex;align-items:center;justify-content:center;height:100%;padding:32px;background:linear-gradient(160deg,#1f1510 0%,#120d0a 100%);color:#f7f2eb;font-family:'Segoe UI',Arial,sans-serif;text-align:center;box-sizing:border-box;"><div style="max-width:720px;"><div style="font-size:30px;font-weight:700;">${_mbEscHtml(title)}</div><div style="margin-top:12px;font-size:16px;line-height:1.6;color:rgba(247,242,235,0.78);">${_mbEscHtml(message)}</div></div></div>`;
}

function _mbBuildHtml(c: NormalizedContent, menu: any, metadata: Record<string, unknown>): string {
  const layout      = metadata['layout'] === '1-col' || metadata['layout'] === 'featured' ? String(metadata['layout']) : '2-col';
  const showPrices  = metadata['showPrices'] !== false;
  const showImages  = metadata['showImages'] !== false;
  const showDesc    = metadata['showDescription'] === true;
  const fontScaleRaw = Number(metadata['fontScale']);
  const fontScale   = isFinite(fontScaleRaw) ? Math.min(Math.max(fontScaleRaw, 0.8), 1.4) : 1;
  const accentColor = _mbSanitizeColor(metadata['accentColor'], '#dd6b20');
  const currency    = typeof menu.currency === 'string' ? menu.currency : 'USD';

  const ids = Array.isArray(metadata['categoryIds'])
    ? (metadata['categoryIds'] as string[]).filter((v) => typeof v === 'string')
    : [];
  const cats: any[] = Array.isArray(menu.categories) ? menu.categories : [];
  const filtered = ids.length > 0 ? cats.filter((cat) => ids.includes(cat.id)) : cats;
  const sections = filtered
    .map((cat) => ({ ...cat, items: Array.isArray(cat.items) ? cat.items.filter(Boolean) : [] }))
    .filter((cat) => cat.items.length > 0);

  if (!sections.length) {
    return _mbBuildStateHtml(c.name || 'Menu Board', 'No active POS menu items available for this board right now.');
  }

  let featuredItem: any = null;
  if (layout === 'featured') {
    for (const cat of sections) {
      featuredItem = (showImages && cat.items.find((i: any) => !!i.imageUrl)) || cat.items[0] || null;
      if (featuredItem) break;
    }
  }

  const boardTitle = c.name || menu.name || 'Menu Board';
  const subtitleParts: string[] = [];
  if (menu.name && menu.name !== boardTitle) subtitleParts.push(menu.name);
  if (menu.description) subtitleParts.push(menu.description);
  subtitleParts.push(`${sections.length} ${sections.length === 1 ? 'category' : 'categories'}`);
  const subtitle = subtitleParts.join(' | ');
  const sectionCols = layout === '1-col' ? 1 : Math.min(2, sections.length || 1);

  const featuredMarkup = layout === 'featured' && featuredItem ? `
    <aside class="menu-board-feature">
      ${showImages && featuredItem.imageUrl ? `<div class="menu-board-feature-image"><img src="${_mbEscHtml(featuredItem.imageUrl)}" alt="${_mbEscHtml(featuredItem.name)}" /></div>` : ''}
      <div class="menu-board-feature-copy">
        <div class="menu-board-feature-kicker">Featured Item</div>
        <div class="menu-board-feature-title">${_mbEscHtml(featuredItem.name)}</div>
        ${showPrices ? `<div class="menu-board-feature-price">${_mbEscHtml(_mbFormatPrice(featuredItem.priceCents, currency))}</div>` : ''}
        ${showDesc && featuredItem.description ? `<div class="menu-board-feature-description">${_mbEscHtml(featuredItem.description)}</div>` : ''}
      </div>
    </aside>` : '';

  const sectionsMarkup = sections.map((cat) => {
    const catAccent = _mbSanitizeColor(cat.color, accentColor);
    const items = cat.items.map((item: any) => {
      const img   = showImages && item.imageUrl ? `<div class="menu-board-item-image"><img src="${_mbEscHtml(item.imageUrl)}" alt="${_mbEscHtml(item.name)}" /></div>` : '';
      const price = showPrices ? `<div class="menu-board-item-price">${_mbEscHtml(_mbFormatPrice(item.priceCents, currency))}</div>` : '';
      const desc  = showDesc && item.description ? `<div class="menu-board-item-description">${_mbEscHtml(item.description)}</div>` : '';
      return `<article class="menu-board-item ${img ? 'has-image' : 'no-image'}">${img}<div class="menu-board-item-copy"><div class="menu-board-item-head"><div class="menu-board-item-name">${_mbEscHtml(item.name)}</div>${price}</div>${desc}</div></article>`;
    }).join('');
    return `<section class="menu-board-category" style="--menu-board-category-accent:${catAccent};">
      <div class="menu-board-category-head">
        <div>
          <div class="menu-board-category-title">${_mbEscHtml(cat.name)}</div>
          ${cat.description ? `<div class="menu-board-category-description">${_mbEscHtml(cat.description)}</div>` : ''}
        </div>
        <div class="menu-board-category-count">${cat.items.length}</div>
      </div>
      <div class="menu-board-item-list">${items}</div>
    </section>`;
  }).join('');

  return `<div class="menu-board-root">
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
          <h1 class="menu-board-title">${_mbEscHtml(boardTitle)}</h1>
          <div class="menu-board-subtitle">${_mbEscHtml(subtitle)}</div>
        </div>
      </header>
      <div class="menu-board-grid ${layout === 'featured' ? 'is-featured' : ''}">
        ${featuredMarkup}
        <div class="menu-board-sections">${sectionsMarkup}</div>
      </div>
    </div>
  </div>`;
}

async function renderMenuBoard(c: NormalizedContent, durationSec: number): Promise<void> {
  let meta: Record<string, unknown>;
  try { meta = JSON.parse(c.metadata || '{}'); } catch { meta = {}; }

  const posWorkspaceId = typeof meta['posWorkspaceId'] === 'string' && meta['posWorkspaceId']
    ? meta['posWorkspaceId'] as string
    : null;

  if (!posWorkspaceId) {
    root.innerHTML = _mbBuildStateHtml(c.name || 'Menu Board', 'This menu board is missing its POS workspace source.');
    scheduleAdvance(durationSec);
    return;
  }

  const apiBase = localStorage.getItem('apiBase') || 'https://ds.chiho.app/api/v1';
  const reqId   = `mb-${Date.now()}`;
  root.dataset['mbReqId'] = reqId;
  root.innerHTML = _mbBuildStateHtml(c.name || 'Menu Board', 'Loading the latest POS menu\u2026');

  try {
    const resp = await fetch(`${apiBase}/pos/menu?workspaceId=${encodeURIComponent(posWorkspaceId)}`);
    if (root.dataset['mbReqId'] !== reqId) return;
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const menu = await resp.json();
    if (root.dataset['mbReqId'] !== reqId) return;
    root.innerHTML = _mbBuildHtml(c, menu, meta);
  } catch (err) {
    if (root.dataset['mbReqId'] !== reqId) return;
    console.error('[Player] Menu board fetch failed:', err);
    root.innerHTML = _mbBuildStateHtml(
      c.name || 'Menu Board',
      'The live POS menu could not be loaded. Check the API connection or publish an active menu.',
    );
  }
  scheduleAdvance(durationSec);
}

// ---------------------------------------------------------------------------
// DATASYNC (live transport / data table) → iframe to CMS renderer URL
// ---------------------------------------------------------------------------
function renderDataSync(c: NormalizedContent, durationSec: number) {
  const token   = localStorage.getItem('deviceToken') || '';
  const apiBase = (localStorage.getItem('apiBase') || 'https://ds.chiho.app/api/v1').replace(/\/api\/v1\/?$/, '');
  const url = `${apiBase}/api/v1/devices/device/content/${encodeURIComponent(c.id)}/datasync/${encodeURIComponent(token)}`;
  renderHTML({ ...c, url, webUrl: null }, durationSec);
}

// ---------------------------------------------------------------------------
// PDF / OFFICE (PDF.js page-by-page, durationSec = seconds PER PAGE)
// ---------------------------------------------------------------------------
async function renderPdf(c: NormalizedContent, durationSec: number) {
  const url = await downloadFirst(c.url);
  const canvas = document.createElement('canvas');
  Object.assign(canvas.style, { display: 'block', background: '#000' });
  root.appendChild(canvas);

  let pdf: any;
  try {
    pdf = await PdfjsLib.getDocument({ url, withCredentials: false }).promise;
  } catch (err) {
    console.error('[Player] PDF load failed:', err);
    scheduleAdvance(durationSec);
    return;
  }

  const numPages = pdf.numPages;
  // durationSec is the per-page interval (mirrors Tizen b2bDocAutoFlipIntervalMs).
  // Minimum 3 s per page so we never flash past a page too fast.
  const msPerPage = Math.max(3_000, durationSec * 1_000);
  let pageNum = 1;
  let stopped = false;

  console.info(`[Player] PDF: ${numPages} page(s), ${msPerPage / 1000}s per page`);

  const renderPage = async (n: number) => {
    if (stopped) return;
    try {
      const page  = await pdf.getPage(n);
      const vp    = page.getViewport({ scale: 1 });
      const scale = Math.min(root.clientWidth / vp.width, root.clientHeight / vp.height);
      const viewport = page.getViewport({ scale });
      canvas.width  = viewport.width;
      canvas.height = viewport.height;
      canvas.style.width  = viewport.width + 'px';
      canvas.style.height = viewport.height + 'px';
      canvas.style.margin = 'auto';
      const ctx = canvas.getContext('2d')!;
      await page.render({ canvasContext: ctx, viewport }).promise;
    } catch (e) { console.error('[Player] PDF page render error:', e); }
  };

  await renderPage(pageNum);

  _playTimer = setTimeout(async function flip() {
    if (stopped) return;
    pageNum++;
    if (pageNum > numPages) {
      stopped = true;
      advancePlaylist();
      return;
    }
    console.debug(`[Player] PDF page ${pageNum}/${numPages}`);
    await renderPage(pageNum);
    _playTimer = setTimeout(flip, msPerPage);
  }, msPerPage);
}

// ---------------------------------------------------------------------------
// VIDEOWALL — HTML5 video with CSS clip/transform for this panel's region
// ---------------------------------------------------------------------------
async function renderVideowall(c: NormalizedContent, durationSec: number) {
  const url = await downloadFirst(c.url);

  const vid = document.createElement('video');
  vid.playsInline = true;
  vid.autoplay = false;
  vid.muted = false;
  vid.loop = true;
  vid.controls = false;

  const pw = root.clientWidth;
  const ph = root.clientHeight;

  // Compute CSS wall transform via shared math.
  let cssTransform: { canvasW: number; canvasH: number; translateX: number; translateY: number; scaleX: number; scaleY: number; rotation: number };
  const manifest = _wallManifest;
  if (manifest?.geometry && manifest?.myCell) {
    const geo = manifest.geometry;
    const mc  = manifest.myCell;
    const bezelOffsets = geo.bezelOffsets ?? null;
    const member: WallMember = {
      deviceId:       String(mc.deviceId      ?? ''),
      positionCol:    Number(mc.positionCol   ?? 0),
      positionRow:    Number(mc.positionRow   ?? 0),
      colSpan:        Number(mc.colSpan        ?? 1),
      rowSpan:        Number(mc.rowSpan        ?? 1),
      tileRotation:   String(mc.tileRotation  ?? '0'),
      nativeWidthPx:  Number(mc.nativeWidthPx  ?? pw),
      nativeHeightPx: Number(mc.nativeHeightPx ?? ph),
    };
    cssTransform = computeTileCssTransform(member, geo.colWidths ?? [], geo.rowHeights ?? [], bezelOffsets);
  } else {
    // Legacy flat metadata path.
    let meta: any = {};
    try { meta = JSON.parse(c.metadata || '{}'); } catch { /* ignore */ }
    const { offsetX = 0, offsetY = 0, cropW = 1, cropH = 1 } = meta;
    const sX = 1 / cropW; const sY = 1 / cropH;
    cssTransform = { canvasW: pw, canvasH: ph, translateX: -offsetX * pw, translateY: -offsetY * ph, scaleX: sX, scaleY: sY, rotation: 0 };
  }

  const { canvasW, canvasH, translateX: tx, translateY: ty, scaleX, scaleY, rotation } = cssTransform;

  // Outer clip window (panel logical size = screen size here).
  const outer = document.createElement('div');
  outer.style.cssText = `position:absolute;top:0;left:0;width:${pw}px;height:${ph}px;overflow:hidden;background:#000;`;
  // Inner rotation + bezel scale.
  const inner = document.createElement('div');
  inner.style.cssText = `position:absolute;top:0;left:0;width:100%;height:100%;` +
    `transform:rotate(${rotation}deg) scale(${scaleX},${scaleY});transform-origin:center;`;
  outer.appendChild(inner);

  // Video element — full canvas, translated to expose this cell.
  vid.style.cssText = `position:absolute;top:0;left:0;width:${canvasW}px;height:${canvasH}px;` +
    `transform:translate(${tx}px,${ty}px);transform-origin:0 0;object-fit:fill;background:#000;`;

  vid.src      = url;
  vid.autoplay = true;
  vid.loop     = true;
  vid.playsInline = true;
  vid.controls = false;
  vid.onended  = advancePlaylist;
  vid.onerror  = () => scheduleAdvance(durationSec);

  inner.appendChild(vid);
  root.appendChild(outer);
  vid.play().catch(() => {});
  scheduleAdvance(durationSec);
}

// ---------------------------------------------------------------------------
// ZONE_LAYOUT — sub-player instances per zone
// ---------------------------------------------------------------------------
const ZONE_CANVAS_W = 1920;
const ZONE_CANVAS_H = 1080;

interface ZoneDef {
  id: string;
  rect: { x: number; y: number; width: number; height: number };
  source?: {
    type: 'content' | 'playlist' | 'empty';
    contentId?: string;
    contentType?: string;
    contentName?: string;
    playlistId?: string;
    playlistName?: string;
    sourceDuration?: number | null;
  } | null;
}

function _renderZoneContentEl(container: HTMLElement, contentId: string, contentType: string, apiBase: string, token: string) {
  const fileUrl = `${apiBase}/devices/device/content/${contentId}/file?token=${encodeURIComponent(token)}`;
  const type = contentType.toUpperCase();
  if (type === 'IMAGE') {
    const img = document.createElement('img');
    Object.assign(img.style, { width:'100%', height:'100%', objectFit:'contain', background:'#000', display:'block' });
    container.appendChild(img);
    void downloadFirst(fileUrl).then((u) => { if (img.isConnected) img.src = u; });
  } else if (type === 'VIDEO') {
    const vid = document.createElement('video');
    vid.autoplay = true; vid.loop = true; vid.muted = true; vid.playsInline = true;
    Object.assign(vid.style, { width:'100%', height:'100%', objectFit:'contain', background:'#000', display:'block' });
    container.appendChild(vid);
    void downloadFirst(fileUrl).then((u) => {
      if (!vid.isConnected) return;
      vid.src = u;
      vid.play().catch(() => {});
    });
  } else if (type === 'HTML5') {
    const iframe = document.createElement('iframe');
    iframe.src = `${apiBase}/devices/device/content/${contentId}/html5/${encodeURIComponent(token)}/index.html`;
    Object.assign(iframe.style, { width:'100%', height:'100%', border:'none' });
    container.appendChild(iframe);
  } else {
    // HTML / web URL / fallback
    const iframe = document.createElement('iframe');
    iframe.src = fileUrl;
    Object.assign(iframe.style, { width:'100%', height:'100%', border:'none' });
    container.appendChild(iframe);
  }
}

async function _renderZonePlaylist(container: HTMLElement, playlistId: string, apiBase: string, token: string) {
  try {
    const res = await fetch(`${apiBase}/devices/device/playlist/${playlistId}?token=${encodeURIComponent(token)}`);
    if (!res.ok) return;
    const playlist = await res.json();
    const items: any[] = (playlist.items || []).filter((i: any) => i.content);
    if (items.length === 0) return;

    let idx = 0;
    function playItem() {
      if (!container.isConnected) return; // detached when parent zone layout was replaced
      const item = items[idx];
      const content = item.content;
      const type = (content.type || '').toUpperCase();
      const fileUrl = `${apiBase}/devices/device/content/${content.id}/file?token=${encodeURIComponent(token)}`;
      const duration = Math.max(3, item.duration || 10) * 1000;
      container.innerHTML = '';
      if (type === 'IMAGE') {
        const img = document.createElement('img');
        Object.assign(img.style, { width:'100%', height:'100%', objectFit:'contain', background:'#000', display:'block' });
        container.appendChild(img);
        void downloadFirst(fileUrl).then((u) => { if (img.isConnected) img.src = u; });
      } else if (type === 'VIDEO') {
        const vid = document.createElement('video');
        vid.autoplay = true; vid.loop = false; vid.muted = true; vid.playsInline = true;
        Object.assign(vid.style, { width:'100%', height:'100%', objectFit:'contain', background:'#000', display:'block' });
        container.appendChild(vid);
        // Advance when the clip ends naturally; setTimeout is only a safety net
        // sized to the larger of the configured duration and the intrinsic length.
        let _zoneTimer: ReturnType<typeof setTimeout> | null = null;
        const advance = () => {
          if (_zoneTimer) { clearTimeout(_zoneTimer); _zoneTimer = null; }
          idx = (idx + 1) % items.length;
          playItem();
        };
        vid.onended = advance;
        vid.onloadedmetadata = () => {
          const intrinsic = isFinite(vid.duration) ? vid.duration : 0;
          const safety = Math.max(duration, (Math.ceil(intrinsic) + 2) * 1000);
          if (_zoneTimer) clearTimeout(_zoneTimer);
          _zoneTimer = setTimeout(advance, safety);
        };
        _zoneTimer = setTimeout(advance, Math.max(duration, 60_000));
        void downloadFirst(fileUrl).then((u) => {
          if (!vid.isConnected) return;
          vid.src = u;
          vid.play().catch(() => {});
        });
        return; // skip the unconditional setTimeout below for this iteration
      } else if (type === 'HTML5') {
        const iframe = document.createElement('iframe');
        iframe.src = `${apiBase}/devices/device/content/${content.id}/html5/${encodeURIComponent(token)}/index.html`;
        Object.assign(iframe.style, { width:'100%', height:'100%', border:'none' });
        container.appendChild(iframe);
      } else {
        const iframe = document.createElement('iframe');
        iframe.src = fileUrl;
        Object.assign(iframe.style, { width:'100%', height:'100%', border:'none' });
        container.appendChild(iframe);
      }
      idx = (idx + 1) % items.length;
      setTimeout(playItem, duration);
    }
    playItem();
  } catch (e) {
    console.warn('[Player] Zone playlist load failed:', e);
  }
}

function renderZoneLayout(c: NormalizedContent, durationSec: number) {
  let zones: ZoneDef[] = [];
  try { zones = JSON.parse(c.metadata || '{}').zones ?? []; } catch { /* ignore */ }

  if (zones.length === 0) { showIdle(); scheduleAdvance(durationSec); return; }

  root.style.background = '#000';

  const token   = localStorage.getItem('deviceToken') || '';
  const apiBase = localStorage.getItem('apiBase') || 'https://ds.chiho.app/api/v1';

  for (const zone of zones) {
    const rect = zone.rect ?? { x: 0, y: 0, width: ZONE_CANVAS_W, height: ZONE_CANVAS_H };
    const div = document.createElement('div');
    Object.assign(div.style, {
      position: 'absolute',
      left:     `${(rect.x / ZONE_CANVAS_W) * 100}%`,
      top:      `${(rect.y / ZONE_CANVAS_H) * 100}%`,
      width:    `${(rect.width  / ZONE_CANVAS_W) * 100}%`,
      height:   `${(rect.height / ZONE_CANVAS_H) * 100}%`,
      overflow: 'hidden',
      background: '#000',
    });
    root.appendChild(div);

    const src = zone.source;
    if (!src || src.type === 'empty') continue;

    if (src.type === 'content' && src.contentId) {
      _renderZoneContentEl(div, src.contentId, src.contentType ?? '', apiBase, token);
    } else if (src.type === 'playlist' && src.playlistId) {
      _renderZonePlaylist(div, src.playlistId, apiBase, token);
    }
  }

  scheduleAdvance(durationSec);
}

// ---------------------------------------------------------------------------
// CALENDAR — full Tizen-identical renderer (day / week / workweek / month / meeting_room)
// Runs as a blob-URL iframe so it can do its own fetch + clock loops.
// ---------------------------------------------------------------------------
function renderCalendar(c: NormalizedContent, durationSec: number) {
  const token      = localStorage.getItem('deviceToken') || '';
  const apiBase    = localStorage.getItem('apiBase') || 'https://ds.chiho.app/api/v1';
  const eventsUrl  = `${apiBase}/devices/device/content/${encodeURIComponent(c.id)}/calendar/events`;
  const contentName = (c as any).name || 'Calendar';

  let meta: any = {};
  try { meta = JSON.parse((c as any).metadata || '{}'); } catch { /* ignore */ }
  const view           = (meta.view as string) || 'week';
  const timezone       = (meta.timezone as string) || 'UTC';
  const refreshSeconds = Math.max(15, Number(meta.refreshSeconds) || 60);
  const theme: any     = meta.theme || {};
  const isDark         = theme.background === 'dark';
  const accent         = (theme.accentColor as string) || '#1a73e8';
  const clockStyle     = (theme.clockStyle as string) || 'digital-12';
  const showLocation   = theme.showLocation !== false;
  const showAttendeeCount = !!theme.showAttendeeCount;
  const roomMeta: any  = meta.roomMeta || null;

  const bg        = isDark ? '#1e1e2e' : '#ffffff';
  const surface   = isDark ? '#2a2a3e' : '#f8f9fa';
  const border    = isDark ? '#3a3a50' : '#e0e0e0';
  const text      = isDark ? '#e2e8f0' : '#202124';
  const textMuted = isDark ? '#94a3b8' : '#70757a';

  // Serialize values needed inside the blob
  const CFG = JSON.stringify({
    EVENTS_URL: eventsUrl, TOKEN: token, TZ: timezone,
    REFRESH_MS: refreshSeconds * 1000, VIEW: view,
    ACCENT: accent, BG: bg, SURFACE: surface, BORDER: border,
    TEXT: text, MUTED: textMuted, IS_DARK: isDark,
    CLOCK_STYLE: clockStyle, SHOW_LOC: showLocation, SHOW_ATT: showAttendeeCount,
    CONTENT_NAME: contentName, ROOM_META: roomMeta,
  });

  // The entire Tizen renderCalendar ported to a self-contained blob document.
  // Variables are injected via the CFG JSON constant above.
  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:100%;height:100%;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}
</style></head>
<body>
<div id="root" style="position:absolute;inset:0;"></div>
<script>
(function(){
const C=${CFG};
const EVENTS_URL=C.EVENTS_URL,TOKEN=C.TOKEN,TZ=C.TZ,REFRESH_MS=C.REFRESH_MS,VIEW=C.VIEW;
const accent=C.ACCENT,bg=C.BG,surface=C.SURFACE,border=C.BORDER,text=C.TEXT,textMuted=C.MUTED;
const isDark=C.IS_DARK,clockStyle=C.CLOCK_STYLE,showLoc=C.SHOW_LOC,showAtt=C.SHOW_ATT;
const contentName=C.CONTENT_NAME,roomMeta=C.ROOM_META;
const HOUR_PX=64;
const PALETTE=['#1a73e8','#0f9d58','#e67c00','#8430ce','#d50000','#0097a7','#616161','#e91e63'];

function pad2(n){return n<10?'0'+n:String(n);}
function getNow(){return new Date(new Date().toLocaleString('en-US',{timeZone:TZ}));}
function isoDate(d){return d.getFullYear()+'-'+pad2(d.getMonth()+1)+'-'+pad2(d.getDate());}
function toLocal(iso){return new Date(new Date(iso).toLocaleString('en-US',{timeZone:TZ}));}
function escHtml(s){const d=document.createElement('div');d.textContent=String(s??'');return d.innerHTML;}
function evColor(i){return PALETTE[i%PALETTE.length];}

function fmtTimeFull(d){
  let h=d.getHours(),m=d.getMinutes(),ap=h>=12?'PM':'AM';
  h=h%12||12;
  return h+':'+pad2(m)+' '+ap;
}
function fmtClock(d){
  if(clockStyle==='digital-24') return pad2(d.getHours())+':'+pad2(d.getMinutes());
  let h=d.getHours(),m=d.getMinutes(),ap=h>=12?'PM':'AM';
  h=h%12||12;
  return h+':'+pad2(m)+' '+ap;
}

// ── Header ──────────────────────────────────────────────────────────────────
function buildHeader(dateLabel){
  const now=getNow();
  const dateStr=now.toLocaleDateString('en-US',{weekday:'long',year:'numeric',month:'long',day:'numeric'});
  return \`<header style="flex-shrink:0;display:flex;align-items:center;padding:16px 24px;
    background:\${bg};border-bottom:1px solid \${border};gap:16px;">
    <div style="width:4px;min-height:40px;background:\${accent};border-radius:2px;flex-shrink:0;"></div>
    <div style="flex:1;min-width:0;">
      <div style="font-size:13px;color:\${textMuted};font-weight:500;text-transform:uppercase;letter-spacing:0.5px;">
        \${escHtml(contentName)}</div>
      <div style="font-size:20px;font-weight:600;color:\${text};margin-top:2px;">\${escHtml(dateLabel)}</div>
    </div>
    <div style="text-align:right;flex-shrink:0;">
      <div id="cal-clock" style="font-size:28px;font-weight:700;color:\${accent};letter-spacing:-0.5px;">
        \${clockStyle==='none'?'':escHtml(fmtClock(now))}</div>
      <div style="font-size:13px;color:\${textMuted};margin-top:2px;">\${escHtml(dateStr)}</div>
    </div>
  </header>\`;
}

// ── Clock tick ───────────────────────────────────────────────────────────────
setInterval(function(){
  const el=document.getElementById('cal-clock');
  if(el&&clockStyle!=='none') el.textContent=fmtClock(getNow());
  const now=getNow();
  const minOfDay=now.getHours()*60+now.getMinutes();
  const pct=(minOfDay/(24*60))*100;
  const line=document.getElementById('cal-now-line');
  if(line) line.style.top=pct+'%';
  const dot=document.getElementById('cal-now-dot');
  if(dot) dot.style.top='calc('+pct+'% - 5px)';
},30000);

// ── Time-grid helpers ────────────────────────────────────────────────────────
function buildTimeGutter(){
  let rows='';
  for(let h=0;h<24;h++){
    const label=h===0?'':(h<12?h+' AM':h===12?'12 PM':(h-12)+' PM');
    rows+=\`<div style="height:\${HOUR_PX}px;box-sizing:border-box;padding-right:8px;text-align:right;
      font-size:11px;color:\${textMuted};position:relative;top:-7px;">\${label}</div>\`;
  }
  return \`<div style="width:52px;flex-shrink:0;border-right:1px solid \${border};overflow:hidden;">\${rows}</div>\`;
}
function buildHourLines(){
  let lines='';
  for(let h=0;h<24;h++)
    lines+=\`<div style="position:absolute;left:0;right:0;top:\${h*HOUR_PX}px;
      border-top:1px solid \${border};pointer-events:none;"></div>\`;
  return lines;
}
function buildNowIndicator(now){
  const pct=((now.getHours()*60+now.getMinutes())/(24*60))*100;
  return \`<div id="cal-now-dot" style="position:absolute;left:-5px;width:10px;height:10px;
    border-radius:50%;background:\${accent};z-index:10;top:calc(\${pct}% - 5px);"></div>
  <div id="cal-now-line" style="position:absolute;left:0;right:0;top:\${pct}%;
    border-top:2px solid \${accent};z-index:9;"></div>\`;
}
function buildDayEvents(dayEvs){
  return dayEvs.map(function(ev,i){
    if(ev.allDay) return '';
    const s=toLocal(ev.start),e2=toLocal(ev.end);
    const startMin=s.getHours()*60+s.getMinutes();
    const endMin=Math.min(e2.getHours()*60+e2.getMinutes(),24*60);
    const durMin=Math.max(endMin-startMin,30);
    const top=(startMin/60)*HOUR_PX;
    const height=Math.max((durMin/60)*HOUR_PX,22);
    const color=evColor(i);
    const showL=height>44&&ev.location;
    return \`<div style="position:absolute;left:2px;right:4px;top:\${top}px;height:\${height}px;
      background:\${color};border-radius:4px;padding:3px 6px;box-sizing:border-box;overflow:hidden;z-index:5;">
      <div style="font-size:12px;font-weight:600;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
        \${escHtml(ev.title||'(no title)')}</div>
      <div style="font-size:11px;color:rgba(255,255,255,0.85);white-space:nowrap;overflow:hidden;">
        \${escHtml(fmtTimeFull(s))} – \${escHtml(fmtTimeFull(e2))}</div>
      \${showL?\`<div style="font-size:10px;color:rgba(255,255,255,0.75);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">\${escHtml(ev.location)}</div>\`:''}
    </div>\`;
  }).join('');
}
function buildAllDayStrip(allDayEvs,cols){
  if(!allDayEvs.length) return '';
  const colW=100/cols.length;
  const chips=allDayEvs.map(function(ev,i){
    const s=toLocal(ev.start);
    const colIdx=cols.findIndex(function(d){return isoDate(d)===isoDate(s);});
    if(colIdx<0) return '';
    return \`<div style="position:absolute;left:calc(\${colIdx*colW}% + 2px);width:calc(\${colW}% - 4px);
      top:\${i*22}px;height:20px;background:\${evColor(i)};border-radius:3px;
      padding:2px 6px;font-size:11px;color:#fff;font-weight:600;
      white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">\${escHtml(ev.title||'(all day)')}</div>\`;
  }).join('');
  const height=allDayEvs.length*22+4;
  return \`<div style="display:flex;flex-shrink:0;border-bottom:1px solid \${border};">
    <div style="width:52px;flex-shrink:0;font-size:11px;color:\${textMuted};padding:4px 8px 4px 0;
      text-align:right;border-right:1px solid \${border};">all-day</div>
    <div style="flex:1;position:relative;height:\${height}px;">\${chips}</div>
  </div>\`;
}

// ── DAY VIEW ─────────────────────────────────────────────────────────────────
function renderDayView(events){
  const now=getNow();
  const dateLabel=now.toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'});
  const today=isoDate(now);
  const allDayEvs=events.filter(function(e){return e.allDay&&isoDate(toLocal(e.start))===today;});
  const timedEvs=events.filter(function(e){return !e.allDay&&isoDate(toLocal(e.start))===today;});
  const scrollTop=Math.max(0,(now.getHours()-1)*HOUR_PX);
  document.getElementById('root').innerHTML=\`
    <div style="position:absolute;inset:0;display:flex;flex-direction:column;background:\${bg};color:\${text};overflow:hidden;">
      \${buildHeader(dateLabel)}
      \${buildAllDayStrip(allDayEvs,[now])}
      <div style="flex:1;display:flex;overflow:hidden;">
        \${buildTimeGutter()}
        <div id="cal-scroll" style="flex:1;overflow-y:auto;position:relative;">
          <div style="position:relative;height:\${24*HOUR_PX}px;">
            \${buildHourLines()}\${buildNowIndicator(now)}\${buildDayEvents(timedEvs)}
          </div>
        </div>
      </div>
    </div>\`;
  const sc=document.getElementById('cal-scroll');
  if(sc) sc.scrollTop=scrollTop;
}

// ── WEEK VIEW ────────────────────────────────────────────────────────────────
function renderWeekView(events,numDays){
  const now=getNow();
  const dow=now.getDay();
  const offset=numDays===5?(dow===0?-6:1-dow):-dow;
  const start=new Date(now);
  start.setDate(now.getDate()+offset);
  start.setHours(0,0,0,0);
  const days=Array.from({length:numDays},function(_,i){
    const d=new Date(start);d.setDate(d.getDate()+i);return d;
  });
  const rangeLabel=days[0].toLocaleDateString('en-US',{month:'short',day:'numeric'})
    +' – '+days[numDays-1].toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
  const colW=100/numDays;
  const allDayEvs=events.filter(function(e){return e.allDay;});
  const timedEvs=events.filter(function(e){return !e.allDay;});
  const nowIso=isoDate(now);
  const dayHeaders=days.map(function(d){
    const isToday=isoDate(d)===nowIso;
    return \`<div style="flex:1;text-align:center;padding:6px 4px;border-right:1px solid \${border};">
      <div style="font-size:11px;font-weight:500;color:\${textMuted};text-transform:uppercase;">
        \${d.toLocaleDateString('en-US',{weekday:'short'})}</div>
      <div style="width:30px;height:30px;margin:4px auto 0;border-radius:50%;display:flex;align-items:center;justify-content:center;
        background:\${isToday?accent:'transparent'};color:\${isToday?'#fff':text};
        font-size:16px;font-weight:\${isToday?700:400};">\${d.getDate()}</div>
    </div>\`;
  }).join('');
  const dayEventCols=days.map(function(d,di){
    const key=isoDate(d);
    const evs=timedEvs.filter(function(e){return isoDate(toLocal(e.start))===key;});
    const evHtml=evs.map(function(ev,i){
      if(ev.allDay) return '';
      const s=toLocal(ev.start),e2=toLocal(ev.end);
      const startMin=s.getHours()*60+s.getMinutes();
      const endMin=Math.min(e2.getHours()*60+e2.getMinutes(),24*60);
      const durMin=Math.max(endMin-startMin,30);
      const top=(startMin/60)*HOUR_PX,height=Math.max((durMin/60)*HOUR_PX,22);
      const color=evColor(i);
      return \`<div style="position:absolute;left:2px;right:4px;top:\${top}px;height:\${height}px;
        background:\${color};border-radius:4px;padding:3px 6px;box-sizing:border-box;overflow:hidden;z-index:5;">
        <div style="font-size:11px;font-weight:600;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
          \${escHtml(ev.title||'(no title)')}</div>
        <div style="font-size:10px;color:rgba(255,255,255,0.85);">\${escHtml(fmtTimeFull(s))}</div>
      </div>\`;
    }).join('');
    return \`<div style="position:absolute;left:\${di*colW}%;width:\${colW}%;top:0;bottom:0;">\${evHtml}</div>\`;
  }).join('');
  const vSep=days.slice(1).map(function(_,i){
    return \`<div style="position:absolute;left:\${(i+1)*colW}%;top:0;bottom:0;border-left:1px solid \${border};pointer-events:none;"></div>\`;
  }).join('');
  const hasToday=days.some(function(d){return isoDate(d)===nowIso;});
  const scrollTop=Math.max(0,(now.getHours()-1)*HOUR_PX);
  document.getElementById('root').innerHTML=\`
    <div style="position:absolute;inset:0;display:flex;flex-direction:column;background:\${bg};color:\${text};overflow:hidden;">
      \${buildHeader(rangeLabel)}
      <div style="display:flex;border-bottom:1px solid \${border};flex-shrink:0;">
        <div style="width:52px;flex-shrink:0;border-right:1px solid \${border};"></div>
        \${dayHeaders}
      </div>
      \${buildAllDayStrip(allDayEvs,days)}
      <div style="flex:1;display:flex;overflow:hidden;">
        \${buildTimeGutter()}
        <div id="cal-scroll" style="flex:1;overflow-y:auto;position:relative;">
          <div style="position:relative;height:\${24*HOUR_PX}px;">
            \${buildHourLines()}
            \${hasToday?buildNowIndicator(now):''}
            \${dayEventCols}\${vSep}
          </div>
        </div>
      </div>
    </div>\`;
  const sc=document.getElementById('cal-scroll');
  if(sc) sc.scrollTop=scrollTop;
}

// ── MONTH VIEW ───────────────────────────────────────────────────────────────
function renderMonthView(events){
  const now=getNow();
  const monthLabel=now.toLocaleDateString('en-US',{month:'long',year:'numeric'});
  const firstDay=new Date(now.getFullYear(),now.getMonth(),1);
  const lastDay=new Date(now.getFullYear(),now.getMonth()+1,0);
  const startDow=firstDay.getDay();
  const totalDays=lastDay.getDate();
  const cells=[...Array(startDow).fill(null),
    ...Array.from({length:totalDays},function(_,i){return new Date(now.getFullYear(),now.getMonth(),i+1);})];
  while(cells.length%7!==0) cells.push(null);
  const weeks=[];
  for(let i=0;i<cells.length;i+=7) weeks.push(cells.slice(i,i+7));
  const todayIso=isoDate(now);
  const DAY_NAMES=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const headerRow='<div style="display:flex;flex-shrink:0;border-bottom:2px solid '+border+';">'+
    DAY_NAMES.map(function(d){
      return '<div style="flex:1;text-align:center;font-size:11px;font-weight:600;color:'+textMuted+';padding:8px 0;text-transform:uppercase;">'+d+'</div>';
    }).join('')+'</div>';
  const weekRows=weeks.map(function(week){
    return '<div style="display:flex;flex:1;min-height:0;">'+week.map(function(day){
      if(!day) return '<div style="flex:1;border:1px solid '+border+';background:'+surface+';"></div>';
      const dayIso=isoDate(day);
      const isToday=dayIso===todayIso;
      const dayEvs=events.filter(function(e){return isoDate(toLocal(e.start))===dayIso;}).slice(0,3);
      const chips=dayEvs.map(function(ev,i){
        return '<div style="margin:1px 4px;padding:1px 5px;border-radius:3px;font-size:11px;background:'+evColor(i)+';color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">'
          +(ev.allDay?'':'<span style="opacity:0.85;">'+escHtml(fmtTimeFull(toLocal(ev.start)))+' </span>')
          +escHtml(ev.title||'(no title)')+'</div>';
      }).join('');
      return '<div style="flex:1;border:1px solid '+border+';padding:4px 0;box-sizing:border-box;overflow:hidden;'
        +'background:'+(isToday?(isDark?'rgba(26,115,232,0.12)':'rgba(26,115,232,0.06)'):bg)+';">'
        +'<div style="text-align:center;margin-bottom:2px;">'
        +'<span style="display:inline-block;width:24px;height:24px;line-height:24px;border-radius:50%;text-align:center;font-size:13px;'
        +'background:'+(isToday?accent:'transparent')+';color:'+(isToday?'#fff':text)+';font-weight:'+(isToday?700:400)+';"> '+day.getDate()+'</span>'
        +'</div>'+chips+'</div>';
    }).join('')+'</div>';
  }).join('');
  document.getElementById('root').innerHTML=\`
    <div style="position:absolute;inset:0;display:flex;flex-direction:column;background:\${bg};color:\${text};overflow:hidden;">
      \${buildHeader(monthLabel)}
      <div style="flex:1;display:flex;flex-direction:column;overflow:hidden;">
        \${headerRow}\${weekRows}
      </div>
    </div>\`;
}

// ── MEETING ROOM VIEW ────────────────────────────────────────────────────────
function renderMeetingRoom(events){
  const now=getNow();
  const todayStart=new Date();todayStart.setHours(0,0,0,0);
  const todayEnd=new Date(todayStart);todayEnd.setDate(todayEnd.getDate()+1);
  const today=events
    .filter(function(e){return new Date(e.end)>todayStart&&new Date(e.start)<todayEnd;})
    .sort(function(a,b){return new Date(a.start)-new Date(b.start);});
  const currentEv=today.find(function(e){return new Date(e.start)<=Date.now()&&new Date(e.end)>Date.now();});
  const nextEv=today.find(function(e){return new Date(e.start)>Date.now();});
  const isBusy=!!currentEv;
  const msToCurrentEnd=currentEv?new Date(currentEv.end)-Date.now():Infinity;
  const msToNextStart=nextEv?new Date(nextEv.start)-Date.now():Infinity;
  const isAmberEnding=isBusy&&msToCurrentEnd<15*60*1000;
  const isAmberSoon=!isBusy&&isFinite(msToNextStart)&&msToNextStart<15*60*1000;
  const railColor=(isBusy&&!isAmberEnding)?'#d93025':(isBusy&&isAmberEnding)?'#f59e0b':isAmberSoon?'#f59e0b':'#34a853';
  const roomName=(roomMeta&&roomMeta.name)||contentName||'Meeting Room';
  const capacity=(roomMeta&&roomMeta.capacity)||null;
  function fmtRange(e){return escHtml(fmtClock(toLocal(e.start)))+' – '+escHtml(fmtClock(toLocal(e.end)));}
  function fmtCountdown(ms){const mins=Math.ceil(ms/60000);return mins<60?mins+' min':Math.floor(mins/60)+'h '+pad2(mins%60)+'m';}
  const allDayEvs=today.filter(function(e){return e.allDay;});
  const timedEvs=today.filter(function(e){return !e.allDay;});
  const allDayHtml=allDayEvs.length===0?'':'<div style="display:flex;flex-wrap:wrap;gap:8px;padding:12px 36px;border-bottom:1px solid '+border+';background:'+(isDark?'rgba(255,255,255,0.04)':'rgba(0,0,0,0.03)')+'">'+
    allDayEvs.map(function(e){
      const title=e.isPrivate?'Busy':(e.title||'Reserved');
      return '<div style="display:inline-flex;align-items:center;gap:6px;padding:4px 14px;border-radius:20px;background:'+accent+'22;border:1px solid '+accent+'44;font-size:18px;color:'+text+';">&#9656; '+escHtml(title)+'</div>';
    }).join('')+'</div>';
  const meetingsHtml=timedEvs.length===0&&allDayEvs.length===0
    ?'<div style="display:flex;align-items:center;justify-content:center;height:100%;color:'+textMuted+';font-size:36px;text-align:center;padding:40px;">No meetings scheduled for today</div>'
    :timedEvs.map(function(e){
      const isCurrent=e===currentEv;
      const isCancelled=e.status==='cancelled';
      const isTentative=e.status==='tentative';
      const title=e.isPrivate?'Busy':(e.title||'Reserved');
      return '<div style="display:flex;gap:28px;padding:22px 36px;align-items:baseline;border-bottom:1px solid '+border+';opacity:'+(isCancelled?'0.45':'1')+';'+(isCurrent?'background:'+railColor+'1a;':'')+'">'+
        '<div style="font-variant-numeric:tabular-nums;font-size:28px;font-weight:600;color:'+text+';white-space:nowrap;min-width:210px;">'+fmtRange(e)+'</div>'+
        '<div style="flex:1;min-width:0;">'+
          '<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">'+
            '<span style="font-size:30px;font-weight:600;color:'+text+';line-height:1.25;'+(isCancelled?'text-decoration:line-through;':'')+'">'+escHtml(title)+'</span>'+
            (isTentative?'<span style="background:#f59e0b;color:#fff;padding:3px 10px;border-radius:4px;font-size:15px;font-weight:700;">TENTATIVE</span>':'')+
            (isCancelled?'<span style="background:#6b7280;color:#fff;padding:3px 10px;border-radius:4px;font-size:15px;font-weight:700;">CANCELLED</span>':'')+
          '</div>'+
          '<div style="display:flex;gap:18px;flex-wrap:wrap;margin-top:4px;">'+
            (e.organizerName&&!e.isPrivate?'<span style="font-size:19px;color:'+textMuted+';">'+escHtml(e.organizerName)+'</span>':'')+
            (showLoc&&e.location&&!e.isPrivate?'<span style="font-size:19px;color:'+textMuted+';">&#128205; '+escHtml(e.location)+'</span>':'')+
            (showAtt&&typeof e.attendeeCount==='number'?'<span style="font-size:19px;color:'+textMuted+';">&#128101; '+e.attendeeCount+'</span>':'')+
          '</div>'+
        '</div>'+
        (isCurrent?'<div style="background:'+railColor+';color:#fff;padding:6px 14px;border-radius:4px;font-size:16px;text-transform:uppercase;letter-spacing:1px;align-self:center;flex-shrink:0;">Now</div>':'')+
      '</div>';
    }).join('');
  const statusText=isBusy?(isAmberEnding?'ENDING SOON':'IN USE'):(isAmberSoon?'STARTING SOON':'AVAILABLE');
  const statusLine=currentEv?(isAmberEnding?'Ends in '+fmtCountdown(msToCurrentEnd):'Until '+escHtml(fmtClock(toLocal(currentEv.end)))):
    nextEv?(isAmberSoon?'Starts in '+fmtCountdown(msToNextStart):'Free until '+escHtml(fmtClock(toLocal(nextEv.start)))):'Free for the rest of the day';
  const header='<div style="display:flex;align-items:center;gap:18px;padding:18px 32px;background:'+(isDark?'#2a2e3e':'#f1f3f5')+';border-bottom:3px solid '+railColor+';flex-shrink:0;">'+
    '<div style="font-size:52px;font-weight:700;color:'+text+';letter-spacing:2px;text-transform:uppercase;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">'+escHtml(roomName)+'</div>'+
    (roomMeta&&roomMeta.location?'<div style="font-size:22px;color:'+textMuted+';margin-left:16px;flex-shrink:0;">'+escHtml(roomMeta.location)+'</div>':'')+
  '</div>';
  const rail='<div style="background:'+railColor+';color:#fff;display:flex;flex-direction:column;padding:28px 26px;width:360px;flex-shrink:0;">'+
    '<div id="cal-clock" style="font-size:64px;font-weight:700;letter-spacing:-1px;line-height:1;">'+(clockStyle==='none'?'':fmtClock(now))+'</div>'+
    '<div style="font-size:22px;opacity:0.9;margin-top:6px;">'+now.getFullYear()+'.'+pad2(now.getMonth()+1)+'.'+pad2(now.getDate())+'</div>'+
    '<div style="font-size:28px;font-weight:700;margin-top:22px;letter-spacing:1px;">'+statusText+'</div>'+
    '<div style="font-size:18px;opacity:0.92;margin-top:6px;">'+statusLine+'</div>'+
    (capacity?'<div style="margin-top:24px;"><div style="font-size:15px;letter-spacing:2px;text-transform:uppercase;opacity:0.85;margin-bottom:8px;">Room capacity</div><div style="display:inline-block;background:rgba(255,255,255,0.18);border:1px solid rgba(255,255,255,0.32);padding:10px 20px;border-radius:6px;font-size:32px;font-weight:700;">'+capacity+'</div></div>':'')+
  '</div>';
  const edgeOverlay=(isBusy||isAmberSoon)?
    '<style>@keyframes mr-pulse{0%,100%{opacity:0.18;}50%{opacity:0.72;}}</style><div style="pointer-events:none;position:absolute;inset:0;z-index:999;box-shadow:inset 0 0 0 12px '+railColor+';animation:mr-pulse 1.6s ease-in-out infinite;"></div>':
    '<div style="pointer-events:none;position:absolute;inset:0;z-index:999;box-shadow:inset 0 0 0 12px '+railColor+';"></div>';
  document.getElementById('root').innerHTML=\`
    <div style="position:absolute;inset:0;display:flex;flex-direction:column;background:\${bg};color:\${text};overflow:hidden;">
      \${header}
      <div style="flex:1;display:flex;flex-direction:row;overflow:hidden;">
        <div style="flex:1;position:relative;overflow:hidden;">
          <div style="position:relative;height:100%;overflow-y:auto;">
            \${allDayHtml}\${meetingsHtml}
          </div>
        </div>
        \${rail}
      </div>
      \${edgeOverlay}
    </div>\`;
}

// ── Dispatch ─────────────────────────────────────────────────────────────────
let lastSig='';
function evSig(evs){return evs.map(function(e){return e.id+'|'+e.start+'|'+e.end+'|'+e.title+'|'+(e.location||'');}).join('\\n');}
function maybeRender(evs){
  const sig=evSig(evs);
  // Meeting room must re-render when busy/free boundary crosses
  const isMR=VIEW==='meeting_room';
  if(sig===lastSig&&!isMR) return;
  lastSig=sig;
  if(VIEW==='day')          renderDayView(evs);
  else if(VIEW==='month')   renderMonthView(evs);
  else if(VIEW==='meeting_room') renderMeetingRoom(evs);
  else renderWeekView(evs,VIEW==='workweek'?5:7);
}

// ── Fetch ─────────────────────────────────────────────────────────────────────
async function fetchAndRender(){
  const now=new Date();now.setHours(0,0,0,0);
  const to=new Date(now);
  const days=VIEW==='day'||VIEW==='meeting_room'?1:VIEW==='month'?31:7;
  to.setDate(to.getDate()+days);
  try{
    const url=EVENTS_URL+'?from='+encodeURIComponent(now.toISOString())+'&to='+encodeURIComponent(to.toISOString())+(TOKEN?'&token='+encodeURIComponent(TOKEN):'');
    const res=await fetch(url);
    if(!res.ok) throw new Error('HTTP '+res.status);
    const body=await res.json();
    try{localStorage.setItem('cal_'+EVENTS_URL,JSON.stringify({events:body.events||[],cachedAt:Date.now()}));}catch(e){}
    maybeRender(body.events||[]);
  }catch(err){
    console.warn('[Calendar] fetch failed:',err);
    // Use cached data if first paint
    if(lastSig) return;
    try{
      const raw=localStorage.getItem('cal_'+EVENTS_URL);
      if(raw){const {events}=JSON.parse(raw);maybeRender(events||[]);}
    }catch(e){}
  }
}

fetchAndRender();
setInterval(fetchAndRender,REFRESH_MS);
// Meeting room needs boundary re-renders (busy/free transitions) every minute
if(VIEW==='meeting_room') setInterval(function(){if(lastSig)maybeRender(JSON.parse(localStorage.getItem('cal_'+EVENTS_URL)||'{}').events||[]);},60000);
})();
<\/script>
</body></html>`;

  const blob    = new Blob([html], { type: 'text/html' });
  const blobUrl = URL.createObjectURL(blob);
  const iframe  = document.createElement('iframe');
  Object.assign(iframe.style, { position:'absolute', top:'0', left:'0', width:'100%', height:'100%', border:'none' });
  iframe.allow = 'autoplay';
  iframe.src = blobUrl;
  root.appendChild(iframe);
  iframe.addEventListener('load', () => URL.revokeObjectURL(blobUrl), { once: true });
  scheduleAdvance(durationSec);
  console.info(`[Player] Calendar: view=${view} tz=${timezone} refresh=${refreshSeconds}s`);
}

// ---------------------------------------------------------------------------
// IPC from main process
// ---------------------------------------------------------------------------
window.nexari.onMessage('CMD_LOAD_URL', (data: any) => {
  if (!data?.url) return;
  cancelPlayback();
  _playlist = null;
  _contentSignature = '';
  clearRoot();
  const iframe = document.createElement('iframe');
  Object.assign(iframe.style, { position:'absolute', top:'0', left:'0', width:'100%', height:'100%', border:'none' });
  iframe.allow = 'autoplay; fullscreen';
  iframe.src = data.url;
  root.appendChild(iframe);
});

window.nexari.onMessage('CMD_SLEEP', () => {
  cancelPlayback();
  clearRoot();
  root.style.background = '#000';
});

// WS connection state (updated by main process messages)
let _wsConnected = false;

window.nexari.onMessage('CMD_DISPLAY_POWER', (data: any) => {
  document.body.style.visibility = data?.on !== false ? 'visible' : 'hidden';
});

window.nexari.onMessage('WS_MESSAGE', (msg: any) => {
  switch (msg?.type) {
    case 'content-update':
    case 'schedule.updated':
    case 'content.published':
    case 'refresh_schedule':
      console.info(`[Player] Schedule refresh triggered by: ${msg.type}`);
      loadContent();
      break;
    case 'emergency_start':
      console.warn('[Player] Emergency content started');
      loadContent();
      break;
    case 'emergency_clear':
      console.info('[Player] Emergency content cleared');
      loadContent();
      break;
    case 'reload':
      console.info('[Player] Remote reload command received');
      location.reload();
      break;
    case 'LOAD_URL':
      if (msg.url) {
        console.info(`[Player] Remote URL load: ${msg.url}`);
        cancelPlayback();
        clearRoot();
        renderHTML({ url: msg.url } as NormalizedContent, 3600);
      }
      break;
    case 'VIDEOWALL_INIT':
      console.info('[Player] VIDEOWALL_INIT received');
      _wallManifest = msg;
      loadContent();
      break;
    case 'SESSION_CONFIG':
      console.info('[Player] SESSION_CONFIG received — refreshing content');
      loadContent();
      break;
    case 'SYNC_GROUP_INIT': {
      console.info('[Player] SYNC_GROUP_INIT received');
      _syncGroupManifest = msg;
      // Pre-download all playlist items so sync play is local.
      const playlist = msg?.playlist;
      if (playlist?.items?.length) {
        void Promise.all(
          playlist.items
            .map((item: any) => item?.filePath || item?.url || '')
            .filter(Boolean)
            .map((u: string) => downloadFirst(u)),
        ).then(() => {
          console.info('[Player] SYNC_GROUP_INIT pre-download complete');
        });
      }
      // Also trigger schedule refresh so the player renders sync content.
      loadContent();
      break;
    }
    case 'update_player': {
      const { version, downloadUrl } = (msg?.payload ?? {}) as { version?: string; downloadUrl?: string };
      console.info(`[Player] update_player received: v${version}`);
      // Trigger electron-updater via IPC — it will download + apply the update.
      window.nexari.checkForUpdates?.();
      break;
    }
  }
});

// ── Auto-update banner + settings overlay ───────────────────────────────────
window.nexari.onMessage('UPDATE_AVAILABLE', (data: any) => {
  banner.textContent = `Update v${data?.version ?? ''} downloading…`;
  banner.classList.add('visible');
  onAutoUpdateAvailable(String(data?.version ?? ''));
});
window.nexari.onMessage('UPDATE_PROGRESS', (data: any) => {
  banner.textContent = `Updating… ${data?.percent ?? 0}%`;
});
window.nexari.onMessage('UPDATE_DOWNLOADED', () => {
  banner.textContent = 'Update ready — will install on next restart.';
  onAutoUpdateDownloaded();
});

// ── Remote log commands ──────────────────────────────────────────────────────
// dump_logs: flush the full ring buffer to the API immediately
window.nexari.onMessage('CMD_DUMP_LOGS', () => {
  flushLogs(LOG_MAX);
});

// Auto-flush every 8 s when the log Live button is active (server sends dump_logs
// every 8 s when "Live" is on). We also do a small ambient flush every 60 s.
setInterval(() => flushLogs(50), 60_000);

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
showIdle('Loading content…');

// Bootstrap localStorage from the main-process JsonStore.
// This ensures apiBase + deviceToken are always correct on startup,
// whether this is the first boot after pairing or a subsequent launch.
(async () => {
  try {
    const cfg = await window.nexari.getConfig();
    if (cfg.apiBase)     localStorage.setItem('apiBase',     cfg.apiBase);
    if (cfg.deviceToken) localStorage.setItem('deviceToken', cfg.deviceToken);
    if (cfg.deviceId)    localStorage.setItem('deviceId',    cfg.deviceId);
    const ver = (cfg as any).appVersion || '0.1.0';
    console.info(`[Player] Boot: platform=windows version=${ver} deviceId=${cfg.deviceId || '(none)'} apiBase=${cfg.apiBase || '(none)'}`);

    // Init settings overlay after config is loaded
    initPlayerSettings({
      getDeviceId:     () => localStorage.getItem('deviceId') || '',
      getDeviceName:   () => localStorage.getItem('deviceName') || 'Nexari Windows',
      getApiBase:      () => localStorage.getItem('apiBase') || '',
      getWsConnected:  () => _wsConnected,
      getVersion:      () => ver,
      onReloadContent: () => loadContent(),
      onClearCache:    () => { localStorage.removeItem('contentCache'); loadContent(); },
      onCheckForUpdates: () => { window.nexari.checkForUpdates?.(); },
    });
  } catch (e) {
    console.warn('[Player] getConfig IPC failed:', e);
  }
  loadContent();
})();
