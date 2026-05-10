#!/usr/bin/env node
// Mirrors package.json:version into android/app/build.gradle.kts versionName,
// matching the pattern used by nexari-epaper for config.xml sync.

const fs = require('fs');
const path = require('path');

const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf8'));
const buildGradle = path.resolve(__dirname, '..', 'android', 'app', 'build.gradle.kts');
if (!fs.existsSync(buildGradle)) {
  console.error('[sync-version] not found:', buildGradle);
  process.exit(0);
}

let s = fs.readFileSync(buildGradle, 'utf8');
const next = s.replace(/(versionName\s*=\s*")[^"]*(")/, `$1${pkg.version}$2`);
if (next !== s) {
  fs.writeFileSync(buildGradle, next, 'utf8');
  console.log('[sync-version] versionName →', pkg.version);
}
