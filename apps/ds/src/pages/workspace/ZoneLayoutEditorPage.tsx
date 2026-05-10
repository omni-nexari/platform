import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, Send } from 'lucide-react';
import { api } from '../../lib/api.js';
import ZoneLayoutEditor, { type ZoneConfig, DEVICE_W, DEVICE_H } from '../../components/ZoneLayoutEditor.js';
import { ActionButton, Skeleton } from '../../components/UiPrimitives.js';
import DevicePickerModal, { type PickedDevice } from '../../components/DevicePickerModal.js';

const DEFAULT_IMAGE_SECS = 10;

function computeZonesTotalDuration(zones: ZoneConfig[]): number | null {
  let max: number | null = null;
  for (const zone of zones) {
    const src = zone.source as any;
    if (!src || src.type === 'empty') continue;
    let d: number | null = src.sourceDuration ?? null;
    if (d == null && src.type === 'content') {
      const t = (src.contentType ?? '').toLowerCase();
      if (t === 'image') d = DEFAULT_IMAGE_SECS;
    }
    if (d != null && (max == null || d > max)) max = d;
  }
  return max;
}

interface ContentItem {
  id: string;
  name: string;
  type: string;
  metadata: string;
  duration: number | null;
}

export default function ZoneLayoutEditorPage() {
  const { wsId, id } = useParams<{ wsId: string; id: string }>();
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDuration, setEditDuration] = useState<string>('');
  const [publishOpen, setPublishOpen] = useState(false);
  // savedId tracks the persisted content ID (undefined while still "new")
  const [savedId, setSavedId] = useState<string | undefined>(id === 'new' ? undefined : id);

  const isNew = id === 'new';

  const { data: item, isLoading } = useQuery<ContentItem>({
    queryKey: ['content-item', id],
    queryFn: () => api.get(`/content/${id}`),
    enabled: !!id && !isNew,
  });

  useEffect(() => {
    if (item) {
      setEditName(item.name);
      setEditDuration(item.duration != null ? String(item.duration) : '');
    }
  }, [item]);

  // Memoize initialZones so the reference only changes when the fetched
  // metadata changes — NOT on every render (e.g. when typing the name).
  // Without this, ZoneLayoutEditor's useEffect resets zones on every keystroke.
  const initialZones = useMemo<ZoneConfig[]>(() => {
    if (!item?.metadata) return [];
    try {
      const parsed = JSON.parse(item.metadata);
      // canvasWidth/Height stored in metadata for awareness; zones use DEVICE_W/DEVICE_H from editor
      return Array.isArray(parsed.zones) ? parsed.zones : [];
    } catch {
      return [];
    }
  }, [item?.metadata]);

  const publishMut = useMutation({
    mutationFn: (deviceIds: string[]) => {
      if (!savedId) throw new Error('Save the zone layout before publishing');
      return api.post('/devices/publish', {
        workspaceId: wsId,
        deviceIds,
        resourceType: 'content',
        resourceId: savedId,
      });
    },
    onSuccess: (_data, deviceIds) => {
      toast.success(`Published to ${deviceIds.length} screen${deviceIds.length === 1 ? '' : 's'}`);
      setPublishOpen(false);
    },
    onError: (err: unknown) => toast.error(err instanceof Error ? err.message : 'Failed to publish'),
  });

  async function handleSave(zones: ZoneConfig[]) {
    if (!wsId) return;
    setSaving(true);
    const manualDuration = editDuration.trim() ? Number(editDuration) : null;
    const autoDuration = computeZonesTotalDuration(zones);
    const durationSecs = (manualDuration != null && !isNaN(manualDuration)) ? manualDuration : autoDuration;
    try {
      if (isNew) {
        const name = editName.trim() || 'Untitled Zone Layout';
        const created = await api.post<ContentItem>('/content/zone-layout', {
          workspaceId: wsId,
          name,
          zones,
          canvasWidth: DEVICE_W,
          canvasHeight: DEVICE_H,
        });
        if (durationSecs != null) {
          await api.patch(`/content/${created.id}`, { duration: durationSecs });
        }
        toast.success('Zone layout created');
        setSavedId(created.id);
        navigate(`/workspaces/${wsId}/zone-layout/${created.id}`, { replace: true });
      } else {
        await api.patch(`/content/${id}`, {
          name: editName.trim() || item?.name,
          zones,
          canvasWidth: DEVICE_W,
          canvasHeight: DEVICE_H,
          ...(durationSecs != null ? { duration: durationSecs } : {}),
        });
        setSavedId(id);
        toast.success('Zone layout saved');
      }
    } catch {
      toast.error('Failed to save zone layout');
    } finally {
      setSaving(false);
    }
  }

  if (!isNew && isLoading) {
    return (
      <div className="h-full overflow-y-auto bg-[var(--surface)] p-4 sm:p-6 lg:p-8">
        <Skeleton className="h-8 w-48 rounded-lg mb-6" />
        <Skeleton className="h-[360px] w-[640px] rounded-2xl mb-4" />
        <Skeleton className="h-32 w-full rounded-xl" />
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-[var(--surface)]">
      <div className="max-w-6xl mx-auto p-4 sm:p-6 lg:p-8">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <button
            onClick={() => navigate(`/workspaces/${wsId}/content`)}
            className="p-2 rounded-lg text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-raised)] transition-colors"
          >
            <ArrowLeft size={18} />
          </button>
          <input
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            placeholder="Untitled Zone Layout"
            className="flex-1 text-lg font-semibold text-[var(--text)] bg-transparent border-none outline-none placeholder:text-[var(--text-muted)]"
          />
          <div className="flex items-center gap-1.5 shrink-0">
            <label className="text-xs text-[var(--text-muted)] whitespace-nowrap">Duration (s)</label>
            <input
              type="number"
              min="1"
              value={editDuration}
              onChange={(e) => setEditDuration(e.target.value)}
              placeholder="auto"
              className="w-20 text-sm text-[var(--text)] bg-[var(--surface-raised)] border border-[var(--border)] rounded-lg px-2 py-1 outline-none focus:border-[var(--accent)] text-center"
            />
          </div>
          <ActionButton
            tone="primary"
            onClick={() => setPublishOpen(true)}
            disabled={!savedId}
            className="px-3 py-2 text-sm shrink-0 flex items-center gap-1.5"
            title={!savedId ? 'Save first to enable publishing' : 'Push to screens'}
          >
            <Send size={14} /> Publish
          </ActionButton>
        </div>

        <ZoneLayoutEditor
          initialZones={initialZones}
          workspaceId={wsId ?? ''}
          saving={saving}
          onSave={handleSave}
        />
      </div>

      <DevicePickerModal
        open={publishOpen}
        onClose={() => setPublishOpen(false)}
        workspaceId={wsId ?? ''}
        onSelect={(devices: PickedDevice[]) => publishMut.mutate(devices.map((d) => d.id))}
        title="Publish Zone Layout to Screens"
      />
    </div>
  );
}
