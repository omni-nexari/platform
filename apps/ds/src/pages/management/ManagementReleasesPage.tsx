import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { PackageCheck, CheckCircle2, Cpu, Send, Download } from 'lucide-react';
import { saApi } from '../../lib/superadmin-auth.js';
import {
  Badge,
  EmptyState,
  InlineActionButton,
  PageHeader,
  Skeleton,
} from '../../components/UiPrimitives.js';

const PLATFORMS = ['tizen', 'android', 'windows', 'epaper'] as const;
type ReleasePlatform = (typeof PLATFORMS)[number];
const PLATFORM_LABELS: Record<ReleasePlatform, string> = {
  tizen: 'Tizen',
  android: 'Android',
  windows: 'Windows',
  epaper: 'ePaper',
};

interface ManagedRelease {
  id: string;
  platform: ReleasePlatform;
  version: string;
  downloadUrl: string;
  releaseNotes: string | null;
  isLatest: boolean;
  superadminApprovedAt: string;
  publishedAt: string;
  managementApproved: boolean;
}

interface ManagedFirmwareRelease {
  id: string;
  firmwareModel: string;
  version: string;
  swVersionString: string;
  fileName: string;
  releaseNotes: string | null;
  isLatest: boolean;
  superadminApproved: boolean;
  publishedAt: string;
  managementApproved: boolean;
  compatibleDeviceCount: number;
}

type PageTab = 'app' | 'firmware';

