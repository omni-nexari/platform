/**
 * Videowall canvas math — shared across:
 *   - packages/shared (this file)
 *   - apps/api  (manifest builder)
 *   - apps/ds   (author canvas)
 *   - apps/nexari-tizen (player render)
 *
 * Coordinate model
 * ────────────────
 * A videowall is a W×H grid of cells (columns × rows). Each cell has:
 *   - a physical panel (nativeWidthPx × nativeHeightPx, default 1920×1080)
 *   - a position in the grid (positionCol, positionRow)
 *   - optional colSpan / rowSpan (spanning cells occupy multiple grid slots)
 *   - optional tileRotation ('0'|'90'|'180'|'270')
 *
 * The virtual "canvas" is the total pixel size of the assembled wall, computed
 * by summing the widths of each column and heights of each row.
 *
 * Bezel compensation:
 *   Physical bezels between panels represent real-world gaps. The canvas math
 *   inflates the virtual canvas by the bezel widths so that content spans the
 *   bezels naturally — the TV "fills in" the gap by just showing nothing there.
 *   Bezel is expressed in mm and converted to pixels using a px-per-mm factor
 *   derived from the panel's native resolution and its physical size in mm.
 *   When physical size is unknown (most cases), pass `null` for physicalSizeMm`
 *   and bezels are ignored (safe default).
 */

// ── Types ────────────────────────────────────────────────────────────────────

/** Minimal member shape needed for canvas math (subset of DB row). */
export interface WallMember {
  positionCol: number;
  positionRow: number;
  colSpan?: number | null;
  rowSpan?: number | null;
  /** Physical panel width in pixels. Default: 1920 */
  nativeWidthPx?: number | null;
  /** Physical panel height in pixels. Default: 1080 */
  nativeHeightPx?: number | null;
  /** '0' | '90' | '180' | '270'. Default: '0' */
  tileRotation?: string | null;
}

/** Per-cell bezel configuration for the whole wall (mm). */
export interface WallBezels {
  topMm: number;
  rightMm: number;
  bottomMm: number;
  leftMm: number;
}

/** A rectangle on the virtual canvas (all values in pixels, integer). */
export interface CanvasRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** CSS transform values to position a full-wall video behind a single panel. */
export interface TileCssTransform {
  /** Width to set on the <video> element (full wall canvas width). */
  canvasW: number;
  /** Height to set on the <video> element (full wall canvas height). */
  canvasH: number;
  /** translateX to apply (negative — shifts video left to show correct region). */
  translateX: number;
  /** translateY to apply (negative — shifts video up to show correct region). */
  translateY: number;
}

// ── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULT_PANEL_W = 1920;
const DEFAULT_PANEL_H = 1080;

/** Return the logical (post-rotation) width of a member's panel. */
export function panelLogicalW(m: WallMember): number {
  const rot = m.tileRotation ?? '0';
  const w = m.nativeWidthPx ?? DEFAULT_PANEL_W;
  const h = m.nativeHeightPx ?? DEFAULT_PANEL_H;
  return rot === '90' || rot === '270' ? h : w;
}

/** Return the logical (post-rotation) height of a member's panel. */
export function panelLogicalH(m: WallMember): number {
  const rot = m.tileRotation ?? '0';
  const w = m.nativeWidthPx ?? DEFAULT_PANEL_W;
  const h = m.nativeHeightPx ?? DEFAULT_PANEL_H;
  return rot === '90' || rot === '270' ? w : h;
}

// ── Column / row dimension arrays ────────────────────────────────────────────

/**
 * Compute the pixel width of every grid column.
 *
 * A spanning cell (colSpan > 1) contributes its full logical width spread
 * evenly across the columns it occupies.  Single-cell columns use the maximum
 * logical width of all cells assigned to that column.
 *
 * @param members   All members of the group.
 * @param gridCols  Total number of columns in the wall.
 */
export function computeColWidths(members: WallMember[], gridCols: number): number[] {
  const widths = new Array<number>(gridCols).fill(0);

  for (const m of members) {
    const col = m.positionCol;
    const span = m.colSpan ?? 1;
    const logW = panelLogicalW(m);

    if (span === 1) {
      widths[col] = Math.max(widths[col] ?? 0, logW);
    } else {
      // Distribute width evenly; only update cells that currently have 0
      const perCell = Math.round(logW / span);
      for (let c = col; c < col + span && c < gridCols; c++) {
        widths[c] = Math.max(widths[c] ?? 0, perCell);
      }
    }
  }

  // Fill any column that has no member with the average of its neighbours
  // (graceful degradation — should not happen in a well-configured wall).
  for (let c = 0; c < gridCols; c++) {
    if (widths[c] === 0) widths[c] = DEFAULT_PANEL_W;
  }

  return widths;
}

