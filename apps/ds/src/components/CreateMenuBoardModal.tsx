import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '../lib/api.js';
import { Modal, ModalHeader } from './UiPrimitives.js';
import MenuBoardWizard, { type MenuBoardWizardState } from './menu-board/MenuBoardWizard.js';
import { configToApiBody } from './menu-board/menuBoardConfig.js';

interface Props {
  workspaceId: string;
  onClose: () => void;
  onCreated: (itemId: string) => void;
}

export default function CreateMenuBoardModal({ workspaceId, onClose, onCreated }: Props) {
  const qc = useQueryClient();

  const createMut = useMutation({
    mutationFn: (body: object) => api.post<{ id: string; siblingIds?: string[] }>('/content/menu-board', body),
    onSuccess: (item) => {
      void qc.invalidateQueries({ queryKey: ['content', workspaceId] });
      const extra = item.siblingIds?.length ? ` (+ ${item.siblingIds.length} sibling screen${item.siblingIds.length > 1 ? 's' : ''})` : '';
      toast.success(`Menu board created${extra}`);
      onCreated(item.id);
    },
    onError: () => toast.error('Failed to create menu board'),
  });

  async function handleSubmit(state: MenuBoardWizardState) {
    if (!state.name.trim())            { toast.error('Name is required'); return; }
    if (!state.config.posWorkspaceId)  { toast.error('POS workspace is required'); return; }

    let bgUrl: string | null = state.config.backgroundImage ?? null;

    // Upload pending background file → replace data URL with a real URL
    if (state.pendingBgFile) {
      try {
        const form = new FormData();
        form.append('file', state.pendingBgFile);
        const uploaded = await api.postForm<{ id: string; webUrl: string | null; filePath: string | null }>(
          `/content/upload?workspaceId=${workspaceId}`, form,
        );
        bgUrl = uploaded.webUrl ?? uploaded.filePath ?? bgUrl;
      } catch {
        toast.error('Background image upload failed; board will be created without it.');
        bgUrl = null;
      }
    }

    createMut.mutate({
      workspaceId,
      name: state.name,
      duration: state.duration,
      ...configToApiBody({ ...state.config, backgroundImage: bgUrl }),
      siblingCount: state.siblingCount ?? 0,
    });
  }

  return (
    <Modal onClose={onClose} size="lg" className="!max-w-5xl !w-[1100px]">
      <ModalHeader title="Create Menu Board" onClose={onClose} />
      <div className="flex-1 min-h-0 flex flex-col" style={{ minHeight: 560 }}>
        <MenuBoardWizard
          defaultPosWorkspaceId={workspaceId}
          showBasicsStep
          onCancel={onClose}
          onSubmit={handleSubmit}
          isSubmitting={createMut.isPending}
          submitLabel="Create Menu Board"
          title="Create Menu Board"
        />
      </div>
    </Modal>
  );
}
