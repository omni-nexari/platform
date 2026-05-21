import { useState, useMemo, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, ChevronLeft, ChevronRight, ImageIcon, Palette, Type as TypeIcon, Layout as LayoutIcon, Settings as SettingsIcon, Monitor, Film, RefreshCw, Tv2, UploadCloud, SlidersHorizontal } from 'lucide-react';
import { api } from '../../lib/api.js';
import MenuBoardCanvas, { MenuBoardLayoutThumbnail, type MenuBoardCanvasMenu } from './MenuBoardCanvas.js';
import {
  applyTheme,
  DEFAULT_MENU_BOARD_CONFIG,
  MENU_BOARD_CATEGORY_STYLES,
  MENU_BOARD_FONTS,
  MENU_BOARD_LAYOUTS,
  MENU_BOARD_THEMES,
  type MenuBoardConfig,
  type MenuBoardLayoutId,
  type MenuBoardThemeId,
  type ScreenSelectionMode,
  type SplitStrategy,
  type PaginationMode,
} from './menuBoardConfig.js';
import { shardSections } from './menuBoardShard.js';

interface Workspace { id: string; name: string; slug: string }

export interface MenuBoardWizardState {
  name: string;
  duration: number;
  config: MenuBoardConfig;
  /** Pending background image file to upload on submit (base64 data URL for preview). */
  pendingBgFile?: File | null;
  /** Sibling count — how many extra content items to auto-create (siblings mode). */
  siblingCount?: number;
}

interface Props {
  /** Defaults to filling in DEFAULT_MENU_BOARD_CONFIG with the workspace id from props. */
  initial?: Partial<MenuBoardWizardState>;
  defaultPosWorkspaceId: string;
  /** Whether to show the "Name" + "POS source" basics step. */
  showBasicsStep?: boolean;
  onCancel: () => void;
  onSubmit: (state: MenuBoardWizardState) => void;
  submitLabel?: string;
  isSubmitting?: boolean;
  title: string;
}

type StepId = 'basics' | 'layout' | 'screens' | 'theme' | 'options' | 'pagination' | 'customize';

interface StepDef {
  id: StepId;
  label: string;
  icon: React.ReactNode;
}

