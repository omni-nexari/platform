/**
 * decoder-ffmpeg.ts
 * ffmpeg.wasm fully local video decoder.
 *
 * Pipeline:
 *   createFFmpeg (corePath bundled in .wgt) →
 *   load() →
 *   fetchFile(videoUrl) → write to VFS →
 *   ffmpeg.run('-i input.mp4 -f rawvideo -pix_fmt rgba output%04d.rgba') →
 *   read all output%.rgba files → build ImageData frame buffer →
 *   return { frames, fps, width, height }
 *
 * The browser codec is never used. All decoding happens in WASM on-device.
 *
 * NOTE: ffmpeg.wasm and ffmpeg-core.wasm must be present at:
 *   ./js/lib/ffmpeg/ffmpeg.js
 *   ./js/lib/ffmpeg/ffmpeg-core.js
 *   ./js/lib/ffmpeg/ffmpeg-core.wasm
 */

import { updateHud } from './perf-hud.js';
import { logger } from './logger.js';

// @ffmpeg/ffmpeg 0.11.x UMD bundle exposes window.FFmpeg = { createFFmpeg, fetchFile }
declare const FFmpeg: { createFFmpeg: any; fetchFile: any };

export interface DecodedVideo {
  frames: ImageData[];
  fps: number;
  width: number;
  height: number;
  durationMs: number;
}

let _ffmpeg: any = null;

/**
 * Pre-decode all frames of the given video URL.
 * Reports progress to the HUD.  Resolves with the complete frame buffer.
 */
export async function decodeVideo(videoUrl: string): Promise<DecodedVideo> {
  logger.info(`[WASM] starting ffmpeg decode: ${videoUrl}`);
  updateHud({ decodePercent: 0, lastAction: 'Initialising ffmpeg…' });

  if (!_ffmpeg) {
    const { createFFmpeg } = FFmpeg;
    _ffmpeg = createFFmpeg({
      corePath: './js/lib/ffmpeg/ffmpeg-core.js',
      log: false,
      logger: ({ message }: { message: string }) => {
        // Parse progress from ffmpeg stderr: "frame=  42 fps= 24"
        const m = message.match(/frame=\s*(\d+)/);
        if (m) {
          const frame = parseInt(m[1], 10);
          // We don't know total yet; show raw frame count
          updateHud({ lastAction: `Decoded ${frame} frames…` });
        }
      },
    });
  }

  if (!_ffmpeg.isLoaded()) {
    logger.info('[WASM] loading ffmpeg-core.wasm…');
    updateHud({ lastAction: 'Loading ffmpeg-core.wasm…', decodePercent: 0 });
    await _ffmpeg.load();
    logger.info('[WASM] ffmpeg-core.wasm loaded');
  }

  // Fetch video from Pi into ffmpeg VFS
  updateHud({ lastAction: 'Fetching video…', decodePercent: 5 });
  const { fetchFile } = FFmpeg;
  const fileData = await fetchFile(videoUrl);
  _ffmpeg.FS('writeFile', 'input.mp4', fileData);

  // Probe: get width, height, fps via ffprobe-like run
  let width = 1920, height = 1080, fps = 25;
  try {
    // Run ffmpeg to stderr to extract stream info
    await _ffmpeg.run('-i', 'input.mp4');
  } catch {
    // ffmpeg exits non-zero when no output is specified — that's expected here
  }
  // Parse from logs is complex; use a safe fallback and let frame data determine size

  // Decode all frames to RGBA
  updateHud({ lastAction: 'Decoding frames…', decodePercent: 10 });
  await _ffmpeg.run(
    '-i', 'input.mp4',
    '-f', 'rawvideo',
    '-pix_fmt', 'rgba',
    '-vf', 'fps=fps=25',   // normalise to 25fps for predictable timing
    'output%04d.rgba',
  );

  // List output files
  let files: string[] = [];
  try {
    files = (_ffmpeg.FS('readdir', '/') as string[])
      .filter((f: string) => f.startsWith('output') && f.endsWith('.rgba'));
    files.sort();
  } catch (e: any) {
    logger.error(`[WASM] readdir failed: ${e?.message}`);
    throw e;
  }

  if (!files.length) throw new Error('ffmpeg produced no output frames');

  logger.info(`[WASM] reading ${files.length} frames`);

  // Read first frame to determine dimensions
  const firstRaw = _ffmpeg.FS('readFile', files[0]) as Uint8Array;
  const totalPixels = firstRaw.length / 4;
  // Common resolutions heuristic
  const KNOWN_WIDTHS = [3840, 1920, 1280, 854, 640];
  for (const w of KNOWN_WIDTHS) {
    if (totalPixels % w === 0) { width = w; height = totalPixels / w; break; }
  }
  fps = 25; // as set in -vf fps filter

  const frames: ImageData[] = [];
  const total = files.length;

  for (let i = 0; i < total; i++) {
    const raw = i === 0 ? firstRaw : (_ffmpeg.FS('readFile', files[i]) as Uint8Array);
    const buf = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer;
    const clamped = new Uint8ClampedArray(buf);
    frames.push(new ImageData(clamped, width, height));

    // Delete from VFS to free RAM
    _ffmpeg.FS('unlink', files[i]);

    const pct = 10 + Math.round((i / total) * 88);
    if (i % 10 === 0) {
      updateHud({ decodePercent: pct, lastAction: `Decoded ${i + 1}/${total} frames` });
      // Yield to let the browser breathe
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  // Clean up input
  try { _ffmpeg.FS('unlink', 'input.mp4'); } catch {}

  const durationMs = (total / fps) * 1000;
  logger.info(`[WASM] decode complete: ${total} frames, ${width}×${height}, ${fps}fps, ${Math.round(durationMs)}ms`);
  updateHud({ decodePercent: null, lastAction: `Decode done (${total} frames)` });

  return { frames, fps, width, height, durationMs };
}
