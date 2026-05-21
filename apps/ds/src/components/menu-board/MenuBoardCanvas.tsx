import { useMemo } from 'react';
import { Tv2 } from 'lucide-react';
import {
  MENU_BOARD_FONTS,
  type MenuBoardConfig,
  type MenuBoardLayoutId,
} from './menuBoardConfig.js';
import { buildApiUrl } from '../../lib/api.js';

export interface MenuBoardCanvasMenuItem {
  id: string;
  name: string;
  description?: string | null;
  priceCents: number;
  imageUrl: string | null;
}

export interface MenuBoardCanvasCategory {
  id: string;
  name: string;
  color: string | null;
  description?: string | null;
  items: MenuBoardCanvasMenuItem[];
}

export interface MenuBoardCanvasMenu {
  id?: string;
  name: string;
  description?: string | null;
  currency: string;
  categories: MenuBoardCanvasCategory[];
}

export interface MenuBoardCanvasProps {
  config: MenuBoardConfig;
  menu: MenuBoardCanvasMenu | null | undefined;
  /** Visual density preset. */
  density?: 'xs' | 'sm' | 'md' | 'lg';
  /** Optional fallback title (e.g. content item name) when titleOverride is empty. */
  fallbackTitle?: string;
  /** Render as a placeholder for the picker thumbnails (no menu data needed). */
  placeholder?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

const DENSITY_SCALE: Record<NonNullable<MenuBoardCanvasProps['density']>, number> = {
  xs: 0.32,
  sm: 0.55,
  md: 1,
  lg: 1.25,
};

function formatPrice(cents: number, currency: string) {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
  } catch {
    return `$${(cents / 100).toFixed(2)}`;
  }
}

function pickFontStack(id: MenuBoardConfig['fontFamily']) {
  return MENU_BOARD_FONTS.find((f) => f.id === id)?.stack ?? MENU_BOARD_FONTS[0].stack;
}

/** Slightly transparent overlay on top of the user's background so text stays readable. */
function overlayFor(bg: string) {
  // Naive light/dark detection — sum of hex digits.
  if (!bg.startsWith('#') || bg.length < 7) return 'rgba(0,0,0,0)';
  const r = parseInt(bg.slice(1, 3), 16);
  const g = parseInt(bg.slice(3, 5), 16);
  const b = parseInt(bg.slice(5, 7), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.55 ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.42)';
}

function renderCategoryHead(
  cat: MenuBoardCanvasCategory,
  cfg: MenuBoardConfig,
  s: number,
) {
  const accent = cat.color ?? cfg.accentColor;
  const baseSize = 14 * s;
  switch (cfg.categoryHeaderStyle) {
    case 'underline':
      return (
        <div style={{ borderBottom: `${Math.max(1, 2 * s)}px solid ${accent}`, paddingBottom: 4 * s, marginBottom: 6 * s }}>
          <span style={{ fontSize: baseSize, fontWeight: 800, letterSpacing: '0.04em', textTransform: 'uppercase', color: cfg.textColor }}>
            {cat.name}
          </span>
        </div>
      );
    case 'bar':
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 * s, marginBottom: 6 * s }}>
          <span style={{ width: 4 * s, height: baseSize * 1.1, background: accent, borderRadius: 2 }} />
          <span style={{ fontSize: baseSize, fontWeight: 800, color: cfg.textColor, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            {cat.name}
          </span>
        </div>
      );
    case 'pill':
      return (
        <div style={{ marginBottom: 6 * s }}>
          <span style={{
            display: 'inline-block', padding: `${3 * s}px ${10 * s}px`, borderRadius: 999,
            background: accent, color: '#fff', fontSize: baseSize * 0.85, fontWeight: 700,
            letterSpacing: '0.06em', textTransform: 'uppercase',
          }}>{cat.name}</span>
        </div>
      );
    case 'block':
    default:
      return (
        <div style={{
          background: accent, color: '#fff', padding: `${4 * s}px ${8 * s}px`,
          fontSize: baseSize, fontWeight: 800, letterSpacing: '0.04em',
          textTransform: 'uppercase', borderRadius: `${4 * s}px ${4 * s}px 0 0`, marginBottom: 0,
        }}>{cat.name}</div>
      );
  }
}

