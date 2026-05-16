import { create } from 'zustand';
import type {
  CanvasElement,
  CanvasPage,
  CanvasSettings,
  SceneData,
  CanvasProject,
} from './canvasTypes.js';
import { sanitizeCanvasElement, sanitizeCanvasPage, sanitizeCanvasSettings } from './canvasTypes.js';

// ── History (undo / redo) ─────────────────────────────────────────────────

interface HistoryEntry {
  pages: CanvasPage[];
  selectedPageId: string;
}

const MAX_HISTORY = 60;

// ── Store shape ──────────────────────────────────────────────────────────

interface CanvasState {
  // Project metadata
  projectId: string | null;
  projectName: string;
  projectVersion: number;
  workspaceId: string | null;
  dirty: boolean;

  // Scene
  pages: CanvasPage[];
  settings: CanvasSettings;

  // Selection
  selectedPageId: string;
  selectedElementIds: string[];

  // Viewport
  zoom: number;
  stageX: number;
  stageY: number;

  // Sidebar
  activeSidebarTab: 'shapes' | 'text' | 'media' | 'layers';

  // History
  past: HistoryEntry[];
  future: HistoryEntry[];

  // ── Actions ──────────────────────────────────────────────────────────

  // Project
  loadProject: (project: CanvasProject) => void;
  resetProject: () => void;
  setProjectName: (name: string) => void;
  markClean: () => void;

  // Pages
  addPage: () => void;
  removePage: (pageId: string) => void;
  selectPage: (pageId: string) => void;
  updatePage: (pageId: string, changes: Partial<CanvasPage>) => void;
  reorderPages: (fromIndex: number, toIndex: number) => void;
  duplicatePage: (pageId: string) => void;

  // Elements
  addElement: (element: CanvasElement) => void;
  updateElement: (elementId: string, changes: Partial<CanvasElement>) => void;
  removeElements: (ids: string[]) => void;
  selectElements: (ids: string[]) => void;
  clearSelection: () => void;
  selectByTag: (tag: string) => void;
  duplicateSelected: () => void;
  bringForward: (id: string) => void;
  sendBackward: (id: string) => void;
  bringToFront: (id: string) => void;
  sendToBack: (id: string) => void;

  // Settings
  updateSettings: (changes: Partial<CanvasSettings>) => void;

  // Viewport
  setZoom: (zoom: number) => void;
  setStagePosition: (x: number, y: number) => void;

  // Sidebar
  setActiveSidebarTab: (tab: CanvasState['activeSidebarTab']) => void;

  // History
  undo: () => void;
  redo: () => void;

  // Helpers
  currentPage: () => CanvasPage | undefined;
  currentElements: () => CanvasElement[];
  getSelectedElements: () => CanvasElement[];
}

const defaultSettings: CanvasSettings = {
  width: 1920,
  height: 1080,
  background: '#1a1a2e',
  gridEnabled: true,
  gridSize: 20,
  snapToGrid: true,
  guides: { horizontal: [], vertical: [] },
};

const defaultPageId = crypto.randomUUID();
const defaultPage: CanvasPage = {
  id: defaultPageId,
  title: 'Page 1',
  duration: 10,
  transition: 'none',
  elements: [],
};

// ── Push history snapshot before a mutation ──────────────────────────────

function pushHistory(state: CanvasState): Pick<CanvasState, 'past' | 'future' | 'dirty'> {
  const entry: HistoryEntry = {
    pages: JSON.parse(JSON.stringify(state.pages)),
    selectedPageId: state.selectedPageId,
  };
  return {
    past: [...state.past.slice(-MAX_HISTORY), entry],
    future: [],
    dirty: true,
  };
}

// ── Store ────────────────────────────────────────────────────────────────

