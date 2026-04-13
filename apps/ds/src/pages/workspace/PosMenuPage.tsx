import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router';
import { useState, useRef, useCallback } from 'react';
import { toast } from 'sonner';
import { api, buildApiUrl } from '../../lib/api.js';
import {
  Plus, Pencil, Trash2, ChevronRight, X, Check,
  ImagePlus, Eye, EyeOff,
  Camera, Utensils, ChefHat,
} from 'lucide-react';
import {
  Badge,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  ModalPrimaryButton,
  ModalSecondaryButton,
  PageHeader,
  Skeleton,
} from '../../components/UiPrimitives.js';

// ─── Types ──────────────────────────────────────────────────────────────────────
interface PosMenu {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  currency: string;
}
interface PosCategory {
  id: string;
  menuId: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  color: string | null;
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
  tags: string[];
  sortOrder: number;
}

const PRESET_TAGS = ['Popular', 'Spicy', 'Vegan', 'Vegetarian', 'Gluten-Free', 'New', 'Chef\'s Pick', 'Halal', 'Dairy-Free', 'Nut-Free'];
const CATEGORY_COLORS = [
  { label: 'Red', value: '#ef4444' },
  { label: 'Orange', value: '#f97316' },
  { label: 'Amber', value: '#f59e0b' },
  { label: 'Green', value: '#22c55e' },
  { label: 'Teal', value: '#14b8a6' },
  { label: 'Blue', value: '#3b82f6' },
  { label: 'Purple', value: '#8b5cf6' },
  { label: 'Pink', value: '#ec4899' },
];

function formatPrice(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

function resolveImageUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith('http')) return url;
  // Relative POS image path → goes through API proxy
  return buildApiUrl(url);
}

// ─── Image Upload Button ────────────────────────────────────────────────────────
function ImageUploadArea({
  imageUrl,
  onUpload,
  onRemove,
  size = 'md',
  uploading,
}: {
  imageUrl: string | null;
  onUpload: (file: File) => void;
  onRemove: () => void;
  size?: 'sm' | 'md' | 'lg';
  uploading?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const dims = size === 'sm' ? 'w-16 h-16' : size === 'lg' ? 'w-full h-40' : 'w-24 h-24';
  const resolved = resolveImageUrl(imageUrl);

  return (
    <div className={`relative ${dims} rounded-xl overflow-hidden border-2 border-dashed border-[var(--border)] bg-[var(--surface)] group flex-shrink-0`}>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onUpload(f);
          e.target.value = '';
        }}
      />
      {resolved ? (
        <>
          <img src={resolved} alt="" className="w-full h-full object-cover" />
          <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
            <button onClick={() => inputRef.current?.click()} className="p-1.5 rounded-full bg-white/20 hover:bg-white/30 text-white">
              <Camera className="w-4 h-4" />
            </button>
            <button onClick={onRemove} className="p-1.5 rounded-full bg-white/20 hover:bg-red-500/70 text-white">
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </>
      ) : (
        <button
          onClick={() => inputRef.current?.click()}
          className="w-full h-full flex flex-col items-center justify-center text-[var(--text-muted)] hover:text-[var(--blue)] transition-colors"
          disabled={uploading}
        >
          {uploading ? (
            <div className="w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin" />
          ) : (
            <>
              <ImagePlus className="w-5 h-5" />
              <span className="text-xs mt-1">Photo</span>
            </>
          )}
        </button>
      )}
    </div>
  );
}

