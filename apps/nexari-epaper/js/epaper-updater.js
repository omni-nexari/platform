// Nexari E-Paper — OTA App Updater
//
// Handles APP_UPDATE commands dispatched by EpaperWS.
// Downloads the .wgt package via tizen.download (native download manager —
// better for large files than XHR), then installs via tizen.package.install.
// Progress and result are reported back to the server over the WS connection.
//
// Triggered by WS message: { type: 'app_update', payload: { wgtUrl, version, packageId } }
//
// Public API: EpaperUpdater.handle(msg, sendStatus)

window.EpaperUpdater = (function() {
  'use strict';

  /**
   * Resolve a possibly-relative URL against the API base.
   * Absolute URLs (http/https) pass through unchanged.
   */
  function resolveUrl(wgtUrl) {
    if (/^https?:\/\//.test(wgtUrl)) return wgtUrl;
    var base = (CONFIG && CONFIG.API_BASE)
      ? CONFIG.API_BASE.replace(/\/api\/v1\/?$/, '')
      : '';
    return base + (wgtUrl.charAt(0) === '/' ? wgtUrl : '/' + wgtUrl);
  }

  /**
   * Entry point. Called by EpaperWS handleMessage for 'app_update' / 'APP_UPDATE'.
   *
   * @param {object}   msg         Payload from WS: { wgtUrl, version, packageId }
   * @param {Function} sendStatus  sendStatus(type, data) → sends WS message back to server
   */
  function handle(msg, sendStatus) {
    if (!msg || !msg.wgtUrl) {
      sendStatus('app_update_failed', { error: 'missing wgtUrl' });
      return;
    }

    var url = resolveUrl(msg.wgtUrl);
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
          sendStatus('app_update_installing', { version: version, packageId: packageId });
          installPackage(fullPath, msg, sendStatus);
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
