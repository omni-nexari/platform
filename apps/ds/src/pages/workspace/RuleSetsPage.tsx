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

type ConditionType = 'ble_beacon' | 'time_window' | 'day_of_week' | 'sensor_value' | 'device_online' | 'device_offline';
type ActionType = 'play_content' | 'play_playlist' | 'play_schedule' | 'message_overlay' | 'device_control' | 'send_notification' | 'emergency_override' | 'launch_app';
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
    case 'play_content':       return 'Play Content';
    case 'play_playlist':      return 'Play Playlist';
    case 'play_schedule':      return 'Play Schedule';
    case 'message_overlay':    return 'Show Message Overlay';
    case 'device_control':     return `Device Control: ${action.command}`;
    case 'send_notification':  return 'Send Notification';
    case 'emergency_override': return 'Emergency Override';
    case 'launch_app':         return `Launch App: ${action.appId}`;
    default:                   return action.type;
  }
}

function ActionIcon({ type }: { type: ActionType }) {
  switch (type) {
    case 'play_content':
    case 'play_playlist':     return <Play className="w-3.5 h-3.5" />;
    case 'play_schedule':     return <Calendar className="w-3.5 h-3.5" />;
    case 'message_overlay':   return <Maximize2 className="w-3.5 h-3.5" />;
    case 'device_control':    return <Volume2 className="w-3.5 h-3.5" />;
    case 'send_notification': return <Bell className="w-3.5 h-3.5" />;
    case 'emergency_override':return <AlertTriangle className="w-3.5 h-3.5" />;
    case 'launch_app':        return <Rocket className="w-3.5 h-3.5" />;
    default:                  return <Zap className="w-3.5 h-3.5" />;
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
    case 'ble_beacon':    return { type, uuid: '', rssiThreshold: -75 };
    case 'time_window':   return { type, start: '08:00', end: '17:00' };
    case 'day_of_week':   return { type, days: [1, 2, 3, 4, 5] };
    case 'sensor_value':  return { type, sensorId: '', field: 'value', operator: '>', value: 0 };
    case 'device_online': return { type };
    case 'device_offline':return { type };
    default:              return { type };
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

  // device_online / device_offline — no sub-fields
  return <p className="text-xs text-[var(--text-muted)] italic">No additional configuration needed.</p>;
}

const CONDITION_TYPE_LABELS: Record<ConditionType, string> = {
  ble_beacon:    'BLE Beacon',
  time_window:   'Time Window',
  day_of_week:   'Day of Week',
  sensor_value:  'Sensor Value',
  device_online: 'Device Online',
  device_offline:'Device Offline',
};

function ConditionTypeIcon({ type }: { type: ConditionType }) {
  switch (type) {
    case 'ble_beacon':    return <Radio className="w-3.5 h-3.5" />;
    case 'time_window':   return <Clock className="w-3.5 h-3.5" />;
    case 'day_of_week':   return <Calendar className="w-3.5 h-3.5" />;
    case 'sensor_value':  return <Activity className="w-3.5 h-3.5" />;
    case 'device_online': return <Monitor className="w-3.5 h-3.5" />;
    case 'device_offline':return <MonitorOff className="w-3.5 h-3.5" />;
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

const ACTION_TYPE_OPTIONS: { value: ActionType; label: string }[] = [
  { value: 'play_content',        label: 'Play Content' },
  { value: 'play_playlist',       label: 'Play Playlist' },
  { value: 'play_schedule',       label: 'Play Schedule' },
  { value: 'message_overlay',     label: 'Show Message Overlay' },
  { value: 'device_control',      label: 'Device Control' },
  { value: 'send_notification',   label: 'Send Notification' },
  { value: 'emergency_override',  label: 'Emergency Override' },
  { value: 'launch_app',          label: 'Launch App (Tizen)' },
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
          {ACTION_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
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
