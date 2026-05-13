import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { Plus, Trash2, Rocket, PackageCheck, CheckCircle2 } from 'lucide-react';
import { z } from 'zod';
import { saApi } from '../../lib/superadmin-auth.js';
import {
  Badge,
  EmptyState,
  InlineActionButton,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  ModalPrimaryButton,
  ModalSecondaryButton,
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

const PublishFormSchema = z.object({
  version: z
    .string()
    .min(1, 'Version is required')
    .regex(/^\d+\.\d+\.\d+$/, 'Use semver format (e.g. 1.2.3)'),
  platform: z.enum(PLATFORMS),
  downloadUrl: z.string().url('Must be a valid URL'),
  releaseNotes: z.string().optional(),
});
type PublishFormData = z.infer<typeof PublishFormSchema>;

interface PlayerRelease {
  id: string;
  platform: ReleasePlatform;
  version: string;
  downloadUrl: string;
  releaseNotes: string | null;
  isLatest: boolean;
  superadminApprovedAt: string | null;
  publishedAt: string;
  createdAt: string;
}

export default function PlayerReleasesPage() {
  const qc = useQueryClient();
  const [showPublish, setShowPublish] = useState(false);
  const [deploying, setDeploying] = useState<string | null>(null);
  const [platformTab, setPlatformTab] = useState<ReleasePlatform | 'all'>('all');

  const { data: releases = [], isLoading } = useQuery({
    queryKey: ['sa-player-releases'],
    queryFn: () => saApi.get<PlayerRelease[]>('/player-releases/'),
    staleTime: 10_000,
  });

  const filtered = platformTab === 'all' ? releases : releases.filter((r) => r.platform === platformTab);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<PublishFormData>({
    resolver: zodResolver(PublishFormSchema),
    defaultValues: { platform: 'tizen' },
  });

  const publish = useMutation({
    mutationFn: (data: PublishFormData) =>
      saApi.post<PlayerRelease>('/player-releases/', data),
    onSuccess: () => {
      toast.success('Release published');
      void qc.invalidateQueries({ queryKey: ['sa-player-releases'] });
      reset();
      setShowPublish(false);
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to publish release'),
  });

  const approve = useMutation({
    mutationFn: (id: string) => saApi.post<PlayerRelease>(`/player-releases/${id}/approve`, {}),
    onSuccess: () => {
      toast.success('Release approved — resellers can now see it');
      void qc.invalidateQueries({ queryKey: ['sa-player-releases'] });
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to approve release'),
  });

  const remove = useMutation({
    mutationFn: (id: string) => saApi.delete<void>(`/player-releases/${id}`),
    onSuccess: () => {
      toast.success('Release deleted');
      void qc.invalidateQueries({ queryKey: ['sa-player-releases'] });
    },
    onError: (err: Error) => toast.error(err.message || 'Failed to delete release'),
  });

  async function deployToAll(release: PlayerRelease) {
    setDeploying(release.id);
    try {
      const result = await saApi.post<{ sentToDevices: number }>(
        `/player-releases/${release.id}/deploy`,
        {},
      );
      toast.success(`Update command sent to ${result.sentToDevices} device(s)`);
    } catch (err) {
      toast.error((err as Error).message || 'Deploy failed');
    } finally {
      setDeploying(null);
    }
  }

  function closePublish() {
    setShowPublish(false);
    reset();
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <PageHeader
        title="Player Releases"
        description="Manage OTA player releases. Approve a release to make it visible to resellers."
        actions={
          <InlineActionButton onClick={() => setShowPublish(true)}>
            <Plus size={14} />
            Publish Release
          </InlineActionButton>
        }
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
          title="No releases yet"
          description="Run a deploy-*.ps1 script, then publish a release record here."
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
                  {r.superadminApprovedAt ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-500/15 text-green-400 border border-green-500/30">
                      <CheckCircle2 size={11} />
                      Approved
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-500/15 text-amber-400 border border-amber-500/30">
                      Pending approval
                    </span>
                  )}
                </div>
                <p className="text-xs text-[var(--text-muted)] truncate">{r.downloadUrl}</p>
                {r.releaseNotes ? (
                  <p className="text-xs text-[var(--text-muted)] mt-0.5 line-clamp-1">
                    {r.releaseNotes}
                  </p>
                ) : null}
              </div>
              <span className="text-xs text-[var(--text-muted)] shrink-0">
                {new Date(r.publishedAt).toLocaleDateString()}
              </span>
              <div className="flex items-center gap-2 shrink-0">
                {!r.superadminApprovedAt && (
                  <InlineActionButton
                    onClick={() => approve.mutate(r.id)}
                    disabled={approve.isPending}
                  >
                    <CheckCircle2 size={13} />
                    Approve
                  </InlineActionButton>
                )}
                <InlineActionButton
                  onClick={() => void deployToAll(r)}
                  disabled={deploying === r.id}
                >
                  <Rocket size={13} />
                  {deploying === r.id ? 'Sending…' : 'Push to Devices'}
                </InlineActionButton>
                <InlineActionButton
                  tone="danger"
                  disabled={remove.isPending}
                  onClick={() => {
                    if (window.confirm(`Delete release v${r.version}?`)) {
                      remove.mutate(r.id);
                    }
                  }}
                >
                  <Trash2 size={13} />
                </InlineActionButton>
              </div>
            </div>
          ))}
        </div>
      )}

      {showPublish ? (
        <Modal onClose={closePublish}>
          <ModalHeader onClose={closePublish}>Publish New Release</ModalHeader>
          <form onSubmit={handleSubmit((d) => publish.mutate(d))}>
            <ModalBody className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-[var(--text)] mb-1">
                  Platform
                </label>
                <select {...register('platform')} className="ui-input w-full">
                  {PLATFORMS.map((p) => (
                    <option key={p} value={p}>{PLATFORM_LABELS[p]}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--text)] mb-1">
                  Version
                </label>
                <input
                  {...register('version')}
                  placeholder="1.2.3"
                  className="ui-input w-full"
                />
                {errors.version ? (
                  <p className="text-xs text-red-500 mt-1">{errors.version.message}</p>
                ) : null}
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--text)] mb-1">
                  Download URL
                </label>
                <input
                  {...register('downloadUrl')}
                  placeholder="https://ds.chiho.app/tizen/NexariPlayer.wgt"
                  className="ui-input w-full"
                />
                {errors.downloadUrl ? (
                  <p className="text-xs text-red-500 mt-1">{errors.downloadUrl.message}</p>
                ) : null}
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--text)] mb-1">
                  Release Notes{' '}
                  <span className="text-[var(--text-muted)]">(optional)</span>
                </label>
                <textarea
                  {...register('releaseNotes')}
                  rows={3}
                  placeholder="What changed in this version…"
                  className="ui-input w-full resize-none"
                />
              </div>
            </ModalBody>
            <ModalFooter>
              <ModalSecondaryButton type="button" onClick={closePublish}>
                Cancel
              </ModalSecondaryButton>
              <ModalPrimaryButton type="submit" disabled={isSubmitting}>
                {isSubmitting ? 'Publishing…' : 'Publish'}
              </ModalPrimaryButton>
            </ModalFooter>
          </form>
        </Modal>
      ) : null}
    </div>
  );
}
