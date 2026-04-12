import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { LayoutGrid, LayoutList, Star } from 'lucide-react';
import { api } from '../lib/api.js';
import {
  Modal, ModalBody, ModalFooter, ModalHeader,
} from './UiPrimitives.js';

interface Workspace { id: string; name: string; slug: string }

interface Props {
  workspaceId: string;
  onClose: () => void;
  onCreated: (itemId: string) => void;
}

const LAYOUTS: { id: string; label: string; icon: React.ReactNode; desc: string }[] = [
  { id: '1-col',    label: '1 Column',  icon: <LayoutList size={18} />,  desc: 'Single column list' },
  { id: '2-col',    label: '2 Columns', icon: <LayoutGrid size={18} />,  desc: 'Side-by-side categories' },
  { id: 'featured', label: 'Featured',  icon: <Star size={18} />,        desc: 'Hero item + grid' },
];

export default function CreateMenuBoardModal({ workspaceId, onClose, onCreated }: Props) {
  const qc = useQueryClient();

  const [name, setName]                       = useState('');
  const [posWorkspaceId, setPosWorkspaceId]   = useState(workspaceId);
  const [layout, setLayout]                   = useState('2-col');
  const [showPrices, setShowPrices]           = useState(true);
  const [showImages, setShowImages]           = useState(true);
  const [showDescription, setShowDescription] = useState(false);
  const [duration, setDuration]               = useState(30);

  const { data: workspaces = [] } = useQuery<Workspace[]>({
    queryKey: ['workspaces'],
    queryFn:  () => api.get('/workspaces'),
  });

  const createMut = useMutation({
    mutationFn: (body: object) => api.post('/content/menu-board', body),
    onSuccess: (item: { id: string }) => {
      void qc.invalidateQueries({ queryKey: ['content', workspaceId] });
      toast.success('Menu board created');
      onCreated(item.id);
    },
    onError: () => toast.error('Failed to create menu board'),
  });

  function handleCreate() {
    if (!name.trim())       { toast.error('Name is required'); return; }
    if (!posWorkspaceId)    { toast.error('POS workspace is required'); return; }
    createMut.mutate({
      workspaceId,
      name: name.trim(),
      posWorkspaceId,
      layout,
      showPrices,
      showImages,
      showDescription,
      duration,
    });
  }

  return (
    <Modal onClose={onClose}>
      <ModalHeader title="Create Menu Board" onClose={onClose} />
      <ModalBody className="flex flex-col gap-5">

        {/* Name */}
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-[var(--text-muted)]">Name *</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Lunch Menu Board"
            className="input"
          />
        </label>

        {/* POS workspace */}
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-[var(--text-muted)]">POS Workspace (menu source)</span>
          <select
            value={posWorkspaceId}
            onChange={(e) => setPosWorkspaceId(e.target.value)}
            className="input"
          >
            {workspaces.map((ws) => (
              <option key={ws.id} value={ws.id}>{ws.name}</option>
            ))}
          </select>
          <p className="text-[11px] text-[var(--text-muted)]">The live POS menu from this workspace will be displayed.</p>
        </label>

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
                <span className="text-[10px] text-center leading-tight opacity-70">{l.desc}</span>
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
          <p className="text-[11px] text-[var(--text-muted)]">How long this item plays in a playlist before advancing.</p>
        </label>

      </ModalBody>
      <ModalFooter>
        <button onClick={onClose} className="ui-btn-secondary">Cancel</button>
        <button onClick={handleCreate} disabled={createMut.isPending} className="ui-btn-primary">
          Create Menu Board
        </button>
      </ModalFooter>
    </Modal>
  );
}
