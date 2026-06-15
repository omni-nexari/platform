// Nexari E-Paper — OTA App Updater
//
// Handles APP_UPDATE commands dispatched by EpaperWS.
// Downloads the .wgt package via tizen.download (native download manager —
// better for large files than XHR), then installs via tizen.package.install.
// Progress and result are reported back to the server over the WS connection.
//
// Triggered by WS message: { type: 'app_update', payload: { wgtUrl, version, packageId, checksum } }
//
// Security:
//   - Only http(s) URLs whose host is in UPDATE_HOST_ALLOWLIST are accepted.
//   - When `checksum` (SHA-256 hex) is provided, the downloaded file MUST
//     match before installation; mismatches abort the install.
//
// Public API: EpaperUpdater.handle(msg, sendStatus)

window.EpaperUpdater = (function() {
  'use strict';

  /**
   * Resolve a possibly-relative URL against the API base, then verify the
   * host matches the configured API host. This allows OTA downloads from the
   * partner's own domain without hardcoding any specific hostname.
   */
  function resolveUrl(wgtUrl) {
    var absolute;
    var apiBase = (window.CONFIG && CONFIG.API_BASE) ? CONFIG.API_BASE : '';
    if (/^https?:\/\//.test(wgtUrl)) {
      absolute = wgtUrl;
    } else {
      var base = apiBase.replace(/\/api\/v1\/?$/, '');
      absolute = base + (wgtUrl.charAt(0) === '/' ? wgtUrl : '/' + wgtUrl);
    }
    try {
      var u = new URL(absolute);
      if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
      var allowedHost = apiBase ? new URL(apiBase).hostname : '';
      if (!allowedHost || u.hostname !== allowedHost) {
        logger.error('[Updater] refusing download from non-allowlisted host:', u.hostname, '(expected:', allowedHost + ')');
        return null;
      }
      return absolute;
    } catch (e) {
      return null;
    }
  }

  /**
   * Read a downloaded file and compute its SHA-256 hex digest.
   * Uses XHR (file:// URL) + WebCrypto SubtleCrypto.digest.
   */
  function sha256OfFile(fullPath) {
    return new Promise(function(resolve, reject) {
      try {
        var xhr = new XMLHttpRequest();
        var url = fullPath.indexOf('file://') === 0 ? fullPath : 'file://' + fullPath;
        xhr.open('GET', url, true);
        xhr.responseType = 'arraybuffer';
        xhr.onload = function() {
          if (xhr.status !== 0 && (xhr.status < 200 || xhr.status >= 300)) {
            reject(new Error('Read failed: HTTP ' + xhr.status));
            return;
          }
          var buf = xhr.response;
          if (!buf) { reject(new Error('Read failed: empty response')); return; }
          var subtle = window.crypto && window.crypto.subtle;
          if (!subtle || !subtle.digest) {
            reject(new Error('WebCrypto SubtleCrypto.digest unavailable'));
            return;
          }
          subtle.digest('SHA-256', buf).then(function(digest) {
            var bytes = new Uint8Array(digest);
            var hex = '';
            for (var i = 0; i < bytes.length; i++) {
              var h = bytes[i].toString(16);
              hex += h.length === 1 ? '0' + h : h;
            }
            resolve(hex);
          }, function(err) { reject(err); });
        };
        xhr.onerror = function() { reject(new Error('XHR error reading downloaded file')); };
        xhr.send();
      } catch (e) {
        reject(e);
      }
    });
  }

  /**
   * Entry point. Called by EpaperWS handleMessage for 'app_update' / 'APP_UPDATE'.
   *
   * @param {object}   msg         Payload from WS: { wgtUrl, version, packageId, checksum }
   * @param {Function} sendStatus  sendStatus(type, data) → sends WS message back to server
   */
  function handle(msg, sendStatus) {
    if (!msg || !msg.wgtUrl) {
      sendStatus('app_update_failed', { error: 'missing wgtUrl' });
      return;
    }

    var url = resolveUrl(msg.wgtUrl);
    if (!url) {
      sendStatus('app_update_failed', { error: 'Download URL host not allowed', packageId: msg.packageId });
      return;
    }
    var version = msg.version || 'unknown';
    var packageId = msg.packageId || 'U1izu2M7CQ.NexariEPaper';
    var filename = 'nexari_epaper_' + version.replace(/[^a-zA-Z0-9._-]/g, '_') + '.wgt';

    logger.info('[Updater] downloading v' + version + ' from ' + url);
    sendStatus('app_update_downloading', { version: version, packageId: packageId, pct: 0 });

    if (typeof tizen === 'undefined' || !tizen.download) {
      logger.error('[Updater] tizen.download API not available');
      sendStatus('app_update_failed', { error: 'tizen.download not available', packageId: packageId });
      return;
    }

    try {
      var req = new tizen.DownloadRequest(url, 'downloads', filename);
      tizen.download.start(req, {
        onprogress: function(id, recv, total) {
          var pct = total > 0 ? Math.round(recv / total * 100) : 0;
          sendStatus('app_update_downloading', { version: version, packageId: packageId, pct: pct });
        },
        onpaused: function() {
          logger.warn('[Updater] download paused');
        },
        oncanceled: function() {
          logger.warn('[Updater] download cancelled');
          sendStatus('app_update_failed', { error: 'cancelled', packageId: packageId });
        },
        oncompleted: function(id, fullPath) {
          logger.info('[Updater] download complete:', fullPath);
          if (msg.checksum) {
            sendStatus('app_update_verifying', { version: version, packageId: packageId });
            sha256OfFile(fullPath).then(function(actual) {
              var expected = String(msg.checksum).toLowerCase();
              if (actual !== expected) {
                logger.error('[Updater] SHA-256 mismatch — expected ' + expected + ' actual ' + actual);
                sendStatus('app_update_failed', {
                  error: 'Checksum verification failed',
                  packageId: packageId,
                  expected: expected,
                  actual: actual,
                });
                return;
              }
              logger.info('[Updater] SHA-256 verified');
              sendStatus('app_update_installing', { version: version, packageId: packageId });
              installPackage(fullPath, msg, sendStatus);
            }, function(err) {
              logger.error('[Updater] checksum read failed:', err && err.message);
              sendStatus('app_update_failed', {
                error: 'Checksum read failed: ' + ((err && err.message) || String(err)),
                packageId: packageId,
              });
            });
          } else {
            logger.warn('[Updater] no checksum supplied — installing without integrity verification');
            sendStatus('app_update_installing', { version: version, packageId: packageId });
            installPackage(fullPath, msg, sendStatus);
          }
        },
        onfailed: function(id, err) {
          var errMsg = (err && err.message) || String(err);
          logger.error('[Updater] download failed:', errMsg);
          sendStatus('app_update_failed', { error: errMsg, packageId: packageId });
        },
      });
    } catch (e) {
      logger.error('[Updater] download.start error:', e && e.message);
      sendStatus('app_update_failed', { error: (e && e.message) || String(e), packageId: packageId });
    }
  }

  function installPackage(fullPath, msg, sendStatus) {
    if (typeof tizen === 'undefined' || !tizen.package) {
      logger.error('[Updater] tizen.package API not available');
      sendStatus('app_update_failed', { error: 'tizen.package not available', packageId: msg.packageId });
      return;
    }

    logger.info('[Updater] installing from', fullPath);
    try {
      tizen.package.install(fullPath, {
        onprogress: function(pkgId, pct) {
          sendStatus('app_update_installing', { version: msg.version, packageId: pkgId, pct: pct });
        },
        oncomplete: function(pkgId) {
          logger.info('[Updater] installed:', pkgId);
          sendStatus('app_update_complete', { version: msg.version, packageId: pkgId });
          // Restart the app after 3s so the new version is loaded
          setTimeout(function() {
            try {
              tizen.application.getCurrentApplication().exit();
            } catch (_) {
              location.reload();
            }
          }, 3000);
        },
        onerror: function(err, pkgId) {
          var errMsg = (err && err.message) || String(err);
          logger.error('[Updater] install failed:', errMsg);
          sendStatus('app_update_failed', { error: errMsg, packageId: pkgId || msg.packageId });
        },
      });
    } catch (e) {
      logger.error('[Updater] package.install error:', e && e.message);
      sendStatus('app_update_failed', { error: (e && e.message) || String(e), packageId: msg.packageId });
    }
  }

  return { handle: handle };
})();
