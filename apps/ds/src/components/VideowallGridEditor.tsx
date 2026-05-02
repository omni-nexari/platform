/**
 * VideowallGridEditor — visual NxM cell assignment + bezel config panel.
 *
 * Shows the videowall grid, lets the user assign devices to cells, configure
 * per-edge bezel compensation (mm), and push the manifest to online devices.
 */
import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Save, Radio, ChevronDown, X } from 'lucide-react';

// ── Grid size stepper ─────────────────────────────────────────────────────────

function GridStepper({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-xs text-[var(--text-muted)] mr-1">{label}</span>
      <button
        type="button"
        onClick={() => value > 1 && onChange(value - 1)}
        disabled={value <= 1}
        className="w-5 h-5 rounded border border-[var(--border)] flex items-center justify-center text-xs text-[var(--text-muted)] hover:text-[var(--text)] hover:border-[var(--accent)] transition-colors disabled:opacity-40"
      >−</button>
      <span className="w-5 text-center text-xs font-mono text-[var(--text)]">{value}</span>
      <button
        type="button"
        onClick={() => value < 8 && onChange(value + 1)}
        disabled={value >= 8}
        className="w-5 h-5 rounded border border-[var(--border)] flex items-center justify-center text-xs text-[var(--text-muted)] hover:text-[var(--text)] hover:border-[var(--accent)] transition-colors disabled:opacity-40"
      >+</button>
    </div>
  );
}
import { api } from '../lib/api.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface GridDevice {
  id: string;
  name: string;
  status: string;
}

export interface GridMember {
  deviceId: string;
  positionCol: number | null;
  positionRow: number | null;
  colSpan?: number | null;
  rowSpan?: number | null;
  tileRotation?: string | null;
  nativeWidthPx?: number | null;
  nativeHeightPx?: number | null;
  device: GridDevice | null;
}

export interface GridGroup {
  id: string;
  name: string;
  videoWallCols: number | null;
  videoWallRows: number | null;
  bezelTopMm: number | null;
  bezelRightMm: number | null;
  bezelBottomMm: number | null;
  bezelLeftMm: number | null;
  members: GridMember[];
}

interface Props {
  group: GridGroup;
  workspaceId: string;
  availableDevices: GridDevice[]; // all devices in the workspace
}

// ── Cell key helper ───────────────────────────────────────────────────────────

function ck(col: number, row: number) { return `${col},${row}`; }

// ── Component ─────────────────────────────────────────────────────────────────

