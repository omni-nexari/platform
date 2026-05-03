/**
 * TestSyncPage.tsx
 * DS dashboard page at /test-sync.
 * Shows live logs from SBB + QBC TV, peer connection status, engine mode, and sync metrics.
 * Polls Pi /api/v1/test-sync endpoints every 2s.
 */

import { useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Activity, Radio, Trash2, Zap } from 'lucide-react';
import {
  ActionButton,
  Badge,
  Callout,
  PageHeader,
  SectionCard,
  SectionCardBody,
  SectionCardHeader,
} from '../../components/UiPrimitives.js';
import { api } from '../../lib/api.js';

// ── Types ──────────────────────────────────────────────────────────────────────
interface Peer {
  deviceId: string;
  ip: string;
  role?: string;
  registeredAt?: number;
}

interface LogEntry {
  ts: number;
  level: 'debug' | 'info' | 'warn' | 'error';
  msg: string;
  engineMode?: string;
  driftMs?: number;
  ntpOffsetMs?: number;
}

interface SyncMetrics {
  engineMode: string;
  driftMs: number | null;
  ntpOffsetMs: number | null;
  lastAdjust: string;
  lastTs: number | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function levelColor(level: string) {
  if (level === 'error') return 'text-red-400';
  if (level === 'warn')  return 'text-yellow-400';
  if (level === 'info')  return 'text-[var(--text)]';
  return 'text-[var(--text-muted)]';
}

function driftColor(driftMs: number | null) {
  if (driftMs == null) return 'text-[var(--text-muted)]';
  const abs = Math.abs(driftMs);
  if (abs > 50)  return 'text-red-400 font-bold';
  if (abs > 20)  return 'text-yellow-400';
  return 'text-green-400';
}

function parseSyncMetrics(entries: LogEntry[]): SyncMetrics {
  const last = [...entries].reverse();
  const latest = last[0];
  const adjustEntry = last.find((e) => e.msg.includes('nudge') || e.msg.includes('snap'));
  return {
    engineMode:   latest?.engineMode ?? '—',
    driftMs:      latest?.driftMs    ?? null,
    ntpOffsetMs:  latest?.ntpOffsetMs ?? null,
    lastAdjust:   adjustEntry?.msg ?? '—',
    lastTs:       latest?.ts ?? null,
  };
}

// ── Log panel ─────────────────────────────────────────────────────────────────
function LogPanel({ deviceId, label }: { deviceId: string; label: string }) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();

  const { data, isError } = useQuery({
    queryKey: ['test-sync-logs', deviceId],
    queryFn:  () => api.get<{ logs: LogEntry[] }>(`/test-sync/logs?deviceId=${deviceId}&limit=200`).then((r) => r.data),
    refetchInterval: 2000,
    onSuccess: () => {
      // Auto-scroll
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
    },
  });

