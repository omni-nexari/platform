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
if (!fs.existsSync(INDEX)) {
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
const adapter = window.AndroidBridge && window.AndroidBridge.makeJsAdapter
  ? window.AndroidBridge.makeJsAdapter()
  : null;
if (!adapter) { document.body.textContent = 'AndroidBridge not available'; }
else {
  const apiBase = (window.AndroidBridge.getConfig && JSON.parse(window.AndroidBridge.getConfig()).apiBase) || 'https://ds.chiho.app/api/v1';
  const wsBase  = (window.AndroidBridge.getConfig && JSON.parse(window.AndroidBridge.getConfig()).wsBase)  || 'wss://ds.chiho.app';
  const player = new Player({ apiBase, wsBase, adapter, container: document.getElementById('player-root') });
  player.start().catch(e => { document.body.textContent = 'boot failed: ' + e.message; });
}
</script>
</body></html>
`);
}

// Copy the Nexari logo so the pairing screen and splash can use it.
if (fs.existsSync(LOGO_SRC)) {
  fs.copyFileSync(LOGO_SRC, path.join(DEST, 'nexari-logo.png'));
  console.log('[sync-player-web] copied nexari-logo.png');
} else {
  console.warn('[sync-player-web] nexari-logo.png not found at', LOGO_SRC);
}

console.log('[sync-player-web] done →', DEST);
