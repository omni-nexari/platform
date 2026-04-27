import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, Monitor, Search, Wifi, X } from 'lucide-react';
import { api } from '../lib/api.js';
import AssignedTagPills, { type AssignedTag } from './AssignedTagPills.js';
import { ToggleSwitch } from './UiPrimitives.js';

interface DevicePickerItem {
  id: string;
  name: string;
  status: 'unclaimed' | 'online' | 'offline' | 'error';
  updatedAt: string;
  lastSeen: string | null;
  modelName: string | null;
  modelCode: string | null;
  resolution: string | null;
  timezone: string;
  ipAddress: string | null;
  connectionType: 'wifi' | 'ethernet' | null;
  wifiSsid: string | null;
  assignedTags?: AssignedTag[];
  latestScreenshotId: string | null;
}

export interface PickedDevice {
  id: string;
  name: string;
  status: DevicePickerItem['status'];
}

type SortKey = 'date-desc' | 'date-asc' | 'name-asc' | 'name-desc';
type Tab = 'recent' | 'devices';

function formatTimezoneLabel(value: string | null | undefined) {
  if (!value) return '';

  const trimmed = value.trim();
  if (!trimmed) return '';
  if (!trimmed.includes('/')) return trimmed.toUpperCase();

  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: trimmed,
      timeZoneName: 'short',
    }).formatToParts(new Date());
    return parts.find((part) => part.type === 'timeZoneName')?.value?.trim() || trimmed;
  } catch {
    return trimmed;
  }
}

function sortLabel(k: SortKey) {
  return { 'date-desc': 'Date ↓', 'date-asc': 'Date ↑', 'name-asc': 'Name A-Z', 'name-desc': 'Name Z-A' }[k];
}

function statusMeta(status: DevicePickerItem['status']) {
  if (status === 'online') return { label: 'Online', className: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' };
  if (status === 'error') return { label: 'Error', className: 'bg-red-500/15 text-red-300 border-red-500/30' };
  if (status === 'unclaimed') return { label: 'Unclaimed', className: 'bg-amber-500/15 text-amber-300 border-amber-500/30' };
  return { label: 'Offline', className: 'bg-white/5 text-[var(--text-muted)] border-[var(--border)]' };
}

function DeviceCard({
  item,
  selected,
  onToggle,
}: {
  item: DevicePickerItem;
  selected: boolean;
  onToggle: () => void;
}) {
  const status = statusMeta(item.status);
  const subtitle = item.modelName || item.modelCode || item.ipAddress || 'Display';
  const networkLabel = item.connectionType === 'wifi'
    ? (item.wifiSsid ? `Wi-Fi • ${item.wifiSsid}` : 'Wi-Fi')
    : item.connectionType === 'ethernet'
    ? 'Ethernet'
    : 'Connection unknown';
  const timezoneLabel = formatTimezoneLabel(item.timezone);

  return (
    <div
      onClick={onToggle}
      className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors select-none ${
        selected
          ? 'border-[var(--accent)] bg-[var(--accent)]/8'
          : 'border-[var(--card-border)] bg-[var(--card)] hover:border-[var(--accent)]/40 hover:bg-[var(--surface-raised)]'
      }`}
    >
      <div className={`shrink-0 w-4 h-4 rounded-full border-2 flex items-center justify-center transition-colors ${
        selected ? 'border-[var(--accent)] bg-[var(--accent)]' : 'border-[var(--border)]'
      }`}>
        {selected && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
      </div>

      <div className="relative shrink-0 w-[90px] h-[54px] rounded-lg overflow-hidden bg-[var(--surface-raised)] border border-[var(--border)]">
        {item.latestScreenshotId ? (
          <img
            src={`/api/v1/devices/${item.id}/screenshots/${item.latestScreenshotId}`}
            alt=""
            className="w-full h-full object-cover"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; (e.currentTarget.nextElementSibling as HTMLElement | null)?.style.setProperty('display', 'flex'); }}
          />
        ) : null}
        <div className={`w-full h-full flex flex-col items-center justify-center gap-1 text-[var(--text-muted)] ${item.latestScreenshotId ? 'hidden' : ''}`}>
          <Monitor size={18} />
          <span className="text-[10px] font-semibold uppercase tracking-wide">{item.resolution ?? 'Screen'}</span>
        </div>
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-semibold text-[var(--text)] truncate leading-tight">{item.name}</p>
          <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${status.className}`}>
            <span className="w-1.5 h-1.5 rounded-full bg-current opacity-80" />
            {status.label}
          </span>
        </div>
        <div className="flex items-center gap-2 mt-1 flex-wrap text-[11px] text-[var(--text-muted)]">
          <span className="truncate max-w-[180px]">{subtitle}</span>
          <span>•</span>
          <span>{networkLabel}</span>
          {timezoneLabel ? <><span>•</span><span className="font-mono">{timezoneLabel}</span></> : null}
        </div>
        <div className="mt-1">
          <AssignedTagPills tags={item.assignedTags} />
        </div>
      </div>
    </div>
  );
}

interface DevicePickerModalProps {
  open: boolean;
  onClose: () => void;
  onSelect: (devices: PickedDevice[]) => void;
  workspaceId: string;
  multi?: boolean;
  title?: string;
  confirmLabel?: string;
}

