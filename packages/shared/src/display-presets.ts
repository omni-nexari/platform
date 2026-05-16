/**
 * Display preset library for commercial signage panels.
 *
 * Each entry provides the physical active-area dimensions (mm) needed to
 * convert bezel mm values to pixels via {@link bezelPx}, plus the native
 * panel resolution and typical bezel widths.
 *
 * Values are sourced from manufacturer datasheets.  When in doubt, verify
 * against the official spec sheet for the exact SKU before use in production.
 *
 * Used by:
 *   - API  — auto-populate physicalWidthMm / physicalHeightMm on device pairing
 *   - DS UI — show preset badge + auto-fill bezel inputs in VideowallGridEditor
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DisplayPreset {
  /** Human-readable model label (for UI display). */
  label: string;
  /** Manufacturer name. */
  manufacturer: string;
  /** Native panel resolution [width, height] in pixels. */
  resolution: [number, number];
  /**
   * Physical active (viewable) area [width, height] in millimetres.
   * Required for mm → px bezel conversion.
   */
  activeAreaMm: [number, number];
  /** Typical bezel width per edge in millimetres. */
  bezelMm: { left: number; right: number; top: number; bottom: number };
}

// ── Preset table ──────────────────────────────────────────────────────────────

/**
 * Keys are uppercase model codes.  Where a family shares the same physical
 * shell (e.g. QM55R / QM55R-T) the base code is used as the key and prefix
 * matching in {@link lookupDisplayPreset} handles variant suffixes.
 */
