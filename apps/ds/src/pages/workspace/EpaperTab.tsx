import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Battery, RefreshCw, Power, Sun, Wifi, Zap, Clock, AlertTriangle } from 'lucide-react';
import { api } from '../../lib/api.js';
import {
  ActionButton,
  Badge,
  Callout,
  SectionCard,
  SectionCardBody,
  SectionCardHeader,
  ToggleSwitch,
} from '../../components/UiPrimitives.js';
import { formatDistanceToNow } from '../utils/time.js';

// Locked defaults — match apps/api defaults and apps/nexari-epaper config.
const DEFAULT_SETTINGS: EpaperSettings = {
  networkStandby: 'ON',
  autoSleep: 'NEVER',
  screenRefreshTime: { hour: 2, minute: 0 },
  ledMode: 'AUTO',
  batteryWarningIcon: true,
  minSwapRateSec: 15,
};

// Three operator-friendly presets per the locked option list.
const PRESETS: Record<string, { label: string; description: string; settings: EpaperSettings }> = {
  'always-on': {
    label: 'Always on',
    description: 'Push-first. Network standby always on, no auto-sleep. Best for mains-powered panels.',
    settings: {
      networkStandby: 'ON', autoSleep: 'NEVER',
      screenRefreshTime: { hour: 2, minute: 0 }, ledMode: 'AUTO',
      batteryWarningIcon: true, minSwapRateSec: 15,
    },
  },
  'battery-balanced': {
    label: 'Battery balanced',
    description: 'Default. Network standby on, sleep after 1h idle. Good for battery panels with daily use.',
    settings: {
      networkStandby: 'ON', autoSleep: '01:00',
      screenRefreshTime: { hour: 2, minute: 0 }, ledMode: 'AUTO',
      batteryWarningIcon: true, minSwapRateSec: 30,
    },
  },
  'battery-saver': {
    label: 'Battery saver',
    description: 'Minimum power. Network standby off, sleep after 15 min. Wakes on schedule only.',
    settings: {
      networkStandby: 'OFF', autoSleep: '00:15',
      screenRefreshTime: { hour: 3, minute: 0 }, ledMode: 'OFF',
      batteryWarningIcon: true, minSwapRateSec: 60,
    },
  },
};

export interface EpaperSettings {
  networkStandby?: 'ON' | 'OFF';
  autoSleep?: string;
  screenRefreshTime?: { hour: number; minute: number } | null;
  ledMode?: 'ON' | 'OFF' | 'AUTO';
  batteryWarningIcon?: boolean;
  minSwapRateSec?: number;
}

export interface EpaperDeviceFields {
  id: string;
  status: 'unclaimed' | 'online' | 'offline' | 'error';
  panelW?: number | null;
  panelH?: number | null;
  panelOrientation?: 'landscape' | 'portrait' | null;
  batteryPct?: number | null;
  lastWakeReason?: string | null;
  nextWakeAt?: string | null;
  epaperApiVersion?: string | null;
  epaperSettings?: EpaperSettings | null;
  publishedTarget: { id: string; type: 'content' | 'playlist' | 'schedule'; name: string } | null;
}

function formatPanel(d: EpaperDeviceFields): string {
  if (!d.panelW || !d.panelH) return 'Unknown';
  const orient = d.panelOrientation ? ` (${d.panelOrientation})` : '';
  return `${d.panelW} × ${d.panelH}${orient}`;
}

function formatRefreshTime(rt: { hour: number; minute: number } | null | undefined): string {
  if (!rt) return 'Disabled';
  const hh = String(rt.hour).padStart(2, '0');
  const mm = String(rt.minute).padStart(2, '0');
  return `${hh}:${mm}`;
}