export default function DevicePickerModal({
  open,
  onClose,
  onSelect,
  workspaceId,
  multi = true,
  title = 'Select Devices',
  confirmLabel = 'Select',
}: DevicePickerModalProps) {
  const [tab, setTab] = useState<Tab>('recent');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortKey>('date-desc');
  const [sortOpen, setSortOpen] = useState(false);
  const [hideOffline, setHideOffline] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const { data: deviceItems = [], isLoading } = useQuery<DevicePickerItem[]>({
    queryKey: ['picker-devices', workspaceId],
    queryFn: () => api.get(`/devices?workspaceId=${workspaceId}`),
    enabled: open && !!workspaceId,
    staleTime: 30_000,
  });

  const filteredDevices = useMemo(() => {
    const query = search.trim().toLowerCase();
    return deviceItems.filter((item) => {
      if (hideOffline && item.status !== 'online') return false;
      if (!query) return true;
      return [
        item.name,
        item.modelName,
        item.modelCode,
        item.ipAddress,
        item.wifiSsid,
        item.timezone,
      ].some((value) => value?.toLowerCase().includes(query));
    });
  }, [deviceItems, hideOffline, search]);

  const sortItems = (items: DevicePickerItem[]) => [...items].sort((a, b) => {
    if (sort === 'date-desc') return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    if (sort === 'date-asc') return new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
    if (sort === 'name-asc') return a.name.localeCompare(b.name);
    return b.name.localeCompare(a.name);
  });

  const sortedDevices = useMemo(() => sortItems(filteredDevices), [filteredDevices, sort]);
  const recentDevices = useMemo(() => sortItems(filteredDevices).slice(0, 30), [filteredDevices, sort]);
  const deviceMap = useMemo(() => Object.fromEntries(deviceItems.map((item) => [item.id, item])), [deviceItems]);

  const totalCount = tab === 'recent' ? recentDevices.length : sortedDevices.length;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (!multi) next.clear();
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function handleConfirm() {
    onSelect(
      [...selected]
        .map((id) => deviceMap[id])
        .filter((item): item is DevicePickerItem => !!item)
        .map((item) => ({ id: item.id, name: item.name, status: item.status })),
    );
    setSelected(new Set());
  }

  function handleClose() {
    setSelected(new Set());
    setSearch('');
    onClose();
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="modal-backdrop" onClick={handleClose} />
      <div className="modal-shell modal-shell-lg" style={{ minHeight: '520px', maxHeight: '90vh' }}>
        <div className="modal-header">
          <h2 className="modal-title">{title}</h2>
          <button onClick={handleClose} className="modal-close">
            <X size={20} />
          </button>
        </div>

        <div className="flex border-b" style={{ borderColor: 'var(--border)' }}>
          {(['recent', 'devices'] as Tab[]).map((itemTab) => (
            <button
              key={itemTab}
              onClick={() => setTab(itemTab)}
              className={`modal-tab ${tab === itemTab ? 'modal-tab-active' : ''}`}
            >
              {itemTab}
            </button>
          ))}
        </div>

        <div className="px-4 pt-3 pb-2 space-y-2">
          <div className="flex items-center gap-2">
            <div className="flex-1 flex items-center gap-2 px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--surface)]">
              <Search size={14} className="text-[var(--text-muted)]" />
              <input
                type="text"
                placeholder={`Search ${tab}`}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="flex-1 bg-transparent text-sm text-[var(--text)] outline-none placeholder:text-[var(--text-muted)]"
              />
            </div>
            <div className="relative">
              <button
                onClick={() => setSortOpen((openState) => !openState)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-sm text-[var(--text)] hover:bg-[var(--surface-raised)] transition-colors"
              >
                {sortLabel(sort)}
                <ChevronDown size={12} className="text-[var(--text-muted)]" />
              </button>
              {sortOpen && (
                <div
                  className="absolute right-0 top-full mt-1 z-10 rounded-xl shadow-lg border py-1 min-w-[130px]"
                  style={{ background: 'var(--modal-bg)', borderColor: 'var(--border)' }}
                >
                  {(['date-desc', 'date-asc', 'name-asc', 'name-desc'] as SortKey[]).map((key) => (
                    <button
                      key={key}
                      onClick={() => { setSort(key); setSortOpen(false); }}
                      className={`w-full text-left px-4 py-1.5 text-xs ${sort === key ? 'text-[var(--accent)]' : 'text-[var(--text-muted)] hover:text-[var(--text)]'}`}
                    >
                      {sortLabel(key)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between">
            <p className="text-sm text-[var(--text-muted)]">
              {isLoading ? 'Loading…' : <><span className="font-semibold text-[var(--accent)]">{totalCount}</span> devices</>}
            </p>
            <ToggleSwitch label="Hide offline" checked={hideOffline} onChange={() => setHideOffline((value) => !value)} />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 pb-2">
          {isLoading ? (
            <div className="flex items-center justify-center h-32 text-sm text-[var(--text-muted)]">Loading…</div>
          ) : totalCount === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 h-40 text-sm text-[var(--text-muted)]">
              <Wifi size={18} />
              <span>No devices found</span>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {(tab === 'recent' ? recentDevices : sortedDevices).map((item) => (
                <DeviceCard
                  key={item.id}
                  item={item}
                  selected={selected.has(item.id)}
                  onToggle={() => toggle(item.id)}
                />
              ))}
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button onClick={handleClose} className="modal-secondary-btn">
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={selected.size === 0}
            className="modal-primary-btn"
          >
            {selected.size > 0 ? `${confirmLabel}${multi && selected.size > 1 ? ` (${selected.size})` : ''}` : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}