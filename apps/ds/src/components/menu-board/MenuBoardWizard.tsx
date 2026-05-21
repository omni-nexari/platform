import { useState, useMemo, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, ChevronLeft, ChevronRight, ImageIcon, Palette, Type as TypeIcon, Layout as LayoutIcon, Settings as SettingsIcon } from 'lucide-react';
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
} from './menuBoardConfig.js';

interface Workspace { id: string; name: string; slug: string }

export interface MenuBoardWizardState {
  name: string;
  duration: number;
  config: MenuBoardConfig;
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

type StepId = 'basics' | 'layout' | 'theme' | 'options';

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

  // Step list (basics is conditional).
  const STEPS: StepDef[] = useMemo(() => {
    const arr: StepDef[] = [];
    if (showBasicsStep) arr.push({ id: 'basics', label: 'Basics',  icon: <SettingsIcon size={14} /> });
    arr.push({ id: 'layout',  label: 'Layout',  icon: <LayoutIcon size={14} /> });
    arr.push({ id: 'theme',   label: 'Style',   icon: <Palette size={14} /> });
    arr.push({ id: 'options', label: 'Options', icon: <TypeIcon size={14} /> });
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
    onSubmit({ name: name.trim(), duration, config });
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
          {currentStep.id === 'basics'  && basicsStep}
          {currentStep.id === 'layout'  && layoutStep}
          {currentStep.id === 'theme'   && themeStep}
          {currentStep.id === 'options' && optionsStep}
        </div>

        {/* Live preview */}
        <div className="border-l border-[var(--border)] bg-[var(--surface-raised)] flex flex-col p-4 gap-2">
          <span className="text-[10px] uppercase tracking-wide text-[var(--text-muted)] font-semibold">Live Preview</span>
          <div className="flex-1 min-h-[260px] rounded-lg overflow-hidden border border-[var(--border)] shadow-inner">
            <MenuBoardCanvas
              config={config}
              menu={menu ?? null}
              density="sm"
              fallbackTitle={name || 'Menu Board'}
              placeholder
            />
          </div>
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