// ─── Tag Picker ─────────────────────────────────────────────────────────────────
function TagPicker({ tags, onChange }: { tags: string[]; onChange: (tags: string[]) => void }) {
  const [custom, setCustom] = useState('');
  const toggle = (t: string) => onChange(tags.includes(t) ? tags.filter((x) => x !== t) : [...tags, t]);
  const addCustom = () => {
    const val = custom.trim();
    if (val && !tags.includes(val)) {
      onChange([...tags, val]);
      setCustom('');
    }
  };
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {PRESET_TAGS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => toggle(t)}
            className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
              tags.includes(t)
                ? 'bg-[var(--blue)] text-white border-[var(--blue)]'
                : 'border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--blue)] hover:text-[var(--blue)]'
            }`}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="flex gap-1.5">
        <input
          className="ui-input flex-1 text-xs"
          placeholder="Custom tag..."
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addCustom())}
        />
        <button type="button" className="ui-btn-secondary text-xs px-2" onClick={addCustom} disabled={!custom.trim()}>
          Add
        </button>
      </div>
    </div>
  );
}

// ─── Confirm Delete Dialog ──────────────────────────────────────────────────────
function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  pending,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  pending?: boolean;
}) {
  if (!open) return null;
  return (
    <Modal open onClose={onClose}>
      <ModalHeader>{title}</ModalHeader>
      <ModalBody>
        <p className="text-sm text-[var(--text-muted)]">{message}</p>
      </ModalBody>
      <ModalFooter>
        <ModalSecondaryButton onClick={onClose}>Cancel</ModalSecondaryButton>
        <button
          onClick={onConfirm}
          disabled={pending}
          className="px-4 py-2 rounded-lg text-sm font-medium bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
        >
          Delete
        </button>
      </ModalFooter>
    </Modal>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Main Page
// ═══════════════════════════════════════════════════════════════════════════════

export default function PosMenuPage() {
  const { wsId } = useParams<{ wsId: string }>();
  const qc = useQueryClient();

  // Selection state
  const [selectedMenuId, setSelectedMenuId] = useState<string | null>(null);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);

  // Inline create state
  const [creatingMenu, setCreatingMenu] = useState(false);
  const [newMenuName, setNewMenuName] = useState('');
  const [editMenuOpen, setEditMenuOpen] = useState<PosMenu | null>(null);
  const [deleteMenu, setDeleteMenu] = useState<PosMenu | null>(null);

  const [creatingCategory, setCreatingCategory] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [newCatColor, setNewCatColor] = useState<string | null>(null);
  const [editCategory, setEditCategory] = useState<PosCategory | null>(null);
  const [deleteCategory, setDeleteCategory] = useState<PosCategory | null>(null);

  const [newItemOpen, setNewItemOpen] = useState(false);
  const [editItem, setEditItem] = useState<PosItem | null>(null);
  const [deleteItem, setDeleteItem] = useState<PosItem | null>(null);

  // Upload state
  const [uploading, setUploading] = useState<string | null>(null); // id of entity being uploaded

  // ─── Queries ────────────────────────────────────────────────────────────────

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

  // ─── Mutations ──────────────────────────────────────────────────────────────

  // -- Menus
  const createMenuMut = useMutation({
    mutationFn: (body: { name: string; description?: string }) =>
      api.post<PosMenu>('/pos/mgmt/menus', { workspaceId: wsId, ...body }),
    onSuccess: (m: PosMenu) => {
      toast.success('Menu created');
      setCreatingMenu(false);
      setNewMenuName('');
      void qc.invalidateQueries({ queryKey: ['pos-menus', wsId] });
      setSelectedMenuId(m.id);
      setSelectedCategoryId(null);
    },
    onError: () => toast.error('Failed to create menu'),
  });

  const updateMenuMut = useMutation({
    mutationFn: ({ id, ...body }: { id: string; name?: string; description?: string | null; isActive?: boolean }) =>
      api.patch<PosMenu>(`/pos/mgmt/menus/${id}`, body),
    onSuccess: () => {
      toast.success('Menu updated');
      void qc.invalidateQueries({ queryKey: ['pos-menus', wsId] });
    },
    onError: () => toast.error('Failed to update menu'),
  });

  const deleteMenuMut = useMutation({
    mutationFn: (id: string) => api.delete(`/pos/mgmt/menus/${id}`),
    onSuccess: () => {
      toast.success('Menu deleted');
      if (deleteMenu && selectedMenuId === deleteMenu.id) {
        setSelectedMenuId(null);
        setSelectedCategoryId(null);
      }
      setDeleteMenu(null);
      void qc.invalidateQueries({ queryKey: ['pos-menus', wsId] });
    },
    onError: () => toast.error('Failed to delete menu'),
  });

  // -- Categories
  const createCategoryMut = useMutation({
    mutationFn: (body: { name: string; description?: string; color?: string }) =>
      api.post<PosCategory>('/pos/mgmt/categories', { menuId: selectedMenuId, ...body }),
    onSuccess: (c: PosCategory) => {
      toast.success('Category created');
      setCreatingCategory(false);
      setNewCatName('');
      setNewCatColor(null);
      void qc.invalidateQueries({ queryKey: ['pos-categories', selectedMenuId] });
      setSelectedCategoryId(c.id);
    },
    onError: () => toast.error('Failed to create category'),
  });

  const updateCategoryMut = useMutation({
    mutationFn: ({ id, ...body }: { id: string; name?: string; description?: string | null; color?: string | null }) =>
      api.patch<PosCategory>(`/pos/mgmt/categories/${id}`, body),
    onSuccess: () => {
      toast.success('Category updated');
      void qc.invalidateQueries({ queryKey: ['pos-categories', selectedMenuId] });
    },
    onError: () => toast.error('Failed to update category'),
  });

  const deleteCategoryMut = useMutation({
    mutationFn: (id: string) => api.delete(`/pos/mgmt/categories/${id}`),
    onSuccess: () => {
      toast.success('Category deleted');
      if (deleteCategory && selectedCategoryId === deleteCategory.id) {
        setSelectedCategoryId(null);
      }
      setDeleteCategory(null);
      void qc.invalidateQueries({ queryKey: ['pos-categories', selectedMenuId] });
    },
    onError: () => toast.error('Failed to delete category'),
  });

  // -- Items
  const createItemMut = useMutation({
    mutationFn: (body: { name: string; priceCents: number; description?: string | null; tags?: string[] }) =>
      api.post<PosItem>('/pos/mgmt/items', { categoryId: selectedCategoryId, ...body }),
    onSuccess: () => {
      toast.success('Item created');
      void qc.invalidateQueries({ queryKey: ['pos-items', selectedCategoryId] });
    },
    onError: () => toast.error('Failed to create item'),
  });

  const updateItemMut = useMutation({
    mutationFn: ({ id, ...body }: { id: string; name?: string; priceCents?: number; description?: string | null; isAvailable?: boolean; imageUrl?: string | null; tags?: string[] }) =>
      api.patch<PosItem>(`/pos/mgmt/items/${id}`, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['pos-items', selectedCategoryId] });
    },
    onError: () => toast.error('Failed to update item'),
  });

  const deleteItemMut = useMutation({
    mutationFn: (id: string) => api.delete(`/pos/mgmt/items/${id}`),
    onSuccess: () => {
      toast.success('Item deleted');
      setDeleteItem(null);
      void qc.invalidateQueries({ queryKey: ['pos-items', selectedCategoryId] });
    },
    onError: () => toast.error('Failed to delete item'),
  });

  // ─── Image upload helper ────────────────────────────────────────────────────

  const uploadImage = useCallback(async (file: File): Promise<string | null> => {
    const form = new FormData();
    form.append('file', file);
    try {
      const res = await api.postForm<{ imageUrl: string }>('/pos/mgmt/upload-image', form);
      return res.imageUrl;
    } catch {
      toast.error('Image upload failed');
      return null;
    }
  }, []);

  const handleItemImageUpload = useCallback(async (itemId: string, file: File) => {
    setUploading(itemId);
    const imageUrl = await uploadImage(file);
    if (imageUrl) {
      updateItemMut.mutate({ id: itemId, imageUrl });
    }
    setUploading(null);
  }, [uploadImage, updateItemMut]);

  const handleItemImageRemove = useCallback((itemId: string) => {
    updateItemMut.mutate({ id: itemId, imageUrl: null });
  }, [updateItemMut]);

  // ─── Render ─────────────────────────────────────────────────────────────────

  const selectedMenu = menus.find((m) => m.id === selectedMenuId);
  const selectedCat = categories.find((c) => c.id === selectedCategoryId);

  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6 max-w-screen-2xl mx-auto">
      <PageHeader
        title="Menu Builder"
        description="Create and manage your restaurant menus, categories, and items"
        actions={
          <button className="ui-btn-primary flex items-center gap-1.5" onClick={() => { setCreatingMenu(true); setNewMenuName(''); }}>
            <Plus className="w-4 h-4" />
            New Menu
          </button>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-[280px_280px_1fr] gap-4">
        {/* ═══ MENUS COLUMN ═══ */}
        <div className="ui-card p-0 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
            <div className="flex items-center gap-2">
              <Utensils className="w-4 h-4 text-[var(--blue)]" />
              <h3 className="text-sm font-semibold text-[var(--text)]">Menus</h3>
            </div>
            <button className="text-[var(--blue)] text-xs hover:underline" onClick={() => { setCreatingMenu(true); setNewMenuName(''); }}>
              + Add
            </button>
          </div>
          <div className="p-2 space-y-1 max-h-[calc(100vh-280px)] overflow-y-auto">
            {/* Inline create form */}
            {creatingMenu && (
              <div className="rounded-xl bg-gradient-to-br from-[var(--blue)]/10 to-[var(--blue)]/5 border border-[var(--blue)]/20 p-3 animate-in slide-in-from-top-2 fade-in duration-200">
                <input
                  className="w-full bg-transparent border-b border-[var(--blue)]/30 focus:border-[var(--blue)] text-sm text-[var(--text)] placeholder:text-[var(--text-muted)] outline-none pb-2 transition-colors"
                  placeholder="Menu name..."
                  value={newMenuName}
                  onChange={(e) => setNewMenuName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && newMenuName.trim()) createMenuMut.mutate({ name: newMenuName.trim() });
                    if (e.key === 'Escape') { setCreatingMenu(false); setNewMenuName(''); }
                  }}
                  autoFocus
                />
                <div className="flex items-center justify-between mt-2">
                  <span className="text-xs text-[var(--text-muted)]">Enter to create · Esc to cancel</span>
                  <div className="flex gap-1">
                    <button
                      onClick={() => { setCreatingMenu(false); setNewMenuName(''); }}
                      className="p-1 rounded-lg text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface)] transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => newMenuName.trim() && createMenuMut.mutate({ name: newMenuName.trim() })}
                      disabled={!newMenuName.trim() || createMenuMut.isPending}
                      className="p-1 rounded-lg text-[var(--blue)] hover:bg-[var(--blue)]/10 disabled:opacity-30 transition-colors"
                    >
                      <Check className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            )}
            {menusLoading ? (
              <>
                <Skeleton className="h-14 rounded-lg" />
                <Skeleton className="h-14 rounded-lg" />
              </>
            ) : menus.length === 0 && !creatingMenu ? (
              <div className="text-center py-8 px-4">
                <ChefHat className="w-10 h-10 mx-auto text-[var(--text-muted)] mb-2" />
                <p className="text-sm text-[var(--text-muted)]">No menus yet</p>
                <button className="text-xs text-[var(--blue)] hover:underline mt-1" onClick={() => { setCreatingMenu(true); setNewMenuName(''); }}>Create your first menu</button>
              </div>
            ) : (
              menus.map((m) => (
                <div
                  key={m.id}
                  className={`group relative rounded-lg transition-all ${
                    selectedMenuId === m.id ? 'bg-[var(--blue)] ring-2 ring-[var(--blue)]/30' : 'hover:bg-[var(--surface)]'
                  }`}
                >
                  <button
                    onClick={() => { setSelectedMenuId(m.id); setSelectedCategoryId(null); }}
                    className="w-full text-left px-3 py-3"
                  >
                    <div className="flex items-center justify-between">
                      <span className={`text-sm font-medium truncate ${selectedMenuId === m.id ? 'text-white' : 'text-[var(--text)]'}`}>
                        {m.name}
                      </span>
                      {m.isActive ? (
                        <Badge tone="success">Active</Badge>
                      ) : (
                        <Badge tone="neutral">Draft</Badge>
                      )}
                    </div>
                    {m.description && (
                      <p className={`text-xs mt-0.5 truncate ${selectedMenuId === m.id ? 'text-white/70' : 'text-[var(--text-muted)]'}`}>
                        {m.description}
                      </p>
                    )}
                  </button>
                  {/* Hover actions */}
                  <div className={`absolute right-1 top-1 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity ${selectedMenuId === m.id ? '[&_button]:text-white/70 [&_button]:hover:text-white' : ''}`}>
                    <button onClick={(e) => { e.stopPropagation(); setEditMenuOpen(m); }} className="p-1 rounded hover:bg-black/10 text-[var(--text-muted)]">
                      <Pencil className="w-3 h-3" />
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); setDeleteMenu(m); }} className="p-1 rounded hover:bg-red-500/10 text-[var(--text-muted)] hover:text-red-500">
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* ═══ CATEGORIES COLUMN ═══ */}
        <div className="ui-card p-0 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
            <h3 className="text-sm font-semibold text-[var(--text)]">Categories</h3>
            {selectedMenuId && (
              <button className="text-[var(--blue)] text-xs hover:underline" onClick={() => { setCreatingCategory(true); setNewCatName(''); setNewCatColor(null); }}>
                + Add
              </button>
            )}
          </div>
          <div className="p-2 space-y-1 max-h-[calc(100vh-280px)] overflow-y-auto">
            {/* Inline create form */}
            {creatingCategory && selectedMenuId && (
              <div className="rounded-xl bg-gradient-to-br from-[var(--blue)]/10 to-[var(--blue)]/5 border border-[var(--blue)]/20 p-3 animate-in slide-in-from-top-2 fade-in duration-200">
                <input
                  className="w-full bg-transparent border-b border-[var(--blue)]/30 focus:border-[var(--blue)] text-sm text-[var(--text)] placeholder:text-[var(--text-muted)] outline-none pb-2 transition-colors"
                  placeholder="Category name..."
                  value={newCatName}
                  onChange={(e) => setNewCatName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && newCatName.trim()) createCategoryMut.mutate({ name: newCatName.trim(), color: newCatColor ?? undefined });
                    if (e.key === 'Escape') { setCreatingCategory(false); setNewCatName(''); setNewCatColor(null); }
                  }}
                  autoFocus
                />
                <div className="flex items-center gap-1.5 mt-2">
                  {CATEGORY_COLORS.map((c) => (
                    <button
                      key={c.value}
                      type="button"
                      onClick={() => setNewCatColor(newCatColor === c.value ? null : c.value)}
                      className={`w-5 h-5 rounded-full border-2 transition-all ${newCatColor === c.value ? 'border-white scale-125' : 'border-transparent scale-100'}`}
                      style={{ backgroundColor: c.value }}
                    />
                  ))}
                </div>
                <div className="flex items-center justify-between mt-2">
                  <span className="text-xs text-[var(--text-muted)]">Enter · Esc</span>
                  <div className="flex gap-1">
                    <button
                      onClick={() => { setCreatingCategory(false); setNewCatName(''); setNewCatColor(null); }}
                      className="p-1 rounded-lg text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface)] transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => newCatName.trim() && createCategoryMut.mutate({ name: newCatName.trim(), color: newCatColor ?? undefined })}
                      disabled={!newCatName.trim() || createCategoryMut.isPending}
                      className="p-1 rounded-lg text-[var(--blue)] hover:bg-[var(--blue)]/10 disabled:opacity-30 transition-colors"
                    >
                      <Check className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            )}
            {!selectedMenuId ? (
              <p className="text-xs text-[var(--text-muted)] text-center py-8">Select a menu first</p>
            ) : categories.length === 0 && !creatingCategory ? (
              <div className="text-center py-8 px-4">
                <p className="text-sm text-[var(--text-muted)]">No categories yet</p>
                <button className="text-xs text-[var(--blue)] hover:underline mt-1" onClick={() => { setCreatingCategory(true); setNewCatName(''); setNewCatColor(null); }}>
                  Create your first category
                </button>
              </div>
            ) : (
              categories.map((c) => (
                <div
                  key={c.id}
                  className={`group relative rounded-lg transition-all ${
                    selectedCategoryId === c.id ? 'bg-[var(--blue)] ring-2 ring-[var(--blue)]/30' : 'hover:bg-[var(--surface)]'
                  }`}
                >
                  <button
                    onClick={() => setSelectedCategoryId(c.id)}
                    className="w-full text-left px-3 py-2.5 flex items-center gap-2"
                  >
                    {c.color && (
                      <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: c.color }} />
                    )}
                    <div className="flex-1 min-w-0">
                      <span className={`text-sm font-medium truncate block ${selectedCategoryId === c.id ? 'text-white' : 'text-[var(--text)]'}`}>
                        {c.name}
                      </span>
                      {c.description && (
                        <p className={`text-xs truncate ${selectedCategoryId === c.id ? 'text-white/70' : 'text-[var(--text-muted)]'}`}>
                          {c.description}
                        </p>
                      )}
                    </div>
                    <ChevronRight className={`w-3.5 h-3.5 flex-shrink-0 ${selectedCategoryId === c.id ? 'text-white/60' : 'text-[var(--text-muted)]'}`} />
                  </button>
                  <div className={`absolute right-6 top-1 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity ${selectedCategoryId === c.id ? '[&_button]:text-white/70 [&_button]:hover:text-white' : ''}`}>
                    <button onClick={(e) => { e.stopPropagation(); setEditCategory(c); }} className="p-1 rounded hover:bg-black/10 text-[var(--text-muted)]">
                      <Pencil className="w-3 h-3" />
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); setDeleteCategory(c); }} className="p-1 rounded hover:bg-red-500/10 text-[var(--text-muted)] hover:text-red-500">
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* ═══ ITEMS COLUMN ═══ */}
        <div className="ui-card p-0 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
            <div>
              <h3 className="text-sm font-semibold text-[var(--text)]">
                {selectedCat ? `${selectedCat.name} — Items` : 'Items'}
              </h3>
              {selectedCat?.description && (
                <p className="text-xs text-[var(--text-muted)]">{selectedCat.description}</p>
              )}
            </div>
            {selectedCategoryId && (
              <button className="ui-btn-primary text-xs flex items-center gap-1 px-3 py-1.5" onClick={() => setNewItemOpen(true)}>
                <Plus className="w-3.5 h-3.5" />
                Add Item
              </button>
            )}
          </div>

          <div className="p-3 max-h-[calc(100vh-280px)] overflow-y-auto">
            {!selectedCategoryId ? (
              <p className="text-xs text-[var(--text-muted)] text-center py-12">Select a category to manage items</p>
            ) : items.length === 0 ? (
              <div className="text-center py-12 px-4">
                <Utensils className="w-10 h-10 mx-auto text-[var(--text-muted)] mb-2" />
                <p className="text-sm text-[var(--text-muted)]">No items in this category</p>
                <button className="text-xs text-[var(--blue)] hover:underline mt-1" onClick={() => setNewItemOpen(true)}>
                  Add your first item
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {items.map((item) => (
                  <div
                    key={item.id}
                    className="group ui-card p-0 overflow-hidden border border-[var(--border)] hover:border-[var(--blue)]/30 transition-all hover:shadow-md"
                  >
                    {/* Item image area */}
                    <div className="relative h-36 bg-[var(--surface)]">
                      {resolveImageUrl(item.imageUrl) ? (
                        <img src={resolveImageUrl(item.imageUrl)!} alt={item.name} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center text-[var(--text-muted)]">
                          <ImagePlus className="w-8 h-8 mb-1" />
                          <span className="text-xs">No photo</span>
                        </div>
                      )}
                      {/* Upload overlay on hover */}
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                        <ImageUploadArea
                          imageUrl={null}
                          onUpload={(f) => handleItemImageUpload(item.id, f)}
                          onRemove={() => {}}
                          size="sm"
                          uploading={uploading === item.id}
                        />
                      </div>
                      {/* Availability badge */}
                      <div className="absolute top-2 right-2">
                        <button
                          onClick={() => updateItemMut.mutate({ id: item.id, isAvailable: !item.isAvailable })}
                          className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium backdrop-blur-sm transition-colors ${
                            item.isAvailable
                              ? 'bg-green-500/90 text-white'
                              : 'bg-red-500/90 text-white'
                          }`}
                        >
                          {item.isAvailable ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                          {item.isAvailable ? 'Available' : 'Hidden'}
                        </button>
                      </div>
                    </div>

                    {/* Item details */}
                    <div className="p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <h4 className="text-sm font-semibold text-[var(--text)] truncate">{item.name}</h4>
                          {item.description && (
                            <p className="text-xs text-[var(--text-muted)] mt-0.5 line-clamp-2">{item.description}</p>
                          )}
                        </div>
                        <span className="text-sm font-semibold text-[var(--blue)] whitespace-nowrap">
                          {formatPrice(item.priceCents)}
                        </span>
                      </div>

                      {/* Tags */}
                      {item.tags && item.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {item.tags.map((tag) => (
                            <span key={tag} className="text-xs px-1.5 py-0.5 rounded-full bg-[var(--blue)]/10 text-[var(--blue)]">
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* Action buttons */}
                      <div className="flex items-center gap-1 mt-3 pt-2 border-t border-[var(--border)]">
                        <button
                          onClick={() => setEditItem(item)}
                          className="flex-1 flex items-center justify-center gap-1 text-xs text-[var(--text-muted)] hover:text-[var(--blue)] py-1 rounded transition-colors"
                        >
                          <Pencil className="w-3 h-3" />
                          Edit
                        </button>
                        <div className="w-px h-4 bg-[var(--border)]" />
                        <button
                          onClick={() => setDeleteItem(item)}
                          className="flex-1 flex items-center justify-center gap-1 text-xs text-[var(--text-muted)] hover:text-red-500 py-1 rounded transition-colors"
                        >
                          <Trash2 className="w-3 h-3" />
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                ))}

                {/* Add item card */}
                <button
                  onClick={() => setNewItemOpen(true)}
                  className="h-full min-h-[200px] rounded-xl border-2 border-dashed border-[var(--border)] hover:border-[var(--blue)] flex flex-col items-center justify-center text-[var(--text-muted)] hover:text-[var(--blue)] transition-colors"
                >
                  <Plus className="w-8 h-8 mb-1" />
                  <span className="text-sm font-medium">Add Item</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ═══ MODALS ═══ */}

      {/* New Menu — handled inline above */}

      {/* Edit Menu */}
      {editMenuOpen && (
        <EditMenuModal
          menu={editMenuOpen}
          onClose={() => setEditMenuOpen(null)}
          onSubmit={(data) => { updateMenuMut.mutate({ id: editMenuOpen.id, ...data }); setEditMenuOpen(null); }}
          pending={updateMenuMut.isPending}
        />
      )}

      {/* Delete Menu */}
      <ConfirmDialog
        open={!!deleteMenu}
        onClose={() => setDeleteMenu(null)}
        onConfirm={() => deleteMenu && deleteMenuMut.mutate(deleteMenu.id)}
        title="Delete Menu"
        message={`Are you sure you want to delete "${deleteMenu?.name}"? All categories and items in this menu will also be removed.`}
        pending={deleteMenuMut.isPending}
      />

      {/* New Category — handled inline above */}

      {/* Edit Category */}
      {editCategory && (
        <EditCategoryModal
          category={editCategory}
          onClose={() => setEditCategory(null)}
          onSubmit={(data) => { updateCategoryMut.mutate({ id: editCategory.id, ...data }); setEditCategory(null); }}
          pending={updateCategoryMut.isPending}
        />
      )}

      {/* Delete Category */}
      <ConfirmDialog
        open={!!deleteCategory}
        onClose={() => setDeleteCategory(null)}
        onConfirm={() => deleteCategory && deleteCategoryMut.mutate(deleteCategory.id)}
        title="Delete Category"
        message={`Delete "${deleteCategory?.name}"? All items in this category will also be removed.`}
        pending={deleteCategoryMut.isPending}
      />

      {/* New Item */}
      <NewItemModal
        open={newItemOpen}
        onClose={() => setNewItemOpen(false)}
        onSubmit={(data) => { createItemMut.mutate(data); setNewItemOpen(false); }}
        onUploadImage={uploadImage}
        pending={createItemMut.isPending}
      />

      {/* Edit Item */}
      {editItem && (
        <EditItemModal
          item={editItem}
          onClose={() => setEditItem(null)}
          onSubmit={(data) => { updateItemMut.mutate({ id: editItem.id, ...data }); setEditItem(null); }}
          onUploadImage={uploadImage}
          pending={updateItemMut.isPending}
        />
      )}

      {/* Delete Item */}
      <ConfirmDialog
        open={!!deleteItem}
        onClose={() => setDeleteItem(null)}
        onConfirm={() => deleteItem && deleteItemMut.mutate(deleteItem.id)}
        title="Delete Item"
        message={`Delete "${deleteItem?.name}"? This action cannot be undone.`}
        pending={deleteItemMut.isPending}
      />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Modal Components