export default function MenuBoardWizard({
  initial,
  defaultPosWorkspaceId,
  showBasicsStep = true,
  onCancel,
  onSubmit,
  submitLabel = 'Create Menu Board',
  isSubmitting = false,
  title,
}: Props) {
  const [name, setName] = useState(initial?.name ?? '');
  const [duration, setDuration] = useState(initial?.duration ?? 30);
  const [config, setConfig] = useState<MenuBoardConfig>({
    ...DEFAULT_MENU_BOARD_CONFIG,
    posWorkspaceId: defaultPosWorkspaceId,
    ...initial?.config,
  });
  const [pendingBgFile, setPendingBgFile] = useState<File | null>(null);
  const [bgPreviewUrl, setBgPreviewUrl] = useState<string | null>(null);
  const bgFileRef = useRef<HTMLInputElement>(null);
  const heroFileRef = useRef<HTMLInputElement>(null);

  // Step list (basics is conditional).
  const STEPS: StepDef[] = useMemo(() => {
    const arr: StepDef[] = [];
    if (showBasicsStep) arr.push({ id: 'basics',     label: 'Basics',      icon: <SettingsIcon size={14} /> });
    arr.push({ id: 'layout',     label: 'Layout',      icon: <LayoutIcon size={14} /> });
    arr.push({ id: 'screens',    label: 'Screens',     icon: <Monitor size={14} /> });
    arr.push({ id: 'theme',      label: 'Style',       icon: <Palette size={14} /> });
    arr.push({ id: 'options',    label: 'Options',     icon: <TypeIcon size={14} /> });
    arr.push({ id: 'pagination', label: 'Pagination',  icon: <SlidersHorizontal size={14} /> });
    arr.push({ id: 'customize',  label: 'Customize',   icon: <ImageIcon size={14} /> });
    return arr;
  }, [showBasicsStep]);

  const [stepIdx, setStepIdx] = useState(0);
  const currentStep = STEPS[stepIdx]!;

  const { data: workspaces = [] } = useQuery<Workspace[]>({
    queryKey: ['workspaces'],
    queryFn: () => api.get('/workspaces'),
  });

  const { data: menu } = useQuery<MenuBoardCanvasMenu>({
    queryKey: ['pos-menu-preview', config.posWorkspaceId],
    queryFn: () => api.get(`/pos/menu?workspaceId=${config.posWorkspaceId}`),
    enabled: !!config.posWorkspaceId,
    staleTime: 30_000,
  });

  // When the user edits the colors directly, mark theme as 'custom' so the picker
  // doesn't visually claim the active preset is still selected.
  useEffect(() => {
    const t = MENU_BOARD_THEMES.find((x) => x.id === config.theme);
    if (!t) return;
    if (t.background !== config.backgroundColor || t.text !== config.textColor || t.accent !== config.accentColor) {
      setConfig((c) => ({ ...c, theme: 'custom' }));
    }
  }, [config.backgroundColor, config.textColor, config.accentColor, config.theme]);

  function patch(p: Partial<MenuBoardConfig>) {
    setConfig((c) => ({ ...c, ...p }));
  }

  /** Handle background image file selection — creates a preview data URL. */
  function handleBgFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setPendingBgFile(file);
    if (file) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const result = ev.target?.result as string | null;
        setBgPreviewUrl(result);
        patch({ backgroundImage: result }); // temporary data URL for preview
      };
      reader.readAsDataURL(file);
    } else {
      setBgPreviewUrl(null);
    }
  }

  function handleHeroFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const result = ev.target?.result as string | null;
      patch({ heroImageUrl: result ?? null });
    };
    reader.readAsDataURL(file);
  }

  function next() {
    if (stepIdx < STEPS.length - 1) setStepIdx((i) => i + 1);
    else handleFinish();
  }
  function back() {
    if (stepIdx > 0) setStepIdx((i) => i - 1);
  }

  const canAdvance = (() => {
    if (currentStep.id === 'basics') return name.trim().length > 0 && !!config.posWorkspaceId;
    return true;
  })();

  function handleFinish() {
    if (showBasicsStep && !name.trim()) return;
    onSubmit({ name: name.trim(), duration, config, pendingBgFile, siblingCount: config.screenSelection === 'siblings' ? config.screenCount - 1 : 0 });
  }

  /* ── Step renderers ──────────────────────────────────────────────────── */

  const basicsStep = (
    <div className="flex flex-col gap-4">
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-[var(--text-muted)]">Menu board name *</span>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Lunch Menu Board"
          className="input"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-[var(--text-muted)]">POS workspace (menu source)</span>
        <select
          value={config.posWorkspaceId}
          onChange={(e) => patch({ posWorkspaceId: e.target.value })}
          className="input"
        >
          <option value="" disabled>Select a workspace…</option>
          {workspaces.map((ws) => (
            <option key={ws.id} value={ws.id}>{ws.name}</option>
          ))}
        </select>
        <p className="text-[11px] text-[var(--text-muted)]">The live POS menu from this workspace will be displayed.</p>
      </label>

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
    </div>
  );

  const layoutStep = (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-[var(--text-muted)]">Pick a starting layout. You can fine-tune everything in the next steps.</p>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {MENU_BOARD_LAYOUTS.map((l) => {
          const selected = config.layout === l.id;
          return (
            <button
              key={l.id}
              type="button"
              onClick={() => patch({ layout: l.id as MenuBoardLayoutId })}
              className={`flex flex-col gap-2 p-2 rounded-lg border text-left transition-colors ${
                selected
                  ? 'border-[var(--accent)] bg-[var(--accent)]/10'
                  : 'border-[var(--border)] hover:border-[var(--text-muted)]'
              }`}
            >
              <MenuBoardLayoutThumbnail layout={l.id} accent={config.accentColor} selected={selected} />
              <div className="flex items-center gap-1">
                <span className={`text-xs font-semibold ${selected ? 'text-[var(--accent)]' : 'text-[var(--text)]'}`}>{l.label}</span>
                {selected && <Check size={12} className="text-[var(--accent)]" />}
              </div>
              <span className="text-[10px] text-[var(--text-muted)] leading-tight">{l.description}</span>
            </button>
          );
        })}
      </div>
    </div>
  );

  const themeStep = (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <span className="text-xs font-medium text-[var(--text-muted)]">Theme presets</span>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {MENU_BOARD_THEMES.map((t) => {
            const selected = config.theme === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setConfig((c) => applyTheme(c, t.id as MenuBoardThemeId))}
                className={`flex flex-col gap-1.5 p-2 rounded-lg border text-left transition-colors ${
                  selected ? 'border-[var(--accent)]' : 'border-[var(--border)] hover:border-[var(--text-muted)]'
                }`}
              >
                <div className="flex items-center gap-1 h-6 rounded" style={{ background: t.background, padding: 4 }}>
                  <span className="w-2 h-2 rounded-full" style={{ background: t.accent }} />
                  <span className="text-[8px] font-semibold uppercase tracking-wide truncate" style={{ color: t.text }}>
                    {t.label}
                  </span>
                </div>
                <span className={`text-[11px] ${selected ? 'text-[var(--accent)] font-semibold' : 'text-[var(--text-muted)]'}`}>
                  {t.label}
                </span>
              </button>
            );
          })}
          {config.theme === 'custom' && (
            <div className="flex flex-col gap-1.5 p-2 rounded-lg border border-[var(--accent)]">
              <div className="flex items-center gap-1 h-6 rounded" style={{ background: config.backgroundColor, padding: 4 }}>
                <span className="w-2 h-2 rounded-full" style={{ background: config.accentColor }} />
                <span className="text-[8px] font-semibold uppercase tracking-wide truncate" style={{ color: config.textColor }}>Custom</span>
              </div>
              <span className="text-[11px] text-[var(--accent)] font-semibold">Custom</span>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <ColorField label="Background" value={config.backgroundColor} onChange={(v) => patch({ backgroundColor: v })} />
        <ColorField label="Text"       value={config.textColor}       onChange={(v) => patch({ textColor: v })} />
        <ColorField label="Accent"     value={config.accentColor}     onChange={(v) => patch({ accentColor: v })} />
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-[var(--text-muted)] flex items-center gap-1.5">
          <ImageIcon size={12} /> Background image URL (optional)
        </span>
        <input
          type="url"
          value={config.backgroundImage ?? ''}
          onChange={(e) => patch({ backgroundImage: e.target.value || null })}
          placeholder="https://example.com/wood-texture.jpg"
          className="input"
        />
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-[var(--text-muted)]">Font family</span>
          <select
            value={config.fontFamily}
            onChange={(e) => patch({ fontFamily: e.target.value as MenuBoardConfig['fontFamily'] })}
            className="input"
          >
            {MENU_BOARD_FONTS.map((f) => (
              <option key={f.id} value={f.id}>{f.label}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-[var(--text-muted)]">Category header</span>
          <select
            value={config.categoryHeaderStyle}
            onChange={(e) => patch({ categoryHeaderStyle: e.target.value as MenuBoardConfig['categoryHeaderStyle'] })}
            className="input"
          >
            {MENU_BOARD_CATEGORY_STYLES.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
        </label>
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-[var(--text-muted)]">
          Font scale: {Math.round(config.fontScale * 100)}%
        </span>
        <input
          type="range"
          min={0.7}
          max={1.5}
          step={0.05}
          value={config.fontScale}
          onChange={(e) => patch({ fontScale: parseFloat(e.target.value) })}
          className="accent-[var(--accent)]"
        />
      </label>
    </div>
  );

  const optionsStep = (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <span className="text-xs font-medium text-[var(--text-muted)]">Display options</span>
        <div className="rounded-lg border border-[var(--border)] divide-y divide-[var(--border)]">
          <ToggleRow label="Show header"      checked={config.showHeader}      onChange={(v) => patch({ showHeader: v })} />
          <ToggleRow label="Show prices"      checked={config.showPrices}      onChange={(v) => patch({ showPrices: v })} />
          <ToggleRow label="Show item images" checked={config.showImages}      onChange={(v) => patch({ showImages: v })} />
          <ToggleRow label="Show description" checked={config.showDescription} onChange={(v) => patch({ showDescription: v })} />
        </div>
      </div>

      {config.showHeader && (
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-[var(--text-muted)]">Header eyebrow</span>
            <input
              type="text"
              value={config.eyebrow ?? ''}
              onChange={(e) => patch({ eyebrow: e.target.value || null })}
              placeholder="Live POS Menu"
              className="input"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-[var(--text-muted)]">Title override</span>
            <input
              type="text"
              value={config.titleOverride ?? ''}
              onChange={(e) => patch({ titleOverride: e.target.value || null })}
              placeholder="Use menu board name"
              className="input"
            />
          </label>
        </div>
      )}
    </div>
  );

  /* ── Screens step ──────────────────────────────────────────────────── */
  const screensStep = (
    <div className="flex flex-col gap-5">
      <p className="text-xs text-[var(--text-muted)]">
        Set up your restaurant's display wall. Each screen shows a slice of the menu.
      </p>

      {/* Screen count */}
      <div className="flex flex-col gap-2">
        <span className="text-xs font-medium text-[var(--text-muted)]">Number of screens</span>
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => patch({ screenCount: Math.max(1, config.screenCount - 1) })}
            className="w-8 h-8 rounded-lg border border-[var(--border)] flex items-center justify-center text-lg font-bold text-[var(--text)] hover:bg-[var(--surface-raised)]">
            −
          </button>
          <span className="text-2xl font-bold text-[var(--accent)] w-8 text-center">{config.screenCount}</span>
          <button type="button" onClick={() => patch({ screenCount: Math.min(6, config.screenCount + 1) })}
            className="w-8 h-8 rounded-lg border border-[var(--border)] flex items-center justify-center text-lg font-bold text-[var(--text)] hover:bg-[var(--surface-raised)]">
            +
          </button>
          <span className="text-xs text-[var(--text-muted)] ml-1">(max 6)</span>
        </div>
        {/* TV wall diagram */}
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          {Array.from({ length: config.screenCount }, (_, i) => (
            <div key={i} className="flex flex-col items-center gap-1">
              <div className="w-16 h-10 rounded border-2 border-[var(--accent)] bg-[var(--surface-raised)] flex items-center justify-center">
                <Tv2 size={16} className="text-[var(--accent)]" />
              </div>
              <span className="text-[10px] text-[var(--text-muted)]">Screen {i + 1}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Screen selection strategy */}
      <div className="flex flex-col gap-2">
        <span className="text-xs font-medium text-[var(--text-muted)]">How does each TV know which slice to show?</span>
        {(
          [
            { id: 'playlist',  label: 'Playlist assignment', hint: 'When adding to a device playlist, pick "Screen X of N". Best for flexibility.' },
            { id: 'siblings',  label: 'Auto-generate per-screen items', hint: 'Wizard creates a separate content item per screen (e.g. Board – Screen 2). Assign each to its TV.' },
            { id: 'device',    label: 'Device screen-index setting', hint: 'Each device has a "Display Index" setting. The board auto-shards based on that. Best for dedicated walls.' },
            { id: 'cycle',     label: 'All screens cycle through all slices', hint: 'Every TV shows all slices as rotating pages — no splitting, just pagination everywhere.' },
          ] as { id: ScreenSelectionMode; label: string; hint: string }[]
        ).map((opt) => (
          <label key={opt.id} className={`flex items-start gap-2.5 p-3 rounded-lg border cursor-pointer transition-colors ${config.screenSelection === opt.id ? 'border-[var(--accent)] bg-[var(--accent)]/10' : 'border-[var(--border)] hover:border-[var(--text-muted)]'}`}>
            <input type="radio" name="screenSelection" value={opt.id}
              checked={config.screenSelection === opt.id}
              onChange={() => patch({ screenSelection: opt.id })}
              className="mt-0.5 accent-[var(--accent)]" />
            <div>
              <div className="text-sm font-medium text-[var(--text)]">{opt.label}</div>
              <div className="text-xs text-[var(--text-muted)]">{opt.hint}</div>
            </div>
          </label>
        ))}
      </div>

      {/* Split strategy (only when screenCount > 1 and not cycle) */}
      {config.screenCount > 1 && config.screenSelection !== 'cycle' && (
        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium text-[var(--text-muted)]">How to split content across screens</span>
          {(
            [
              { id: 'by-category',         label: 'By category (recommended)', hint: 'Whole categories are assigned to screens round-robin. Categories stay intact.' },
              { id: 'by-item-roundrobin',  label: 'Items round-robin', hint: 'Individual items are distributed evenly across screens. Categories may be split.' },
              { id: 'by-item-sequential',  label: 'Items sequential', hint: 'Items are grouped into contiguous blocks per screen. Screen 1 gets the first N items, etc.' },
            ] as { id: SplitStrategy; label: string; hint: string }[]
          ).map((opt) => (
            <label key={opt.id} className={`flex items-start gap-2.5 p-2.5 rounded-lg border cursor-pointer transition-colors ${config.splitStrategy === opt.id ? 'border-[var(--accent)] bg-[var(--accent)]/10' : 'border-[var(--border)] hover:border-[var(--text-muted)]'}`}>
              <input type="radio" name="splitStrategy" value={opt.id}
                checked={config.splitStrategy === opt.id}
                onChange={() => patch({ splitStrategy: opt.id })}
                className="mt-0.5 accent-[var(--accent)]" />
              <div>
                <div className="text-xs font-medium text-[var(--text)]">{opt.label}</div>
                <div className="text-[11px] text-[var(--text-muted)]">{opt.hint}</div>
              </div>
            </label>
          ))}
        </div>
      )}
    </div>
  );

  /* ── Pagination step ───────────────────────────────────────────────── */
  const paginationStep = (
    <div className="flex flex-col gap-5">
      <p className="text-xs text-[var(--text-muted)]">
        When a screen has more items than fit comfortably, pages are created and automatically cycled.
      </p>

      {/* Pagination mode */}
      <div className="flex flex-col gap-2">
        <span className="text-xs font-medium text-[var(--text-muted)]">Page-sizing method</span>
        {(
          [
            { id: 'user-cap',  label: 'Fixed cap', hint: 'Always paginate when items exceed the cap you set below. Predictable.' },
            { id: 'auto-fit',  label: 'Auto-fit', hint: 'Renderer measures overflow and automatically paginates. Best for variable content but less predictable on older hardware.' },
            { id: 'hybrid',    label: 'Hybrid (recommended)', hint: 'User-set cap as a safety net; renderer further trims if content overflows.' },
          ] as { id: PaginationMode; label: string; hint: string }[]
        ).map((opt) => (
          <label key={opt.id} className={`flex items-start gap-2.5 p-3 rounded-lg border cursor-pointer transition-colors ${config.pagination.mode === opt.id ? 'border-[var(--accent)] bg-[var(--accent)]/10' : 'border-[var(--border)] hover:border-[var(--text-muted)]'}`}>
            <input type="radio" name="paginationMode" value={opt.id}
              checked={config.pagination.mode === opt.id}
              onChange={() => patch({ pagination: { ...config.pagination, mode: opt.id } })}
              className="mt-0.5 accent-[var(--accent)]" />
            <div>
              <div className="text-sm font-medium text-[var(--text)]">{opt.label}</div>
              <div className="text-xs text-[var(--text-muted)]">{opt.hint}</div>
            </div>
          </label>
        ))}
      </div>

      {config.pagination.mode !== 'auto-fit' && (
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-[var(--text-muted)]">Max items per page</span>
          <input type="number" min={2} max={40} value={config.pagination.itemsPerPage}
            onChange={(e) => patch({ pagination: { ...config.pagination, itemsPerPage: Math.max(2, parseInt(e.target.value) || 8) } })}
            className="input w-28" />
          <p className="text-[11px] text-[var(--text-muted)]">Items are counted across all categories on the page.</p>
        </label>
      )}

      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-[var(--text-muted)]">
          <RefreshCw size={11} className="inline mr-1" />
          Seconds per page
        </span>
        <input type="number" min={2} max={120} value={config.pagination.pageSeconds}
          onChange={(e) => patch({ pagination: { ...config.pagination, pageSeconds: Math.max(2, parseInt(e.target.value) || 10) } })}
          className="input w-28" />
        <p className="text-[11px] text-[var(--text-muted)]">How long each page is shown before cycling to the next.</p>
      </label>
    </div>
  );

  /* ── Customize step ────────────────────────────────────────────────── */
  const customizeStep = (
    <div className="flex flex-col gap-5">
      <p className="text-xs text-[var(--text-muted)]">
        Upload or link media to personalise this board. Use the{' '}
        <span className="text-[var(--accent)] font-semibold">Media Library</span> (POS → Media) to manage all your images and videos.
      </p>

      {/* Background image */}
      <div className="flex flex-col gap-2">
        <span className="text-xs font-medium text-[var(--text-muted)] flex items-center gap-1.5">
          <ImageIcon size={12} /> Background image
        </span>
        {/* Drop zone */}
        <div
          className="relative flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-[var(--border)] p-5 cursor-pointer hover:border-[var(--accent)] transition-colors"
          onClick={() => bgFileRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const file = e.dataTransfer.files[0];
            if (file && file.type.startsWith('image/')) {
              const fakeEvent = { target: { files: [file] } } as unknown as React.ChangeEvent<HTMLInputElement>;
              handleBgFileChange(fakeEvent);
            }
          }}
        >
          {bgPreviewUrl ? (
            <img src={bgPreviewUrl} alt="background preview" className="max-h-24 rounded object-cover" />
          ) : config.backgroundImage ? (
            <img src={config.backgroundImage} alt="background" className="max-h-24 rounded object-cover" />
          ) : (
            <>
              <UploadCloud size={22} className="text-[var(--text-muted)]" />
              <span className="text-xs text-[var(--text-muted)]">Drag & drop or click to upload an image</span>
            </>
          )}
          <input ref={bgFileRef} type="file" accept="image/*" className="hidden" onChange={handleBgFileChange} />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-[var(--text-muted)]">or paste URL</span>
          <input type="url" value={config.backgroundImage ?? ''} onChange={(e) => { patch({ backgroundImage: e.target.value || null }); setBgPreviewUrl(null); setPendingBgFile(null); }}
            placeholder="https://example.com/bg.jpg" className="input flex-1 text-xs" />
          {(config.backgroundImage || bgPreviewUrl) && (
            <button type="button" onClick={() => { patch({ backgroundImage: null }); setBgPreviewUrl(null); setPendingBgFile(null); }}
              className="text-[var(--text-muted)] hover:text-[var(--text)] text-xs px-2">
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Background video */}
      <div className="flex flex-col gap-2">
        <span className="text-xs font-medium text-[var(--text-muted)] flex items-center gap-1.5">
          <Film size={12} /> Background video (URL)
        </span>
        <input type="url" value={config.backgroundVideoUrl ?? ''} onChange={(e) => patch({ backgroundVideoUrl: e.target.value || null })}
          placeholder="https://example.com/loop.mp4" className="input text-xs" />
        <p className="text-[11px] text-[var(--text-muted)]">Plays silently in a loop behind the menu. Overrides background image when set.</p>
      </div>

      {/* Hero / featured image */}
      {(['featured', 'hero-banner', 'magazine'] as MenuBoardLayoutId[]).includes(config.layout) && (
        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium text-[var(--text-muted)] flex items-center gap-1.5">
            <ImageIcon size={12} /> Featured / hero image
          </span>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => heroFileRef.current?.click()}
              className="ui-btn-secondary text-xs flex items-center gap-1.5">
              <UploadCloud size={13} /> Upload
            </button>
            <input type="url" value={config.heroImageUrl ?? ''} onChange={(e) => patch({ heroImageUrl: e.target.value || null })}
              placeholder="https://example.com/hero.jpg" className="input flex-1 text-xs" />
            {config.heroImageUrl && (
              <button type="button" onClick={() => patch({ heroImageUrl: null })} className="text-[var(--text-muted)] hover:text-[var(--text)] text-xs px-2">Clear</button>
            )}
          </div>
          {config.heroImageUrl && (
            <img src={config.heroImageUrl} alt="hero preview" className="max-h-20 rounded object-cover mt-1" />
          )}
          <input ref={heroFileRef} type="file" accept="image/*" className="hidden" onChange={handleHeroFileChange} />
          <p className="text-[11px] text-[var(--text-muted)]">Overrides the first item photo in the featured panel.</p>
        </div>
      )}

      {/* Category filter */}
      {menu && menu.categories.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium text-[var(--text-muted)]">Show only these categories (leave blank for all)</span>
          <div className="flex flex-wrap gap-2">
            {menu.categories.map((cat) => {
              const active = config.categoryIds.length === 0 || config.categoryIds.includes(cat.id);
              return (
                <button key={cat.id} type="button"
                  onClick={() => {
                    const all = config.categoryIds.length === 0 ? menu.categories.map((c) => c.id) : [...config.categoryIds];
                    const next = active ? all.filter((id) => id !== cat.id) : [...all, cat.id];
                    patch({ categoryIds: next.length === menu.categories.length ? [] : next });
                  }}
                  className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${active ? 'border-[var(--accent)] bg-[var(--accent)]/15 text-[var(--accent)]' : 'border-[var(--border)] text-[var(--text-muted)]'}`}
                >
                  {cat.name}
                </button>
              );
            })}
          </div>
          <p className="text-[11px] text-[var(--text-muted)]">
            {config.categoryIds.length === 0 ? 'All categories shown' : `${config.categoryIds.length} of ${menu.categories.length} selected`}
          </p>
        </div>
      )}
    </div>
  );

  /* ── Layout (sidebar steps + preview) ───────────────────────────────── */

  return (
    <div className="flex flex-col h-full">
      {/* Step indicator */}
      <div className="flex items-center gap-1 px-4 pt-1 pb-3 border-b border-[var(--border)]">
        {STEPS.map((s, i) => {
          const active = i === stepIdx;
          const done = i < stepIdx;
          return (
            <div key={s.id} className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setStepIdx(i)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs transition-colors ${
                  active ? 'bg-[var(--accent)]/15 text-[var(--accent)] font-semibold'
                  : done ? 'text-[var(--text)]'
                  : 'text-[var(--text-muted)] hover:text-[var(--text)]'
                }`}
              >
                <span className={`flex items-center justify-center w-4 h-4 rounded-full text-[9px] ${
                  active ? 'bg-[var(--accent)] text-white'
                  : done ? 'bg-[var(--accent)]/30 text-[var(--accent)]'
                  : 'bg-[var(--surface-raised)] text-[var(--text-muted)]'
                }`}>
                  {done ? <Check size={10} /> : i + 1}
                </span>
                {s.label}
              </button>
              {i < STEPS.length - 1 && <ChevronRight size={12} className="text-[var(--text-muted)]" />}
            </div>
          );
        })}
      </div>

      <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(280px,420px)]">
        {/* Step body */}
        <div className="overflow-y-auto p-4">
          {currentStep.id === 'basics'     && basicsStep}
          {currentStep.id === 'layout'     && layoutStep}
          {currentStep.id === 'screens'    && screensStep}
          {currentStep.id === 'theme'      && themeStep}
          {currentStep.id === 'options'    && optionsStep}
          {currentStep.id === 'pagination' && paginationStep}
          {currentStep.id === 'customize'  && customizeStep}
        </div>

        {/* Live preview */}
        <div className="border-l border-[var(--border)] bg-[var(--surface-raised)] flex flex-col p-4 gap-2">
          <span className="text-[10px] uppercase tracking-wide text-[var(--text-muted)] font-semibold">Live Preview</span>
          {/* Multi-screen preview: show N small canvases when on the screens step */}
          {currentStep.id === 'screens' && config.screenCount > 1 ? (
            <div className="flex-1 min-h-[260px] flex flex-col gap-2 overflow-y-auto">
              {Array.from({ length: config.screenCount }, (_, i) => {
                const shardedMenu = menu ? {
                  ...menu,
                  categories: shardSections(
                    menu.categories.map((c) => ({ ...c, items: c.items ?? [] })),
                    config.screenCount, i, config.splitStrategy,
                  ) as typeof menu.categories,
                } : null;
                return (
                  <div key={i} className="flex flex-col gap-1">
                    <span className="text-[9px] text-[var(--text-muted)] font-semibold uppercase">Screen {i + 1}</span>
                    <div className="rounded-lg overflow-hidden border border-[var(--border)] shadow-inner" style={{ minHeight: 80 }}>
                      <MenuBoardCanvas config={config} menu={shardedMenu ?? null} density="xs" fallbackTitle={name || 'Menu Board'} placeholder />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex-1 min-h-[260px] rounded-lg overflow-hidden border border-[var(--border)] shadow-inner">
              <MenuBoardCanvas
                config={config}
                menu={menu ?? null}
                density="sm"
                fallbackTitle={name || 'Menu Board'}
                placeholder
              />
            </div>
          )}
          <p className="text-[10px] text-[var(--text-muted)] leading-tight">
            Preview uses live POS data when a workspace is selected.
          </p>
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-4 py-3 border-t border-[var(--border)] gap-2">
        <button onClick={onCancel} className="ui-btn-secondary">Cancel</button>
        <div className="flex items-center gap-2">
          {stepIdx > 0 && (
            <button onClick={back} className="ui-btn-secondary flex items-center gap-1">
              <ChevronLeft size={14} /> Back
            </button>
          )}
          {stepIdx < STEPS.length - 1 ? (
            <button
              onClick={next}
              disabled={!canAdvance}
              className="ui-btn-primary flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Next <ChevronRight size={14} />
            </button>
          ) : (
            <button
              onClick={handleFinish}
              disabled={isSubmitting || (showBasicsStep && (!name.trim() || !config.posWorkspaceId))}
              className="ui-btn-primary disabled:opacity-50"
            >
              {isSubmitting ? 'Saving…' : submitLabel}
            </button>
          )}
        </div>
      </div>

      <span className="hidden">{title}</span>
    </div>
  );
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-[var(--text-muted)]">{label}</span>
      <div className="flex items-center gap-1">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-8 h-8 rounded border border-[var(--border)] bg-transparent cursor-pointer"
        />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="input flex-1 font-mono text-xs"
        />
      </div>
    </label>
  );
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between px-3 py-2.5 cursor-pointer hover:bg-[var(--surface-raised)] transition-colors">
      <span className="text-sm text-[var(--text)]">{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-[var(--accent)]"
      />
    </label>
  );
}
