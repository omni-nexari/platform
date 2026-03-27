#!/usr/bin/env node
/**
 * update-sssp.js
 *
 * After packaging the WGT in Tizen Studio, run:
 *   npm run pack:sssp
 *
 * This script reads the actual byte-size of the built WGT file and writes it
 * into the <size> tag inside sssp_config.xml, which Samsung SSSP launcher
 * uses to validate the package before installation.
 */
'use strict';
const fs   = require('fs');
const path = require('path');

const ROOT       = path.resolve(__dirname, '..');
const WGT_PATH   = path.join(ROOT, 'DigitalSignagePlayer.wgt');
const SSSP_PATH  = path.join(ROOT, 'sssp_config.xml');

if (!fs.existsSync(WGT_PATH)) {
  console.error('[pack:sssp] ERROR — WGT not found:', WGT_PATH);
  console.error('  Package the app in Tizen Studio first, then re-run "npm run pack:sssp".');
  process.exit(1);
}

const size = fs.statSync(WGT_PATH).size;

let xml = fs.readFileSync(SSSP_PATH, 'utf8');
const updated = xml.replace(/<size>\d+<\/size>/, `<size>${size}</size>`);

if (updated === xml) {
  console.warn('[pack:sssp] WARNING — no <size> tag found in sssp_config.xml; nothing changed.');
  process.exit(0);
}

fs.writeFileSync(SSSP_PATH, updated, 'utf8');
console.log(`[pack:sssp] sssp_config.xml updated: <size>${size}</size>  (${(size / 1024).toFixed(1)} KB)`);
