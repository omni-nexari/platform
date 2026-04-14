#!/usr/bin/env node
/**
 * update-sssp.js
 *
 * After packaging the WGT in Tizen Studio, run:
 *   npm run pack:sssp
 *
 * This script:
 *   1. Reads the WGT byte-size and updates <size> in sssp_config.xml
 *   2. Reads the version from package.json and updates <ver> in sssp_config.xml
 *   3. Copies NexariPlayer.wgt + sssp_config.xml to /var/signage/tizen/
 *      so nginx can serve them to the TV at:
 *        http://<server-ip>/tizen/sssp_config.xml   ← enter this URL in TV launcher
 *        http://<server-ip>/tizen/NexariPlayer.wgt
 */
'use strict';
const fs   = require('fs');
const path = require('path');

const ROOT       = path.resolve(__dirname, '..');
const WGT_PATH   = path.join(ROOT, 'NexariPlayer.wgt');
const SSSP_PATH  = path.join(ROOT, 'sssp_config.xml');
const PKG_PATH   = path.join(ROOT, 'package.json');
// Deploy dir — must match nginx alias in signage.conf
const DEPLOY_DIR = '/var/signage/tizen';

if (!fs.existsSync(WGT_PATH)) {
  console.error('[pack:sssp] ERROR — WGT not found:', WGT_PATH);
  console.error('  Package the app in Tizen Studio first, then re-run "npm run pack:sssp".');
  process.exit(1);
}

// 1. Read version from package.json
const pkg     = JSON.parse(fs.readFileSync(PKG_PATH, 'utf8'));
const version = pkg.version || '1.0.0';

// 2. Read WGT file size
const size = fs.statSync(WGT_PATH).size;

// 3. Patch sssp_config.xml — update both <ver> and <size>
let xml = fs.readFileSync(SSSP_PATH, 'utf8');
xml = xml.replace(/<ver>[^<]*<\/ver>/, `<ver>${version}</ver>`);
xml = xml.replace(/<size>\d+<\/size>/, `<size>${size}</size>`);
fs.writeFileSync(SSSP_PATH, xml, 'utf8');
console.log(`[pack:sssp] sssp_config.xml updated: <ver>${version}</ver> <size>${size}</size>  (${(size / 1024).toFixed(1)} KB)`);

// 4. Copy WGT + sssp_config.xml to nginx serve directory
if (fs.existsSync(DEPLOY_DIR)) {
  fs.copyFileSync(WGT_PATH,  path.join(DEPLOY_DIR, 'NexariPlayer.wgt'));
  fs.copyFileSync(SSSP_PATH, path.join(DEPLOY_DIR, 'sssp_config.xml'));
  console.log(`[pack:sssp] Copied to ${DEPLOY_DIR}/`);
  console.log(`[pack:sssp] TV launcher URL: http://<server-ip>/tizen/sssp_config.xml`);
} else {
  console.warn(`[pack:sssp] Deploy dir not found: ${DEPLOY_DIR}`);
  console.warn('  Create it with: sudo mkdir -p /var/signage/tizen && sudo chown $USER /var/signage/tizen');
}