function renderItemRow(
  item: MenuBoardCanvasMenuItem,
  cfg: MenuBoardConfig,
  s: number,
  currency: string,
  variant: 'list' | 'card' = 'list',
) {
  const imgSrc = item.imageUrl
    ? (item.imageUrl.startsWith('http') || item.imageUrl.startsWith('data:') ? item.imageUrl : buildApiUrl(item.imageUrl))
    : null;

  if (variant === 'card') {
    return (
      <div key={item.id} style={{
        display: 'flex', flexDirection: 'column', gap: 4 * s, padding: 6 * s,
        borderRadius: 8 * s, background: 'rgba(255,255,255,0.05)',
        border: '1px solid rgba(255,255,255,0.08)', minHeight: 60 * s,
      }}>
        {cfg.showImages && imgSrc && (
          <div style={{ width: '100%', aspectRatio: '4 / 3', borderRadius: 6 * s, overflow: 'hidden', background: 'rgba(255,255,255,0.06)' }}>
            <img src={imgSrc} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 6 * s }}>
          <span style={{ fontSize: 13 * s, fontWeight: 700, color: cfg.textColor, lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</span>
          {cfg.showPrices && (
            <span style={{ fontSize: 12 * s, fontWeight: 700, color: cfg.accentColor, whiteSpace: 'nowrap' }}>
              {formatPrice(item.priceCents, currency)}
            </span>
          )}
        </div>
        {cfg.showDescription && item.description && (
          <span style={{ fontSize: 10 * s, color: cfg.textColor, opacity: 0.7, lineHeight: 1.3 }}>{item.description}</span>
        )}
      </div>
    );
  }

  return (
    <div key={item.id} style={{
      display: 'flex', alignItems: 'center', gap: 6 * s,
      padding: `${5 * s}px ${8 * s}px`,
      borderBottom: `1px solid rgba(127,127,127,0.15)`,
    }}>
      {cfg.showImages && imgSrc && (
        <img src={imgSrc} alt="" style={{
          width: 28 * s, height: 28 * s, objectFit: 'cover', borderRadius: 4 * s, flexShrink: 0,
        }} />
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 * s, minWidth: 0, flex: 1 }}>
        <span style={{ fontSize: 12 * s, fontWeight: 600, color: cfg.textColor, lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</span>
        {cfg.showDescription && item.description && (
          <span style={{ fontSize: 9 * s, color: cfg.textColor, opacity: 0.7, lineHeight: 1.25, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.description}</span>
        )}
      </div>
      {cfg.showPrices && (
        <span style={{ fontSize: 12 * s, fontWeight: 700, color: cfg.accentColor, whiteSpace: 'nowrap' }}>
          {formatPrice(item.priceCents, currency)}
        </span>
      )}
    </div>
  );
}

function renderCategoryBlock(
  cat: MenuBoardCanvasCategory,
  cfg: MenuBoardConfig,
  s: number,
  currency: string,
  itemCap: number,
  variant: 'list' | 'card' = 'list',
) {
  const items = cat.items.slice(0, itemCap);
  return (
    <div key={cat.id} style={{ display: 'flex', flexDirection: 'column', breakInside: 'avoid', marginBottom: 8 * s }}>
      {renderCategoryHead(cat, cfg, s)}
      {variant === 'card' ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(' + (110 * s) + 'px, 1fr))', gap: 6 * s }}>
          {items.map((it) => renderItemRow(it, cfg, s, currency, 'card'))}
        </div>
      ) : (
        <div style={{ background: 'rgba(127,127,127,0.05)', borderRadius: cfg.categoryHeaderStyle === 'block' ? `0 0 ${4 * s}px ${4 * s}px` : 4 * s, overflow: 'hidden' }}>
          {items.map((it) => renderItemRow(it, cfg, s, currency, 'list'))}
        </div>
      )}
    </div>
  );
}

/* ── Layout strategies ─────────────────────────────────────────────────────── */

function layoutColumns(
  menu: MenuBoardCanvasMenu, cfg: MenuBoardConfig, s: number, cols: number,
) {
  return (
    <div style={{
      flex: 1, minHeight: 0, columnCount: cols, columnGap: 10 * s,
      padding: 8 * s, overflow: 'hidden',
    }}>
      {menu.categories.map((c) => renderCategoryBlock(c, cfg, s, menu.currency, 8))}
    </div>
  );
}

function layoutFeatured(menu: MenuBoardCanvasMenu, cfg: MenuBoardConfig, s: number) {
  const all = menu.categories.flatMap((c) => c.items.map((i) => ({ ...i, catName: c.name })));
  const hero = all[0];
  const rest = all.slice(1, 9);
  const heroImg = hero?.imageUrl
    ? (hero.imageUrl.startsWith('http') || hero.imageUrl.startsWith('data:') ? hero.imageUrl : buildApiUrl(hero.imageUrl))
    : null;
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 8 * s, padding: 8 * s }}>
      {hero && (
        <div style={{
          display: 'flex', gap: 10 * s, padding: 10 * s,
          border: `1px solid ${cfg.accentColor}`, borderRadius: 10 * s,
          background: 'rgba(255,255,255,0.04)',
        }}>
          {cfg.showImages && heroImg && (
            <div style={{ width: 120 * s, height: 90 * s, borderRadius: 8 * s, overflow: 'hidden', flexShrink: 0 }}>
              <img src={heroImg} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 * s, minWidth: 0, flex: 1 }}>
            <span style={{ fontSize: 10 * s, fontWeight: 700, color: cfg.accentColor, textTransform: 'uppercase', letterSpacing: '0.12em' }}>
              Featured
            </span>
            <span style={{ fontSize: 18 * s, fontWeight: 800, color: cfg.textColor, lineHeight: 1.1 }}>{hero.name}</span>
            {cfg.showPrices && (
              <span style={{ fontSize: 16 * s, fontWeight: 700, color: cfg.accentColor }}>
                {formatPrice(hero.priceCents, menu.currency)}
              </span>
            )}
            {cfg.showDescription && hero.description && (
              <span style={{ fontSize: 11 * s, color: cfg.textColor, opacity: 0.8, lineHeight: 1.4 }}>{hero.description}</span>
            )}
          </div>
        </div>
      )}
      <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6 * s, overflow: 'hidden' }}>
        {rest.map((it) => renderItemRow(it, cfg, s, menu.currency, 'card'))}
      </div>
    </div>
  );
}