// ═══════════════════════════════════════════════════════════════════════════════

function EditMenuModal({
  menu,
  onClose,
  onSubmit,
  pending,
}: {
  menu: PosMenu;
  onClose: () => void;
  onSubmit: (data: { name?: string; description?: string | null; isActive?: boolean }) => void;
  pending?: boolean;
}) {
  const [name, setName] = useState(menu.name);
  const [description, setDescription] = useState(menu.description ?? '');
  const [isActive, setIsActive] = useState(menu.isActive);

  return (
    <Modal open onClose={onClose}>
      <ModalHeader>Edit Menu</ModalHeader>
      <ModalBody>
        <div className="space-y-3">
          <div>
            <label className="ui-label">Name</label>
            <input className="ui-input w-full" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div>
            <label className="ui-label">Description</label>
            <textarea className="ui-input w-full resize-none" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} className="accent-[var(--blue)]" />
            <span className="text-sm text-[var(--text)]">Active (visible on kiosk & menu boards)</span>
          </label>
        </div>
      </ModalBody>
      <ModalFooter>
        <ModalSecondaryButton onClick={onClose}>Cancel</ModalSecondaryButton>
        <ModalPrimaryButton
          onClick={() => onSubmit({ name: name.trim(), description: description.trim() || null, isActive })}
          disabled={!name.trim() || pending}
        >
          Save
        </ModalPrimaryButton>
      </ModalFooter>
    </Modal>
  );
}

