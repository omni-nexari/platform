import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Tag } from 'lucide-react';
import { api } from '../lib/api.js';
import {
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  ModalPrimaryButton,
  ModalSecondaryButton,
} from './UiPrimitives.js';

type EntityType = 'device' | 'content' | 'playlist' | 'schedule';

interface WorkspaceTag {
  id: string;
  name: string;
  color: string | null;
}

interface TagCategory {
  id: string;
  name: string;
  color: string;
  availableFor: string[];
  tags: WorkspaceTag[];
}

interface Props {
  workspaceId: string;
  entityType: EntityType;
  entityIds: string[];
  onClose: () => void;
  onApplied: () => void;
}

export default function BulkTagModal({
  workspaceId,
  entityType,
  entityIds,
  onClose,
  onApplied,
}: Props) {
  const queryClient = useQueryClient();
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);

  const { data: categories = [], isLoading } = useQuery<TagCategory[]>({
    queryKey: ['workspace-tags', workspaceId],
    queryFn: () => api.get(`/tags?workspaceId=${workspaceId}`),
    enabled: !!workspaceId,
  });

  const visibleCategories = categories.filter(
    (category) => category.availableFor.length === 0 || category.availableFor.includes(entityType),
  );

  const applyMut = useMutation({
    mutationFn: () =>
      api.post('/tags/bulk-assign', {
        workspaceId,
        entityType,
        entityIds,
        tagIds: selectedTagIds,
      }),
    onSuccess: async () => {
      toast.success(`Updated tags for ${entityIds.length} ${entityType}${entityIds.length === 1 ? '' : 's'}`);
      await queryClient.invalidateQueries({ queryKey: ['workspace-tags', workspaceId] });
      onApplied();
      onClose();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Failed to update tags'),
  });

  function toggleTag(tagId: string) {
    setSelectedTagIds((prev) => (prev.includes(tagId) ? prev.filter((id) => id !== tagId) : [...prev, tagId]));
  }

  return (
    <Modal onClose={onClose} size="md">
      <ModalHeader
        title="Apply Tags"
        subtitle={`This replaces all current tags on ${entityIds.length} selected ${entityType}${entityIds.length === 1 ? '' : 's'}.`}
        icon={<div className="w-10 h-10 rounded-full bg-[var(--accent)]/15 flex items-center justify-center"><Tag className="w-5 h-5 text-[var(--accent)]" /></div>}
        onClose={onClose}
      />

      <ModalBody className="space-y-4">
        {isLoading ? (
          <div className="py-10 text-center text-sm text-[var(--text-muted)]">Loading tags…</div>
        ) : visibleCategories.length === 0 ? (
          <div className="py-10 text-center text-sm text-[var(--text-muted)]">No tag categories are available for this entity type.</div>
        ) : (
          visibleCategories.map((category) => (
            <div key={category.id} className="space-y-2">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] flex items-center gap-1.5">
                <span className="inline-block w-2 h-2 rounded-full" style={{ background: category.color }} />
                {category.name}
              </p>
              <div className="flex flex-wrap gap-2">
                {category.tags.map((tag) => {
                  const selected = selectedTagIds.includes(tag.id);
                  const tone = tag.color ?? category.color;
                  return (
                    <button
                      key={tag.id}
                      onClick={() => toggleTag(tag.id)}
                      className={[
                        'inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors',
                        selected
                          ? 'text-white border-transparent'
                          : 'text-[var(--text-muted)] border-[var(--border)] hover:text-[var(--text)] hover:border-[var(--accent)]',
                      ].join(' ')}
                      style={selected ? { background: tone } : undefined}
                    >
                      {tag.name}
                    </button>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </ModalBody>

      <ModalFooter className="modal-footer-plain">
        <ModalSecondaryButton onClick={onClose}>Cancel</ModalSecondaryButton>
        <ModalPrimaryButton onClick={() => applyMut.mutate()} disabled={applyMut.isPending || isLoading}>
          {applyMut.isPending ? 'Applying…' : 'Apply Tags'}
        </ModalPrimaryButton>
      </ModalFooter>
    </Modal>
  );
}