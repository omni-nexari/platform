import { useState, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router';
import {
  ArrowRight, ArrowLeft, CheckCircle, XCircle, Loader2,
  Monitor, Image, Film, FileText, Layers, CalendarDays,
  AlertTriangle, Info, ChevronRight, ArrowDownToLine,
} from 'lucide-react';
import { api } from '../../lib/api.js';
import {
  PageHeader, SectionCard, SectionCardHeader, SectionCardBody,
  Badge, Callout, Skeleton, ActionButton, EmptyState,
} from '../../components/UiPrimitives.js';

// ─── Types ────────────────────────────────────────────────────────────────────

interface MiContent {
  contentId: string;
  contentName: string;
  contentType?: string;   // legacy alias
  mediaType: string;      // actual MagicInfo field
  fileSize?: number;
  totalSize?: number;
  mainFileId?: string;
  mainFileName?: string;
  thumbnailUrl?: string;
  tags?: string[];
  groupId?: string;
  groupName?: string;
}

interface MiPlaylistItem {
  contentId: string;
  contentName?: string;
  duration: number;
  order?: number;
}

interface MiPlaylist {
  playlistId: string;
  playlistName: string;
  playlistType?: string;
  totalDuration?: number;
  itemCount?: number;
  tags?: string[];
  groupId?: string;
  items?: MiPlaylistItem[];
}

interface MiTimeChannel {
  startTime?: string;
  endTime?: string;       // v1.0 field
  stopTime?: string;      // v2.0 alias for endTime
  durationInSeconds?: number;
  repeatType?: string;    // "ONCE" | "DAILY" | "WEEKLY" | "MONTHLY"
  repeatedDayOfWeekList?: string[]; // ["MON","TUE"...] as returned by MagicInfo API
  startDate?: string;
  endDate?: string;       // v1.0 field
  stopDate?: string;      // v2.0 alias for endDate
  isAllDayPlay?: boolean;
  isInfinitePlay?: boolean;
  contentId?: string;
  contentName?: string;
  playlistId?: string;
}

interface MiSchedule {
  scheduleId: string;   // normalized (from programId in v1.0 API)
  scheduleName: string; // normalized (from programName in v1.0 API)
  tags?: string[];
  groupId?: string | number;
  timeChannels?: MiTimeChannel[];
}

interface MiDevice {
  deviceId: string;
  deviceName: string;
  deviceType?: string;
  connectionStatus?: string;
  serialNo?: string;
  macAddress?: string;
  groupId?: string;
  groupName?: string;
  groupPath?: string;
  currentScheduleId?: string;
  scheduleId?: string;
  // enriched from device detail call
  contentScheduleId?: string;
  contentScheduleName?: string;
  messageScheduleName?: string;
}

type LogStatus = 'pending' | 'ok' | 'error' | 'skipped';
interface LogEntry {
  type: 'content' | 'playlist' | 'schedule' | 'tag';
  miId: string;
  name: string;
  status: LogStatus;
  message?: string;
  nexariId?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MIGRATABLE_PLAYLIST_TYPES = new Set(['GENERAL', 'NORMAL', '', undefined, null]);
const PLAYLIST_TYPE_LABELS: Record<string, string> = {
  VIDEOWALL: 'Video Wall — Phase 2',
  SYNC: 'Sync — Phase 2',
  SYNCHRONIZED: 'Sync — Phase 2',
  TAG: 'Tag-based — Not supported',
  DYNAMIC: 'Dynamic — Not supported',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatBytes(bytes?: number): string {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(seconds?: number): string {
  if (!seconds) return '—';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function contentTypeIcon(type: string) {
  const t = (type ?? '').toUpperCase();
  if (t.includes('VIDEO') || t === 'LFD') return <Film className="w-4 h-4 text-purple-400" />;
  if (t === 'PDF') return <FileText className="w-4 h-4 text-red-400" />;
  return <Image className="w-4 h-4 text-blue-400" />;
}

/** Parse MagicInfo device group path into breadcrumb segments, dropping root. */
function parseGroupPath(groupPath?: string, groupName?: string): string[] {
  const raw = groupPath || groupName || '';
  const parts = raw.split(/>|›/).map(s => s.trim()).filter(Boolean);
  // Drop leading "Root" segment
  const start = parts[0]?.toLowerCase() === 'root' ? 1 : 0;
  return parts.slice(start);
}

// MagicInfo day strings → Nexari daysOfWeek numbers (0 = Monday)
const DOW_MAP: Record<string, number> = { MON: 0, TUE: 1, WED: 2, THU: 3, FRI: 4, SAT: 5, SUN: 6 };

function timeToSec(t?: string): number {
  if (!t) return 0;
  const [hs = '0', ms = '0', ss = '0'] = t.split(':');
  const h = parseInt(hs, 10), m = parseInt(ms, 10), s = parseInt(ss, 10);
  return (Number.isFinite(h) && Number.isFinite(m)) ? h * 3600 + m * 60 + (Number.isFinite(s) ? s : 0) : 0;
}

function padTime(t?: string): string {
  if (!t) return '00:00';
  const [h = '00', m = '00'] = t.split(':');
  return `${h.padStart(2, '0')}:${m.padStart(2, '0')}`;
}

/** Map MagicInfo time channel → Nexari slot payload */
function mapTimeChannel(ch: MiTimeChannel, nexariPlaylistId?: string, nexariContentId?: string) {
  const hasPlaylist = !!nexariPlaylistId;
  const hasContent = !!nexariContentId;

  const rawRepeat = (ch.repeatType ?? 'ONCE').toUpperCase();
  const recurrenceType =
    rawRepeat === 'WEEKLY'  ? 'weekly'  :
    rawRepeat === 'DAILY'   ? 'daily'   :
    rawRepeat === 'MONTHLY' ? 'monthly' : 'once';

  const isAllDay = ch.isAllDayPlay ?? false;
  const rawEnd = ch.endTime ?? ch.stopTime;
  const rawEndDate = ch.endDate ?? ch.stopDate ?? '';
  const isInfinite = ch.isInfinitePlay ?? (!rawEndDate || rawEndDate >= '2900-01-01');

  // Compute endTime: explicit field → startTime + durationInSeconds → default
  let endTime: string;
  if (isAllDay) {
    endTime = '23:59';
  } else if (rawEnd) {
    endTime = padTime(rawEnd);
  } else if (ch.startTime && ch.durationInSeconds) {
    const endSec = timeToSec(ch.startTime) + ch.durationInSeconds;
    const h = Math.floor(endSec / 3600) % 24;
    const m = Math.floor((endSec % 3600) / 60);
    endTime = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  } else {
    endTime = '23:59';
  }

  const startTime = isAllDay ? '00:00' : padTime(ch.startTime);
  const daysOfWeek = recurrenceType === 'weekly' && ch.repeatedDayOfWeekList?.length
    ? ch.repeatedDayOfWeekList.map(d => DOW_MAP[d.toUpperCase()] ?? 0)
    : undefined;

  return {
    playlistId: hasPlaylist ? nexariPlaylistId : undefined,
    contentId: !hasPlaylist && hasContent ? nexariContentId : undefined,
    startTime,
    endTime,
    recurrenceType,
    daysOfWeek,
    date: recurrenceType === 'once' ? ch.startDate : undefined,
    recurrenceStartDate: recurrenceType !== 'once' ? ch.startDate : undefined,
    recurrenceEndDate: isInfinite ? '2999-12-31' : rawEndDate || undefined,
    color: '#3B82F6',
    priority: 0,
  };
}

/**
 * Parse a MagicInfo v2.0 content-schedule detail response into MiTimeChannel[].
 * Response shape: { items: { channels: [{ frame: { events: [...] } }] } }
 * Each event has contentId + contentType ("PLAYLIST"|other) to distinguish playlist refs.
 */
function extractScheduleChannels(detail: unknown): MiTimeChannel[] {
  const d = detail as Record<string, unknown>;
  const schedObj = (d.items ?? d.data ?? d.result ?? d) as Record<string, unknown>;
  const rawChannels = Array.isArray(schedObj.channels)
    ? (schedObj.channels as Record<string, unknown>[])
    : [];
  return rawChannels.flatMap(ch => {
    const frame = (ch.frame ?? {}) as Record<string, unknown>;
    const events = Array.isArray(frame.events)
      ? (frame.events as Record<string, unknown>[])
      : [];
    return events.map(ev => {
      const ctype = String(ev.contentType ?? '').toUpperCase();
      const isPlaylist = ctype === 'PLAYLIST';
      const contentIdStr = ev.contentId ? String(ev.contentId) : null;
      const dur = Number(ev.durationInSeconds ?? 0) || 0;
      const dowList = Array.isArray(ev.repeatedDayOfWeekList)
        ? (ev.repeatedDayOfWeekList as string[]) : null;
      const cName = ev.contentName ? String(ev.contentName) : null;

      const channel: MiTimeChannel = {
        startTime:      String(ev.startTime ?? '00:00'),
        stopTime:       String(ev.stopTime ?? ev.endTime ?? ''),
        repeatType:     String(ev.repeatType ?? 'ONCE'),
        startDate:      String(ev.startDate ?? ''),
        stopDate:       String(ev.stopDate ?? ev.endDate ?? ''),
        isAllDayPlay:   Boolean(ev.isAllDayPlay  ?? false),
        isInfinitePlay: Boolean(ev.isInfinitePlay ?? false),
        ...(dur      ? { durationInSeconds: dur }       : {}),
        ...(dowList  ? { repeatedDayOfWeekList: dowList } : {}),
        ...(isPlaylist
          ? (contentIdStr ? { playlistId: contentIdStr } : {})
          : (contentIdStr ? { contentId:  contentIdStr } : {})),
        ...(cName ? { contentName: cName } : {}),
      };
      return channel;
    });
  });
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StepIndicator({ step, current }: { step: number; current: number }) {
  const labels = ['Connect', 'Review', 'Select', 'Migrate', 'Done'];
  return (
    <div className="flex items-center gap-0 mb-8">
      {labels.map((label, i) => {
        const num = i + 1;
        const done = num < current;
        const active = num === current;
        return (
          <div key={num} className="flex items-center">
            <div className="flex flex-col items-center gap-1">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold transition-colors ${
                done ? 'bg-green-500 text-white' :
                active ? 'bg-[var(--blue)] text-white' :
                'bg-[var(--surface)] text-[var(--text-muted)]'
              }`}>
                {done ? <CheckCircle className="w-4 h-4" /> : num}
              </div>
              <span className={`text-[10px] font-medium whitespace-nowrap ${active ? 'text-[var(--blue)]' : 'text-[var(--text-muted)]'}`}>
                {label}
              </span>
            </div>
            {i < labels.length - 1 && (
              <div className={`h-px w-8 sm:w-12 mx-1 mb-4 ${done ? 'bg-green-500' : 'bg-[var(--border)]'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function LogRow({ entry }: { entry: LogEntry }) {
  const icon = entry.status === 'ok'
    ? <CheckCircle className="w-4 h-4 text-green-500 shrink-0" />
    : entry.status === 'error'
    ? <XCircle className="w-4 h-4 text-red-500 shrink-0" />
    : entry.status === 'skipped'
    ? <AlertTriangle className="w-4 h-4 text-yellow-500 shrink-0" />
    : <Loader2 className="w-4 h-4 text-[var(--blue)] shrink-0 animate-spin" />;

  return (
    <div className="flex items-start gap-2 py-1.5 border-b border-[var(--border)] last:border-0 text-sm">
      {icon}
      <div className="flex-1 min-w-0">
        <span className="text-[var(--text)] truncate">{entry.name}</span>
        {entry.message && (
          <p className="text-xs text-[var(--text-muted)] mt-0.5 break-words">{entry.message}</p>
        )}
      </div>
      <Badge tone={entry.status === 'ok' ? 'success' : entry.status === 'error' ? 'danger' : entry.status === 'skipped' ? 'warning' : 'accent'}>
        {entry.type}
      </Badge>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function MigrationPage() {
  const { wsId } = useParams<{ wsId: string }>();
  const navigate = useNavigate();

  // Wizard state
  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(1);

  // Step 1 — Connect
  const [baseUrl, setBaseUrl] = useState('https://');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [miToken, setMiToken] = useState('');
  const [connectError, setConnectError] = useState('');
  const [connecting, setConnecting] = useState(false);

  // Step 2 — Review
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState('');
  const [devices, setDevices] = useState<MiDevice[]>([]);
  const [contentTotal, setContentTotal] = useState<number | null>(null);
  const [playlistTotal, setPlaylistTotal] = useState<number | null>(null);
  const [scheduleTotal, setScheduleTotal] = useState<number | null>(null);

  // Step 2 — Review extras
  const [expandedScheduleIds, setExpandedScheduleIds] = useState(new Set<string>());
  const [deviceScheduleItems, setDeviceScheduleItems] = useState<Record<string, { content: MiContent[]; playlists: MiPlaylist[] }>>({});
  const [scheduleItemsLoading, setScheduleItemsLoading] = useState(new Set<string>());

  // Step 3 — Select
  const [activeTab, setActiveTab] = useState<'content' | 'playlists' | 'schedules'>('content');
  const [contentList, setContentList] = useState<MiContent[]>([]);
  const [playlistList, setPlaylistList] = useState<MiPlaylist[]>([]);
  const [scheduleList, setScheduleList] = useState<MiSchedule[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [listLoaded, setListLoaded] = useState({ content: false, playlists: false, schedules: false });
  const [selectedContentIds, setSelectedContentIds] = useState(new Set<string>());
  const [selectedPlaylistIds, setSelectedPlaylistIds] = useState(new Set<string>());
  const [selectedScheduleIds, setSelectedScheduleIds] = useState(new Set<string>());
  const [contentSearch, setContentSearch] = useState('');
  const [playlistSearch, setPlaylistSearch] = useState('');
  const [scheduleSearch, setScheduleSearch] = useState('');

  // Step 4 — Migrate
  const [migrating, setMigrating] = useState(false);
  const [stopped, setStopped] = useState(false);
  const stopRef = useRef(false);
  const [log, setLog] = useState<LogEntry[]>([]);
  const logRef = useRef<HTMLDivElement>(null);

  // Step 5 — Done
  const [summary, setSummary] = useState({ content: 0, playlist: 0, schedule: 0, failed: 0 });

  // ── Proxy helper ──────────────────────────────────────────────────────────

  const miProxy = useCallback(async (miPath: string, method: 'GET' | 'POST' = 'GET', body?: unknown) => {
    return api.post<unknown>('/migration/magicinfo/proxy', {
      baseUrl, token: miToken, method, path: miPath, body,
    });
  }, [baseUrl, miToken]);

  function unwrapItems(data: unknown): unknown[] {
    if (Array.isArray(data)) return data;
    const d = data as Record<string, unknown> | null;
    if (!d) return [];
    if (Array.isArray(d['items'])) return d['items'] as unknown[];
    // v1.0 API: items is an object { data: [...], recordsFiltered: N }
    const itemsObj = d['items'] as Record<string, unknown> | null;
    if (itemsObj && typeof itemsObj === 'object' && !Array.isArray(itemsObj) && Array.isArray(itemsObj['data'])) {
      return itemsObj['data'] as unknown[];
    }
    const inner = (d['data'] ?? d['result']) as Record<string, unknown> | null;
    if (inner && Array.isArray(inner['items'])) return inner['items'] as unknown[];
    return [];
  }

  function unwrapTotal(data: unknown): number {
    const d = data as Record<string, unknown> | null;
    if (!d) return 0;
    const direct = d['totalCount'] ?? d['total'] ?? d['count'];
    if (typeof direct === 'number') return direct;
    // v1.0 API: items is an object with recordsFiltered
    const itemsObj = d['items'] as Record<string, unknown> | null;
    if (itemsObj && typeof itemsObj === 'object' && !Array.isArray(itemsObj)) {
      const t = itemsObj['recordsFiltered'] ?? itemsObj['totalCount'] ?? itemsObj['total'];
      if (typeof t === 'number') return t;
    }
    const inner = (d['data'] ?? d['result']) as Record<string, unknown> | null;
    if (inner) {
      const t = inner['totalCount'] ?? inner['total'];
      if (typeof t === 'number') return t;
    }
    const items = unwrapItems(data);
    return items.length;
  }

  // ── Step 1: Connect ───────────────────────────────────────────────────────

  async function handleConnect() {
    if (!baseUrl || !username || !password) {
      setConnectError('Base URL, username and password are required.');
      return;
    }
    setConnecting(true);
    setConnectError('');
    try {
      const res = await api.post<{ token: string }>('/migration/magicinfo/connect', {
        baseUrl, username, password, totpCode: totpCode || undefined,
      });
      setMiToken(res.token);
      setStep(2);
      void loadReview(res.token);
    } catch (err: unknown) {
      const e = err as { message?: string };
      let msg = e.message ?? 'Connection failed';
      try {
        const parsed = JSON.parse(msg) as { error?: string; detail?: string };
        msg = parsed.error ?? msg;
      } catch { /* not JSON — use as-is */ }
      setConnectError(msg);
    } finally {
      setConnecting(false);
    }
  }

  // ── Step 2: Review ────────────────────────────────────────────────────────

  async function loadReview(token: string) {
    setReviewLoading(true);
    setReviewError('');
    try {
      const proxyWith = async (miPath: string) => api.post<unknown>('/migration/magicinfo/proxy', {
        baseUrl, token, method: 'GET', path: miPath,
      });

      const [devResult, contentResult, playlistResult, scheduleResult] = await Promise.allSettled([
        proxyWith('/restapi/v2.0/rms/devices?pageSize=5000&startIndex=1'),
        proxyWith('/restapi/v2.0/cms/contents?pageSize=1&startIndex=1'),
        proxyWith('/restapi/v2.0/cms/playlists?pageSize=1&startIndex=1'),
        proxyWith('/restapi/v1.0/dms/schedule/contents?pageSize=1&startIndex=1'),
      ]);

      const rawDevices: MiDevice[] = devResult.status === 'fulfilled' ? unwrapItems(devResult.value) as MiDevice[] : [];
      setContentTotal(contentResult.status === 'fulfilled' ? unwrapTotal(contentResult.value) : 0);
      setPlaylistTotal(playlistResult.status === 'fulfilled' ? unwrapTotal(playlistResult.value) : 0);
      setScheduleTotal(scheduleResult.status === 'fulfilled' ? unwrapTotal(scheduleResult.value) : 0);

      // Enrich devices with schedule info from device detail (batches of 8, up to 200 devices)
      if (rawDevices.length > 0) {
        setDevices(rawDevices);
        const toEnrich = rawDevices.slice(0, 200);
        const enriched = [...rawDevices];
        const BATCH = 8;
        for (let i = 0; i < toEnrich.length; i += BATCH) {
          const batch = toEnrich.slice(i, i + BATCH);
          const results = await Promise.allSettled(
            batch.map(d => proxyWith(`/restapi/v2.0/rms/devices/${encodeURIComponent(d.deviceId)}`)),
          );
          results.forEach((r, bi) => {
            const globalIdx = i + bi;
            if (r.status === 'fulfilled') {
              const detail = (r.value as Record<string, unknown>)['items'] as Record<string, unknown> | undefined;
              if (detail) {
                const base = enriched[globalIdx];
                if (!base) return;
                enriched[globalIdx] = {
                  deviceId: base.deviceId,
                  deviceName: base.deviceName,
                  ...(base.deviceType !== undefined && { deviceType: base.deviceType }),
                  ...(base.connectionStatus !== undefined && { connectionStatus: base.connectionStatus }),
                  ...(base.serialNo !== undefined && { serialNo: base.serialNo }),
                  ...(base.macAddress !== undefined && { macAddress: base.macAddress }),
                  ...(base.groupId !== undefined && { groupId: base.groupId }),
                  ...(base.groupName !== undefined && { groupName: base.groupName }),
                  ...(base.groupPath !== undefined && { groupPath: base.groupPath }),
                  ...(base.currentScheduleId !== undefined && { currentScheduleId: base.currentScheduleId }),
                  ...(base.scheduleId !== undefined && { scheduleId: base.scheduleId }),
                  ...(detail['contentScheduleId'] ? { contentScheduleId: detail['contentScheduleId'] as string } : {}),
                  ...(detail['contentScheduleName'] ? { contentScheduleName: detail['contentScheduleName'] as string } : {}),
                  ...(detail['messageScheduleName'] ? { messageScheduleName: detail['messageScheduleName'] as string } : {}),
                };
              }
            }
          });
        }
        setDevices([...enriched]);
      }
    } catch (err: unknown) {
      const e = err as { message?: string };
      setReviewError(e.message ?? 'Failed to load review data');
    } finally {
      setReviewLoading(false);
    }
  }

  // ── Step 3: Load full lists per tab ───────────────────────────────────────

  async function loadTab(tab: 'content' | 'playlists' | 'schedules') {
    if (listLoaded[tab]) return;
    setListLoading(true);
    try {
      if (tab === 'content') {
        const pages: MiContent[] = [];
        let startIndex = 1;
        while (true) {
          const data = await miProxy(`/restapi/v2.0/cms/contents?pageSize=200&startIndex=${startIndex}`);
          const items = unwrapItems(data) as MiContent[];
          pages.push(...items);
          const total = unwrapTotal(data);
          if (pages.length >= total || items.length === 0) break;
          startIndex += 200;
        }
        setContentList(pages);
        setListLoaded(prev => ({ ...prev, content: true }));
      } else if (tab === 'playlists') {
        const pages: MiPlaylist[] = [];
        let startIndex = 1;
        while (true) {
          const data = await miProxy(`/restapi/v2.0/cms/playlists?pageSize=200&startIndex=${startIndex}`);
          const items = unwrapItems(data) as MiPlaylist[];
          pages.push(...items);
          const total = unwrapTotal(data);
          if (pages.length >= total || items.length === 0) break;
          startIndex += 200;
        }
        setPlaylistList(pages);
        setListLoaded(prev => ({ ...prev, playlists: true }));
      } else {
        const pages: MiSchedule[] = [];
        let startIndex = 1;
        while (true) {
          const data = await miProxy(`/restapi/v1.0/dms/schedule/contents?pageSize=200&startIndex=${startIndex}`);
          // Normalize v1.0 field names (programId → scheduleId, programName → scheduleName)
          const raw = unwrapItems(data) as Record<string, unknown>[];
          const items: MiSchedule[] = raw.map(item => ({
            ...item,
            scheduleId: (item['scheduleId'] ?? item['programId'] ?? '') as string,
            scheduleName: (item['scheduleName'] ?? item['programName'] ?? '') as string,
          }));
          pages.push(...items);
          const total = unwrapTotal(data);
          if (pages.length >= total || items.length === 0) break;
          startIndex += 200;
        }
        setScheduleList(pages);
        setListLoaded(prev => ({ ...prev, schedules: true }));
      }
    } catch { /* silently handled — list will show empty */ }
    finally { setListLoading(false); }
  }

  function handleTabChange(tab: 'content' | 'playlists' | 'schedules') {
    setActiveTab(tab);
    void loadTab(tab);
  }

  // Smart-select: selecting a playlist auto-selects its content
  async function handleSelectPlaylist(playlistId: string, checked: boolean) {
    const next = new Set(selectedPlaylistIds);
    if (checked) {
      next.add(playlistId);
      // Load detail to get items
      try {
        const detail = await miProxy(`/restapi/v2.0/cms/playlists/${playlistId}`);
        const items = unwrapItems(detail) as MiPlaylistItem[];
        const contentItems2 = items.length ? items : ((detail as Record<string,unknown>)['items'] as MiPlaylistItem[] ?? []);
        const nextContent = new Set(selectedContentIds);
        for (const item of contentItems2) {
          if (item.contentId) nextContent.add(item.contentId);
        }
        setSelectedContentIds(nextContent);
      } catch { /* non-fatal */ }
    } else {
      next.delete(playlistId);
    }
    setSelectedPlaylistIds(next);
  }

  // Smart-select: selecting a schedule auto-selects its playlists (and their content)
  async function handleSelectSchedule(scheduleId: string, checked: boolean) {
    const next = new Set(selectedScheduleIds);
    if (checked) {
      next.add(scheduleId);
      try {
        const detail = await miProxy(`/restapi/v2.0/dms/content-schedules/${scheduleId}`);
        const channels = extractScheduleChannels(detail);
        for (const ch of channels) {
          if (ch.playlistId) {
            await handleSelectPlaylist(ch.playlistId, true);
          }
        }
      } catch { /* non-fatal */ }
    } else {
      next.delete(scheduleId);
    }
    setSelectedScheduleIds(next);
  }

  function handleSelectAllContent(checked: boolean) {
    if (checked) {
      setSelectedContentIds(new Set(contentList.map(c => c.contentId)));
    } else {
      setSelectedContentIds(new Set());
    }
  }

  function handleSelectAllPlaylists(checked: boolean) {
    const migratableIds = playlistList
      .filter(p => MIGRATABLE_PLAYLIST_TYPES.has(p.playlistType as string))
      .map(p => p.playlistId);
    if (checked) {
      setSelectedPlaylistIds(new Set(migratableIds));
    } else {
      setSelectedPlaylistIds(new Set());
    }
  }

  function handleSelectAllSchedules(checked: boolean) {
    if (checked) {
      setSelectedScheduleIds(new Set(scheduleList.map(s => s.scheduleId)));
    } else {
      setSelectedScheduleIds(new Set());
    }
  }

  // ── Step 4: Migrate ───────────────────────────────────────────────────────

  function appendLog(entry: LogEntry) {
    setLog(prev => [...prev, entry]);
    setTimeout(() => {
      logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' });
    }, 50);
  }

  function updateLog(miId: string, updates: Partial<LogEntry>) {
    setLog(prev => prev.map(e => e.miId === miId ? { ...e, ...updates } : e));
  }

  async function runMigration() {
    if (!wsId) return;
    setMigrating(true);
    stopRef.current = false;
    setStopped(false);

    const contentIdMap = new Map<string, string>(); // miContentId → nexariContentId
    const playlistIdMap = new Map<string, string>(); // miPlaylistId → nexariPlaylistId
    let successContent = 0, successPlaylist = 0, successSchedule = 0, failed = 0;

    // ── Pre-step: collect all tag names ────────────────────────────────────
    const allTagNames = new Set<string>();
    const selectedContent = contentList.filter(c => selectedContentIds.has(c.contentId));
    const selectedPlaylists = playlistList.filter(p => selectedPlaylistIds.has(p.playlistId));
    const selectedSchedules = scheduleList.filter(s => selectedScheduleIds.has(s.scheduleId));

    for (const c of selectedContent) (c.tags ?? []).forEach(t => allTagNames.add(t));
    for (const p of selectedPlaylists) (p.tags ?? []).forEach(t => allTagNames.add(t));
    for (const s of selectedSchedules) (s.tags ?? []).forEach(t => allTagNames.add(t));

    let tagMap: Record<string, string> = {};
    if (allTagNames.size > 0) {
      try {
        const res = await api.post<{ tagMap: Record<string, string> }>('/migration/magicinfo/ensure-tags', {
          workspaceId: wsId,
          categoryName: 'MagicInfo',
          tagNames: [...allTagNames],
        });
        tagMap = res.tagMap;
      } catch { /* non-fatal — continue without tags */ }
    }

    async function assignTags(entityId: string, entityType: 'content' | 'playlist' | 'schedule', tagNames: string[]) {
      const tagIds = tagNames.map(n => tagMap[n]).filter(Boolean) as string[];
      if (tagIds.length === 0) return;
      try {
        await api.post('/migration/magicinfo/assign-tags', { workspaceId: wsId, entityId, entityType, tagIds });
      } catch { /* non-fatal */ }
    }

    // ── Batch 1: Content ──────────────────────────────────────────────────
    for (const content of selectedContent) {
      if (stopRef.current) break;

      appendLog({ type: 'content', miId: content.contentId, name: content.contentName, status: 'pending' });

      try {
        const mediaType = (content.mediaType ?? content.contentType ?? '').toUpperCase();
        const mainFileName = content.mainFileName ?? content.contentName;
        const mainFileId = content.mainFileId ?? content.contentId;

        const mimeMap: Record<string, string> = {
          IMAGE: 'image/jpeg', VIDEO: 'video/mp4', PDF: 'application/pdf',
          PRESENTATION: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          SAPP: 'application/zip', LFD: 'application/zip',
        };
        const mimeType = mimeMap[mediaType] ?? 'application/octet-stream';

        const res = await api.post<{ nexariContentId: string; conflict?: boolean }>('/migration/magicinfo/download-and-upload', {
          baseUrl, token: miToken,
          miContentId: content.contentId,
          mainFileId,
          mainFileName,
          mimeType,
          workspaceId: wsId,
        });

        contentIdMap.set(content.contentId, res.nexariContentId);
        await assignTags(res.nexariContentId, 'content', content.tags ?? []);

        if (res.conflict) {
          updateLog(content.contentId, { status: 'skipped', message: 'Already exists in this workspace (duplicate file)', nexariId: res.nexariContentId });
        } else {
          updateLog(content.contentId, { status: 'ok', nexariId: res.nexariContentId });
          successContent++;
        }
      } catch (err: unknown) {
        const e = err as { message?: string };
        let errMsg = e.message ?? 'Upload failed';
        try { errMsg = (JSON.parse(errMsg) as { error?: string }).error ?? errMsg; } catch { /* use as-is */ }
        updateLog(content.contentId, { status: 'error', message: errMsg });
        failed++;
      }
    }

    // ── Batch 2: Playlists ────────────────────────────────────────────────
    for (const pl of selectedPlaylists) {
      if (stopRef.current) break;

      appendLog({ type: 'playlist', miId: pl.playlistId, name: pl.playlistName, status: 'pending' });

      try {
        // Fetch full detail for items
        let items: MiPlaylistItem[] = pl.items ?? [];
        if (items.length === 0) {
          try {
            const detail = await miProxy(`/restapi/v2.0/cms/playlists/${pl.playlistId}`) as Record<string, unknown>;
            // Handle multiple possible response shapes (MagicInfo API varies by version)
            const inner = (Array.isArray(detail['items']) ? detail : ((detail['items'] as Record<string, unknown>) ?? detail)) as Record<string, unknown>;
            const candidates: unknown[] =
              Array.isArray(detail['items'])         ? (detail['items'] as unknown[]) :
              Array.isArray(inner['items'])           ? (inner['items'] as unknown[]) :
              Array.isArray(inner['contents'])        ? (inner['contents'] as unknown[]) :
              Array.isArray(inner['contentsIdList'])  ? (inner['contentsIdList'] as unknown[]) :
              Array.isArray(inner['contentsList'])    ? (inner['contentsList'] as unknown[]) :
              Array.isArray(inner['list'])            ? (inner['list'] as unknown[]) : [];
            items = (candidates as Record<string, unknown>[]).map((it, i) => {
              const durSec = it['contentDuration'] != null
                ? Number(it['contentDuration'])
                : it['contentDurationMilli'] != null
                  ? Math.round(Number(it['contentDurationMilli']) / 1000)
                  : it['duration'] != null ? Number(it['duration']) : 10;
              const item: MiPlaylistItem = {
                contentId: String(it['contentId'] ?? it['id'] ?? ''),
                duration: Math.max(1, durSec),
                order: Number(it['contentOrder'] ?? it['order'] ?? i),
                ...(it['contentName'] ? { contentName: String(it['contentName']) } : {}),
              };
              return item;
            }).filter(it => !!it.contentId);
          } catch { /* use empty */ }
        }

        const created = await api.post<{ id: string }>('/playlists', {
          name: pl.playlistName,
          workspaceId: wsId,
        });

        // Map items — only include those whose content was successfully uploaded
        const nexariItems = items
          .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
          .map(item => ({
            contentId: contentIdMap.get(item.contentId),
            duration: item.duration || 10,
          }))
          .filter(item => !!item.contentId);

        if (nexariItems.length > 0) {
          await api.put(`/playlists/${created.id}/items`, nexariItems);
        }

        playlistIdMap.set(pl.playlistId, created.id);
        await assignTags(created.id, 'playlist', pl.tags ?? []);
        updateLog(pl.playlistId, { status: 'ok', nexariId: created.id });
        successPlaylist++;
      } catch (err: unknown) {
        const e = err as { message?: string; data?: { error?: string } };
        updateLog(pl.playlistId, { status: 'error', message: e.data?.error ?? e.message ?? 'Failed to create playlist' });
        failed++;
      }
    }

    // ── Batch 3: Schedules ────────────────────────────────────────────────
    for (const sched of selectedSchedules) {
      if (stopRef.current) break;

      appendLog({ type: 'schedule', miId: sched.scheduleId, name: sched.scheduleName, status: 'pending' });

      try {
        // Fetch full detail for time channels via v2.0 content-schedules endpoint
        let timeChannels: MiTimeChannel[] = sched.timeChannels ?? [];
        if (timeChannels.length === 0) {
          try {
            const detail = await miProxy(`/restapi/v2.0/dms/content-schedules/${sched.scheduleId}`);
            timeChannels = extractScheduleChannels(detail);
          } catch { /* use empty */ }
        }

        const created = await api.post<{ id: string }>('/schedules', {
          name: sched.scheduleName,
          workspaceId: wsId,
        });

        // Map time channels → slots
        const slots = timeChannels.map(ch => {
          const nexariPlaylistId = ch.playlistId ? playlistIdMap.get(ch.playlistId) : undefined;
          const nexariContentId = ch.contentId ? contentIdMap.get(ch.contentId) : undefined;
          return mapTimeChannel(ch, nexariPlaylistId, nexariContentId);
        }).filter(s => s.playlistId || s.contentId);

        if (slots.length > 0) {
          await api.put(`/schedules/${created.id}/slots`, slots);
        }

        await assignTags(created.id, 'schedule', sched.tags ?? []);
        updateLog(sched.scheduleId, { status: 'ok', nexariId: created.id });
        successSchedule++;
      } catch (err: unknown) {
        const e = err as { message?: string; data?: { error?: string } };
        updateLog(sched.scheduleId, { status: 'error', message: e.data?.error ?? e.message ?? 'Failed to create schedule' });
        failed++;
      }
    }

    setSummary({ content: successContent, playlist: successPlaylist, schedule: successSchedule, failed });
    setMigrating(false);
    if (!stopRef.current) setStep(5);
  }

  // ── Device table helpers ──────────────────────────────────────────────────

  const devicesByGroup = devices.reduce<Record<string, MiDevice[]>>((acc, d) => {
    const group = d.groupName || 'Ungrouped';
    if (!acc[group]) acc[group] = [];
    acc[group].push(d);
    return acc;
  }, {});

  async function toggleScheduleItems(scheduleId: string) {
    if (expandedScheduleIds.has(scheduleId)) {
      setExpandedScheduleIds(prev => { const s = new Set(prev); s.delete(scheduleId); return s; });
      return;
    }
    setExpandedScheduleIds(prev => new Set([...prev, scheduleId]));
    if (deviceScheduleItems[scheduleId]) return; // already loaded
    setScheduleItemsLoading(prev => new Set([...prev, scheduleId]));
    try {
      const [contentData, playlistData] = await Promise.allSettled([
        miProxy(`/restapi/v2.0/cms/contents?scheduleId=${encodeURIComponent(scheduleId)}&pageSize=200&startIndex=1`),
        miProxy(`/restapi/v2.0/cms/playlists?scheduleId=${encodeURIComponent(scheduleId)}&pageSize=200&startIndex=1`),
      ]);
      const content = contentData.status === 'fulfilled' ? (unwrapItems(contentData.value) as MiContent[]) : [];
      const playlists = playlistData.status === 'fulfilled' ? (unwrapItems(playlistData.value) as MiPlaylist[]) : [];
      setDeviceScheduleItems(prev => ({ ...prev, [scheduleId]: { content, playlists } }));
    } catch { /* non-fatal */ } finally {
      setScheduleItemsLoading(prev => { const s = new Set(prev); s.delete(scheduleId); return s; });
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const totalSelected = selectedContentIds.size + selectedPlaylistIds.size + selectedScheduleIds.size;

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <PageHeader
        icon={<ArrowDownToLine className="w-5 h-5" />}
        title="Migrate from MagicInfo"
        subtitle="Import your content, playlists and schedules into this workspace"
      />

      <StepIndicator step={step} current={step} />

      {/* ── Step 1: Connect ─────────────────────────────────────────────── */}
      {step === 1 && (
        <SectionCard>
          <SectionCardHeader className="text-base font-semibold">Connect to MagicInfo Server</SectionCardHeader>
          <SectionCardBody className="space-y-4 max-w-lg">
            <Callout tone="accent" icon={<Info className="w-4 h-4" />}>
              Use a MagicInfo <strong>admin-level account</strong>. Non-admin accounts may not have permission to download content files.
            </Callout>

            <div>
              <label className="block text-sm font-medium text-[var(--text)] mb-1">MagicInfo Server URL</label>
              <input
                type="url"
                value={baseUrl}
                onChange={e => setBaseUrl(e.target.value)}
                placeholder="https://your-server:7002/MagicInfo"
                className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--blue)]"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-[var(--text)] mb-1">Username</label>
                <input
                  type="text"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  autoComplete="username"
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--blue)]"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--text)] mb-1">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  autoComplete="current-password"
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--blue)]"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-[var(--text)] mb-1">
                2FA Code <span className="text-[var(--text-muted)] font-normal">(optional — 6-digit code from your authenticator app)</span>
              </label>
              <input
                type="text"
                inputMode="numeric"
                value={totpCode}
                onChange={e => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="123456"
                className="w-32 px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--blue)]"
              />
            </div>

            {connectError && (
              <Callout tone="danger" icon={<XCircle className="w-4 h-4" />}>
                {connectError}
              </Callout>
            )}

            <button
              onClick={handleConnect}
              disabled={connecting}
              className="flex items-center gap-2 px-4 py-2 bg-[var(--blue)] text-white rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              {connecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
              {connecting ? 'Connecting…' : 'Connect'}
            </button>
          </SectionCardBody>
        </SectionCard>
      )}

      {/* ── Step 2: Review ──────────────────────────────────────────────── */}
      {step === 2 && (
        <div className="space-y-6">
          {reviewError && (
            <Callout tone="danger" icon={<XCircle className="w-4 h-4" />}>{reviewError}</Callout>
          )}

          {/* Summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Devices', value: devices.length, icon: <Monitor className="w-5 h-5 text-[var(--blue)]" /> },
              { label: 'Content', value: contentTotal, icon: <Image className="w-5 h-5 text-purple-400" /> },
              { label: 'Playlists', value: playlistTotal, icon: <Layers className="w-5 h-5 text-green-400" /> },
              { label: 'Schedules', value: scheduleTotal, icon: <CalendarDays className="w-5 h-5 text-orange-400" /> },
            ].map(card => (
              <SectionCard key={card.label}>
                <SectionCardBody className="flex items-center gap-3 py-3">
                  {card.icon}
                  <div>
                    <p className="text-2xl font-bold text-[var(--text)]">
                      {reviewLoading ? <Skeleton className="w-8 h-6" /> : (card.value ?? '—')}
                    </p>
                    <p className="text-xs text-[var(--text-muted)]">{card.label}</p>
                  </div>
                </SectionCardBody>
              </SectionCard>
            ))}
          </div>

          {/* Device table — only shown when devices are present */}
          {(reviewLoading || devices.length > 0) && (
          <SectionCard>
            <SectionCardHeader className="text-sm font-semibold">Devices &amp; Group Hierarchy</SectionCardHeader>
            <SectionCardBody className="p-0">
              {reviewLoading ? (
                <div className="p-4 space-y-2">
                  {[1, 2, 3].map(i => <Skeleton key={i} className="h-8 w-full" />)}
                </div>
              ) : devices.length === 0 ? (
                <EmptyState icon={<Monitor className="w-8 h-8" />} title="No devices found" />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[var(--border)] bg-[var(--surface)]">
                        <th className="text-left px-3 py-2 text-xs font-semibold text-[var(--text-muted)]">Group Path</th>
                        <th className="text-left px-3 py-2 text-xs font-semibold text-[var(--text-muted)]">Device Name</th>
                        <th className="text-left px-3 py-2 text-xs font-semibold text-[var(--text-muted)]">Type</th>
                        <th className="text-left px-3 py-2 text-xs font-semibold text-[var(--text-muted)]">Status</th>
                        <th className="text-left px-3 py-2 text-xs font-semibold text-[var(--text-muted)]">Serial</th>
                        <th className="text-left px-3 py-2 text-xs font-semibold text-[var(--text-muted)]">Content Schedule</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(devicesByGroup).map(([group, groupDevices]) => (
                        <>
                          <tr key={`group-${group}`} className="bg-[var(--surface)] border-b border-[var(--border)]">
                            <td colSpan={6} className="px-3 py-1.5 text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">
                              {group}
                            </td>
                          </tr>
                          {groupDevices.map(d => {
                            const breadcrumb = parseGroupPath(d.groupPath, d.groupName);
                            const schedId = d.contentScheduleId;
                            const schedName = d.contentScheduleName;
                            const isExpanded = schedId ? expandedScheduleIds.has(schedId) : false;
                            const isLoadingItems = schedId ? scheduleItemsLoading.has(schedId) : false;
                            const schedData = schedId ? (deviceScheduleItems[schedId] ?? null) : null;
                            const schedItems = schedData?.content ?? null;
                            const schedPlaylists = schedData?.playlists ?? null;
                            return (
                              <>
                              <tr key={d.deviceId} className="border-b border-[var(--border)] hover:bg-[var(--surface)]">
                                <td className="px-3 py-2">
                                  <div className="flex items-center gap-1 flex-wrap">
                                    {breadcrumb.map((seg, i) => (
                                      <span key={i} className="flex items-center gap-1">
                                        {i > 0 && <ChevronRight className="w-3 h-3 text-[var(--text-muted)]" />}
                                        <Badge tone="neutral">{seg}</Badge>
                                      </span>
                                    ))}
                                  </div>
                                </td>
                                <td className="px-3 py-2 text-[var(--text)]">{d.deviceName}</td>
                                <td className="px-3 py-2 text-[var(--text-muted)]">{d.deviceType ?? '—'}</td>
                                <td className="px-3 py-2">
                                  <Badge tone={d.connectionStatus === 'CONNECTED' || d.connectionStatus === 'Online' ? 'success' : 'neutral'}>
                                    {d.connectionStatus ?? '—'}
                                  </Badge>
                                </td>
                                <td className="px-3 py-2 text-xs text-[var(--text-muted)] font-mono">{d.serialNo ?? d.macAddress ?? '—'}</td>
                                <td className="px-3 py-2 text-xs">
                                  {schedName ? (
                                    <button
                                      onClick={() => schedId && void toggleScheduleItems(schedId)}
                                      className="flex items-center gap-1 text-left text-[var(--blue)] hover:underline"
                                    >
                                      <ChevronRight className={`w-3 h-3 flex-shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                                      <span className="truncate max-w-[200px]">{schedName}</span>
                                    </button>
                                  ) : (
                                    <span className="text-[var(--text-muted)]">
                                      {reviewLoading ? <Skeleton className="h-3 w-24 inline-block" /> : (d.currentScheduleId ?? d.scheduleId ?? '—')}
                                    </span>
                                  )}
                                </td>
                              </tr>
                              {isExpanded && schedId && (
                                <tr key={`${d.deviceId}-sched-items`} className="border-b border-[var(--border)] bg-[var(--surface)]">
                                  <td colSpan={6} className="px-6 py-3">
                                    {isLoadingItems ? (
                                      <div className="space-y-1">{[1,2,3].map(i => <Skeleton key={i} className="h-4 w-full" />)}</div>
                                    ) : (schedPlaylists && schedPlaylists.length > 0) || (schedItems && schedItems.length > 0) ? (
                                      <div className="space-y-3">
                                        {schedPlaylists && schedPlaylists.length > 0 && (
                                          <div>
                                            <p className="text-xs font-semibold text-[var(--text-muted)] mb-2 uppercase tracking-wide">
                                              Playlists in this schedule ({schedPlaylists.length})
                                            </p>
                                            <div className="space-y-1 max-h-40 overflow-y-auto">
                                              {schedPlaylists.map(p => (
                                                <div key={p.playlistId} className="flex items-center gap-2 text-xs text-[var(--text)]">
                                                  <Badge tone="accent" className="flex-shrink-0">PLAYLIST</Badge>
                                                  <span className="truncate">{p.playlistName}</span>
                                                  {p.itemCount != null && (
                                                    <span className="text-[var(--text-muted)] flex-shrink-0">{p.itemCount} items</span>
                                                  )}
                                                </div>
                                              ))}
                                            </div>
                                          </div>
                                        )}
                                        {schedItems && schedItems.length > 0 && (
                                          <div>
                                            <p className="text-xs font-semibold text-[var(--text-muted)] mb-2 uppercase tracking-wide">
                                              Content in this schedule ({schedItems.length})
                                            </p>
                                            <div className="space-y-1 max-h-40 overflow-y-auto">
                                              {schedItems.map(c => (
                                                <div key={c.contentId} className="flex items-center gap-2 text-xs text-[var(--text)]">
                                                  <Badge tone="neutral" className="flex-shrink-0">{c.mediaType ?? c.contentType ?? '?'}</Badge>
                                                  <span className="truncate">{c.contentName}</span>
                                                  {(c.totalSize ?? c.fileSize) ? (
                                                    <span className="text-[var(--text-muted)] flex-shrink-0">
                                                      {((c.totalSize ?? c.fileSize ?? 0) / 1_048_576).toFixed(1)} MB
                                                    </span>
                                                  ) : null}
                                                </div>
                                              ))}
                                            </div>
                                          </div>
                                        )}
                                      </div>
                                    ) : (
                                      <p className="text-xs text-[var(--text-muted)]">No content or playlists found for this schedule.</p>
                                    )}
                                  </td>
                                </tr>
                              )}
                              </>
                            );
                          })}
                        </>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </SectionCardBody>
          </SectionCard>
          )}

          <div className="flex justify-between">
            <button onClick={() => setStep(1)} className="flex items-center gap-2 px-4 py-2 border border-[var(--border)] rounded-lg text-sm text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface)]">
              <ArrowLeft className="w-4 h-4" /> Back
            </button>
            <button
              onClick={() => { setStep(3); void loadTab('content'); }}
              className="flex items-center gap-2 px-4 py-2 bg-[var(--blue)] text-white rounded-lg text-sm font-medium hover:opacity-90"
            >
              Select items to migrate <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* ── Step 3: Select ──────────────────────────────────────────────── */}
      {step === 3 && (
        <div className="space-y-4">
          <Callout tone="accent" icon={<Info className="w-4 h-4" />}>
            Selecting a schedule auto-selects its playlists. Selecting a playlist auto-selects its content items.
            Only <strong>GENERAL</strong> playlists can be migrated in Phase 1.
          </Callout>

          {/* Tabs */}
          <div className="flex border-b border-[var(--border)]">
            {(['content', 'playlists', 'schedules'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => handleTabChange(tab)}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors capitalize ${
                  activeTab === tab
                    ? 'border-[var(--blue)] text-[var(--blue)]'
                    : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text)]'
                }`}
              >
                {tab}
                {tab === 'content' && selectedContentIds.size > 0 && (
                  <span className="ml-1.5 bg-[var(--blue)] text-white text-[10px] px-1.5 py-0.5 rounded-full">{selectedContentIds.size}</span>
                )}
                {tab === 'playlists' && selectedPlaylistIds.size > 0 && (
                  <span className="ml-1.5 bg-[var(--blue)] text-white text-[10px] px-1.5 py-0.5 rounded-full">{selectedPlaylistIds.size}</span>
                )}
                {tab === 'schedules' && selectedScheduleIds.size > 0 && (
                  <span className="ml-1.5 bg-[var(--blue)] text-white text-[10px] px-1.5 py-0.5 rounded-full">{selectedScheduleIds.size}</span>
                )}
              </button>
            ))}
          </div>

          <SectionCard>
            <SectionCardBody className="p-0">
              {listLoading && (
                <div className="p-4 space-y-2">{[1,2,3,4,5].map(i => <Skeleton key={i} className="h-10 w-full" />)}</div>
              )}

              {/* Content tab */}
              {activeTab === 'content' && !listLoading && (
                <>
                  <div className="flex items-center gap-3 px-3 py-2 border-b border-[var(--border)]">
                    <input type="checkbox"
                      checked={contentList.length > 0 && selectedContentIds.size === contentList.length}
                      onChange={e => handleSelectAllContent(e.target.checked)}
                      className="rounded"
                    />
                    <input
                      type="text" placeholder="Search content…" value={contentSearch}
                      onChange={e => setContentSearch(e.target.value)}
                      className="flex-1 px-2 py-1 text-sm bg-transparent border border-[var(--border)] rounded focus:outline-none focus:ring-1 focus:ring-[var(--blue)]"
                    />
                    <span className="text-xs text-[var(--text-muted)]">{contentList.length} items</span>
                  </div>
                  <div className="divide-y divide-[var(--border)] max-h-80 overflow-y-auto">
                    {contentList
                      .filter(c => !contentSearch || c.contentName.toLowerCase().includes(contentSearch.toLowerCase()))
                      .map(c => (
                        <label key={c.contentId} className="flex items-center gap-3 px-3 py-2 hover:bg-[var(--surface)] cursor-pointer">
                          <input
                            type="checkbox"
                            checked={selectedContentIds.has(c.contentId)}
                            onChange={e => {
                              const next = new Set(selectedContentIds);
                              e.target.checked ? next.add(c.contentId) : next.delete(c.contentId);
                              setSelectedContentIds(next);
                            }}
                            className="rounded"
                          />
                          {contentTypeIcon(c.mediaType ?? c.contentType ?? '')}
                          <span className="flex-1 text-sm text-[var(--text)] truncate">{c.contentName}</span>
                          <Badge tone="neutral">{c.mediaType ?? c.contentType}</Badge>
                          <span className="text-xs text-[var(--text-muted)]">{formatBytes(c.totalSize ?? c.fileSize)}</span>
                        </label>
                      ))}
                    {contentList.length === 0 && !listLoading && (
                      <EmptyState icon={<Image className="w-8 h-8" />} title="No content found" className="py-6" />
                    )}
                  </div>
                </>
              )}

              {/* Playlists tab */}
              {activeTab === 'playlists' && !listLoading && (
                <>
                  <div className="flex items-center gap-3 px-3 py-2 border-b border-[var(--border)]">
                    <input type="checkbox"
                      checked={playlistList.filter(p => MIGRATABLE_PLAYLIST_TYPES.has(p.playlistType as string)).length > 0 &&
                        playlistList.filter(p => MIGRATABLE_PLAYLIST_TYPES.has(p.playlistType as string)).every(p => selectedPlaylistIds.has(p.playlistId))}
                      onChange={e => handleSelectAllPlaylists(e.target.checked)}
                      className="rounded"
                    />
                    <input
                      type="text" placeholder="Search playlists…" value={playlistSearch}
                      onChange={e => setPlaylistSearch(e.target.value)}
                      className="flex-1 px-2 py-1 text-sm bg-transparent border border-[var(--border)] rounded focus:outline-none focus:ring-1 focus:ring-[var(--blue)]"
                    />
                    <span className="text-xs text-[var(--text-muted)]">{playlistList.length} items</span>
                  </div>
                  <div className="divide-y divide-[var(--border)] max-h-80 overflow-y-auto">
                    {playlistList
                      .filter(p => !playlistSearch || p.playlistName.toLowerCase().includes(playlistSearch.toLowerCase()))
                      .map(p => {
                        const migratable = MIGRATABLE_PLAYLIST_TYPES.has(p.playlistType as string);
                        const typeLabel = p.playlistType ? PLAYLIST_TYPE_LABELS[p.playlistType] ?? p.playlistType : 'General';
                        return (
                          <label key={p.playlistId} className={`flex items-center gap-3 px-3 py-2 hover:bg-[var(--surface)] ${migratable ? 'cursor-pointer' : 'opacity-60 cursor-not-allowed'}`}>
                            <input
                              type="checkbox"
                              disabled={!migratable}
                              checked={selectedPlaylistIds.has(p.playlistId)}
                              onChange={e => void handleSelectPlaylist(p.playlistId, e.target.checked)}
                              className="rounded"
                            />
                            <Layers className="w-4 h-4 text-green-400 shrink-0" />
                            <span className="flex-1 text-sm text-[var(--text)] truncate">{p.playlistName}</span>
                            <Badge tone={migratable ? 'success' : 'warning'}>{typeLabel}</Badge>
                            <span className="text-xs text-[var(--text-muted)]">{p.itemCount ?? 0} items · {formatDuration(p.totalDuration)}</span>
                          </label>
                        );
                      })}
                    {playlistList.length === 0 && !listLoading && (
                      <EmptyState icon={<Layers className="w-8 h-8" />} title="No playlists found" className="py-6" />
                    )}
                  </div>
                </>
              )}

              {/* Schedules tab */}
              {activeTab === 'schedules' && !listLoading && (
                <>
                  <div className="flex items-center gap-3 px-3 py-2 border-b border-[var(--border)]">
                    <input type="checkbox"
                      checked={scheduleList.length > 0 && scheduleList.every(s => selectedScheduleIds.has(s.scheduleId))}
                      onChange={e => void handleSelectAllSchedules(e.target.checked)}
                      className="rounded"
                    />
                    <input
                      type="text" placeholder="Search schedules…" value={scheduleSearch}
                      onChange={e => setScheduleSearch(e.target.value)}
                      className="flex-1 px-2 py-1 text-sm bg-transparent border border-[var(--border)] rounded focus:outline-none focus:ring-1 focus:ring-[var(--blue)]"
                    />
                    <span className="text-xs text-[var(--text-muted)]">{scheduleList.length} items</span>
                  </div>
                  <div className="divide-y divide-[var(--border)] max-h-80 overflow-y-auto">
                    {scheduleList
                      .filter(s => !scheduleSearch || s.scheduleName.toLowerCase().includes(scheduleSearch.toLowerCase()))
                      .map(s => (
                        <label key={s.scheduleId} className="flex items-center gap-3 px-3 py-2 hover:bg-[var(--surface)] cursor-pointer">
                          <input
                            type="checkbox"
                            checked={selectedScheduleIds.has(s.scheduleId)}
                            onChange={e => void handleSelectSchedule(s.scheduleId, e.target.checked)}
                            className="rounded"
                          />
                          <CalendarDays className="w-4 h-4 text-orange-400 shrink-0" />
                          <span className="flex-1 text-sm text-[var(--text)] truncate">{s.scheduleName}</span>
                        </label>
                      ))}
                    {scheduleList.length === 0 && !listLoading && (
                      <EmptyState icon={<CalendarDays className="w-8 h-8" />} title="No schedules found" className="py-6" />
                    )}
                  </div>
                </>
              )}
            </SectionCardBody>
          </SectionCard>

          <div className="flex justify-between items-center">
            <button onClick={() => setStep(2)} className="flex items-center gap-2 px-4 py-2 border border-[var(--border)] rounded-lg text-sm text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface)]">
              <ArrowLeft className="w-4 h-4" /> Back
            </button>
            <div className="flex items-center gap-3">
              <span className="text-sm text-[var(--text-muted)]">{totalSelected} item{totalSelected !== 1 ? 's' : ''} selected</span>
              <button
                onClick={() => { setStep(4); void runMigration(); }}
                disabled={totalSelected === 0}
                className="flex items-center gap-2 px-4 py-2 bg-[var(--blue)] text-white rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50"
              >
                Start Migration <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Step 4: Migrate ─────────────────────────────────────────────── */}
      {step === 4 && (
        <div className="space-y-4">
          <SectionCard>
            <SectionCardHeader className="flex items-center justify-between">
              <span className="text-sm font-semibold">Migration Progress</span>
              {migrating && (
                <div className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin text-[var(--blue)]" />
                  <span className="text-xs text-[var(--text-muted)]">Running…</span>
                </div>
              )}
            </SectionCardHeader>
            <SectionCardBody>
              {/* Progress bar */}
              {totalSelected > 0 && (
                <div className="mb-4">
                  <div className="flex justify-between text-xs text-[var(--text-muted)] mb-1">
                    <span>{log.filter(e => e.status !== 'pending').length} / {totalSelected} processed</span>
                    <span>{log.filter(e => e.status === 'error').length} errors</span>
                  </div>
                  <div className="h-2 rounded-full bg-[var(--surface)] overflow-hidden">
                    <div
                      className="h-full bg-[var(--blue)] transition-all duration-300"
                      style={{ width: `${(log.filter(e => e.status !== 'pending').length / totalSelected) * 100}%` }}
                    />
                  </div>
                </div>
              )}

              <div ref={logRef} className="max-h-96 overflow-y-auto">
                {log.length === 0 && (
                  <div className="py-8 text-center text-sm text-[var(--text-muted)]">
                    <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2 text-[var(--blue)]" />
                    Preparing migration…
                  </div>
                )}
                {log.map((entry, i) => <LogRow key={`${entry.miId}-${i}`} entry={entry} />)}
              </div>

              {migrating && (
                <div className="mt-3 pt-3 border-t border-[var(--border)]">
                  <button
                    onClick={() => { stopRef.current = true; setStopped(true); }}
                    disabled={stopped}
                    className="px-3 py-1.5 text-sm border border-[var(--border)] rounded text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface)] disabled:opacity-50"
                  >
                    {stopped ? 'Stopping after current item…' : 'Stop'}
                  </button>
                </div>
              )}
            </SectionCardBody>
          </SectionCard>
        </div>
      )}

      {/* ── Step 5: Done ────────────────────────────────────────────────── */}
      {step === 5 && (
        <div className="space-y-6">
          <SectionCard>
            <SectionCardBody className="py-6 text-center">
              <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-3" />
              <h2 className="text-xl font-bold text-[var(--text)] mb-1">Migration Complete</h2>
              <p className="text-sm text-[var(--text-muted)]">
                {summary.content} content items · {summary.playlist} playlists · {summary.schedule} schedules migrated
                {summary.failed > 0 && ` · ${summary.failed} failed`}
              </p>
            </SectionCardBody>
          </SectionCard>

          {/* Failed items */}
          {log.filter(e => e.status === 'error').length > 0 && (
            <SectionCard>
              <SectionCardHeader className="text-sm font-semibold text-red-500">
                Failed Items ({log.filter(e => e.status === 'error').length})
              </SectionCardHeader>
              <SectionCardBody className="divide-y divide-[var(--border)]">
                {log.filter(e => e.status === 'error').map((e, i) => (
                  <div key={i} className="py-2">
                    <p className="text-sm text-[var(--text)]">{e.name}</p>
                    <p className="text-xs text-[var(--text-muted)]">{e.message}</p>
                  </div>
                ))}
              </SectionCardBody>
            </SectionCard>
          )}

          <div className="flex flex-wrap gap-3">
            <ActionButton onClick={() => navigate(`/workspaces/${wsId}/content`)}>
              View Content →
            </ActionButton>
            <ActionButton onClick={() => navigate(`/workspaces/${wsId}/playlist`)}>
              View Playlists →
            </ActionButton>
            <ActionButton onClick={() => navigate(`/workspaces/${wsId}/schedule`)}>
              View Schedules →
            </ActionButton>
            <ActionButton
              onClick={() => {
                setStep(1);
                setLog([]);
                setSelectedContentIds(new Set());
                setSelectedPlaylistIds(new Set());
                setSelectedScheduleIds(new Set());
                setListLoaded({ content: false, playlists: false, schedules: false });
                setMiToken('');
              }}
            >
              Migrate More
            </ActionButton>
          </div>
        </div>
      )}
    </div>
  );
}
