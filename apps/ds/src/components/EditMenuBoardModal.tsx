import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { LayoutGrid, LayoutList, Star } from 'lucide-react';
import { api } from '../lib/api.js';
import { Modal, ModalBody, ModalFooter, ModalHeader } from './UiPrimitives.js';

interface MenuBoardConfig {
  posWorkspaceId: string;
  layout: string;
  showPrices: boolean;
  showImages: boolean;
  showDescription: boolean;
  fontScale: number;
  accentColor: string | null;
}

interface Props {
  itemId: string;
  itemName: string;
  workspaceId: string;
  initialConfig: MenuBoardConfig;
  initialDuration: number;
  onClose: () => void;
}

const LAYOUTS = [
  { id: '1-col',    label: '1 Column',  icon: <LayoutList size={16} /> },
  { id: '2-col',    label: '2 Columns', icon: <LayoutGrid size={16} /> },
  { id: 'featured', label: 'Featured',  icon: <Star size={16} /> },
];

export default function EditMenuBoardModal({ itemId, itemName, workspaceId, initialConfig, initialDuration, onClose }: Props) {
  const qc = useQueryClient();

  const [layout, setLayout]                   = useState(initialConfig.layout ?? '2-col');
  const [showPrices, setShowPrices]           = useState(initialConfig.showPrices ?? true);
  const [showImages, setShowImages]           = useState(initialConfig.showImages ?? true);
  const [showDescription, setShowDescription] = useState(initialConfig.showDescription ?? false);
  const [duration, setDuration]               = useState(initialDuration);

  useEffect(() => {
    setLayout(initialConfig.layout ?? '2-col');
    setShowPrices(initialConfig.showPrices ?? true);
    setShowImages(initialConfig.showImages ?? true);
    setShowDescription(initialConfig.showDescription ?? false);
  }, [initialConfig]);

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

  function handleSave() {
    saveMut.mutate({ layout, showPrices, showImages, showDescription, duration });
  }

  return (
    <Modal onClose={onClose}>
      <ModalHeader title={`Edit — ${itemName}`} onClose={onClose} />
      <ModalBody className="flex flex-col gap-5">

        {/* Layout */}
        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium text-[var(--text-muted)]">Layout</span>
          <div className="grid grid-cols-3 gap-2">
            {LAYOUTS.map((l) => (
              <button
                key={l.id}
                type="button"
                onClick={() => setLayout(l.id)}
                className={`flex flex-col items-center gap-1.5 rounded-lg border p-3 text-xs transition-colors ${
                  layout === l.id
                    ? 'border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]'
                    : 'border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--text-muted)]'
                }`}
              >
                {l.icon}
                <span className="font-medium">{l.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Display options */}
        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium text-[var(--text-muted)]">Display Options</span>
          <div className="rounded-lg border border-[var(--border)] divide-y divide-[var(--border)]">
            {[
              { label: 'Show prices',      value: showPrices,      set: setShowPrices },
              { label: 'Show item images', value: showImages,      set: setShowImages },
              { label: 'Show description', value: showDescription, set: setShowDescription },
            ].map(({ label, value, set }) => (
              <label key={label} className="flex items-center justify-between px-3 py-2.5 cursor-pointer hover:bg-[var(--surface-raised)] transition-colors">
                <span className="text-sm text-[var(--text)]">{label}</span>
                <input
                  type="checkbox"
                  checked={value}
                  onChange={(e) => set(e.target.checked)}
                  className="accent-[var(--accent)]"
                />
              </label>
            ))}
          </div>
        </div>

        {/* Duration */}
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-[var(--text-muted)]">Duration (seconds)</span>
          <input
            type="number"
            min={5}
            max={3600}
            value={duration}
            onChange={(e) => setDuration(Math.max(5, parseInt(e.target.value) || 30))}
            className="input"
          />
        </label>

      </ModalBody>
      <ModalFooter>
        <button onClick={onClose} className="ui-btn-secondary">Cancel</button>
        <button onClick={handleSave} disabled={saveMut.isPending} className="ui-btn-primary">Save</button>
      </ModalFooter>
    </Modal>
  );
}