/**
 * Compute the pixel height of every grid row.
 *
 * Mirror of {@link computeColWidths}.
 */
export function computeRowHeights(members: WallMember[], gridRows: number): number[] {
  const heights = new Array<number>(gridRows).fill(0);

  for (const m of members) {
    const row = m.positionRow;
    const span = m.rowSpan ?? 1;
    const logH = panelLogicalH(m);

    if (span === 1) {
      heights[row] = Math.max(heights[row] ?? 0, logH);
    } else {
      const perCell = Math.round(logH / span);
      for (let r = row; r < row + span && r < gridRows; r++) {
        heights[r] = Math.max(heights[r] ?? 0, perCell);
      }
    }
  }

  for (let r = 0; r < gridRows; r++) {
    if (heights[r] === 0) heights[r] = DEFAULT_PANEL_H;
  }

  return heights;
}

// ── Bezel pixel offsets ───────────────────────────────────────────────────────

/**
 * Convert bezel mm values to per-edge pixel widths for a given panel.
 *
 * When `physicalWidthMm` / `physicalHeightMm` are unknown (null), returns
 * zero for all edges (no bezel compensation).
 */
export function bezelPx(
  bezels: WallBezels,
  panelNativeW: number,
  panelNativeH: number,
  physicalWidthMm: number | null,
  physicalHeightMm: number | null,
): { top: number; right: number; bottom: number; left: number } {
  if (physicalWidthMm == null || physicalHeightMm == null || physicalWidthMm === 0 || physicalHeightMm === 0) {
    return { top: 0, right: 0, bottom: 0, left: 0 };
  }
  const pxPerMmH = panelNativeW / physicalWidthMm;
  const pxPerMmV = panelNativeH / physicalHeightMm;
  return {
    top:    Math.round(bezels.topMm    * pxPerMmV),
    right:  Math.round(bezels.rightMm  * pxPerMmH),
    bottom: Math.round(bezels.bottomMm * pxPerMmV),
    left:   Math.round(bezels.leftMm   * pxPerMmH),
  };
}

// ── Canvas dimensions ─────────────────────────────────────────────────────────

/**
 * Total virtual canvas dimensions (sum of all column widths × row heights).
 * Does NOT include bezel compensation — use {@link computeCellRect} which
 * already accounts for bezel-inflated offsets.
 */
export function computeCanvasSize(
  colWidths: number[],
  rowHeights: number[],
): { canvasW: number; canvasH: number } {
  const canvasW = colWidths.reduce((s, w) => s + w, 0);
  const canvasH = rowHeights.reduce((s, h) => s + h, 0);
  return { canvasW, canvasH };
}

// ── Per-cell canvas rect ──────────────────────────────────────────────────────

/**
 * Compute a member's rectangle on the virtual canvas (origin = top-left of
 * wall, all values in pixels).
 *
 * The width/height of the rect is the sum of spanned column/row widths.
 *
 * @param m          The wall member.
 * @param colWidths  Output of {@link computeColWidths}.
 * @param rowHeights Output of {@link computeRowHeights}.
 */
export function computeCellRect(
  m: WallMember,
  colWidths: number[],
  rowHeights: number[],
): CanvasRect {
  const col = m.positionCol;
  const row = m.positionRow;
  const colSpan = m.colSpan ?? 1;
  const rowSpan = m.rowSpan ?? 1;

  let x = 0;
  for (let c = 0; c < col; c++) x += colWidths[c] ?? 0;

  let y = 0;
  for (let r = 0; r < row; r++) y += rowHeights[r] ?? 0;

  let w = 0;
  for (let c = col; c < col + colSpan; c++) w += colWidths[c] ?? 0;

  let h = 0;
  for (let r = row; r < row + rowSpan; r++) h += rowHeights[r] ?? 0;

  return { x, y, w, h };
}

// ── CSS crop transform for Tizen player ──────────────────────────────────────

