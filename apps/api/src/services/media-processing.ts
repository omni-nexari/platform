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
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
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
 * Transcode a video in-place to 8-bit H.264 (yuv420p) for maximum compatibility
 * with Android WebView and other constrained players. Replaces the source file
 * atomically; returns the new on-disk size in bytes or null on failure.
 */
export async function transcodeToCompatible(absPath: string): Promise<{ size: number; hash: string } | null> {
  const dir = path.dirname(absPath);
  const base = path.basename(absPath, path.extname(absPath));
  const tmpPath = path.join(dir, `${base}.transcode.mp4`);
  try {
    // H.264 high profile, 8-bit yuv420p, AAC audio, faststart for streaming.
    // CRF 20 is visually transparent for signage at 4K. preset=fast balances
    // quality vs CPU on the API server (Pi/x86).
    await execFileAsync(FFMPEG_BIN, [
      '-y', '-i', absPath,
      '-map', '0:v:0', '-map', '0:a?',
      '-c:v', 'libx264', '-profile:v', 'high', '-pix_fmt', 'yuv420p',
      '-preset', 'fast', '-crf', '20',
      '-c:a', 'aac', '-b:a', '192k',
      '-movflags', '+faststart',
      tmpPath,
    ], { maxBuffer: 64 * 1024 * 1024 });

    // Atomically replace original
    await fs.rename(tmpPath, absPath);
    const stat = await fs.stat(absPath);
    // Recompute sha256 for duplicate detection
    const crypto = await import('node:crypto');
    const fsSync = await import('node:fs');
    const hash = crypto.createHash('sha256');
    await new Promise<void>((resolve, reject) => {
      const stream = fsSync.createReadStream(absPath);
      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('end', () => resolve());
      stream.on('error', reject);
    });
    return { size: stat.size, hash: hash.digest('hex') };
  } catch (err) {
    console.error(`[media] transcode failed for ${absPath}:`, err);
    await fs.unlink(tmpPath).catch(() => undefined);
    return null;
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
export async function processContentMedia(contentId: string): Promise<void> {
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

  // For videos, run transcode-if-needed BEFORE thumbnail generation so the
  // thumbnail is captured from the post-transcode (compatible) file.
  let transcoded: { size: number; hash: string } | null = null;
  let initialVideoProbe: VideoMeta | null = null;
  if (type === 'video') {
    initialVideoProbe = await probeVideo(absPath);
    if (needsTranscode(initialVideoProbe)) {
      console.log(`[media] transcoding ${contentId} (codec=${initialVideoProbe.videoCodec} profile=${initialVideoProbe.codecProfile} pix_fmt=${initialVideoProbe.pixFmt}) for Android compatibility`);
      transcoded = await transcodeToCompatible(absPath);
      if (transcoded) {
        await db.update(contentItems)
          .set({ fileSize: transcoded.size, fileHash: transcoded.hash })
          .where(eq(contentItems.id, contentId));
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
    // Re-probe if we transcoded; otherwise reuse the initial probe.
    const p = transcoded ? await probeVideo(absPath) : (initialVideoProbe ?? await probeVideo(absPath));
    probeWidth = p.width;
    probeHeight = p.height;
    probeDuration = p.duration != null ? Math.round(p.duration) : null;
    probeMetadata = {
      fps: p.fps, bitRate: p.bitRate, maxBitRate: p.maxBitRate,
      videoCodec: p.videoCodec, codecProfile: p.codecProfile, codecLevel: p.codecLevel,
      pixFmt: p.pixFmt,
      ...(transcoded && { transcoded: true }),
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
