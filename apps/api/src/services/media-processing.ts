/**
 * Media processing service.
 *
 * Centralised pipeline for thumbnail generation + metadata probing of uploaded
 * content. Used by:
 *   - The synchronous fallback in `routes/content.ts` (when Redis is unavailable)
 *   - The BullMQ `media-processing` worker (when Redis is available)
 *
 * Both paths must produce identical DB state, so all logic that updates
 * `contentItems` lives here.
 */

import path from 'node:path';
import { promises as fs } from 'node:fs';
import { createReadStream } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID, createHash } from 'node:crypto';
import sharp from 'sharp';
import { db, contentItems } from '@signage/db';
import { eq } from 'drizzle-orm';

const execFileAsync = promisify(execFile);

const FFMPEG_BIN = process.env['FFMPEG_PATH'] ?? 'ffmpeg';
const FFPROBE_BIN = (() => {
  const configured = process.env['FFPROBE_PATH'];
  if (configured) return configured;
  if (/ffmpeg(\.exe)?$/i.test(FFMPEG_BIN)) {
    return FFMPEG_BIN.replace(/ffmpeg(\.exe)?$/i, (_match, ext: string | undefined) => `ffprobe${ext ?? ''}`);
  }
  return 'ffprobe';
})();

const STORAGE_ROOT = process.env['STORAGE_ROOT'] ?? './signage_uploads';

export type MediaType = 'image' | 'video' | 'pdf' | 'presentation' | 'html5';

// ── Thumbnail helpers ─────────────────────────────────────────────────────────