function layoutHeroBanner(menu: MenuBoardCanvasMenu, cfg: MenuBoardConfig, s: number) {
  const hero = menu.categories.flatMap((c) => c.items).find((i) => i.imageUrl) ?? menu.categories[0]?.items[0];
  const heroImg = hero?.imageUrl
    ? (hero.imageUrl.startsWith('http') || hero.imageUrl.startsWith('data:') ? hero.imageUrl : buildApiUrl(hero.imageUrl))
    : null;
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      {cfg.showImages && heroImg && (
        <div style={{ position: 'relative', height: 110 * s, flexShrink: 0, overflow: 'hidden' }}>
          <img src={heroImg} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
          <div style={{
            position: 'absolute', inset: 0,
            background: 'linear-gradient(180deg, rgba(0,0,0,0.1) 0%, rgba(0,0,0,0.7) 100%)',
          }} />
          {hero && (
            <div style={{ position: 'absolute', left: 12 * s, bottom: 10 * s, color: '#fff' }}>
              <div style={{ fontSize: 10 * s, color: cfg.accentColor, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Today's Special</div>
              <div style={{ fontSize: 18 * s, fontWeight: 800 }}>{hero.name}</div>
            </div>
          )}
        </div>
      )}
      <div style={{ flex: 1, minHeight: 0, columnCount: 2, columnGap: 10 * s, padding: 8 * s, overflow: 'hidden' }}>
        {menu.categories.map((c) => renderCategoryBlock(c, cfg, s, menu.currency, 6))}
      </div>
    </div>
  );
}

function layoutMagazine(menu: MenuBoardCanvasMenu, cfg: MenuBoardConfig, s: number) {
  const hero = menu.categories.flatMap((c) => c.items).find((i) => i.imageUrl) ?? menu.categories[0]?.items[0];
  const heroImg = hero?.imageUrl
    ? (hero.imageUrl.startsWith('http') || hero.imageUrl.startsWith('data:') ? hero.imageUrl : buildApiUrl(hero.imageUrl))
    : null;
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: '1.05fr 1fr', gap: 10 * s, padding: 8 * s, overflow: 'hidden' }}>
      <div style={{
        position: 'relative', borderRadius: 10 * s, overflow: 'hidden',
        background: cfg.accentColor + '22',
      }}>
        {cfg.showImages && heroImg && (
          <img src={heroImg} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        )}
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, transparent 35%, rgba(0,0,0,0.78) 100%)' }} />
        {hero && (
          <div style={{ position: 'absolute', left: 10 * s, right: 10 * s, bottom: 10 * s, color: '#fff' }}>
            <div style={{ fontSize: 9 * s, fontWeight: 700, letterSpacing: '0.16em', textTransform: 'uppercase', color: cfg.accentColor }}>Editor's Pick</div>
            <div style={{ fontSize: 20 * s, fontWeight: 800, lineHeight: 1.05, marginTop: 2 * s }}>{hero.name}</div>
            {cfg.showPrices && (
              <div style={{ fontSize: 14 * s, fontWeight: 700, marginTop: 3 * s }}>{formatPrice(hero.priceCents, menu.currency)}</div>
            )}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {menu.categories.map((c) => renderCategoryBlock(c, cfg, s, menu.currency, 6))}
      </div>
    </div>
  );
}

