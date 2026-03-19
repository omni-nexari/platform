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
