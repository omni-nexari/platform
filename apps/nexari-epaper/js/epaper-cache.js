// Nexari E-Paper â€” On-device image cache.
//
// Two-tier cache for pre-rendered e-paper variant JPEGs:
//   1. In-memory:  contentId â†’ { blobUrl, size, lastUsed }
//   2. Persistent: Samsung Tizen synchronous filesystem API under
//      InternalFlash/epaper/content/<contentId>.jpg  (persists across app reinstalls)
//      Falls back to wgt-private/epaper/content/ if InternalFlash is unavailable.
//      Manifest at {base}/epaper/manifest.json.
//
// Download: fetch() â†’ arrayBuffer() â†’ tizen.filesystem.openFile('w').writeBytes(Uint8Array)
// Read:     tizen.filesystem.openFile('r').readBlob()  â†’ URL.createObjectURL(blob)
// (Uses the Samsung synchronous filesystem API, same pattern as the official e-paper sample.)

window.EpaperCache = (function() {
  'use strict';

  var MAX_FILES = 100;
  var MAX_BYTES = (CONFIG && CONFIG.MAX_CACHE_SIZE) || (500 * 1024 * 1024);

  // Resolved on first use by detectBase()
  var BASE_FS = null;  // 'InternalFlash' or 'wgt-private'

  // Resolved on first use by detectBase()
  var BASE_FS = null;  // 'InternalFlash' or 'wgt-private'

  // In-memory map: contentId â†’ { blobUrl, size, lastUsed, source: 'mem'|'disk'|'net' }
  var mem = new Map();

  // Manifest: { entries: { [contentId]: { size, lastUsed, fileName } } }
  var manifest = { entries: {} };
  var manifestLoaded = false;
  var manifestDirty = false;

  function fsAvailable() {
    return typeof tizen !== 'undefined' && tizen.filesystem &&
      typeof tizen.filesystem.openFile === 'function';
  }

  // â”€â”€ Base storage detection â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Try InternalFlash first â€” it persists across app reinstalls and has more
  // space. Falls back to wgt-private (cleared on reinstall) if unavailable.
  function detectBase() {
    if (BASE_FS !== null) return;
    if (!fsAvailable()) { BASE_FS = 'wgt-private'; return; }
    try {
      // getStorage() is async/callback-based — use pathExists() which is synchronous.
      if (tizen.filesystem.pathExists('InternalFlash')) {
        BASE_FS = 'InternalFlash';
        logger.info('[EpaperCache] storage: InternalFlash');
        return;
      }
    } catch (_) {}
    BASE_FS = 'wgt-private';
    logger.info('[EpaperCache] storage: wgt-private (InternalFlash unavailable)');
  }

  function contentDir() { detectBase(); return BASE_FS + '/epaper/content'; }
  function manifestPath() { detectBase(); return BASE_FS + '/epaper/manifest.json'; }

  function fileNameFor(contentId) {
    return contentId.replace(/[^a-zA-Z0-9_-]/g, '_') + '.jpg';
  }
  function diskPathFor(contentId) { return contentDir() + '/' + fileNameFor(contentId); }

  // â”€â”€ Synchronous Tizen filesystem helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Uses the Samsung synchronous filesystem API (same as the official e-paper
  // sample). Wrapped in Promise for composability with the async call sites.

  function ensureDirsSync() {
    if (!fsAvailable()) return;
    try {
      detectBase();
      var tfs = tizen.filesystem;
      var base = BASE_FS + '/epaper';
      if (!tfs.pathExists(base)) tfs.createDirectory(base, true);
      var cd = base + '/content';
      if (!tfs.pathExists(cd)) tfs.createDirectory(cd, true);
    } catch (e) {
      logger.warn('[EpaperCache] ensureDirs error:', e && e.message);
    }
  }

  function readManifestSync() {
    if (!fsAvailable()) return null;
    try {
      var mp = manifestPath();
      if (!tizen.filesystem.pathExists(mp)) return null;
      var fh = tizen.filesystem.openFile(mp, 'r');
      var text = fh.readString();
      fh.close();
      return JSON.parse(text || '{}');
    } catch (e) {
      logger.warn('[EpaperCache] readManifest error:', e && e.message);
      return null;
    }
  }

  function writeManifestSync() {
    if (!fsAvailable()) return;
    try {
      var mp = manifestPath();
      try { tizen.filesystem.deleteFile(mp); } catch (_) {}
      var fh = tizen.filesystem.openFile(mp, 'w');
      fh.writeString(JSON.stringify(manifest));
      fh.flush();
      fh.close();
      manifestDirty = false;
    } catch (e) {
      logger.warn('[EpaperCache] writeManifest error:', e && e.message);
    }
  }

  function ensureManifest() {
    if (manifestLoaded) return Promise.resolve();
    manifestLoaded = true;
    return new Promise(function(resolve) {
      ensureDirsSync();
      var m = readManifestSync();
      if (m && m.entries) manifest = m;
      else manifest = { entries: {} };
      resolve();
    });
  }

  // ── Disk read ── openFile('r') → readData() → Uint8Array → blob URL ──────
  function readDisk(contentId) {
    return new Promise(function(resolve) {
      if (!fsAvailable()) { resolve(null); return; }
      try {
        var path = diskPathFor(contentId);
        if (!tizen.filesystem.pathExists(path)) { resolve(null); return; }
        var fh = tizen.filesystem.openFile(path, 'r');
        var data = fh.readData();
        fh.close();
        if (!data || !data.length) { resolve(null); return; }
        var blob = new Blob([data], { type: 'image/jpeg' });
        resolve(URL.createObjectURL(blob));
      } catch (e) {
        logger.warn('[EpaperCache] readDisk error:', e && e.message);
        resolve(null);
      }
    });
  }

  // ── Disk write ── openFile('w') → writeData(Uint8Array) ──────────────────
  function writeAsset(contentId, arrayBuffer) {
    return new Promise(function(resolve) {
      if (!fsAvailable()) { resolve(false); return; }
      try {
        ensureDirsSync();
        var path = diskPathFor(contentId);
        try { tizen.filesystem.deleteFile(path); } catch (_) {}
        var fh = tizen.filesystem.openFile(path, 'w');
        fh.writeData(new Uint8Array(arrayBuffer));
        fh.close(); // close() flushes and commits
        resolve(true);
      } catch (e) {
        logger.warn('[EpaperCache] writeAsset error:', e && e.message);
        resolve(false);
      }
    });
  }

  function deleteFileSync(path) {
    if (!fsAvailable()) return;
    try { tizen.filesystem.deleteFile(path); } catch (_) {}
  }

  function totalBytes() {
    var t = 0;
    var ids = Object.keys(manifest.entries);
    for (var i = 0; i < ids.length; i++) t += manifest.entries[ids[i]].size || 0;
    return t;
  }

  function evictIfNeeded() {
    var ids = Object.keys(manifest.entries);
    if (ids.length <= MAX_FILES && totalBytes() <= MAX_BYTES) return Promise.resolve();
    ids.sort(function(a, b) {
      return (manifest.entries[a].lastUsed || 0) - (manifest.entries[b].lastUsed || 0);
    });
    while (ids.length > 0 &&
      (Object.keys(manifest.entries).length > MAX_FILES || totalBytes() > MAX_BYTES)) {
      var victim = ids.shift();
      var entry = manifest.entries[victim];
      delete manifest.entries[victim];
      manifestDirty = true;
      deleteFileSync(contentDir() + '/' + entry.fileName);
      var mEntry = mem.get(victim);
      if (mEntry && mEntry.blobUrl) {
        try { URL.revokeObjectURL(mEntry.blobUrl); } catch (_) {}
        mem.delete(victim);
      }
    }
    return Promise.resolve();
  }

  // â”€â”€ Download: fetch â†’ arrayBuffer â†’ writeBytes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Single download path â€” no tizen.download needed for content images.
  // tizen.download is reserved for OTA .wgt packages (EpaperUpdater).
  function downloadAsset(url, contentId, token, noPersist) {
    return fetch(url, { headers: { 'Authorization': 'Bearer ' + token } })
      .then(function(res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.arrayBuffer();
      })
      .then(function(data) {
        // Create blob URL for immediate rendering
        var blob = new Blob([data], { type: 'image/jpeg' });
        var blobUrl = URL.createObjectURL(blob);
        mem.set(contentId, { blobUrl: blobUrl, size: data.byteLength, lastUsed: Date.now(), source: 'net' });
        if (!noPersist && fsAvailable()) {
          // Write to disk in background â€” do not block rendering
          writeAsset(contentId, data).then(function(ok) {
            if (!ok) return;
            manifest.entries[contentId] = {
              size: data.byteLength,
              lastUsed: Date.now(),
              fileName: fileNameFor(contentId),
            };
            manifestDirty = true;
            evictIfNeeded().then(function() { if (manifestDirty) writeManifestSync(); });
          });
        }
        return blobUrl;
      });
  }

  // â”€â”€ Public API â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  return {
    /**
     * Resolve a content ID to a usable image URL (Blob URL preferred).
     * Order: in-memory â†’ on-disk (InternalFlash/wgt-private) â†’ fetch from server.
     * Downloaded images are persisted to {base}/epaper/content/<id>.jpg.
     */
    getOrFetch: function(contentId, opts) {
      opts = opts || {};
      var token = opts.token || (typeof localStorage !== 'undefined' && localStorage.getItem('deviceToken')) || '';
      var mode = opts.mode || 'contain';
      var noPersist = !!opts.noPersist;

      // 1. In-memory
      var hit = mem.get(contentId);
      if (hit && hit.blobUrl) {
        hit.lastUsed = Date.now();
        return Promise.resolve(hit.blobUrl);
      }

      return ensureManifest().then(function() {
        // 2. On-disk (from a previous wake cycle)
        if (!noPersist && manifest.entries[contentId]) {
          return readDisk(contentId).then(function(blobUrl) {
            if (blobUrl) {
              mem.set(contentId, {
                blobUrl: blobUrl,
                size: manifest.entries[contentId].size || 0,
                lastUsed: Date.now(),
                source: 'disk',
              });
              manifest.entries[contentId].lastUsed = Date.now();
              manifestDirty = true;
              return blobUrl;
            }
            // Disk miss despite manifest entry â€” fall through
            delete manifest.entries[contentId];
            manifestDirty = true;
            return null;
          });
        }
        return null;
      }).then(function(diskBlobUrl) {
        if (diskBlobUrl) return diskBlobUrl;

        // 3. Download from server
        var url = CONFIG.API_BASE + '/devices/device/content/' + encodeURIComponent(contentId) +
          '/epaper.jpg?mode=' + encodeURIComponent(mode);
        return downloadAsset(url, contentId, token, noPersist).then(function(blobUrl) {
          if (!blobUrl) throw new Error('download returned null');
          return blobUrl;
        });
      });
    },

    /** Pre-fetch a list of content IDs in the background (lookahead for next items). */
    prefetch: function(contentIds, opts) {
      var self = this;
      var i = 0;
      function next() {
        if (i >= contentIds.length) return Promise.resolve();
        var id = contentIds[i++];
        return self.getOrFetch(id, opts).catch(function() {}).then(next);
      }
      return next();
    },

    /** Drop a single content ID from both caches (e.g. content was deleted server-side). */
    invalidate: function(contentId) {
      var hit = mem.get(contentId);
      if (hit && hit.blobUrl) {
        try { URL.revokeObjectURL(hit.blobUrl); } catch (_) {}
        mem.delete(contentId);
      }
      if (manifest.entries[contentId]) {
        var entry = manifest.entries[contentId];
        delete manifest.entries[contentId];
        manifestDirty = true;
        deleteFileSync(contentDir() + '/' + entry.fileName);
        if (manifestDirty) writeManifestSync();
      }
    },

    /** Clear everything (e.g. on unpair or panel resize change). */
    clear: function() {
      mem.forEach(function(entry) {
        if (entry.blobUrl) { try { URL.revokeObjectURL(entry.blobUrl); } catch (_) {} }
      });
      mem.clear();
      var ids = Object.keys(manifest.entries);
      manifest = { entries: {} };
      manifestDirty = true;
      ids.forEach(function(id) { deleteFileSync(contentDir() + '/' + fileNameFor(id)); });
      writeManifestSync();
      return Promise.resolve();
    },

    stats: function() {
      return {
        memEntries: mem.size,
        diskEntries: Object.keys(manifest.entries).length,
        diskBytes: totalBytes(),
        diskBase: BASE_FS || '(not yet resolved)',
        diskAvailable: fsAvailable(),
      };
    },
  };
})();
