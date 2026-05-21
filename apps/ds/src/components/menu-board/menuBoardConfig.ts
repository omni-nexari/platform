/**
 * Shared types, layout catalog and theme presets for Menu Board configuration.
 *
 * Layouts and themes are referenced by string id from `metadata.layout` / `metadata.theme`
 * so adding new entries here automatically makes them available throughout the app.
 */

export interface MenuBoardConfig {
  posWorkspaceId: string;
  layout: MenuBoardLayoutId;
  showPrices: boolean;
  showImages: boolean;
  showDescription: boolean;
  showHeader: boolean;
  /** Optional user-supplied override for the header title. */
  titleOverride: string | null;
  /** A header eyebrow / subtitle line (defaults to "Live POS Menu"). */
  eyebrow: string | null;
  categoryIds: string[];
  fontScale: number;
  fontFamily: MenuBoardFontId;
  accentColor: string;
  backgroundColor: string;
  textColor: string;
  /** Optional CSS background-image URL (https or data:). */
  backgroundImage: string | null;
  categoryHeaderStyle: MenuBoardCategoryStyle;
  theme: MenuBoardThemeId | 'custom';
}

export type MenuBoardLayoutId =
  | '1-col'
  | '2-col'
  | '3-col'
  | 'featured'
  | 'hero-banner'
  | 'magazine'
  | 'grid-cards'
  | 'split';

export type MenuBoardFontId = 'system' | 'serif' | 'rounded' | 'condensed' | 'mono';

export type MenuBoardCategoryStyle = 'block' | 'underline' | 'bar' | 'pill';

export type MenuBoardThemeId =
  | 'midnight'
  | 'bistro'
  | 'cafe'
  | 'vibrant'
  | 'minimal'
  | 'sunset'
  | 'forest';

export interface MenuBoardLayoutDef {
  id: MenuBoardLayoutId;
  label: string;
  description: string;
  /** Tiny CSS preview rendered as inline divs for the picker thumbnail. */
  preview: 'list-1' | 'list-2' | 'list-3' | 'feat' | 'hero' | 'mag' | 'cards' | 'split';
}

export const MENU_BOARD_LAYOUTS: MenuBoardLayoutDef[] = [
  { id: '1-col',       label: '1 Column',     description: 'Single tall column — best for short menus',           preview: 'list-1' },
  { id: '2-col',       label: '2 Columns',    description: 'Side-by-side categories — the classic look',          preview: 'list-2' },
  { id: '3-col',       label: '3 Columns',    description: 'Compact triple column — fits more items',             preview: 'list-3' },
  { id: 'featured',    label: 'Featured',     description: 'Hero item card + grid of remaining picks',            preview: 'feat' },
  { id: 'hero-banner', label: 'Hero Banner',  description: 'Full-width hero photo on top + categories below',     preview: 'hero' },
  { id: 'magazine',    label: 'Magazine',     description: 'Editorial-style image-led panel + structured list',   preview: 'mag' },
  { id: 'grid-cards',  label: 'Card Grid',    description: 'Image-rich card grid — great for cafés & bakeries',   preview: 'cards' },
  { id: 'split',       label: 'Split Pane',   description: 'Two equal halves — ideal for mains / sides combos',    preview: 'split' },
];

export interface MenuBoardThemeDef {
  id: MenuBoardThemeId;
  label: string;
  background: string;
  text: string;
  accent: string;
  font: MenuBoardFontId;
  categoryHeaderStyle: MenuBoardCategoryStyle;
}

export const MENU_BOARD_THEMES: MenuBoardThemeDef[] = [
  { id: 'midnight', label: 'Midnight',  background: '#0f1117', text: '#f7f2eb', accent: '#dd6b20', font: 'system',    categoryHeaderStyle: 'block'     },
  { id: 'bistro',   label: 'Bistro',    background: '#1c130d', text: '#f7eddc', accent: '#e0a458', font: 'serif',     categoryHeaderStyle: 'underline' },
  { id: 'cafe',     label: 'Café',      background: '#fbf6ed', text: '#1f1813', accent: '#a86b3c', font: 'serif',     categoryHeaderStyle: 'underline' },
  { id: 'vibrant',  label: 'Vibrant',   background: '#101010', text: '#ffffff', accent: '#ff3366', font: 'condensed', categoryHeaderStyle: 'bar'       },
  { id: 'minimal',  label: 'Minimal',   background: '#ffffff', text: '#101010', accent: '#101010', font: 'system',    categoryHeaderStyle: 'underline' },
  { id: 'sunset',   label: 'Sunset',    background: '#2a1230', text: '#fff5e1', accent: '#ff9d4d', font: 'rounded',   categoryHeaderStyle: 'pill'      },
  { id: 'forest',   label: 'Forest',    background: '#0e1f17', text: '#e8f5dc', accent: '#7cc26d', font: 'rounded',   categoryHeaderStyle: 'block'     },
];