function layoutGridCards(menu: MenuBoardCanvasMenu, cfg: MenuBoardConfig, s: number) {
  return (
    <div style={{ flex: 1, minHeight: 0, padding: 8 * s, display: 'flex', flexDirection: 'column', gap: 8 * s, overflow: 'hidden' }}>
      {menu.categories.map((c) => renderCategoryBlock(c, cfg, s, menu.currency, 8, 'card'))}
    </div>
  );
}

function layoutSplit(menu: MenuBoardCanvasMenu, cfg: MenuBoardConfig, s: number) {
  const half = Math.ceil(menu.categories.length / 2);
  const left = menu.categories.slice(0, half);
  const right = menu.categories.slice(half);
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: '1fr 1fr', padding: 8 * s, gap: 10 * s, overflow: 'hidden' }}>
      <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {left.map((c) => renderCategoryBlock(c, cfg, s, menu.currency, 8))}
      </div>
      <div style={{
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        borderLeft: `1px dashed ${cfg.accentColor}55`, paddingLeft: 8 * s,
      }}>
        {right.map((c) => renderCategoryBlock(c, cfg, s, menu.currency, 8))}
      </div>
    </div>
  );
}

const LAYOUT_RENDERERS: Record<MenuBoardLayoutId, (m: MenuBoardCanvasMenu, c: MenuBoardConfig, s: number) => React.ReactNode> = {
  '1-col':       (m, c, s) => layoutColumns(m, c, s, 1),
  '2-col':       (m, c, s) => layoutColumns(m, c, s, 2),
  '3-col':       (m, c, s) => layoutColumns(m, c, s, 3),
  'featured':    layoutFeatured,
  'hero-banner': layoutHeroBanner,
  'magazine':    layoutMagazine,
  'grid-cards':  layoutGridCards,
  'split':       layoutSplit,
};

/* ── Picker thumbnail ─────────────────────────────────────────────────────── */

