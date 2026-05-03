/**
 * syncplay-test.js
 * Nexari B2BSyncplay test harness — modelled on Samsung b2bsync sample.
 *
 * KEY GUIDE:
 *   1 — makeSyncPlayList  [1.mp4, 2.mp4, 3.mp4]
 *   2 — makeSyncPlayList  [signage.mp4 — portrait]
 *   3 — startSyncPlay  0,0,1920,1080  grp=5  rotate=OFF  (working baseline)
 *   4 — startSyncPlay  0,0,1920,1080  grp=7  rotate=OFF
 *   5 — startSyncPlay  0,0,1920,1080  grp=7  rotate=ON
 *   7 — stopSyncPlay
 *   8 — clearSyncPlayList
 *
 * CONFIRMED INVALID:
 *   rect 1080×1920   → ERROR: rect exceeds 1920×1080 logical space
 */

var b2bsync = null;
var mediaPath = '';
var logsEl = null;
var statusEl = null;

// ── Logging ───────────────────────────────────────────────────────────────────

function log(msg, cls) {
    var line = document.createElement('div');
    line.className = cls || 'log-inf';
    line.textContent = new Date().toISOString().substring(11, 23) + '  ' + msg;
    logsEl.appendChild(line);
    logsEl.scrollTop = logsEl.scrollHeight;
    console.log(msg);
}

function setStatus(msg) {
    if (statusEl) statusEl.textContent = msg;
    console.log('[STATUS] ' + msg);
}

// ── onChange listener (shared by all startSyncPlay calls) ─────────────────────

function makeOnChange(label) {
    return function(data) {
        var msg = '[' + label + '] code=' + (data && data.code) +
                  ' data=' + (data && data.data) +
                  ' err=' + (data && data.errorName) +
                  ' msg=' + (data && data.errorMessage);
        var isErr = data && data.code && data.code !== 0 &&
                    data.errorName && data.errorName !== 'success';
        log(msg, isErr ? 'log-err' : 'log-evt');
    };
}

// ── Playlist functions ────────────────────────────────────────────────────────

function makeSyncPlayList_123() {
    var playlist = ['1.mp4', '2.mp4', '3.mp4'];
    var duration = 4;
    var contents = playlist.map(function(f) {
        return { path: mediaPath + f, duration: duration };
    });
    log('makeSyncPlayList [1.mp4, 2.mp4, 3.mp4] path=' + mediaPath, 'log-inf');
    try {
        b2bsync.makeSyncPlayList(contents,
            function() { log('makeSyncPlayList OK', 'log-ok'); setStatus('Playlist ready: 1/2/3.mp4'); },
            function(e) { log('makeSyncPlayList ERROR: ' + (e && (e.message || e.name || JSON.stringify(e))), 'log-err'); }
        );
    } catch (e) {
        log('makeSyncPlayList EXCEPTION: ' + e.message, 'log-err');
    }
}

function makeSyncPlayList_signage() {
    var contents = [{ path: mediaPath + 'signage.mp4', duration: 10 }];
    log('makeSyncPlayList [signage.mp4] path=' + contents[0].path, 'log-inf');
    try {
        b2bsync.makeSyncPlayList(contents,
            function() { log('makeSyncPlayList OK', 'log-ok'); setStatus('Playlist ready: signage.mp4'); },
            function(e) { log('makeSyncPlayList ERROR: ' + (e && (e.message || e.name || JSON.stringify(e))), 'log-err'); }
        );
    } catch (e) {
        log('makeSyncPlayList EXCEPTION: ' + e.message, 'log-err');
    }
}

// ── startSyncPlay variants ────────────────────────────────────────────────────

function doStartSyncPlay(posX, posY, width, height, groupID, rotate) {
    var label = 'startSyncPlay(' + posX + ',' + posY + ',' + width + ',' + height + ',grp=' + groupID + ',rot=' + rotate + ')';
    log(label, 'log-inf');
    setStatus(label);
    try {
        var handle = b2bsync.startSyncPlay(posX, posY, width, height, groupID, rotate, makeOnChange(label));
        log(label + ' => handle=' + handle, 'log-ok');
    } catch (e) {
        log(label + ' EXCEPTION: ' + e.message, 'log-err');
    }
}

