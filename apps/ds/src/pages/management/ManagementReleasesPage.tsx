import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { PackageCheck, CheckCircle2 } from 'lucide-react';
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

export default function ManagementReleasesPage() {
  const qc = useQueryClient();
  const [platformTab, setPlatformTab] = useState<ReleasePlatform | 'all'>('all');

  const { data: releases = [], isLoading } = useQuery({
    queryKey: ['mgmt-player-releases'],
    queryFn: () => saApi.get<ManagedRelease[]>('/player-releases/management-list'),
    staleTime: 15_000,
  });

  const filtered = platformTab === 'all' ? releases : releases.filter((r) => r.platform === platformTab);

  const approve = useMutation({
    mutationFn: (id: string) =>
      saApi.post<{ ok: boolean }>(`/player-releases/${id}/management-approve`, {}),
    onSuccess: () => {
      toast.success('Release approved — devices will now see the update notification');
      void qc.invalidateQueries({ queryKey: ['mgmt-player-releases'] });
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to approve release'),
  });

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <PageHeader
        title="App Releases"
        description="Review platform-approved releases and approve them for your client organizations."
      />

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

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16 rounded-lg" />
          ))}
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
                  <span className="font-mono font-semibold text-sm text-[var(--text)]">
                    v{r.version}
                  </span>
                  <Badge tone="neutral">{PLATFORM_LABELS[r.platform] ?? r.platform}</Badge>
                  {r.isLatest && <Badge tone="success">Latest</Badge>}
                  {r.managementApproved ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-500/15 text-green-400 border border-green-500/30">
                      <CheckCircle2 size={11} />
                      Approved for clients
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-500/15 text-amber-400 border border-amber-500/30">
                      Pending your approval
                    </span>
                  )}
                </div>
                {r.releaseNotes ? (
                  <p className="text-xs text-[var(--text-muted)] mt-0.5 line-clamp-2">
                    {r.releaseNotes}
                  </p>
                ) : null}
                <p className="text-xs text-[var(--text-muted)] mt-0.5">
                  Released {new Date(r.publishedAt).toLocaleDateString()}
                </p>
              </div>
              {!r.managementApproved && (
                <div className="shrink-0">
                  <InlineActionButton
                    onClick={() => approve.mutate(r.id)}
                    disabled={approve.isPending}
                  >
                    <CheckCircle2 size={13} />
                    Approve for clients
                  </InlineActionButton>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