/**
 * Compute the CSS positioning needed to crop the full-wall `<video>` element
 * so that only this panel's region is visible.
 *
 * Usage in Tizen player:
 * ```
 * const t = computeTileCssTransform(member, colWidths, rowHeights);
 * videoEl.style.width  = t.canvasW + 'px';
 * videoEl.style.height = t.canvasH + 'px';
 * videoEl.style.transform = `translate(${t.translateX}px, ${t.translateY}px)`;
 * container.style.overflow = 'hidden';
 * container.style.width  = panelLogicalW(member) + 'px';
 * container.style.height = panelLogicalH(member) + 'px';
 * ```
 *
 * @param member      The panel/member to render on.
 * @param colWidths   Output of {@link computeColWidths}.
 * @param rowHeights  Output of {@link computeRowHeights}.
 */
export function computeTileCssTransform(
  member: WallMember,
  colWidths: number[],
  rowHeights: number[],
): TileCssTransform {
  const rect = computeCellRect(member, colWidths, rowHeights);
  const { canvasW, canvasH } = computeCanvasSize(colWidths, rowHeights);

  return {
    canvasW,
    canvasH,
    translateX: -rect.x,
    translateY: -rect.y,
  };
}

// ── Content block canvas rect ─────────────────────────────────────────────────

/** Minimal shape of a content block (from videowall layout metadata). */
export interface WallBlock {
  col: number;
  row: number;
  colSpan?: number | null;
  rowSpan?: number | null;
}

/**
 * Compute a content block's rectangle on the virtual canvas.
 * Mirrors {@link computeCellRect} but works on block definitions rather than
 * device members.
 */
export function computeBlockRect(
  block: WallBlock,
  colWidths: number[],
  rowHeights: number[],
): CanvasRect {
  return computeCellRect(
    {
      positionCol: block.col,
      positionRow: block.row,
      colSpan: block.colSpan ?? 1,
      rowSpan: block.rowSpan ?? 1,
    },
    colWidths,
    rowHeights,
  );
}

// ── Manifest helpers (used by API manifest builder) ───────────────────────────

/** Full description of the wall geometry baked into a sync manifest. */
export interface WallGeometry {
  gridCols: number;
  gridRows: number;
  canvasW: number;
  canvasH: number;
  colWidths: number[];
  rowHeights: number[];
  bezels: WallBezels | null;
}

/**
 * Build the wall geometry object from a set of members and group metadata.
 * This is the canonical entry-point used by the manifest builder and the
 * DS author canvas.
 */
export function buildWallGeometry(
  members: WallMember[],
  gridCols: number,
  gridRows: number,
  bezels: WallBezels | null,
): WallGeometry {
  const colWidths  = computeColWidths(members, gridCols);
  const rowHeights = computeRowHeights(members, gridRows);
  const { canvasW, canvasH } = computeCanvasSize(colWidths, rowHeights);

  return { gridCols, gridRows, canvasW, canvasH, colWidths, rowHeights, bezels: bezels ?? null };
}

// ── AVPlay setVideoRoi crop (Tizen 6.0+ B2B/LFD) ─────────────────────────────

/**
 * AVPlay setVideoRoi parameters — ratios in [0.0, 1.0] of source video
 * dimensions.  Pass directly to `webapis.avplay.setVideoRoi(xR, yR, wR, hR)`.
 *
 * The source video must be encoded at full canvas resolution (canvasW × canvasH).
 * setVideoRoi crops the decoded frame to the sub-rectangle that belongs to
 * this panel, so the panel displays only its tile of the wall.
 */
export interface TileVideoRoi {
  /** x offset ratio: offsetX / canvasW */
  xR: number;
  /** y offset ratio: offsetY / canvasH */
  yR: number;
  /** width ratio: cellW / canvasW */
  wR: number;
  /** height ratio: cellH / canvasH */
  hR: number;
}

/**
 * Compute AVPlay `setVideoRoi` parameters for a wall member.
 *
 * All returned values are in [0.0, 1.0] (ratios of source video dimensions).
 * The sum `xR + wR` and `yR + hR` must not exceed 1.0; the math guarantees
 * this as long as the member lies fully inside the canvas.
 *
 * @param member      The panel/member to render on.
 * @param colWidths   Output of {@link computeColWidths}.
 * @param rowHeights  Output of {@link computeRowHeights}.
 */
export function computeTileVideoRoi(
  member: WallMember,
  colWidths: number[],
  rowHeights: number[],
): TileVideoRoi {
  const rect = computeCellRect(member, colWidths, rowHeights);
  const { canvasW, canvasH } = computeCanvasSize(colWidths, rowHeights);

  return {
    xR: rect.x / canvasW,
    yR: rect.y / canvasH,
    wR: rect.w / canvasW,
    hR: rect.h / canvasH,
  };
}
