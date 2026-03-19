import { useState, useRef } from 'react';
import { useParams } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Plus, Tag, Trash2, Pencil, Check, X, Monitor,
  Image, Layers, CalendarDays, ChevronDown, MapPin,
} from 'lucide-react';
import { api } from '../../lib/api.js';
import {
  ActionButton,
  Badge,
  EmptyState,
  PageHeader,
} from '../../components/UiPrimitives.js';
import ConfirmDialog from '../../components/ConfirmDialog.js';

// ── Types ─────────────────────────────────────────────────────────────────────

type EntityType = 'device' | 'content' | 'playlist' | 'schedule';

interface TagUsage {
  device: number;
  content: number;
  playlist: number;
  schedule: number;
}

interface WorkspaceTag {
  id: string;
  categoryId: string;
  workspaceId: string;
  name: string;
  color: string | null;
  position: number;
  createdAt: string;
  usage: TagUsage;
}

interface TagCategory {
  id: string;
  workspaceId: string;
  name: string;
  color: string;
  availableFor: EntityType[];
  position: number;
  createdAt: string;
  updatedAt: string;
  tags: WorkspaceTag[];
}

// ── Constants ─────────────────────────────────────────────────────────────────

const ENTITY_OPTIONS: { id: EntityType; label: string; icon: React.ReactNode }[] = [
  { id: 'device',   label: 'Devices',   icon: <Monitor size={13} /> },
  { id: 'content',  label: 'Content',   icon: <Image size={13} /> },
  { id: 'playlist', label: 'Playlists', icon: <Layers size={13} /> },
  { id: 'schedule', label: 'Schedules', icon: <CalendarDays size={13} /> },
];

const PRESET_COLORS = [
  '#6366f1', '#3b82f6', '#06b6d4', '#10b981',
  '#f59e0b', '#ef4444', '#ec4899', '#8b5cf6',
  '#f97316', '#84cc16', '#14b8a6', '#64748b',
];

// ── Color dot ─────────────────────────────────────────────────────────────────

function ColorPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-6 h-6 rounded-full border-2 border-[var(--border)] shrink-0 focus:outline-none"
        style={{ background: value }}
        title="Pick colour"
      />
      {open && (
        <div
          className="absolute left-0 top-8 z-30 p-2 rounded-xl border grid grid-cols-6 gap-1.5"
          style={{ background: 'var(--modal-bg)', borderColor: 'var(--card-border)', minWidth: 160 }}
        >
          {PRESET_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => { onChange(c); setOpen(false); }}
              className="w-5 h-5 rounded-full border-2 transition-transform hover:scale-110 focus:outline-none"
              style={{
                background: c,
                borderColor: c === value ? 'white' : 'transparent',
              }}
            />
          ))}
          <div className="col-span-6 mt-1 border-t pt-1.5" style={{ borderColor: 'var(--border)' }}>
            <input
              type="color"
              value={value}
              onChange={(e) => onChange(e.target.value)}
              className="w-full h-6 cursor-pointer rounded border-0 bg-transparent"
            />
          </div>
        </div>
          <div
            className="w-full max-w-md rounded-2xl border shadow-2xl overflow-hidden"
            style={{ background: 'var(--modal-bg)', borderColor: 'var(--card-border)' }}
}

// ── Tag usage modal ───────────────────────────────────────────────────────────

const USAGE_ENTITY_META: { id: EntityType; label: string; icon: React.ReactNode }[] = [
  { id: 'device',   label: 'Devices',   icon: <Monitor size={14} /> },
  { id: 'content',  label: 'Content',   icon: <Image size={14} /> },
  { id: 'playlist', label: 'Playlists', icon: <Layers size={14} /> },
  { id: 'schedule', label: 'Schedules', icon: <CalendarDays size={14} /> },
];