export function MenuBoardLayoutThumbnail({
  layout, accent = '#dd6b20', selected = false,
}: { layout: MenuBoardLayoutId; accent?: string; selected?: boolean }) {
  const blockColor = selected ? accent : '#94a3b8';
  const lineColor  = selected ? accent + 'cc' : '#cbd5e1';
  const bg = '#0f1117';
  const card = (extra?: React.CSSProperties) => ({
    background: 'rgba(255,255,255,0.06)',
    borderRadius: 2,
    height: 4,
    ...extra,
  } as React.CSSProperties);
  const head = (extra?: React.CSSProperties) => ({
    background: blockColor, borderRadius: 1, height: 3, ...extra,
  } as React.CSSProperties);

  const inner = (() => {
    switch (layout) {
      case '1-col':
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: 4 }}>
            <div style={head()} /><div style={card()} /><div style={card()} />
            <div style={head({ marginTop: 2 })} /><div style={card()} /><div style={card()} />
          </div>
        );
      case '2-col':
        return (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 3, padding: 4 }}>
            {[0, 1].map((i) => (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <div style={head()} /><div style={card()} /><div style={card()} /><div style={card()} />
              </div>
            ))}
          </div>
        );
      case '3-col':
        return (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 2, padding: 4 }}>
            {[0, 1, 2].map((i) => (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                <div style={head()} /><div style={card()} /><div style={card()} />
              </div>
            ))}
          </div>
        );
      case 'featured':
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: 4 }}>
            <div style={{ height: 14, background: blockColor, borderRadius: 2, opacity: 0.85 }} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
              <div style={card()} /><div style={card()} /><div style={card()} /><div style={card()} />
            </div>
          </div>
        );
      case 'hero-banner':
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: 4 }}>
            <div style={{ height: 12, background: blockColor, borderRadius: 2, opacity: 0.85 }} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}><div style={head()} /><div style={card()} /></div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}><div style={head()} /><div style={card()} /></div>
            </div>
          </div>
        );
      case 'magazine':
        return (
          <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr', gap: 3, padding: 4, height: '100%' }}>
            <div style={{ background: blockColor, borderRadius: 2, opacity: 0.85 }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <div style={head()} /><div style={card()} /><div style={card()} /><div style={card()} />
            </div>
          </div>
        );
      case 'grid-cards':
        return (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 2, padding: 4 }}>
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} style={{ background: i % 2 ? blockColor : lineColor, borderRadius: 2, height: 9, opacity: 0.7 }} />
            ))}
          </div>
        );
      case 'split':
        return (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 3, padding: 4, position: 'relative' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <div style={head()} /><div style={card()} /><div style={card()} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <div style={head()} /><div style={card()} /><div style={card()} />
            </div>
            <div style={{ position: 'absolute', left: '50%', top: 4, bottom: 4, width: 1, background: lineColor, opacity: 0.4 }} />
          </div>
        );
    }
  })();

  return (
    <div style={{
      width: '100%', aspectRatio: '16/10', background: bg,
      borderRadius: 6, border: `2px solid ${selected ? accent : 'transparent'}`,
      overflow: 'hidden',
    }}>
      {inner}
    </div>
  );
}

/* ── Main canvas component ────────────────────────────────────────────────── */

export default function MenuBoardCanvas({
  config, menu, density = 'md', fallbackTitle, placeholder = false, className, style,
}: MenuBoardCanvasProps) {
  const s = DENSITY_SCALE[density] * (config.fontScale || 1);

  const rootStyle: React.CSSProperties = {
    width: '100%',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    fontFamily: pickFontStack(config.fontFamily),
    background: config.backgroundImage
      ? `linear-gradient(${overlayFor(config.backgroundColor)}, ${overlayFor(config.backgroundColor)}), url("${config.backgroundImage}") center/cover no-repeat`
      : config.backgroundColor,
    color: config.textColor,
    ...style,
  };

  const placeholderEl = useMemo(() => menu ? null : (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 6 * s, opacity: 0.6 }}>
      <Tv2 size={Math.max(14, 28 * s)} style={{ color: config.accentColor }} />
      <span style={{ fontSize: 11 * s, color: config.textColor }}>
        {placeholder ? 'Live menu preview' : 'No active menu'}
      </span>
    </div>
  ), [menu, s, config.accentColor, config.textColor, placeholder]);

  const renderLayout = LAYOUT_RENDERERS[config.layout] ?? LAYOUT_RENDERERS['2-col'];

  const title = config.titleOverride?.trim() || fallbackTitle || menu?.name || 'Menu Board';

  return (
    <div className={className} style={rootStyle}>
      {config.showHeader && (
        <div style={{
          flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: `${6 * s}px ${10 * s}px`,
          borderBottom: `1px solid ${config.accentColor}33`,
          background: 'rgba(0,0,0,0.18)',
        }}>
          <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            {config.eyebrow && (
              <span style={{ fontSize: 8 * s, fontWeight: 700, letterSpacing: '0.16em', textTransform: 'uppercase', color: config.accentColor }}>
                {config.eyebrow}
              </span>
            )}
            <span style={{ fontSize: 14 * s, fontWeight: 800, color: config.textColor, lineHeight: 1.1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {title}
            </span>
          </div>
          <span style={{ fontSize: 8 * s, opacity: 0.6, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
            {config.layout.replace('-', ' ')}
          </span>
        </div>
      )}
      {menu && menu.categories.length > 0 ? renderLayout(menu, config, s) : placeholderEl}
    </div>
  );
}
