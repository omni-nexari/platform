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

/**
 * Get the true base URL of the .wgt package.
 * On Tizen, window.location.href returns bare 'file:///' — the app install path is
 * only accessible via tizen.filesystem.toURI('wgt-package').
 */
function _getWgtBase(): string {
  // 1. Tizen filesystem API — returns e.g. 'file:///opt/usr/apps/{appId}/res/wgt'
  try {
    const uri = (window as any).tizen?.filesystem?.toURI('wgt-package');
    if (uri && typeof uri === 'string' && uri.length > 10) {
      const base = uri.endsWith('/') ? uri : uri + '/';
      logger.info(`[WASM] wgt base (tizen.fs): ${base}`);
      return base;
    }
  } catch (e: any) {
    logger.warn(`[WASM] tizen.filesystem.toURI failed: ${e?.message}`);
  }
  // 2. Derive from a <script> tag's .src property (absolute per HTML spec)
  for (const s of Array.from(document.scripts) as HTMLScriptElement[]) {
    if (s.src && s.src.startsWith('file:///') && s.src.includes('bundle.js')) {
      const base = s.src.replace(/js\/bundle\.js.*$/, '');
      logger.info(`[WASM] wgt base (script.src): ${base}`);
      return base;
    }
  }
  // 3. Last resort — will likely be wrong on Tizen
  const loc = window.location.href.replace(/[^\/]*$/, '');
  logger.warn(`[WASM] wgt base (location.href fallback): ${loc}`);
  return loc;
}

/**
 * Load a file via XHR and return a blob: URL.
 * Blob URLs bypass all file:// path resolution issues in ffmpeg.js internals.
 */
function _loadBlob(absUrl: string, mime: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', absUrl, true);
    xhr.responseType = 'arraybuffer';
    xhr.onload = () => {
      if (xhr.status === 0 || xhr.status >= 400) {
        reject(new Error(`XHR failed (${xhr.status}): ${absUrl}`));
      } else {
        resolve(URL.createObjectURL(new Blob([xhr.response as ArrayBuffer], { type: mime })));
      }
    };
    xhr.onerror = () => reject(new Error(`XHR error: ${absUrl}`));
    xhr.send();
  });
}

/** Load a local file via XHR. Relative paths resolved by browser against wgt base. */
function _xhrGetBytes(url: string): Promise<Uint8Array> {
  // For relative paths, prepend the correct wgt base so we hit the right file.
  const absUrl = url.startsWith('http') || url.startsWith('blob:') || url.startsWith('file:///opt')
    ? url
    : _getWgtBase() + url.replace(/^\.\//, '');
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', absUrl, true);
    xhr.responseType = 'arraybuffer';
    xhr.onload = () => resolve(new Uint8Array(xhr.response as ArrayBuffer));
    xhr.onerror = () => reject(new Error(`XHR failed: ${absUrl}`));
    xhr.send();
  });
}

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

    // Pre-load ffmpeg core files as blob: URLs.
    // ffmpeg.js resolves relative/wrong-base paths internally; blob: URLs bypass
    // all path resolution and work on Tizen's restricted file:// environment.
    const base = _getWgtBase();
    logger.info(`[WASM] loading core files from: ${base}`);
    updateHud({ lastAction: 'Loading ffmpeg core…', decodePercent: 0 });
    const [corePath, wasmPath, workerPath] = await Promise.all([
      _loadBlob(base + 'js/lib/ffmpeg/ffmpeg-core.js',        'application/javascript'),
      _loadBlob(base + 'js/lib/ffmpeg/ffmpeg-core.wasm',      'application/wasm'),
      _loadBlob(base + 'js/lib/ffmpeg/ffmpeg-core.worker.js', 'application/javascript'),
    ]);
    logger.info('[WASM] core blobs created');

    _ffmpeg = createFFmpeg({
      corePath,
      wasmPath,
      workerPath,
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

  // Load video via XHR using the correct wgt base path
  updateHud({ lastAction: 'Fetching video…', decodePercent: 5 });
  const videoBytes = await _xhrGetBytes(videoUrl);
  _ffmpeg.FS('writeFile', 'input.mp4', videoBytes);

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