const PRESETS: Record<string, DisplayPreset> = {

  // ── Samsung QB series — standard commercial ────────────────────────────────
  'QB24R': {
    label: 'Samsung QB24R', manufacturer: 'Samsung',
    resolution: [1920, 1080], activeAreaMm: [531.4, 298.9],
    bezelMm: { left: 11.9, right: 11.9, top: 12.9, bottom: 11.9 },
  },
  'QB32R': {
    label: 'Samsung QB32R', manufacturer: 'Samsung',
    resolution: [1920, 1080], activeAreaMm: [708.3, 398.3],
    bezelMm: { left: 11.2, right: 11.2, top: 12.2, bottom: 11.2 },
  },
  'QB43R': {
    label: 'Samsung QB43R', manufacturer: 'Samsung',
    resolution: [3840, 2160], activeAreaMm: [941.2, 529.4],
    bezelMm: { left: 11.2, right: 11.2, top: 12.2, bottom: 11.2 },
  },
  'QB55R': {
    label: 'Samsung QB55R', manufacturer: 'Samsung',
    resolution: [3840, 2160], activeAreaMm: [1209.6, 680.4],
    bezelMm: { left: 11.2, right: 11.2, top: 12.2, bottom: 11.2 },
  },
  'QB65R': {
    label: 'Samsung QB65R', manufacturer: 'Samsung',
    resolution: [3840, 2160], activeAreaMm: [1428.5, 803.7],
    bezelMm: { left: 11.2, right: 11.2, top: 12.2, bottom: 11.2 },
  },
  'QB75R': {
    label: 'Samsung QB75R', manufacturer: 'Samsung',
    resolution: [3840, 2160], activeAreaMm: [1649.8, 927.6],
    bezelMm: { left: 11.2, right: 11.2, top: 12.2, bottom: 11.2 },
  },

  // ── Samsung QM series — ultra-narrow bezel commercial ─────────────────────
  'QM32R': {
    label: 'Samsung QM32R', manufacturer: 'Samsung',
    resolution: [1920, 1080], activeAreaMm: [708.3, 398.3],
    bezelMm: { left: 5.7, right: 5.7, top: 5.7, bottom: 5.7 },
  },
  'QM43R': {
    label: 'Samsung QM43R', manufacturer: 'Samsung',
    resolution: [3840, 2160], activeAreaMm: [941.2, 529.4],
    bezelMm: { left: 5.7, right: 5.7, top: 5.7, bottom: 5.7 },
  },
  'QM55R': {
    label: 'Samsung QM55R', manufacturer: 'Samsung',
    resolution: [3840, 2160], activeAreaMm: [1209.1, 680.1],
    bezelMm: { left: 5.7, right: 5.7, top: 5.7, bottom: 5.7 },
  },
  'QM65R': {
    label: 'Samsung QM65R', manufacturer: 'Samsung',
    resolution: [3840, 2160], activeAreaMm: [1428.5, 803.7],
    bezelMm: { left: 5.7, right: 5.7, top: 5.7, bottom: 5.7 },
  },
  'QM75R': {
    label: 'Samsung QM75R', manufacturer: 'Samsung',
    resolution: [3840, 2160], activeAreaMm: [1649.8, 927.6],
    bezelMm: { left: 5.7, right: 5.7, top: 5.7, bottom: 5.7 },
  },
  'QM85R': {
    label: 'Samsung QM85R', manufacturer: 'Samsung',
    resolution: [3840, 2160], activeAreaMm: [1872.2, 1052.7],
    bezelMm: { left: 5.7, right: 5.7, top: 5.7, bottom: 5.7 },
  },

  // ── Samsung QM-D series ────────────────────────────────────────────────────
  'QM43D': {
    label: 'Samsung QM43D', manufacturer: 'Samsung',
    resolution: [3840, 2160], activeAreaMm: [941.2, 529.4],
    bezelMm: { left: 5.7, right: 5.7, top: 5.7, bottom: 5.7 },
  },
  'QM55D': {
    label: 'Samsung QM55D', manufacturer: 'Samsung',
    resolution: [3840, 2160], activeAreaMm: [1209.1, 680.1],
    bezelMm: { left: 5.7, right: 5.7, top: 5.7, bottom: 5.7 },
  },
  'QM65D': {
    label: 'Samsung QM65D', manufacturer: 'Samsung',
    resolution: [3840, 2160], activeAreaMm: [1428.5, 803.7],
    bezelMm: { left: 5.7, right: 5.7, top: 5.7, bottom: 5.7 },
  },
  'QM85D': {
    label: 'Samsung QM85D', manufacturer: 'Samsung',
    resolution: [3840, 2160], activeAreaMm: [1872.2, 1052.7],
    bezelMm: { left: 5.7, right: 5.7, top: 5.7, bottom: 5.7 },
  },

  // ── Samsung QH series — high-brightness, ultra-narrow bezel ───────────────
  'QH43R': {
    label: 'Samsung QH43R', manufacturer: 'Samsung',
    resolution: [3840, 2160], activeAreaMm: [941.2, 529.4],
    bezelMm: { left: 3.5, right: 3.5, top: 3.5, bottom: 3.5 },
  },
  'QH55R': {
    label: 'Samsung QH55R', manufacturer: 'Samsung',
    resolution: [3840, 2160], activeAreaMm: [1209.1, 680.1],
    bezelMm: { left: 3.5, right: 3.5, top: 3.5, bottom: 3.5 },
  },
  'QH65R': {
    label: 'Samsung QH65R', manufacturer: 'Samsung',
    resolution: [3840, 2160], activeAreaMm: [1428.5, 803.7],
    bezelMm: { left: 3.5, right: 3.5, top: 3.5, bottom: 3.5 },
  },

  // ── LG commercial ─────────────────────────────────────────────────────────
  '55VH7E': {
    label: 'LG 55VH7E', manufacturer: 'LG',
    resolution: [1920, 1080], activeAreaMm: [1209.6, 680.4],
    bezelMm: { left: 5.7, right: 5.7, top: 5.7, bottom: 5.7 },
  },
  '65VH7E': {
    label: 'LG 65VH7E', manufacturer: 'LG',
    resolution: [1920, 1080], activeAreaMm: [1428.5, 803.7],
    bezelMm: { left: 5.7, right: 5.7, top: 5.7, bottom: 5.7 },
  },
};

// ── Lookup ────────────────────────────────────────────────────────────────────

/**
 * Look up a display preset by model code.
 *
 * Matching rules (applied in order):
 *   1. Exact case-insensitive match on the full `modelCode`.
 *   2. The modelCode starts with a known key
 *      (e.g. "QM55R-T" → matches key "QM55R").
 *   3. Returns `null` if no match — callers should gracefully degrade
 *      (no bezel compensation applied).
 *
 * @param modelCode  The model code stored on the device row (from pairing).
 */
export function lookupDisplayPreset(modelCode: string | null | undefined): DisplayPreset | null {
  if (!modelCode) return null;
  const upper = modelCode.toUpperCase().trim();

  // Exact match
  if (PRESETS[upper]) return PRESETS[upper]!;

  // Prefix: modelCode starts with a known key (variant suffix handling)
  for (const [key, preset] of Object.entries(PRESETS)) {
    if (upper.startsWith(key)) return preset;
  }

  return null;
}

/**
 * Return all known presets (for DS UI dropdown / autocomplete).
 * Do not mutate the returned object.
 */
export function getAllDisplayPresets(): Readonly<Record<string, DisplayPreset>> {
  return PRESETS;
}