export const useCanvasStore = create<CanvasState>((set, get) => ({
  // Project
  projectId: null,
  projectName: 'Untitled Design',
  projectVersion: 1,
  workspaceId: null,
  dirty: false,

  // Scene
  pages: [defaultPage],
  settings: defaultSettings,

  // Selection
  selectedPageId: defaultPageId,
  selectedElementIds: [],

  // Viewport
  zoom: 1,
  stageX: 0,
  stageY: 0,

  // Sidebar
  activeSidebarTab: 'shapes',

  // History
  past: [],
  future: [],

  // ── Project actions ─────────────────────────────────────────────────

  loadProject: (project) => {
    const scene = project.sceneData as SceneData;
    const settings = sanitizeCanvasSettings(project.settings as CanvasSettings);
    const pages = scene.pages?.length ? scene.pages.map(sanitizeCanvasPage) : [sanitizeCanvasPage(defaultPage)];
    set({
      projectId: project.id,
      projectName: project.name,
      projectVersion: project.version,
      workspaceId: project.workspaceId,
      pages,
      settings,
      selectedPageId: pages[0]!.id,
      selectedElementIds: [],
      zoom: 1,
      stageX: 0,
      stageY: 0,
      past: [],
      future: [],
      dirty: false,
    });
  },

  resetProject: () => {
    const newId = crypto.randomUUID();
    set({
      projectId: null,
      projectName: 'Untitled Design',
      projectVersion: 1,
      workspaceId: null,
      pages: [{ ...defaultPage, id: newId }],
      settings: defaultSettings,
      selectedPageId: newId,
      selectedElementIds: [],
      zoom: 1,
      stageX: 0,
      stageY: 0,
      past: [],
      future: [],
      dirty: false,
    });
  },

  setProjectName: (name) => set({ projectName: name, dirty: true }),
  markClean: () => set({ dirty: false }),

  // ── Page actions ────────────────────────────────────────────────────

  addPage: () => set((s) => {
    const hist = pushHistory(s);
    const newPage: CanvasPage = {
      id: crypto.randomUUID(),
      title: `Page ${s.pages.length + 1}`,
      duration: 10,
      transition: 'none',
      elements: [],
    };
    return { ...hist, pages: [...s.pages, newPage], selectedPageId: newPage.id, selectedElementIds: [] };
  }),

  removePage: (pageId) => set((s) => {
    if (s.pages.length <= 1) return s; // must keep at least one page
    const hist = pushHistory(s);
    const filtered = s.pages.filter((p) => p.id !== pageId);
    const newSelected = s.selectedPageId === pageId ? filtered[0]!.id : s.selectedPageId;
    return { ...hist, pages: filtered, selectedPageId: newSelected, selectedElementIds: [] };
  }),

  selectPage: (pageId) => set({ selectedPageId: pageId, selectedElementIds: [] }),

  updatePage: (pageId, changes) => set((s) => {
    const hist = pushHistory(s);
    return {
      ...hist,
      pages: s.pages.map((p) => (p.id === pageId ? { ...p, ...changes } : p)),
    };
  }),

  reorderPages: (fromIndex, toIndex) => set((s) => {
    const hist = pushHistory(s);
    const pages = [...s.pages];
    const [moved] = pages.splice(fromIndex, 1);
    pages.splice(toIndex, 0, moved!);
    return { ...hist, pages };
  }),

  duplicatePage: (pageId) => set((s) => {
    const hist = pushHistory(s);
    const source = s.pages.find((p) => p.id === pageId);
    if (!source) return s;
    const clone: CanvasPage = {
      ...JSON.parse(JSON.stringify(source)),
      id: crypto.randomUUID(),
      title: `${source.title} (Copy)`,
    };
    // re-assign new IDs to cloned elements
    clone.elements = clone.elements.map((el: CanvasElement) => ({ ...el, id: crypto.randomUUID() }));
    const idx = s.pages.findIndex((p) => p.id === pageId);
    const pages = [...s.pages];
    pages.splice(idx + 1, 0, clone);
    return { ...hist, pages, selectedPageId: clone.id, selectedElementIds: [] };
  }),

  // ── Element actions ─────────────────────────────────────────────────

  addElement: (element) => set((s) => {
    const sanitizedElement = sanitizeCanvasElement(element);
    if (!sanitizedElement) return s;
    const hist = pushHistory(s);
    return {
      ...hist,
      pages: s.pages.map((p) =>
        p.id === s.selectedPageId
          ? { ...p, elements: [...p.elements, sanitizedElement] }
          : p,
      ),
      selectedElementIds: [sanitizedElement.id],
    };
  }),

  updateElement: (elementId, changes) => set((s) => {
    const hist = pushHistory(s);
    return {
      ...hist,
      pages: s.pages.map((p): CanvasPage =>
        p.id === s.selectedPageId
          ? {
              ...p,
              elements: p.elements.map((el): CanvasElement => {
                if (el.id !== elementId) return el;
                return sanitizeCanvasElement({ ...el, ...changes } as CanvasElement) ?? el;
              },
              ),
            }
          : p,
      ),
    };
  }),

  removeElements: (ids) => set((s) => {
    if (ids.length === 0) return s;
    const hist = pushHistory(s);
    return {
      ...hist,
      pages: s.pages.map((p) =>
        p.id === s.selectedPageId
          ? { ...p, elements: p.elements.filter((el) => !ids.includes(el.id)) }
          : p,
      ),
      selectedElementIds: [],
    };
  }),

  selectElements: (ids) => set({ selectedElementIds: ids }),
  clearSelection: () => set({ selectedElementIds: [] }),

  selectByTag: (tag) => set((s) => {
    const page = s.pages.find((p) => p.id === s.selectedPageId);
    if (!page) return s;
    const ids = page.elements
      .filter((el) => el.tags?.includes(tag))
      .map((el) => el.id);
    return { selectedElementIds: ids };
  }),

  duplicateSelected: () => set((s) => {
    if (s.selectedElementIds.length === 0) return s;
    const hist = pushHistory(s);
    const page = s.pages.find((p) => p.id === s.selectedPageId);
    if (!page) return s;
    const toDuplicate = page.elements.filter((el) => s.selectedElementIds.includes(el.id));
    const clones = toDuplicate.map((el) => ({
      ...JSON.parse(JSON.stringify(el)),
      id: crypto.randomUUID(),
      x: el.x + 20,
      y: el.y + 20,
      name: `${el.name} (Copy)`,
    }));
    return {
      ...hist,
      pages: s.pages.map((p) =>
        p.id === s.selectedPageId
          ? { ...p, elements: [...p.elements, ...clones] }
          : p,
      ),
      selectedElementIds: clones.map((c: CanvasElement) => c.id),
    };
  }),

  bringForward: (id) => set((s) => {
    const hist = pushHistory(s);
    return {
      ...hist,
      pages: s.pages.map((p) => {
        if (p.id !== s.selectedPageId) return p;
        const idx = p.elements.findIndex((el) => el.id === id);
        if (idx < 0 || idx >= p.elements.length - 1) return p;
        const els = [...p.elements];
        [els[idx], els[idx + 1]] = [els[idx + 1]!, els[idx]!];
        return { ...p, elements: els };
      }),
    };
  }),

  sendBackward: (id) => set((s) => {
    const hist = pushHistory(s);
    return {
      ...hist,
      pages: s.pages.map((p) => {
        if (p.id !== s.selectedPageId) return p;
        const idx = p.elements.findIndex((el) => el.id === id);
        if (idx <= 0) return p;
        const els = [...p.elements];
        [els[idx - 1], els[idx]] = [els[idx]!, els[idx - 1]!];
        return { ...p, elements: els };
      }),
    };
  }),

  bringToFront: (id) => set((s) => {
    const hist = pushHistory(s);
    return {
      ...hist,
      pages: s.pages.map((p) => {
        if (p.id !== s.selectedPageId) return p;
        const el = p.elements.find((e) => e.id === id);
        if (!el) return p;
        return { ...p, elements: [...p.elements.filter((e) => e.id !== id), el] };
      }),
    };
  }),

  sendToBack: (id) => set((s) => {
    const hist = pushHistory(s);
    return {
      ...hist,
      pages: s.pages.map((p) => {
        if (p.id !== s.selectedPageId) return p;
        const el = p.elements.find((e) => e.id === id);
        if (!el) return p;
        return { ...p, elements: [el, ...p.elements.filter((e) => e.id !== id)] };
      }),
    };
  }),

  // ── Settings ────────────────────────────────────────────────────────

  updateSettings: (changes) => set((s) => ({
    settings: sanitizeCanvasSettings({ ...s.settings, ...changes }),
    dirty: true,
  })),

  // ── Viewport ────────────────────────────────────────────────────────

  setZoom: (zoom) => set({ zoom: Math.max(0.1, Math.min(5, Number.isFinite(zoom) ? zoom : 1)) }),
  setStagePosition: (x, y) => set({ stageX: Number.isFinite(x) ? x : 0, stageY: Number.isFinite(y) ? y : 0 }),

  // ── Sidebar ─────────────────────────────────────────────────────────

  setActiveSidebarTab: (tab) => set({ activeSidebarTab: tab }),

  // ── History ─────────────────────────────────────────────────────────

  undo: () => set((s) => {
    if (s.past.length === 0) return s;
    const prev = s.past[s.past.length - 1]!;
    const current: HistoryEntry = {
      pages: JSON.parse(JSON.stringify(s.pages)),
      selectedPageId: s.selectedPageId,
    };
    return {
      past: s.past.slice(0, -1),
      future: [...s.future, current],
      pages: prev.pages,
      selectedPageId: prev.selectedPageId,
      selectedElementIds: [],
      dirty: true,
    };
  }),

  redo: () => set((s) => {
    if (s.future.length === 0) return s;
    const next = s.future[s.future.length - 1]!;
    const current: HistoryEntry = {
      pages: JSON.parse(JSON.stringify(s.pages)),
      selectedPageId: s.selectedPageId,
    };
    return {
      past: [...s.past, current],
      future: s.future.slice(0, -1),
      pages: next.pages,
      selectedPageId: next.selectedPageId,
      selectedElementIds: [],
      dirty: true,
    };
  }),

  // ── Helpers ─────────────────────────────────────────────────────────

  currentPage: () => {
    const s = get();
    return s.pages.find((p) => p.id === s.selectedPageId);
  },

  currentElements: () => {
    const s = get();
    const page = s.pages.find((p) => p.id === s.selectedPageId);
    return page?.elements ?? [];
  },

  getSelectedElements: () => {
    const s = get();
    const page = s.pages.find((p) => p.id === s.selectedPageId);
    if (!page) return [];
    return page.elements.filter((el) => s.selectedElementIds.includes(el.id));
  },
}));