  const clearMutation = useMutation({
    mutationFn: () => api.delete(`/test-sync/logs?deviceId=${deviceId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['test-sync-logs', deviceId] }),
  });

  const entries: LogEntry[] = data?.logs ?? [];
  const metrics = parseSyncMetrics(entries);

  return (
    <SectionCard>
      <SectionCardHeader>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-[var(--text-muted)]" />
            <h2 className="text-base font-semibold text-[var(--text)]">{label}</h2>
            <Badge tone={isError ? 'danger' : 'default'}>{deviceId}</Badge>
          </div>
          <ActionButton
            size="sm"
            tone="ghost"
            icon={<Trash2 className="h-3.5 w-3.5" />}
            onClick={() => clearMutation.mutate()}
            disabled={clearMutation.isPending}
          >
            Clear
          </ActionButton>
        </div>
        {/* Metrics summary row */}
        <div className="mt-2 flex flex-wrap gap-4 text-xs text-[var(--text-muted)]">
          <span>Engine: <strong className="text-[var(--text)]">{metrics.engineMode.toUpperCase()}</strong></span>
          <span>
            Drift:{' '}
            <strong className={driftColor(metrics.driftMs)}>
              {metrics.driftMs != null ? `${metrics.driftMs > 0 ? '+' : ''}${metrics.driftMs}ms` : '—'}
            </strong>
          </span>
          <span>NTP offset: <strong className="text-[var(--text)]">{metrics.ntpOffsetMs != null ? `${metrics.ntpOffsetMs}ms` : '—'}</strong></span>
          <span className="truncate max-w-xs">Last adjust: <span className="text-[var(--text)]">{metrics.lastAdjust}</span></span>
        </div>
      </SectionCardHeader>
      <SectionCardBody>
        <div className="h-64 overflow-y-auto rounded-xl bg-[var(--surface)] p-3 font-mono text-xs space-y-0.5">
          {entries.length === 0 && (
            <span className="text-[var(--text-muted)]">No logs yet — waiting for device…</span>
          )}
          {entries.map((e, i) => (
            <div key={i} className={`${levelColor(e.level)} whitespace-pre-wrap break-all leading-5`}>
              <span className="text-[var(--text-muted)]">{new Date(e.ts).toLocaleTimeString()} </span>
              <span className="opacity-60">[{e.level.toUpperCase()}] </span>
              {e.msg}
              {e.driftMs != null && (
                <span className={`ml-2 ${driftColor(e.driftMs)}`}>Δ{e.driftMs > 0 ? '+' : ''}{e.driftMs}ms</span>
              )}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      </SectionCardBody>
    </SectionCard>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function TestSyncPage() {
  const [engineOverride, setEngineOverride] = useState<'mse' | 'wasm' | null>(null);
  const [overrideStatus, setOverrideStatus] = useState<string | null>(null);

  // Poll registered peers
  const peersQuery = useQuery({
    queryKey: ['test-sync-peers'],
    queryFn:  () => api.get<{ peers: Peer[] }>('/test-sync/peers?groupId=synctest-001').then((r) => r.data),
    refetchInterval: 5000,
  });

  const peers: Peer[] = peersQuery.data?.peers ?? [];
  const connected     = peers.length >= 2;

  // Trigger SET_ENGINE via the leader's HTTP shortcut (Pi relays via Redis pubsub to leader)
  // Actually, the Pi relay doesn't push commands to devices — devices pull.
  // Instead we POST a special signal to the leader device's signal queue with type SET_ENGINE.
  // The leader will pick it up on its next signal drain cycle.
  const leaderPeer = peers.find((p) => p.role === 'leader') ?? peers[0];

  async function handleSetEngine(mode: 'mse' | 'wasm') {
    if (!leaderPeer) { setOverrideStatus('No leader device registered'); return; }
    setEngineOverride(mode);
    setOverrideStatus('Sending SET_ENGINE…');
    try {
      await api.post(`/test-sync/signal/${leaderPeer.deviceId}`, {
        from: 'dashboard',
        seq: Date.now(),
        body: { type: 'SET_ENGINE_OVERRIDE', engineMode: mode },
      });
      setOverrideStatus(`SET_ENGINE(${mode}) sent to leader — TV will switch momentarily`);
    } catch (e: any) {
      setOverrideStatus(`Error: ${e?.message ?? 'unknown'}`);
    }
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader
        icon={<Radio className="h-5 w-5" />}
        title="Sync Engine Test"
        description="Live view of MSE vs WASM engine comparison on SBB + QBC TVs. CH+ on the leader TV toggles both engines simultaneously."
      />

      {/* Connection status */}
      <SectionCard>
        <SectionCardHeader>
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-[var(--text-muted)]" />
            <h2 className="text-base font-semibold text-[var(--text)]">Peer Connection</h2>
            <Badge tone={connected ? 'success' : peersQuery.isError ? 'danger' : 'warning'}>
              {connected ? 'Both TVs connected' : peers.length === 1 ? '1 TV connected' : 'Waiting for TVs…'}
            </Badge>
          </div>
        </SectionCardHeader>
        <SectionCardBody>
          {peers.length === 0 && (
            <Callout tone="warning">No devices have registered yet. Install NexariSyncTest.wgt on both TVs and launch the app.</Callout>
          )}
          {peers.length > 0 && (
            <div className="flex flex-wrap gap-4">
              {peers.map((p) => (
                <div key={p.deviceId} className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 text-sm space-y-1 min-w-48">
                  <div className="font-semibold text-[var(--text)]">{p.deviceId}</div>
                  <div className="text-[var(--text-muted)]">IP: {p.ip}</div>
                  {p.role && <Badge tone={p.role === 'leader' ? 'success' : 'default'}>{p.role}</Badge>}
                </div>
              ))}
            </div>
          )}
        </SectionCardBody>
      </SectionCard>

      {/* Engine toggle */}
      <SectionCard>
        <SectionCardHeader>
          <h2 className="text-base font-semibold text-[var(--text)]">Engine Mode Override</h2>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            Force both TVs to a specific engine. Alternatively, press <strong>CH+</strong> on the leader TV remote.
          </p>
        </SectionCardHeader>
        <SectionCardBody>
          <div className="flex items-center gap-3">
            <ActionButton
              tone={engineOverride === 'mse' ? 'primary' : 'ghost'}
              onClick={() => handleSetEngine('mse')}
              disabled={!leaderPeer}
            >
              Use MSE
            </ActionButton>
            <ActionButton
              tone={engineOverride === 'wasm' ? 'primary' : 'ghost'}
              onClick={() => handleSetEngine('wasm')}
              disabled={!leaderPeer}
            >
              Use WASM
            </ActionButton>
          </div>
          {overrideStatus && (
            <p className="mt-3 text-sm text-[var(--text-muted)]">{overrideStatus}</p>
          )}
        </SectionCardBody>
      </SectionCard>

      {/* Device log panels */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <LogPanel deviceId="sbb" label="SBB TV" />
        <LogPanel deviceId="qbc" label="QBC TV" />
      </div>
    </div>
  );
}
