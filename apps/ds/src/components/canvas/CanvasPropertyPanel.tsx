import { useState, useEffect } from 'react';
import {
  Lock, Unlock, Eye, EyeOff, Trash2, Copy,
  ArrowUp, ArrowDown, ChevronsUp, ChevronsDown,
  RotateCw,
} from 'lucide-react';
import { useCanvasStore } from '../../lib/canvasStore.js';
import type { CanvasElement, TextElement, RectElement, CircleElement, LineElement } from '../../lib/canvasTypes.js';
import TagInputEditor from '../TagInputEditor.js';

// ── Color input helper ──────────────────────────────────────────────────

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex items-center gap-2">
      <span className="text-xs text-[var(--text-muted)] w-16 shrink-0">{label}</span>
      <div className="flex items-center gap-1.5 flex-1">
        <input
          type="color"
          value={value || '#000000'}
          onChange={(e) => onChange(e.target.value)}
          className="w-7 h-7 rounded border border-[var(--border)] cursor-pointer bg-transparent"
        />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="flex-1 px-2 py-1 rounded border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] text-xs font-mono"
        />
      </div>
    </label>
  );
}

// ── Number input helper ─────────────────────────────────────────────────

function NumberField({
  label, value, onChange, min, max, step = 1, unit,
}: {
  label: string; value: number; onChange: (v: number) => void;
  min?: number; max?: number; step?: number; unit?: string;
}) {
  return (
    <label className="flex items-center gap-2">
      <span className="text-xs text-[var(--text-muted)] w-16 shrink-0">{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        className="flex-1 px-2 py-1 rounded border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] text-xs w-14"
      />
      {unit && <span className="text-[10px] text-[var(--text-muted)]">{unit}</span>}
    </label>
  );
}

// ── Select helper ───────────────────────────────────────────────────────

function SelectField({
  label, value, options, onChange,
}: {
  label: string; value: string; options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex items-center gap-2">
      <span className="text-xs text-[var(--text-muted)] w-16 shrink-0">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="flex-1 px-2 py-1 rounded border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] text-xs"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}

// ── Section wrapper ─────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-[var(--border)] pb-3 mb-3">
      <p className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-2">
        {title}
      </p>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

// ── Main property panel ─────────────────────────────────────────────────

export default function CanvasPropertyPanel() {
  const {
    selectedElementIds,
    updateElement,
    removeElements,
    duplicateSelected,
    bringForward,
    sendBackward,
    bringToFront,
    sendToBack,
    settings,
    updateSettings,
  } = useCanvasStore();

  const elements = useCanvasStore((s) => {
    const page = s.pages.find((p) => p.id === s.selectedPageId);
    return page?.elements ?? [];
  });

  const selected = elements.filter((el) => selectedElementIds.includes(el.id));

  // Must be declared before early returns — React hooks must always be called in the same order
  const [tagInput, setTagInput] = useState('');
  const selectedSingleId = selected.length === 1 ? selected[0]!.id : null;
  useEffect(() => { setTagInput(''); }, [selectedSingleId]);

  // ── No selection → show canvas settings ────────────────────────────────

  if (selected.length === 0) {
    return (
      <div className="w-64 shrink-0 border-l border-[var(--border)] bg-[var(--card)] overflow-y-auto">
        <div className="p-3">
          <p className="text-xs font-semibold text-[var(--text)] mb-3">Canvas Settings</p>

          <Section title="Background">
            <ColorField
              label="Color"
              value={settings.background}
              onChange={(v) => updateSettings({ background: v })}
            />
          </Section>

          <Section title="Grid">
            <NumberField
              label="Size"
              value={settings.gridSize}
              onChange={(v) => updateSettings({ gridSize: Math.max(5, v) })}
              min={5}
              max={100}
              unit="px"
            />
          </Section>

          <div className="mt-4 p-3 rounded-lg bg-[var(--surface)] border border-[var(--border)]">
            <p className="text-[10px] text-[var(--text-muted)] leading-relaxed">
              <strong className="text-[var(--text)]">Tip:</strong> Click on any element to see its properties here. Use the sidebar to add shapes and text.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ── Multi-selection ──────────────────────────────────────────────────────

  if (selected.length > 1) {
    return (
      <div className="w-64 shrink-0 border-l border-[var(--border)] bg-[var(--card)] overflow-y-auto">
        <div className="p-3">
          <p className="text-xs font-semibold text-[var(--text)] mb-1">
            {selected.length} elements selected
          </p>
          <p className="text-[10px] text-[var(--text-muted)] mb-3">
            Select a single element to edit its properties
          </p>

          <div className="flex gap-1">
            <button
              onClick={() => duplicateSelected()}
              className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded text-xs text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface)] border border-[var(--border)] transition-colors"
            >
              <Copy size={12} /> Duplicate
            </button>
            <button
              onClick={() => removeElements(selectedElementIds)}
              className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10 border border-[var(--border)] transition-colors"
            >
              <Trash2 size={12} /> Delete
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Single selection ────────────────────────────────────────────────────

  const el = selected[0]!;
  const update = (changes: Partial<CanvasElement>) => updateElement(el.id, changes);

  return (
    <div className="w-64 shrink-0 border-l border-[var(--border)] bg-[var(--card)] overflow-y-auto">
      <div className="p-3">
        {/* Element name + type badge */}
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-semibold text-[var(--text)] truncate">{el.name}</p>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--surface)] text-[var(--text-muted)] capitalize">
            {el.type}
          </span>
        </div>

        {/* Quick actions */}
        <div className="flex gap-1 mb-3">
          <button
            onClick={() => update({ locked: !el.locked })}
            className={`p-1.5 rounded transition-colors ${el.locked ? 'text-amber-400 bg-amber-500/10' : 'text-[var(--text-muted)] hover:bg-[var(--surface)]'}`}
            title={el.locked ? 'Unlock' : 'Lock'}
          >
            {el.locked ? <Lock size={14} /> : <Unlock size={14} />}
          </button>
          <button
            onClick={() => update({ visible: !el.visible })}
            className={`p-1.5 rounded transition-colors ${!el.visible ? 'text-red-400 bg-red-500/10' : 'text-[var(--text-muted)] hover:bg-[var(--surface)]'}`}
            title={el.visible ? 'Hide' : 'Show'}
          >
            {el.visible ? <Eye size={14} /> : <EyeOff size={14} />}
          </button>
          <button
            onClick={() => duplicateSelected()}
            className="p-1.5 rounded text-[var(--text-muted)] hover:bg-[var(--surface)] transition-colors"
            title="Duplicate (Ctrl+D)"
          >
            <Copy size={14} />
          </button>
          <button
            onClick={() => removeElements([el.id])}
            className="p-1.5 rounded text-red-400 hover:bg-red-500/10 transition-colors"
            title="Delete"
          >
            <Trash2 size={14} />
          </button>

          <div className="w-px bg-[var(--border)] mx-0.5" />

          <button onClick={() => bringToFront(el.id)} className="p-1.5 rounded text-[var(--text-muted)] hover:bg-[var(--surface)] transition-colors" title="Bring to Front">
            <ChevronsUp size={14} />
          </button>
          <button onClick={() => bringForward(el.id)} className="p-1.5 rounded text-[var(--text-muted)] hover:bg-[var(--surface)] transition-colors" title="Bring Forward">
            <ArrowUp size={14} />
          </button>
          <button onClick={() => sendBackward(el.id)} className="p-1.5 rounded text-[var(--text-muted)] hover:bg-[var(--surface)] transition-colors" title="Send Backward">
            <ArrowDown size={14} />
          </button>
          <button onClick={() => sendToBack(el.id)} className="p-1.5 rounded text-[var(--text-muted)] hover:bg-[var(--surface)] transition-colors" title="Send to Back">
            <ChevronsDown size={14} />
          </button>
        </div>

        {/* Position & Size */}
        <Section title="Position & Size">
          <div className="grid grid-cols-2 gap-2">
            <NumberField label="X" value={Math.round(el.x)} onChange={(v) => update({ x: v })} />
            <NumberField label="Y" value={Math.round(el.y)} onChange={(v) => update({ y: v })} />
            <NumberField label="W" value={Math.round(el.width)} onChange={(v) => update({ width: Math.max(1, v) })} min={1} />
            <NumberField label="H" value={Math.round(el.height)} onChange={(v) => update({ height: Math.max(1, v) })} min={1} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <NumberField label="Rotate" value={Math.round(el.rotation)} onChange={(v) => update({ rotation: v })} unit="°" />
            <NumberField label="Opacity" value={Math.round(el.opacity * 100)} onChange={(v) => update({ opacity: Math.min(100, Math.max(0, v)) / 100 })} min={0} max={100} unit="%" />
          </div>
        </Section>

        {/* Type-specific properties */}
        {el.type === 'text' && <TextProperties el={el as TextElement} update={update} />}
        {el.type === 'rect' && <RectProperties el={el as RectElement} update={update} />}
        {el.type === 'circle' && <CircleProperties el={el as CircleElement} update={update} />}
        {el.type === 'line' && <LineProperties el={el as LineElement} update={update} />}

        {/* Tags */}
        <Section title="Tags">
          <TagInputEditor
            tags={el.tags ?? []}
            tagInput={tagInput}
            setTagInput={setTagInput}
            addTag={() => {
              const trimmed = tagInput.trim();
              if (!trimmed || el.tags?.includes(trimmed)) return;
              update({ tags: [...(el.tags ?? []), trimmed] });
              setTagInput('');
            }}
            removeTag={(tag) => update({ tags: (el.tags ?? []).filter((t) => t !== tag) })}
            placeholder="Add label…"
          />
        </Section>
      </div>
    </div>
  );
}

// ── Text-specific ───────────────────────────────────────────────────────

function TextProperties({ el, update }: { el: TextElement; update: (c: Partial<CanvasElement>) => void }) {
  return (
    <>
      <Section title="Text Content">
        <textarea
          value={el.text}
          onChange={(e) => update({ text: e.target.value })}
          rows={3}
          className="w-full px-2 py-1.5 rounded border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] text-xs resize-none"
          placeholder="Enter your text…"
        />
      </Section>

      <Section title="Typography">
        <SelectField
          label="Font"
          value={el.fontFamily}
          options={[
            { value: 'Inter', label: 'Inter' },
            { value: 'Arial', label: 'Arial' },
            { value: 'Georgia', label: 'Georgia' },
            { value: 'Courier New', label: 'Courier New' },
            { value: 'Impact', label: 'Impact' },
            { value: 'Verdana', label: 'Verdana' },
            { value: 'Trebuchet MS', label: 'Trebuchet MS' },
          ]}
          onChange={(v) => update({ fontFamily: v })}
        />
        <NumberField label="Size" value={el.fontSize} onChange={(v) => update({ fontSize: Math.max(8, v) })} min={8} max={200} unit="px" />
        <SelectField
          label="Style"
          value={el.fontStyle}
          options={[
            { value: '', label: 'Normal' },
            { value: 'bold', label: 'Bold' },
            { value: 'italic', label: 'Italic' },
            { value: 'bold italic', label: 'Bold Italic' },
          ]}
          onChange={(v) => update({ fontStyle: v as TextElement['fontStyle'] })}
        />
        <SelectField
          label="Align"
          value={el.align}
          options={[
            { value: 'left', label: 'Left' },
            { value: 'center', label: 'Center' },
            { value: 'right', label: 'Right' },
          ]}
          onChange={(v) => update({ align: v as TextElement['align'] })}
        />
        <NumberField label="Line H" value={el.lineHeight} onChange={(v) => update({ lineHeight: Math.max(0.5, v) })} min={0.5} max={3} step={0.1} />
        <NumberField label="Spacing" value={el.letterSpacing} onChange={(v) => update({ letterSpacing: v })} step={0.5} unit="px" />
      </Section>

      <Section title="Color">
        <ColorField label="Fill" value={el.fill} onChange={(v) => update({ fill: v })} />
      </Section>
    </>
  );
}

// ── Rect-specific ───────────────────────────────────────────────────────

function RectProperties({ el, update }: { el: RectElement; update: (c: Partial<CanvasElement>) => void }) {
  return (
    <>
      <Section title="Fill & Stroke">
        <ColorField label="Fill" value={el.fill} onChange={(v) => update({ fill: v })} />
        <ColorField label="Stroke" value={el.stroke} onChange={(v) => update({ stroke: v })} />
        <NumberField label="Stroke W" value={el.strokeWidth} onChange={(v) => update({ strokeWidth: Math.max(0, v) })} min={0} unit="px" />
      </Section>
      <Section title="Corners">
        <NumberField label="Radius" value={el.cornerRadius} onChange={(v) => update({ cornerRadius: Math.max(0, v) })} min={0} unit="px" />
      </Section>
    </>
  );
}

// ── Circle-specific ─────────────────────────────────────────────────────

function CircleProperties({ el, update }: { el: CircleElement; update: (c: Partial<CanvasElement>) => void }) {
  return (
    <Section title="Fill & Stroke">
      <ColorField label="Fill" value={el.fill} onChange={(v) => update({ fill: v })} />
      <ColorField label="Stroke" value={el.stroke} onChange={(v) => update({ stroke: v })} />
      <NumberField label="Stroke W" value={el.strokeWidth} onChange={(v) => update({ strokeWidth: Math.max(0, v) })} min={0} unit="px" />
    </Section>
  );
}

// ── Line-specific ───────────────────────────────────────────────────────

function LineProperties({ el, update }: { el: LineElement; update: (c: Partial<CanvasElement>) => void }) {
  return (
    <Section title="Stroke">
      <ColorField label="Color" value={el.stroke} onChange={(v) => update({ stroke: v })} />
      <NumberField label="Width" value={el.strokeWidth} onChange={(v) => update({ strokeWidth: Math.max(1, v) })} min={1} unit="px" />
      <SelectField
        label="Cap"
        value={el.lineCap}
        options={[
          { value: 'butt', label: 'Flat' },
          { value: 'round', label: 'Round' },
          { value: 'square', label: 'Square' },
        ]}
        onChange={(v) => update({ lineCap: v as LineElement['lineCap'] })}
      />
    </Section>
  );
}
