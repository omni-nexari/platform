import { useState } from 'react';
import {
  Type, Square, Circle, Minus, Layers,
  Image as ImageIcon, Tag,
} from 'lucide-react';
import { useCanvasStore } from '../../lib/canvasStore.js';
import {
  createTextElement,
  createRectElement,
  createCircleElement,
  createLineElement,
} from '../../lib/canvasTypes.js';
import MediaLibraryPanel from './MediaLibraryPanel.js';

const TABS = [
  { id: 'shapes' as const, label: 'Shapes', icon: Square },
  { id: 'text' as const, label: 'Text', icon: Type },
  { id: 'media' as const, label: 'Media', icon: ImageIcon },
  { id: 'layers' as const, label: 'Layers', icon: Layers },
];

// ── Shape gallery items ──────────────────────────────────────────────────

const SHAPE_ITEMS = [
  {
    id: 'rect',
    label: 'Rectangle',
    icon: <Square size={24} />,
    create: () => createRectElement(),
  },
  {
    id: 'circle',
    label: 'Circle',
    icon: <Circle size={24} />,
    create: () => createCircleElement(),
  },
  {
    id: 'line',
    label: 'Line',
    icon: <Minus size={24} />,
    create: () => createLineElement(),
  },
  {
    id: 'rounded-rect',
    label: 'Rounded Rect',
    icon: <Square size={24} className="rounded" />,
    create: () => createRectElement({ cornerRadius: 16, name: 'Rounded Rectangle' }),
  },
  {
    id: 'square',
    label: 'Square',
    icon: <Square size={24} />,
    create: () => createRectElement({ width: 150, height: 150, name: 'Square' }),
  },
] as const;

// ── Text gallery items ──────────────────────────────────────────────────

const TEXT_ITEMS = [
  {
    id: 'heading',
    label: 'Heading',
    preview: 'Add a heading',
    create: () =>
      createTextElement({
        text: 'Add a heading',
        fontSize: 48,
        fontStyle: 'bold',
        name: 'Heading',
        width: 400,
        height: 70,
      }),
  },
  {
    id: 'subheading',
    label: 'Subheading',
    preview: 'Add a subheading',
    create: () =>
      createTextElement({
        text: 'Add a subheading',
        fontSize: 28,
        fontStyle: 'bold',
        name: 'Subheading',
        width: 350,
        height: 50,
      }),
  },
  {
    id: 'body',
    label: 'Body Text',
    preview: 'Add body text',
    create: () =>
      createTextElement({
        text: 'Add body text here. You can change the font, size, color, and alignment in the property panel on the right.',
        fontSize: 18,
        name: 'Body Text',
        width: 400,
        height: 100,
      }),
  },
  {
    id: 'caption',
    label: 'Caption',
    preview: 'Add a caption',
    create: () =>
      createTextElement({
        text: 'Add a caption',
        fontSize: 14,
        fill: '#94a3b8',
        name: 'Caption',
        width: 250,
        height: 30,
      }),
  },
];

// ── Sidebar component ────────────────────────────────────────────────────