function startSyncPlay_A() { doStartSyncPlay(0, 0, 1920, 1080, 5, 'OFF'); }  // grp=5 OFF — baseline
function startSyncPlay_B() { doStartSyncPlay(0, 0, 1920, 1080, 7, 'OFF'); }  // grp=7 OFF
function startSyncPlay_C() { doStartSyncPlay(0, 0, 1920, 1080, 7, 'ON');  }  // grp=7 ON

// ── stop / clear ──────────────────────────────────────────────────────────────

function stopSyncPlay() {
    log('stopSyncPlay', 'log-inf');
    setStatus('Stopping…');
    try {
        b2bsync.stopSyncPlay(function(data) {
            log('stopSyncPlay cb: ' + JSON.stringify(data), 'log-evt');
            setStatus('Stopped');
        });
    } catch (e) {
        log('stopSyncPlay EXCEPTION: ' + e.message, 'log-err');
    }
}

function clearSyncPlayList() {
    log('clearSyncPlayList', 'log-inf');
    setStatus('Clearing…');
    try {
        b2bsync.clearSyncPlayList(
            function() { log('clearSyncPlayList OK', 'log-ok'); setStatus('Cleared'); },
            function(e) { log('clearSyncPlayList ERROR: ' + (e && (e.message || e.name)), 'log-err'); }
        );
    } catch (e) {
        log('clearSyncPlayList EXCEPTION: ' + e.message, 'log-err');
    }
}

// ── Key handler ───────────────────────────────────────────────────────────────

function registerKeyHandler() {
    var KEYS = ['1','2','3','4','5','7','8'];
    KEYS.forEach(function(k) {
        try { tizen.tvinputdevice.registerKey(k); } catch (_) {}
    });

    // Key code map — Tizen remote numeric keys
    var KEY_MAP = {
        49: makeSyncPlayList_123,      // 1
        50: makeSyncPlayList_signage,  // 2
        51: startSyncPlay_A,           // 3  grp=5 OFF
        52: startSyncPlay_B,           // 4  grp=7 OFF
        53: startSyncPlay_C,           // 5  grp=7 ON
        55: stopSyncPlay,              // 7
        56: clearSyncPlayList,         // 8
        10009: function() {            // BACK / RETURN → exit
            try { tizen.application.getCurrentApplication().exit(); } catch (_) {}
        }
    };

    document.addEventListener('keydown', function(e) {
        log('keydown: ' + e.keyCode, 'log-inf');
        if (KEY_MAP[e.keyCode]) {
            KEY_MAP[e.keyCode]();
        }
    });
}

// ── init ──────────────────────────────────────────────────────────────────────

function init() {
    logsEl   = document.getElementById('logs');
    statusEl = document.getElementById('status-line');

    window.onerror = function(msg, src, line) {
        log('[JSERR] ' + msg + ' (' + src + ':' + line + ')', 'log-err');
        return false;
    };

    if (typeof tizen === 'undefined') {
        log('ERROR: tizen API not available — run on Tizen TV', 'log-err');
        setStatus('Not a Tizen device');
        return;
    }

    if (!window.b2bapis || !window.b2bapis.b2bsyncplay) {
        log('ERROR: b2bapis.b2bsyncplay not available on this firmware', 'log-err');
        setStatus('b2bsyncplay unavailable');
        return;
    }

    b2bsync = window.b2bapis.b2bsyncplay;

    // Build the file:// path to the bundled media folder (Tizen 3.0+ path)
    var pkgId = tizen.application.getAppInfo().packageId;
    mediaPath = 'file:///home/owner/apps_rw/' + pkgId + '/res/wgt/media/';

    var ver = '';
    try { ver = b2bsync.getVersion(); } catch (_) {}

    log('b2bsyncplay version: ' + ver, 'log-ok');
    log('mediaPath: ' + mediaPath, 'log-inf');
    setStatus('Ready  —  b2bsyncplay v' + ver);

    registerKeyHandler();
}
