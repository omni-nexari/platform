#pragma once
#include <Arduino.h>
#include <vector>

// ── BLE beacon result ──────────────────────────────────────────────────────────
struct BleBeacon {
    /** iBeacon UUID (e.g. "XXXXXXXX-XXXX-…") or BLE MAC address as fallback */
    String uuid;
    /** Advertised device name (may be empty) */
    String name;
    /** Signal strength in dBm */
    int rssi = 0;
    /** iBeacon major (-1 if not iBeacon) */
    int major = -1;
    /** iBeacon minor (-1 if not iBeacon) */
    int minor = -1;
};

// ── BleScanner ─────────────────────────────────────────────────────────────────
/**
 * Thin wrapper around NimBLE scan.
 * Usage:
 *   bleScanner.begin();                // once, after BLE init
 *   bleScanner.startScan(5);           // trigger 5-second scan
 *   // later in loop():
 *   if (bleScanner.isComplete()) {
 *       auto& results = bleScanner.results();
 *       bleScanner.reset();
 *   }
 */
class BleScanner {
public:
    /** One-time BLE stack initialisation. Call from setup() after WiFi. */
    void begin();

    /**
     * Start an async BLE scan.
     * @param durationSec How long to scan (seconds). Max ~30 s recommended.
     * Returns immediately; check isComplete() in loop().
     */
    void startScan(uint32_t durationSec = 5);

    /** True while the NimBLE scan is in progress. */
    bool isScanning() const;

    /** True once a scan has finished and results are ready. */
    bool isComplete() const;

    /** Collected beacons from the most recent scan. */
    const std::vector<BleBeacon>& results() const { return _results; }

    /** Clear completion flag + results so the next scan can be triggered. */
    void reset();

    // ── internal use by static callback ────────────────────────────────────
    void _onScanDone();
    std::vector<BleBeacon> _results;

private:
    bool _scanning  = false;
    bool _complete  = false;
    bool _begun     = false;
};

extern BleScanner bleScanner;
