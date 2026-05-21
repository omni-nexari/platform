/**
 * menuBoardShard.ts
 *
 * Pure, side-effect-free helpers for splitting a menu-board's sections
 * across multiple physical screens and paginating items within a shard.
 *
 * Shared between the DS wizard preview and all three players.
 */

import type { SplitStrategy, PaginationConfig } from './menuBoardConfig.js';

export interface ShardSection {
  id: string;
  name: string;
  description?: string | null;
  color?: string | null;
  items: ShardItem[];
}

export interface ShardItem {
  id: string;
  name: string;
  description?: string | null;
  priceCents?: number;
  imageUrl?: string | null;
}

/** A single rendered page — a slice of sections (and their items) that fit on screen. */
export interface BoardPage {
  sections: ShardSection[];
}

// ── Sharding ─────────────────────────────────────────────────────────────────

/**
 * Return the subset of `sections` that belong to `screenIndex` when the
 * content is split across `screenCount` screens using `strategy`.
 *
 * - by-category:       whole categories are distributed round-robin by category index.
 * - by-item-sequential: items from all categories are concatenated, then sliced into
 *                       equal contiguous blocks. Each screen gets a synthetic set of sections.
 * - by-item-roundrobin: same as sequential but items are distributed round-robin.
 */
export function shardSections(
  sections: ShardSection[],
  screenCount: number,
  screenIndex: number,
  strategy: SplitStrategy,
): ShardSection[] {
  if (screenCount <= 1) return sections;
  const idx = Math.max(0, Math.min(screenCount - 1, screenIndex));

  if (strategy === 'by-category') {
    return sections.filter((_, i) => i % screenCount === idx);
  }

  // Flatten all items with a reference to their parent category.
  const allItems: { item: ShardItem; cat: ShardSection }[] = [];
  for (const cat of sections) {
    for (const item of cat.items) {
      allItems.push({ item, cat });
    }
  }

  let slotItems: typeof allItems;
  if (strategy === 'by-item-roundrobin') {
    slotItems = allItems.filter((_, i) => i % screenCount === idx);
  } else {
    // by-item-sequential
    const blockSize = Math.ceil(allItems.length / screenCount);
    const start = idx * blockSize;
    slotItems = allItems.slice(start, start + blockSize);
  }

  // Reassemble items into their original categories (preserving category order).
  const catMap = new Map<string, ShardSection>();
  for (const { item, cat } of slotItems) {
    if (!catMap.has(cat.id)) {
      catMap.set(cat.id, { ...cat, items: [] });
    }
    catMap.get(cat.id)!.items.push(item);
  }
  // Return in original category order.
  return sections.map((c) => catMap.get(c.id)).filter(Boolean) as ShardSection[];
}

// ── Pagination ────────────────────────────────────────────────────────────────

/**
 * Splits `sections` into pages so that no page exceeds `maxItems` items total.
 *
 * Categories are kept whole where possible. If a single category has more
 * items than `maxItems`, it is split across consecutive pages.
 */
export function paginateSections(
  sections: ShardSection[],
  cfg: PaginationConfig,
): BoardPage[] {
  const maxItems = Math.max(1, cfg.itemsPerPage);

  const pages: BoardPage[] = [];
  let currentPage: ShardSection[] = [];
  let currentCount = 0;

  for (const cat of sections) {
    if (cat.items.length === 0) continue;

    // If adding this whole category would exceed the cap, flush current page first.
    if (currentCount > 0 && currentCount + cat.items.length > maxItems) {
      pages.push({ sections: currentPage });
      currentPage = [];
      currentCount = 0;
    }

    // If category itself is larger than a full page, split it.
    if (cat.items.length > maxItems) {
      // Flush any in-progress page first.
      if (currentPage.length > 0) {
        pages.push({ sections: currentPage });
        currentPage = [];
        currentCount = 0;
      }
      for (let i = 0; i < cat.items.length; i += maxItems) {
        pages.push({ sections: [{ ...cat, items: cat.items.slice(i, i + maxItems) }] });
      }
    } else {
      currentPage.push(cat);
      currentCount += cat.items.length;
    }
  }

  if (currentPage.length > 0) pages.push({ sections: currentPage });
  return pages.length > 0 ? pages : [{ sections }];
}

/**
 * Convenience: shard then paginate in one call.
 * Returns pages for the given screen index.
 */
export function getPagesForScreen(
  sections: ShardSection[],
  screenCount: number,
  screenIndex: number,
  strategy: SplitStrategy,
  pagination: PaginationConfig,
): BoardPage[] {
  const shard = shardSections(sections, screenCount, screenIndex, strategy);
  if ((pagination.mode as string) === 'cycle') {
    // 'cycle' mode is handled externally — return all sections as one page.
    return [{ sections: shard }];
  }
  return paginateSections(shard, pagination);
}
