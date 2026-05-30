#include "ble_scanner.h"
#include "logger.h"

#include <NimBLEDevice.h>

BleScanner bleScanner;

// ── static scan-done callback (NimBLE requires a plain function pointer) ──────
static void onScanComplete(NimBLEScanResults /*results*/) {
    bleScanner._onScanDone();
}

// ── Advertised-device callbacks ───────────────────────────────────────────────
class ScanCB : public NimBLEAdvertisedDeviceCallbacks {
public:
    std::vector<BleBeacon> *out = nullptr;

    void onResult(NimBLEAdvertisedDevice *adv) override {
        if (!out) return;

        BleBeacon b;
        b.rssi = adv->getRSSI();
        b.name = adv->getName().c_str();

        // ── Try to parse iBeacon from manufacturer specific data ────────────
        // Format (raw bytes after AD type 0xFF already stripped by NimBLE):
        //   [0-1]  Company ID LE  (0x4C 0x00 = Apple)
        //   [2]    iBeacon subtype = 0x02
        //   [3]    iBeacon length  = 0x15 (21 bytes follow)
        //   [4-19] Proximity UUID (16 bytes, big-endian)
        //   [20-21] Major (big-endian)
        //   [22-23] Minor (big-endian)
        //   [24]   TX Power
        if (adv->haveManufacturerData()) {
            const std::string mfr = adv->getManufacturerData();
            if (mfr.size() >= 25
                && (uint8_t)mfr[0] == 0x4C && (uint8_t)mfr[1] == 0x00  // Apple
                && (uint8_t)mfr[2] == 0x02 && (uint8_t)mfr[3] == 0x15) // iBeacon
            {
                const auto *u = reinterpret_cast<const uint8_t *>(mfr.data() + 4);
                char uuidStr[37];
                snprintf(uuidStr, sizeof(uuidStr),
                    "%02x%02x%02x%02x-"
                    "%02x%02x-%02x%02x-%02x%02x-"
                    "%02x%02x%02x%02x%02x%02x",
                    u[0],u[1],u[2],u[3],
                    u[4],u[5],u[6],u[7],
                    u[8],u[9],
                    u[10],u[11],u[12],u[13],u[14],u[15]);
                b.uuid  = uuidStr;
                b.major = ((uint8_t)mfr[20] << 8) | (uint8_t)mfr[21];
                b.minor = ((uint8_t)mfr[22] << 8) | (uint8_t)mfr[23];
            } else {
                // Not iBeacon — use MAC address as identifier
                b.uuid = adv->getAddress().toString().c_str();
            }
        } else {
            b.uuid = adv->getAddress().toString().c_str();
        }

        out->push_back(b);
    }
};

static ScanCB s_cb;

// ── BleScanner impl ───────────────────────────────────────────────────────────

void BleScanner::begin() {
    if (_begun) return;
    NimBLEDevice::init("");
    NimBLEDevice::setPower(ESP_PWR_LVL_P3);  // +3 dBm TX
    _begun = true;
    Logger::info("[BLE] NimBLE initialized");
}

void BleScanner::startScan(uint32_t durationSec) {
    if (_scanning) {
        Logger::warn("[BLE] Scan already in progress — ignoring");
        return;
    }

    _results.clear();
    _complete = false;
    _scanning = true;

    NimBLEScan *scan = NimBLEDevice::getScan();
    s_cb.out = &_results;
    scan->setAdvertisedDeviceCallbacks(&s_cb, /*wantDuplicates=*/false);
    scan->setActiveScan(true);   // request scan-response packets for names
    scan->setInterval(100);      // ms
    scan->setWindow(99);         // ms (slightly under interval)

    scan->start(durationSec, onScanComplete, /*is_continue=*/false);
    Logger::info("[BLE] Scan started — %u sec", (unsigned)durationSec);
}

bool BleScanner::isScanning()  const { return _scanning; }
bool BleScanner::isComplete()  const { return _complete; }

void BleScanner::reset() {
    _complete = false;
    _results.clear();
}

void BleScanner::_onScanDone() {
    _scanning = false;
    _complete = true;
    Logger::info("[BLE] Scan complete — %d device(s) found",
                 (int)_results.size());
}
