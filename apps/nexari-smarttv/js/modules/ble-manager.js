// BLE Manager — Nexari Smart TV
// Full Tizen Bluetooth LE implementation.
// Scans for beacons, evaluates proximity rules, and posts results to the server.
window.BleManager = (function () {
  'use strict';

  // ── Constants ──────────────────────────────────────────────────────────────
  var PERIODIC_INTERVAL_MS  = 30000;  // rule evaluation scan every 30s
  var ON_DEMAND_SCAN_MS     = 10000;  // on-demand scan duration
  var PERIODIC_SCAN_MS      = 5000;   // periodic scan duration
  var TX_POWER_DEFAULT      = -65;    // RSSI at 1m (typical iBeacon default)
  var PATH_N                = 2;      // path-loss exponent (free space)

  // ── State ──────────────────────────────────────────────────────────────────
  var _supported  = false;
  var _scanning   = false;
  var _beacons    = {};    // uuid+major+minor → latest ScannedBeacon
  var _rules      = [];    // array of DeviceRule objects (set via setRules)
  var _adapter    = null;
  var _periodicTimer = null;
  var _scanTimer   = null;
  var _activeRuleId = null;  // currently triggered rule id (to detect changes)

  // ── Helpers ────────────────────────────────────────────────────────────────

  function _log(level, msg) {
    if (typeof logger !== 'undefined') {
      try { logger[level]('[BLE] ' + msg); } catch (e) {}
    }
  }

  /**
   * Convert RSSI to distance in cm using the log-distance path loss model.
   * distanceCm = 100 * 10^((TxPower - RSSI) / (10 * N))
   */
  function _rssiToDistanceCm(rssi, txPower) {
    var power = txPower != null ? txPower : TX_POWER_DEFAULT;
    var distanceM = Math.pow(10, (power - rssi) / (10 * PATH_N));
    return Math.round(distanceM * 100);
  }

  /**
   * Build a stable cache key for a beacon.
   */
  function _beaconKey(uuid, major, minor) {
    return (uuid || '').toUpperCase() + ':' + (major != null ? major : '*') + ':' + (minor != null ? minor : '*');
  }

  /**
   * Check Tizen BLE capability.
   */
  function _checkSupport() {
    try {
      _supported = !!(
        typeof tizen !== 'undefined' &&
        tizen.bluetooth &&
        typeof tizen.bluetooth.getLEAdapter === 'function'
      );
    } catch (e) {
      _supported = false;
    }
    return _supported;
  }

  // ── Scanning ───────────────────────────────────────────────────────────────

  /**
   * Start a BLE LE scan for `durationMs` ms, then call `onDone` with the
   * collected beacon list.
   */
  function _runScan(durationMs, onDone) {
    if (!_checkSupport()) {
      _log('warn', 'BLE not supported on this device');
      if (onDone) onDone([]);
      return;
    }
    if (_scanning) {
      // If a scan is already in progress, just wait for it to finish
      _log('info', 'Scan already in progress — skipping duplicate request');
      return;
    }

    try {
      _adapter = tizen.bluetooth.getLEAdapter();
    } catch (e) {
      _log('error', 'getLEAdapter failed: ' + e);
      if (onDone) onDone([]);
      return;
    }

    _beacons = {};
    _scanning = true;
    _log('info', 'Starting BLE scan for ' + durationMs + 'ms');

    try {
      _adapter.startScan(
        function onDeviceFound(device) {
          try {
            var adData = device.uuids && device.uuids.length > 0 ? device.uuids[0] : null;
            var uuid   = adData || (device.address ? device.address.replace(/:/g, '') : null);
            if (!uuid) return;

            // Try to extract iBeacon TLV from manufacturerData
            var major  = null;
            var minor  = null;
            var txPwr  = TX_POWER_DEFAULT;
            if (device.manufacturerData) {
              try {
                var raw = device.manufacturerData;
                // iBeacon: company=004C, type=02, len=15
                // bytes: [0]=0x4C, [1]=0x00, [2]=0x02, [3]=0x15, [4..19]=UUID,
                //        [20..21]=major, [22..23]=minor, [24]=tx_power
                if (raw.length >= 25 && raw[2] === 0x02 && raw[3] === 0x15) {
                  var uuidBytes = raw.slice(4, 20);
                  uuid = [
                    _bytesToHex(uuidBytes.slice(0, 4)),
                    _bytesToHex(uuidBytes.slice(4, 6)),
                    _bytesToHex(uuidBytes.slice(6, 8)),
                    _bytesToHex(uuidBytes.slice(8, 10)),
                    _bytesToHex(uuidBytes.slice(10, 16)),
                  ].join('-').toUpperCase();
                  major = (raw[20] << 8) | raw[21];
                  minor = (raw[22] << 8) | raw[23];
                  txPwr = raw[24] > 127 ? raw[24] - 256 : raw[24];  // signed byte
                }
              } catch (ex) { /* non-iBeacon — use address/uuid as-is */ }
            }

            var key = _beaconKey(uuid, major, minor);
            var distanceCm = _rssiToDistanceCm(device.rssi, txPwr);
            _beacons[key] = {
              uuid:       uuid,
              major:      major,
              minor:      minor,
              rssi:       device.rssi,
              distanceCm: distanceCm,
              name:       device.name || null,
            };
          } catch (ex) {
            _log('warn', 'Error processing beacon: ' + ex);
          }
        },
        function onScanError(err) {
          _log('error', 'BLE scan error: ' + (err && err.message || err));
          _scanning = false;
          if (onDone) onDone(_flattenBeacons());
        }
      );
    } catch (startErr) {
      _log('error', 'startScan threw: ' + startErr);
      _scanning = false;
      if (onDone) onDone([]);
      return;
    }

    // Stop scan after duration
    _scanTimer = setTimeout(function () {
      try {
        _adapter.stopScan(
          function () {
            _log('info', 'Scan finished, ' + Object.keys(_beacons).length + ' beacon(s) found');
            _scanning = false;
            if (onDone) onDone(_flattenBeacons());
          },
          function (err) {
            _log('warn', 'stopScan error: ' + (err && err.message || err));
            _scanning = false;
            if (onDone) onDone(_flattenBeacons());
          }
        );
      } catch (e) {
        _scanning = false;
        if (onDone) onDone(_flattenBeacons());
      }
    }, durationMs);
  }

  function _flattenBeacons() {
    return Object.keys(_beacons).map(function (k) { return _beacons[k]; });
  }

  function _bytesToHex(bytes) {
    return Array.prototype.map.call(bytes, function (b) {
      return ('0' + (b & 0xFF).toString(16)).slice(-2);
    }).join('');
  }

  // ── Rule evaluation ────────────────────────────────────────────────────────

  /**
   * Given the current beacon map, evaluate all rules (sorted by priority desc)
   * and return the first matching rule, or null.
   */
  function _evaluateRules(beaconList) {
    if (!_rules || _rules.length === 0) return null;

    var sorted = _rules.slice().sort(function (a, b) {
      return (b.priority || 0) - (a.priority || 0);
    });

    for (var i = 0; i < sorted.length; i++) {
      var rule = sorted[i];
      if (!rule.enabled) continue;
      if (_matchRule(rule, beaconList)) return rule;
    }
    return null;
  }

  /**
   * Returns true if the rule's conditions are satisfied by the current beacons.
   */
  function _matchRule(rule, beaconList) {
    var group = rule.conditions;
    if (!group || group.type !== 'group') return false;
    var children = group.children || [];
    var logic = group.logic === 'OR' ? 'OR' : 'AND';

    for (var j = 0; j < children.length; j++) {
      var cond = children[j];
      var match = _matchCondition(cond, beaconList);
      if (logic === 'AND' && !match) return false;
      if (logic === 'OR'  &&  match) return true;
    }
    return logic === 'AND';  // all matched for AND, none matched for OR
  }

  function _matchCondition(cond, beaconList) {
    if (!cond || cond.type !== 'ble_beacon') return false;
    var targetUuid = (cond.uuid || '').toUpperCase();

    for (var k = 0; k < beaconList.length; k++) {
      var b = beaconList[k];
      if ((b.uuid || '').toUpperCase() !== targetUuid) continue;
      if (cond.major != null && b.major !== cond.major) continue;
      if (cond.minor != null && b.minor !== cond.minor) continue;

      // Distance check
      var distCm = b.distanceCm != null ? b.distanceCm : _rssiToDistanceCm(b.rssi, null);
      var minOk  = cond.distanceMinCm == null || distCm >= cond.distanceMinCm;
      var maxOk  = cond.distanceMaxCm == null || distCm <= cond.distanceMaxCm;
      if (minOk && maxOk) return true;
    }
    return false;
  }

  /**
   * Apply matched rule to the player.
   */
  function _applyRule(rule) {
    if (!rule) return;
    var action = rule.action;
    if (!action) return;

    _log('info', 'Applying rule: ' + rule.name + ' action=' + action.type);

    try {
      if (action.type === 'play_playlist' && action.playlistId) {
        if (typeof NexariPlayer !== 'undefined' && NexariPlayer.overridePlaylistForRule) {
          NexariPlayer.overridePlaylistForRule(rule.id, action.playlistId, null);
        }
      } else if (action.type === 'play_content' && action.contentId) {
        if (typeof NexariPlayer !== 'undefined' && NexariPlayer.overridePlaylistForRule) {
          NexariPlayer.overridePlaylistForRule(rule.id, null, action.contentId);
        }
      }
    } catch (e) {
      _log('error', 'applyRule failed: ' + e);
    }
  }

  /**
   * Clear the active rule override if no rule matches.
   */
  function _clearActiveRule() {
    if (_activeRuleId != null) {
      _log('info', 'No beacon match — clearing rule override');
      _activeRuleId = null;
      try {
        if (typeof NexariPlayer !== 'undefined' && NexariPlayer.clearRuleOverride) {
          NexariPlayer.clearRuleOverride();
        }
      } catch (e) {}
    }
  }

  // ── Server reporting ────────────────────────────────────────────────────────

  function _postScanResults(beaconList) {
    try {
      var apiBase = (typeof window._apiBase !== 'undefined' && window._apiBase)
        || (typeof window.__DS_API_BASE !== 'undefined' && window.__DS_API_BASE)
        || localStorage.getItem('_apiBase')
        || '';
      var token   = localStorage.getItem('_deviceToken')
        || (typeof window._deviceToken !== 'undefined' ? window._deviceToken : null);

      if (!apiBase || !token) {
        _log('warn', 'Cannot post scan results — missing apiBase or deviceToken');
        return;
      }

      var payload = JSON.stringify({
        beacons: beaconList.map(function (b) {
          return { uuid: b.uuid, major: b.major, minor: b.minor, rssi: b.rssi, name: b.name };
        }),
      });

      var xhr = new XMLHttpRequest();
      xhr.open('POST', apiBase + '/api/v1/devices/device/ble-scan-result', true);
      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.setRequestHeader('Authorization', 'Bearer ' + token);
      xhr.onload = function () {
        _log('info', 'Scan results posted, status=' + xhr.status);
      };
      xhr.onerror = function () {
        _log('warn', 'Failed to post scan results');
      };
      xhr.send(payload);
    } catch (e) {
      _log('error', 'postScanResults threw: ' + e);
    }
  }

  // ── Periodic scan loop ──────────────────────────────────────────────────────

  function _startPeriodicScan() {
    if (_periodicTimer) return;
    _periodicTimer = setInterval(function () {
      _runScan(PERIODIC_SCAN_MS, function (beaconList) {
        var matchedRule = _evaluateRules(beaconList);
        if (matchedRule) {
          if (_activeRuleId !== matchedRule.id) {
            _activeRuleId = matchedRule.id;
            _applyRule(matchedRule);
          }
        } else {
          _clearActiveRule();
        }
      });
    }, PERIODIC_INTERVAL_MS);
    _log('info', 'Periodic BLE scan started (every ' + (PERIODIC_INTERVAL_MS / 1000) + 's)');
  }

  function _stopPeriodicScan() {
    if (_periodicTimer) {
      clearInterval(_periodicTimer);
      _periodicTimer = null;
    }
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  return {
    /**
     * Initialise BLE manager — call once on player startup when rules are ready.
     */
    start: function () {
      if (!_checkSupport()) {
        _log('warn', 'Bluetooth LE not supported on this device');
        if (document.getElementById('tools-ble-status')) document.getElementById('tools-ble-status').textContent = 'Not supported';
        return;
      }
      _startPeriodicScan();
      if (document.getElementById('tools-ble-status')) document.getElementById('tools-ble-status').textContent = 'Scanning…';
    },

    /**
     * Stop periodic scanning.
     */
    stop: function () {
      _stopPeriodicScan();
      if (_scanTimer) { clearTimeout(_scanTimer); _scanTimer = null; }
      if (_adapter && _scanning) {
        try { _adapter.stopScan(function () {}, function () {}); } catch (e) {}
      }
      _scanning = false;
      _log('info', 'BLE Manager stopped');
    },

    /**
     * Set (replace) the current rules from the server.
     * Called when the player receives a `device_rules` WS command.
     */
    setRules: function (rules) {
      _rules = Array.isArray(rules) ? rules : [];
      _log('info', 'Rules updated: ' + _rules.length + ' rule(s)');
      // If rules were cleared, clear any active override
      if (_rules.length === 0) _clearActiveRule();
      // Start periodic scan if we now have rules
      if (_rules.length > 0 && _checkSupport() && !_periodicTimer) {
        _startPeriodicScan();
      }
    },

    /**
     * Trigger an on-demand scan (called when server sends `ble_scan` command).
     * Results are posted back to the server.
     */
    triggerOnDemandScan: function () {
      _log('info', 'On-demand scan requested');
      _runScan(ON_DEMAND_SCAN_MS, function (beaconList) {
        _log('info', 'On-demand scan complete: ' + beaconList.length + ' beacon(s)');
        _postScanResults(beaconList);
        // Also evaluate rules immediately
        var matched = _evaluateRules(beaconList);
        if (matched && _activeRuleId !== matched.id) {
          _activeRuleId = matched.id;
          _applyRule(matched);
        } else if (!matched) {
          _clearActiveRule();
        }
      });
    },

    isSupported: function () { return _checkSupport(); },
    isScanning:  function () { return _scanning; },
    getBeacons:  function () { return _flattenBeacons(); },
    getRules:    function () { return _rules.slice(); },
  };
})();
