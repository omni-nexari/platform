import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { api } from '../../lib/api.js';
import { ShoppingCart, Plus, Pencil, Trash2, ChevronRight, GripVertical } from 'lucide-react';
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

interface PosMenu {
  id: string;
  name: string;
  isActive: boolean;
}
interface PosCategory {
  id: string;
  menuId: string;
  name: string;
  sortOrder: number;
}
interface PosItem {
  id: string;
  categoryId: string;
  name: string;
  description: string | null;
  priceCents: number;
  isAvailable: boolean;
  imageUrl: string | null;
}

function formatPrice(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

export default function PosMenuPage() {
  const { wsId } = useParams<{ wsId: string }>();
  const queryClient = useQueryClient();
  const [selectedMenuId, setSelectedMenuId] = useState<string | null>(null);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [newMenuOpen, setNewMenuOpen] = useState(false);
  const [newMenuName, setNewMenuName] = useState('');
  const [newCategoryOpen, setNewCategoryOpen] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newItemOpen, setNewItemOpen] = useState(false);
  const [newItemName, setNewItemName] = useState('');
  const [newItemPrice, setNewItemPrice] = useState('');
  const [newItemDesc, setNewItemDesc] = useState('');

  const { data: menus = [], isLoading: menusLoading } = useQuery<PosMenu[]>({
    queryKey: ['pos-menus', wsId],
    queryFn: () => api.get(`/pos/mgmt/menus?workspaceId=${wsId}`),
  });

  const { data: categories = [] } = useQuery<PosCategory[]>({
    queryKey: ['pos-categories', selectedMenuId],
    queryFn: () => api.get(`/pos/mgmt/categories?menuId=${selectedMenuId}`),
    enabled: !!selectedMenuId,
  });

  const { data: items = [] } = useQuery<PosItem[]>({
    queryKey: ['pos-items', selectedCategoryId],
    queryFn: () => api.get(`/pos/mgmt/items?categoryId=${selectedCategoryId}`),
    enabled: !!selectedCategoryId,
  });

  const createMenuMut = useMutation({
    mutationFn: () => api.post<PosMenu>('/pos/mgmt/menus', { workspaceId: wsId, name: newMenuName }),
    onSuccess: (m: PosMenu) => {
      toast.success('Menu created');
      setNewMenuOpen(false);
      setNewMenuName('');
      void queryClient.invalidateQueries({ queryKey: ['pos-menus', wsId] });
      setSelectedMenuId(m.id);
    },
    onError: () => toast.error('Failed to create menu'),
  });

  const createCategoryMut = useMutation({
    mutationFn: () => api.post<PosCategory>('/pos/mgmt/categories', { menuId: selectedMenuId, name: newCategoryName }),
    onSuccess: (c: PosCategory) => {
      toast.success('Category created');
      setNewCategoryOpen(false);
      setNewCategoryName('');
      void queryClient.invalidateQueries({ queryKey: ['pos-categories', selectedMenuId] });
      setSelectedCategoryId(c.id);
    },
    onError: () => toast.error('Failed to create category'),
  });

  const createItemMut = useMutation({
    mutationFn: () =>
      api.post('/pos/mgmt/items', {
        categoryId: selectedCategoryId,
        name: newItemName,
        description: newItemDesc || null,
        priceCents: Math.round(parseFloat(newItemPrice) * 100),
      }),
    onSuccess: () => {
      toast.success('Item created');
      setNewItemOpen(false);
      setNewItemName('');
      setNewItemPrice('');
      setNewItemDesc('');
      void queryClient.invalidateQueries({ queryKey: ['pos-items', selectedCategoryId] });
    },
    onError: () => toast.error('Failed to create item'),
  });

  const toggleItemMut = useMutation({
    mutationFn: ({ id, isAvailable }: { id: string; isAvailable: boolean }) =>
      api.patch(`/pos/mgmt/items/${id}`, { isAvailable }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['pos-items', selectedCategoryId] }),
  });

  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6 max-w-screen-xl mx-auto">
      <PageHeader
        title="Menu Builder"
        description="Manage menus, categories, and items"
        actions={
          <button className="ui-btn-primary flex items-center gap-1.5" onClick={() => setNewMenuOpen(true)}>
            <Plus className="w-4 h-4" />
            New Menu
          </button>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Menus column */}
        <div className="ui-card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-[var(--text)]">Menus</h3>
            <button className="text-[var(--blue)] text-xs hover:underline" onClick={() => setNewMenuOpen(true)}>
              + Add
            </button>
          </div>
          {menusLoading ? (
            <Skeleton className="h-9 rounded-lg" />
          ) : menus.length === 0 ? (
            <p className="text-xs text-[var(--text-muted)]">No menus yet.</p>
          ) : (
            menus.map((m) => (
              <button
                key={m.id}
                onClick={() => { setSelectedMenuId(m.id); setSelectedCategoryId(null); }}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors ${
                  selectedMenuId === m.id
                    ? 'bg-[var(--blue)] text-white'
                    : 'bg-[var(--surface)] text-[var(--text)] hover:bg-[var(--surface)]/80'
                }`}
              >
                <span className="truncate">{m.name}</span>
                {m.isActive ? (
                  <Badge tone="success">Active</Badge>
                ) : (
                  <Badge tone="neutral">Draft</Badge>
                )}
              </button>
            ))
          )}
        </div>

        {/* Categories column */}
        <div className="ui-card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-[var(--text)]">Categories</h3>
            {selectedMenuId && (
              <button className="text-[var(--blue)] text-xs hover:underline" onClick={() => setNewCategoryOpen(true)}>
                + Add
              </button>
            )}
          </div>
          {!selectedMenuId ? (
            <p className="text-xs text-[var(--text-muted)]">Select a menu first.</p>
          ) : categories.length === 0 ? (
            <p className="text-xs text-[var(--text-muted)]">No categories yet.</p>
          ) : (
            categories.map((c) => (
              <button
                key={c.id}
                onClick={() => setSelectedCategoryId(c.id)}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors ${
                  selectedCategoryId === c.id
                    ? 'bg-[var(--blue)] text-white'
                    : 'bg-[var(--surface)] text-[var(--text)] hover:bg-[var(--surface)]/80'
                }`}
              >
                {c.name}
                <ChevronRight className="w-3.5 h-3.5 opacity-50" />
              </button>
            ))
          )}
        </div>

        {/* Items column */}
        <div className="ui-card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-[var(--text)]">Items</h3>
            {selectedCategoryId && (
              <button className="text-[var(--blue)] text-xs hover:underline" onClick={() => setNewItemOpen(true)}>
                + Add
              </button>
            )}
          </div>
          {!selectedCategoryId ? (
            <p className="text-xs text-[var(--text-muted)]">Select a category first.</p>
          ) : items.length === 0 ? (
            <p className="text-xs text-[var(--text-muted)]">No items yet.</p>
          ) : (
            items.map((item) => (
              <div
                key={item.id}
                className="flex items-center gap-3 px-3 py-2 rounded-lg bg-[var(--surface)]"
              >
                <GripVertical className="w-3.5 h-3.5 text-[var(--text-muted)] shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[var(--text)] truncate">{item.name}</p>
                  <p className="text-xs text-[var(--text-muted)]">{formatPrice(item.priceCents)}</p>
                </div>
                <button
                  onClick={() => toggleItemMut.mutate({ id: item.id, isAvailable: !item.isAvailable })}
                  className={`text-xs px-2 py-0.5 rounded-full transition-colors ${
                    item.isAvailable
                      ? 'bg-[var(--success)]/15 text-[var(--success)]'
                      : 'bg-[var(--surface)] text-[var(--text-muted)]'
                  }`}
                >
                  {item.isAvailable ? 'On' : 'Off'}
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {/* New Menu modal */}
      <Modal open={newMenuOpen} onClose={() => setNewMenuOpen(false)}>
        <ModalHeader>New Menu</ModalHeader>
        <ModalBody>
          <label className="ui-label">Name</label>
          <input
            className="ui-input w-full"
            value={newMenuName}
            onChange={(e) => setNewMenuName(e.target.value)}
            placeholder="e.g. Lunch Menu"
            autoFocus
          />
        </ModalBody>
        <ModalFooter>
          <ModalSecondaryButton onClick={() => setNewMenuOpen(false)}>Cancel</ModalSecondaryButton>
          <ModalPrimaryButton
            onClick={() => createMenuMut.mutate()}
            disabled={!newMenuName.trim() || createMenuMut.isPending}
          >
            Create
          </ModalPrimaryButton>
        </ModalFooter>
      </Modal>

      {/* New Category modal */}
      <Modal open={newCategoryOpen} onClose={() => setNewCategoryOpen(false)}>
        <ModalHeader>New Category</ModalHeader>
        <ModalBody>
          <label className="ui-label">Name</label>
          <input
            className="ui-input w-full"
            value={newCategoryName}
            onChange={(e) => setNewCategoryName(e.target.value)}
            placeholder="e.g. Starters"
            autoFocus
          />
        </ModalBody>
        <ModalFooter>
          <ModalSecondaryButton onClick={() => setNewCategoryOpen(false)}>Cancel</ModalSecondaryButton>
          <ModalPrimaryButton
            onClick={() => createCategoryMut.mutate()}
            disabled={!newCategoryName.trim() || createCategoryMut.isPending}
          >
            Create
          </ModalPrimaryButton>
        </ModalFooter>
      </Modal>

      {/* New Item modal */}
      <Modal open={newItemOpen} onClose={() => setNewItemOpen(false)}>
        <ModalHeader>New Item</ModalHeader>
        <ModalBody>
          <div className="space-y-3">
            <div>
              <label className="ui-label">Name</label>
              <input
                className="ui-input w-full"
                value={newItemName}
                onChange={(e) => setNewItemName(e.target.value)}
                placeholder="e.g. Caesar Salad"
                autoFocus
              />
            </div>
            <div>
              <label className="ui-label">Price ($)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                className="ui-input w-full"
                value={newItemPrice}
                onChange={(e) => setNewItemPrice(e.target.value)}
                placeholder="0.00"
              />
            </div>
            <div>
              <label className="ui-label">Description (optional)</label>
              <textarea
                className="ui-input w-full resize-none"
                rows={2}
                value={newItemDesc}
                onChange={(e) => setNewItemDesc(e.target.value)}
              />
            </div>
          </div>
        </ModalBody>
        <ModalFooter>
          <ModalSecondaryButton onClick={() => setNewItemOpen(false)}>Cancel</ModalSecondaryButton>
          <ModalPrimaryButton
            onClick={() => createItemMut.mutate()}
            disabled={!newItemName.trim() || !newItemPrice || createItemMut.isPending}
          >
            Create
          </ModalPrimaryButton>
        </ModalFooter>
      </Modal>
    </div>
  );
}
