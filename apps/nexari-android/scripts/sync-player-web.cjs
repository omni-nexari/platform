#!/usr/bin/env node
// Copies the built @signage/player-web bundle into android/app/src/main/assets/web/.
// Run before assembling the APK. Falls back to source files (esbuild dev) if dist is absent.

const fs = require('fs');
const path = require('path');

const SRC_DIST = path.resolve(__dirname, '..', '..', 'player-web', 'dist');
const SRC_SRC  = path.resolve(__dirname, '..', '..', 'player-web', 'src');
const DEST     = path.resolve(__dirname, '..', 'android', 'app', 'src', 'main', 'assets', 'web');

function rmrf(dir) {
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}
function cp(src, dst) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  if (fs.statSync(src).isDirectory()) {
    fs.mkdirSync(dst, { recursive: true });
    for (const entry of fs.readdirSync(src)) cp(path.join(src, entry), path.join(dst, entry));
  } else {
    fs.copyFileSync(src, dst);
  }
}

// Logo source — always ship alongside the bundle.
const LOGO_SRC = path.resolve(__dirname, '..', '..', '..', 'Docs', 'logo', 'nexari.png');

rmrf(DEST);
fs.mkdirSync(DEST, { recursive: true });

if (fs.existsSync(SRC_DIST)) {
  console.log('[sync-player-web] copying built dist/ → android assets');
  cp(SRC_DIST, DEST);
} else {
  console.warn('[sync-player-web] dist/ not found — copying src/ (run `pnpm --filter @signage/player-web build` first for a release build)');
  cp(SRC_SRC, DEST);
}

// Always ship a tiny index.html that boots the player. Hosts that want a
// different bootstrap can override after this script runs.
const INDEX = path.join(DEST, 'index.html');
// Always write the index.html (overwrite if present) to keep it in sync.
fs.writeFileSync(INDEX, `<!doctype html>
<html><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no"/>
<title>Nexari Player</title>
<style>html,body{margin:0;padding:0;background:#000;width:100%;height:100%;overflow:hidden}#player-root{position:fixed;inset:0}</style>
</head><body>
<div id="player-root"></div>
<script type="module">
import { Player } from './bundle.js';
// Inject the async-adapter shim so makeJsAdapter() becomes available.
if (window.AndroidBridge && window.AndroidBridge.makeJsAdapterScript) {
  (0, eval)(window.AndroidBridge.makeJsAdapterScript());
}
const adapter = (window.AndroidBridge && typeof window.AndroidBridge.makeJsAdapter === 'function')
  ? window.AndroidBridge.makeJsAdapter()
  : null;
if (!adapter) {
  document.body.style.color = '#fff';
  document.body.textContent = 'AndroidBridge not available';
} else {
  const cfg = JSON.parse(window.AndroidBridge.getConfig());
  const apiBase = cfg.apiBase || '';
  const wsBase  = cfg.wsBase  || '';
  const player = new Player({ apiBase, wsBase, adapter, container: document.getElementById('player-root') });
  player.start().catch(e => {
    document.body.style.color = '#fff';
    document.body.textContent = 'boot failed: ' + e.message;
  });
}
</script>
</body></html>
`);

// Copy the Nexari logo so the pairing screen and splash can use it.
if (fs.existsSync(LOGO_SRC)) {
  fs.copyFileSync(LOGO_SRC, path.join(DEST, 'nexari-logo.png'));
  console.log('[sync-player-web] copied nexari-logo.png');
} else {
  console.warn('[sync-player-web] nexari-logo.png not found at', LOGO_SRC);
}

// Copy PDF.js (v2) from the Tizen player's vendored modules so the Android
// player can render PDFs offline. The renderer in player-web/src/player.ts
// lazy-loads ./pdfjs/pdf.min.js, which sets workerSrc to ./pdfjs/pdf.worker.min.js.
const PDFJS_SRC_DIR = path.resolve(__dirname, '..', '..', 'nexari-tizen', 'js', 'modules');
const PDFJS_DST_DIR = path.join(DEST, 'pdfjs');
const PDFJS_FILES   = ['pdf.min.js', 'pdf.worker.min.js'];
let pdfOk = true;
for (const f of PDFJS_FILES) {
  const src = path.join(PDFJS_SRC_DIR, f);
  if (!fs.existsSync(src)) { console.warn('[sync-player-web] pdfjs file missing:', src); pdfOk = false; continue; }
  fs.mkdirSync(PDFJS_DST_DIR, { recursive: true });
  fs.copyFileSync(src, path.join(PDFJS_DST_DIR, f));
}
if (pdfOk) console.log('[sync-player-web] copied pdfjs/ (pdf.min.js + pdf.worker.min.js)');

console.log('[sync-player-web] done →', DEST);