export default function VideowallGridEditor({ group, workspaceId, availableDevices }: Props) {
  const qc = useQueryClient();
  const groupId = group.id;

  // ── Local state ─────────────────────────────────────────────────────────────

  const [gridCols, setGridCols] = useState(group.videoWallCols ?? 2);
  const [gridRows, setGridRows] = useState(group.videoWallRows ?? 2);

  const cols = gridCols;
  const rows = gridRows;

  function changeGrid(newCols: number, newRows: number) {
    setGridCols(newCols);
    setGridRows(newRows);
    setCells({});  // clear assignments — they're invalid for the new dimensions
  }

  // Map from "col,row" → deviceId
  const [cells, setCells] = useState<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    for (const m of group.members) {
      if (m.positionCol != null && m.positionRow != null) {
        map[ck(m.positionCol, m.positionRow)] = m.deviceId;
      }
    }
    return map;
  });

  // Bezel state
  const [bezelTop,    setBezelTop]    = useState(String(group.bezelTopMm    ?? ''));
  const [bezelRight,  setBezelRight]  = useState(String(group.bezelRightMm  ?? ''));
  const [bezelBottom, setBezelBottom] = useState(String(group.bezelBottomMm ?? ''));
  const [bezelLeft,   setBezelLeft]   = useState(String(group.bezelLeftMm   ?? ''));

  // Open dropdown cell
  const [openCell, setOpenCell] = useState<string | null>(null);

  // Re-initialise when group data changes (e.g. after a query refetch)
  useEffect(() => {
    setGridCols(group.videoWallCols ?? 2);
    setGridRows(group.videoWallRows ?? 2);
    const map: Record<string, string> = {};
    for (const m of group.members) {
      if (m.positionCol != null && m.positionRow != null) {
        map[ck(m.positionCol, m.positionRow)] = m.deviceId;
      }
    }
    setCells(map);
    setBezelTop(String(group.bezelTopMm ?? ''));
    setBezelRight(String(group.bezelRightMm ?? ''));
    setBezelBottom(String(group.bezelBottomMm ?? ''));
    setBezelLeft(String(group.bezelLeftMm ?? ''));
  }, [group]);

  // ── Derived ──────────────────────────────────────────────────────────────────

  const deviceById = Object.fromEntries(availableDevices.map((d) => [d.id, d]));

  // Which deviceIds are already assigned (across any cell)
  function assignedExcept(excludeKey: string) {
    return new Set(
      Object.entries(cells)
        .filter(([k]) => k !== excludeKey)
        .map(([, v]) => v),
    );
  }

  // ── Mutations ────────────────────────────────────────────────────────────────

  const saveLayoutMut = useMutation({
    mutationFn: async () => {
      // Persist grid dimensions first (idempotent)
      await api.patch(`/device-groups/${groupId}`, {
        videoWallCols: gridCols,
        videoWallRows: gridRows,
      });
      const members = Object.entries(cells)
        .filter(([, deviceId]) => !!deviceId)
        .map(([key, deviceId], idx) => {
          const [c, r] = key.split(',').map(Number);
          const existing = group.members.find(
            (m) => m.positionCol === c && m.positionRow === r,
          );
          return {
            deviceId,
            position: idx,
            positionCol: c,
            positionRow: r,
            colSpan:      existing?.colSpan      ?? 1,
            rowSpan:      existing?.rowSpan      ?? 1,
            tileRotation: existing?.tileRotation ?? '0',
            nativeWidthPx:  existing?.nativeWidthPx  ?? null,
            nativeHeightPx: existing?.nativeHeightPx ?? null,
          };
        });
      return api.put(`/device-groups/${groupId}/members`, members);
    },
    onSuccess: () => {
      toast.success('Layout saved');
      void qc.invalidateQueries({ queryKey: ['device-group', groupId] });
    },
    onError: () => toast.error('Failed to save layout'),
  });

  const saveBezelsMut = useMutation({
    mutationFn: async () =>
      api.patch(`/device-groups/${groupId}`, {
        bezelTopMm:    bezelTop    !== '' ? Number(bezelTop)    : null,
        bezelRightMm:  bezelRight  !== '' ? Number(bezelRight)  : null,
        bezelBottomMm: bezelBottom !== '' ? Number(bezelBottom) : null,
        bezelLeftMm:   bezelLeft   !== '' ? Number(bezelLeft)   : null,
      }),
    onSuccess: () => {
      toast.success('Bezel settings saved');
      void qc.invalidateQueries({ queryKey: ['device-group', groupId] });
    },
    onError: () => toast.error('Failed to save bezels'),
  });

  const pushManifestMut = useMutation({
    mutationFn: () => api.post(`/device-groups/${groupId}/videowall-manifest`, {}) as Promise<{ pushed: number; skipped: number }>,
    onSuccess: (res: { pushed: number; skipped: number }) => {
      toast.success(`Manifest pushed to ${res.pushed} device${res.pushed !== 1 ? 's' : ''}${res.skipped > 0 ? ` (${res.skipped} offline)` : ''}`);
    },
    onError: () => toast.error('Failed to push manifest'),
  });

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-6">

      {/* Grid assignment */}
      <div className="rounded-xl border" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
        <div className="p-5 border-b" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-[var(--text)]">Panel Layout</h2>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">{cols}×{rows} grid — assign a screen to each cell</p>
            </div>
            <button
              onClick={() => saveLayoutMut.mutate()}
              disabled={saveLayoutMut.isPending}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-[var(--blue)] text-white rounded-lg hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              <Save className="w-3.5 h-3.5" />
              {saveLayoutMut.isPending ? 'Saving…' : 'Save Layout'}
            </button>
          </div>
          {/* Grid dimension controls */}
          <div className="mt-3 flex items-center gap-4">
            <GridStepper
              label="Cols"
              value={gridCols}
              onChange={(v) => changeGrid(v, gridRows)}
            />
            <span className="text-[var(--text-faint)] text-xs">×</span>
            <GridStepper
              label="Rows"
              value={gridRows}
              onChange={(v) => changeGrid(gridCols, v)}
            />
            {(gridCols !== (group.videoWallCols ?? 2) || gridRows !== (group.videoWallRows ?? 2)) && (
              <span className="text-[10px] text-amber-400 ml-1">unsaved — click Save Layout</span>
            )}
          </div>
        </div>

        <div className="p-5 overflow-x-auto">
          <div
            className="grid gap-2"
            style={{
              gridTemplateColumns: `repeat(${cols}, minmax(120px, 1fr))`,
              minWidth: cols * 130,
            }}
          >
            {Array.from({ length: rows }, (_, r) =>
              Array.from({ length: cols }, (_, c) => {
                const key = ck(c, r);
                const deviceId = cells[key];
                const device = deviceId ? deviceById[deviceId] : null;
                const alreadyUsed = assignedExcept(key);

                return (
                  <div
                    key={key}
                    className="relative rounded-lg border flex flex-col min-h-[72px]"
                    style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
                  >
                    {/* Cell header */}
                    <div className="px-2 pt-1.5 flex items-center justify-between">
                      <span className="text-[10px] font-mono text-[var(--text-faint)]">
                        C{c} R{r}
                      </span>
                      {deviceId && (
                        <button
                          onClick={() => setCells((prev) => { const n = { ...prev }; delete n[key]; return n; })}
                          className="text-[var(--text-faint)] hover:text-red-400 transition-colors"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      )}
                    </div>

                    {/* Device name or picker trigger */}
                    <button
                      onClick={() => setOpenCell(openCell === key ? null : key)}
                      className="flex-1 flex items-center gap-2 px-2 pb-2 text-left"
                    >
                      {device ? (
                        <>
                          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${device.status === 'online' ? 'bg-emerald-400' : 'bg-white/20'}`} />
                          <span className="text-xs text-[var(--text)] truncate leading-snug">{device.name}</span>
                          <ChevronDown className="w-3 h-3 text-[var(--text-faint)] shrink-0 ml-auto" />
                        </>
                      ) : (
                        <span className="text-xs text-[var(--text-faint)] italic">Click to assign</span>
                      )}
                    </button>

                    {/* Dropdown */}
                    {openCell === key && (
                      <div
                        className="absolute top-full left-0 z-20 mt-1 w-56 rounded-lg border shadow-xl overflow-y-auto max-h-52"
                        style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
                      >
                        {/* Clear option */}
                        <button
                          onClick={() => { setCells((p) => { const n = { ...p }; delete n[key]; return n; }); setOpenCell(null); }}
                          className="w-full px-3 py-2 text-left text-xs text-[var(--text-muted)] hover:bg-[var(--bg)] transition-colors"
                        >
                          — Unassign
                        </button>
                        {availableDevices
                          .filter((d) => !alreadyUsed.has(d.id))
                          .map((d) => (
                            <button
                              key={d.id}
                              onClick={() => {
                                setCells((p) => ({ ...p, [key]: d.id }));
                                setOpenCell(null);
                              }}
                              className="w-full px-3 py-2 text-left text-xs flex items-center gap-2 hover:bg-[var(--bg)] transition-colors"
                            >
                              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${d.status === 'online' ? 'bg-emerald-400' : 'bg-white/20'}`} />
                              <span className="truncate text-[var(--text)]">{d.name}</span>
                            </button>
                          ))}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Bezel compensation */}
      <div className="rounded-xl border p-5 flex flex-col gap-4" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-[var(--text)]">Bezel Compensation</h2>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">Physical bezel width per edge (mm). Leave blank to disable.</p>
          </div>
          <button
            onClick={() => saveBezelsMut.mutate()}
            disabled={saveBezelsMut.isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-[var(--blue)] text-white rounded-lg hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            <Save className="w-3.5 h-3.5" />
            {saveBezelsMut.isPending ? 'Saving…' : 'Save Bezels'}
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {([ ['Top', bezelTop, setBezelTop], ['Right', bezelRight, setBezelRight], ['Bottom', bezelBottom, setBezelBottom], ['Left', bezelLeft, setBezelLeft] ] as const).map(([label, val, setter]) => (
            <label key={label} className="flex flex-col gap-1.5">
              <span className="text-[11px] text-[var(--text-muted)]">{label} (mm)</span>
              <input
                type="number"
                min="0"
                step="0.1"
                value={val}
                onChange={(e) => (setter as (v: string) => void)(e.target.value)}
                placeholder="0"
                className="px-2 py-1.5 rounded-lg border bg-[var(--bg)] text-sm text-[var(--text)] border-[var(--border)] outline-none focus:border-[var(--accent)] w-full"
              />
            </label>
          ))}
        </div>
      </div>

      {/* Push manifest */}
      <div className="rounded-xl border p-5 flex items-center justify-between gap-4" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
        <div>
          <h2 className="text-sm font-semibold text-[var(--text)]">Push Manifest</h2>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            Sends wall geometry and peer list to all online screens so they form a sync group and render the correct crop.
          </p>
        </div>
        <button
          onClick={() => pushManifestMut.mutate()}
          disabled={pushManifestMut.isPending}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-emerald-600 text-white rounded-lg hover:opacity-90 disabled:opacity-50 transition-opacity shrink-0"
        >
          <Radio className="w-3.5 h-3.5" />
          {pushManifestMut.isPending ? 'Pushing…' : 'Push to Screens'}
        </button>
      </div>
    </div>
  );
}
