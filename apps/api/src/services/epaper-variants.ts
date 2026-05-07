/**
 * E-paper image variant pipeline.
 *
 * Pre-renders JPEG variants of image content sized exactly for an e-paper
 * device's panel (e.g. 2560x1440 or 1600x1200, in either orientation).
 * Variants are cached on disk under:
 *   {STORAGE_ROOT}/epaper/<deviceId>/<contentId>-<panelW>x<panelH>-<mode>.jpg
 *
 * The variant is generated lazily on first request and re-used on subsequent
 * requests. If the source content changes (new contentId), a new variant is
 * produced. The directory is namespaced per-device so panels with different
 * resolutions don't collide.
 */

import path from 'node:path';
import { promises as fs } from 'node:fs';
import { existsSync } from 'node:fs';
import sharp from 'sharp';

const STORAGE_ROOT = process.env['STORAGE_ROOT'] ?? './signage_uploads';

export type EpaperFitMode = 'cover' | 'contain' | 'pad';

export interface EpaperVariantSpec {
  deviceId: string;
  contentId: string;
  srcRelPath: string; // relative to STORAGE_ROOT
  panelW: number;
  panelH: number;
  mode?: EpaperFitMode;
}

export interface EpaperVariantResult {
  absPath: string;
  relPath: string; // relative to STORAGE_ROOT
  generated: boolean;
}

/**
 * Build the canonical relative path for a (device, content, panel, mode) tuple.
 * Path is stable so callers can pre-compute it for URLs without touching disk.
 */
export function epaperVariantRelPath(spec: Omit<EpaperVariantSpec, 'srcRelPath'>): string {
  const mode = spec.mode ?? 'contain';
  return path
    .join('epaper', spec.deviceId, `${spec.contentId}-${spec.panelW}x${spec.panelH}-${mode}.jpg`)
    .replace(/\\/g, '/');
}

/**
 * Render `srcRelPath` to `panelW × panelH` JPEG using the requested fit mode.
 *  - `cover`   — fill the panel and crop excess (default for portrait posters).
 *  - `contain` — letterbox onto white background, preserving aspect ratio.
 *  - `pad`     — alias of contain but with grey background for visibility on white panels.
 *
 * Always emits a baseline JPEG (8-bit) optimised for e-paper displays.
 * Supports both greyscale and colour panels (no forced grayscale conversion).
 */
export async function fitToEpaper(
  srcAbs: string,
  destAbs: string,
  panelW: number,
  panelH: number,
  mode: EpaperFitMode = 'contain'
): Promise<void> {
  await fs.mkdir(path.dirname(destAbs), { recursive: true });

  const pipeline = sharp(srcAbs, { failOn: 'none' }).rotate(); // honour EXIF orientation

  if (mode === 'cover') {
    pipeline.resize(panelW, panelH, { fit: 'cover', position: 'centre' });
  } else {
    const background = mode === 'pad' ? { r: 240, g: 240, b: 240 } : { r: 255, g: 255, b: 255 };
    pipeline.resize(panelW, panelH, {
      fit: 'contain',
      background,
      withoutEnlargement: false,
    });
  }

  await pipeline
    .jpeg({ quality: 85, mozjpeg: true, chromaSubsampling: '4:4:4' })
    .toFile(destAbs);
}

/**
 * Ensure a variant exists for the given spec; generate it if missing.
 * Returns the resolved path and a flag indicating whether it was just rendered.
 */
export async function ensureEpaperVariant(spec: EpaperVariantSpec): Promise<EpaperVariantResult> {
  const relPath = epaperVariantRelPath(spec);
  const absPath = path.resolve(STORAGE_ROOT, relPath);

  if (existsSync(absPath)) {
    return { absPath, relPath, generated: false };
  }

  const srcAbs = path.resolve(STORAGE_ROOT, spec.srcRelPath);
  await fitToEpaper(srcAbs, absPath, spec.panelW, spec.panelH, spec.mode ?? 'contain');
  return { absPath, relPath, generated: true };
}

/**
 * Remove all cached variants for a device (e.g. on unpair, panel size change).
 */
export async function clearEpaperVariantsForDevice(deviceId: string): Promise<void> {
  const dir = path.resolve(STORAGE_ROOT, 'epaper', deviceId);
  await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
}