export default function CanvasSidebar({ workspaceId }: { workspaceId: string }) {
  const { activeSidebarTab, setActiveSidebarTab, addElement, pages, selectedPageId, selectedElementIds, selectElements } = useCanvasStore();
  const page = pages.find((p) => p.id === selectedPageId);
  const elements = page?.elements ?? [];

  const [layerTagFilter, setLayerTagFilter] = useState('');

  return (
    <div className="w-60 shrink-0 flex flex-col border-r border-[var(--border)] bg-[var(--card)]">
      {/* Tab bar */}
      <div className="flex border-b border-[var(--border)]">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveSidebarTab(tab.id)}
              className={`flex-1 flex flex-col items-center gap-0.5 py-2 text-[10px] font-medium transition-colors ${
                activeSidebarTab === tab.id
                  ? 'text-[var(--blue)] border-b-2 border-[var(--blue)]'
                  : 'text-[var(--text-muted)] hover:text-[var(--text)]'
              }`}
            >
              <Icon size={16} />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Panel content */}
      <div className="flex-1 overflow-y-auto p-3">
        {activeSidebarTab === 'shapes' && (
          <div>
            <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-3">
              Add a Shape
            </p>
            <div className="grid grid-cols-2 gap-2">
              {SHAPE_ITEMS.map((item) => (
                <button
                  key={item.id}
                  onClick={() => addElement(item.create())}
                  className="flex flex-col items-center gap-1.5 p-3 rounded-lg border border-[var(--border)] hover:border-[var(--blue)] hover:bg-[var(--surface)] transition-colors text-[var(--text-muted)] hover:text-[var(--blue)]"
                >
                  {item.icon}
                  <span className="text-[10px] font-medium">{item.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {activeSidebarTab === 'text' && (
          <div>
            <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-3">
              Add Text
            </p>
            <div className="space-y-2">
              {TEXT_ITEMS.map((item) => (
                <button
                  key={item.id}
                  onClick={() => addElement(item.create())}
                  className="w-full text-left p-3 rounded-lg border border-[var(--border)] hover:border-[var(--blue)] hover:bg-[var(--surface)] transition-colors group"
                >
                  <p className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-1 group-hover:text-[var(--blue)]">
                    {item.label}
                  </p>
                  <p className={`text-[var(--text)] ${
                    item.id === 'heading' ? 'text-lg font-bold' :
                    item.id === 'subheading' ? 'text-sm font-semibold' :
                    item.id === 'caption' ? 'text-xs text-[var(--text-muted)]' :
                    'text-sm'
                  }`}>
                    {item.preview}
                  </p>
                </button>
              ))}
            </div>
          </div>
        )}

        {activeSidebarTab === 'media' && (
          <div className="flex flex-col h-full">
            <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-3">
              Media
            </p>
            <MediaLibraryPanel
              workspaceId={workspaceId}
              onSelect={(el) => addElement(el)}
            />
          </div>
        )}

        {activeSidebarTab === 'layers' && (
          <div>
            <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-3">
              Layers
            </p>

            {/* Tag filter */}
            <div className="relative mb-2">
              <Tag
                size={11}
                className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none"
              />
              <input
                value={layerTagFilter}
                onChange={(e) => setLayerTagFilter(e.target.value)}
                placeholder="Filter by tag…"
                className="w-full pl-6 pr-2 py-1 rounded border border-[var(--border)] bg-[var(--surface)] text-xs text-[var(--text)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--blue)]"
              />
            </div>

            {elements.length === 0 ? (
              <p className="text-xs text-[var(--text-muted)] text-center py-4">
                No elements on this page yet
              </p>
            ) : (
              <div className="space-y-0.5">
                {[...elements].reverse()
                  .filter((el) => {
                    if (!layerTagFilter.trim()) return true;
                    return el.tags?.some((t) =>
                      t.toLowerCase().includes(layerTagFilter.trim().toLowerCase()),
                    );
                  })
                  .map((el) => {
                  const isSelected = selectedElementIds.includes(el.id);
                  const visibleTags = el.tags?.slice(0, 2) ?? [];
                  const overflow = (el.tags?.length ?? 0) - visibleTags.length;
                  return (
                    <div
                      key={el.id}
                      onClick={() => selectElements([el.id])}
                      className={`flex flex-col gap-0.5 px-2 py-1.5 rounded text-xs cursor-pointer transition-colors ${
                        isSelected
                          ? 'bg-[var(--blue)]/15 text-[var(--blue)]'
                          : 'text-[var(--text-muted)] hover:bg-[var(--surface)] hover:text-[var(--text)]'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        {el.type === 'text' && <Type size={12} />}
                        {el.type === 'rect' && <Square size={12} />}
                        {el.type === 'circle' && <Circle size={12} />}
                        {el.type === 'line' && <Minus size={12} />}
                        {el.type === 'image' && <ImageIcon size={12} />}
                        <span className="flex-1 truncate">{el.name}</span>
                        {el.locked && (
                          <span className="text-[10px] text-amber-400">Locked</span>
                        )}
                        {!el.visible && (
                          <span className="text-[10px] text-red-400">Hidden</span>
                        )}
                      </div>
                      {visibleTags.length > 0 && (
                        <div className="flex flex-wrap gap-1 pl-5">
                          {visibleTags.map((tag) => (
                            <span
                              key={tag}
                              className="px-1.5 py-0.5 rounded-full bg-[var(--accent)]/10 text-[var(--accent)] text-[9px] leading-tight"
                            >
                              {tag}
                            </span>
                          ))}
                          {overflow > 0 && (
                            <span className="text-[9px] text-[var(--text-muted)]">
                              +{overflow}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