function EditCategoryModal({
  category,
  onClose,
  onSubmit,
  pending,
}: {
  category: PosCategory;
  onClose: () => void;
  onSubmit: (data: { name?: string; description?: string | null; color?: string | null }) => void;
  pending?: boolean;
}) {
  const [name, setName] = useState(category.name);
  const [description, setDescription] = useState(category.description ?? '');
  const [color, setColor] = useState<string | null>(category.color);

  return (
    <Modal open onClose={onClose}>
      <ModalHeader>Edit Category</ModalHeader>
      <ModalBody>
        <div className="space-y-3">
          <div>
            <label className="ui-label">Name</label>
            <input className="ui-input w-full" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div>
            <label className="ui-label">Description</label>
            <textarea className="ui-input w-full resize-none" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div>
            <label className="ui-label">Accent Color</label>
            <div className="flex flex-wrap gap-2 mt-1">
              {CATEGORY_COLORS.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => setColor(color === c.value ? null : c.value)}
                  className={`w-7 h-7 rounded-full border-2 transition-transform ${color === c.value ? 'border-[var(--text)] scale-110' : 'border-transparent'}`}
                  style={{ backgroundColor: c.value }}
                  title={c.label}
                />
              ))}
            </div>
          </div>
        </div>
      </ModalBody>
      <ModalFooter>
        <ModalSecondaryButton onClick={onClose}>Cancel</ModalSecondaryButton>
        <ModalPrimaryButton
          onClick={() => onSubmit({ name: name.trim(), description: description.trim() || null, color })}
          disabled={!name.trim() || pending}
        >
          Save
        </ModalPrimaryButton>
      </ModalFooter>
    </Modal>
  );
}

