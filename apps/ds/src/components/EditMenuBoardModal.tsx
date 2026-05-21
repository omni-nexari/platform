import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '../lib/api.js';
import { Modal, ModalHeader } from './UiPrimitives.js';
import MenuBoardWizard, { type MenuBoardWizardState } from './menu-board/MenuBoardWizard.js';
import { configToApiBody, parseMenuBoardMetadata } from './menu-board/menuBoardConfig.js';

interface Props {
  itemId: string;
  itemName: string;
  workspaceId: string;
  /** Raw metadata object from the API (already JSON-parsed by the caller). */
  initialConfig: Record<string, unknown> | null | undefined;
  initialDuration: number;
  onClose: () => void;
}

export default function EditMenuBoardModal({ itemId, itemName, workspaceId, initialConfig, initialDuration, onClose }: Props) {
  const qc = useQueryClient();

  // The caller passes a raw object; round-trip through JSON so parseMenuBoardMetadata can
  // reuse the same defaults logic that the create-flow uses.
  const config = parseMenuBoardMetadata(initialConfig ? JSON.stringify(initialConfig) : '{}');

  const saveMut = useMutation({
    mutationFn: (body: object) => api.patch(`/content/${itemId}/menu-board`, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['content-item', itemId] });
      void qc.invalidateQueries({ queryKey: ['content', workspaceId] });
      toast.success('Menu board updated');
      onClose();
    },
    onError: () => toast.error('Failed to save changes'),
  });

  function handleSubmit(state: MenuBoardWizardState) {
    saveMut.mutate({
      name: state.name || itemName,
      duration: state.duration,
      ...configToApiBody(state.config),
    });
  }

  return (
    <Modal onClose={onClose} size="lg" className="!max-w-5xl !w-[1100px]">
      <ModalHeader title={`Edit — ${itemName}`} onClose={onClose} />
      <div className="flex-1 min-h-0 flex flex-col" style={{ minHeight: 560 }}>
        <MenuBoardWizard
          defaultPosWorkspaceId={config.posWorkspaceId || workspaceId}
          showBasicsStep={false}
          initial={{ name: itemName, duration: initialDuration, config }}
          onCancel={onClose}
          onSubmit={handleSubmit}
          isSubmitting={saveMut.isPending}
          submitLabel="Save Changes"
          title={`Edit — ${itemName}`}
        />
      </div>
    </Modal>
  );
}
