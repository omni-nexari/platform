/**
 * api.ts — Windows player API client.
 *
 * TypeScript port of apps/nexari-tizen/js/api.js, adapted to work in the
 * Electron renderer context (no globalThis.CONFIG — reads from localStorage).
 */

export interface NormalizedContent {
  id: string;
  name: string;
  type: string;
  mimeType?: string;
  url: string;
  fileUrl: string;
  webUrl: string | null;
  originalName?: string;
  filePath?: string;
  metadata: string;
  channels?: any[];
  defaultChannelNumber?: number;
}

export interface PlaylistItem {
  id: string;
  contentId: string;
  duration: number;
  position: number;
  content: NormalizedContent | null;
}

export interface SyncPlayInfo {
  enabled: boolean;
  groupID: number;
  syncGroupId: string | null;
  peers: any[];
}

export interface Playlist {
  id: string;
  playlistId: string;
  playlistName: string;
  items: PlaylistItem[];
  syncPlay: SyncPlayInfo | null;
  /** Resolved sync group UUID (JS engine path). */
  syncGroupId?: string | null;
  /** Relay WS URL for cross-OS sync groups. */
  relayUrl?: string | null;
  /** False when group contains non-Tizen peers — use relay engine, not b2bsyncplay. */
  allTizen?: boolean;
  /** 'cloud' = centralised API relay; 'lan' = ws://leaderIp:9616 built-in relay. */
  syncRelayMode?: string | null;
}

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------
function getApiBase(): string {
  return (localStorage.getItem('apiBase') || 'https://ds.chiho.app/api/v1').replace(/\/$/, '');
}

function getToken(): string {
  return localStorage.getItem('deviceToken') || '';
}

