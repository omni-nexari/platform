/**
 * menu-board.ts — POS menu board renderer for player-web.
 *
 * Ported from apps/nexari-tizen/src/player.ts `renderMenuBoard()` and helpers.
 * Fetches /pos/menu from the API and renders a styled menu board.
 */
import type { ContentRecord, PosMenu } from '../api.js';
import type { Api } from '../api.js';

function escapeHtml(s: unknown): string {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function parseMetadata(content: ContentRecord): Record<string, unknown> {
  if (!content.metadata) return {};
  if (typeof content.metadata === 'string') { try { return JSON.parse(content.metadata); } catch { return {}; } }
  return content.metadata as Record<string, unknown>;
}

function sanitizeColor(value: unknown, fallback: string): string {
  if (typeof value !== 'string' || !value.trim()) return fallback;
  const t = value.trim();
  if (/^#[0-9a-fA-F]{3,8}$/.test(t) || /^rgba?\([^)]*\)$/.test(t) || /^hsla?\([^)]*\)$/.test(t)) return t;
  return fallback;
}

function formatPrice(cents: unknown, currency: string): string {
  const norm = typeof currency==='string'&&currency ? currency : 'USD';
  const amount = Math.max(Number(cents)||0, 0) / 100;
  const fd = norm==='JPY' ? 0 : 2;
  try {
    return new Intl.NumberFormat(undefined, { style:'currency', currency:norm, minimumFractionDigits:fd, maximumFractionDigits:fd }).format(amount);
  } catch {
    return `${norm} ${amount.toFixed(fd)}`;
  }
}

function buildStateHtml(title: string, message: string): string {
  return `<div style="display:flex;align-items:center;justify-content:center;height:100%;padding:32px;background:linear-gradient(160deg,#1f1510 0%,#120d0a 100%);color:#f7f2eb;font-family:'Segoe UI',Arial,sans-serif;text-align:center;box-sizing:border-box;"><div style="max-width:720px;"><div style="font-size:30px;font-weight:700;">${escapeHtml(title)}</div><div style="margin-top:12px;font-size:16px;line-height:1.6;color:rgba(247,242,235,0.78);">${escapeHtml(message)}</div></div></div>`;
}

interface Section {
  id: string;
  name: string;
  description?: string;
  color?: string;
  items: Array<{ id:string; name:string; description?:string; priceCents?:number; imageUrl?:string; }>;
}

function getSections(menu: PosMenu, metadata: Record<string, unknown>): Section[] {
  const ids = Array.isArray(metadata['categoryIds']) ? (metadata['categoryIds'] as string[]).filter(v=>typeof v==='string') : [];
  const cats = Array.isArray(menu.categories) ? menu.categories : [];
  const filtered = ids.length>0 ? cats.filter(c=>ids.includes(c.id)) : cats;
  return filtered.map(c => ({ ...c, items: Array.isArray(c.items) ? c.items.filter(Boolean) : [] })).filter(c=>c.items.length>0) as Section[];
}

const VALID_LAYOUTS = ['1-col','2-col','3-col','featured','hero-banner','magazine','grid-cards','split'] as const;
const FONT_STACKS: Record<string,string> = {
  system:    "-apple-system,'Segoe UI',Roboto,sans-serif",
  serif:     "'Playfair Display',Georgia,'Times New Roman',serif",
  rounded:   "'Nunito','Quicksand',system-ui,sans-serif",
  condensed: "'Oswald','Bebas Neue','Arial Narrow',sans-serif",
  mono:      "'JetBrains Mono',ui-monospace,'Courier New',monospace",
};

// ── Sharding helpers (duplicated from menuBoardShard.ts for zero bundle overhead) ──

function shardSections(sections: Section[], screenCount: number, screenIndex: number, strategy: string): Section[] {
  if (screenCount <= 1) return sections;
  const idx = Math.max(0, Math.min(screenCount - 1, screenIndex));
  if (strategy === 'by-category') {
    return sections.filter((_, i) => i % screenCount === idx);
  }
  const allItems: { item: Section['items'][0]; cat: Section }[] = [];
  for (const cat of sections) for (const item of cat.items) allItems.push({ item, cat });
  let slotItems: typeof allItems;
  if (strategy === 'by-item-roundrobin') {
    slotItems = allItems.filter((_, i) => i % screenCount === idx);
  } else {
    const blockSize = Math.ceil(allItems.length / screenCount);
    const start = idx * blockSize;
    slotItems = allItems.slice(start, start + blockSize);
  }
  const catMap = new Map<string, Section>();
  for (const { item, cat } of slotItems) {
    if (!catMap.has(cat.id)) catMap.set(cat.id, { ...cat, items: [] });
    catMap.get(cat.id)!.items.push(item);
  }
  return sections.map((c) => catMap.get(c.id)).filter(Boolean) as Section[];
}

function paginateSections(sections: Section[], itemsPerPage: number): Section[][] {
  const pages: Section[][] = [];
  let current: Section[] = [];
  let count = 0;
  for (const cat of sections) {
    if (cat.items.length === 0) continue;
    if (count > 0 && count + cat.items.length > itemsPerPage) { pages.push(current); current = []; count = 0; }
    if (cat.items.length > itemsPerPage) {
      if (current.length > 0) { pages.push(current); current = []; count = 0; }
      for (let i = 0; i < cat.items.length; i += itemsPerPage) {
        pages.push([{ ...cat, items: cat.items.slice(i, i + itemsPerPage) }]);
      }
    } else { current.push(cat); count += cat.items.length; }
  }
  if (current.length > 0) pages.push(current);
  return pages.length > 0 ? pages : [sections];
}

/** Resolve which screen-index this player instance should render. */
function resolveScreenIndex(meta: Record<string, unknown>, deviceDisplayIndex?: number): number {
  // Priority: playlist-item override (stored in conditions.menuBoardScreenIndex) →
  //           siblings metadata.screenIndex → device.primaryDisplayIndex → 0
  if (Number.isFinite(meta['_playlistScreenIndex'])) return Number(meta['_playlistScreenIndex']);
  if (Number.isFinite(meta['screenIndex'])) return Number(meta['screenIndex']);
  if (Number.isFinite(deviceDisplayIndex)) return Number(deviceDisplayIndex);
  return 0;
}

function buildMenuBoardHtml(content: ContentRecord, menu: PosMenu, metadata: Record<string, unknown>, deviceDisplayIndex?: number): string {
  const layout      = VALID_LAYOUTS.includes(metadata['layout'] as typeof VALID_LAYOUTS[number]) ? String(metadata['layout']) : '2-col';
  const showPrices  = metadata['showPrices'] !== false;
  const showImages  = metadata['showImages'] !== false;
  const showDesc    = metadata['showDescription'] === true;
  const showHeader  = metadata['showHeader'] !== false;
  const fontScaleRaw = Number(metadata['fontScale']);
  const fontScale   = isFinite(fontScaleRaw) ? Math.min(Math.max(fontScaleRaw, 0.7), 1.6) : 1;
  const accentColor     = sanitizeColor(metadata['accentColor'],     '#dd6b20');
  const backgroundColor = sanitizeColor(metadata['backgroundColor'], '#0f1117');
  const textColor       = sanitizeColor(metadata['textColor'],       '#f7f2eb');
  const backgroundImage = typeof metadata['backgroundImage']==='string' && /^https?:|^data:/.test(metadata['backgroundImage'])
    ? metadata['backgroundImage'] : null;
  const backgroundVideoUrl = typeof metadata['backgroundVideoUrl']==='string' && /^https?:/.test(metadata['backgroundVideoUrl'])
    ? metadata['backgroundVideoUrl'] : null;
  const heroImageUrl = typeof metadata['heroImageUrl']==='string' && /^https?:|^data:/.test(metadata['heroImageUrl'])
    ? metadata['heroImageUrl'] : null;
  const fontFamily = FONT_STACKS[metadata['fontFamily'] as string] || FONT_STACKS['system'];
  const catHeadStyle = ['block','underline','bar','pill'].includes(metadata['categoryHeaderStyle'] as string)
    ? String(metadata['categoryHeaderStyle']) : 'block';
  const eyebrow     = typeof metadata['eyebrow']==='string' ? metadata['eyebrow'] : 'Live POS Menu';
  const titleOverride = typeof metadata['titleOverride']==='string' && metadata['titleOverride'].trim()
    ? metadata['titleOverride'].trim() : null;
  const currency    = typeof menu.currency==='string' ? menu.currency : 'USD';

  // Multi-screen sharding
  const screenCount  = Number.isFinite(metadata['screenCount']) ? Math.max(1, Number(metadata['screenCount'])) : 1;
  const splitStrategy = typeof metadata['splitStrategy']==='string' ? metadata['splitStrategy'] : 'by-category';
  const screenIndex  = resolveScreenIndex(metadata, deviceDisplayIndex);
  const rawSections  = getSections(menu, metadata);
  const sections     = shardSections(rawSections, screenCount, screenIndex, splitStrategy);

  if (!sections.length) {
    return buildStateHtml(content.name||'Menu Board', 'No active POS menu items available for this board right now.');
  }

  // Pagination
  const pagMeta = metadata['pagination'] && typeof metadata['pagination']==='object' ? metadata['pagination'] as Record<string,unknown> : {};
  const pagMode = String(pagMeta['mode'] || 'hybrid');
  const itemsPerPage = pagMode !== 'auto-fit' ? Math.max(1, Number.isFinite(pagMeta['itemsPerPage']) ? Number(pagMeta['itemsPerPage']) : 8) : 9999;
  const pageSeconds = Math.max(2, Number.isFinite(pagMeta['pageSeconds']) ? Number(pagMeta['pageSeconds']) : 10);
  const pages = paginateSections(sections, itemsPerPage);

  const isFeatured = layout==='featured'||layout==='hero-banner'||layout==='magazine';

  /** Build the HTML for a single page of sections. */
  function buildPageHtml(pageSections: Section[]): string {
    let featuredItem: Section['items'][0] | null = null;
    if (isFeatured) {
      // Prefer heroImageUrl override, else first image from sections
      if (heroImageUrl) {
        const anyItem = pageSections[0]?.items[0] ?? null;
        if (anyItem) featuredItem = { ...anyItem, imageUrl: heroImageUrl };
      } else {
        for (const cat of pageSections) {
          featuredItem = (showImages && cat.items.find(i=>!!i.imageUrl)) || cat.items[0] || null;
          if (featuredItem) break;
        }
      }
    }

    const boardTitle = titleOverride || content.name || (menu.name ?? 'Menu Board');
    const subtitleParts: string[] = [];
    if (menu.name && menu.name !== boardTitle) subtitleParts.push(menu.name);
    if (menu.description) subtitleParts.push(menu.description);
    subtitleParts.push(`${pageSections.length} ${pageSections.length===1?'category':'categories'}`);
    const subtitle = subtitleParts.join(' | ');
    const sectionCols = layout==='1-col' ? 1 : (layout==='3-col'||layout==='grid-cards') ? Math.min(3, pageSections.length||1) : Math.min(2, pageSections.length||1);

    const featuredKicker = layout==='hero-banner' ? "Today's Special" : layout==='magazine' ? "Editor's Pick" : 'Featured Item';
    const featuredMarkup = isFeatured && featuredItem ? `
      <aside class="menu-board-feature">
        ${(showImages||heroImageUrl)&&featuredItem.imageUrl ? `<div class="menu-board-feature-image"><img src="${escapeHtml(featuredItem.imageUrl)}" alt="${escapeHtml(featuredItem.name)}" /></div>` : ''}
        <div class="menu-board-feature-copy">
          <div class="menu-board-feature-kicker">${escapeHtml(featuredKicker)}</div>
          <div class="menu-board-feature-title">${escapeHtml(featuredItem.name)}</div>
          ${showPrices ? `<div class="menu-board-feature-price">${escapeHtml(formatPrice(featuredItem.priceCents, currency))}</div>` : ''}
          ${showDesc&&featuredItem.description ? `<div class="menu-board-feature-description">${escapeHtml(featuredItem.description)}</div>` : ''}
        </div>
      </aside>` : '';

    const sectionsMarkup = pageSections.map(cat => {
    const catAccent = sanitizeColor(cat.color, accentColor);
    const items = cat.items.map(item => {
      const img = showImages&&item.imageUrl ? `<div class="menu-board-item-image"><img src="${escapeHtml(item.imageUrl)}" alt="${escapeHtml(item.name)}" /></div>` : '';
      const price = showPrices ? `<div class="menu-board-item-price">${escapeHtml(formatPrice(item.priceCents, currency))}</div>` : '';
      const desc = showDesc&&item.description ? `<div class="menu-board-item-description">${escapeHtml(item.description)}</div>` : '';
      return `<article class="menu-board-item ${img?'has-image':'no-image'}">${img}<div class="menu-board-item-copy"><div class="menu-board-item-head"><div class="menu-board-item-name">${escapeHtml(item.name)}</div>${price}</div>${desc}</div></article>`;
    }).join('');
    return `<section class="menu-board-category" style="--menu-board-category-accent:${catAccent};">
      <div class="menu-board-category-head">
        <div>
          <div class="menu-board-category-title">${escapeHtml(cat.name)}</div>
          ${cat.description ? `<div class="menu-board-category-description">${escapeHtml(cat.description)}</div>` : ''}
        </div>
        <div class="menu-board-category-count">${cat.items.length}</div>
      </div>
      <div class="menu-board-item-list">${items}</div>
    </section>`;
  }).join('');

    const bgCss = backgroundImage
      ? `linear-gradient(rgba(0,0,0,0.45),rgba(0,0,0,0.45)),url("${escapeHtml(backgroundImage)}") center/cover no-repeat,${backgroundColor}`
      : backgroundColor;
    const gridClass = `menu-board-grid layout-${layout} cathead-${catHeadStyle}${isFeatured?' is-featured':''}`;

    return `
      <div class="menu-board-shell">
        ${showHeader ? `<header class="menu-board-header">
          <div>
            ${eyebrow ? `<div class="menu-board-eyebrow">${escapeHtml(eyebrow)}</div>` : ''}
            <h1 class="menu-board-title">${escapeHtml(boardTitle)}</h1>
          </div>
        </header>` : ''}
        <div class="${gridClass}">
          ${featuredMarkup}
          <div class="menu-board-sections">${sectionsMarkup}</div>
        </div>
      </div>`;
  } // end buildPageHtml

  // Build all page HTML strings
  const pageHtmls = pages.map((pg, i) => `<div class="mb-page" data-page="${i}" style="display:${i===0?'flex':'none'};flex-direction:column;width:100%;height:100%;position:absolute;inset:0;">${buildPageHtml(pg)}</div>`).join('');
  const bgCss = backgroundImage
    ? `linear-gradient(rgba(0,0,0,0.45),rgba(0,0,0,0.45)),url("${escapeHtml(backgroundImage)}") center/cover no-repeat,${backgroundColor}`
    : backgroundColor;
  const paginationScript = pages.length > 1 ? `
    <script>(function(){
      var pages=document.querySelectorAll('.mb-page');
      var cur=0;
      setInterval(function(){
        pages[cur].style.display='none';
        cur=(cur+1)%pages.length;
        pages[cur].style.display='flex';
        var ind=document.getElementById('mb-page-ind');
        if(ind)ind.textContent=(cur+1)+'/${pages.length}';
      },${pageSeconds * 1000});
    })();<\/script>` : '';
  const pageIndicator = pages.length > 1 ? `<div id="mb-page-ind" style="position:absolute;bottom:12px;right:16px;font-size:12px;opacity:0.55;color:${textColor};z-index:20;">1/${pages.length}</div>` : '';

  return `
    <div class="menu-board-root">
      <style>
        .menu-board-root,.menu-board-root *{box-sizing:border-box;}
        .menu-board-root{--menu-board-accent:${accentColor};--menu-board-scale:${fontScale};width:100%;height:100%;color:${textColor};font-family:${fontFamily};background:${bgCss};position:relative;overflow:hidden;}
        ${backgroundVideoUrl ? `.menu-board-bgvideo{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:0;opacity:0.55;}` : ''}
        .menu-board-shell{width:100%;height:100%;display:flex;flex-direction:column;gap:calc(18px*var(--menu-board-scale));padding:calc(28px*var(--menu-board-scale));overflow:hidden;position:relative;z-index:1;}
        .menu-board-header{display:flex;align-items:flex-end;justify-content:space-between;gap:18px;}
        .menu-board-eyebrow{font-size:calc(12px*var(--menu-board-scale));font-weight:700;letter-spacing:0.16em;text-transform:uppercase;color:var(--menu-board-accent);}
        .menu-board-title{margin:6px 0 0;font-size:calc(34px*var(--menu-board-scale));line-height:1.05;letter-spacing:-0.03em;}
        .menu-board-grid{flex:1;min-height:0;display:grid;grid-template-columns:1fr;gap:calc(18px*var(--menu-board-scale));}
        .menu-board-grid.is-featured{grid-template-columns:minmax(320px,0.95fr) minmax(0,1.75fr);}
        .menu-board-grid.layout-hero-banner{grid-template-columns:1fr;grid-auto-rows:auto 1fr;}
        .menu-board-grid.layout-hero-banner .menu-board-feature{grid-column:1/-1;display:grid;grid-template-columns:1.2fr 1fr;}
        .menu-board-grid.layout-split{grid-template-columns:1fr 1fr;}
        .menu-board-grid.layout-split .menu-board-sections{grid-template-columns:1fr;}
        .menu-board-grid.layout-grid-cards .menu-board-item.has-image .menu-board-item-image{aspect-ratio:4/3;width:100%;height:auto;}
        .menu-board-feature{min-height:0;border:1px solid rgba(255,255,255,0.1);border-radius:26px;overflow:hidden;background:linear-gradient(180deg,rgba(255,255,255,0.08) 0%,rgba(255,255,255,0.03) 100%);display:flex;flex-direction:column;}
        .menu-board-feature-image{height:48%;min-height:210px;background:rgba(255,255,255,0.04);}
        .menu-board-feature-image img{width:100%;height:100%;display:block;object-fit:cover;}
        .menu-board-feature-copy{padding:calc(22px*var(--menu-board-scale));display:flex;flex-direction:column;gap:10px;}
        .menu-board-feature-kicker{font-size:calc(11px*var(--menu-board-scale));letter-spacing:0.16em;text-transform:uppercase;color:var(--menu-board-accent);font-weight:700;}
        .menu-board-feature-title{font-size:calc(30px*var(--menu-board-scale));line-height:1.05;font-weight:800;}
        .menu-board-feature-price{font-size:calc(22px*var(--menu-board-scale));font-weight:700;color:#fff4cf;}
        .menu-board-feature-description{font-size:calc(15px*var(--menu-board-scale));line-height:1.55;color:rgba(247,242,235,0.8);}
        .menu-board-sections{min-height:0;display:grid;align-content:start;gap:calc(16px*var(--menu-board-scale));overflow:hidden;}
        .menu-board-category{min-height:0;display:flex;flex-direction:column;gap:calc(14px*var(--menu-board-scale));padding:calc(18px*var(--menu-board-scale));border-radius:24px;border:1px solid rgba(255,255,255,0.09);background:linear-gradient(180deg,rgba(255,255,255,0.08) 0%,rgba(255,255,255,0.035) 100%);box-shadow:inset 4px 0 0 var(--menu-board-category-accent);}
        .cathead-underline .menu-board-category{background:transparent;box-shadow:none;border-color:transparent;border-bottom:2px solid var(--menu-board-category-accent);border-radius:0;}
        .cathead-bar .menu-board-category{box-shadow:inset 0 6px 0 var(--menu-board-category-accent);padding-top:calc(20px*var(--menu-board-scale));}
        .cathead-pill .menu-board-category{background:transparent;box-shadow:none;}
        .cathead-pill .menu-board-category-title{display:inline-block;padding:4px 14px;border-radius:999px;background:var(--menu-board-category-accent);color:#0f1117;}
        .menu-board-category-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;}
        .menu-board-category-title{font-size:calc(22px*var(--menu-board-scale));line-height:1.1;font-weight:800;overflow-wrap:anywhere;}
        .menu-board-category-description{margin-top:6px;font-size:calc(12px*var(--menu-board-scale));line-height:1.45;color:rgba(247,242,235,0.62);}
        .menu-board-category-count{min-width:calc(32px*var(--menu-board-scale));height:calc(32px*var(--menu-board-scale));padding:0 10px;border-radius:999px;background:rgba(255,255,255,0.08);color:var(--menu-board-accent);display:inline-flex;align-items:center;justify-content:center;font-size:calc(12px*var(--menu-board-scale));font-weight:700;}
        .menu-board-item-list{display:flex;flex-direction:column;gap:calc(10px*var(--menu-board-scale));min-height:0;overflow:hidden;}
        .menu-board-item{display:grid;grid-template-columns:minmax(0,1fr);gap:12px;padding:calc(12px*var(--menu-board-scale));border-radius:18px;background:rgba(255,255,255,0.045);border:1px solid rgba(255,255,255,0.06);}
        .menu-board-item.has-image{grid-template-columns:calc(74px*var(--menu-board-scale)) minmax(0,1fr);}
        .menu-board-item-image{width:calc(74px*var(--menu-board-scale));height:calc(74px*var(--menu-board-scale));border-radius:14px;overflow:hidden;background:rgba(255,255,255,0.06);}
        .menu-board-item-image img{width:100%;height:100%;display:block;object-fit:cover;}
        .menu-board-item-copy{min-width:0;display:flex;flex-direction:column;gap:6px;}
        .menu-board-item-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;}
        .menu-board-item-name{min-width:0;font-size:calc(17px*var(--menu-board-scale));line-height:1.25;font-weight:700;overflow-wrap:anywhere;}
        .menu-board-item-price{white-space:nowrap;font-size:calc(14px*var(--menu-board-scale));font-weight:700;color:#fff4cf;}
        .menu-board-item-description{font-size:calc(12px*var(--menu-board-scale));line-height:1.45;color:rgba(247,242,235,0.72);overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;}
        .mb-page{flex-direction:column;}
      </style>
      ${backgroundVideoUrl ? `<video class="menu-board-bgvideo" src="${escapeHtml(backgroundVideoUrl)}" autoplay muted loop playsinline></video>` : ''}
      ${pageHtmls}
      ${pageIndicator}
      ${paginationScript}
    </div>`;
}

export async function renderMenuBoard(
  container: HTMLElement,
  content: ContentRecord,
  api: Api,
): Promise<void> {
  const meta = parseMetadata(content);
  const posWorkspaceId = typeof meta['posWorkspaceId']==='string' && meta['posWorkspaceId'] ? String(meta['posWorkspaceId']) : null;

  if (!posWorkspaceId) {
    container.innerHTML = buildStateHtml(content.name||'Menu Board', 'This menu board is missing its POS workspace source.');
    return;
  }

  const reqId = `mb-${Date.now()}`;
  (container as HTMLElement & { _mbReqId?: string })._mbReqId = reqId;
  container.innerHTML = buildStateHtml(content.name||'Menu Board', 'Loading the latest POS menu…');

  try {
    const menu = await api.getPosMenu(posWorkspaceId);
    if (!container.isConnected || (container as HTMLElement & { _mbReqId?: string })._mbReqId !== reqId) return;
    if (!menu) {
      container.innerHTML = buildStateHtml(content.name||'Menu Board', 'The live POS menu could not be loaded.');
      return;
    }
    container.innerHTML = buildMenuBoardHtml(content, menu, meta);
  } catch {
    if (!container.isConnected || (container as HTMLElement & { _mbReqId?: string })._mbReqId !== reqId) return;
    container.innerHTML = buildStateHtml(content.name||'Menu Board', 'The live POS menu could not be loaded. Check the API connection or publish an active menu.');
  }
}
