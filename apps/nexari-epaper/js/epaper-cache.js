// Nexari E-Paper — On-device image cache.
//
// Two-tier cache for pre-rendered e-paper variant JPEGs:
//   1. In-memory: contentId → { blobUrl, size, lastUsed }
//   2. Persistent: tizen.filesystem under wgt-private/epaper-cache/images/<contentId>.jpg
//                  with manifest at wgt-private/epaper-cache/manifest.json
//
// Persistent layer is best-effort. If the Tizen filesystem APIs are missing
// (e.g. running in a desktop browser for testing) the cache silently falls
// back to memory-only and re-fetches across reloads. Manifest enforces an
// LRU cap of MAX_FILES files / MAX_BYTES total.

window.EpaperCache = (function() {
  'use strict';

  var CACHE_DIR = 'wgt-private';
  var SUBDIR = 'epaper-cache';
  var IMAGES_SUBDIR = 'images';
  var MANIFEST_NAME = 'manifest.json';
  var MAX_FILES = 100;
  var MAX_BYTES = (CONFIG && CONFIG.MAX_CACHE_SIZE) || (500 * 1024 * 1024);

  // In-memory map: contentId → { blobUrl, size, lastUsed, source: 'mem'|'disk'|'net' }
  var mem = new Map();

  // Manifest: { entries: { [contentId]: { size, lastUsed, fileName } } }
  var manifest = { entries: {} };
  var manifestLoaded = false;
  var manifestDirty = false;

  function fsAvailable() {
    return typeof tizen !== 'undefined' && tizen.filesystem && typeof tizen.filesystem.openFile === 'function';
  }

  // ── Filesystem helpers ──────────────────────────────────────────────────
  // All paths are POSIX-style; tizen.filesystem accepts virtual roots.

  function openFile(path, mode) {
    return new Promise(function(resolve, reject) {
      try {
        tizen.filesystem.openFile(path, function(handle) { resolve(handle); }, function(err) { reject(err); }, mode);
      } catch (e) { reject(e); }
    });
  }

  function createDirectory(path) {
    return new Promise(function(resolve) {
      try {
        tizen.filesystem.createDirectory(path, 'a', function() { resolve(true); }, function() { resolve(false); });
      } catch (_) { resolve(false); }
    });
  }

  function deleteFile(path) {
    return new Promise(function(resolve) {
      try {
        tizen.filesystem.deleteFile(path, function() { resolve(true); }, function() { resolve(false); });
      } catch (_) { resolve(false); }
    });
  }

  function listDirectory(path) {
    return new Promise(function(resolve) {
      try {
        tizen.filesystem.listDirectory(path, function(list) { resolve(list || []); }, function() { resolve([]); });
      } catch (_) { resolve([]); }
    });
  }

  function readManifest() {
    return openFile(CACHE_DIR + '/' + SUBDIR + '/' + MANIFEST_NAME, 'r')
      .then(function(handle) {
        return new Promise(function(resolve) {
          try {
            handle.readString(function(text) {
              try { resolve(JSON.parse(text || '{}')); } catch (_) { resolve(null); }
              try { handle.close(); } catch (_) {}
            }, function() { resolve(null); try { handle.close(); } catch (_) {} });
          } catch (_) { resolve(null); }
        });
      })
      .catch(function() { return null; });
  }

  function writeManifest() {
    if (!fsAvailable()) return Promise.resolve(false);
    var path = CACHE_DIR + '/' + SUBDIR + '/' + MANIFEST_NAME;
    return deleteFile(path).then(function() {
      return openFile(path, 'w');
    }).then(function(handle) {
      return new Promise(function(resolve) {
        try {
          handle.writeString(JSON.stringify(manifest), function() {
            try { handle.close(); } catch (_) {}
            manifestDirty = false;
            resolve(true);
          }, function() { try { handle.close(); } catch (_) {} resolve(false); });
        } catch (_) { resolve(false); }
      });
    }).catch(function() { return false; });
  }

  function ensureDirs() {
    if (!fsAvailable()) return Promise.resolve(false);
    return createDirectory(CACHE_DIR + '/' + SUBDIR)
      .then(function() { return createDirectory(CACHE_DIR + '/' + SUBDIR + '/' + IMAGES_SUBDIR); });
  }

  function ensureManifest() {
    if (manifestLoaded) return Promise.resolve();
    manifestLoaded = true;
    if (!fsAvailable()) return Promise.resolve();
    return ensureDirs().then(function() {
      return readManifest();
    }).then(function(m) {
      if (m && m.entries) manifest = m;
      else manifest = { entries: {} };
    });
  }

  function fileNameFor(contentId) {
    return contentId.replace(/[^a-zA-Z0-9_-]/g, '_') + '.jpg';
  }

  function diskPathFor(contentId) {
    return CACHE_DIR + '/' + SUBDIR + '/' + IMAGES_SUBDIR + '/' + fileNameFor(contentId);
  }

  // Read a cached file into a Blob URL (returns null if not present / fails).
  function readDisk(contentId) {
    if (!fsAvailable()) return Promise.resolve(null);
    return openFile(diskPathFor(contentId), 'r')
      .then(function(handle) {
        return new Promise(function(resolve) {
          try {
            handle.readBlob(function(blob) {
              try { handle.close(); } catch (_) {}
              try { resolve(URL.createObjectURL(blob)); } catch (_) { resolve(null); }
            }, function() { try { handle.close(); } catch (_) {} resolve(null); });
          } catch (_) { resolve(null); }
        });
      })
      .catch(function() { return null; });
  }

  // Write a Blob to disk + update manifest entry.
  function writeDisk(contentId, blob) {
    if (!fsAvailable()) return Promise.resolve(false);
    var path = diskPathFor(contentId);
    return ensureDirs().then(function() {
      return deleteFile(path);
    }).then(function() {
      return openFile(path, 'w');
    }).then(function(handle) {
      return new Promise(function(resolve) {
        try {
          handle.writeBlob(blob, function() {
            try { handle.close(); } catch (_) {}
            manifest.entries[contentId] = {
              size: blob.size,
              lastUsed: Date.now(),
              fileName: fileNameFor(contentId),
            };
            manifestDirty = true;
            resolve(true);
          }, function() { try { handle.close(); } catch (_) {} resolve(false); });
        } catch (_) { resolve(false); }
      });
    }).catch(function() { return false; });
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
    // Sort by lastUsed asc → oldest first
    ids.sort(function(a, b) { return (manifest.entries[a].lastUsed || 0) - (manifest.entries[b].lastUsed || 0); });
    var removals = [];
    while (ids.length > 0 && (Object.keys(manifest.entries).length > MAX_FILES || totalBytes() > MAX_BYTES)) {
      var victim = ids.shift();
      var entry = manifest.entries[victim];
      delete manifest.entries[victim];
      manifestDirty = true;
      removals.push(deleteFile(CACHE_DIR + '/' + SUBDIR + '/' + IMAGES_SUBDIR + '/' + entry.fileName));
      // Clear from memory too
      var mEntry = mem.get(victim);
      if (mEntry && mEntry.blobUrl) {
        try { URL.revokeObjectURL(mEntry.blobUrl); } catch (_) {}
        mem.delete(victim);
      }
    }
    return Promise.all(removals).then(function() {});
  }

  // ── Public API ──────────────────────────────────────────────────────────

  return {
    /**
     * Resolve a content ID to a usable image URL (Blob URL preferred).
     * Order: in-memory → on-disk → network (epaper.jpg endpoint).
     * Caches the network result to disk for next reload.
     */
    getOrFetch: function(contentId, opts) {
      opts = opts || {};
      var token = opts.token || (typeof localStorage !== 'undefined' && localStorage.getItem('deviceToken')) || '';
      var mode = opts.mode || 'contain';
      // For volatile content (calendars), the caller passes noPersist:true
      // so we don't promote the result to disk and pollute the LRU. We still
      // keep it in memory for the duration of the swap.
      var noPersist = !!opts.noPersist;

      // 1. In-memory
      var hit = mem.get(contentId);
      if (hit && hit.blobUrl) {
        hit.lastUsed = Date.now();
        return Promise.resolve(hit.blobUrl);
      }

      return ensureManifest().then(function() {
        // 2. On-disk
        if (!noPersist && manifest.entries[contentId]) {
          return readDisk(contentId).then(function(blobUrl) {
            if (blobUrl) {
              mem.set(contentId, { blobUrl: blobUrl, size: manifest.entries[contentId].size || 0, lastUsed: Date.now(), source: 'disk' });
              manifest.entries[contentId].lastUsed = Date.now();
              manifestDirty = true;
              return blobUrl;
            }
            // Disk miss despite manifest entry → fall through
            delete manifest.entries[contentId];
            manifestDirty = true;
            return null;
          }).then(function(blobUrl) {
            if (blobUrl) return blobUrl;
            return null;
          });
        }
        return null;
      }).then(function(diskBlobUrl) {
        if (diskBlobUrl) return diskBlobUrl;

        // 3. Network
        var url = CONFIG.API_BASE + '/devices/device/content/' + encodeURIComponent(contentId) + '/epaper.jpg?mode=' + encodeURIComponent(mode);
        return fetch(url, { headers: { 'Authorization': 'Bearer ' + token } })
          .then(function(res) {
            if (!res.ok) throw new Error('HTTP ' + res.status);
            return res.blob();
          })
          .then(function(blob) {
            var blobUrl = URL.createObjectURL(blob);
            mem.set(contentId, { blobUrl: blobUrl, size: blob.size, lastUsed: Date.now(), source: 'net' });
            if (noPersist) return blobUrl;
            // Persist asynchronously — don't block render
            writeDisk(contentId, blob).then(function() { return evictIfNeeded(); }).then(function() {
              if (manifestDirty) writeManifest();
            });
            return blobUrl;
          });
      });
    },

    /** Pre-fetch a list of content IDs in the background (Phase 1 lookahead). */
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

    /** Drop a single content ID from caches (e.g. content was deleted). */
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
        deleteFile(CACHE_DIR + '/' + SUBDIR + '/' + IMAGES_SUBDIR + '/' + entry.fileName).then(function() {
          if (manifestDirty) writeManifest();
        });
      }
    },

    /** Clear everything (e.g. on unpair or panel resize). */
    clear: function() {
      mem.forEach(function(entry) {
        if (entry.blobUrl) { try { URL.revokeObjectURL(entry.blobUrl); } catch (_) {} }
      });
      mem.clear();
      var ids = Object.keys(manifest.entries);
      manifest = { entries: {} };
      manifestDirty = true;
      return Promise.all(ids.map(function(id) {
        return deleteFile(CACHE_DIR + '/' + SUBDIR + '/' + IMAGES_SUBDIR + '/' + fileNameFor(id));
      })).then(function() { return writeManifest(); });
    },

    stats: function() {
      return {
        memEntries: mem.size,
        diskEntries: Object.keys(manifest.entries).length,
        diskBytes: totalBytes(),
        diskAvailable: fsAvailable(),
      };
    },
  };
})();