export const MENU_BOARD_FONTS: { id: MenuBoardFontId; label: string; stack: string }[] = [
  { id: 'system',    label: 'System',     stack: '-apple-system, "Segoe UI", Roboto, sans-serif' },
  { id: 'serif',     label: 'Serif',      stack: '"Playfair Display", Georgia, "Times New Roman", serif' },
  { id: 'rounded',   label: 'Rounded',    stack: '"Nunito", "Quicksand", system-ui, sans-serif' },
  { id: 'condensed', label: 'Condensed',  stack: '"Oswald", "Bebas Neue", "Arial Narrow", sans-serif' },
  { id: 'mono',      label: 'Mono',       stack: '"JetBrains Mono", ui-monospace, "Courier New", monospace' },
];

export const MENU_BOARD_CATEGORY_STYLES: { id: MenuBoardCategoryStyle; label: string }[] = [
  { id: 'block',     label: 'Solid block' },
  { id: 'underline', label: 'Underlined'  },
  { id: 'bar',       label: 'Side bar'    },
  { id: 'pill',      label: 'Pill badge'  },
];

export const DEFAULT_MENU_BOARD_CONFIG: MenuBoardConfig = {
  posWorkspaceId: '',
  layout: '2-col',
  showPrices: true,
  showImages: true,
  showDescription: false,
  showHeader: true,
  titleOverride: null,
  eyebrow: 'Live POS Menu',
  categoryIds: [],
  fontScale: 1,
  fontFamily: 'system',
  accentColor: '#dd6b20',
  backgroundColor: '#0f1117',
  textColor: '#f7f2eb',
  backgroundImage: null,
  categoryHeaderStyle: 'block',
  theme: 'midnight',
};

export function applyTheme(cfg: MenuBoardConfig, themeId: MenuBoardThemeId): MenuBoardConfig {
  const t = MENU_BOARD_THEMES.find((x) => x.id === themeId);
  if (!t) return cfg;
  return {
    ...cfg,
    theme: themeId,
    backgroundColor: t.background,
    textColor: t.text,
    accentColor: t.accent,
    fontFamily: t.font,
    categoryHeaderStyle: t.categoryHeaderStyle,
  };
}

/**
 * Parse a metadata JSON blob coming from the API into a fully-populated MenuBoardConfig
 * with sensible defaults for any missing fields.
 */
export function parseMenuBoardMetadata(metadata: string | null | undefined): MenuBoardConfig {
  let raw: Record<string, unknown> = {};
  try { raw = metadata ? JSON.parse(metadata) : {}; } catch { /* ignore */ }
  const get = <T,>(key: string, fallback: T): T => (raw[key] === undefined || raw[key] === null ? fallback : raw[key] as T);
  const layoutCandidate = get<string>('layout', '2-col');
  const layout: MenuBoardLayoutId = MENU_BOARD_LAYOUTS.some((l) => l.id === layoutCandidate)
    ? layoutCandidate as MenuBoardLayoutId
    : '2-col';
  return {
    posWorkspaceId:      get('posWorkspaceId', ''),
    layout,
    showPrices:          get('showPrices', true),
    showImages:          get('showImages', true),
    showDescription:     get('showDescription', false),
    showHeader:          get('showHeader', true),
    titleOverride:       get('titleOverride', null),
    eyebrow:             get('eyebrow', 'Live POS Menu'),
    categoryIds:         Array.isArray(raw.categoryIds) ? raw.categoryIds as string[] : [],
    fontScale:           Number.isFinite(raw.fontScale as number) ? Math.min(Math.max(raw.fontScale as number, 0.7), 1.6) : 1,
    fontFamily:          get('fontFamily', 'system'),
    accentColor:         get('accentColor', '#dd6b20'),
    backgroundColor:     get('backgroundColor', '#0f1117'),
    textColor:           get('textColor', '#f7f2eb'),
    backgroundImage:     get('backgroundImage', null),
    categoryHeaderStyle: get('categoryHeaderStyle', 'block'),
    theme:               get('theme', 'midnight'),
  };
}

/** Serialize a MenuBoardConfig + duration into the body shape the API expects. */
export function configToApiBody(cfg: MenuBoardConfig) {
  return {
    posWorkspaceId:      cfg.posWorkspaceId,
    layout:              cfg.layout,
    showPrices:          cfg.showPrices,
    showImages:          cfg.showImages,
    showDescription:     cfg.showDescription,
    showHeader:          cfg.showHeader,
    titleOverride:       cfg.titleOverride,
    eyebrow:             cfg.eyebrow,
    categoryIds:         cfg.categoryIds,
    fontScale:           cfg.fontScale,
    fontFamily:          cfg.fontFamily,
    accentColor:         cfg.accentColor,
    backgroundColor:     cfg.backgroundColor,
    textColor:           cfg.textColor,
    backgroundImage:     cfg.backgroundImage,
    categoryHeaderStyle: cfg.categoryHeaderStyle,
    theme:               cfg.theme,
  };
}