/** Resize any image to a 400-wide JPEG thumbnail. */
export async function generateImageThumb(srcAbs: string, thumbAbs: string): Promise<void> {
  await sharp(srcAbs)
    .resize(400, 225, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toFile(thumbAbs);
}

/** Extract the first decodable frame of a video as a JPEG thumbnail via ffmpeg. */
export async function generateVideoThumb(srcAbs: string, thumbAbs: string): Promise<void> {
  try {
    await execFileAsync(FFMPEG_BIN, ['-ss', '1', '-i', srcAbs, '-vframes', '1', '-s', '400x225', '-y', thumbAbs]);
  } catch {
    await execFileAsync(FFMPEG_BIN, ['-i', srcAbs, '-vframes', '1', '-s', '400x225', '-y', thumbAbs]);
  }
}

/** Render the first page of a PDF to a 400×225 JPEG thumbnail via Ghostscript. */
export async function generatePdfThumb(srcAbs: string, thumbAbs: string): Promise<void> {
  const GS_BIN = process.env['GHOSTSCRIPT_PATH'] ?? 'gs';
  const tmpPath = `${thumbAbs}.tmp.jpg`;
  try {
    await execFileAsync(GS_BIN, [
      '-dNOPAUSE', '-dBATCH', '-dSAFER',
      '-sDEVICE=jpeg', '-dJPEGQ=90', '-r150',
      '-dFirstPage=1', '-dLastPage=1',
      `-sOutputFile=${tmpPath}`,
      srcAbs,
    ]);
    await generateImageThumb(tmpPath, thumbAbs);
  } finally {
    await fs.unlink(tmpPath).catch(() => undefined);
  }
}

/** Convert the first slide of a PPTX/PPT to a 400×225 JPEG thumbnail via LibreOffice. */
export async function generatePresentationThumb(srcAbs: string, thumbAbs: string): Promise<void> {
  const SOFFICE_BIN = process.env['LIBREOFFICE_PATH'] ?? 'soffice';
  const tmpDir = path.dirname(thumbAbs);
  await execFileAsync(SOFFICE_BIN, ['--headless', '--convert-to', 'png', '--outdir', tmpDir, srcAbs]);
  const baseName = path.basename(srcAbs, path.extname(srcAbs));
  const pngPath = path.join(tmpDir, `${baseName}.png`);
  try {
    await generateImageThumb(pngPath, thumbAbs);
  } finally {
    await fs.unlink(pngPath).catch(() => undefined);
  }
}

/**
 * Render the first frame of an HTML5 ZIP package to a thumbnail via Playwright.
 * Returns false if Playwright is not installed; throws on any other failure so
 * the worker/caller can log the real error.
 */
export async function generateHtml5Thumb(zipAbs: string, thumbAbs: string): Promise<boolean> {
  // Playwright is an optional Pi-side dependency — not installed in dev.
  // Use a structural type so the build doesn't require @types/playwright.
  type PwLike = {
    chromium: {
      launch(opts: { headless: boolean; args?: string[]; timeout?: number }): Promise<{
        newContext(opts: { viewport: { width: number; height: number } }): Promise<{
          newPage(): Promise<{
            goto(url: string, opts: { waitUntil: 'networkidle' | 'load'; timeout: number }): Promise<unknown>;
            waitForTimeout(ms: number): Promise<void>;
            screenshot(opts: { type: 'png' }): Promise<Buffer>;
          }>;
          close(): Promise<void>;
        }>;
        close(): Promise<void>;
      }>;
    };
  };
  let pw: PwLike | null = null;
  try {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore -- optional runtime dependency
    pw = (await import('playwright')) as unknown as PwLike;
  } catch {
    return false; // Not installed — skip silently
  }

  const os = await import('node:os');
  const http = await import('node:http');
  const AdmZip = (await import('adm-zip')).default;
  const extractDir = await fs.mkdtemp(path.join(os.tmpdir(), 'html5-thumb-'));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let srv: any = null;

  try {
    new AdmZip(zipAbs).extractAllTo(extractDir, true);
    const indexPath = path.join(extractDir, 'index.html');
    try { await fs.access(indexPath); } catch { return false; }

    // Spin up a minimal static HTTP server so relative assets (css/js/img)
    // load correctly — file:// protocol blocks cross-file sub-resources.
    const MIME: Record<string, string> = {
      '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
      '.mjs': 'application/javascript', '.json': 'application/json',
      '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
      '.svg': 'image/svg+xml', '.gif': 'image/gif', '.webp': 'image/webp',
      '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
    };
    const httpPort = await new Promise<number>((resolve, reject) => {
      srv = http.createServer((req, res) => {
        const urlPath = (req.url ?? '/').split('?')[0]!;
        const filePath = path.join(extractDir, urlPath === '/' ? 'index.html' : urlPath);
        // Prevent path traversal outside extractDir
        if (!filePath.startsWith(extractDir)) { res.writeHead(403); res.end(); return; }
        fs.readFile(filePath)
          .then((data) => {
            const ext = path.extname(filePath).toLowerCase();
            res.writeHead(200, { 'Content-Type': MIME[ext] ?? 'application/octet-stream' });
            res.end(data);
          })
          .catch(() => { res.writeHead(404); res.end(); });
      });
      srv!.listen(0, '127.0.0.1', () => {
        const addr = srv!.address() as { port: number };
        resolve(addr.port);
      });
      srv!.on('error', reject);
    });

    // Overall 60s guard — Playwright can hang on ARM if chromium crashes
    const result = await Promise.race([
      (async () => {
        const browser = await pw!.chromium.launch({
          headless: true,
          timeout: 20_000,
          // Required for running under systemd/Docker/ARM without user namespaces
          args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
        });
        try {
          const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
          const page = await context.newPage();
          await page.goto(`http://127.0.0.1:${httpPort}/`, { waitUntil: 'networkidle', timeout: 15_000 });
          await page.waitForTimeout(1500);
          const buf = await page.screenshot({ type: 'png' });
          await sharp(buf).resize(400, 225, { fit: 'inside' }).jpeg({ quality: 80 }).toFile(thumbAbs);
          return true as const;
        } finally {
          await browser.close();
        }
      })(),
      new Promise<never>((_, rej) =>
        setTimeout(() => rej(new Error('html5-thumb: 60s timeout exceeded')), 60_000),
      ),
    ]);

    return result;
  } finally {
    srv?.close();
    await fs.rm(extractDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

// ── Probing helpers ───────────────────────────────────────────────────────────

interface VideoMeta {
  width: number | null; height: number | null; duration: number | null;
  fps: number | null; bitRate: number | null; maxBitRate: number | null;
  videoCodec: string | null; codecProfile: string | null; codecLevel: number | null;
  pixFmt: string | null;
}

export async function probeVideo(absPath: string): Promise<VideoMeta> {
  try {
    const { stdout } = await execFileAsync(FFPROBE_BIN, [
      '-v', 'quiet', '-print_format', 'json', '-show_streams', '-show_format', absPath,
    ]);
    const d = JSON.parse(stdout) as {
      streams?: Array<{
        codec_type?: string; codec_name?: string; profile?: string; level?: number;
        width?: number; height?: number; r_frame_rate?: string; avg_frame_rate?: string;
        bit_rate?: string; max_bit_rate?: string; duration?: string; pix_fmt?: string;
      }>;
      format?: { duration?: string; bit_rate?: string };
    };
    const vs = d.streams?.find(s => s.codec_type === 'video');
    const fmt = d.format;
    let fps: number | null = null;
    const fpsStr = vs?.r_frame_rate ?? vs?.avg_frame_rate;
    if (fpsStr) {
      const [num, den] = fpsStr.split('/').map(Number);
      if (den && den > 0) fps = Math.round((num! / den) * 100) / 100;
    }
    return {
      width: vs?.width ?? null,
      height: vs?.height ?? null,
      duration: fmt?.duration ? parseFloat(fmt.duration) : (vs?.duration ? parseFloat(vs.duration) : null),
      fps,
      bitRate: fmt?.bit_rate ? parseInt(fmt.bit_rate, 10) : null,
      maxBitRate: vs?.max_bit_rate ? parseInt(vs.max_bit_rate, 10) : (vs?.bit_rate ? parseInt(vs.bit_rate, 10) : null),
      videoCodec: vs?.codec_name ?? null,
      codecProfile: vs?.profile ?? null,
      codecLevel: vs?.level ?? null,
      pixFmt: vs?.pix_fmt ?? null,
    };
  } catch {
    return { width: null, height: null, duration: null, fps: null, bitRate: null, maxBitRate: null, videoCodec: null, codecProfile: null, codecLevel: null, pixFmt: null };
  }
}

/**
 * Detect whether a video needs transcoding for compatibility with Android
 * WebView / Chromium playback. Android WebView fails to display 10-bit HEVC
 * (Main 10 profile, pix_fmt yuv420p10le) — Mali GPU compositor reports
 * "Unrecognised Android chroma siting range" and renders black.
 *
 * Returns true when the file is 10-bit (or any other known-incompatible
 * configuration) and should be transcoded to 8-bit H.264.
 */
export function needsTranscode(meta: VideoMeta): boolean {
  const pix = (meta.pixFmt ?? '').toLowerCase();
  if (pix.includes('10le') || pix.includes('10be') || pix.includes('p010')) return true;
  const profile = (meta.codecProfile ?? '').toLowerCase();
  if (profile.includes('main 10') || profile.includes('main10')) return true;
  return false;
}

/**
 * Transcode a video to an Android-compatible 8-bit H.264 (High, Level 5.1)
 * variant saved ALONGSIDE the original. The original is never touched so
 * Tizen, Windows, and other players keep accessing the native file.
 *
 * Output path: same directory, same base name, suffix `_android.mp4`.
 * Returns the absolute path of the new file, its size, and sha256 hash.
 */
export async function transcodeToCompatible(
  absPath: string,
): Promise<{ absAndroidPath: string; size: number; hash: string } | null> {
  const dir = path.dirname(absPath);
  const base = path.basename(absPath, path.extname(absPath));
  const androidPath = path.join(dir, `${base}_android.mp4`);
  const tmpPath = path.join(dir, `${base}_android.tmp.mp4`);
  try {
    // H.264 High profile, Level 5.1 (max for 4K@60fps), 8-bit yuv420p, AAC audio.
    // CRF 20 is visually transparent for signage at 4K. preset=fast balances
    // encode quality vs CPU time on the Pi / x86 server.
    await execFileAsync(FFMPEG_BIN, [
      '-y', '-i', absPath,
      '-map', '0:v:0', '-map', '0:a?',
      '-c:v', 'libx264',
      '-profile:v', 'high', '-level:v', '5.1',
      '-pix_fmt', 'yuv420p',
      '-preset', 'fast', '-crf', '20',
      '-c:a', 'aac', '-b:a', '192k',
      '-movflags', '+faststart',
      tmpPath,
    ], { maxBuffer: 64 * 1024 * 1024 });

    // Atomically promote temp → final android variant
    await fs.rename(tmpPath, androidPath);
    const stat = await fs.stat(androidPath);
    const crypto = await import('node:crypto');
    const fsSync = await import('node:fs');
    const hashObj = crypto.createHash('sha256');
    await new Promise<void>((resolve, reject) => {
      const stream = fsSync.createReadStream(androidPath);
      stream.on('data', (chunk) => hashObj.update(chunk));
      stream.on('end', () => resolve());
      stream.on('error', reject);
    });
    return { absAndroidPath: androidPath, size: stat.size, hash: hashObj.digest('hex') };
  } catch (err) {
    console.error(`[media] transcode failed for ${absPath}:`, err);
    await fs.unlink(tmpPath).catch(() => undefined);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// VideoReprocessOptions — user-facing wizard configuration
// ─────────────────────────────────────────────────────────────────────────────

export interface VideoReprocessOptions {
  // Video codec
  videoCodec: 'h264' | 'h265' | 'vp9' | 'copy';
  h264Profile?: 'baseline' | 'main' | 'high';
  h264Level?: '3.1' | '4.0' | '4.1' | '5.0' | '5.1' | '5.2';
  h265Profile?: 'main' | 'main10';
  // Quality
  qualityMode: 'crf' | 'bitrate';
  crf?: number;
  videoBitrate?: string;   // e.g. '8000k', '20M'
  encodePreset?: 'ultrafast' | 'superfast' | 'veryfast' | 'faster' | 'fast' | 'medium' | 'slow';
  pixelFormat?: 'yuv420p' | 'yuv422p' | 'yuv444p' | 'yuv420p10le';
  framerate?: number;      // undefined = keep source fps
  // Resolution / scale
  resolution: 'original' | '4k' | '1080p' | '720p' | '480p' | 'custom';
  customWidth?: number;
  customHeight?: number;
  scaleMode?: 'fit' | 'fill' | 'stretch';
  // Trim (seconds from file start)
  trimStart?: number;
  trimEnd?: number;
  // Rotation
  rotation?: 0 | 90 | 180 | 270;
  // Audio
  audioCodec: 'copy' | 'aac' | 'mp3' | 'none';
  audioBitrate?: '64k' | '128k' | '192k' | '256k' | '320k';
  audioChannels?: 'original' | '2' | '1';
  // Output disposition
  //   android_variant  — saves _android.mp4 alongside original; other players unaffected
  //   replace_original — overwrites the source; all players see the new file
  //   new_item         — creates a new content item; original untouched
  outputTarget: 'android_variant' | 'replace_original' | 'new_item';
  // Optional user-supplied name for new_item output or wall tile prefix
  outputName?: string;
  // Video wall — creates rows×cols new content items (one spatially-cropped tile each)
  videoWall?: { cols: number; rows: number };
}

// ─────────────────────────────────────────────────────────────────────────────
// Private ffmpeg helpers
// ─────────────────────────────────────────────────────────────────────────────

function _resolutionDims(opts: VideoReprocessOptions): { w: number; h: number } | null {
  if (opts.resolution === '4k')    return { w: 3840, h: 2160 };
  if (opts.resolution === '1080p') return { w: 1920, h: 1080 };
  if (opts.resolution === '720p')  return { w: 1280, h: 720  };
  if (opts.resolution === '480p')  return { w: 854,  h: 480  };
  if (opts.resolution === 'custom' && opts.customWidth && opts.customHeight)
    return { w: opts.customWidth, h: opts.customHeight };
  return null;
}

/**
 * Optionally swap libx264/libx265 for a hardware encoder when the
 * FFMPEG_HW_ACCEL env var is set ('vaapi' | 'nvenc').
 */
function _resolveVideoEncoder(codec: string): string {
  const hw = (process.env['FFMPEG_HW_ACCEL'] ?? '').toLowerCase();
  if (!hw) return codec;
  if (codec === 'libx264') {
    if (hw === 'nvenc') return 'h264_nvenc';
    if (hw === 'vaapi') return 'h264_vaapi';
  }
  if (codec === 'libx265') {
    if (hw === 'nvenc') return 'hevc_nvenc';
    if (hw === 'vaapi') return 'hevc_vaapi';
  }
  return codec;
}

function _buildFfmpegArgs(
  absInput: string,
  absOutput: string,
  opts: VideoReprocessOptions,
  extraVf?: string,
): string[] {
  const args: string[] = ['-y'];

  // Input-side seek
  if (opts.trimStart && opts.trimStart > 0) args.push('-ss', String(opts.trimStart));
  args.push('-i', absInput);

  // Output-side duration
  if (opts.trimEnd != null && opts.trimEnd > 0) {
    const dur = opts.trimEnd - (opts.trimStart ?? 0);
    if (dur > 0) args.push('-t', String(dur));
  }

  // Stream selection
  args.push('-map', '0:v:0');
  if (opts.audioCodec !== 'none') args.push('-map', '0:a?');

  // ── Video filter chain ────────────────────────────────────────────────────
  const vfParts: string[] = [];
  if (extraVf) vfParts.push(extraVf);

  // Rotation
  if (opts.rotation === 90)       vfParts.push('transpose=1');
  else if (opts.rotation === 180) vfParts.push('vflip,hflip');
  else if (opts.rotation === 270) vfParts.push('transpose=2');

  // Scale (only when codec is not copy)
  if (opts.videoCodec !== 'copy') {
    const dim = _resolutionDims(opts);
    if (dim) {
      const { w, h } = dim;
      if (opts.scaleMode === 'stretch') {
        vfParts.push(`scale=${w}:${h}`);
      } else if (opts.scaleMode === 'fill') {
        vfParts.push(`scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}`);
      } else {
        // fit (default) — letterbox/pillarbox with black padding
        vfParts.push(
          `scale=${w}:${h}:force_original_aspect_ratio=decrease,` +
          `pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2`,
        );
      }
    }
    // Always ensure even pixel dimensions required by most codecs
    vfParts.push('scale=trunc(iw/2)*2:trunc(ih/2)*2');
    if (vfParts.length > 0) args.push('-vf', vfParts.join(','));
  }

  // ── Video codec ───────────────────────────────────────────────────────────
  if (opts.videoCodec === 'copy') {
    args.push('-c:v', 'copy');
  } else if (opts.videoCodec === 'h264') {
    const enc = _resolveVideoEncoder('libx264');
    args.push('-c:v', enc);
    if (enc === 'libx264') {
      if (opts.h264Profile)  args.push('-profile:v', opts.h264Profile);
      if (opts.h264Level)    args.push('-level:v',   opts.h264Level);
      if (opts.pixelFormat)  args.push('-pix_fmt',   opts.pixelFormat);
      if (opts.encodePreset) args.push('-preset',    opts.encodePreset);
      if (opts.qualityMode === 'crf' && opts.crf != null)
        args.push('-crf', String(opts.crf));
      else if (opts.qualityMode === 'bitrate' && opts.videoBitrate)
        args.push('-b:v', opts.videoBitrate);
    } else {
      // HW encoder: pass profile + cq/bitrate flags
      if (opts.h264Profile) args.push('-profile:v', opts.h264Profile);
      if (opts.qualityMode === 'crf' && opts.crf != null)
        args.push('-cq', String(opts.crf));
      else if (opts.qualityMode === 'bitrate' && opts.videoBitrate)
        args.push('-b:v', opts.videoBitrate);
    }
  } else if (opts.videoCodec === 'h265') {
    const enc = _resolveVideoEncoder('libx265');
    args.push('-c:v', enc);
    if (enc === 'libx265') {
      if (opts.h265Profile)  args.push('-profile:v', opts.h265Profile);
      if (opts.pixelFormat)  args.push('-pix_fmt',   opts.pixelFormat);
      if (opts.encodePreset) args.push('-preset',    opts.encodePreset);
      if (opts.qualityMode === 'crf' && opts.crf != null)
        args.push('-crf', String(opts.crf));
      else if (opts.qualityMode === 'bitrate' && opts.videoBitrate)
        args.push('-b:v', opts.videoBitrate);
    } else {
      if (opts.qualityMode === 'crf' && opts.crf != null)
        args.push('-cq', String(opts.crf));
      else if (opts.qualityMode === 'bitrate' && opts.videoBitrate)
        args.push('-b:v', opts.videoBitrate);
    }
  } else if (opts.videoCodec === 'vp9') {
    args.push('-c:v', 'libvpx-vp9');
    if (opts.pixelFormat) args.push('-pix_fmt', opts.pixelFormat);
    if (opts.qualityMode === 'crf' && opts.crf != null)
      args.push('-crf', String(opts.crf), '-b:v', '0');
    else if (opts.qualityMode === 'bitrate' && opts.videoBitrate)
      args.push('-b:v', opts.videoBitrate);
    if (opts.encodePreset) {
      // VP9 uses -deadline / -cpu-used instead of -preset
      const speedMap: Record<string, string> = {
        ultrafast: '8', superfast: '7', veryfast: '6',
        faster: '5', fast: '4', medium: '2', slow: '1',
      };
      args.push('-deadline', 'good', '-cpu-used', speedMap[opts.encodePreset] ?? '4');
    }
  }

  if (opts.framerate) args.push('-r', String(opts.framerate));

  // ── Audio ─────────────────────────────────────────────────────────────────
  if (opts.audioCodec === 'none') {
    args.push('-an');
  } else if (opts.audioCodec === 'copy') {
    args.push('-c:a', 'copy');
  } else {
    args.push('-c:a', opts.audioCodec === 'mp3' ? 'libmp3lame' : 'aac');
    if (opts.audioBitrate) args.push('-b:a', opts.audioBitrate);
    if (opts.audioChannels === '2') args.push('-ac', '2');
    else if (opts.audioChannels === '1') args.push('-ac', '1');
  }

  // faststart for streaming MP4 (skip for WebM/VP9)
  if (!absOutput.endsWith('.webm')) args.push('-movflags', '+faststart');

  args.push(absOutput);
  return args;
}

async function _hashFile(absPath: string): Promise<string> {
  const h = createHash('sha256');
  await new Promise<void>((resolve, reject) => {
    const s = createReadStream(absPath);
    s.on('data', (c) => h.update(c));
    s.on('end', resolve);
    s.on('error', reject);
  });
  return h.digest('hex');
}

// ─────────────────────────────────────────────────────────────────────────────
// reprocessVideoWithOptions — user-initiated transcode with full options
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Run a full user-configured transcode job for an existing content item.
 *
 * outputTarget behaviour:
 *   android_variant  — writes <base>_android.mp4 alongside original; all other
 *                      players (Tizen/Windows/web) continue using the source.
 *   replace_original — overwrites the source in-place; all players see the new file.
 *   new_item         — inserts a new contentItems row; original untouched.
 *
 * videoWall overrides outputTarget: always creates rows×cols new items, each
 * containing one spatially-cropped tile of the source video.
 */
export async function reprocessVideoWithOptions(
  contentId: string,
  opts: VideoReprocessOptions,
  uploadedBy: string,
): Promise<void> {
  const item = await db.query.contentItems.findFirst({ where: eq(contentItems.id, contentId) });
  if (!item || !item.filePath) return;

  const absPath  = path.resolve(STORAGE_ROOT, item.filePath);
  const dir      = path.dirname(absPath);
  const base     = path.basename(absPath, path.extname(absPath));
  const relDir   = path.dirname(item.filePath).replace(/\\/g, '/');

  // ── Video-wall tile split ─────────────────────────────────────────────────
  if (opts.videoWall && opts.videoWall.cols >= 1 && opts.videoWall.rows >= 1) {
    const { cols, rows } = opts.videoWall;
    const tilePrefix = opts.outputName?.trim() || item.name;
    const tileIds: string[] = [];

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const tileId       = randomUUID();
        const tileFilename = `${base}_wall_r${row}c${col}_${tileId}.mp4`;
        const absTile      = path.join(dir, tileFilename);
        const tmpTile      = `${absTile}.tmp`;

        // Even-aligned crop: divide source into equal tiles
        const cropVf =
          `crop=trunc(iw/${cols}/2)*2:trunc(ih/${rows}/2)*2:` +
          `trunc(iw/${cols}/2)*2*${col}:trunc(ih/${rows}/2)*2*${row}`;

        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { videoWall: _vw, ...tileOpts } = opts;
        const ffArgs = _buildFfmpegArgs(absPath, tmpTile, tileOpts as VideoReprocessOptions, cropVf);
        try {
          await execFileAsync(FFMPEG_BIN, ffArgs, { maxBuffer: 128 * 1024 * 1024 });
          await fs.rename(tmpTile, absTile);
        } catch (err) {
          console.error(`[media] wall tile r${row}c${col} failed:`, err);
          await fs.unlink(tmpTile).catch(() => {});
          continue;
        }

        const tileStat    = await fs.stat(absTile);
        const tileRelPath = `${relDir}/${tileFilename}`;
        const tileName    = `${tilePrefix} [R${row + 1}C${col + 1}]`;

        await db.insert(contentItems).values({
          id: tileId,
          workspaceId:  item.workspaceId,
          uploadedBy,
          type:         'video',
          name:         tileName,
          originalName: `${tileName}.mp4`,
          filePath:     tileRelPath,
          mimeType:     'video/mp4',
          fileSize:     tileStat.size,
          folderId:     item.folderId ?? null,
          status:       'processing',
        } as typeof contentItems.$inferInsert);

        const thumbRel = tileRelPath.replace(/\.mp4$/, '_thumb.jpg');
        const thumbAbs = path.resolve(STORAGE_ROOT, thumbRel);
        await generateVideoThumb(absTile, thumbAbs).catch(() => {});

        const tp = await probeVideo(absTile).catch(() => null);
        await db.update(contentItems)
          .set({
            status:        'ready',
            thumbnailPath: thumbRel,
            width:         tp?.width ?? null,
            height:        tp?.height ?? null,
            duration:      tp?.duration != null ? Math.round(tp.duration) : null,
            metadata: JSON.stringify({
              videoCodec:  tp?.videoCodec,
              fps:         tp?.fps,
              pixFmt:      tp?.pixFmt,
              wallTile:    { row, col, rows, cols, sourceContentId: contentId },
            }),
            updatedAt: new Date(),
          })
          .where(eq(contentItems.id, tileId));

        tileIds.push(tileId);
      }
    }

    // Update source item with wallTileIds reference
    let existingMeta: Record<string, unknown> = {};
    try { existingMeta = JSON.parse(item.metadata ?? '{}'); } catch { /* ignore */ }
    await db.update(contentItems)
      .set({ status: 'ready', metadata: JSON.stringify({ ...existingMeta, wallTileIds: tileIds }), updatedAt: new Date() })
      .where(eq(contentItems.id, contentId));
    return;
  }

  // ── Single-file transcode ─────────────────────────────────────────────────
  let outPath: string;
  let outRelPath: string;

  if (opts.outputTarget === 'android_variant') {
    outPath    = path.join(dir, `${base}_android.mp4`);
    outRelPath = `${relDir}/${base}_android.mp4`;
  } else if (opts.outputTarget === 'replace_original') {
    outPath    = absPath;
    outRelPath = item.filePath;
  } else {
    const suffix   = randomUUID().slice(0, 8);
    const filename = `${base}_${suffix}.mp4`;
    outPath    = path.join(dir, filename);
    outRelPath = `${relDir}/${filename}`;
  }

  const tmpPath = `${outPath}.rp_tmp`;
  const ffArgs  = _buildFfmpegArgs(absPath, tmpPath, opts);

  try {
    await execFileAsync(FFMPEG_BIN, ffArgs, { maxBuffer: 128 * 1024 * 1024 });
    await fs.rename(tmpPath, outPath);
  } catch (err) {
    console.error(`[media] reprocess failed for ${contentId}:`, err);
    await fs.unlink(tmpPath).catch(() => {});
    await db.update(contentItems)
      .set({ status: 'error', updatedAt: new Date() })
      .where(eq(contentItems.id, contentId));
    return;
  }

  const stat = await fs.stat(outPath);
  let existingMeta: Record<string, unknown> = {};
  try { existingMeta = JSON.parse(item.metadata ?? '{}'); } catch { /* ignore */ }

  if (opts.outputTarget === 'android_variant') {
    await db.update(contentItems)
      .set({
        status:   'ready',
        metadata: JSON.stringify({ ...existingMeta, androidFilePath: outRelPath }),
        updatedAt: new Date(),
      })
      .where(eq(contentItems.id, contentId));

  } else if (opts.outputTarget === 'replace_original') {
    const newHash = await _hashFile(outPath);
    const probe   = await probeVideo(outPath).catch(() => null);
    const thumbRel = item.filePath.replace(/(\.[^.]+)?$/, '_thumb.jpg');
    const thumbAbs = path.resolve(STORAGE_ROOT, thumbRel);
    await generateVideoThumb(outPath, thumbAbs).catch(() => {});

    await db.update(contentItems)
      .set({
        status:       'ready',
        fileSize:     stat.size,
        fileHash:     newHash,
        thumbnailPath: thumbRel.replace(/\\/g, '/'),
        width:        probe?.width    ?? item.width,
        height:       probe?.height   ?? item.height,
        duration:     probe?.duration != null ? Math.round(probe.duration) : item.duration,
        metadata:     JSON.stringify({
          ...existingMeta,
          videoCodec:   probe?.videoCodec,
          codecProfile: probe?.codecProfile,
          pixFmt:       probe?.pixFmt,
          fps:          probe?.fps,
        }),
        updatedAt: new Date(),
      })
      .where(eq(contentItems.id, contentId));

  } else {
    // new_item
    const newHash  = await _hashFile(outPath);
    const probe    = await probeVideo(outPath).catch(() => null);
    const thumbRel = outRelPath.replace(/\.mp4$/, '_thumb.jpg');
    const thumbAbs = path.resolve(STORAGE_ROOT, thumbRel);
    await generateVideoThumb(outPath, thumbAbs).catch(() => {});

    const newName = opts.outputName?.trim() || `${item.name} (reprocessed)`;

    await db.insert(contentItems).values({
      id:           randomUUID(),
      workspaceId:  item.workspaceId,
      uploadedBy,
      type:         'video',
      name:         newName,
      originalName: `${newName}.mp4`,
      filePath:     outRelPath,
      thumbnailPath: thumbRel,
      mimeType:     'video/mp4',
      fileSize:     stat.size,
      fileHash:     newHash,
      folderId:     item.folderId ?? null,
      width:        probe?.width    ?? null,
      height:       probe?.height   ?? null,
      duration:     probe?.duration != null ? Math.round(probe.duration) : null,
      status:       'ready',
      metadata: JSON.stringify({
        videoCodec:       probe?.videoCodec,
        fps:              probe?.fps,
        pixFmt:           probe?.pixFmt,
        sourceContentId:  contentId,
      }),
    } as typeof contentItems.$inferInsert);

    // Mark the source item as ready (it was set to 'processing' by the route)
    await db.update(contentItems)
      .set({ status: 'ready', updatedAt: new Date() })
      .where(eq(contentItems.id, contentId));
  }
}

export async function probeImage(absPath: string): Promise<{
  width: number | null; height: number | null;
  colorSpace: string | null; hasAlpha: boolean;
  density: number | null; bitsPerSample: number | null;
  channels: number | null; format: string | null; hasProfile: boolean;
  exifOrientation: number | null;
}> {
  try {
    const meta = await sharp(absPath).metadata();
    const DEPTH_BITS: Record<string, number> = { uchar: 8, char: 8, ushort: 16, short: 16, uint: 32, int: 32, float: 32, double: 64 };
    return {
      width: meta.width ?? null,
      height: meta.height ?? null,
      colorSpace: meta.space ?? null,
      hasAlpha: meta.hasAlpha ?? false,
      density: meta.density ?? null,
      bitsPerSample: meta.depth ? (DEPTH_BITS[meta.depth] ?? null) : null,
      channels: meta.channels ?? null,
      format: meta.format ?? null,
      hasProfile: meta.icc != null,
      exifOrientation: meta.orientation ?? null,
    };
  } catch {
    return { width: null, height: null, colorSpace: null, hasAlpha: false, density: null, bitsPerSample: null, channels: null, format: null, hasProfile: false, exifOrientation: null };
  }
}

// ── Single-content processing ─────────────────────────────────────────────────

/**
 * Process a freshly-uploaded content item:
 *   - generate thumbnail (best-effort)
 *   - probe metadata (best-effort)
 *   - update DB row with `status: 'ready'` and probe results
 *
 * On unrecoverable failure sets `status: 'error'`. Never throws.
 */
export async function processContentMedia(contentId: string, opts: { transcode?: boolean } = {}): Promise<void> {
  const item = await db.query.contentItems.findFirst({ where: eq(contentItems.id, contentId) });
  if (!item || !item.filePath) return;

  const type = item.type as MediaType;
  if (!['image', 'video', 'pdf', 'presentation', 'html5'].includes(type)) {
    // Nothing to do — mark ready so listings don't stick on "processing".
    await db.update(contentItems)
      .set({ status: 'ready', updatedAt: new Date() })
      .where(eq(contentItems.id, contentId));
    return;
  }

  const absPath = path.resolve(STORAGE_ROOT, item.filePath);
  const thumbRel = item.filePath.replace(/(\.[^.]+)?$/, '_thumb.jpg');
  const thumbAbs = path.resolve(STORAGE_ROOT, thumbRel);

  // Optional transcode (opt-in via opts.transcode). Most players (Tizen, web,
  // Windows) support 10-bit HEVC natively, so we don't transcode on upload.
  // The reprocess endpoint passes transcode:true to convert 10-bit HEVC files
  // to 8-bit H.264 for Android compatibility.
  let androidFilePath: string | null = null;  // relative to STORAGE_ROOT
  let initialVideoProbe: VideoMeta | null = null;
  if (type === 'video') {
    initialVideoProbe = await probeVideo(absPath);
    if (opts.transcode && needsTranscode(initialVideoProbe)) {
      console.log(`[media] transcoding ${contentId} (codec=${initialVideoProbe.videoCodec} profile=${initialVideoProbe.codecProfile} pix_fmt=${initialVideoProbe.pixFmt}) for Android compatibility`);
      const result = await transcodeToCompatible(absPath);
      if (result) {
        // Store relative path — original filePath/fileHash/fileSize are untouched
        // so Tizen, Windows, and web players continue using the source file.
        androidFilePath = path.relative(path.resolve(STORAGE_ROOT), result.absAndroidPath).replace(/\\/g, '/');
      }
    }
  }

  let thumbnailRelPath: string | undefined;
  try {
    if (type === 'image') {
      await generateImageThumb(absPath, thumbAbs);
      thumbnailRelPath = thumbRel.replace(/\\/g, '/');
    } else if (type === 'video') {
      await generateVideoThumb(absPath, thumbAbs);
      thumbnailRelPath = thumbRel.replace(/\\/g, '/');
    } else if (type === 'pdf') {
      await generatePdfThumb(absPath, thumbAbs);
      thumbnailRelPath = thumbRel.replace(/\\/g, '/');
    } else if (type === 'presentation') {
      await generatePresentationThumb(absPath, thumbAbs);
      thumbnailRelPath = thumbRel.replace(/\\/g, '/');
    } else if (type === 'html5') {
      try {
        const ok = await generateHtml5Thumb(absPath, thumbAbs);
        if (ok) thumbnailRelPath = thumbRel.replace(/\\/g, '/');
      } catch (err) {
        console.error(`[media] html5 thumb failed for ${contentId}:`, err);
      }
    }
  } catch {
    // Thumbnail failure is non-fatal — proceed without
  }

  let probeWidth: number | null = null;
  let probeHeight: number | null = null;
  let probeDuration: number | null = null;
  let probeMetadata: Record<string, unknown> = {};

  if (type === 'video') {
    const p = initialVideoProbe ?? await probeVideo(absPath);
    probeWidth = p.width;
    probeHeight = p.height;
    probeDuration = p.duration != null ? Math.round(p.duration) : null;
    probeMetadata = {
      fps: p.fps, bitRate: p.bitRate, maxBitRate: p.maxBitRate,
      videoCodec: p.videoCodec, codecProfile: p.codecProfile, codecLevel: p.codecLevel,
      pixFmt: p.pixFmt,
      ...(androidFilePath && { androidFilePath }),
    };
  } else if (type === 'image') {
    const p = await probeImage(absPath);
    probeWidth = p.width;
    probeHeight = p.height;
    probeMetadata = {
      colorSpace: p.colorSpace, hasAlpha: p.hasAlpha, density: p.density,
      bitsPerSample: p.bitsPerSample, channels: p.channels, format: p.format,
      hasProfile: p.hasProfile, exifOrientation: p.exifOrientation,
    };
  }

  // Merge probe metadata onto whatever was already stored (e.g. html5 startPage)
  let existingMeta: Record<string, unknown> = {};
  try { existingMeta = JSON.parse(item.metadata ?? '{}'); } catch { /* ignore */ }

  await db.update(contentItems)
    .set({
      status: 'ready',
      ...(thumbnailRelPath && { thumbnailPath: thumbnailRelPath }),
      ...(probeWidth != null && { width: probeWidth }),
      ...(probeHeight != null && { height: probeHeight }),
      ...(probeDuration != null && { duration: probeDuration }),
      metadata: JSON.stringify({ ...existingMeta, ...probeMetadata }),
      updatedAt: new Date(),
    })
    .where(eq(contentItems.id, contentId));
}