async function apiFetch(path: string, token?: string): Promise<any> {
  const tok = token || getToken();
  const res = await fetch(`${getApiBase()}${path}`, {
    headers: { Authorization: `Bearer ${tok}` },
  });
  if (res.status === 401 || res.status === 404) {
    // Device was deleted or token revoked — clear credentials and go to pairing
    console.warn(`[api] Device rejected (${res.status}), unpairing…`);
    localStorage.removeItem('deviceToken');
    localStorage.removeItem('deviceId');
    window.nexari.unpair().catch(() => {});
    throw new Error(`HTTP ${res.status}: device not found`);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  return res.json();
}

// ---------------------------------------------------------------------------
// Schedule / workspace
// ---------------------------------------------------------------------------
export async function getSchedule(): Promise<{ schedules: any[] }> {
  return apiFetch('/devices/device/schedule');
}

export async function getWorkspaceInfo(): Promise<any> {
  return apiFetch('/devices/device/workspace');
}

export async function getCurrentContent(): Promise<Playlist | null> {
  const [scheduleData, workspaceData] = await Promise.all([
    getSchedule(),
    getWorkspaceInfo().catch(() => ({ workspace: null, defaultPlaylist: null })),
  ]);

  const rb = workspaceData?.resellerBranding as { logoUrl?: string } | null | undefined;
  if (rb?.logoUrl) {
    localStorage.setItem('resellerBrandingLogoUrl', rb.logoUrl);
  } else {
    localStorage.removeItem('resellerBrandingLogoUrl');
  }

  return _resolveActivePlaylist(scheduleData.schedules, workspaceData.defaultPlaylist, {
    publishedContent: workspaceData.publishedContent || null,
    publishedPlaylist: workspaceData.publishedPlaylist || null,
    publishedSchedule: workspaceData.publishedSchedule || null,
    publishedSyncGroup: workspaceData.publishedSyncGroup || null,
  });
}

export async function sendHeartbeat(payload: Record<string, unknown>): Promise<void> {
  const apiBase = getApiBase();
  await fetch(`${apiBase}/devices/device/heartbeat`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).catch(() => {});
}

// ---------------------------------------------------------------------------
// Internal resolution helpers (ported verbatim from api.js)
// ---------------------------------------------------------------------------
function _resolveActivePlaylist(
  schedules: any[],
  defaultPlaylist: any,
  publishedTargets: {
    publishedContent: any;
    publishedPlaylist: any;
    publishedSchedule: any;
    publishedSyncGroup: any;
  },
): Playlist | null {
  if (publishedTargets.publishedSyncGroup) {
    const sg = publishedTargets.publishedSyncGroup;
    const sp = sg.syncPlaylist;
    if (sp && (sp.items || []).length > 0) {
      const normalized = _normalizeSyncPlaylist(sp, sg.groupId, sg);
      if (normalized) return normalized;
    }
  }

  if (publishedTargets.publishedContent) {
    return _normalizeSingleContent(publishedTargets.publishedContent, 'Published Content');
  }

  if (publishedTargets.publishedPlaylist && (publishedTargets.publishedPlaylist.items || []).length > 0) {
    return _normalizePlaylist(publishedTargets.publishedPlaylist);
  }

  if (publishedTargets.publishedSchedule) {
    const ps = Object.assign({}, publishedTargets.publishedSchedule, { isActive: true });
    const r = _resolveScheduledPlaylist([ps], null);
    if (r) return r;
  }

  return _resolveScheduledPlaylist(schedules, defaultPlaylist);
}

function _resolveScheduledPlaylist(schedules: any[], defaultPlaylist: any): Playlist | null {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  for (const schedule of (schedules || [])) {
    if (!schedule.isActive) continue;
    for (const slot of (schedule.slots || [])) {
      const slotDays = slot.daysOfWeek || slot.dayOfWeek;
      if (slotDays && Array.isArray(slotDays) && !slotDays.includes(dayOfWeek)) continue;

      if (slot.startTime && slot.endTime) {
        const [startH, startM] = slot.startTime.split(':').map(Number);
        const [endH, endM]     = slot.endTime.split(':').map(Number);
        const startMin = startH * 60 + startM;
        const endMin   = endH   * 60 + endM;
        if (currentMinutes < startMin || currentMinutes >= endMin) continue;
      }

      if (slot.playlist && (slot.playlist.items || []).length > 0) {
        return _normalizePlaylist(slot.playlist);
      } else if (slot.content) {
        return _normalizeSingleContent(slot.content, schedule.name);
      }
    }
  }

  if (defaultPlaylist && (defaultPlaylist.items || []).length > 0) {
    const items = (defaultPlaylist.items || []).filter(
      (item: any) => !item.content || (item.content.type || '').toLowerCase() !== 'calendar',
    );
    if (items.length > 0) {
      return _normalizePlaylist({ ...defaultPlaylist, items });
    }
  }

  return null;
}

function _normalizePlaylist(playlist: any): Playlist {
  const items: PlaylistItem[] = (playlist.items || []).map((item: any) => ({
    id: item.id,
    contentId: item.contentId,
    duration: item.duration || 10,
    position: item.position || 0,
    content: item.content ? _normalizeContent(item.content) : null,
  }));
  return { id: playlist.id, playlistId: playlist.id, playlistName: playlist.name, items, syncPlay: null };
}

function _normalizeSyncPlaylist(syncPlaylist: any, groupId: any, syncGroup: any): Playlist | null {
  const numericGroupId = Number(groupId);
  if (!Number.isFinite(numericGroupId) || !Number.isInteger(numericGroupId) ||
      numericGroupId < 0 || numericGroupId > 65535) {
    return null;
  }
  const items: PlaylistItem[] = (syncPlaylist.items || []).map((item: any, idx: number) => ({
    id: item.id,
    contentId: item.contentId,
    duration: item.durationSeconds || 10,
    position: item.sortOrder ?? idx,
    content: item.content ? _normalizeContent(item.content) : null,
  }));
  if (items.length === 0) return null;
  return {
    id: syncPlaylist.id,
    playlistId: syncPlaylist.id,
    playlistName: syncPlaylist.name || 'Sync Playlist',
    items,
    syncPlay: {
      enabled: true,
      groupID: numericGroupId,
      syncGroupId: syncGroup?.id || null,
      peers: syncGroup?.peers || [],
    },
    syncGroupId: syncGroup?.id || null,
    relayUrl: syncGroup?.relayUrl || null,
    allTizen: syncGroup?.allTizen ?? true,
    syncRelayMode: syncGroup?.syncRelayMode ?? 'cloud',
  };
}

function _normalizeSingleContent(content: any, scheduleName: string): Playlist {
  return {
    id: content.id,
    playlistId: content.id,
    playlistName: scheduleName || 'Schedule',
    items: [{ id: content.id, contentId: content.id, duration: 10, position: 0, content: _normalizeContent(content) }],
    syncPlay: null,
  };
}

export function _normalizeContent(content: any): NormalizedContent {
  const token = getToken();
  const apiBase = getApiBase();
  const fileUrl = `${apiBase}/devices/device/content/${content.id}/file?token=${encodeURIComponent(token)}`;

  const normalized: NormalizedContent = {
    id: content.id,
    name: content.name,
    type: (content.type || '').toUpperCase(),
    mimeType: content.mimeType,
    url: content.url || fileUrl,
    fileUrl,
    webUrl: content.webUrl || null,
    originalName: content.originalName,
    filePath: content.filePath,
    metadata: content.metadata || '{}',
  };

  if (normalized.type === 'HTML5') {
    normalized.url = `${apiBase}/devices/device/content/${content.id}/html5/${encodeURIComponent(token)}/index.html`;
    normalized.webUrl = null;
  }

  if (normalized.type === 'MENU_BOARD') {
    // Menu boards have no associated file; they are rendered from POS API data.
    // Clear the file URL so renderMenuBoard fetches /pos/menu instead.
    normalized.url = '';
    normalized.webUrl = null;
  }

  if (normalized.type === 'CHANNEL_GROUP') {
    try {
      const meta = typeof content.metadata === 'string'
        ? JSON.parse(content.metadata || '{}')
        : (content.metadata || {});
      normalized.channels = Array.isArray(meta.channels) ? meta.channels : [];
      normalized.defaultChannelNumber = typeof meta.defaultChannelNumber === 'number'
        ? meta.defaultChannelNumber
        : (normalized.channels[0]?.number ?? 1);
      normalized.url = '';
    } catch {
      normalized.channels = [];
      normalized.url = '';
    }
  }

  return normalized;
}
