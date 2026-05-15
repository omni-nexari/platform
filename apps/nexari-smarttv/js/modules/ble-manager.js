// BLE Manager — Nexri-tv
// Stub: BLE scanning and beacon-triggered playlist switching.
// Full implementation will be compiled from src/modules/ble-manager.ts.
window.BleManager = (function () {
  'use strict';

  var _listeners = {};
  var _scanning = false;
  var _supported = false;
  var _beacons = [];

  function _emit(event, data) {
    var cbs = _listeners[event] || [];
    for (var i = 0; i < cbs.length; i++) { try { cbs[i](data); } catch (e) {} }
  }

  function _checkSupport() {
    try {
      _supported = !!(
        typeof tizen !== 'undefined' &&
        tizen.systeminfo &&
        tizen.systeminfo.getCapability('http://tizen.org/feature/network.bluetooth.le')
      );
    } catch (e) {
      _supported = false;
    }
    return _supported;
  }

  return {
    start: function () {
      if (!_checkSupport()) {
        if (typeof logger !== 'undefined') logger.warn('[BLE] Bluetooth LE not supported on this device');
        if (document.getElementById('tools-ble-status')) document.getElementById('tools-ble-status').textContent = 'Not supported';
        return;
      }
      if (_scanning) return;
      _scanning = true;
      if (typeof logger !== 'undefined') logger.info('[BLE] Scan started (stub — full impl pending)');
      if (document.getElementById('tools-ble-status')) document.getElementById('tools-ble-status').textContent = 'Scanning…';
    },

    stop: function () {
      if (!_scanning) return;
      _scanning = false;
      if (typeof logger !== 'undefined') logger.info('[BLE] Scan stopped');
      if (document.getElementById('tools-ble-status')) document.getElementById('tools-ble-status').textContent = 'Stopped';
    },

    isSupported: function () { return _supported; },
    isScanning:  function () { return _scanning; },
    getBeacons:  function () { return _beacons.slice(); },

    on: function (event, cb) {
      if (!_listeners[event]) _listeners[event] = [];
      _listeners[event].push(cb);
    },

    off: function (event, cb) {
      if (!_listeners[event]) return;
      _listeners[event] = _listeners[event].filter(function (f) { return f !== cb; });
    },
  };
})();
