import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router';
import { useState, useRef, useCallback } from 'react';
import { toast } from 'sonner';
import { api, buildApiUrl } from '../../lib/api.js';
import {
  Plus, Pencil, Trash2, ChevronRight, X, Check,
  ImagePlus, Eye, EyeOff,
  Camera, Utensils, ChefHat,
  UploadCloud, GripVertical, AlertCircle,
  Clock, Calendar, Link2, Plug, RefreshCw, ShieldAlert, QrCode, Globe,
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
interface PosModifierOption {
  id: string;
  name: string;
  priceCents: number;
}
interface PosModifier {
  id: string;
  name: string;
  required: boolean;
  maxSelect: number;
  options: PosModifierOption[];
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
  unavailableReason?: string | null;
  unavailableSince?: string | null;
  modifiers?: PosModifier[];
  allergens?: string[];
  nutritionInfo?: { calories?: number; fatG?: number; carbsG?: number; proteinG?: number; sodiumMg?: number } | null;
  // Phase 3
  nameI18n?: Record<string, string>;
  descriptionI18n?: Record<string, string>;
  inventoryCount?: number | null;
  autoHideWhenEmpty?: boolean;
}

interface PosMenuSchedule {
  id: string;
  menuId: string;
  workspaceId: string;
  label: string;
  dayOfWeek: number[] | null;
  startTime: string;
  endTime: string;
  isActive: boolean;
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

  // Top-level tab
  const [activeTab, setActiveTab] = useState<'builder' | 'schedules' | 'integrations'>('builder');

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
  const [eighty6Item, setEighty6Item] = useState<PosItem | null>(null);
  const [csvImportOpen, setCsvImportOpen] = useState(false);
  const [qrMenu, setQrMenu] = useState<PosMenu | null>(null); // QR code modal

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
    mutationFn: ({ id, ...body }: { id: string; name?: string; priceCents?: number; description?: string | null; isAvailable?: boolean; imageUrl?: string | null; tags?: string[]; unavailableReason?: string | null; modifiers?: PosModifier[]; allergens?: string[]; nutritionInfo?: { calories?: number; fatG?: number; carbsG?: number; proteinG?: number; sodiumMg?: number } | null; nameI18n?: Record<string, string>; descriptionI18n?: Record<string, string>; inventoryCount?: number | null; autoHideWhenEmpty?: boolean }) =>
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

  // ─── Schedules ──────────────────────────────────────────────────────────────

  const { data: schedules = [] } = useQuery<PosMenuSchedule[]>({
    queryKey: ['pos-schedules', wsId],
    queryFn: () => api.get(`/pos/mgmt/schedules?workspaceId=${wsId}`),
    enabled: !!wsId,
  });

  const createScheduleMut = useMutation({
    mutationFn: (body: { menuId: string; workspaceId: string; label: string; startTime: string; endTime: string; dayOfWeek?: number[] | null; isActive?: boolean }) =>
      api.post<PosMenuSchedule>('/pos/mgmt/schedules', body),
    onSuccess: () => { toast.success('Schedule created'); void qc.invalidateQueries({ queryKey: ['pos-schedules', wsId] }); },
    onError: () => toast.error('Failed to create schedule'),
  });

  const updateScheduleMut = useMutation({
    mutationFn: ({ id, ...body }: Partial<PosMenuSchedule> & { id: string }) =>
      api.patch<PosMenuSchedule>(`/pos/mgmt/schedules/${id}`, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['pos-schedules', wsId] }),
    onError: () => toast.error('Failed to update schedule'),
  });

  const deleteScheduleMut = useMutation({
    mutationFn: (id: string) => api.delete(`/pos/mgmt/schedules/${id}`),
    onSuccess: () => { toast.success('Schedule removed'); void qc.invalidateQueries({ queryKey: ['pos-schedules', wsId] }); },
    onError: () => toast.error('Failed to delete schedule'),
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
          activeTab === 'builder' ? (
            <button className="ui-btn-primary flex items-center gap-1.5" onClick={() => { setCreatingMenu(true); setNewMenuName(''); }}>
              <Plus className="w-4 h-4" />
              New Menu
            </button>
          ) : null
        }
      />

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-[var(--border)] -mt-2">
        {([
          { id: 'builder',      label: 'Menu Builder', icon: <Utensils className="w-3.5 h-3.5" /> },
          { id: 'schedules',    label: 'Schedules',    icon: <Clock     className="w-3.5 h-3.5" /> },
          { id: 'integrations', label: 'Integrations', icon: <Plug      className="w-3.5 h-3.5" /> },
        ] as const).map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.id
                ? 'border-[var(--blue)] text-[var(--blue)]'
                : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text)]'
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Schedules tab ── */}
      {activeTab === 'schedules' && (
        <SchedulesTab
          menus={menus}
          schedules={schedules}
          wsId={wsId ?? ''}
          onCreate={(body) => createScheduleMut.mutate(body)}
          onUpdate={(data) => updateScheduleMut.mutate(data)}
          onDelete={(id) => deleteScheduleMut.mutate(id)}
          pending={createScheduleMut.isPending || updateScheduleMut.isPending}
        />
      )}

      {/* ── Integrations tab ── */}
      {activeTab === 'integrations' && <IntegrationsTab />}

      {/* ── Builder tab ── */}
      {activeTab === 'builder' && (
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
                    <button onClick={(e) => { e.stopPropagation(); setQrMenu(m); }} className="p-1 rounded hover:bg-black/10 text-[var(--text-muted)]" title="Show QR code">
                      <QrCode className="w-3 h-3" />
                    </button>
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
                    if (e.key === 'Enter' && newCatName.trim()) createCategoryMut.mutate({ name: newCatName.trim(), ...(newCatColor ? { color: newCatColor } : {}) });
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
                      onClick={() => newCatName.trim() && createCategoryMut.mutate({ name: newCatName.trim(), ...(newCatColor ? { color: newCatColor } : {}) })}
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
              <div className="flex items-center gap-2">
                {selectedMenuId && (
                  <button className="ui-btn-secondary text-xs flex items-center gap-1 px-3 py-1.5" onClick={() => setCsvImportOpen(true)}>
                    <UploadCloud className="w-3.5 h-3.5" />
                    Import CSV
                  </button>
                )}
                <button className="ui-btn-primary text-xs flex items-center gap-1 px-3 py-1.5" onClick={() => setNewItemOpen(true)}>
                  <Plus className="w-3.5 h-3.5" />
                  Add Item
                </button>
              </div>
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
                          onClick={() => {
                            if (item.isAvailable) {
                              setEighty6Item(item);
                            } else {
                              updateItemMut.mutate({ id: item.id, isAvailable: true });
                            }
                          }}
                          className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium backdrop-blur-sm transition-colors ${
                            item.isAvailable
                              ? 'bg-green-500/90 text-white'
                              : 'bg-red-500/90 text-white'
                          }`}
                        >
                          {item.isAvailable ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                          {item.isAvailable ? 'Available' : '86\u2019d'}
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

                      {/* 86 reason */}
                      {!item.isAvailable && (
                        <div className="flex items-start gap-1 mt-2 text-xs text-red-500">
                          <AlertCircle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                          <span>
                            {item.unavailableReason || 'Unavailable'}
                            {item.unavailableSince && (
                              <span className="text-[var(--text-muted)]"> &middot; {new Date(item.unavailableSince).toLocaleDateString()}</span>
                            )}
                          </span>
                        </div>
                      )}

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

                      {/* Inventory indicator */}
                      {item.inventoryCount !== null && item.inventoryCount !== undefined && (
                        <div className={`flex items-center gap-1 mt-1.5 text-xs ${item.inventoryCount === 0 ? 'text-red-500' : item.inventoryCount <= 5 ? 'text-amber-500' : 'text-[var(--text-muted)]'}`}>
                          <span className="font-medium">{item.inventoryCount === 0 ? 'Out of stock' : `${item.inventoryCount} left`}</span>
                          {item.autoHideWhenEmpty && item.inventoryCount === 0 && <span className="opacity-70">(auto-hidden on board)</span>}
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
      )} {/* end builder tab */}

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

      {/* 86 an item (mark unavailable with reason) */}
      {eighty6Item && (
        <Eighty6Modal
          item={eighty6Item}
          onClose={() => setEighty6Item(null)}
          onConfirm={(reason) => {
            updateItemMut.mutate({ id: eighty6Item.id, isAvailable: false, unavailableReason: reason });
            setEighty6Item(null);
          }}
          pending={updateItemMut.isPending}
        />
      )}

      {/* QR code modal */}
      {qrMenu && wsId && (
        <QrMenuModal
          menu={qrMenu}
          wsId={wsId}
          onClose={() => setQrMenu(null)}
        />
      )}

      {/* CSV import */}
      {csvImportOpen && selectedMenuId && (
        <CsvImportModal
          menuId={selectedMenuId}
          onClose={() => setCsvImportOpen(false)}
          onImported={() => {
            setCsvImportOpen(false);
            void qc.invalidateQueries({ queryKey: ['pos-categories', selectedMenuId] });
            if (selectedCategoryId) void qc.invalidateQueries({ queryKey: ['pos-items', selectedCategoryId] });
          }}
        />
      )}
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
      ...(tags.length > 0 ? { tags } : {}),
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
  onSubmit: (data: { name?: string; priceCents?: number; description?: string | null; isAvailable?: boolean; imageUrl?: string | null; tags?: string[]; modifiers?: PosModifier[]; allergens?: string[]; nutritionInfo?: { calories?: number; fatG?: number; carbsG?: number; proteinG?: number; sodiumMg?: number } | null; nameI18n?: Record<string, string>; descriptionI18n?: Record<string, string>; inventoryCount?: number | null; autoHideWhenEmpty?: boolean }) => void;
  onUploadImage: (file: File) => Promise<string | null>;
  pending?: boolean;
}) {
  const [name, setName] = useState(item.name);
  const [price, setPrice] = useState((item.priceCents / 100).toFixed(2));
  const [description, setDescription] = useState(item.description ?? '');
  const [tags, setTags] = useState<string[]>(item.tags ?? []);
  const [imageUrl, setImageUrl] = useState<string | null>(item.imageUrl);
  const [imgUploading, setImgUploading] = useState(false);
  const [modifiers, setModifiers] = useState<PosModifier[]>(item.modifiers ?? []);
  const [allergens, setAllergens] = useState<string[]>(item.allergens ?? []);
  const [nutritionInfo, setNutritionInfo] = useState<{ calories?: number; fatG?: number; carbsG?: number; proteinG?: number; sodiumMg?: number } | null>(item.nutritionInfo ?? null);
  const [showNutrition, setShowNutrition] = useState(!!item.nutritionInfo);
  // Phase 3 — bilingual + inventory
  const [nameI18n, setNameI18n] = useState<Record<string, string>>(item.nameI18n ?? {});
  const [descriptionI18n, setDescriptionI18n] = useState<Record<string, string>>(item.descriptionI18n ?? {});
  const [inventoryCount, setInventoryCount] = useState<string>(item.inventoryCount != null ? String(item.inventoryCount) : '');
  const [autoHideWhenEmpty, setAutoHideWhenEmpty] = useState(item.autoHideWhenEmpty ?? false);

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

          <div>
            <label className="ui-label">Modifiers</label>
            <ModifierEditor modifiers={modifiers} onChange={setModifiers} />
          </div>

          <div>
            <label className="ui-label">Allergens</label>
            <AllergenPicker allergens={allergens} onChange={setAllergens} />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="ui-label">Nutrition Info (per serving)</label>
              <button
                type="button"
                onClick={() => { setShowNutrition((v) => !v); if (!showNutrition && !nutritionInfo) setNutritionInfo({}); }}
                className="text-xs text-[var(--blue)] hover:underline"
              >
                {showNutrition ? 'Hide' : 'Add'}
              </button>
            </div>
            {showNutrition && (
              <NutritionPanel
                value={nutritionInfo ?? {}}
                onChange={(v) => setNutritionInfo(Object.keys(v).length === 0 ? null : v)}
              />
            )}
          </div>

          {/* ── Bilingual names ── */}
          <div>
            <div className="flex items-center gap-1.5 mb-2">
              <Globe className="w-3.5 h-3.5 text-[var(--text-muted)]" />
              <label className="ui-label">Bilingual Names</label>
            </div>
            <div className="space-y-2">
              <div>
                <label className="text-xs text-[var(--text-muted)] mb-0.5 block">French (fr)</label>
                <input
                  className="ui-input text-sm"
                  placeholder="Nom en français…"
                  value={nameI18n['fr'] ?? ''}
                  onChange={(e) => setNameI18n((prev) => ({ ...prev, fr: e.target.value }))}
                />
              </div>
              <div>
                <label className="text-xs text-[var(--text-muted)] mb-0.5 block">French description (fr)</label>
                <input
                  className="ui-input text-sm"
                  placeholder="Description en français…"
                  value={descriptionI18n['fr'] ?? ''}
                  onChange={(e) => setDescriptionI18n((prev) => ({ ...prev, fr: e.target.value }))}
                />
              </div>
            </div>
          </div>

          {/* ── Inventory tracking ── */}
          <div>
            <label className="ui-label">Inventory</label>
            <div className="flex items-center gap-3">
              <div className="flex flex-col gap-0.5 flex-1">
                <label className="text-xs text-[var(--text-muted)]">Count (leave blank = not tracked)</label>
                <input
                  type="number"
                  min={0}
                  className="ui-input text-sm w-32"
                  placeholder="e.g. 24"
                  value={inventoryCount}
                  onChange={(e) => setInventoryCount(e.target.value)}
                />
              </div>
              <div className="flex items-center gap-2 mt-4">
                <input
                  type="checkbox"
                  id="auto-hide"
                  checked={autoHideWhenEmpty}
                  onChange={(e) => setAutoHideWhenEmpty(e.target.checked)}
                  className="rounded"
                />
                <label htmlFor="auto-hide" className="text-sm">Auto-hide on board when 0</label>
              </div>
            </div>
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
            modifiers,
            allergens,
            nutritionInfo: showNutrition ? nutritionInfo : null,
            nameI18n,
            descriptionI18n,
            inventoryCount: inventoryCount.trim() !== '' ? parseInt(inventoryCount, 10) : null,
            autoHideWhenEmpty,
          })}
          disabled={!name.trim() || !price || pending}
        >
          Save
        </ModalPrimaryButton>
      </ModalFooter>
    </Modal>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// "86" Reason Modal
// ═══════════════════════════════════════════════════════════════════════════════

function Eighty6Modal({
  item,
  onClose,
  onConfirm,
  pending,
}: {
  item: PosItem;
  onClose: () => void;
  onConfirm: (reason: string | null) => void;
  pending?: boolean;
}) {
  const [reason, setReason] = useState('');
  const QUICK = ['Out of stock', 'Out of season', 'Supplier issue', 'Prep unavailable', 'Equipment down'];

  return (
    <Modal open onClose={onClose}>
      <ModalHeader>Mark &ldquo;{item.name}&rdquo; as 86&rsquo;d</ModalHeader>
      <ModalBody>
        <div className="space-y-3">
          <p className="text-xs text-[var(--text-muted)]">
            This hides the item from active menus. Add an optional reason for staff visibility.
          </p>
          <div>
            <label className="ui-label">Reason (optional)</label>
            <input
              className="ui-input w-full"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Out of stock"
              autoFocus
            />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {QUICK.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => setReason(q)}
                className={`text-xs px-2 py-1 rounded-full border transition-colors ${
                  reason === q
                    ? 'bg-[var(--blue)] text-white border-[var(--blue)]'
                    : 'border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--blue)]'
                }`}
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      </ModalBody>
      <ModalFooter>
        <ModalSecondaryButton onClick={onClose}>Cancel</ModalSecondaryButton>
        <ModalPrimaryButton onClick={() => onConfirm(reason.trim() || null)} disabled={pending}>
          Mark 86&rsquo;d
        </ModalPrimaryButton>
      </ModalFooter>
    </Modal>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Modifier Editor
// ═══════════════════════════════════════════════════════════════════════════════

function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `id_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

function ModifierEditor({
  modifiers,
  onChange,
}: {
  modifiers: PosModifier[];
  onChange: (m: PosModifier[]) => void;
}) {
  const update = (idx: number, patch: Partial<PosModifier>) => {
    onChange(modifiers.map((m, i) => (i === idx ? { ...m, ...patch } : m)));
  };
  const updateOption = (mIdx: number, oIdx: number, patch: Partial<PosModifierOption>) => {
    onChange(modifiers.map((m, i) => {
      if (i !== mIdx) return m;
      return { ...m, options: m.options.map((o, j) => (j === oIdx ? { ...o, ...patch } : o)) };
    }));
  };

  return (
    <div className="space-y-3">
      {modifiers.map((mod, mIdx) => (
        <div key={mod.id} className="rounded-lg border border-[var(--border)] p-3 space-y-2 bg-[var(--surface)]">
          <div className="flex items-center gap-2">
            <input
              className="ui-input flex-1 text-sm"
              value={mod.name}
              onChange={(e) => update(mIdx, { name: e.target.value })}
              placeholder="Group name (e.g. Choose a side)"
            />
            <button
              type="button"
              onClick={() => onChange(modifiers.filter((_, i) => i !== mIdx))}
              className="p-1.5 text-[var(--text-muted)] hover:text-red-500"
              title="Remove group"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
          <div className="flex items-center gap-4 text-xs text-[var(--text-muted)]">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={mod.required}
                onChange={(e) => update(mIdx, { required: e.target.checked })}
              />
              Required
            </label>
            <label className="flex items-center gap-1.5">
              Max select
              <input
                type="number"
                min={1}
                className="ui-input w-16 py-0.5"
                value={mod.maxSelect}
                onChange={(e) => update(mIdx, { maxSelect: Math.max(1, parseInt(e.target.value, 10) || 1) })}
              />
            </label>
          </div>

          <div className="space-y-1.5 pl-1">
            {mod.options.map((opt, oIdx) => (
              <div key={opt.id} className="flex items-center gap-2">
                <input
                  className="ui-input flex-1 text-sm py-1"
                  value={opt.name}
                  onChange={(e) => updateOption(mIdx, oIdx, { name: e.target.value })}
                  placeholder="Option name"
                />
                <div className="flex items-center gap-1">
                  <span className="text-xs text-[var(--text-muted)]">+$</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    className="ui-input w-20 text-sm py-1"
                    value={(opt.priceCents / 100).toFixed(2)}
                    onChange={(e) => updateOption(mIdx, oIdx, { priceCents: Math.round((parseFloat(e.target.value) || 0) * 100) })}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => update(mIdx, { options: mod.options.filter((_, j) => j !== oIdx) })}
                  className="p-1 text-[var(--text-muted)] hover:text-red-500"
                  title="Remove option"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => update(mIdx, { options: [...mod.options, { id: newId(), name: '', priceCents: 0 }] })}
              className="text-xs text-[var(--blue)] hover:underline flex items-center gap-1 mt-1"
            >
              <Plus className="w-3 h-3" /> Add option
            </button>
          </div>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...modifiers, { id: newId(), name: '', required: false, maxSelect: 1, options: [] }])}
        className="ui-btn-secondary text-xs flex items-center gap-1 px-3 py-1.5"
      >
        <Plus className="w-3.5 h-3.5" /> Add modifier group
      </button>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// CSV Import Modal (flexible drag-to-map)
// ═══════════════════════════════════════════════════════════════════════════════

type CsvField = 'name' | 'priceCents' | 'categoryName' | 'description';
const CSV_FIELDS: { id: CsvField; label: string; required: boolean }[] = [
  { id: 'name', label: 'Item Name', required: true },
  { id: 'priceCents', label: 'Price ($)', required: false },
  { id: 'categoryName', label: 'Category', required: false },
  { id: 'description', label: 'Description', required: false },
];

const CSV_ALIASES: Record<CsvField, string[]> = {
  name: ['name', 'item', 'title', 'product', 'dish'],
  priceCents: ['price', 'cost', 'amount', 'pricing'],
  categoryName: ['category', 'section', 'group', 'type', 'menu'],
  description: ['description', 'desc', 'details', 'notes', 'ingredients'],
};

function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const records: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((v) => v.trim() !== '')) records.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    if (row.some((v) => v.trim() !== '')) records.push(row);
  }
  const headers = records.length > 0 ? records[0]!.map((h) => h.trim()) : [];
  return { headers, rows: records.slice(1) };
}

function autoMap(headers: string[]): Record<CsvField, number | null> {
  const map: Record<CsvField, number | null> = { name: null, priceCents: null, categoryName: null, description: null };
  for (const field of CSV_FIELDS) {
    const aliases = CSV_ALIASES[field.id];
    const idx = headers.findIndex((h) => aliases.includes(h.trim().toLowerCase()));
    if (idx >= 0) map[field.id] = idx;
  }
  return map;
}

function CsvImportModal({
  menuId,
  onClose,
  onImported,
}: {
  menuId: string;
  onClose: () => void;
  onImported: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Record<CsvField, number | null>>({ name: null, priceCents: null, categoryName: null, description: null });
  const [dragHeader, setDragHeader] = useState<number | null>(null);

  const importMut = useMutation({
    mutationFn: (body: { menuId: string; rows: { name?: string; priceCents?: number; categoryName?: string; description?: string }[] }) =>
      api.post<{ created: number; skipped: number; errors: { row: number; reason: string }[] }>('/pos/mgmt/csv-import', body),
    onSuccess: (res) => {
      toast.success(`Imported ${res.created} item${res.created === 1 ? '' : 's'}${res.skipped ? `, skipped ${res.skipped}` : ''}`);
      if (res.errors.length > 0) toast.warning(`${res.errors.length} row(s) had errors`);
      onImported();
    },
    onError: () => toast.error('CSV import failed'),
  });

  const handleFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? '');
      const parsed = parseCsv(text);
      setHeaders(parsed.headers);
      setRows(parsed.rows);
      setMapping(autoMap(parsed.headers));
    };
    reader.readAsText(file);
  };

  const buildRows = () => {
    return rows.map((r) => {
      const obj: { name?: string; priceCents?: number; categoryName?: string; description?: string } = {};
      if (mapping.name !== null) obj.name = (r[mapping.name] ?? '').trim();
      if (mapping.priceCents !== null) {
        const raw = (r[mapping.priceCents] ?? '').replace(/[^0-9.]/g, '');
        const dollars = parseFloat(raw);
        if (!isNaN(dollars)) obj.priceCents = Math.round(dollars * 100);
      }
      if (mapping.categoryName !== null) obj.categoryName = (r[mapping.categoryName] ?? '').trim();
      if (mapping.description !== null) obj.description = (r[mapping.description] ?? '').trim();
      return obj;
    });
  };

  const dropOnField = (field: CsvField) => {
    if (dragHeader === null) return;
    setMapping((prev) => {
      const next = { ...prev };
      // remove this header from any other field
      (Object.keys(next) as CsvField[]).forEach((k) => { if (next[k] === dragHeader) next[k] = null; });
      next[field] = dragHeader;
      return next;
    });
    setDragHeader(null);
  };

  const usedHeaders = new Set(Object.values(mapping).filter((v): v is number => v !== null));
  const canImport = mapping.name !== null && rows.length > 0;
  const preview = headers.length > 0 ? buildRows().slice(0, 4) : [];

  return (
    <Modal open onClose={onClose} size="lg">
      <ModalHeader>Import Items from CSV</ModalHeader>
      <ModalBody>
        {headers.length === 0 ? (
          <div>
            <input
              ref={inputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }}
            />
            <button
              onClick={() => inputRef.current?.click()}
              className="w-full flex flex-col items-center justify-center gap-2 py-10 rounded-xl border-2 border-dashed border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--blue)] hover:text-[var(--blue)] transition-colors"
            >
              <UploadCloud className="w-8 h-8" />
              <span className="text-sm font-medium">Choose a CSV file</span>
              <span className="text-xs">First row should contain column headers</span>
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-xs text-[var(--text-muted)]">
              Drag a column onto a field to map it. We&rsquo;ve auto-matched what we could.
            </p>

            {/* Available columns */}
            <div>
              <div className="ui-label mb-1">CSV Columns</div>
              <div className="flex flex-wrap gap-1.5">
                {headers.map((h, idx) => (
                  <div
                    key={idx}
                    draggable
                    onDragStart={() => setDragHeader(idx)}
                    onDragEnd={() => setDragHeader(null)}
                    className={`flex items-center gap-1 text-xs px-2 py-1 rounded-md border cursor-grab active:cursor-grabbing ${
                      usedHeaders.has(idx)
                        ? 'border-[var(--blue)]/40 bg-[var(--blue)]/10 text-[var(--blue)]'
                        : 'border-[var(--border)] bg-[var(--surface)] text-[var(--text)]'
                    }`}
                  >
                    <GripVertical className="w-3 h-3 opacity-60" />
                    {h || `Column ${idx + 1}`}
                  </div>
                ))}
              </div>
            </div>

            {/* Target fields */}
            <div className="grid grid-cols-2 gap-2">
              {CSV_FIELDS.map((field) => {
                const mappedIdx = mapping[field.id];
                return (
                  <div
                    key={field.id}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => dropOnField(field.id)}
                    className={`rounded-lg border-2 border-dashed p-2 min-h-[58px] transition-colors ${
                      dragHeader !== null ? 'border-[var(--blue)] bg-[var(--blue)]/5' : 'border-[var(--border)]'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-[var(--text)]">
                        {field.label}{field.required && <span className="text-red-500"> *</span>}
                      </span>
                    </div>
                    {mappedIdx !== null ? (
                      <div className="mt-1 flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-[var(--blue)]/10 text-[var(--blue)] w-fit">
                        {headers[mappedIdx] || `Column ${mappedIdx + 1}`}
                        <button onClick={() => setMapping((p) => ({ ...p, [field.id]: null }))} className="hover:text-red-500">
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ) : (
                      <span className="text-xs text-[var(--text-muted)]">Drop column here</span>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Preview */}
            {preview.length > 0 && (
              <div>
                <div className="ui-label mb-1">Preview ({rows.length} rows)</div>
                <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
                  <table className="w-full text-xs">
                    <thead className="bg-[var(--surface)] text-[var(--text-muted)]">
                      <tr>
                        <th className="text-left px-2 py-1 font-medium">Name</th>
                        <th className="text-left px-2 py-1 font-medium">Price</th>
                        <th className="text-left px-2 py-1 font-medium">Category</th>
                        <th className="text-left px-2 py-1 font-medium">Description</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.map((r, i) => (
                        <tr key={i} className="border-t border-[var(--border)]">
                          <td className="px-2 py-1 text-[var(--text)]">{r.name || <span className="text-red-500">&mdash;</span>}</td>
                          <td className="px-2 py-1">{r.priceCents !== undefined ? formatPrice(r.priceCents) : '\u2014'}</td>
                          <td className="px-2 py-1">{r.categoryName || '\u2014'}</td>
                          <td className="px-2 py-1 truncate max-w-[160px]">{r.description || '\u2014'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </ModalBody>
      <ModalFooter>
        <ModalSecondaryButton onClick={onClose}>Cancel</ModalSecondaryButton>
        {headers.length > 0 && (
          <ModalPrimaryButton
            onClick={() => importMut.mutate({ menuId, rows: buildRows() })}
            disabled={!canImport || importMut.isPending}
          >
            Import {rows.length} item{rows.length === 1 ? '' : 's'}
          </ModalPrimaryButton>
        )}
      </ModalFooter>
    </Modal>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// AllergenPicker
// ═══════════════════════════════════════════════════════════════════════════════

const CANADIAN_ALLERGENS = [
  'Eggs', 'Milk', 'Mustard', 'Peanuts', 'Crustaceans', 'Molluscs',
  'Fish', 'Sesame', 'Soy', 'Tree Nuts', 'Wheat/Triticale', 'Gluten', 'Sulphites',
];

function AllergenPicker({ allergens, onChange }: { allergens: string[]; onChange: (a: string[]) => void }) {
  const [custom, setCustom] = useState('');

  const toggle = (a: string) => {
    if (allergens.includes(a)) onChange(allergens.filter((x) => x !== a));
    else onChange([...allergens, a]);
  };

  const addCustom = () => {
    const v = custom.trim();
    if (v && !allergens.includes(v)) onChange([...allergens, v]);
    setCustom('');
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {CANADIAN_ALLERGENS.map((a) => (
          <button
            key={a}
            type="button"
            onClick={() => toggle(a)}
            className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${
              allergens.includes(a)
                ? 'bg-red-100 border-red-400 text-red-700 dark:bg-red-900/30 dark:border-red-500 dark:text-red-400'
                : 'border-[var(--border)] text-[var(--text-muted)] hover:border-red-300'
            }`}
          >
            {a}
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          className="ui-input text-xs flex-1"
          placeholder="Add custom allergen…"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustom(); } }}
        />
        <button type="button" onClick={addCustom} className="ui-button-secondary text-xs px-3">Add</button>
      </div>
      {allergens.filter((a) => !CANADIAN_ALLERGENS.includes(a)).length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {allergens.filter((a) => !CANADIAN_ALLERGENS.includes(a)).map((a) => (
            <span key={a} className="text-xs px-2 py-0.5 rounded-full bg-orange-100 border border-orange-300 text-orange-700 dark:bg-orange-900/30 dark:border-orange-500 dark:text-orange-400 flex items-center gap-1">
              {a}
              <button type="button" onClick={() => onChange(allergens.filter((x) => x !== a))} className="ml-0.5 opacity-60 hover:opacity-100">×</button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// NutritionPanel
// ═══════════════════════════════════════════════════════════════════════════════

type NutritionValue = { calories?: number; fatG?: number; carbsG?: number; proteinG?: number; sodiumMg?: number };

function NutritionPanel({ value, onChange }: { value: NutritionValue; onChange: (v: NutritionValue) => void }) {
  const field = (key: keyof NutritionValue, label: string, unit: string) => (
    <div className="flex flex-col gap-0.5">
      <label className="text-xs text-[var(--text-muted)]">{label}</label>
      <div className="flex items-center gap-1">
        <input
          type="number"
          min={0}
          className="ui-input text-xs w-20"
          value={value[key] ?? ''}
          onChange={(e) => {
            const n = e.target.value === '' ? undefined : Number(e.target.value);
            onChange({ ...value, [key]: n });
          }}
        />
        <span className="text-xs text-[var(--text-muted)]">{unit}</span>
      </div>
    </div>
  );

  return (
    <div className="flex flex-wrap gap-3 p-3 rounded-lg border border-[var(--border)] bg-[var(--surface-raised)]">
      {field('calories', 'Calories', 'kcal')}
      {field('fatG', 'Fat', 'g')}
      {field('carbsG', 'Carbs', 'g')}
      {field('proteinG', 'Protein', 'g')}
      {field('sodiumMg', 'Sodium', 'mg')}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SchedulesTab
// ═══════════════════════════════════════════════════════════════════════════════

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function SchedulesTab({
  menus,
  schedules,
  wsId,
  onCreate,
  onUpdate,
  onDelete,
  pending,
}: {
  menus: PosMenu[];
  schedules: PosMenuSchedule[];
  wsId: string;
  onCreate: (data: Omit<PosMenuSchedule, 'id'>) => void;
  onUpdate: (data: Partial<PosMenuSchedule> & { id: string }) => void;
  onDelete: (id: string) => void;
  pending?: boolean;
}) {
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [formMenuId, setFormMenuId] = useState('');
  const [formLabel, setFormLabel] = useState('');
  const [formStart, setFormStart] = useState('08:00');
  const [formEnd, setFormEnd] = useState('17:00');
  const [formDays, setFormDays] = useState<number[]>([]);
  const [formActive, setFormActive] = useState(true);

  const resetForm = () => {
    setFormMenuId(''); setFormLabel(''); setFormStart('08:00'); setFormEnd('17:00');
    setFormDays([]); setFormActive(true); setEditId(null); setShowForm(false);
  };

  const openEdit = (s: PosMenuSchedule) => {
    setEditId(s.id); setFormMenuId(s.menuId); setFormLabel(s.label);
    setFormStart(s.startTime); setFormEnd(s.endTime);
    setFormDays(s.dayOfWeek ?? []); setFormActive(s.isActive); setShowForm(true);
  };

  const handleSave = () => {
    if (!formMenuId || !formLabel.trim()) return;
    const data = {
      menuId: formMenuId, workspaceId: wsId, label: formLabel.trim(),
      startTime: formStart, endTime: formEnd,
      dayOfWeek: formDays.length > 0 ? formDays : null,
      isActive: formActive,
    };
    if (editId) onUpdate({ id: editId, ...data });
    else onCreate(data as Omit<PosMenuSchedule, 'id'>);
    resetForm();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm">Day-Part Schedules</h3>
        <button
          className="ui-button-secondary text-xs flex items-center gap-1.5"
          onClick={() => { resetForm(); setShowForm(true); }}
        >
          <Plus className="w-3.5 h-3.5" /> Add Schedule
        </button>
      </div>

      {showForm && (
        <div className="p-4 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="ui-label">Label</label>
              <input className="ui-input" value={formLabel} onChange={(e) => setFormLabel(e.target.value)} placeholder="e.g. Breakfast" />
            </div>
            <div>
              <label className="ui-label">Menu</label>
              <select className="ui-input" value={formMenuId} onChange={(e) => setFormMenuId(e.target.value)}>
                <option value="">Select menu…</option>
                {menus.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
            <div>
              <label className="ui-label">Start Time</label>
              <input type="time" className="ui-input" value={formStart} onChange={(e) => setFormStart(e.target.value)} />
            </div>
            <div>
              <label className="ui-label">End Time</label>
              <input type="time" className="ui-input" value={formEnd} onChange={(e) => setFormEnd(e.target.value)} />
            </div>
          </div>
          <div>
            <label className="ui-label">Days (leave empty = every day)</label>
            <div className="flex gap-1.5 flex-wrap">
              {DAY_LABELS.map((d, i) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setFormDays((prev) => prev.includes(i) ? prev.filter((x) => x !== i) : [...prev, i])}
                  className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                    formDays.includes(i)
                      ? 'bg-[var(--blue)] border-[var(--blue)] text-white'
                      : 'border-[var(--border)] text-[var(--text-muted)]'
                  }`}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input type="checkbox" id="sched-active" checked={formActive} onChange={(e) => setFormActive(e.target.checked)} className="rounded" />
            <label htmlFor="sched-active" className="text-sm">Active</label>
          </div>
          <div className="flex gap-2 justify-end">
            <button className="ui-button-secondary text-xs" onClick={resetForm}>Cancel</button>
            <button className="ui-button-primary text-xs" onClick={handleSave} disabled={!formMenuId || !formLabel.trim() || pending}>
              {editId ? 'Save' : 'Create'}
            </button>
          </div>
        </div>
      )}

      {schedules.length === 0 && !showForm && (
        <div className="text-center py-12 text-[var(--text-muted)] text-sm">
          No schedules yet. Add one to automatically switch menus by time of day.
        </div>
      )}

      <div className="space-y-2">
        {schedules.map((s) => {
          const menu = menus.find((m) => m.id === s.menuId);
          return (
            <div key={s.id} className="flex items-center gap-3 p-3 rounded-xl border border-[var(--border)] bg-[var(--surface)]">
              <div className={`w-2 h-2 rounded-full flex-shrink-0 ${s.isActive ? 'bg-green-500' : 'bg-[var(--text-muted)]'}`} />
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm">{s.label}</div>
                <div className="text-xs text-[var(--text-muted)]">
                  {menu?.name ?? 'Unknown menu'} · {s.startTime}–{s.endTime}
                  {s.dayOfWeek && s.dayOfWeek.length > 0 && (
                    <> · {s.dayOfWeek.map((d) => DAY_LABELS[d]!).join(', ')}</>
                  )}
                </div>
              </div>
              <button className="p-1.5 rounded hover:bg-[var(--surface-raised)] text-[var(--text-muted)] hover:text-[var(--text)]" onClick={() => openEdit(s)}>
                <Pencil className="w-3.5 h-3.5" />
              </button>
              <button className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-[var(--text-muted)] hover:text-red-500" onClick={() => onDelete(s.id)}>
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// IntegrationsTab
// ═══════════════════════════════════════════════════════════════════════════════

const INTEGRATIONS = [
  { id: 'square', name: 'Square POS', description: 'Sync menu items and orders from Square.', status: 'coming-soon' as const },
  { id: 'toast', name: 'Toast POS', description: 'Import menus and real-time item 86 from Toast.', status: 'coming-soon' as const },
  { id: 'ubereats', name: 'Uber Eats', description: 'Display live order queue and item availability.', status: 'coming-soon' as const },
  { id: 'doordash', name: 'DoorDash', description: 'Connect DoorDash store for menu sync.', status: 'coming-soon' as const },
];

function IntegrationsTab() {
  return (
    <div className="space-y-4">
      <h3 className="font-semibold text-sm">Integrations</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {INTEGRATIONS.map((intg) => (
          <div key={intg.id} className="p-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Plug className="w-4 h-4 text-[var(--text-muted)]" />
                <span className="font-medium text-sm">{intg.name}</span>
              </div>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--surface-raised)] text-[var(--text-muted)] border border-[var(--border)]">
                Coming Soon
              </span>
            </div>
            <p className="text-xs text-[var(--text-muted)]">{intg.description}</p>
            <button disabled className="ui-button-secondary text-xs opacity-40 cursor-not-allowed mt-auto">Connect</button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// QrMenuModal — shows QR code for a menu + the scan URL
// ═══════════════════════════════════════════════════════════════════════════════

function QrMenuModal({ menu, wsId, onClose }: { menu: PosMenu; wsId: string; onClose: () => void }) {
  const qrUrl = `${window.location.origin}/qr/${wsId}/${menu.id}`;

  return (
    <Modal open onClose={onClose}>
      <ModalHeader>QR Code — {menu.name}</ModalHeader>
      <ModalBody>
        <div className="flex flex-col items-center gap-4 py-2">
          {/* Native QR via Google Charts API — no npm dep needed */}
          <img
            src={`https://chart.googleapis.com/chart?chs=220x220&cht=qr&chl=${encodeURIComponent(qrUrl)}&choe=UTF-8`}
            alt="QR code"
            className="rounded-lg border border-[var(--border)] p-2 bg-white"
            width={220}
            height={220}
          />
          <div className="w-full">
            <label className="ui-label">Scan URL</label>
            <div className="flex gap-2">
              <input className="ui-input text-xs flex-1 truncate" readOnly value={qrUrl} />
              <button
                className="ui-button-secondary text-xs px-3"
                onClick={() => { void navigator.clipboard.writeText(qrUrl); toast.success('Copied!'); }}
              >
                Copy
              </button>
            </div>
          </div>
          <p className="text-xs text-[var(--text-muted)] text-center">
            Customers scan this QR code to view the live menu on their phone.
            The page automatically reflects item availability and language preferences.
          </p>
        </div>
      </ModalBody>
      <ModalFooter>
        <ModalSecondaryButton onClick={onClose}>Close</ModalSecondaryButton>
      </ModalFooter>
    </Modal>
  );
}