export default function EpaperTab({ device }: { device: EpaperDeviceFields }) {
  const queryClient = useQueryClient();
  const isOnline = device.status === 'online';
  const persisted = device.epaperSettings ?? null;

  // Local form state — initialised from persisted, falls back to defaults.
  const [draft, setDraft] = useState<EpaperSettings>(() =>
    Object.assign({}, DEFAULT_SETTINGS, persisted ?? {}),
  );

  // Resync draft whenever the upstream device settings change (e.g. via WS).
  useEffect(() => {
    setDraft(Object.assign({}, DEFAULT_SETTINGS, persisted ?? {}));
  }, [JSON.stringify(persisted)]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(persisted ?? DEFAULT_SETTINGS), [draft, persisted]);

  // ── Mutations ───────────────────────────────────────────────────────────
  const wake = useMutation({
    mutationFn: () => api.post(`/devices/${device.id}/epaper/wake`, null),
    onSuccess: () => toast.success('Wake command sent'),
    onError: (e: any) => toast.error('Wake failed: ' + (e?.message ?? 'unknown')),
  });

  const refresh = useMutation({
    mutationFn: () => api.post(`/devices/${device.id}/epaper/refresh-now`, null),
    onSuccess: () => toast.success('Refresh command sent'),
    onError: (e: any) => toast.error('Refresh failed: ' + (e?.message ?? 'unknown')),
  });

  const sleep = useMutation({
    mutationFn: () => api.post(`/devices/${device.id}/epaper/sleep`, null),
    onSuccess: () => toast.success('Sleep command sent'),
    onError: (e: any) => toast.error('Sleep failed: ' + (e?.message ?? 'unknown')),
  });

  const save = useMutation({
    mutationFn: (settings: EpaperSettings) => api.patch(`/devices/${device.id}/epaper/settings`, settings),
    onSuccess: () => {
      toast.success('Settings saved');
      queryClient.invalidateQueries({ queryKey: ['device', device.id] });
    },
    onError: (e: any) => toast.error('Save failed: ' + (e?.message ?? 'unknown')),
  });

  const applyPreset = (key: keyof typeof PRESETS) => {
    const p = PRESETS[key];
    if (p) setDraft(Object.assign({}, p.settings));
  };

  const battery = device.batteryPct;
  const batteryTone: 'success' | 'warning' | 'danger' | 'neutral' =
    battery == null ? 'neutral' : battery > 50 ? 'success' : battery > 20 ? 'warning' : 'danger';

  return (
    <div className="space-y-6">
      {!isOnline && (
        <Callout tone="warning" icon={<AlertTriangle size={16} />}>
          Device is offline. Quick actions and live settings push will be queued until it reconnects.
        </Callout>
      )}

      {/* ── Display + Battery overview ──────────────────────────────────── */}
      <SectionCard>
        <SectionCardHeader>
          <div className="flex items-center gap-2"><Sun size={16} /> Panel</div>
        </SectionCardHeader>
        <SectionCardBody>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <div><dt className="text-[var(--text-muted)] text-xs">Resolution</dt><dd>{formatPanel(device)}</dd></div>
            <div><dt className="text-[var(--text-muted)] text-xs">E-Paper API</dt><dd>{device.epaperApiVersion ?? 'Unknown'}</dd></div>
            <div>
              <dt className="text-[var(--text-muted)] text-xs">Battery</dt>
              <dd className="flex items-center gap-2">
                <Battery size={14} />
                {battery != null ? (
                  <>
                    <span>{battery}%</span>
                    <Badge tone={batteryTone}>{batteryTone === 'success' ? 'Healthy' : batteryTone === 'warning' ? 'Low' : batteryTone === 'danger' ? 'Critical' : 'Unknown'}</Badge>
                  </>
                ) : 'Unknown'}
              </dd>
            </div>
            <div>
              <dt className="text-[var(--text-muted)] text-xs">Last wake</dt>
              <dd>{device.lastWakeReason ?? 'Unknown'}</dd>
            </div>
            <div>
              <dt className="text-[var(--text-muted)] text-xs">Next scheduled wake</dt>
              <dd>{device.nextWakeAt ? formatDistanceToNow(device.nextWakeAt) : '—'}</dd>
            </div>
            <div>
              <dt className="text-[var(--text-muted)] text-xs">Currently published</dt>
              <dd>{device.publishedTarget ? `${device.publishedTarget.type}: ${device.publishedTarget.name}` : 'None'}</dd>
            </div>
          </dl>
        </SectionCardBody>
      </SectionCard>

      {/* ── Quick actions ───────────────────────────────────────────────── */}
      <SectionCard>
        <SectionCardHeader>
          <div className="flex items-center gap-2"><Zap size={16} /> Quick actions</div>
        </SectionCardHeader>
        <SectionCardBody>
          <div className="flex flex-wrap gap-2">
            <ActionButton tone="primary" onClick={() => wake.mutate()} disabled={!isOnline || wake.isPending}>
              <Power size={14} /> Wake now
            </ActionButton>
            <ActionButton onClick={() => refresh.mutate()} disabled={!isOnline || refresh.isPending}>
              <RefreshCw size={14} /> Refresh now (defrag)
            </ActionButton>
            <ActionButton tone="warning" onClick={() => sleep.mutate()} disabled={!isOnline || sleep.isPending}>
              <Clock size={14} /> Sleep now
            </ActionButton>
          </div>
        </SectionCardBody>
      </SectionCard>

      {/* ── Presets ─────────────────────────────────────────────────────── */}
      <SectionCard>
        <SectionCardHeader>Power presets</SectionCardHeader>
        <SectionCardBody>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {Object.entries(PRESETS).map(([key, p]) => (
              <button
                key={key}
                type="button"
                onClick={() => applyPreset(key as keyof typeof PRESETS)}
                className="text-left p-3 rounded-md border border-[var(--border)] hover:bg-[var(--surface-raised)] transition-colors"
              >
                <div className="font-medium text-sm">{p.label}</div>
                <div className="text-xs text-[var(--text-muted)] mt-1">{p.description}</div>
              </button>
            ))}
          </div>
        </SectionCardBody>
      </SectionCard>

      {/* ── Settings form ───────────────────────────────────────────────── */}
      <SectionCard>
        <SectionCardHeader>
          <div className="flex items-center gap-2"><Wifi size={16} /> Power & refresh</div>
        </SectionCardHeader>
        <SectionCardBody className="space-y-4">
          <ToggleSwitch
            label="Network standby (push events while sleeping)"
            checked={draft.networkStandby !== 'OFF'}
            onChange={() => setDraft({ ...draft, networkStandby: draft.networkStandby === 'OFF' ? 'ON' : 'OFF' })}
          />

          <div>
            <label className="text-xs text-[var(--text-muted)] block mb-1">Auto-sleep after idle</label>
            <select
              className="w-full bg-[var(--surface-raised)] border border-[var(--border)] rounded px-2 py-1.5 text-sm"
              value={draft.autoSleep ?? 'NEVER'}
              onChange={(e) => setDraft({ ...draft, autoSleep: e.target.value })}
            >
              <option value="NEVER">Never</option>
              <option value="00:15">15 minutes</option>
              <option value="00:30">30 minutes</option>
              <option value="01:00">1 hour</option>
              <option value="02:00">2 hours</option>
              <option value="04:00">4 hours</option>
              <option value="08:00">8 hours</option>
            </select>
          </div>

          <div>
            <label className="text-xs text-[var(--text-muted)] block mb-1">
              Daily full-panel refresh (defrag) at
            </label>
            <input
              type="time"
              className="bg-[var(--surface-raised)] border border-[var(--border)] rounded px-2 py-1.5 text-sm"
              value={formatRefreshTime(draft.screenRefreshTime)}
              onChange={(e) => {
                const v = e.target.value;
                if (!v) { setDraft({ ...draft, screenRefreshTime: null }); return; }
                const [h, m] = v.split(':').map(Number);
                setDraft({ ...draft, screenRefreshTime: { hour: h ?? 0, minute: m ?? 0 } });
              }}
            />
            <button
              type="button"
              onClick={() => setDraft({ ...draft, screenRefreshTime: null })}
              className="ml-2 text-xs text-[var(--text-muted)] underline"
            >Disable</button>
          </div>

          <div>
            <label className="text-xs text-[var(--text-muted)] block mb-1">LED indicator</label>
            <select
              className="w-full bg-[var(--surface-raised)] border border-[var(--border)] rounded px-2 py-1.5 text-sm"
              value={draft.ledMode ?? 'AUTO'}
              onChange={(e) => setDraft({ ...draft, ledMode: e.target.value as 'ON' | 'OFF' | 'AUTO' })}
            >
              <option value="AUTO">Auto</option>
              <option value="ON">On</option>
              <option value="OFF">Off</option>
            </select>
          </div>

          <ToggleSwitch
            label="Show low-battery warning icon on panel"
            checked={!!draft.batteryWarningIcon}
            onChange={() => setDraft({ ...draft, batteryWarningIcon: !draft.batteryWarningIcon })}
          />

          <div>
            <label className="text-xs text-[var(--text-muted)] block mb-1">
              Minimum swap rate (seconds between image changes)
            </label>
            <input
              type="number"
              min={15}
              max={3600}
              className="bg-[var(--surface-raised)] border border-[var(--border)] rounded px-2 py-1.5 text-sm w-32"
              value={draft.minSwapRateSec ?? 15}
              onChange={(e) => {
                const v = Math.max(15, Math.min(3600, parseInt(e.target.value, 10) || 15));
                setDraft({ ...draft, minSwapRateSec: v });
              }}
            />
            <span className="text-xs text-[var(--text-muted)] ml-2">Min 15s — panel hardware refresh limit.</span>
          </div>

          <div className="flex items-center gap-2 pt-2 border-t border-[var(--border)]">
            <ActionButton
              tone="primary"
              disabled={!dirty || save.isPending}
              onClick={() => save.mutate(draft)}
            >
              {save.isPending ? 'Saving…' : 'Save & push to device'}
            </ActionButton>
            {dirty && (
              <button
                type="button"
                className="text-xs text-[var(--text-muted)] underline"
                onClick={() => setDraft(Object.assign({}, DEFAULT_SETTINGS, persisted ?? {}))}
              >Discard changes</button>
            )}
          </div>
        </SectionCardBody>
      </SectionCard>
    </div>
  );
}
