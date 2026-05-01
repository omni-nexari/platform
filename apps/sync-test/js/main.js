var tvKey = new LIB.TizenKeyValue();
var result = null;
var b2bsync = null;
var test = null;

var path = "file:///home/owner/apps_rw/" + tizen.application.getAppInfo().packageId + "/res/wgt/images/";
var playlist = ["1.mp4", "2.mp4", "3.mp4"];
var playduration = [4, 4, 4];

function addResult(data) {
    test.innerHTML += data + '<br/>';
    console.log(data);
}

function makeSyncPlayList() {
    console.log("[makeSyncPlayList] called");
    var onSuccess = function() {
        addResult("[makeSyncPlayList] SUCCESS");
    };
    var onError = function(e) {
        addResult("[makeSyncPlayList] ERROR: " + e.code + " " + e.name + " " + e.message);
    };
    var syncPlayContents = [];
    for (var i = 0; i < playlist.length; i++) {
        syncPlayContents[i] = { path: path + playlist[i], duration: playduration[i] };
    }
    b2bapis.b2bsyncplay.makeSyncPlayList(syncPlayContents, onSuccess, onError);
}

function clearSyncPlayList() {
    console.log("[clearSyncPlayList] called");
    var onSuccess = function() { addResult("[clearSyncPlayList] SUCCESS"); };
    var onError = function(e) { addResult("[clearSyncPlayList] ERROR: " + e.code + " " + e.name); };
    b2bsync.clearSyncPlayList(onSuccess, onError);
}

// Sub-rect test
function startSyncPlay() {
    var onChange = function(data) {
        addResult("[onChange] code=" + data.code + " data=" + data.data + " err=" + data.errorName);
    };
    try {
        addResult("[startSyncPlay] rect=(780,180,965,520)");
        b2bsync.startSyncPlay(780, 180, 965, 520, 5, "OFF", onChange);
    } catch (e) {
        addResult("[startSyncPlay] EXCEPTION: " + e.code + " " + e.name + " " + e.message);
    }
}

// FULL SCREEN — Samsung reference: (0,0,1920,1080)
function startSyncPlay_full() {
    var onChange = function(data) {
        addResult("[onChange_full] code=" + data.code + " data=" + data.data + " err=" + data.errorName);
    };
    try {
        addResult("[startSyncPlay_full] rect=(0,0,1920,1080)");
        b2bsync.startSyncPlay(0, 0, 1920, 1080, 5, "OFF", onChange);
    } catch (e) {
        addResult("[startSyncPlay_full] EXCEPTION: " + e.code + " " + e.name + " " + e.message);
    }
}

// Rotated sub-rect test
function startSyncPlay_rotate() {
    var onChange = function(data) {
        addResult("[onChange_rotate] code=" + data.code + " data=" + data.data + " err=" + data.errorName);
    };
    try {
        addResult("[startSyncPlay_rotate] rect=(780,180,965,520) rotate=90");
        b2bsync.startSyncPlay(780, 180, 965, 520, 7, "90", onChange);
    } catch (e) {
        addResult("[startSyncPlay_rotate] EXCEPTION: " + e.code + " " + e.name + " " + e.message);
    }
}

function stopSyncPlay() {
    var onChange = function(data) {
        addResult("[stopSyncPlay] code=" + data.code + " data=" + data.data + " err=" + data.errorName);
    };
    try {
        addResult("[stopSyncPlay] stopping...");
        b2bsync.stopSyncPlay(onChange);
    } catch (e) {
        addResult("[stopSyncPlay] EXCEPTION: " + e.code + " " + e.name + " " + e.message);
    }
}

function registerKeys() {
    var usedKeys = ['1', '2', '3', '4', '5', '6'];
    usedKeys.forEach(function(k) { tizen.tvinputdevice.registerKey(k); });
}

function registerKeyHandler() {
    document.addEventListener('keydown', function(event) {
        var keyCode = event.keyCode;
        switch (keyCode) {
            case tvKey.KEY_1: makeSyncPlayList();     break;
            case tvKey.KEY_2: startSyncPlay();        break;
            case tvKey.KEY_3: stopSyncPlay();         break;
            case tvKey.KEY_4: clearSyncPlayList();    break;
            case tvKey.KEY_5: startSyncPlay_rotate(); break;
            case tvKey.KEY_6: startSyncPlay_full();   break;
            default: console.log("unhandled key: " + keyCode); break;
        }
    });
}

var init = function() {
    if (window.tizen === undefined) {
        console.log('Needs Tizen device');
        return;
    }
    test = document.getElementById('test');
    b2bsync = window.b2bapis.b2bsyncplay;
    addResult("packageId: " + tizen.application.getAppInfo().packageId);
    addResult("path: " + path);
    registerKeys();
    registerKeyHandler();
    console.log("SyncTest init done");
};
