import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Bluetooth, Plus, Trash2, Edit2, Radio, Send, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react';
import { api } from '../../lib/api.js';
import {
  ActionButton,
  Badge,
  Callout,
  EmptyState,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  ModalPrimaryButton,
  ModalSecondaryButton,
  SectionCard,
  SectionCardBody,
  SectionCardHeader,
  ToggleSwitch,
} from '../../components/UiPrimitives.js';

// ── Types ─────────────────────────────────────────────────────────────────────

interface BleBeacon {
  uuid: string;
  name?: string;
  rssi: number;
  major?: number;
  minor?: number;
}

interface BleBeaconCondition {
  type: 'ble_beacon';
  uuid: string;
  name?: string;
  major?: number;
  minor?: number;
  rssiThreshold?: number;
  distanceMinCm?: number | null;
  distanceMaxCm?: number | null;
}

interface ConditionGroup {
  type: 'group';
  logic: 'AND' | 'OR';
  children: BleBeaconCondition[];
}

interface PlayPlaylistAction { type: 'play_playlist'; playlistId: string; }
interface PlayContentAction  { type: 'play_content';  contentId: string; }
type RuleAction = PlayPlaylistAction | PlayContentAction;

interface DeviceRule {
  id: string;
  name: string;
  enabled: boolean;
  conditions: ConditionGroup;
  action: RuleAction;
  priority: number;
  createdAt: string;
  updatedAt: string;
}

interface PlaylistItem { id: string; name: string; }
interface ContentItem  { id: string; name: string; type: string; }

// ── helpers ───────────────────────────────────────────────────────────────────

function cmLabel(min?: number | null, max?: number | null): string {
  const fmtCm = (cm: number) => cm >= 100 ? `${(cm / 100).toFixed(1).replace('.0', '')} m` : `${cm} cm`;
  if (min != null && max != null) return `${fmtCm(min)} – ${fmtCm(max)}`;
  if (max != null) return `within ${fmtCm(max)}`;
  if (min != null) return `beyond ${fmtCm(min)}`;
  return 'any range';
}

function extractBeaconCondition(rule: DeviceRule): BleBeaconCondition | null {
  const child = rule.conditions?.children?.[0];
  return child?.type === 'ble_beacon' ? child : null;
}

function actionLabel(action: RuleAction, playlists: PlaylistItem[], content: ContentItem[]): string {
  if (action.type === 'play_playlist') {
    return playlists.find(p => p.id === action.playlistId)?.name ?? `Playlist ${action.playlistId.slice(0, 6)}…`;
  }
  return content.find(c => c.id === (action as PlayContentAction).contentId)?.name ?? `Content ${(action as PlayContentAction).contentId.slice(0, 6)}…`;
}

// Rough RSSI → estimated distance in cm (free-space path loss, N=2, TxPower=-65)
function rssiToEstimatedCm(rssi: number): number {
  const txPower = -65;
  const n = 2;
  return Math.round(100 * Math.pow(10, (txPower - rssi) / (10 * n)));
}

// Match a rule's beacon condition against the latest scan results
function findBeaconInScan(
  bc: BleBeaconCondition,
  latestScan: { beacons: BleBeacon[] } | null | undefined,
): BleBeacon | null {
  if (!latestScan) return null;
  return latestScan.beacons.find(
    b =>
      b.uuid.toUpperCase() === bc.uuid.toUpperCase() &&
      (bc.major == null || b.major === bc.major) &&
      (bc.minor == null || b.minor === bc.minor),
  ) ?? null;
}

// ── Unit toggle ───────────────────────────────────────────────────────────────

type DistUnit = 'cm' | 'm';

function toCm(val: string, unit: DistUnit): number | null {
  const n = parseFloat(val);
  if (isNaN(n) || n < 0) return null;
  return unit === 'm' ? Math.round(n * 100) : Math.round(n);
}

