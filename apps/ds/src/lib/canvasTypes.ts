// ── Canvas element & scene types ───────────────────────────────────────────

export type ElementType = 'text' | 'rect' | 'circle' | 'line' | 'image' | 'group';

export type TransitionEffect = 'none' | 'fade' | 'slide_left' | 'slide_right' | 'zoom';

/** Shared base for every element on the canvas */
export interface BaseElement {
  id: string;
  type: ElementType;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  locked: boolean;
  visible: boolean;
  name: string;
}

export interface TextElement extends BaseElement {
  type: 'text';
  text: string;
  fontSize: number;
  fontFamily: string;
  fontStyle: '' | 'bold' | 'italic' | 'bold italic';
  textDecoration: '' | 'underline' | 'line-through';
  fill: string;
  align: 'left' | 'center' | 'right';
  verticalAlign: 'top' | 'middle' | 'bottom';
  lineHeight: number;
  letterSpacing: number;
  padding: number;
}

export interface RectElement extends BaseElement {
  type: 'rect';
  fill: string;
  stroke: string;
  strokeWidth: number;
  cornerRadius: number;
}

export interface CircleElement extends BaseElement {
  type: 'circle';
  fill: string;
  stroke: string;
  strokeWidth: number;
}

export interface LineElement extends BaseElement {
  type: 'line';
  points: number[]; // [x1,y1, x2,y2, ...]
  stroke: string;
  strokeWidth: number;
  lineCap: 'butt' | 'round' | 'square';
  lineJoin: 'miter' | 'round' | 'bevel';
}

export interface ImageElement extends BaseElement {
  type: 'image';
  contentItemId: string | null;
  src: string;
  objectFit: 'fill' | 'cover' | 'contain';
}

export interface GroupElement extends BaseElement {
  type: 'group';
  children: CanvasElement[];
}

export type CanvasElement =
  | TextElement
  | RectElement
  | CircleElement
  | LineElement
  | ImageElement
  | GroupElement;

// ── Page & Scene ──────────────────────────────────────────────────────────

export interface CanvasPage {
  id: string;
  title: string;
  duration: number;     // seconds
  transition: TransitionEffect;
  elements: CanvasElement[];
}

export interface CanvasSettings {
  width: number;
  height: number;
  background: string;
  gridEnabled: boolean;
  gridSize: number;
  snapToGrid: boolean;
  guides: {
    horizontal: number[];
    vertical: number[];
  };
}

export interface SceneData {
  pages: CanvasPage[];
}

// ── Project ───────────────────────────────────────────────────────────────

export interface CanvasProject {
  id: string;
  workspaceId: string;
  contentItemId: string | null;
  createdBy: string;
  name: string;
  description: string | null;
  sceneData: SceneData;
  settings: CanvasSettings;
  version: number;
  createdAt: string;
  updatedAt: string;
}

// ── Size presets ──────────────────────────────────────────────────────────

export const SIZE_PRESETS = [
  { label: 'Full HD Landscape', width: 1920, height: 1080 },
  { label: 'Full HD Portrait', width: 1080, height: 1920 },
  { label: '4K Landscape', width: 3840, height: 2160 },
  { label: '4K Portrait', width: 2160, height: 3840 },
  { label: 'Square', width: 1080, height: 1080 },
  { label: 'Ultra-wide', width: 3840, height: 1080 },
] as const;

function toFiniteNumber(value: unknown, fallback: number) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function isElementType(value: unknown): value is ElementType {
  return value === 'text'
    || value === 'rect'
    || value === 'circle'
    || value === 'line'
    || value === 'image'
    || value === 'group';
}

function sanitizeBaseElement<T extends BaseElement>(element: T): T {
  return {
    ...element,
    x: toFiniteNumber(element.x, 0),
    y: toFiniteNumber(element.y, 0),
    width: Math.max(1, toFiniteNumber(element.width, 1)),
    height: Math.max(1, toFiniteNumber(element.height, 1)),
    rotation: toFiniteNumber(element.rotation, 0),
    opacity: clamp(toFiniteNumber(element.opacity, 1), 0, 1),
    locked: Boolean(element.locked),
    visible: element.visible !== false,
    name: typeof element.name === 'string' && element.name.trim() ? element.name : 'Element',
  };
}

