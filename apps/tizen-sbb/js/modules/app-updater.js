/**
 * app-updater.ts — Remote App Update Handler (DS Tizen Player)
 *
 * Handles APP_UPDATE WebSocket commands from the CMS.
 * Downloads the .wgt package via tizen.download, then installs it via
 * tizen.package.install.  Progress and result are reported back to the
 * CMS over the player's main WebSocket connection.
 *
 * Public API:
 *   AppUpdater.handle(msg, sendStatus)
 *
 * Message contract (from CMS):
 *   { type: 'APP_UPDATE', wgtUrl: string, version: string,
 *     checksum?: string, packageId: string }
 */
var AppUpdater;
(function (AppUpdater) {
    /**
     * Resolve a possibly-relative file URL against the CMS base URL.
     * Uses CONFIG.API_BASE (e.g. "https://ds.chiho.app/api/v1") stripped of the
     * /api/v1 suffix to recover the bare origin.
     */
    function resolveUrl(wgtUrl) {
        if (wgtUrl.startsWith('http://') || wgtUrl.startsWith('https://')) {
            return wgtUrl;
        }
        // Strip /api/v1 suffix from API_BASE to get the server origin
        const base = (typeof CONFIG !== 'undefined' && CONFIG.API_BASE)
            ? String(CONFIG.API_BASE).replace(/\/api\/v1\/?$/, '').replace(/\/+$/, '')
            : '';
        return base + (wgtUrl.startsWith('/') ? wgtUrl : '/' + wgtUrl);
    }
    /**
     * Entry point – called by the player WS message switch for 'APP_UPDATE'.
     */
    function handle(msg, sendStatus) {
        const url = resolveUrl(msg.wgtUrl);
        const filename = `ds_update_${msg.version.replace(/[^a-zA-Z0-9._-]/g, '_')}.wgt`;
        console.log(`[AppUpdater] Downloading app update v${msg.version} from ${url}`);
        sendStatus('app_update_downloading', { version: msg.version, packageId: msg.packageId });
        // Tizen download API
        const tizenGlobal = window.tizen;
        if (!tizenGlobal || !tizenGlobal.download) {
            console.error('[AppUpdater] tizen.download API not available');
            sendStatus('app_update_failed', { error: 'tizen.download not available', packageId: msg.packageId });
            return;
        }
        let downloadId = null;
        try {
            const downloadRequest = new tizenGlobal.DownloadRequest(url, 'downloads', filename);
            downloadId = tizenGlobal.download.start(downloadRequest, {
                onprogress: (_id, receivedSize, totalSize) => {
                    const pct = totalSize > 0 ? Math.round((receivedSize / totalSize) * 100) : 0;
                    sendStatus('app_update_downloading', { version: msg.version, packageId: msg.packageId, pct });
                },
                onpaused: (_id) => {
                    console.warn('[AppUpdater] Download paused');
                },
                oncanceled: (_id) => {
                    console.warn('[AppUpdater] Download cancelled');
                    sendStatus('app_update_failed', { error: 'Download cancelled', packageId: msg.packageId });
                },
                oncompleted: (_id, fullPath) => {
                    console.log(`[AppUpdater] Download complete: ${fullPath} – installing…`);
                    sendStatus('app_update_installing', { version: msg.version, packageId: msg.packageId });
                    installPackage(fullPath, msg, sendStatus, tizenGlobal);
                },
                onfailed: (_id, error) => {
                    const errMsg = (error === null || error === void 0 ? void 0 : error.message) || String(error);
                    console.error('[AppUpdater] Download failed:', errMsg);
                    sendStatus('app_update_failed', { error: errMsg, packageId: msg.packageId });
                },
            });
            console.log(`[AppUpdater] Download started, id=${downloadId}`);
        }
        catch (err) {
            console.error('[AppUpdater] Failed to start download:', err);
            sendStatus('app_update_failed', { error: (err === null || err === void 0 ? void 0 : err.message) || String(err), packageId: msg.packageId });
        }
    }
    AppUpdater.handle = handle;
    function installPackage(fullPath, msg, sendStatus, tizen) {
        try {
            tizen.package.install(fullPath, {
                onprogress: (pkgId, pct) => {
                    sendStatus('app_update_installing', { version: msg.version, packageId: msg.packageId, installPct: pct, pkgId });
                },
                oncomplete: (pkgId) => {
                    console.log(`[AppUpdater] Install complete, pkgId=${pkgId}`);
                    sendStatus('app_update_done', { version: msg.version, packageId: msg.packageId, pkgId });
                    // Schedule self-relaunch via Tizen Alarm, then exit.
                    // tizen.AlarmRelative fires N seconds from now and relaunches this appId.
                    setTimeout(() => {
                        try {
                            const app = tizen.application.getCurrentApplication();
                            const alarm = new tizen.AlarmRelative(3);
                            tizen.alarm.add(alarm, app.appInfo.id);
                            console.log('[AppUpdater] Relaunch alarm set — exiting now');
                            app.exit();
                        }
                        catch (e) {
                            console.warn('[AppUpdater] Alarm relaunch failed, falling back to plain exit:', e);
                            try {
                                tizen.application.getCurrentApplication().exit();
                            }
                            catch (_) { }
                        }
                    }, 1500);
                },
                onfailed: (req, error) => {
                    const errMsg = (error === null || error === void 0 ? void 0 : error.message) || String(error);
                    console.error('[AppUpdater] Install failed:', errMsg, req);
                    sendStatus('app_update_failed', { error: errMsg, packageId: msg.packageId });
                },
            });
        }
        catch (err) {
            console.error('[AppUpdater] tizen.package.install threw:', err);
            sendStatus('app_update_failed', { error: (err === null || err === void 0 ? void 0 : err.message) || String(err), packageId: msg.packageId });
        }
    }
})(AppUpdater || (AppUpdater = {}));
