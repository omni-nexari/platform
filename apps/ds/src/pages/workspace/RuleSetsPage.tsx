import { useState, useCallback } from 'react';
import { useParams } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '../../lib/api.js';
import {
  Zap, Plus, Trash2, ChevronRight, Search, ToggleLeft, ToggleRight,
  Play, Send, Clock, Calendar, Radio, Activity, Monitor, MonitorOff,
  Layers, Volume2, Maximize2, Power, Bell, AlertTriangle, Rocket,
  RefreshCw, X, Check, ChevronDown,
  // Extended condition icons
  CloudRain, CalendarRange, Users, PauseCircle, CalendarCheck, CheckCircle2,
  PartyPopper, Sun, Server, Tag, Wifi, Webhook, Battery, Smartphone, Repeat,
  Thermometer, Droplets, ScanFace, Hand, QrCode, Nfc, Package, ShoppingCart,
  Car, Plane, AtSign, CalendarClock, Tv, MapPin,
  // Extended action icons
  SunMedium, FileText, SquareStack, BarChart3, Link as LinkIcon, Timer,
  Square, Pause, Volume1,
} from 'lucide-react';
import {
  Badge,
  EmptyState,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  ModalPrimaryButton,
  ModalSecondaryButton,
  PageHeader,
  SectionCard,
  SectionCardBody,
  SectionCardHeader,
  Skeleton,
  ToggleSwitch,
} from '../../components/UiPrimitives.js';

// ── Types ─────────────────────────────────────────────────────────────────────

type ConditionType =
  | 'ble_beacon' | 'time_window' | 'day_of_week' | 'sensor_value' | 'device_online' | 'device_offline'
  // MVP
  | 'weather' | 'date_range' | 'occupancy' | 'device_idle' | 'schedule_active' | 'content_finished'
  // Nice-to-have
  | 'holiday' | 'sun' | 'device_group_state' | 'tag_match' | 'network_speed' | 'audio_level'
  | 'webhook' | 'battery_level' | 'device_orientation' | 'recurring_cron' | 'temperature' | 'humidity'
  // Good-to-have
  | 'face_detected' | 'gesture' | 'qr_scan' | 'nfc_tap' | 'stock_level' | 'pos_sale'
  | 'traffic' | 'flight_status' | 'social_mention' | 'calendar_event' | 'stream_health' | 'geofence';

type ActionType =
  | 'play_content' | 'play_playlist' | 'play_schedule' | 'message_overlay' | 'device_control'
  | 'send_notification' | 'emergency_override' | 'launch_app'
  // MVP
  | 'set_brightness_schedule' | 'log_event' | 'webhook_call' | 'switch_zone_content'
  // Nice-to-have
  | 'record_analytics' | 'chain_rule_set' | 'delay' | 'stop_playback' | 'pause_playback' | 'fade_volume';
type TargetType = 'device' | 'group' | 'workspace';

interface ConditionLeaf { type: ConditionType; [key: string]: unknown; }
interface ConditionGroup { type: 'group'; logic: 'AND' | 'OR'; children: ConditionNode[]; }
type ConditionNode = ConditionLeaf | ConditionGroup;

interface RuleSetTarget { id: string; ruleSetId: string; targetType: TargetType; targetId: string; }
interface RuleSetAction { type: ActionType; [key: string]: unknown; }

interface RuleSet {
  id: string;
  workspaceId: string;
  name: string;
  description?: string | null;
  enabled: boolean;
  priority: number;
  conditions: ConditionGroup;
  action: RuleSetAction;
  cooldownSeconds: number;
  lastFiredAt?: string | null;
  fireCount: number;
  createdAt: string;
  updatedAt: string;
  targets: RuleSetTarget[];
}

interface DeviceItem { id: string; name: string; status: string; }
interface GroupItem  { id: string; name: string; }
interface PlaylistItem { id: string; name: string; }
interface ContentItem  { id: string; name: string; }
interface ScheduleItem { id: string; name: string; }
interface SensorItem   { id: string; name: string; unit?: string | null; }

// ── Helpers ───────────────────────────────────────────────────────────────────

const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function actionLabel(action: RuleSetAction): string {
  switch (action.type) {
    case 'play_content':           return 'Play Content';
    case 'play_playlist':          return 'Play Playlist';
    case 'play_schedule':          return 'Play Schedule';
    case 'message_overlay':        return 'Show Message Overlay';
    case 'device_control':         return `Device Control: ${action.command}`;
    case 'send_notification':      return 'Send Notification';
    case 'emergency_override':     return 'Emergency Override';
    case 'launch_app':             return `Launch App: ${action.appId}`;
    case 'set_brightness_schedule':return `Set Brightness (${action.mode})`;
    case 'log_event':              return `Log Event: ${action.eventName}`;
    case 'webhook_call':           return `Webhook: ${action.method} ${action.url}`;
    case 'switch_zone_content':    return `Switch Zone ${action.zoneId}`;
    case 'record_analytics':       return `Record Metric: ${action.metric}`;
    case 'chain_rule_set':         return 'Chain Rule Set';
    case 'delay':                  return `Delay ${action.seconds}s`;
    case 'stop_playback':          return 'Stop Playback';
    case 'pause_playback':         return 'Pause Playback';
    case 'fade_volume':            return `Fade Volume → ${action.targetVolume}`;
    default:                       return action.type;
  }
}

function ActionIcon({ type }: { type: ActionType }) {
  switch (type) {
    case 'play_content':
    case 'play_playlist':           return <Play className="w-3.5 h-3.5" />;
    case 'play_schedule':           return <Calendar className="w-3.5 h-3.5" />;
    case 'message_overlay':         return <Maximize2 className="w-3.5 h-3.5" />;
    case 'device_control':          return <Volume2 className="w-3.5 h-3.5" />;
    case 'send_notification':       return <Bell className="w-3.5 h-3.5" />;
    case 'emergency_override':      return <AlertTriangle className="w-3.5 h-3.5" />;
    case 'launch_app':              return <Rocket className="w-3.5 h-3.5" />;
    case 'set_brightness_schedule': return <SunMedium className="w-3.5 h-3.5" />;
    case 'log_event':               return <FileText className="w-3.5 h-3.5" />;
    case 'webhook_call':            return <Webhook className="w-3.5 h-3.5" />;
    case 'switch_zone_content':     return <SquareStack className="w-3.5 h-3.5" />;
    case 'record_analytics':        return <BarChart3 className="w-3.5 h-3.5" />;
    case 'chain_rule_set':          return <LinkIcon className="w-3.5 h-3.5" />;
    case 'delay':                   return <Timer className="w-3.5 h-3.5" />;
    case 'stop_playback':           return <Square className="w-3.5 h-3.5" />;
    case 'pause_playback':          return <Pause className="w-3.5 h-3.5" />;
    case 'fade_volume':             return <Volume1 className="w-3.5 h-3.5" />;
    default:                        return <Zap className="w-3.5 h-3.5" />;
  }
}

function conditionSummary(cond: ConditionGroup): string {
  const count = cond.children.length;
  return `${cond.logic} group · ${count} condition${count !== 1 ? 's' : ''}`;
}

function formatRelative(iso: string | null | undefined): string {
  if (!iso) return 'Never';
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60)  return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

// ── Blank condition group ─────────────────────────────────────────────────────

function blankGroup(): ConditionGroup {
  return { type: 'group', logic: 'AND', children: [] };
}

function blankLeaf(type: ConditionType): ConditionLeaf {
  switch (type) {
    case 'ble_beacon':           return { type, uuid: '', rssiThreshold: -75 };
    case 'time_window':          return { type, start: '08:00', end: '17:00' };
    case 'day_of_week':          return { type, days: [1, 2, 3, 4, 5] };
    case 'sensor_value':         return { type, sensorId: '', field: 'value', operator: '>', value: 0 };
    case 'device_online':        return { type };
    case 'device_offline':       return { type };
    // MVP
    case 'weather':              return { type, field: 'temperature_c', operator: '>', value: 25 };
    case 'date_range':           return { type, start: new Date().toISOString().slice(0,10), end: new Date().toISOString().slice(0,10) };
    case 'occupancy':            return { type, operator: '>=', count: 1 };
    case 'device_idle':          return { type, idleSeconds: 300 };
    case 'schedule_active':      return { type, scheduleId: '' };
    case 'content_finished':     return { type };
    // Nice-to-have
    case 'holiday':              return { type, countryCode: 'HK' };
    case 'sun':                  return { type, phase: 'sunset' };
    case 'device_group_state':   return { type, groupId: '', state: 'all_online' };
    case 'tag_match':            return { type, tagIds: [], logic: 'any' };
    case 'network_speed':        return { type, operator: '<', mbps: 10 };
    case 'audio_level':          return { type, operator: '>', db: 60 };
    case 'webhook':              return { type, webhookKey: '' };
    case 'battery_level':        return { type, operator: '<', percent: 20 };
    case 'device_orientation':   return { type, orientation: 'landscape' };
    case 'recurring_cron':       return { type, cron: '0 9 * * 1-5' };
    case 'temperature':          return { type, operator: '>', celsius: 25 };
    case 'humidity':             return { type, operator: '>', percent: 60 };
    // Good-to-have
    case 'face_detected':        return { type, minCount: 1 };
    case 'gesture':              return { type, gesture: 'wave' };
    case 'qr_scan':              return { type };
    case 'nfc_tap':              return { type };
    case 'stock_level':          return { type, sku: '', operator: '<', quantity: 5 };
    case 'pos_sale':             return { type, metric: 'total_amount', window: 'today', operator: '>', value: 1000 };
    case 'traffic':              return { type, routeId: '', operator: '>', delayMinutes: 15 };
    case 'flight_status':        return { type, status: 'on_time' };
    case 'social_mention':       return { type, platform: 'twitter', handle: '' };
    case 'calendar_event':       return { type, calendarId: '', eventType: 'event_active' };
    case 'stream_health':        return { type, streamId: '', state: 'unhealthy' };
    case 'geofence':             return { type, geofenceId: '', transition: 'enter' };
    default:                     return { type } as ConditionLeaf;
  }
}

// ── Condition tree editor ─────────────────────────────────────────────────────