function fromCm(cm: number | null | undefined, unit: DistUnit): string {
  if (cm == null) return '';
  return unit === 'm' ? String(parseFloat((cm / 100).toFixed(2))) : String(cm);
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function DeviceRulesTab({
  deviceId,
  wsId,
  isOnline,
}: {
  deviceId: string;
  wsId: string;
  isOnline: boolean;
}) {
  const qc = useQueryClient();

  // ── data ──
  const { data: rulesData, isLoading: rulesLoading } = useQuery<{ rules: DeviceRule[] }>({
    queryKey: ['device-rules', deviceId],
    queryFn: () => api.get(`/devices/${deviceId}/rules`),
  });
  const rules = rulesData?.rules ?? [];

  const { data: playlistsData } = useQuery<{ playlists: PlaylistItem[] }>({
    queryKey: ['playlists-brief', wsId],
    queryFn: () => api.get(`/playlists?workspaceId=${wsId}&limit=500`),
    enabled: !!wsId,
  });
  const playlists: PlaylistItem[] = playlistsData?.playlists ?? [];

  const { data: contentData } = useQuery<{ items: ContentItem[] }>({
    queryKey: ['content-brief', wsId],
    queryFn: () => api.get(`/content?workspaceId=${wsId}&limit=500`),
    enabled: !!wsId,
  });
  const contentItems: ContentItem[] = contentData?.items ?? [];

  // ── BLE scan ──
  const [scanning, setScanning]     = useState(false);
  const [scanOpen, setScanOpen]     = useState(false);
  const { data: latestScan, refetch: refetchScan } = useQuery<{ beacons: BleBeacon[]; scannedAt: string } | null>({
    queryKey: ['ble-scan', deviceId],
    queryFn: () => api.get(`/devices/${deviceId}/ble-scan/latest`),
    staleTime: Infinity, // SSE handles live updates; REST is only for initial load
  });

  // Real-time BLE scan updates via SSE
  useEffect(() => {
    const es = new EventSource(`/api/devices/${deviceId}/ble-scan/stream`);
    es.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data) as { beacons: BleBeacon[]; scannedAt: string };
        qc.setQueryData(['ble-scan', deviceId], data);
        setScanning(false);
      } catch { /* ignore malformed events */ }
    };
    return () => es.close();
  }, [deviceId, qc]);

  const triggerScan = useMutation({
    mutationFn: () => api.post(`/devices/${deviceId}/ble-scan`, {}),
    onSuccess: () => {
      setScanning(true);
      toast.info('BLE scan started — results will appear automatically');
    },
    onError: () => toast.error('Failed to start BLE scan'),
  });

  // ── publish ──
  const publishRules = useMutation({
    mutationFn: () => api.post(`/devices/${deviceId}/rules/publish`, {}),
    onSuccess: (d: any) => toast.success(`Rules published to device (${d.ruleCount} rules)`),
    onError: () => toast.error('Failed to publish rules'),
  });

  // ── delete rule ──
  const deleteRule = useMutation({
    mutationFn: (ruleId: string) => api.delete(`/devices/${deviceId}/rules/${ruleId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['device-rules', deviceId] });
      toast.success('Rule deleted');
    },
    onError: () => toast.error('Failed to delete rule'),
  });

  // ── toggle enabled ──
  const toggleRule = useMutation({
    mutationFn: ({ ruleId, enabled }: { ruleId: string; enabled: boolean }) =>
      api.put(`/devices/${deviceId}/rules/${ruleId}`, { enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['device-rules', deviceId] }),
  });

  // ── editor state ──
  const [editorOpen, setEditorOpen]     = useState(false);
  const [editTarget, setEditTarget]     = useState<DeviceRule | null>(null);

  function openAdd()              { setEditTarget(null);  setEditorOpen(true); }
  function openEdit(r: DeviceRule){ setEditTarget(r);     setEditorOpen(true); }

  const beaconOptions = latestScan?.beacons ?? [];

  return (
    <div className="space-y-4">

      {/* ── Header bar ─────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Bluetooth className="w-5 h-5 text-[var(--blue)]" />
          <span className="font-semibold text-[var(--text)]">BLE Trigger Rules</span>
          {rules.length > 0 && <Badge tone="neutral">{rules.length}</Badge>}
        </div>
        <div className="flex items-center gap-2">
          <ActionButton
            onClick={() => setScanOpen(v => !v)}
            tone="default"
            className="px-3 py-1.5 text-xs"
          >
            <Radio className="w-3.5 h-3.5" />
            {scanOpen ? 'Hide scanner' : 'Scan for beacons'}
          </ActionButton>
          <ActionButton
            onClick={openAdd}
            tone="primary"
            className="px-3 py-1.5 text-xs"
          >
            <Plus className="w-3.5 h-3.5" /> Add rule
          </ActionButton>
          <ActionButton
            onClick={() => publishRules.mutate()}
            disabled={!isOnline || publishRules.isPending || rules.length === 0}
            tone="success"
            className="px-3 py-1.5 text-xs"
          >
            <Send className="w-3.5 h-3.5" />
            {publishRules.isPending ? 'Publishing…' : 'Publish rules'}
          </ActionButton>
        </div>
      </div>

      {!isOnline && (
        <Callout tone="warning">Device is offline — scan and publish require an active connection.</Callout>
      )}

      {/* ── BLE Scanner ─────────────────────────────────────────────────── */}
      {scanOpen && (
        <SectionCard>
          <SectionCardHeader>
            <div className="flex items-center justify-between w-full">
              <span className="text-sm font-medium text-[var(--text)]">Nearby Beacons</span>
              <ActionButton
                onClick={() => triggerScan.mutate()}
                disabled={!isOnline || triggerScan.isPending || scanning}
                tone="default"
                className="px-3 py-1.5 text-xs"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${scanning ? 'animate-spin' : ''}`} />
                {scanning ? 'Scanning…' : 'Scan now'}
              </ActionButton>
            </div>
          </SectionCardHeader>
          <SectionCardBody>
            {beaconOptions.length === 0 ? (
              <p className="text-xs text-[var(--text-muted)]">
                {latestScan ? 'No beacons found in last scan.' : 'No scan results yet — click Scan now.'}
              </p>
            ) : (
              <div className="space-y-1.5">
                {latestScan && (
                  <p className="text-[10px] text-[var(--text-muted)] mb-2">
                    Scanned {new Date(latestScan.scannedAt).toLocaleTimeString()} · {beaconOptions.length} beacon{beaconOptions.length !== 1 ? 's' : ''} found
                  </p>
                )}
                {beaconOptions.map((b, i) => (
                  <div key={i} className="flex items-center justify-between rounded-lg bg-[var(--surface)] px-3 py-2 text-xs">
                    <div>
                      <span className="font-medium text-[var(--text)]">{b.name || '(unnamed)'}</span>
                      <span className="ml-2 text-[var(--text-muted)] font-mono">{b.uuid}</span>
                      {b.major != null && <span className="ml-1 text-[var(--text-muted)]">{b.major}/{b.minor}</span>}
                    </div>
                    <div className="flex items-center gap-3 text-[var(--text-muted)]">
                      <span>{b.rssi} dBm</span>
                      <span>~{rssiToEstimatedCm(b.rssi)} cm</span>
                      <button
                        type="button"
                        className="text-[var(--blue)] hover:underline font-medium"
                        onClick={() => { setEditTarget(null); setEditorOpen(true); }}
                      >
                        Use
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SectionCardBody>
        </SectionCard>
      )}

      {/* ── Rule list ───────────────────────────────────────────────────── */}
      {rules.length > 0 && (
        <p className="text-[10px] text-[var(--text-muted)]">Device auto-scans every 15 s · status updates in real-time</p>
      )}
      {rulesLoading ? (
        <div className="text-sm text-[var(--text-muted)]">Loading rules…</div>
      ) : rules.length === 0 ? (
        <EmptyState
          icon={<Bluetooth className="w-8 h-8" />}
          title="No rules yet"
          description="Add a BLE proximity rule to automatically switch content when a beacon is detected."
          action={<ActionButton tone="primary" onClick={openAdd} className="px-4 py-2 text-sm"><Plus className="w-4 h-4" /> Add first rule</ActionButton>}
        />
      ) : (
        <div className="space-y-3">
          {rules.map(rule => {
            const bc = extractBeaconCondition(rule);
            const detectedBeacon = bc ? findBeaconInScan(bc, latestScan) : null;
            const isDetected = detectedBeacon != null;
            return (
              <SectionCard key={rule.id}>
                <SectionCardBody>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-[var(--text)] text-sm">{rule.name}</span>
                        {!rule.enabled && <Badge tone="neutral">disabled</Badge>}
                        {latestScan && bc && (
                          <Badge tone={isDetected ? 'success' : 'neutral'}>
                            {isDetected ? '● nearby' : '○ not detected'}
                          </Badge>
                        )}
                      </div>
                      {bc && (
                        <div className="text-xs text-[var(--text-muted)] space-y-0.5">
                          <div>
                            <span className="text-[var(--text)]">Beacon:</span>{' '}
                            {bc.name ? <><span className="font-medium">{bc.name}</span> <span className="font-mono">{bc.uuid}</span></> : <span className="font-mono">{bc.uuid}</span>}
                          </div>
                          <div>
                            <span className="text-[var(--text)]">Distance:</span>{' '}
                            {cmLabel(bc.distanceMinCm, bc.distanceMaxCm)}
                            {detectedBeacon && (
                              <span className="ml-2 text-green-500 font-medium">
                                · now ~{rssiToEstimatedCm(detectedBeacon.rssi)} cm
                              </span>
                            )}
                          </div>
                          <div>
                            <span className="text-[var(--text)]">Action:</span>{' '}
                            {rule.action.type === 'play_playlist' ? '▶ Playlist' : '▶ Content'}{' '}
                            <span className="font-medium">{actionLabel(rule.action, playlists, contentItems)}</span>
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <ToggleSwitch
                        checked={rule.enabled}
                        onChange={() => toggleRule.mutate({ ruleId: rule.id, enabled: !rule.enabled })}
                      />
                      <button
                        type="button"
                        onClick={() => openEdit(rule)}
                        className="p-1.5 rounded hover:bg-[var(--surface)] text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
                        title="Edit rule"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => { if (confirm(`Delete rule "${rule.name}"?`)) deleteRule.mutate(rule.id); }}
                        className="p-1.5 rounded hover:bg-[var(--surface)] text-[var(--text-muted)] hover:text-red-500 transition-colors"
                        title="Delete rule"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </SectionCardBody>
              </SectionCard>
            );
          })}
        </div>
      )}

      {/* ── Add/Edit modal ──────────────────────────────────────────────── */}
      {editorOpen && (
        <RuleEditorModal
          deviceId={deviceId}
          wsId={wsId}
          rule={editTarget}
          playlists={playlists}
          contentItems={contentItems}
          scannedBeacons={beaconOptions}
          onClose={() => setEditorOpen(false)}
          onSaved={() => {
            setEditorOpen(false);
            qc.invalidateQueries({ queryKey: ['device-rules', deviceId] });
          }}
        />
      )}
    </div>
  );
}

// ── Rule editor modal ─────────────────────────────────────────────────────────

function RuleEditorModal({
  deviceId,
  wsId: _wsId,
  rule,
  playlists,
  contentItems,
  scannedBeacons,
  onClose,
  onSaved,
}: {
  deviceId: string;
  wsId: string;
  rule: DeviceRule | null;
  playlists: PlaylistItem[];
  contentItems: ContentItem[];
  scannedBeacons: BleBeacon[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const bc = rule ? extractBeaconCondition(rule) : null;

  // form state
  const [name,         setName]         = useState(rule?.name ?? '');
  const [enabled,      setEnabled]      = useState(rule?.enabled ?? true);
  const [beaconUuid,   setBeaconUuid]   = useState(bc?.uuid ?? '');
  const [beaconName,   setBeaconName]   = useState(bc?.name ?? '');
  const [unit,         setUnit]         = useState<DistUnit>('cm');
  const [minVal,       setMinVal]       = useState(fromCm(bc?.distanceMinCm, unit));
  const [maxVal,       setMaxVal]       = useState(fromCm(bc?.distanceMaxCm, unit));
  const [actionType,   setActionType]   = useState<'play_playlist' | 'play_content'>(
    rule?.action.type === 'play_content' ? 'play_content' : 'play_playlist',
  );
  const [playlistId,   setPlaylistId]   = useState(
    rule?.action.type === 'play_playlist' ? rule.action.playlistId : '',
  );
  const [contentId,    setContentId]    = useState(
    rule?.action.type === 'play_content' ? rule.action.contentId : '',
  );
  const [beaconPickerOpen, setBeaconPickerOpen] = useState(false);

  // When unit changes, reformat existing values
  useEffect(() => {
    const minCm = toCm(minVal, unit === 'cm' ? 'm' : 'cm');
    const maxCm = toCm(maxVal, unit === 'cm' ? 'm' : 'cm');
    setMinVal(fromCm(minCm, unit));
    setMaxVal(fromCm(maxCm, unit));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unit]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const distanceMinCm = toCm(minVal, unit);
      const distanceMaxCm = toCm(maxVal, unit);

      const conditions: ConditionGroup = {
        type: 'group',
        logic: 'AND',
        children: [{
          type: 'ble_beacon',
          uuid: beaconUuid.trim(),
          name: beaconName.trim() || '',
          distanceMinCm: distanceMinCm,
          distanceMaxCm: distanceMaxCm,
        }],
      };

      const action: RuleAction = actionType === 'play_playlist'
        ? { type: 'play_playlist', playlistId }
        : { type: 'play_content',  contentId };

      const payload = { name: name.trim(), enabled, conditions, action };

      if (rule) {
        return api.put(`/devices/${deviceId}/rules/${rule.id}`, payload);
      } else {
        return api.post(`/devices/${deviceId}/rules`, payload);
      }
    },
    onSuccess: () => {
      toast.success(rule ? 'Rule updated' : 'Rule created');
      onSaved();
    },
    onError: () => toast.error('Failed to save rule'),
  });

  function validate(): string | null {
    if (!name.trim()) return 'Rule name is required';
    if (!beaconUuid.trim()) return 'Beacon UUID is required';
    if (actionType === 'play_playlist' && !playlistId) return 'Select a playlist';
    if (actionType === 'play_content'  && !contentId)  return 'Select a content item';
    const minCm = toCm(minVal, unit);
    const maxCm = toCm(maxVal, unit);
    if (minCm != null && maxCm != null && minCm >= maxCm) return 'Min distance must be less than max';
    return null;
  }

  function handleSave() {
    const err = validate();
    if (err) { toast.error(err); return; }
    saveMutation.mutate();
  }

  function pickBeacon(b: BleBeacon) {
    setBeaconUuid(b.uuid);
    setBeaconName(b.name ?? '');
    const estCm = rssiToEstimatedCm(b.rssi);
    setMaxVal(fromCm(estCm, unit));
    setBeaconPickerOpen(false);
  }

  return (
    <Modal onClose={onClose}>
      <ModalHeader onClose={onClose}>
        {rule ? 'Edit rule' : 'Add BLE proximity rule'}
      </ModalHeader>

      <ModalBody className="space-y-5">

        {/* Rule name */}
        <div className="space-y-1">
          <label className="text-xs font-medium text-[var(--text-muted)]">Rule name</label>
          <input
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--blue)]/40"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. Near entrance beacon"
          />
        </div>

        {/* Beacon target */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-[var(--text-muted)]">Target beacon</label>
            {scannedBeacons.length > 0 && (
              <button
                type="button"
                className="text-xs text-[var(--blue)] hover:underline flex items-center gap-1"
                onClick={() => setBeaconPickerOpen(v => !v)}
              >
                Pick from scan {beaconPickerOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              </button>
            )}
          </div>

          {beaconPickerOpen && scannedBeacons.length > 0 && (
            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] divide-y divide-[var(--border)]">
              {scannedBeacons.map((b, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => pickBeacon(b)}
                  className="w-full flex items-center justify-between px-3 py-2 text-xs hover:bg-[var(--surface-raised)] transition-colors text-left"
                >
                  <div>
                    <span className="font-medium text-[var(--text)]">{b.name || '(unnamed)'}</span>
                    <span className="ml-2 text-[var(--text-muted)] font-mono">{b.uuid}</span>
                  </div>
                  <span className="text-[var(--text-muted)]">{b.rssi} dBm · ~{rssiToEstimatedCm(b.rssi)} cm</span>
                </button>
              ))}
            </div>
          )}

          <input
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 py-2 text-xs font-mono text-[var(--text)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--blue)]/40"
            value={beaconUuid}
            onChange={e => setBeaconUuid(e.target.value)}
            placeholder="UUID e.g. FDA50693-A4E2-4FB1-AFCF-C6EB07647825"
          />
          <input
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--blue)]/40"
            value={beaconName}
            onChange={e => setBeaconName(e.target.value)}
            placeholder="Beacon display name (optional)"
          />
        </div>

        {/* Distance condition */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-[var(--text-muted)]">Distance condition</label>
            <div className="flex rounded-lg overflow-hidden border border-[var(--border)] text-xs">
              {(['cm', 'm'] as DistUnit[]).map(u => (
                <button
                  key={u}
                  type="button"
                  onClick={() => setUnit(u)}
                  className={`px-3 py-1 transition-colors ${unit === u ? 'bg-[var(--blue)] text-white' : 'bg-[var(--surface)] text-[var(--text-muted)] hover:bg-[var(--surface-raised)]'}`}
                >
                  {u}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-[10px] text-[var(--text-muted)]">Min distance (optional)</label>
              <input
                type="number"
                min="0"
                step={unit === 'm' ? '0.1' : '1'}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--blue)]/40"
                value={minVal}
                onChange={e => setMinVal(e.target.value)}
                placeholder={`e.g. ${unit === 'm' ? '1.0' : '100'}`}
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] text-[var(--text-muted)]">Max distance (optional)</label>
              <input
                type="number"
                min="0"
                step={unit === 'm' ? '0.1' : '1'}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--blue)]/40"
                value={maxVal}
                onChange={e => setMaxVal(e.target.value)}
                placeholder={`e.g. ${unit === 'm' ? '0.3' : '30'}`}
              />
            </div>
          </div>
          <p className="text-[10px] text-[var(--text-muted)]">
            Leave min empty for "within max distance" (e.g. 30 cm = triggers when beacon is closer than 30 cm).<br />
            Set both for a range (e.g. 1 m – 1.5 m).
          </p>
          {(minVal || maxVal) && (
            <p className="text-xs font-medium text-[var(--blue)]">
              Triggers: {cmLabel(toCm(minVal, unit), toCm(maxVal, unit))}
            </p>
          )}
        </div>

        {/* Action */}
        <div className="space-y-2">
          <label className="text-xs font-medium text-[var(--text-muted)]">Action</label>
          <div className="flex gap-2">
            {([['play_playlist', 'Playlist'], ['play_content', 'Content']] as const).map(([val, label]) => (
              <button
                key={val}
                type="button"
                onClick={() => setActionType(val)}
                className={`flex-1 rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${actionType === val ? 'border-[var(--blue)] bg-[var(--blue)]/10 text-[var(--blue)]' : 'border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--text-muted)]'}`}
              >
                {label}
              </button>
            ))}
          </div>

          {actionType === 'play_playlist' && (
            <select
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 py-2 text-sm text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--blue)]/40"
              value={playlistId}
              onChange={e => setPlaylistId(e.target.value)}
            >
              <option value="">— Select playlist —</option>
              {playlists.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          )}

          {actionType === 'play_content' && (
            <select
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 py-2 text-sm text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--blue)]/40"
              value={contentId}
              onChange={e => setContentId(e.target.value)}
            >
              <option value="">— Select content —</option>
              {contentItems.map(c => (
                <option key={c.id} value={c.id}>[{c.type.toUpperCase()}] {c.name}</option>
              ))}
            </select>
          )}
        </div>

        {/* Enabled toggle */}
        <div className="flex items-center justify-between">
          <span className="text-sm text-[var(--text)]">Rule enabled</span>
          <ToggleSwitch checked={enabled} onChange={() => setEnabled(v => !v)} />
        </div>

      </ModalBody>

      <ModalFooter>
        <ModalSecondaryButton onClick={onClose}>Cancel</ModalSecondaryButton>
        <ModalPrimaryButton onClick={handleSave} disabled={saveMutation.isPending}>
          {saveMutation.isPending ? 'Saving…' : rule ? 'Save changes' : 'Create rule'}
        </ModalPrimaryButton>
      </ModalFooter>
    </Modal>
  );
}