function NewItemModal({
  open,
  onClose,
  onSubmit,
  onUploadImage,
  pending,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: { name: string; priceCents: number; description?: string | null; tags?: string[] }) => void;
  onUploadImage: (file: File) => Promise<string | null>;
  pending?: boolean;
}) {
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState<string[]>([]);

  const handleSubmit = () => {
    if (!name.trim() || !price) return;
    onSubmit({
      name: name.trim(),
      priceCents: Math.round(parseFloat(price) * 100),
      description: description.trim() || null,
      tags: tags.length > 0 ? tags : undefined,
    });
    setName('');
    setPrice('');
    setDescription('');
    setTags([]);
  };

  return (
    <Modal open={open} onClose={onClose}>
      <ModalHeader>New Item</ModalHeader>
      <ModalBody>
        <div className="space-y-4">
          <div className="grid grid-cols-[1fr_120px] gap-3">
            <div>
              <label className="ui-label">Name *</label>
              <input className="ui-input w-full" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Caesar Salad" autoFocus />
            </div>
            <div>
              <label className="ui-label">Price ($) *</label>
              <input type="number" step="0.01" min="0" className="ui-input w-full" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0.00" />
            </div>
          </div>
          <div>
            <label className="ui-label">Description</label>
            <textarea className="ui-input w-full resize-none" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Romaine lettuce, parmesan, croutons, house dressing" />
          </div>
          <div>
            <label className="ui-label">Tags / Dietary</label>
            <TagPicker tags={tags} onChange={setTags} />
          </div>
        </div>
      </ModalBody>
      <ModalFooter>
        <ModalSecondaryButton onClick={onClose}>Cancel</ModalSecondaryButton>
        <ModalPrimaryButton onClick={handleSubmit} disabled={!name.trim() || !price || pending}>Create</ModalPrimaryButton>
      </ModalFooter>
    </Modal>
  );
}

