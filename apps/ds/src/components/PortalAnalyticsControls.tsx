import { useEffect, useState } from 'react';
import { BookmarkPlus, Settings2, Trash2 } from 'lucide-react';
import type {
  PortalAnalyticsPreset,
  PortalAnalyticsSettings,
  PortalWorkspaceDrilldown,
  WorkspaceDrilldownView,
} from '../lib/portal-analytics.js';
import { buildPresetSearchParams } from '../lib/portal-analytics.js';

interface PresetDraft {
  name: string;
  orgId: string;
  workspaceId: string;
  view: WorkspaceDrilldownView;
  searchParams?: Record<string, string>;
}

export default function PortalAnalyticsControls({
  settings,
  presets,
  workspaces,
  scopeLabel,
  savingSettings,
  creatingPreset,
  deletingPresetId,
  onSaveSettings,
  onCreatePreset,
  onOpenPreset,
  onDeletePreset,
}: {
  settings: PortalAnalyticsSettings;
  presets: PortalAnalyticsPreset[];
  workspaces: PortalWorkspaceDrilldown[];
  scopeLabel: string;
  savingSettings: boolean;
  creatingPreset: boolean;
  deletingPresetId: string | null;
  onSaveSettings: (settings: PortalAnalyticsSettings) => void;
  onCreatePreset: (draft: PresetDraft) => void;
  onOpenPreset: (preset: PortalAnalyticsPreset) => void;
  onDeletePreset: (id: string) => void;
}) {
  const [localSettings, setLocalSettings] = useState(settings);
  const [presetName, setPresetName] = useState('');
  const [presetWorkspaceId, setPresetWorkspaceId] = useState(workspaces[0]?.workspaceId ?? '');
  const [presetView, setPresetView] = useState<WorkspaceDrilldownView>('devices');

  useEffect(() => {
    setLocalSettings(settings);
  }, [settings]);

  useEffect(() => {
    if (!workspaces.some((workspace) => workspace.workspaceId === presetWorkspaceId)) {
      setPresetWorkspaceId(workspaces[0]?.workspaceId ?? '');
    }
  }, [workspaces, presetWorkspaceId]);

  const selectedWorkspace = workspaces.find((workspace) => workspace.workspaceId === presetWorkspaceId) ?? workspaces[0];

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.1fr_0.9fr]">
      <div className="rounded-2xl border p-5" style={{ background: 'var(--bg2)', borderColor: 'var(--card-border)' }}>
        <div className="mb-4 flex items-center gap-2">
          <Settings2 size={16} />
          <div>
            <p className="text-sm font-semibold">Alert Thresholds</p>
            <p className="text-xs text-[var(--text-muted)]">Persisted for this {scopeLabel} portal and used for dashboard alerts plus notification routing.</p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          <label className="text-sm">
            <span className="mb-1 block text-xs text-[var(--text-muted)]">Storage usage %</span>
            <input type="number" min={1} max={100} value={localSettings.thresholds.storageUsagePct} onChange={(event) => setLocalSettings((current) => ({ ...current, thresholds: { ...current.thresholds, storageUsagePct: Number(event.target.value) } }))} className="input h-10 w-full px-3 text-sm" />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs text-[var(--text-muted)]">Storage growth %</span>
            <input type="number" min={1} max={500} value={localSettings.thresholds.storageGrowthPct} onChange={(event) => setLocalSettings((current) => ({ ...current, thresholds: { ...current.thresholds, storageGrowthPct: Number(event.target.value) } }))} className="input h-10 w-full px-3 text-sm" />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs text-[var(--text-muted)]">Severe storage usage %</span>
            <input type="number" min={1} max={100} value={localSettings.thresholds.storageSevereUsagePct} onChange={(event) => setLocalSettings((current) => ({ ...current, thresholds: { ...current.thresholds, storageSevereUsagePct: Number(event.target.value) } }))} className="input h-10 w-full px-3 text-sm" />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs text-[var(--text-muted)]">Online device drop</span>
            <input type="number" min={1} value={localSettings.thresholds.onlineDeviceDropCount} onChange={(event) => setLocalSettings((current) => ({ ...current, thresholds: { ...current.thresholds, onlineDeviceDropCount: Number(event.target.value) } }))} className="input h-10 w-full px-3 text-sm" />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs text-[var(--text-muted)]">Severe device drop</span>
            <input type="number" min={1} value={localSettings.thresholds.severeOnlineDeviceDropCount} onChange={(event) => setLocalSettings((current) => ({ ...current, thresholds: { ...current.thresholds, severeOnlineDeviceDropCount: Number(event.target.value) } }))} className="input h-10 w-full px-3 text-sm" />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs text-[var(--text-muted)]">Play drop %</span>
            <input type="number" min={1} max={100} value={localSettings.thresholds.playDropPct} onChange={(event) => setLocalSettings((current) => ({ ...current, thresholds: { ...current.thresholds, playDropPct: Number(event.target.value) } }))} className="input h-10 w-full px-3 text-sm" />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs text-[var(--text-muted)]">Severe play drop %</span>
            <input type="number" min={1} max={100} value={localSettings.thresholds.severePlayDropPct} onChange={(event) => setLocalSettings((current) => ({ ...current, thresholds: { ...current.thresholds, severePlayDropPct: Number(event.target.value) } }))} className="input h-10 w-full px-3 text-sm" />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs text-[var(--text-muted)]">Notification repeat hours</span>
            <input type="number" min={1} max={168} value={localSettings.repeatHours} onChange={(event) => setLocalSettings((current) => ({ ...current, repeatHours: Number(event.target.value) }))} className="input h-10 w-full px-3 text-sm" />
          </label>
        </div>

        <div className="mt-4 flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={localSettings.notifications.storageGrowth} onChange={(event) => setLocalSettings((current) => ({ ...current, notifications: { ...current.notifications, storageGrowth: event.target.checked } }))} />
            Storage growth inbox alerts
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={localSettings.notifications.deviceDrop} onChange={(event) => setLocalSettings((current) => ({ ...current, notifications: { ...current.notifications, deviceDrop: event.target.checked } }))} />
            Device drop inbox alerts
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={localSettings.notifications.playAnomaly} onChange={(event) => setLocalSettings((current) => ({ ...current, notifications: { ...current.notifications, playAnomaly: event.target.checked } }))} />
            Play anomaly inbox alerts
          </label>
        </div>

        <div className="mt-4">
          <button type="button" onClick={() => onSaveSettings(localSettings)} disabled={savingSettings} className="workspace-page-action">
            {savingSettings ? 'Saving...' : 'Save alert settings'}
          </button>
        </div>
      </div>

      <div className="space-y-4">
        <div className="rounded-2xl border p-5" style={{ background: 'var(--bg2)', borderColor: 'var(--card-border)' }}>
          <div className="mb-4 flex items-center gap-2">
            <BookmarkPlus size={16} />
            <div>
              <p className="text-sm font-semibold">Saved Drilldown Presets</p>
              <p className="text-xs text-[var(--text-muted)]">Store repeatable workspace views for recurring operational checks.</p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3">
            <input value={presetName} onChange={(event) => setPresetName(event.target.value)} placeholder="Preset name" className="input h-10 px-3 text-sm" />
            <select value={presetWorkspaceId} onChange={(event) => setPresetWorkspaceId(event.target.value)} className="input h-10 px-3 text-sm">
              {workspaces.map((workspace) => (
                <option key={workspace.workspaceId} value={workspace.workspaceId}>{workspace.orgName} / {workspace.name}</option>
              ))}
            </select>
            <select value={presetView} onChange={(event) => setPresetView(event.target.value as WorkspaceDrilldownView)} className="input h-10 px-3 text-sm">
              <option value="workspace">Overview</option>
              <option value="devices">Devices</option>
              <option value="content">Content</option>
              <option value="analytics">Analytics</option>
            </select>
            <button
              type="button"
              disabled={creatingPreset || !presetName.trim() || !selectedWorkspace}
              onClick={() => {
                if (!selectedWorkspace) return;
                onCreatePreset({
                  name: presetName.trim(),
                  orgId: selectedWorkspace.orgId,
                  workspaceId: selectedWorkspace.workspaceId,
                  view: presetView,
                  searchParams: buildPresetSearchParams(presetView, selectedWorkspace),
                });
                setPresetName('');
              }}
              className="workspace-page-action"
            >
              {creatingPreset ? 'Saving...' : 'Save preset'}
            </button>
          </div>
        </div>

        <div className="rounded-2xl border p-5" style={{ background: 'var(--bg2)', borderColor: 'var(--card-border)' }}>
          <div className="space-y-3">
            {presets.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)]">No saved presets yet.</p>
            ) : presets.map((preset) => (
              <div key={preset.id} className="flex items-center justify-between gap-3 rounded-xl border px-3 py-3" style={{ borderColor: 'var(--card-border)' }}>
                <div>
                  <p className="text-sm font-medium">{preset.name}</p>
                  <p className="text-xs text-[var(--text-muted)]">{preset.view} view</p>
                </div>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => onOpenPreset(preset)} className="workspace-page-action">Open</button>
                  <button type="button" onClick={() => onDeletePreset(preset.id)} disabled={deletingPresetId === preset.id} className="workspace-page-action !text-[var(--danger)]">
                    <Trash2 size={14} />
                    {deletingPresetId === preset.id ? 'Removing...' : 'Delete'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}