export default function ManagementReleasesPage() {
  const qc = useQueryClient();
  const [pageTab, setPageTab] = useState<PageTab>('app');
  const [platformTab, setPlatformTab] = useState<ReleasePlatform | 'all'>('all');
  const [deploying, setDeploying] = useState<string | null>(null);

  // â”€â”€ App releases â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const { data: releases = [], isLoading: releasesLoading } = useQuery({
    queryKey: ['mgmt-player-releases'],
    queryFn: () => saApi.get<ManagedRelease[]>('/player-releases/management-list'),
    staleTime: 15_000,
  });

  const filtered = platformTab === 'all' ? releases : releases.filter((r) => r.platform === platformTab);

  const approve = useMutation({
    mutationFn: (id: string) =>
      saApi.post<{ ok: boolean }>(`/player-releases/${id}/management-approve`, {}),
    onSuccess: () => {
      toast.success('Release approved â€” devices will now see the update notification');
      void qc.invalidateQueries({ queryKey: ['mgmt-player-releases'] });
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to approve release'),
  });

  // â”€â”€ Firmware releases â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const { data: firmwareReleases = [], isLoading: firmwareLoading } = useQuery({
    queryKey: ['mgmt-firmware-releases'],
    queryFn: () => saApi.get<ManagedFirmwareRelease[]>('/firmware-releases/management-list'),
    staleTime: 15_000,
  });

  const approveFirmware = useMutation({
    mutationFn: (id: string) =>
      saApi.post<{ ok: boolean }>(`/firmware-releases/${id}/management-approve`, {}),
    onSuccess: () => {
      toast.success('Firmware approved â€” you can now deploy to compatible devices');
      void qc.invalidateQueries({ queryKey: ['mgmt-firmware-releases'] });
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to approve firmware'),
  });

  const deployFirmware = async (id: string) => {
    setDeploying(id);
    try {
      const res = await saApi.post<{ sent: number; skipped: number; total: number }>(
        `/firmware-releases/${id}/deploy`, {}
      );
      toast.success(`Firmware deploy sent to ${res.sent} device${res.sent !== 1 ? 's' : ''}${res.skipped > 0 ? ` (${res.skipped} offline, skipped)` : ''}`);
      void qc.invalidateQueries({ queryKey: ['mgmt-firmware-releases'] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Deploy failed');
    } finally {
      setDeploying(null);
    }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <PageHeader
        title="Releases"
        description="Manage app and firmware releases for your client organizations."
      />

      {/* â”€â”€ Page tab bar â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      <div className="flex gap-2 border-b" style={{ borderColor: 'var(--card-border)' }}>
        <button
          type="button"
          onClick={() => setPageTab('app')}
          className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-t transition-colors -mb-px border-b-2 ${
            pageTab === 'app'
              ? 'border-[var(--accent)] text-[var(--accent)] bg-[var(--surface-raised)]'
              : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text)]'
          }`}
        >
          <PackageCheck size={14} />App Updates
        </button>
        <button
          type="button"
          onClick={() => setPageTab('firmware')}
          className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-t transition-colors -mb-px border-b-2 ${
            pageTab === 'firmware'
              ? 'border-[var(--accent)] text-[var(--accent)] bg-[var(--surface-raised)]'
              : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text)]'
          }`}
        >
          <Cpu size={14} />Screen Firmware
        </button>
      </div>

      {/* â”€â”€ App Updates tab â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      {pageTab === 'app' && (
        <>
          {/* Platform tabs */}
          <div className="flex gap-1 border-b" style={{ borderColor: 'var(--card-border)' }}>
            {(['all', ...PLATFORMS] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setPlatformTab(t)}
                className={`px-3 py-2 text-xs font-medium rounded-t transition-colors ${
                  platformTab === t
                    ? 'bg-[var(--accent)] text-white'
                    : 'text-[var(--text-muted)] hover:text-[var(--text)]'
                }`}
              >
                {t === 'all' ? 'All' : PLATFORM_LABELS[t]}
              </button>
            ))}
          </div>

          {releasesLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-16 rounded-lg" />)}
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={<PackageCheck size={32} />}
              title="No approved releases"
              description="Once the platform owner approves a release it will appear here for you to review."
            />
          ) : (
            <div
              className="rounded-lg border divide-y"
              style={{ borderColor: 'var(--card-border)', background: 'var(--bg2)' }}
            >
              {filtered.map((r) => (
                <div key={r.id} className="flex items-center gap-4 px-5 py-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="font-mono font-semibold text-sm text-[var(--text)]">v{r.version}</span>
                      <Badge tone="neutral">{PLATFORM_LABELS[r.platform] ?? r.platform}</Badge>
                      {r.isLatest && <Badge tone="success">Latest</Badge>}
                      {r.managementApproved ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-500/15 text-green-400 border border-green-500/30">
                          <CheckCircle2 size={11} />Approved for clients
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-500/15 text-amber-400 border border-amber-500/30">
                          Pending your approval
                        </span>
                      )}
                    </div>
                    {r.releaseNotes && (
                      <p className="text-xs text-[var(--text-muted)] mt-0.5 line-clamp-2">{r.releaseNotes}</p>
                    )}
                    <p className="text-xs text-[var(--text-muted)] mt-0.5">
                      Released {new Date(r.publishedAt).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="shrink-0 flex items-center gap-2">
                    <a
                      href={r.downloadUrl}
                      download
                      title={`Download v${r.version}`}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium border transition-colors"
                      style={{ borderColor: 'var(--card-border)', color: 'var(--text-muted)' }}
                    >
                      <Download size={12} />{r.downloadUrl.split('/').pop()}
                    </a>
                    {!r.managementApproved && (
                      <InlineActionButton onClick={() => approve.mutate(r.id)} disabled={approve.isPending}>
                        <CheckCircle2 size={13} />Approve for clients
                      </InlineActionButton>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* â”€â”€ Screen Firmware tab â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      {pageTab === 'firmware' && (
        <>
          {firmwareLoading ? (
            <div className="space-y-2">
              {[1, 2].map((i) => <Skeleton key={i} className="h-20 rounded-lg" />)}
            </div>
          ) : firmwareReleases.length === 0 ? (
            <EmptyState
              icon={<Cpu size={32} />}
              title="No firmware releases"
              description="Once the platform owner publishes and approves a firmware release it will appear here."
            />
          ) : (
            <div
              className="rounded-lg border divide-y"
              style={{ borderColor: 'var(--card-border)', background: 'var(--bg2)' }}
            >
              {firmwareReleases.map((r) => (
                <div key={r.id} className="flex items-center gap-4 px-5 py-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="font-mono font-semibold text-sm text-[var(--text)]">{r.swVersionString}</span>
                      <Badge tone="neutral">Tizen Firmware</Badge>
                      {r.isLatest && <Badge tone="success">Latest</Badge>}
                      {r.managementApproved ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-500/15 text-green-400 border border-green-500/30">
                          <CheckCircle2 size={11} />Approved
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-500/15 text-amber-400 border border-amber-500/30">
                          Pending your approval
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-[var(--text-muted)] mt-0.5">
                      Model: <span className="font-mono text-[var(--text)]">{r.firmwareModel}</span>
                      {' Â· '}{r.compatibleDeviceCount} compatible device{r.compatibleDeviceCount !== 1 ? 's' : ''} in your account
                    </p>
                    {r.releaseNotes && (
                      <p className="text-xs text-[var(--text-muted)] mt-0.5 line-clamp-2">{r.releaseNotes}</p>
                    )}
                    <p className="text-xs text-[var(--text-muted)] mt-0.5">
                      Published {new Date(r.publishedAt).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex flex-col gap-2 shrink-0">
                    {!r.managementApproved && (
                      <InlineActionButton
                        onClick={() => approveFirmware.mutate(r.id)}
                        disabled={approveFirmware.isPending}
                      >
                        <CheckCircle2 size={13} />Approve
                      </InlineActionButton>
                    )}
                    {r.managementApproved && r.compatibleDeviceCount > 0 && (
                      <button
                        type="button"
                        onClick={() => void deployFirmware(r.id)}
                        disabled={deploying === r.id}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-[var(--blue)] text-white hover:opacity-90 disabled:opacity-40 transition-opacity"
                      >
                        <Send size={13} />{deploying === r.id ? 'Deployingâ€¦' : `Deploy to ${r.compatibleDeviceCount} device${r.compatibleDeviceCount !== 1 ? 's' : ''}`}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
