import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router';
import { useState } from 'react';
import { toast } from 'sonner';
import { api } from '../../lib/api.js';
import { Layers, Plus, ChevronRight, Monitor, Tv, LayoutGrid, MapPin, Tag } from 'lucide-react';
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
  Skeleton,
} from '../../components/UiPrimitives.js';

interface DeviceGroup {
  id: string;
  name: string;
  type: 'sync' | 'videowall' | 'location' | 'tag';
  description: string | null;
  memberCount: number;
  createdAt: string;
}

const TYPE_META: Record<DeviceGroup['type'], { label: string; icon: React.ReactNode; tone: 'neutral' | 'info' | 'warning' | 'success' }> = {
  sync: { label: 'Sync', icon: <Monitor className="w-4 h-4" />, tone: 'info' },
  videowall: { label: 'Video Wall', icon: <LayoutGrid className="w-4 h-4" />, tone: 'success' },
  location: { label: 'Location', icon: <MapPin className="w-4 h-4" />, tone: 'neutral' },
  tag: { label: 'Tag Group', icon: <Tag className="w-4 h-4" />, tone: 'warning' },
};

const GROUP_TYPES = ['sync', 'videowall', 'location', 'tag'] as const;

export default function DeviceGroupsPage() {
  const { wsId } = useParams<{ wsId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<DeviceGroup['type']>('location');
  const [newDesc, setNewDesc] = useState('');

  const { data: groups = [], isLoading } = useQuery<DeviceGroup[]>({
    queryKey: ['device-groups', wsId],
    queryFn: () => api.get(`/device-groups?workspaceId=${wsId}`),
  });

  const createMut = useMutation({
    mutationFn: () =>
      api.post('/device-groups', { workspaceId: wsId, name: newName, type: newType, description: newDesc || null }),
    onSuccess: (group: DeviceGroup) => {
      toast.success('Group created');
      setCreateOpen(false);
      setNewName('');
      setNewDesc('');
      void queryClient.invalidateQueries({ queryKey: ['device-groups', wsId] });
    },
    onError: () => toast.error('Failed to create group'),
  });

  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6 max-w-screen-xl mx-auto">
      <PageHeader
        title="Device Groups"
        description="Organise devices into sync groups, video walls, and locations"
        actions={
          <button
            className="ui-btn-primary flex items-center gap-1.5"
            onClick={() => setCreateOpen(true)}
          >
            <Plus className="w-4 h-4" />
            New Group
          </button>
        }
      />

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
      ) : groups.length === 0 ? (
        <EmptyState
          icon={<Layers className="w-8 h-8" />}
          title="No device groups"
          description="Create groups to organise devices for sync playback, video walls, or physical locations."
          action={
            <button className="ui-btn-primary" onClick={() => setCreateOpen(true)}>
              New Group
            </button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {groups.map((group) => {
            const meta = TYPE_META[group.type] ?? TYPE_META.location;
            return (
              <div
                key={group.id}
                className="ui-card p-4 flex flex-col gap-3 cursor-pointer hover:border-[var(--blue)] transition-colors"
                onClick={() => navigate(`/workspaces/${wsId}/devices/groups/${group.id}`)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg bg-[var(--surface)] flex items-center justify-center text-[var(--text-muted)]">
                      {meta.icon}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-[var(--text)] truncate">{group.name}</p>
                      <p className="text-xs text-[var(--text-muted)]">
                        {group.memberCount} device{group.memberCount !== 1 ? 's' : ''}
                      </p>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-[var(--text-muted)] shrink-0" />
                </div>
                {group.description && (
                  <p className="text-xs text-[var(--text-muted)] line-clamp-2">{group.description}</p>
                )}
                <Badge tone={meta.tone}>{meta.label}</Badge>
              </div>
            );
          })}
        </div>
      )}

      <Modal open={createOpen} onClose={() => setCreateOpen(false)}>
        <ModalHeader>New Device Group</ModalHeader>
        <ModalBody>
          <div className="space-y-4">
            <div>
              <label className="ui-label">Group Name</label>
              <input
                className="ui-input w-full"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Lobby Videowall"
                autoFocus
              />
            </div>
            <div>
              <label className="ui-label">Type</label>
              <div className="grid grid-cols-2 gap-2">
                {GROUP_TYPES.map((t) => {
                  const m = TYPE_META[t];
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setNewType(t)}
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-colors ${
                        newType === t
                          ? 'border-[var(--blue)] bg-[var(--blue)]/10 text-[var(--text)]'
                          : 'border-[var(--card-border)] text-[var(--text-muted)] hover:text-[var(--text)]'
                      }`}
                    >
                      {m.icon}
                      {m.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              <label className="ui-label">Description (optional)</label>
              <input
                className="ui-input w-full"
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                placeholder="What is this group used for?"
              />
            </div>
          </div>
        </ModalBody>
        <ModalFooter>
          <ModalSecondaryButton onClick={() => setCreateOpen(false)}>Cancel</ModalSecondaryButton>
          <ModalPrimaryButton
            onClick={() => createMut.mutate()}
            disabled={!newName.trim() || createMut.isPending}
          >
            Create Group
          </ModalPrimaryButton>
        </ModalFooter>
      </Modal>
    </div>
  );
}
