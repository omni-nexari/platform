#!/usr/bin/env node
/**
 * sync-tizen-shared.mjs
 *
 * Copies shared Tizen JS files from apps/tizen/js (canonical source) into
 * apps/nexari-tizen/js and apps/tizen-sbb/js.
 *
 * Files that are intentionally app-specific (pairing.js, player.js, config.xml)
 * are excluded from sync.
 *
 * Usage:
 *   node tools/sync-tizen-shared.mjs
 *   pnpm sync-tizen
 */

import { copyFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(__dirname, '..');

const SOURCE = join(root, 'apps', 'tizen', 'js');
const TARGETS = [
  join(root, 'apps', 'nexari-tizen', 'js'),
  join(root, 'apps', 'tizen-sbb', 'js'),
];

// Files that differ intentionally per-app — never overwrite
const EXCLUDED = new Set([
  'pairing.js',   // kiosk/SBB-specific branches
  'player.js',    // b2bapis differences in tizen-sbb
  'mdc.js',       // nexari-tizen specific
  'platform.js',  // nexari-tizen specific
  'app.js',       // per-app entry point
  'log-viewer.js',// may have per-app tweaks
  '.jshintrc',
]);

const sourceFiles = readdirSync(SOURCE).filter((f) => {
  const full = join(SOURCE, f);
  return statSync(full).isFile() && !EXCLUDED.has(f);
});

let copied = 0;
let skipped = 0;

for (const target of TARGETS) {
  for (const file of sourceFiles) {
    const dest = join(target, file);
    if (!existsSync(target)) {
      console.warn(`[sync] Target dir not found, skipping: ${target}`);
      continue;
    }
    copyFileSync(join(SOURCE, file), dest);
    console.log(`[sync] ${basename(target)}/js/${file}`);
    copied++;
  }
}

console.log(`\nDone — ${copied} file(s) synced, ${skipped} skipped.`);