function TagUsageModal({
  tag,
  categoryColor,
  activeType,
  onClose,
}: {
  tag: WorkspaceTag;
  categoryColor: string;
  activeType: EntityType;
  onClose: () => void;
}) {
  const color = tag.color ?? categoryColor;
  const [tab, setTab] = useState<EntityType>(activeType);

  const { data, isLoading } = useQuery<Record<EntityType, { id: string; name: string }[]>>({
    queryKey: ['tag-usage', tag.id],
    queryFn: () => api.get(`/tags/${tag.id}/usage`),
  });

  const totalUsage = tag.usage.device + tag.usage.content + tag.usage.playlist + tag.usage.schedule;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={onClose}>
      <div
        className="w-full max-w-md rounded-2xl border shadow-2xl overflow-hidden"
        style={{ background: 'var(--card)', borderColor: 'var(--card-border)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-center gap-3">
            <MapPin size={16} className="text-[var(--text-muted)]" />
            <div>
              <div className="flex items-center gap-2">
                <span
                  className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold"
                  style={{ background: `${color}22`, color, border: `1px solid ${color}55` }}
                >
                  {tag.name}
                </span>
                <span className="text-xs text-[var(--text-muted)]">
                  {totalUsage} {totalUsage === 1 ? 'use' : 'uses'}
                </span>
              </div>
              <p className="text-[10px] text-[var(--text-muted)] mt-0.5">Tag usage map</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text)] transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Entity type tabs */}
        <div className="flex border-b" style={{ borderColor: 'var(--border)' }}>
          {USAGE_ENTITY_META.map(({ id, label, icon }) => {
            const count = tag.usage[id];
            return (
              <button
                key={id} type="button"
                onClick={() => setTab(id)}
                className={`flex-1 flex flex-col items-center gap-1 py-2.5 text-[10px] font-medium border-b-2 transition-colors ${
                  tab === id
                    ? 'border-[var(--blue)] text-[var(--blue)]'
                    : count > 0
                      ? 'border-transparent text-[var(--text)]'
                      : 'border-transparent text-[var(--text-muted)]'
                }`}
              >
                <span className={count > 0 ? 'opacity-100' : 'opacity-30'}>{icon}</span>
                <span>{label}</span>
                {count > 0 && (
                  <span
                    className="px-1.5 py-0 rounded-full text-[9px] font-bold"
                    style={{ background: tab === id ? 'var(--blue)' : `${color}33`, color: tab === id ? 'white' : color }}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Entity list */}
        <div className="p-4 min-h-[120px] max-h-72 overflow-y-auto">
          {isLoading && (
            <div className="space-y-2">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="h-8 rounded-lg bg-[var(--surface)] animate-pulse" />
              ))}
            </div>
          )}
          {!isLoading && data && data[tab].length === 0 && (
            <div className="flex flex-col items-center justify-center gap-2 py-6 text-[var(--text-muted)]">
              <span className="opacity-30">{USAGE_ENTITY_META.find((e) => e.id === tab)?.icon}</span>
              <p className="text-xs">No {USAGE_ENTITY_META.find((e) => e.id === tab)?.label.toLowerCase()} use this tag</p>
            </div>
          )}
          {!isLoading && data && data[tab].length > 0 && (
            <div className="space-y-1.5">
              {data[tab].map((item) => (
                <div
                  key={item.id}
                  className="flex items-center gap-3 px-3 py-2 rounded-lg border"
                  style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
                >
                  <span className="text-[var(--text-muted)] shrink-0">
                    {USAGE_ENTITY_META.find((e) => e.id === tab)?.icon}
                  </span>
                  <span className="text-sm text-[var(--text)] truncate">{item.name}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Tag pill ──────────────────────────────────────────────────────────────────

function TagPill({
  tag,
  categoryColor,
  onDelete,
  onRename,
}: {
  tag: WorkspaceTag;
  categoryColor: string;
  onDelete: () => void;
  onRename: (name: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(tag.name);
  const [usageModal, setUsageModal] = useState<EntityType | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const color = tag.color ?? categoryColor;

  function commit() {
    const trimmed = value.trim();
    if (trimmed && trimmed !== tag.name) onRename(trimmed);
    else setValue(tag.name);
    setEditing(false);
  }

  return (
    <>
      <div
        className="group flex items-center justify-between px-3 py-2 rounded-lg border hover:border-[var(--text-muted)] transition-colors"
        style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
      >
        {/* Left: color dot + name */}
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: color }} />
          {editing ? (
            <input
              ref={inputRef}
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commit();
                if (e.key === 'Escape') { setValue(tag.name); setEditing(false); }
              }}
              onBlur={commit}
              className="bg-transparent border-none outline-none text-sm w-28 text-[var(--text)]"
            />
          ) : (
            <span
              className="text-sm text-[var(--text)] cursor-pointer hover:text-[var(--blue)] transition-colors truncate"
              onClick={() => { setEditing(true); setValue(tag.name); }}
            >
              {tag.name}
            </span>
          )}
        </div>

        {/* Right: entity usage icons + delete */}
        <div className="flex items-center gap-1 shrink-0 ml-2">
          {ENTITY_OPTIONS.map(({ id, label, icon }) => {
            const count = tag.usage[id];
            return (
              <button
                key={id}
                type="button"
                title={count > 0 ? `Used in ${count} ${label.toLowerCase()}` : `Not used in ${label.toLowerCase()}`}
                disabled={count === 0}
                onClick={() => count > 0 && setUsageModal(id)}
                className={`w-5 h-5 rounded flex items-center justify-center text-[10px] transition-colors ${
                  count > 0
                    ? 'text-[var(--blue)] cursor-pointer hover:bg-[var(--blue)]/10'
                    : 'text-[var(--text-muted)] opacity-25 cursor-default'
                }`}
              >
                {icon}
              </button>
            );
          })}
          <button
            type="button"
            onClick={onDelete}
            className="w-5 h-5 rounded flex items-center justify-center text-[var(--text-muted)] opacity-0 group-hover:opacity-100 hover:text-[var(--danger)] transition-all ml-0.5"
          >
            <X size={12} />
          </button>
        </div>
      </div>

      {usageModal && (
        <TagUsageModal
          tag={tag}
          categoryColor={categoryColor}
          activeType={usageModal}
          onClose={() => setUsageModal(null)}
        />
      )}
    </>
  );
}

// ── Category card ──────────────────────────────────────────────────────────────

function CategoryCard({
  cat,
  onUpdateCategory,
  onDeleteCategory,
  onAddTag,
  onRenameTag,
  onDeleteTag,
}: {
  cat: TagCategory;
  onUpdateCategory: (id: string, data: Partial<Pick<TagCategory, 'name' | 'color' | 'availableFor'>>) => void;
  onDeleteCategory: (id: string) => void;
  onAddTag: (categoryId: string, name: string) => void;
  onRenameTag: (categoryId: string, tagId: string, name: string) => void;
  onDeleteTag: (categoryId: string, tagId: string) => void;
}) {
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState(cat.name);
  const [addingTag, setAddingTag] = useState(false);
  const [newTagName, setNewTagName] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const tagInputRef = useRef<HTMLInputElement>(null);

  function commitName() {
    const trimmed = nameValue.trim();
    if (trimmed && trimmed !== cat.name) onUpdateCategory(cat.id, { name: trimmed });
    else setNameValue(cat.name);
    setEditingName(false);
  }

  function toggleEntity(entity: EntityType) {
    const newSet = cat.availableFor.includes(entity)
      ? cat.availableFor.filter((e) => e !== entity)
      : [...cat.availableFor, entity];
    onUpdateCategory(cat.id, { availableFor: newSet });
  }

  function commitNewTag() {
    const trimmed = newTagName.trim();
    if (trimmed) {
      onAddTag(cat.id, trimmed);
      setNewTagName('');
    }
    setAddingTag(false);
  }

  return (
    <>
      <div
        className="rounded-2xl border overflow-hidden"
        style={{ borderColor: 'var(--card-border)', background: 'var(--card)' }}
      >
        {/* Category header */}
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-center gap-3 flex-1 min-w-0">
            {/* Color picker */}
            <ColorPicker
              value={cat.color}
              onChange={(c) => onUpdateCategory(cat.id, { color: c })}
            />

            {/* Category name */}
            {editingName ? (
              <input
                autoFocus
                value={nameValue}
                onChange={(e) => setNameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitName();
                  if (e.key === 'Escape') { setNameValue(cat.name); setEditingName(false); }
                }}
                onBlur={commitName}
                className="input text-sm font-semibold py-0.5 px-2 h-7 w-40"
              />
            ) : (
              <h3
                className="text-sm font-semibold text-[var(--text)] cursor-pointer hover:text-[var(--blue)] transition-colors"
                onClick={() => setEditingName(true)}
              >
                {cat.name}
              </h3>
            )}

            <Badge tone="neutral" className="text-[10px]">
              {cat.tags.length} {cat.tags.length === 1 ? 'tag' : 'tags'}
            </Badge>
          </div>

          {/* Available for + menu */}
          <div className="flex items-center gap-3 shrink-0">
            <div className="flex items-center gap-1">
              <span className="text-[10px] text-[var(--text-muted)] mr-1.5 hidden sm:block">Available for</span>
              {ENTITY_OPTIONS.map(({ id, label, icon }) => {
                const active = cat.availableFor.includes(id);
                return (
                  <button
                    key={id}
                    type="button"
                    title={label}
                    onClick={() => toggleEntity(id)}
                    className={`w-7 h-7 rounded-lg flex items-center justify-center border transition-colors ${
                      active
                        ? 'border-[var(--blue)] bg-[var(--blue)]/15 text-[var(--blue)]'
                        : 'border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)]'
                    }`}
                  >
                    {icon}
                  </button>
                );
              })}
            </div>

            {/* Category menu */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setMenuOpen((v) => !v)}
                className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface)] transition-colors border border-transparent hover:border-[var(--border)]"
              >
                <ChevronDown size={14} />
              </button>
              {menuOpen && (
                <div
                  className="absolute right-0 top-9 z-20 rounded-xl border py-1 min-w-[140px]"
                  style={{ background: 'var(--modal-bg)', borderColor: 'var(--card-border)' }}
                >
                  <button
                    type="button"
                    onClick={() => { setEditingName(true); setMenuOpen(false); }}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface)] transition-colors"
                  >
                    <Pencil size={12} /> Rename
                  </button>
                  <button
                    type="button"
                    onClick={() => { setConfirmDelete(true); setMenuOpen(false); }}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-[var(--danger)] hover:bg-[var(--surface)] transition-colors"
                  >
                    <Trash2 size={12} /> Delete
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Tags area — row list */}
        <div className="px-5 py-3 space-y-1.5">
          {/* Add tag button */}
          <button
            type="button"
            onClick={() => {
              setAddingTag(true);
              setTimeout(() => tagInputRef.current?.focus(), 50);
            }}
            className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs border border-dashed text-[var(--text-muted)] hover:text-[var(--text)] hover:border-[var(--text-muted)] transition-colors mb-1"
            style={{ borderColor: 'var(--border)' }}
          >
            <Plus size={10} /> Add tag
          </button>

          {/* Inline new tag input */}
          {addingTag && (
            <div
              className="flex items-center gap-2 px-3 py-2 rounded-lg border"
              style={{ borderColor: cat.color, background: `${cat.color}11` }}
            >
              <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: cat.color }} />
              <input
                ref={tagInputRef}
                value={newTagName}
                onChange={(e) => setNewTagName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitNewTag();
                  if (e.key === 'Escape') { setNewTagName(''); setAddingTag(false); }
                }}
                onBlur={commitNewTag}
                placeholder="Tag name…"
                className="bg-transparent border-none outline-none text-sm text-[var(--text)] w-full"
              />
            </div>
          )}

          {/* Existing tags */}
          {cat.tags.map((tag) => (
            <TagPill
              key={tag.id}
              tag={tag}
              categoryColor={cat.color}
              onDelete={() => onDeleteTag(cat.id, tag.id)}
              onRename={(name) => onRenameTag(cat.id, tag.id, name)}
            />
          ))}

          {cat.tags.length === 0 && !addingTag && (
            <span className="text-xs text-[var(--text-muted)] px-1">No tags yet — click "Add tag" to start</span>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title={`Delete "${cat.name}"?`}
        message={`This will permanently delete the category and all ${cat.tags.length} tag${cat.tags.length !== 1 ? 's' : ''} within it.`}
        confirmLabel="Delete Category"
        variant="danger"
        onConfirm={() => { onDeleteCategory(cat.id); setConfirmDelete(false); }}
        onClose={() => setConfirmDelete(false)}
      />
    </>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function TagsPage() {
  const { wsId } = useParams<{ wsId: string }>();
  const qc = useQueryClient();
  const [showAddCategory, setShowAddCategory] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [newCatColor, setNewCatColor] = useState('#6366f1');

  const { data: categories = [], isLoading } = useQuery<TagCategory[]>({
    queryKey: ['tags', wsId],
    queryFn: () => api.get(`/tags?workspaceId=${wsId}`),
    enabled: !!wsId,
  });

  const totalTags = categories.reduce((s, c) => s + c.tags.length, 0);

  function invalidate() {
    void qc.invalidateQueries({ queryKey: ['tags', wsId] });
  }

  // ── Category mutations ─────────────────────────────────────────────────────

  const createCategory = useMutation({
    mutationFn: (data: { name: string; color: string; availableFor: EntityType[] }) =>
      api.post('/tags/categories', { workspaceId: wsId, ...data }),
    onSuccess: () => { toast.success('Category created'); invalidate(); },
    onError: () => toast.error('Failed to create category'),
  });

  const updateCategory = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Pick<TagCategory, 'name' | 'color' | 'availableFor'>> }) =>
      api.patch(`/tags/categories/${id}`, data),
    onSuccess: () => invalidate(),
    onError: () => toast.error('Failed to update category'),
  });

  const deleteCategory = useMutation({
    mutationFn: (id: string) => api.delete(`/tags/categories/${id}`),
    onSuccess: () => { toast.success('Category deleted'); invalidate(); },
    onError: () => toast.error('Failed to delete category'),
  });

  // ── Tag mutations ──────────────────────────────────────────────────────────

  const addTag = useMutation({
    mutationFn: ({ categoryId, name }: { categoryId: string; name: string }) =>
      api.post(`/tags/categories/${categoryId}/tags`, { name }),
    onSuccess: () => invalidate(),
    onError: () => toast.error('Failed to add tag'),
  });

  const renameTag = useMutation({
    mutationFn: ({ categoryId, tagId, name }: { categoryId: string; tagId: string; name: string }) =>
      api.patch(`/tags/categories/${categoryId}/tags/${tagId}`, { name }),
    onSuccess: () => invalidate(),
    onError: () => toast.error('Failed to rename tag'),
  });

  const deleteTag = useMutation({
    mutationFn: ({ categoryId, tagId }: { categoryId: string; tagId: string }) =>
      api.delete(`/tags/categories/${categoryId}/tags/${tagId}`),
    onSuccess: () => invalidate(),
    onError: () => toast.error('Failed to delete tag'),
  });

  // ── Add category form submit ───────────────────────────────────────────────

  function handleCreateCategory() {
    const trimmed = newCatName.trim();
    if (!trimmed) return;
    createCategory.mutate({ name: trimmed, color: newCatColor, availableFor: [] });
    setNewCatName('');
    setNewCatColor('#6366f1');
    setShowAddCategory(false);
  }

  return (
    <div className="h-full overflow-y-auto bg-[var(--surface)]">
      <div className="p-8 max-w-4xl mx-auto">
        <PageHeader
          icon={<Tag size={22} />}
          title="Tags"
          subtitle={
            categories.length > 0
              ? `${categories.length} ${categories.length === 1 ? 'category' : 'categories'} · ${totalTags} tags`
              : 'Organise your content, playlists, schedules and devices with tags'
          }
          action={
            <ActionButton
              tone="primary"
              onClick={() => setShowAddCategory(true)}
            >
              <Plus size={14} className="mr-1" />
              Add Category
            </ActionButton>
          }
        />

        {/* Add category inline form */}
        {showAddCategory && (
          <div
            className="mb-5 rounded-2xl border p-5"
            style={{ borderColor: 'var(--card-border)', background: 'var(--card)' }}
          >
            <p className="text-sm font-semibold mb-4 text-[var(--text)]">New Category</p>
            <div className="flex items-center gap-3">
              <ColorPicker value={newCatColor} onChange={setNewCatColor} />
              <input
                autoFocus
                value={newCatName}
                onChange={(e) => setNewCatName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreateCategory();
                  if (e.key === 'Escape') { setShowAddCategory(false); setNewCatName(''); }
                }}
                placeholder="Category name…"
                className="input flex-1"
              />
              <ActionButton
                tone="primary"
                onClick={handleCreateCategory}
                disabled={!newCatName.trim() || createCategory.isPending}
              >
                <Check size={14} className="mr-1" />
                Create
              </ActionButton>
              <button
                type="button"
                onClick={() => { setShowAddCategory(false); setNewCatName(''); }}
                className="text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
              >
                <X size={16} />
              </button>
            </div>
          </div>
        )}

        {/* Loading */}
        {isLoading && (
          <div className="space-y-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-28 rounded-2xl bg-[var(--card)] border border-[var(--border)] animate-pulse" />
            ))}
          </div>
        )}

        {/* Empty state */}
        {!isLoading && categories.length === 0 && (
          <EmptyState
            icon={<Tag size={32} />}
            title="No tag categories yet"
            description="Create your first category to start organising content, playlists, schedules, and devices."
            action={
              <ActionButton tone="primary" onClick={() => setShowAddCategory(true)}>
                <Plus size={14} className="mr-1" />
                Add Category
              </ActionButton>
            }
          />
        )}

        {/* Category list */}
        {!isLoading && categories.length > 0 && (
          <div className="space-y-4">
            {categories.map((cat) => (
              <CategoryCard
                key={cat.id}
                cat={cat}
                onUpdateCategory={(id, data) => updateCategory.mutate({ id, data })}
                onDeleteCategory={(id) => deleteCategory.mutate(id)}
                onAddTag={(categoryId, name) => addTag.mutate({ categoryId, name })}
                onRenameTag={(categoryId, tagId, name) => renameTag.mutate({ categoryId, tagId, name })}
                onDeleteTag={(categoryId, tagId) => deleteTag.mutate({ categoryId, tagId })}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
