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
    mutationFn: (body: object) => api.post<{ id: string }>('/content/menu-board', body),
    onSuccess: (item) => {
      void qc.invalidateQueries({ queryKey: ['content', workspaceId] });
      toast.success('Menu board created');
      onCreated(item.id);
    },
    onError: () => toast.error('Failed to create menu board'),
  });

  function handleSubmit(state: MenuBoardWizardState) {
    if (!state.name.trim())            { toast.error('Name is required'); return; }
    if (!state.config.posWorkspaceId)  { toast.error('POS workspace is required'); return; }
    createMut.mutate({
      workspaceId,
      name: state.name,
      duration: state.duration,
      ...configToApiBody(state.config),
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