function EditItemModal({
  item,
  onClose,
  onSubmit,
  onUploadImage,
  pending,
}: {
  item: PosItem;
  onClose: () => void;
  onSubmit: (data: { name?: string; priceCents?: number; description?: string | null; isAvailable?: boolean; imageUrl?: string | null; tags?: string[] }) => void;
  onUploadImage: (file: File) => Promise<string | null>;
  pending?: boolean;
}) {
  const [name, setName] = useState(item.name);
  const [price, setPrice] = useState((item.priceCents / 100).toFixed(2));
  const [description, setDescription] = useState(item.description ?? '');
  const [tags, setTags] = useState<string[]>(item.tags ?? []);
  const [imageUrl, setImageUrl] = useState<string | null>(item.imageUrl);
  const [imgUploading, setImgUploading] = useState(false);

  const handleImageUpload = async (file: File) => {
    setImgUploading(true);
    const url = await onUploadImage(file);
    if (url) setImageUrl(url);
    setImgUploading(false);
  };

  return (
    <Modal open onClose={onClose}>
      <ModalHeader>Edit Item</ModalHeader>
      <ModalBody>
        <div className="space-y-4">
          {/* Image upload area */}
          <div>
            <label className="ui-label">Photo</label>
            <ImageUploadArea
              imageUrl={imageUrl}
              onUpload={handleImageUpload}
              onRemove={() => setImageUrl(null)}
              size="lg"
              uploading={imgUploading}
            />
          </div>

          <div className="grid grid-cols-[1fr_120px] gap-3">
            <div>
              <label className="ui-label">Name</label>
              <input className="ui-input w-full" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            </div>
            <div>
              <label className="ui-label">Price ($)</label>
              <input type="number" step="0.01" min="0" className="ui-input w-full" value={price} onChange={(e) => setPrice(e.target.value)} />
            </div>
          </div>

          <div>
            <label className="ui-label">Description</label>
            <textarea className="ui-input w-full resize-none" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Describe ingredients, preparation..." />
          </div>

          <div>
            <label className="ui-label">Tags / Dietary</label>
            <TagPicker tags={tags} onChange={setTags} />
          </div>
        </div>
      </ModalBody>
      <ModalFooter>
        <ModalSecondaryButton onClick={onClose}>Cancel</ModalSecondaryButton>
        <ModalPrimaryButton
          onClick={() => onSubmit({
            name: name.trim(),
            priceCents: Math.round(parseFloat(price) * 100),
            description: description.trim() || null,
            tags,
            imageUrl,
          })}
          disabled={!name.trim() || !price || pending}
        >
          Save
        </ModalPrimaryButton>
      </ModalFooter>
    </Modal>
  );
}