function LeafEditor({
  node,
  sensors,
  onChange,
}: {
  node: ConditionLeaf;
  sensors: SensorItem[];
  onChange: (n: ConditionLeaf) => void;
}) {
  const set = (patch: Record<string, unknown>) => onChange({ ...node, ...patch });

  if (node.type === 'ble_beacon') return (
    <div className="space-y-2">
      <input placeholder="Beacon UUID" value={String(node.uuid ?? '')} onChange={e => set({ uuid: e.target.value })}
        className="w-full rounded-lg border border-[var(--card-border)] bg-[var(--card)] px-3 py-1.5 text-xs text-[var(--text)] font-mono" />
      <div className="flex gap-2">
        <input type="number" placeholder="Major" value={String(node.major ?? '')} onChange={e => set({ major: e.target.value ? Number(e.target.value) : undefined })}
          className="w-1/2 rounded-lg border border-[var(--card-border)] bg-[var(--card)] px-3 py-1.5 text-xs text-[var(--text)]" />
        <input type="number" placeholder="Minor" value={String(node.minor ?? '')} onChange={e => set({ minor: e.target.value ? Number(e.target.value) : undefined })}
          className="w-1/2 rounded-lg border border-[var(--card-border)] bg-[var(--card)] px-3 py-1.5 text-xs text-[var(--text)]" />
      </div>
      <div className="flex items-center gap-2">
        <label className="text-xs text-[var(--text-muted)]">RSSI threshold</label>
        <input type="number" value={String(node.rssiThreshold ?? -75)} onChange={e => set({ rssiThreshold: Number(e.target.value) })}
          className="w-24 rounded-lg border border-[var(--card-border)] bg-[var(--card)] px-3 py-1.5 text-xs text-[var(--text)]" />
        <span className="text-xs text-[var(--text-muted)]">dBm</span>
      </div>
    </div>
  );

  if (node.type === 'time_window') return (
    <div className="flex items-center gap-2">
      <label className="text-xs text-[var(--text-muted)]">From</label>
      <input type="time" value={String(node.start ?? '08:00')} onChange={e => set({ start: e.target.value })}
        className="rounded-lg border border-[var(--card-border)] bg-[var(--card)] px-2 py-1.5 text-xs text-[var(--text)]" />
      <label className="text-xs text-[var(--text-muted)]">To</label>
      <input type="time" value={String(node.end ?? '17:00')} onChange={e => set({ end: e.target.value })}
        className="rounded-lg border border-[var(--card-border)] bg-[var(--card)] px-2 py-1.5 text-xs text-[var(--text)]" />
    </div>
  );

  if (node.type === 'day_of_week') {
    const days = (node.days as number[]) ?? [];
    return (
      <div className="flex flex-wrap gap-1.5">
        {DOW_LABELS.map((label, i) => (
          <button key={i} type="button"
            onClick={() => set({ days: days.includes(i) ? days.filter(d => d !== i) : [...days, i] })}
            className={`px-2.5 py-1 rounded-lg text-xs border transition-colors ${
              days.includes(i) ? 'bg-[var(--blue)] border-[var(--blue)] text-white' : 'border-[var(--card-border)] text-[var(--text-muted)] hover:text-[var(--text)]'
            }`}
          >{label}</button>
        ))}
      </div>
    );
  }

  if (node.type === 'sensor_value') return (
    <div className="space-y-2">
      <select value={String(node.sensorId ?? '')} onChange={e => set({ sensorId: e.target.value })}
        className="w-full rounded-lg border border-[var(--card-border)] bg-[var(--card)] px-3 py-1.5 text-xs text-[var(--text)]">
        <option value="">Select sensor…</option>
        {sensors.map(s => <option key={s.id} value={s.id}>{s.name}{s.unit ? ` (${s.unit})` : ''}</option>)}
      </select>
      <div className="flex items-center gap-2">
        <select value={String(node.field ?? 'value')} onChange={e => set({ field: e.target.value })}
          className="rounded-lg border border-[var(--card-border)] bg-[var(--card)] px-2 py-1.5 text-xs text-[var(--text)]">
          <option value="value">Value</option>
          <option value="hour">Hour</option>
          <option value="day_of_week">Day of Week</option>
        </select>
        <select value={String(node.operator ?? '>')} onChange={e => set({ operator: e.target.value })}
          className="rounded-lg border border-[var(--card-border)] bg-[var(--card)] px-2 py-1.5 text-xs text-[var(--text)]">
          {['>', '<', '>=', '<=', '==', '!='].map(op => <option key={op} value={op}>{op}</option>)}
        </select>
        <input type="number" value={String(node.value ?? 0)} onChange={e => set({ value: Number(e.target.value) })}
          className="w-24 rounded-lg border border-[var(--card-border)] bg-[var(--card)] px-3 py-1.5 text-xs text-[var(--text)]" />
      </div>
    </div>
  );

  // ── MVP ────────────────────────────────────────────────────────────────────
  if (node.type === 'weather') return (
    <div className="grid grid-cols-3 gap-2">
      <select value={String(node.field ?? 'temperature_c')} onChange={e => set({ field: e.target.value })}
        className="rounded-lg border border-[var(--card-border)] bg-[var(--card)] px-2 py-1.5 text-xs text-[var(--text)]">
        <option value="temperature_c">Temp °C</option>
        <option value="humidity_pct">Humidity %</option>
        <option value="wind_kph">Wind km/h</option>
        <option value="condition">Condition</option>
      </select>
      <select value={String(node.operator ?? '>')} onChange={e => set({ operator: e.target.value })}
        className="rounded-lg border border-[var(--card-border)] bg-[var(--card)] px-2 py-1.5 text-xs text-[var(--text)]">
        {['>', '<', '>=', '<=', '==', '!='].map(op => <option key={op} value={op}>{op}</option>)}
      </select>
      <input value={String(node.value ?? '')} onChange={e => {
        const v = e.target.value;
        const num = Number(v);
        set({ value: node.field === 'condition' ? v : (Number.isFinite(num) ? num : v) });
      }} placeholder={node.field === 'condition' ? 'rain / sunny / snow…' : 'value'}
        className="rounded-lg border border-[var(--card-border)] bg-[var(--card)] px-2 py-1.5 text-xs text-[var(--text)]" />
    </div>
  );

  if (node.type === 'date_range') return (
    <div className="flex items-center gap-2">
      <label className="text-xs text-[var(--text-muted)]">From</label>
      <input type="date" value={String(node.start ?? '')} onChange={e => set({ start: e.target.value })}
        className="rounded-lg border border-[var(--card-border)] bg-[var(--card)] px-2 py-1.5 text-xs text-[var(--text)]" />
      <label className="text-xs text-[var(--text-muted)]">To</label>
      <input type="date" value={String(node.end ?? '')} onChange={e => set({ end: e.target.value })}
        className="rounded-lg border border-[var(--card-border)] bg-[var(--card)] px-2 py-1.5 text-xs text-[var(--text)]" />
    </div>
  );

  if (node.type === 'occupancy') return (
    <div className="flex items-center gap-2">
      <input value={String(node.sourceId ?? '')} onChange={e => set({ sourceId: e.target.value || undefined })}
        placeholder="Source id (optional)"
        className="flex-1 rounded-lg border border-[var(--card-border)] bg-[var(--card)] px-2 py-1.5 text-xs text-[var(--text)]" />
      <select value={String(node.operator ?? '>=')} onChange={e => set({ operator: e.target.value })}
        className="rounded-lg border border-[var(--card-border)] bg-[var(--card)] px-2 py-1.5 text-xs text-[var(--text)]">
        {['>', '<', '>=', '<=', '=='].map(op => <option key={op} value={op}>{op}</option>)}
      </select>
      <input type="number" min="0" value={String(node.count ?? 1)} onChange={e => set({ count: Number(e.target.value) })}
        className="w-20 rounded-lg border border-[var(--card-border)] bg-[var(--card)] px-2 py-1.5 text-xs text-[var(--text)]" />
      <span className="text-xs text-[var(--text-muted)]">people</span>
    </div>
  );

  if (node.type === 'device_idle') return (
    <div className="flex items-center gap-2">
      <label className="text-xs text-[var(--text-muted)]">Idle for</label>
      <input type="number" min="1" value={String(node.idleSeconds ?? 300)} onChange={e => set({ idleSeconds: Number(e.target.value) })}
        className="w-28 rounded-lg border border-[var(--card-border)] bg-[var(--card)] px-2 py-1.5 text-xs text-[var(--text)]" />
      <span className="text-xs text-[var(--text-muted)]">seconds</span>
    </div>
  );

  if (node.type === 'schedule_active') return (
    <div className="flex items-center gap-2">
      <input value={String(node.scheduleId ?? '')} onChange={e => set({ scheduleId: e.target.value })}
        placeholder="Schedule id"
        className="flex-1 rounded-lg border border-[var(--card-border)] bg-[var(--card)] px-2 py-1.5 text-xs text-[var(--text)] font-mono" />
      <label className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
        <input type="checkbox" checked={!!node.negate} onChange={e => set({ negate: e.target.checked })} />
        Negate
      </label>
    </div>
  );

  if (node.type === 'content_finished') return (
    <input value={String(node.contentId ?? '')} onChange={e => set({ contentId: e.target.value || undefined })}
      placeholder="Content id (blank = any content)"
      className="w-full rounded-lg border border-[var(--card-border)] bg-[var(--card)] px-2 py-1.5 text-xs text-[var(--text)] font-mono" />
  );

  // ── Nice-to-have ──────────────────────────────────────────────────────────
  if (node.type === 'holiday') return (
    <div className="flex items-center gap-2">
      <input value={String(node.countryCode ?? 'HK')} onChange={e => set({ countryCode: e.target.value.toUpperCase() })}
        placeholder="Country" maxLength={3}
        className="w-20 rounded-lg border border-[var(--card-border)] bg-[var(--card)] px-2 py-1.5 text-xs text-[var(--text)] uppercase font-mono" />
      <input value={String(node.region ?? '')} onChange={e => set({ region: e.target.value || undefined })}
        placeholder="Region (optional)"
        className="flex-1 rounded-lg border border-[var(--card-border)] bg-[var(--card)] px-2 py-1.5 text-xs text-[var(--text)]" />
    </div>
  );

  if (node.type === 'sun') return (
    <div className="flex items-center gap-2">
      <select value={String(node.phase ?? 'sunset')} onChange={e => set({ phase: e.target.value })}
        className="rounded-lg border border-[var(--card-border)] bg-[var(--card)] px-2 py-1.5 text-xs text-[var(--text)]">
        <option value="sunrise">Sunrise</option>
        <option value="sunset">Sunset</option>
        <option value="before_sunrise">Before sunrise</option>
        <option value="after_sunset">After sunset</option>
        <option value="daytime">Daytime</option>
        <option value="nighttime">Nighttime</option>
      </select>
      <label className="text-xs text-[var(--text-muted)]">Offset</label>
      <input type="number" value={String(node.offsetMinutes ?? 0)} onChange={e => set({ offsetMinutes: Number(e.target.value) })}
        className="w-24 rounded-lg border border-[var(--card-border)] bg-[var(--card)] px-2 py-1.5 text-xs text-[var(--text)]" />
      <span className="text-xs text-[var(--text-muted)]">min</span>
    </div>
  );

  if (node.type === 'device_group_state') return (
    <div className="flex items-center gap-2">
      <input value={String(node.groupId ?? '')} onChange={e => set({ groupId: e.target.value })}
        placeholder="Group id"
        className="flex-1 rounded-lg border border-[var(--card-border)] bg-[var(--card)] px-2 py-1.5 text-xs text-[var(--text)] font-mono" />
      <select value={String(node.state ?? 'all_online')} onChange={e => set({ state: e.target.value })}
        className="rounded-lg border border-[var(--card-border)] bg-[var(--card)] px-2 py-1.5 text-xs text-[var(--text)]">
        <option value="all_online">All online</option>
        <option value="any_offline">Any offline</option>
        <option value="all_offline">All offline</option>
        <option value="any_online">Any online</option>
      </select>
    </div>
  );

  if (node.type === 'tag_match') {
    const ids = ((node.tagIds as string[]) ?? []).join(', ');
    return (
      <div className="flex items-center gap-2">
        <input value={ids} onChange={e => set({ tagIds: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
          placeholder="Tag ids (comma separated)"
          className="flex-1 rounded-lg border border-[var(--card-border)] bg-[var(--card)] px-2 py-1.5 text-xs text-[var(--text)]" />
        <select value={String(node.logic ?? 'any')} onChange={e => set({ logic: e.target.value })}
          className="rounded-lg border border-[var(--card-border)] bg-[var(--card)] px-2 py-1.5 text-xs text-[var(--text)]">
          <option value="any">ANY</option>
          <option value="all">ALL</option>
        </select>
      </div>
    );
  }

  if (node.type === 'network_speed') return (
    <div className="flex items-center gap-2">
      <select value={String(node.operator ?? '<')} onChange={e => set({ operator: e.target.value })}
        className="rounded-lg border border-[var(--card-border)] bg-[var(--card)] px-2 py-1.5 text-xs text-[var(--text)]">
        {['>', '<', '>=', '<='].map(op => <option key={op} value={op}>{op}</option>)}
      </select>
      <input type="number" min="0" step="0.1" value={String(node.mbps ?? 10)} onChange={e => set({ mbps: Number(e.target.value) })}
        className="w-28 rounded-lg border border-[var(--card-border)] bg-[var(--card)] px-2 py-1.5 text-xs text-[var(--text)]" />
      <span className="text-xs text-[var(--text-muted)]">Mbps</span>
    </div>
  );

  if (node.type === 'audio_level') return (
    <div className="flex items-center gap-2">
      <select value={String(node.operator ?? '>')} onChange={e => set({ operator: e.target.value })}
        className="rounded-lg border border-[var(--card-border)] bg-[var(--card)] px-2 py-1.5 text-xs text-[var(--text)]">
        {['>', '<', '>=', '<='].map(op => <option key={op} value={op}>{op}</option>)}
      </select>
      <input type="number" value={String(node.db ?? 60)} onChange={e => set({ db: Number(e.target.value) })}
        className="w-24 rounded-lg border border-[var(--card-border)] bg-[var(--card)] px-2 py-1.5 text-xs text-[var(--text)]" />
      <span className="text-xs text-[var(--text-muted)]">dBA</span>
    </div>
  );

  if (node.type === 'webhook') return (
    <input value={String(node.webhookKey ?? '')} onChange={e => set({ webhookKey: e.target.value })}
      placeholder="Webhook key (POST /rule-sets/webhook/:key)"
      className="w-full rounded-lg border border-[var(--card-border)] bg-[var(--card)] px-2 py-1.5 text-xs text-[var(--text)] font-mono" />
  );

  if (node.type === 'battery_level') return (
    <div className="flex items-center gap-2">
      <select value={String(node.operator ?? '<')} onChange={e => set({ operator: e.target.value })}
        className="rounded-lg border border-[var(--card-border)] bg-[var(--card)] px-2 py-1.5 text-xs text-[var(--text)]">
        {['>', '<', '>=', '<='].map(op => <option key={op} value={op}>{op}</option>)}
      </select>
      <input type="number" min="0" max="100" value={String(node.percent ?? 20)} onChange={e => set({ percent: Number(e.target.value) })}
        className="w-20 rounded-lg border border-[var(--card-border)] bg-[var(--card)] px-2 py-1.5 text-xs text-[var(--text)]" />
      <span className="text-xs text-[var(--text-muted)]">%</span>
    </div>
  );

  if (node.type === 'device_orientation') return (
    <select value={String(node.orientation ?? 'landscape')} onChange={e => set({ orientation: e.target.value })}
      className="rounded-lg border border-[var(--card-border)] bg-[var(--card)] px-2 py-1.5 text-xs text-[var(--text)]">
      <option value="portrait">Portrait</option>
      <option value="landscape">Landscape</option>
    </select>
  );

  if (node.type === 'recurring_cron') return (
    <div className="space-y-1.5">
      <input value={String(node.cron ?? '')} onChange={e => set({ cron: e.target.value })}
        placeholder="0 9 * * 1-5  (min hour dom mon dow)"
        className="w-full rounded-lg border border-[var(--card-border)] bg-[var(--card)] px-2 py-1.5 text-xs text-[var(--text)] font-mono" />
      <input value={String(node.timezone ?? '')} onChange={e => set({ timezone: e.target.value || undefined })}
        placeholder="Timezone (e.g. Asia/Hong_Kong; blank = device tz)"
        className="w-full rounded-lg border border-[var(--card-border)] bg-[var(--card)] px-2 py-1.5 text-xs text-[var(--text)]" />
    </div>
  );

  if (node.type === 'temperature') return (
    <div className="flex items-center gap-2">
      <input value={String(node.sensorId ?? '')} onChange={e => set({ sensorId: e.target.value || undefined })}
        placeholder="Sensor id (blank = primary)"
        className="flex-1 rounded-lg border border-[var(--card-border)] bg-[var(--card)] px-2 py-1.5 text-xs text-[var(--text)] font-mono" />
      <select value={String(node.operator ?? '>')} onChange={e => set({ operator: e.target.value })}
        className="rounded-lg border border-[var(--card-border)] bg-[var(--card)] px-2 py-1.5 text-xs text-[var(--text)]">
        {['>', '<', '>=', '<='].map(op => <option key={op} value={op}>{op}</option>)}
      </select>
      <input type="number" value={String(node.celsius ?? 25)} onChange={e => set({ celsius: Number(e.target.value) })}
        className="w-20 rounded-lg border border-[var(--card-border)] bg-[var(--card)] px-2 py-1.5 text-xs text-[var(--text)]" />
      <span className="text-xs text-[var(--text-muted)]">°C</span>
    </div>
  );

  if (node.type === 'humidity') return (
    <div className="flex items-center gap-2">
      <input value={String(node.sensorId ?? '')} onChange={e => set({ sensorId: e.target.value || undefined })}
        placeholder="Sensor id (blank = primary)"
        className="flex-1 rounded-lg border border-[var(--card-border)] bg-[var(--card)] px-2 py-1.5 text-xs text-[var(--text)] font-mono" />
      <select value={String(node.operator ?? '>')} onChange={e => set({ operator: e.target.value })}
        className="rounded-lg border border-[var(--card-border)] bg-[var(--card)] px-2 py-1.5 text-xs text-[var(--text)]">
        {['>', '<', '>=', '<='].map(op => <option key={op} value={op}>{op}</option>)}
      </select>
      <input type="number" min="0" max="100" value={String(node.percent ?? 60)} onChange={e => set({ percent: Number(e.target.value) })}
        className="w-20 rounded-lg border border-[var(--card-border)] bg-[var(--card)] px-2 py-1.5 text-xs text-[var(--text)]" />
      <span className="text-xs text-[var(--text-muted)]">%</span>
    </div>
  );

  // ── Good-to-have ──────────────────────────────────────────────────────────
  if (node.type === 'face_detected') return (
    <div className="grid grid-cols-2 gap-2">
      <div className="flex items-center gap-2">
        <label className="text-xs text-[var(--text-muted)]">Min count</label>
        <input type="number" min="1" value={String(node.minCount ?? 1)} onChange={e => set({ minCount: Number(e.target.value) })}
          className="w-20 rounded-lg border border-[var(--card-border)] bg-[var(--card)] px-2 py-1.5 text-xs text-[var(--text)]" />
      </div>
      <select value={String(node.gender ?? 'any')} onChange={e => set({ gender: e.target.value })}
        className="rounded-lg border border-[var(--card-border)] bg-[var(--card)] px-2 py-1.5 text-xs text-[var(--text)]">
        <option value="any">Any gender</option>
        <option value="male">Male</option>
        <option value="female">Female</option>
      </select>
      <input type="number" min="0" max="120" placeholder="Age min" value={String(node.ageMin ?? '')} onChange={e => set({ ageMin: e.target.value ? Number(e.target.value) : undefined })}
        className="rounded-lg border border-[var(--card-border)] bg-[var(--card)] px-2 py-1.5 text-xs text-[var(--text)]" />
      <input type="number" min="0" max="120" placeholder="Age max" value={String(node.ageMax ?? '')} onChange={e => set({ ageMax: e.target.value ? Number(e.target.value) : undefined })}
        className="rounded-lg border border-[var(--card-border)] bg-[var(--card)] px-2 py-1.5 text-xs text-[var(--text)]" />
    </div>
  );

  if (node.type === 'gesture') return (
    <select value={String(node.gesture ?? 'wave')} onChange={e => set({ gesture: e.target.value })}
      className="rounded-lg border border-[var(--card-border)] bg-[var(--card)] px-2 py-1.5 text-xs text-[var(--text)]">
      <option value="wave">Wave</option>
      <option value="swipe_left">Swipe left</option>
      <option value="swipe_right">Swipe right</option>
      <option value="point">Point</option>
      <option value="thumbs_up">Thumbs up</option>
    </select>
  );

  if (node.type === 'qr_scan') return (
    <input value={String(node.qrCodeId ?? '')} onChange={e => set({ qrCodeId: e.target.value || undefined })}
      placeholder="QR code id / payload (blank = any)"
      className="w-full rounded-lg border border-[var(--card-border)] bg-[var(--card)] px-2 py-1.5 text-xs text-[var(--text)] font-mono" />
  );

  if (node.type === 'nfc_tap') return (
    <input value={String(node.tagId ?? '')} onChange={e => set({ tagId: e.target.value || undefined })}
      placeholder="NFC tag id (blank = any)"
      className="w-full rounded-lg border border-[var(--card-border)] bg-[var(--card)] px-2 py-1.5 text-xs text-[var(--text)] font-mono" />
  );

  if (node.type === 'stock_level') return (
    <div className="flex items-center gap-2">
      <input value={String(node.sku ?? '')} onChange={e => set({ sku: e.target.value })}
        placeholder="SKU"
        className="flex-1 rounded-lg border border-[var(--card-border)] bg-[var(--card)] px-2 py-1.5 text-xs text-[var(--text)] font-mono" />
      <select value={String(node.operator ?? '<')} onChange={e => set({ operator: e.target.value })}
        className="rounded-lg border border-[var(--card-border)] bg-[var(--card)] px-2 py-1.5 text-xs text-[var(--text)]">
        {['>', '<', '>=', '<=', '==', '!='].map(op => <option key={op} value={op}>{op}</option>)}
      </select>
      <input type="number" min="0" value={String(node.quantity ?? 0)} onChange={e => set({ quantity: Number(e.target.value) })}
        className="w-20 rounded-lg border border-[var(--card-border)] bg-[var(--card)] px-2 py-1.5 text-xs text-[var(--text)]" />
    </div>
  );

  if (node.type === 'pos_sale') return (
    <div className="grid grid-cols-4 gap-2">
      <select value={String(node.metric ?? 'total_amount')} onChange={e => set({ metric: e.target.value })}
        className="rounded-lg border border-[var(--card-border)] bg-[var(--card)] px-2 py-1.5 text-xs text-[var(--text)]">
        <option value="total_amount">Total $</option>
        <option value="transaction_count">Tx count</option>
        <option value="avg_ticket">Avg ticket</option>
      </select>
      <select value={String(node.window ?? 'today')} onChange={e => set({ window: e.target.value })}
        className="rounded-lg border border-[var(--card-border)] bg-[var(--card)] px-2 py-1.5 text-xs text-[var(--text)]">
        <option value="minute">/ minute</option>
        <option value="hour">/ hour</option>
        <option value="today">today</option>
      </select>
      <select value={String(node.operator ?? '>')} onChange={e => set({ operator: e.target.value })}
        className="rounded-lg border border-[var(--card-border)] bg-[var(--card)] px-2 py-1.5 text-xs text-[var(--text)]">
        {['>', '<', '>=', '<='].map(op => <option key={op} value={op}>{op}</option>)}
      </select>
      <input type="number" value={String(node.value ?? 0)} onChange={e => set({ value: Number(e.target.value) })}
        className="rounded-lg border border-[var(--card-border)] bg-[var(--card)] px-2 py-1.5 text-xs text-[var(--text)]" />
    </div>
  );

  if (node.type === 'traffic') return (
    <div className="flex items-center gap-2">
      <input value={String(node.routeId ?? '')} onChange={e => set({ routeId: e.target.value })}
        placeholder="Route id"
        className="flex-1 rounded-lg border border-[var(--card-border)] bg-[var(--card)] px-2 py-1.5 text-xs text-[var(--text)] font-mono" />
      <select value={String(node.operator ?? '>')} onChange={e => set({ operator: e.target.value })}
        className="rounded-lg border border-[var(--card-border)] bg-[var(--card)] px-2 py-1.5 text-xs text-[var(--text)]">
        {['>', '<', '>=', '<='].map(op => <option key={op} value={op}>{op}</option>)}
      </select>
      <input type="number" min="0" value={String(node.delayMinutes ?? 15)} onChange={e => set({ delayMinutes: Number(e.target.value) })}
        className="w-20 rounded-lg border border-[var(--card-border)] bg-[var(--card)] px-2 py-1.5 text-xs text-[var(--text)]" />
      <span className="text-xs text-[var(--text-muted)]">min delay</span>
    </div>
  );

  if (node.type === 'flight_status') return (
    <div className="grid grid-cols-3 gap-2">
      <input value={String(node.flightNumber ?? '')} onChange={e => set({ flightNumber: e.target.value || undefined })}
        placeholder="Flight #"
        className="rounded-lg border border-[var(--card-border)] bg-[var(--card)] px-2 py-1.5 text-xs text-[var(--text)] font-mono" />
      <input value={String(node.gate ?? '')} onChange={e => set({ gate: e.target.value || undefined })}
        placeholder="Gate"
        className="rounded-lg border border-[var(--card-border)] bg-[var(--card)] px-2 py-1.5 text-xs text-[var(--text)]" />
      <select value={String(node.status ?? 'on_time')} onChange={e => set({ status: e.target.value })}
        className="rounded-lg border border-[var(--card-border)] bg-[var(--card)] px-2 py-1.5 text-xs text-[var(--text)]">
        <option value="on_time">On time</option>
        <option value="delayed">Delayed</option>
        <option value="cancelled">Cancelled</option>
        <option value="boarding">Boarding</option>
        <option value="departed">Departed</option>
      </select>
    </div>
  );

  if (node.type === 'social_mention') return (
    <div className="grid grid-cols-3 gap-2">
      <select value={String(node.platform ?? 'twitter')} onChange={e => set({ platform: e.target.value })}
        className="rounded-lg border border-[var(--card-border)] bg-[var(--card)] px-2 py-1.5 text-xs text-[var(--text)]">
        <option value="twitter">Twitter / X</option>
        <option value="instagram">Instagram</option>
        <option value="facebook">Facebook</option>
        <option value="tiktok">TikTok</option>
      </select>
      <input value={String(node.handle ?? '')} onChange={e => set({ handle: e.target.value })}
        placeholder="@handle"
        className="rounded-lg border border-[var(--card-border)] bg-[var(--card)] px-2 py-1.5 text-xs text-[var(--text)] font-mono" />
      <input value={String(node.keyword ?? '')} onChange={e => set({ keyword: e.target.value || undefined })}
        placeholder="Keyword (optional)"
        className="rounded-lg border border-[var(--card-border)] bg-[var(--card)] px-2 py-1.5 text-xs text-[var(--text)]" />
    </div>
  );

  if (node.type === 'calendar_event') return (
    <div className="grid grid-cols-3 gap-2">
      <input value={String(node.calendarId ?? '')} onChange={e => set({ calendarId: e.target.value })}
        placeholder="Calendar id"
        className="rounded-lg border border-[var(--card-border)] bg-[var(--card)] px-2 py-1.5 text-xs text-[var(--text)] font-mono" />
      <select value={String(node.eventType ?? 'event_active')} onChange={e => set({ eventType: e.target.value })}
        className="rounded-lg border border-[var(--card-border)] bg-[var(--card)] px-2 py-1.5 text-xs text-[var(--text)]">
        <option value="event_active">Active</option>
        <option value="event_starting_soon">Starting soon</option>
        <option value="event_ended">Ended</option>
      </select>
      <input type="number" min="0" placeholder="Window (min)" value={String(node.windowMinutes ?? '')}
        onChange={e => set({ windowMinutes: e.target.value ? Number(e.target.value) : undefined })}
        className="rounded-lg border border-[var(--card-border)] bg-[var(--card)] px-2 py-1.5 text-xs text-[var(--text)]" />
    </div>
  );

  if (node.type === 'stream_health') return (
    <div className="flex items-center gap-2">
      <input value={String(node.streamId ?? '')} onChange={e => set({ streamId: e.target.value })}
        placeholder="Stream id"
        className="flex-1 rounded-lg border border-[var(--card-border)] bg-[var(--card)] px-2 py-1.5 text-xs text-[var(--text)] font-mono" />
      <select value={String(node.state ?? 'unhealthy')} onChange={e => set({ state: e.target.value })}
        className="rounded-lg border border-[var(--card-border)] bg-[var(--card)] px-2 py-1.5 text-xs text-[var(--text)]">
        <option value="healthy">Healthy</option>
        <option value="unhealthy">Unhealthy</option>
      </select>
    </div>
  );

  if (node.type === 'geofence') return (
    <div className="flex items-center gap-2">
      <input value={String(node.geofenceId ?? '')} onChange={e => set({ geofenceId: e.target.value })}
        placeholder="Geofence id"
        className="flex-1 rounded-lg border border-[var(--card-border)] bg-[var(--card)] px-2 py-1.5 text-xs text-[var(--text)] font-mono" />
      <select value={String(node.transition ?? 'enter')} onChange={e => set({ transition: e.target.value })}
        className="rounded-lg border border-[var(--card-border)] bg-[var(--card)] px-2 py-1.5 text-xs text-[var(--text)]">
        <option value="enter">Enter</option>
        <option value="exit">Exit</option>
        <option value="inside">Inside</option>
        <option value="outside">Outside</option>
      </select>
    </div>
  );

  // device_online / device_offline / content_finished (when no contentId) — no sub-fields
  return <p className="text-xs text-[var(--text-muted)] italic">No additional configuration needed.</p>;
}

const CONDITION_TYPE_LABELS: Record<ConditionType, string> = {
  ble_beacon:          'BLE Beacon',
  time_window:         'Time Window',
  day_of_week:         'Day of Week',
  sensor_value:        'Sensor Value',
  device_online:       'Device Online',
  device_offline:      'Device Offline',
  // MVP
  weather:             'Weather',
  date_range:          'Date Range',
  occupancy:           'Occupancy',
  device_idle:         'Device Idle',
  schedule_active:     'Schedule Active',
  content_finished:    'Content Finished',
  // Nice-to-have
  holiday:             'Holiday',
  sun:                 'Sunrise / Sunset',
  device_group_state:  'Device Group State',
  tag_match:           'Tag Match',
  network_speed:       'Network Speed',
  audio_level:         'Ambient Audio Level',
  webhook:             'Inbound Webhook',
  battery_level:       'Battery Level',
  device_orientation:  'Device Orientation',
  recurring_cron:      'Recurring (Cron)',
  temperature:         'Temperature Sensor',
  humidity:            'Humidity Sensor',
  // Good-to-have
  face_detected:       'Face Detected',
  gesture:             'Gesture Detected',
  qr_scan:             'QR Code Scan',
  nfc_tap:             'NFC Tap',
  stock_level:         'Stock Level',
  pos_sale:            'POS Sale',
  traffic:             'Traffic / Travel Time',
  flight_status:       'Flight Status',
  social_mention:      'Social Mention',
  calendar_event:      'Calendar Event',
  stream_health:       'Stream Health',
  geofence:            'Geofence',
};

function ConditionTypeIcon({ type }: { type: ConditionType }) {
  switch (type) {
    case 'ble_beacon':          return <Radio className="w-3.5 h-3.5" />;
    case 'time_window':         return <Clock className="w-3.5 h-3.5" />;
    case 'day_of_week':         return <Calendar className="w-3.5 h-3.5" />;
    case 'sensor_value':        return <Activity className="w-3.5 h-3.5" />;
    case 'device_online':       return <Monitor className="w-3.5 h-3.5" />;
    case 'device_offline':      return <MonitorOff className="w-3.5 h-3.5" />;
    case 'weather':             return <CloudRain className="w-3.5 h-3.5" />;
    case 'date_range':          return <CalendarRange className="w-3.5 h-3.5" />;
    case 'occupancy':           return <Users className="w-3.5 h-3.5" />;
    case 'device_idle':         return <PauseCircle className="w-3.5 h-3.5" />;
    case 'schedule_active':     return <CalendarCheck className="w-3.5 h-3.5" />;
    case 'content_finished':    return <CheckCircle2 className="w-3.5 h-3.5" />;
    case 'holiday':             return <PartyPopper className="w-3.5 h-3.5" />;
    case 'sun':                 return <Sun className="w-3.5 h-3.5" />;
    case 'device_group_state':  return <Server className="w-3.5 h-3.5" />;
    case 'tag_match':           return <Tag className="w-3.5 h-3.5" />;
    case 'network_speed':       return <Wifi className="w-3.5 h-3.5" />;
    case 'audio_level':         return <Volume2 className="w-3.5 h-3.5" />;
    case 'webhook':             return <Webhook className="w-3.5 h-3.5" />;
    case 'battery_level':       return <Battery className="w-3.5 h-3.5" />;
    case 'device_orientation':  return <Smartphone className="w-3.5 h-3.5" />;
    case 'recurring_cron':      return <Repeat className="w-3.5 h-3.5" />;
    case 'temperature':         return <Thermometer className="w-3.5 h-3.5" />;
    case 'humidity':            return <Droplets className="w-3.5 h-3.5" />;
    case 'face_detected':       return <ScanFace className="w-3.5 h-3.5" />;
    case 'gesture':             return <Hand className="w-3.5 h-3.5" />;
    case 'qr_scan':             return <QrCode className="w-3.5 h-3.5" />;
    case 'nfc_tap':             return <Nfc className="w-3.5 h-3.5" />;
    case 'stock_level':         return <Package className="w-3.5 h-3.5" />;
    case 'pos_sale':            return <ShoppingCart className="w-3.5 h-3.5" />;
    case 'traffic':             return <Car className="w-3.5 h-3.5" />;
    case 'flight_status':       return <Plane className="w-3.5 h-3.5" />;
    case 'social_mention':      return <AtSign className="w-3.5 h-3.5" />;
    case 'calendar_event':      return <CalendarClock className="w-3.5 h-3.5" />;
    case 'stream_health':       return <Tv className="w-3.5 h-3.5" />;
    case 'geofence':            return <MapPin className="w-3.5 h-3.5" />;
  }
}

function ConditionNodeEditor({
  node,
  sensors,
  depth,
  onUpdate,
  onDelete,
}: {
  node: ConditionNode;
  sensors: SensorItem[];
  depth: number;
  onUpdate: (n: ConditionNode) => void;
  onDelete: () => void;
}) {
  const [addLeafOpen, setAddLeafOpen] = useState(false);

  if (node.type !== 'group') {
    const leaf = node as ConditionLeaf;
    return (
      <div className="flex items-start gap-2 p-2.5 rounded-lg bg-[var(--surface)] border border-[var(--card-border)]">
        <div className="flex items-center gap-1.5 shrink-0 mt-0.5 text-[var(--text-muted)]">
          <ConditionTypeIcon type={leaf.type as ConditionType} />
          <span className="text-xs font-medium text-[var(--text)]">{CONDITION_TYPE_LABELS[leaf.type as ConditionType] ?? leaf.type}</span>
        </div>
        <div className="flex-1 min-w-0">
          <LeafEditor node={leaf} sensors={sensors} onChange={updated => onUpdate(updated)} />
        </div>
        <button type="button" onClick={onDelete} className="shrink-0 p-1 rounded hover:bg-red-500/10 hover:text-red-400 text-[var(--text-muted)] transition-colors">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  const group = node as ConditionGroup;

  function updateChild(i: number, child: ConditionNode) {
    const children = [...group.children];
    children[i] = child;
    onUpdate({ ...group, children });
  }

  function deleteChild(i: number) {
    const children = [...group.children];
    children.splice(i, 1);
    onUpdate({ ...group, children });
  }

  function addLeaf(type: ConditionType) {
    onUpdate({ ...group, children: [...group.children, blankLeaf(type)] });
    setAddLeafOpen(false);
  }

  function addNestedGroup() {
    onUpdate({ ...group, children: [...group.children, blankGroup()] });
    setAddLeafOpen(false);
  }

  const leftPad = depth > 0 ? 'border-l-2 border-[var(--blue)]/30 pl-4 ml-2' : '';

  return (
    <div className={`space-y-2 ${leftPad}`}>
      {/* Group header */}
      <div className="flex items-center gap-2">
        <button type="button"
          onClick={() => onUpdate({ ...group, logic: group.logic === 'AND' ? 'OR' : 'AND' })}
          className={`px-3 py-1 rounded-full text-xs font-bold border transition-colors ${
            group.logic === 'AND'
              ? 'bg-[var(--blue)]/15 border-[var(--blue)]/30 text-[var(--blue)]'
              : 'bg-orange-500/15 border-orange-500/30 text-orange-400'
          }`}
        >
          {group.logic}
        </button>
        {depth > 0 && (
          <button type="button" onClick={onDelete} className="p-1 rounded hover:bg-red-500/10 hover:text-red-400 text-[var(--text-muted)] transition-colors">
            <X className="w-3.5 h-3.5" />
          </button>
        )}
        <span className="text-[10px] text-[var(--text-muted)]">group</span>
      </div>

      {/* Children */}
      {group.children.map((child, i) => (
        <ConditionNodeEditor
          key={i}
          node={child}
          sensors={sensors}
          depth={depth + 1}
          onUpdate={c => updateChild(i, c)}
          onDelete={() => deleteChild(i)}
        />
      ))}

      {/* Add condition */}
      <div className="relative">
        <button type="button"
          onClick={() => setAddLeafOpen(v => !v)}
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface)] rounded-lg border border-dashed border-[var(--card-border)] transition-colors w-full"
        >
          <Plus className="w-3.5 h-3.5" /> Add condition
          <ChevronDown className="w-3 h-3 ml-auto" />
        </button>
        {addLeafOpen && (
          <div className="absolute left-0 top-full z-20 mt-1 w-52 rounded-xl border border-[var(--card-border)] bg-[var(--card)] shadow-lg overflow-hidden">
            {(Object.keys(CONDITION_TYPE_LABELS) as ConditionType[]).map(ct => (
              <button key={ct} type="button"
                onClick={() => addLeaf(ct)}
                className="flex items-center gap-2 w-full px-3 py-2 text-xs text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface)] transition-colors"
              >
                <ConditionTypeIcon type={ct} />
                {CONDITION_TYPE_LABELS[ct]}
              </button>
            ))}
            <button type="button"
              onClick={addNestedGroup}
              className="flex items-center gap-2 w-full px-3 py-2 text-xs text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface)] border-t border-[var(--card-border)] transition-colors"
            >
              <Layers className="w-3.5 h-3.5" /> Nested AND/OR group
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Action editor ─────────────────────────────────────────────────────────────

const ACTION_TYPE_OPTIONS: { value: ActionType; label: string; group: string }[] = [
  { value: 'play_content',            label: 'Play Content',               group: 'Playback' },
  { value: 'play_playlist',           label: 'Play Playlist',              group: 'Playback' },
  { value: 'play_schedule',           label: 'Play Schedule',              group: 'Playback' },
  { value: 'stop_playback',           label: 'Stop Playback',              group: 'Playback' },
  { value: 'pause_playback',          label: 'Pause Playback',             group: 'Playback' },
  { value: 'switch_zone_content',     label: 'Switch Zone Content',        group: 'Playback' },
  { value: 'message_overlay',         label: 'Show Message Overlay',       group: 'Overlay' },
  { value: 'emergency_override',      label: 'Emergency Override',         group: 'Overlay' },
  { value: 'device_control',          label: 'Device Control',             group: 'Device' },
  { value: 'set_brightness_schedule', label: 'Set Brightness Schedule',    group: 'Device' },
  { value: 'fade_volume',             label: 'Fade Volume',                group: 'Device' },
  { value: 'launch_app',              label: 'Launch App (Tizen)',         group: 'Device' },
  { value: 'send_notification',       label: 'Send Notification',          group: 'Integration' },
  { value: 'webhook_call',            label: 'Webhook Call (outbound)',    group: 'Integration' },
  { value: 'log_event',               label: 'Log Event',                  group: 'Integration' },
  { value: 'record_analytics',        label: 'Record Analytics',           group: 'Integration' },
  { value: 'chain_rule_set',          label: 'Chain Rule Set',             group: 'Flow' },
  { value: 'delay',                   label: 'Delay',                      group: 'Flow' },
];

function ActionEditor({
  action,
  playlists,
  contentItems,
  schedules,
  onChange,
}: {
  action: RuleSetAction;
  playlists: PlaylistItem[];
  contentItems: ContentItem[];
  schedules: ScheduleItem[];
  onChange: (a: RuleSetAction) => void;
}) {
  const set = (patch: Record<string, unknown>) => onChange({ ...action, ...patch });

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-xs text-[var(--text-muted)] mb-1">Action type</label>
        <select
          value={action.type}
          onChange={e => onChange({ type: e.target.value as ActionType } as RuleSetAction)}
          className="w-full rounded-lg border border-[var(--card-border)] bg-[var(--card)] px-3 py-2 text-sm text-[var(--text)]"
        >
          {Array.from(new Set(ACTION_TYPE_OPTIONS.map(o => o.group))).map(grp => (
            <optgroup key={grp} label={grp}>
              {ACTION_TYPE_OPTIONS.filter(o => o.group === grp).map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      {action.type === 'play_content' && (
        <div>
          <label className="block text-xs text-[var(--text-muted)] mb-1">Content</label>
          <select value={String(action.contentId ?? '')} onChange={e => set({ contentId: e.target.value })}
            className="w-full rounded-lg border border-[var(--card-border)] bg-[var(--card)] px-3 py-2 text-sm text-[var(--text)]">
            <option value="">Select content…</option>
            {contentItems.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      )}

      {action.type === 'play_playlist' && (
        <div>
          <label className="block text-xs text-[var(--text-muted)] mb-1">Playlist</label>
          <select value={String(action.playlistId ?? '')} onChange={e => set({ playlistId: e.target.value })}
            className="w-full rounded-lg border border-[var(--card-border)] bg-[var(--card)] px-3 py-2 text-sm text-[var(--text)]">
            <option value="">Select playlist…</option>
            {playlists.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
      )}

      {action.type === 'play_schedule' && (
        <div>
          <label className="block text-xs text-[var(--text-muted)] mb-1">Schedule</label>
          <select value={String(action.scheduleId ?? '')} onChange={e => set({ scheduleId: e.target.value })}
            className="w-full rounded-lg border border-[var(--card-border)] bg-[var(--card)] px-3 py-2 text-sm text-[var(--text)]">
            <option value="">Select schedule…</option>
            {schedules.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
      )}

      {action.type === 'message_overlay' && (
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1">Message text</label>
            <textarea value={String(action.text ?? '')} onChange={e => set({ text: e.target.value })} rows={3}
              className="w-full rounded-lg border border-[var(--card-border)] bg-[var(--card)] px-3 py-2 text-sm text-[var(--text)] resize-none" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">Background</label>
              <div className="flex items-center gap-2">
                <input type="color" value={String(action.bgColor ?? '#000000')} onChange={e => set({ bgColor: e.target.value })} className="w-9 h-8 rounded border border-[var(--card-border)] cursor-pointer" />
                <span className="text-xs font-mono text-[var(--text-muted)]">{String(action.bgColor ?? '#000000')}</span>
              </div>
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">Text colour</label>
              <div className="flex items-center gap-2">
                <input type="color" value={String(action.textColor ?? '#ffffff')} onChange={e => set({ textColor: e.target.value })} className="w-9 h-8 rounded border border-[var(--card-border)] cursor-pointer" />
                <span className="text-xs font-mono text-[var(--text-muted)]">{String(action.textColor ?? '#ffffff')}</span>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">Position</label>
              <select value={String(action.position ?? 'bottom')} onChange={e => set({ position: e.target.value })}
                className="w-full rounded-lg border border-[var(--card-border)] bg-[var(--card)] px-3 py-2 text-sm text-[var(--text)]">
                {['top', 'bottom', 'center', 'full'].map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">Font size (px)</label>
              <input type="number" value={String(action.fontSize ?? 48)} onChange={e => set({ fontSize: Number(e.target.value) })}
                className="w-full rounded-lg border border-[var(--card-border)] bg-[var(--card)] px-3 py-2 text-sm text-[var(--text)]" />
            </div>
          </div>
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1">Duration (seconds, 0 = until dismissed)</label>
            <input type="number" min="0" value={String(action.durationSec ?? 30)} onChange={e => set({ durationSec: Number(e.target.value) })}
              className="w-full rounded-lg border border-[var(--card-border)] bg-[var(--card)] px-3 py-2 text-sm text-[var(--text)]" />
          </div>
        </div>
      )}

      {action.type === 'device_control' && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1">Command</label>
            <select value={String(action.command ?? 'volume')} onChange={e => set({ command: e.target.value })}
              className="w-full rounded-lg border border-[var(--card-border)] bg-[var(--card)] px-3 py-2 text-sm text-[var(--text)]">
              <option value="volume">Volume</option>
              <option value="brightness">Brightness</option>
              <option value="input_source">Input Source</option>
              <option value="power">Power</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1">Value</label>
            <input value={String(action.value ?? '')} onChange={e => set({ value: e.target.value })}
              placeholder={action.command === 'power' ? 'on / off / standby' : '0–100'}
              className="w-full rounded-lg border border-[var(--card-border)] bg-[var(--card)] px-3 py-2 text-sm text-[var(--text)]" />
          </div>
        </div>
      )}

      {action.type === 'send_notification' && (
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1">Message</label>
            <textarea value={String(action.message ?? '')} onChange={e => set({ message: e.target.value })} rows={3}
              className="w-full rounded-lg border border-[var(--card-border)] bg-[var(--card)] px-3 py-2 text-sm text-[var(--text)] resize-none" />
          </div>
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1">Severity</label>
            <select value={String(action.severity ?? 'info')} onChange={e => set({ severity: e.target.value })}
              className="w-full rounded-lg border border-[var(--card-border)] bg-[var(--card)] px-3 py-2 text-sm text-[var(--text)]">
              <option value="info">Info</option>
              <option value="warn">Warning</option>
              <option value="critical">Critical</option>
            </select>
          </div>
        </div>
      )}

      {action.type === 'emergency_override' && (
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1">Override content</label>
            <select value={String(action.contentId ?? '')} onChange={e => set({ contentId: e.target.value })}
              className="w-full rounded-lg border border-[var(--card-border)] bg-[var(--card)] px-3 py-2 text-sm text-[var(--text)]">
              <option value="">Select content…</option>
              {contentItems.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1">Auto-expire after (seconds, 0 = manual clear)</label>
            <input type="number" min="0" value={String(action.expireAfterSec ?? 0)} onChange={e => set({ expireAfterSec: Number(e.target.value) })}
              className="w-full rounded-lg border border-[var(--card-border)] bg-[var(--card)] px-3 py-2 text-sm text-[var(--text)]" />
          </div>
        </div>
      )}

      {action.type === 'launch_app' && (
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1">Tizen App ID</label>
            <input value={String(action.appId ?? '')} onChange={e => set({ appId: e.target.value })}
              placeholder="e.g. org.tizen.netflix-app"
              className="w-full rounded-lg border border-[var(--card-border)] bg-[var(--card)] px-3 py-2 text-sm text-[var(--text)] font-mono" />
          </div>
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1">Display name (optional)</label>
            <input value={String(action.appName ?? '')} onChange={e => set({ appName: e.target.value })}
              className="w-full rounded-lg border border-[var(--card-border)] bg-[var(--card)] px-3 py-2 text-sm text-[var(--text)]" />
          </div>
        </div>
      )}

      {action.type === 'set_brightness_schedule' && (
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1">Mode</label>
            <select value={String(action.mode ?? 'auto')} onChange={e => set({ mode: e.target.value })}
              className="w-full rounded-lg border border-[var(--card-border)] bg-[var(--card)] px-3 py-2 text-sm text-[var(--text)]">
              <option value="auto">Auto (ambient sensor)</option>
              <option value="manual">Manual</option>
              <option value="follow_sun">Follow sun</option>
            </select>
          </div>
          {action.mode === 'manual' && (
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">Manual brightness (0–100)</label>
              <input type="number" min="0" max="100" value={String(action.manualValue ?? 80)}
                onChange={e => set({ manualValue: Number(e.target.value) })}
                className="w-full rounded-lg border border-[var(--card-border)] bg-[var(--card)] px-3 py-2 text-sm text-[var(--text)]" />
            </div>
          )}
        </div>
      )}

      {action.type === 'log_event' && (
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1">Event name</label>
            <input value={String(action.eventName ?? '')} onChange={e => set({ eventName: e.target.value })}
              placeholder="e.g. lunch_rush_triggered"
              className="w-full rounded-lg border border-[var(--card-border)] bg-[var(--card)] px-3 py-2 text-sm text-[var(--text)] font-mono" />
          </div>
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1">Meta (JSON, optional)</label>
            <textarea rows={3}
              value={action.meta ? JSON.stringify(action.meta, null, 2) : ''}
              onChange={e => {
                const v = e.target.value.trim();
                if (!v) return set({ meta: undefined });
                try { set({ meta: JSON.parse(v) }); } catch { /* ignore until valid */ }
              }}
              placeholder='{ "key": "value" }'
              className="w-full rounded-lg border border-[var(--card-border)] bg-[var(--card)] px-3 py-2 text-xs text-[var(--text)] font-mono resize-none" />
          </div>
        </div>
      )}

      {action.type === 'webhook_call' && (
        <div className="space-y-3">
          <div className="grid grid-cols-4 gap-2">
            <select value={String(action.method ?? 'POST')} onChange={e => set({ method: e.target.value })}
              className="rounded-lg border border-[var(--card-border)] bg-[var(--card)] px-3 py-2 text-sm text-[var(--text)]">
              <option value="GET">GET</option>
              <option value="POST">POST</option>
              <option value="PUT">PUT</option>
              <option value="DELETE">DELETE</option>
            </select>
            <input className="col-span-3 rounded-lg border border-[var(--card-border)] bg-[var(--card)] px-3 py-2 text-sm text-[var(--text)] font-mono"
              placeholder="https://example.com/hook"
              value={String(action.url ?? '')} onChange={e => set({ url: e.target.value })} />
          </div>
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1">Headers (JSON, optional)</label>
            <textarea rows={2}
              value={action.headers ? JSON.stringify(action.headers, null, 2) : ''}
              onChange={e => {
                const v = e.target.value.trim();
                if (!v) return set({ headers: undefined });
                try { set({ headers: JSON.parse(v) }); } catch { /* ignore */ }
              }}
              placeholder='{ "Authorization": "Bearer …" }'
              className="w-full rounded-lg border border-[var(--card-border)] bg-[var(--card)] px-3 py-2 text-xs text-[var(--text)] font-mono resize-none" />
          </div>
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1">Body (string, optional)</label>
            <textarea rows={3} value={String(action.body ?? '')} onChange={e => set({ body: e.target.value || undefined })}
              className="w-full rounded-lg border border-[var(--card-border)] bg-[var(--card)] px-3 py-2 text-xs text-[var(--text)] font-mono resize-none" />
          </div>
        </div>
      )}

      {action.type === 'switch_zone_content' && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1">Zone id</label>
            <input value={String(action.zoneId ?? '')} onChange={e => set({ zoneId: e.target.value })}
              placeholder="e.g. left, header"
              className="w-full rounded-lg border border-[var(--card-border)] bg-[var(--card)] px-3 py-2 text-sm text-[var(--text)] font-mono" />
          </div>
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1">Content</label>
            <select value={String(action.contentId ?? '')} onChange={e => set({ contentId: e.target.value })}
              className="w-full rounded-lg border border-[var(--card-border)] bg-[var(--card)] px-3 py-2 text-sm text-[var(--text)]">
              <option value="">Select content…</option>
              {contentItems.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        </div>
      )}

      {action.type === 'record_analytics' && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">Metric name</label>
              <input value={String(action.metric ?? '')} onChange={e => set({ metric: e.target.value })}
                placeholder="e.g. dwell_seconds"
                className="w-full rounded-lg border border-[var(--card-border)] bg-[var(--card)] px-3 py-2 text-sm text-[var(--text)] font-mono" />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">Value</label>
              <input type="number" value={String(action.value ?? 0)} onChange={e => set({ value: Number(e.target.value) })}
                className="w-full rounded-lg border border-[var(--card-border)] bg-[var(--card)] px-3 py-2 text-sm text-[var(--text)]" />
            </div>
          </div>
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1">Tags (JSON, optional)</label>
            <textarea rows={2}
              value={action.tags ? JSON.stringify(action.tags, null, 2) : ''}
              onChange={e => {
                const v = e.target.value.trim();
                if (!v) return set({ tags: undefined });
                try { set({ tags: JSON.parse(v) }); } catch { /* ignore */ }
              }}
              placeholder='{ "channel": "store" }'
              className="w-full rounded-lg border border-[var(--card-border)] bg-[var(--card)] px-3 py-2 text-xs text-[var(--text)] font-mono resize-none" />
          </div>
        </div>
      )}

      {action.type === 'chain_rule_set' && (
        <div>
          <label className="block text-xs text-[var(--text-muted)] mb-1">Rule set to fire</label>
          <input value={String(action.ruleSetId ?? '')} onChange={e => set({ ruleSetId: e.target.value })}
            placeholder="Rule set id (UUID)"
            className="w-full rounded-lg border border-[var(--card-border)] bg-[var(--card)] px-3 py-2 text-sm text-[var(--text)] font-mono" />
        </div>
      )}

      {action.type === 'delay' && (
        <div className="flex items-center gap-2">
          <label className="text-sm text-[var(--text-muted)]">Wait for</label>
          <input type="number" min="0" step="0.1" value={String(action.seconds ?? 5)}
            onChange={e => set({ seconds: Number(e.target.value) })}
            className="w-28 rounded-lg border border-[var(--card-border)] bg-[var(--card)] px-3 py-2 text-sm text-[var(--text)]" />
          <span className="text-sm text-[var(--text-muted)]">seconds before next chained action</span>
        </div>
      )}

      {(action.type === 'stop_playback' || action.type === 'pause_playback') && (
        <p className="text-xs text-[var(--text-muted)] italic">No additional configuration needed.</p>
      )}

      {action.type === 'fade_volume' && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1">Target volume (0–100)</label>
            <input type="number" min="0" max="100" value={String(action.targetVolume ?? 50)}
              onChange={e => set({ targetVolume: Number(e.target.value) })}
              className="w-full rounded-lg border border-[var(--card-border)] bg-[var(--card)] px-3 py-2 text-sm text-[var(--text)]" />
          </div>
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1">Duration (seconds)</label>
            <input type="number" min="0" step="0.1" value={String(action.durationSeconds ?? 1)}
              onChange={e => set({ durationSeconds: Number(e.target.value) })}
              className="w-full rounded-lg border border-[var(--card-border)] bg-[var(--card)] px-3 py-2 text-sm text-[var(--text)]" />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

type EditorTab = 'conditions' | 'action' | 'targets';

export default function RuleSetsPage() {
  const { wsId } = useParams<{ wsId: string }>();
  const qc = useQueryClient();

  const [selectedId, setSelectedId] = useState<string | 'new' | null>(null);
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<EditorTab>('conditions');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  // ── Editor local state ────────────────────────────────────────────────────
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editEnabled, setEditEnabled] = useState<boolean>(true);
  const [editPriority, setEditPriority] = useState(0);
  const [editCooldown, setEditCooldown] = useState(0);
  const [editConditions, setEditConditions] = useState<ConditionGroup>(blankGroup());
  const [editAction, setEditAction] = useState<RuleSetAction>({ type: 'play_playlist' });
  const [editTargets, setEditTargets] = useState<{ targetType: TargetType; targetId: string }[]>([]);

  // ── Data queries ──────────────────────────────────────────────────────────
  const { data: ruleSetsData, isLoading } = useQuery<{ ruleSets: RuleSet[] }>({
    queryKey: ['rule-sets', wsId],
    queryFn: () => api.get(`/rule-sets?workspaceId=${wsId}`),
    enabled: !!wsId,
  });
  const ruleSets = ruleSetsData?.ruleSets ?? [];

  const { data: devicesData } = useQuery<DeviceItem[]>({
    queryKey: ['devices', wsId],
    queryFn: () => api.get(`/devices?workspaceId=${wsId}`),
    staleTime: 30_000,
    enabled: !!wsId,
  });
  const deviceList: DeviceItem[] = devicesData ?? [];

  const { data: groupsData } = useQuery<GroupItem[]>({
    queryKey: ['device-groups', wsId],
    queryFn: () => api.get(`/device-groups?workspaceId=${wsId}`),
    staleTime: 30_000,
    enabled: !!wsId,
  });
  const groupList: GroupItem[] = groupsData ?? [];

  const { data: playlistsData } = useQuery<{ playlists: PlaylistItem[] }>({
    queryKey: ['playlists-brief', wsId],
    queryFn: () => api.get(`/playlists?workspaceId=${wsId}&limit=500`),
    staleTime: 60_000,
    enabled: !!wsId,
  });
  const playlists = playlistsData?.playlists ?? [];

  const { data: contentData } = useQuery<{ items: ContentItem[] }>({
    queryKey: ['content-brief', wsId],
    queryFn: () => api.get(`/content?workspaceId=${wsId}&limit=500`),
    staleTime: 60_000,
    enabled: !!wsId,
  });
  const contentItems = contentData?.items ?? [];

  const { data: schedulesData } = useQuery<{ schedules: ScheduleItem[] }>({
    queryKey: ['schedules-brief', wsId],
    queryFn: () => api.get(`/schedules?workspaceId=${wsId}&limit=500`),
    staleTime: 60_000,
    enabled: !!wsId,
  });
  const scheduleItems = schedulesData?.schedules ?? [];

  const { data: sensorsData } = useQuery<{ sensors: SensorItem[] }>({
    queryKey: ['sensors', wsId],
    queryFn: () => api.get(`/sensors?workspaceId=${wsId}&limit=200`),
    staleTime: 60_000,
    enabled: !!wsId,
  });
  const sensorList = sensorsData?.sensors ?? [];

  // ── Mutations ──────────────────────────────────────────────────────────────
  const createMut = useMutation({
    mutationFn: (body: object) => api.post('/rule-sets', body) as Promise<RuleSet>,
    onSuccess: (data: RuleSet) => {
      toast.success('Rule set created');
      void qc.invalidateQueries({ queryKey: ['rule-sets', wsId] });
      setSelectedId(data.id);
    },
    onError: () => toast.error('Failed to create rule set'),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, body }: { id: string; body: object }) => api.patch(`/rule-sets/${id}`, body),
    onSuccess: () => {
      toast.success('Rule set saved');
      void qc.invalidateQueries({ queryKey: ['rule-sets', wsId] });
    },
    onError: () => toast.error('Failed to save rule set'),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/rule-sets/${id}`),
    onSuccess: () => {
      toast.success('Rule set deleted');
      void qc.invalidateQueries({ queryKey: ['rule-sets', wsId] });
      setSelectedId(null);
      setConfirmDelete(null);
    },
    onError: () => toast.error('Failed to delete rule set'),
  });

  const toggleMut = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      api.patch(`/rule-sets/${id}`, { enabled }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['rule-sets', wsId] }),
  });

  const fireMut = useMutation({
    mutationFn: (id: string) => api.post(`/rule-sets/${id}/fire`, {}) as Promise<{ firedTo: number }>,
    onSuccess: (data: { firedTo: number }) => toast.success(`Triggered on ${data.firedTo} device(s)`),
    onError: () => toast.error('Failed to trigger rule set'),
  });

  // ── Select rule set → populate editor ─────────────────────────────────────
  function selectRuleSet(rs: RuleSet) {
    setSelectedId(rs.id);
    setEditName(rs.name);
    setEditDescription(rs.description ?? '');
    setEditEnabled(rs.enabled);
    setEditPriority(rs.priority);
    setEditCooldown(rs.cooldownSeconds);
    setEditConditions(rs.conditions ?? blankGroup());
    setEditAction(rs.action ?? { type: 'play_playlist' });
    setEditTargets(rs.targets.map(t => ({ targetType: t.targetType, targetId: t.targetId })));
    setActiveTab('conditions');
  }

  function startNew() {
    setSelectedId('new');
    setEditName('New Rule Set');
    setEditDescription('');
    setEditEnabled(true);
    setEditPriority(0);
    setEditCooldown(0);
    setEditConditions(blankGroup());
    setEditAction({ type: 'play_playlist' });
    setEditTargets([]);
    setActiveTab('conditions');
  }

  function handleSave() {
    const body = {
      workspaceId: wsId,
      name: editName,
      description: editDescription || null,
      enabled: editEnabled,
      priority: editPriority,
      cooldownSeconds: editCooldown,
      conditions: editConditions,
      action: editAction,
      targets: editTargets,
    };
    if (selectedId === 'new') {
      createMut.mutate(body);
    } else if (selectedId) {
      updateMut.mutate({ id: selectedId, body });
    }
  }

  function toggleTarget(type: TargetType, id: string) {
    setEditTargets(prev => {
      const exists = prev.some(t => t.targetType === type && t.targetId === id);
      if (exists) return prev.filter(t => !(t.targetType === type && t.targetId === id));
      return [...prev, { targetType: type, targetId: id }];
    });
  }

  const filtered = ruleSets.filter(rs =>
    !search || rs.name.toLowerCase().includes(search.toLowerCase())
  );

  const selectedRuleSet = selectedId && selectedId !== 'new'
    ? ruleSets.find(rs => rs.id === selectedId) ?? null
    : null;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full overflow-hidden">
      {/* ── List panel ──────────────────────────────────────────────────── */}
      <div className="w-72 shrink-0 border-r border-[var(--border)] flex flex-col h-full overflow-hidden">
        {/* Header */}
        <div className="p-4 border-b border-[var(--border)] space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-[var(--text)] flex items-center gap-1.5">
              <Zap className="w-4 h-4 text-[var(--blue)]" />
              Rule Sets
            </span>
            <button
              type="button"
              onClick={startNew}
              className="flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-lg bg-[var(--blue)] hover:bg-[var(--blue-hover,#2563eb)] text-white transition-colors"
            >
              <Plus className="w-3.5 h-3.5" /> New
            </button>
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-muted)]" />
            <input
              placeholder="Search…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-[var(--card-border)] bg-[var(--card)] text-xs text-[var(--text)] placeholder:text-[var(--text-muted)]"
            />
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {isLoading ? (
            Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-lg" />)
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={<Zap className="w-8 h-8" />}
              title="No rule sets"
              description="Create your first rule set to automate content based on time, BLE proximity, or sensor readings."
            />
          ) : (
            filtered.map(rs => (
              <button
                key={rs.id}
                type="button"
                onClick={() => selectRuleSet(rs)}
                className={`w-full text-left rounded-xl p-3 transition-colors ${
                  selectedId === rs.id
                    ? 'bg-[var(--blue)] text-white'
                    : 'hover:bg-[var(--surface)] text-[var(--text)]'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-sm font-medium truncate">{rs.name}</span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                      rs.enabled
                        ? selectedId === rs.id ? 'bg-white/20 text-white' : 'bg-green-500/15 text-green-400'
                        : selectedId === rs.id ? 'bg-white/10 text-white/60' : 'bg-[var(--surface)] text-[var(--text-muted)]'
                    }`}>{rs.enabled ? 'on' : 'off'}</span>
                  </div>
                </div>
                <div className={`text-xs mt-0.5 flex items-center gap-2 ${selectedId === rs.id ? 'text-white/70' : 'text-[var(--text-muted)]'}`}>
                  <ActionIcon type={rs.action.type} />
                  <span className="truncate">{actionLabel(rs.action)}</span>
                </div>
                <div className={`text-[10px] mt-1 ${selectedId === rs.id ? 'text-white/60' : 'text-[var(--text-muted)]'}`}>
                  {rs.targets.length} target{rs.targets.length !== 1 ? 's' : ''} · fired {rs.fireCount}×
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* ── Editor panel ────────────────────────────────────────────────── */}
      {selectedId ? (
        <div className="flex-1 overflow-y-auto flex flex-col">
          {/* Editor header */}
          <div className="sticky top-0 z-10 bg-[var(--bg)] border-b border-[var(--border)] px-6 py-4 flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <input
                value={editName}
                onChange={e => setEditName(e.target.value)}
                className="text-lg font-semibold text-[var(--text)] bg-transparent border-none outline-none w-full"
                placeholder="Rule set name"
              />
              {selectedRuleSet && (
                <div className="text-xs text-[var(--text-muted)] mt-0.5">
                  Last fired: {formatRelative(selectedRuleSet.lastFiredAt)} · {selectedRuleSet.fireCount} total fires
                </div>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <ToggleSwitch checked={editEnabled} onChange={() => setEditEnabled(v => !v)} />
              <span className="text-xs text-[var(--text-muted)]">{editEnabled ? 'Enabled' : 'Disabled'}</span>
            </div>
            {selectedId !== 'new' && (
              <button
                type="button"
                onClick={() => fireMut.mutate(selectedId)}
                disabled={fireMut.isPending}
                title="Manual test trigger"
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-[var(--card-border)] text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface)] transition-colors"
              >
                <Send className="w-3.5 h-3.5" />
                Test fire
              </button>
            )}
            {selectedId !== 'new' && (
              <button
                type="button"
                onClick={() => setConfirmDelete(selectedId)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              type="button"
              onClick={handleSave}
              disabled={createMut.isPending || updateMut.isPending}
              className="flex items-center gap-1.5 px-4 py-1.5 text-sm rounded-lg bg-[var(--blue)] hover:bg-[var(--blue-hover,#2563eb)] text-white font-medium transition-colors disabled:opacity-50"
            >
              <Check className="w-3.5 h-3.5" />
              {createMut.isPending || updateMut.isPending ? 'Saving…' : 'Save'}
            </button>
          </div>

          {/* Meta row */}
          <div className="px-6 py-3 border-b border-[var(--border)] flex items-center gap-4 flex-wrap">
            <label className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
              Priority
              <input type="number" min={0} max={100} value={editPriority} onChange={e => setEditPriority(Number(e.target.value))}
                className="w-16 rounded border border-[var(--card-border)] bg-[var(--card)] px-2 py-1 text-xs text-[var(--text)]" />
            </label>
            <label className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
              Cooldown (s)
              <input type="number" min={0} value={editCooldown} onChange={e => setEditCooldown(Number(e.target.value))}
                className="w-20 rounded border border-[var(--card-border)] bg-[var(--card)] px-2 py-1 text-xs text-[var(--text)]" />
            </label>
            <label className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
              Description
              <input value={editDescription} onChange={e => setEditDescription(e.target.value)} placeholder="Optional"
                className="w-64 rounded border border-[var(--card-border)] bg-[var(--card)] px-2 py-1 text-xs text-[var(--text)]" />
            </label>
          </div>

          {/* Tabs */}
          <div className="flex border-b border-[var(--border)]">
            {(['conditions', 'action', 'targets'] as EditorTab[]).map(tab => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={`px-5 py-3 text-sm font-medium capitalize transition-colors border-b-2 -mb-px ${
                  activeTab === tab
                    ? 'border-[var(--blue)] text-[var(--text)]'
                    : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text)]'
                }`}
              >{tab}</button>
            ))}
          </div>

          {/* Tab content */}
          <div className="flex-1 p-6">
            {/* ── Conditions tab ─────────────────────────────────────── */}
            {activeTab === 'conditions' && (
              <div className="max-w-2xl space-y-4">
                <p className="text-xs text-[var(--text-muted)]">
                  Build a condition tree. The device evaluates the root AND/OR group continuously.
                  <strong className="text-[var(--text)]"> Sensor value</strong> conditions are evaluated server-side on each new reading.
                </p>
                <ConditionNodeEditor
                  node={editConditions}
                  sensors={sensorList}
                  depth={0}
                  onUpdate={n => setEditConditions(n as ConditionGroup)}
                  onDelete={() => {}} // root can't be deleted
                />
              </div>
            )}

            {/* ── Action tab ─────────────────────────────────────────── */}
            {activeTab === 'action' && (
              <div className="max-w-lg space-y-4">
                <p className="text-xs text-[var(--text-muted)]">
                  Choose what the device does when the conditions are met.
                </p>
                <ActionEditor
                  action={editAction}
                  playlists={playlists}
                  contentItems={contentItems}
                  schedules={scheduleItems}
                  onChange={setEditAction}
                />
              </div>
            )}

            {/* ── Targets tab ────────────────────────────────────────── */}
            {activeTab === 'targets' && (
              <div className="max-w-2xl space-y-6">
                <p className="text-xs text-[var(--text-muted)]">
                  Assign this rule set to specific devices, device groups, or all devices in the workspace.
                  The rule set is published to all matching devices immediately on save.
                </p>

                {/* Workspace-wide toggle */}
                <div className="flex items-center justify-between p-3 rounded-xl border border-[var(--card-border)] bg-[var(--card)]">
                  <div>
                    <p className="text-sm font-medium text-[var(--text)]">All devices in workspace</p>
                    <p className="text-xs text-[var(--text-muted)]">Targets every device regardless of group</p>
                  </div>
                  <ToggleSwitch
                    checked={editTargets.some(t => t.targetType === 'workspace' && t.targetId === wsId)}
                    onChange={() => {
                      const has = editTargets.some(t => t.targetType === 'workspace' && t.targetId === wsId);
                      if (!has) setEditTargets(prev => [...prev.filter(t => t.targetType !== 'workspace'), { targetType: 'workspace', targetId: wsId! }]);
                      else setEditTargets(prev => prev.filter(t => t.targetType !== 'workspace'));
                    }}
                  />
                </div>

                {/* Device groups */}
                {groupList.length > 0 && (
                  <SectionCard>
                    <SectionCardHeader>Device Groups</SectionCardHeader>
                    <SectionCardBody>
                      <div className="space-y-1.5">
                        {groupList.map(g => (
                          <label key={g.id} className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-[var(--surface)] cursor-pointer">
                            <input
                              type="checkbox"
                              checked={editTargets.some(t => t.targetType === 'group' && t.targetId === g.id)}
                              onChange={() => toggleTarget('group', g.id)}
                              className="accent-[var(--blue)]"
                            />
                            <span className="text-sm text-[var(--text)]">{g.name}</span>
                          </label>
                        ))}
                      </div>
                    </SectionCardBody>
                  </SectionCard>
                )}

                {/* Devices */}
                <SectionCard>
                  <SectionCardHeader>Individual Devices</SectionCardHeader>
                  <SectionCardBody>
                    <div className="space-y-1 max-h-64 overflow-y-auto">
                      {deviceList.length === 0 ? (
                        <p className="text-xs text-[var(--text-muted)]">No devices in workspace</p>
                      ) : deviceList.map(d => (
                        <label key={d.id} className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-[var(--surface)] cursor-pointer">
                          <input
                            type="checkbox"
                            checked={editTargets.some(t => t.targetType === 'device' && t.targetId === d.id)}
                            onChange={() => toggleTarget('device', d.id)}
                            className="accent-[var(--blue)]"
                          />
                          <span className={`w-2 h-2 rounded-full shrink-0 ${d.status === 'online' ? 'bg-green-400' : 'bg-gray-500'}`} />
                          <span className="text-sm text-[var(--text)]">{d.name}</span>
                        </label>
                      ))}
                    </div>
                  </SectionCardBody>
                </SectionCard>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-[var(--text-muted)]">
          <div className="text-center space-y-3">
            <Zap className="w-12 h-12 opacity-20 mx-auto" />
            <p className="text-sm">Select a rule set or create a new one</p>
          </div>
        </div>
      )}

      {/* Confirm delete modal */}
      {confirmDelete && (
        <Modal onClose={() => setConfirmDelete(null)}>
          <ModalHeader>Delete Rule Set</ModalHeader>
          <ModalBody>
            <p className="text-sm text-[var(--text-muted)]">
              This rule set will be removed from all assigned devices. This cannot be undone.
            </p>
          </ModalBody>
          <ModalFooter>
            <ModalSecondaryButton onClick={() => setConfirmDelete(null)}>Cancel</ModalSecondaryButton>
            <ModalPrimaryButton
              onClick={() => deleteMut.mutate(confirmDelete)}
              disabled={deleteMut.isPending}

            >
              {deleteMut.isPending ? 'Deleting…' : 'Delete'}
            </ModalPrimaryButton>
          </ModalFooter>
        </Modal>
      )}
    </div>
  );
}