export function sanitizeCanvasElement(element: CanvasElement): CanvasElement | null {
  if (!isElementType(element?.type)) return null;

  switch (element.type) {
    case 'text': {
      const base = sanitizeBaseElement(element);
      return {
        ...base,
        text: typeof element.text === 'string' ? element.text : '',
        fontSize: Math.max(1, toFiniteNumber(element.fontSize, 32)),
        fontFamily: typeof element.fontFamily === 'string' && element.fontFamily.trim() ? element.fontFamily : 'Inter',
        fontStyle: element.fontStyle ?? '',
        textDecoration: element.textDecoration ?? '',
        fill: typeof element.fill === 'string' && element.fill.trim() ? element.fill : '#ffffff',
        align: element.align ?? 'left',
        verticalAlign: element.verticalAlign ?? 'top',
        lineHeight: Math.max(0.1, toFiniteNumber(element.lineHeight, 1.4)),
        letterSpacing: toFiniteNumber(element.letterSpacing, 0),
        padding: Math.max(0, toFiniteNumber(element.padding, 0)),
      };
    }

    case 'rect': {
      const base = sanitizeBaseElement(element);
      return {
        ...base,
        fill: typeof element.fill === 'string' ? element.fill : '#3b82f6',
        stroke: typeof element.stroke === 'string' ? element.stroke : '',
        strokeWidth: Math.max(0, toFiniteNumber(element.strokeWidth, 0)),
        cornerRadius: Math.max(0, toFiniteNumber(element.cornerRadius, 0)),
      };
    }

    case 'circle': {
      const base = sanitizeBaseElement(element);
      return {
        ...base,
        fill: typeof element.fill === 'string' ? element.fill : '#8b5cf6',
        stroke: typeof element.stroke === 'string' ? element.stroke : '',
        strokeWidth: Math.max(0, toFiniteNumber(element.strokeWidth, 0)),
      };
    }

    case 'line': {
      const base = sanitizeBaseElement(element);
      const rawPoints = Array.isArray(element.points) ? element.points : [];
      const points = rawPoints.map((value) => toFiniteNumber(value, 0));
      return {
        ...base,
        points: points.length >= 4 ? points : [0, 0, Math.max(1, base.width), 0],
        stroke: typeof element.stroke === 'string' ? element.stroke : '#ffffff',
        strokeWidth: Math.max(0, toFiniteNumber(element.strokeWidth, 2)),
        lineCap: element.lineCap ?? 'round',
        lineJoin: element.lineJoin ?? 'round',
      };
    }

    case 'image': {
      const base = sanitizeBaseElement(element);
      return {
        ...base,
        contentItemId: typeof element.contentItemId === 'string' ? element.contentItemId : null,
        src: typeof element.src === 'string' ? element.src : '',
        objectFit: element.objectFit ?? 'cover',
      };
    }

    case 'group': {
      const base = sanitizeBaseElement(element);
      return {
        ...base,
        children: Array.isArray(element.children)
          ? element.children
              .map((child) => sanitizeCanvasElement(child))
              .filter((child): child is CanvasElement => child != null)
          : [],
      };
    }
  }
}

export function sanitizeCanvasPage(page: CanvasPage): CanvasPage {
  return {
    ...page,
    title: typeof page.title === 'string' && page.title.trim() ? page.title : 'Untitled Page',
    duration: Math.max(1, toFiniteNumber(page.duration, 10)),
    transition: page.transition ?? 'none',
    elements: Array.isArray(page.elements)
      ? page.elements
          .map((element) => sanitizeCanvasElement(element))
          .filter((element): element is CanvasElement => element != null)
      : [],
  };
}

export function sanitizeCanvasSettings(settings: Partial<CanvasSettings> | null | undefined): CanvasSettings {
  return {
    width: Math.max(1, toFiniteNumber(settings?.width, 1920)),
    height: Math.max(1, toFiniteNumber(settings?.height, 1080)),
    background: typeof settings?.background === 'string' && settings.background.trim() ? settings.background : '#1a1a2e',
    gridEnabled: settings?.gridEnabled !== false,
    gridSize: Math.max(5, toFiniteNumber(settings?.gridSize, 20)),
    snapToGrid: settings?.snapToGrid !== false,
    guides: {
      horizontal: Array.isArray(settings?.guides?.horizontal)
        ? settings.guides.horizontal.map((value) => toFiniteNumber(value, 0))
        : [],
      vertical: Array.isArray(settings?.guides?.vertical)
        ? settings.guides.vertical.map((value) => toFiniteNumber(value, 0))
        : [],
    },
  };
}

// ── Default element factories ─────────────────────────────────────────────

export function createTextElement(overrides?: Partial<TextElement>): TextElement {
  return {
    id: crypto.randomUUID(),
    type: 'text',
    x: 100,
    y: 100,
    width: 300,
    height: 60,
    rotation: 0,
    opacity: 1,
    locked: false,
    visible: true,
    name: 'Text',
    text: 'Double-click to edit',
    fontSize: 32,
    fontFamily: 'Inter',
    fontStyle: '',
    textDecoration: '',
    fill: '#ffffff',
    align: 'left',
    verticalAlign: 'top',
    lineHeight: 1.4,
    letterSpacing: 0,
    padding: 8,
    ...overrides,
  };
}

export function createRectElement(overrides?: Partial<RectElement>): RectElement {
  return {
    id: crypto.randomUUID(),
    type: 'rect',
    x: 100,
    y: 100,
    width: 200,
    height: 150,
    rotation: 0,
    opacity: 1,
    locked: false,
    visible: true,
    name: 'Rectangle',
    fill: '#3b82f6',
    stroke: '',
    strokeWidth: 0,
    cornerRadius: 0,
    ...overrides,
  };
}

export function createCircleElement(overrides?: Partial<CircleElement>): CircleElement {
  return {
    id: crypto.randomUUID(),
    type: 'circle',
    x: 100,
    y: 100,
    width: 150,
    height: 150,
    rotation: 0,
    opacity: 1,
    locked: false,
    visible: true,
    name: 'Circle',
    fill: '#8b5cf6',
    stroke: '',
    strokeWidth: 0,
    ...overrides,
  };
}

export function createLineElement(overrides?: Partial<LineElement>): LineElement {
  return {
    id: crypto.randomUUID(),
    type: 'line',
    x: 100,
    y: 100,
    width: 200,
    height: 0,
    rotation: 0,
    opacity: 1,
    locked: false,
    visible: true,
    name: 'Line',
    points: [0, 0, 200, 0],
    stroke: '#ffffff',
    strokeWidth: 2,
    lineCap: 'round',
    lineJoin: 'round',
    ...overrides,
  };
}
