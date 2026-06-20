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
 *
 * Security:
 *   - Only http(s) URLs whose host appears in UPDATE_HOST_ALLOWLIST are accepted.
 *   - When `checksum` (SHA-256 hex) is provided, the downloaded file MUST match
 *     before installation. Mismatches abort the install.
 */
var AppUpdater;
(function (AppUpdater) {
    /**
     * Resolve a possibly-relative file URL against the CMS base URL, then
     * enforce that the update host matches the configured API_BASE host.
     * Returns null if the resolved URL is not an http(s) URL or host is not allowed.
     */
    function resolveUrl(wgtUrl) {
        let absolute;
        // Strip /api/v1 suffix from API_BASE to get the server origin
        const apiBase = (typeof CONFIG !== 'undefined' && CONFIG.API_BASE)
            ? String(CONFIG.API_BASE).replace(/\/api\/v1\/?$/, '').replace(/\/+$/, '')
            : '';
        if (wgtUrl.startsWith('http://') || wgtUrl.startsWith('https://')) {
            absolute = wgtUrl;
        }
        else {
            absolute = apiBase + (wgtUrl.startsWith('/') ? wgtUrl : '/' + wgtUrl);
        }
        try {
            const u = new URL(absolute);
            if (u.protocol !== 'https:' && u.protocol !== 'http:')
                return null;
            // Only allow downloads from the same host as the configured API_BASE
            if (apiBase) {
                try {
                    const allowedHost = new URL(apiBase).hostname;
                    if (u.hostname !== allowedHost) {
                        console.error('[AppUpdater] Refusing download from non-allowlisted host:', u.hostname);
                        return null;
                    }
                } catch { return null; }
            }
            return absolute;
        }
        catch (_a) {
            return null;
        }
    }
    /**
     * Compute SHA-256 hex digest of a file on the Tizen device.
     * Reads the file with XHR (file:// URLs are accessible from WebView), then
     * digests via WebCrypto. Resolves to the lowercase hex digest, or rejects.
     */
    function sha256OfFile(fullPath) {
        return new Promise((resolve, reject) => {
            try {
                const xhr = new XMLHttpRequest();
                // Tizen download paths can be returned as "downloads/foo.wgt" relative
                // to the user's virtual root; convert to a file:// URL the WebView can read.
                const url = fullPath.indexOf('file://') === 0 ? fullPath : 'file://' + fullPath;
                xhr.open('GET', url, true);
                xhr.responseType = 'arraybuffer';
                xhr.onload = () => {
                    if (xhr.status !== 0 && (xhr.status < 200 || xhr.status >= 300)) {
                        reject(new Error('Read failed: HTTP ' + xhr.status));
                        return;
                    }
                    const buf = xhr.response;
                    if (!buf) {
                        reject(new Error('Read failed: empty response'));
                        return;
                    }
                    const subtle = window.crypto && window.crypto.subtle;
                    if (!subtle || !subtle.digest) {
                        reject(new Error('WebCrypto SubtleCrypto.digest unavailable'));
                        return;
                    }
                    subtle.digest('SHA-256', buf).then((digest) => {
                        const bytes = new Uint8Array(digest);
                        let hex = '';
                        for (let i = 0; i < bytes.length; i++) {
                            const h = bytes[i].toString(16);
                            hex += h.length === 1 ? '0' + h : h;
                        }
                        resolve(hex);
                    }, (err) => reject(err));
                };
                xhr.onerror = () => reject(new Error('XHR error reading downloaded file'));
                xhr.send();
            }
            catch (e) {
                reject(e);
            }
        });
    }
    /**
     * Entry point – called by the player WS message switch for 'APP_UPDATE'.
     */
    function handle(msg, sendStatus) {
        const url = resolveUrl(msg.wgtUrl);
        if (!url) {
            sendStatus('app_update_failed', { error: 'Download URL host not allowed', packageId: msg.packageId });
            return;
        }
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
                    console.log(`[AppUpdater] Download complete: ${fullPath}`);
                    if (msg.checksum) {
                        sendStatus('app_update_verifying', { version: msg.version, packageId: msg.packageId });
                        sha256OfFile(fullPath).then((actual) => {
                            const expected = String(msg.checksum).toLowerCase();
                            if (actual !== expected) {
                                console.error('[AppUpdater] SHA-256 mismatch — expected', expected, 'actual', actual);
                                sendStatus('app_update_failed', {
                                    error: 'Checksum verification failed',
                                    packageId: msg.packageId,
                                    expected,
                                    actual,
                                });
                                return;
                            }
                            console.log('[AppUpdater] SHA-256 verified');
                            sendStatus('app_update_installing', { version: msg.version, packageId: msg.packageId });
                            installPackage(fullPath, msg, sendStatus, tizenGlobal);
                        }, (err) => {
                            console.error('[AppUpdater] Checksum read failed:', err);
                            sendStatus('app_update_failed', {
                                error: 'Checksum read failed: ' + (err && err.message ? err.message : String(err)),
                                packageId: msg.packageId,
                            });
                        });
                    }
                    else {
                        // No checksum supplied → log and proceed (legacy releases).
                        console.warn('[AppUpdater] No checksum supplied — installing without integrity verification');
                        sendStatus('app_update_installing', { version: msg.version, packageId: msg.packageId });
                        installPackage(fullPath, msg, sendStatus, tizenGlobal);
                    }
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
