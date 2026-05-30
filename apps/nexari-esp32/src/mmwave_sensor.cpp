#include "mmwave_sensor.h"
#include "config.h"
#include "logger.h"

// ── Frame constants ───────────────────────────────────────────────────────────
// Normal Mode / command frames: header FD FC FB FA, tail 04 03 02 01
// Report Mode frames:           header F4 F3 F2 F1, tail F8 F7 F6 F5
//
// General frame layout (both modes):
//   [header 4B] [len 2B LE] [data lenB] [tail 4B]
//
// Normal Mode data (len=8):
//   [cmd 2B LE = 0x0012] [flags 2B] [distance_cm 4B LE]
//   distance_cm > 0 → present; == 0 → absent
//
// Report Mode data (len ≥ 3):
//   [present 1B: 00=absent, 01=present] [distance 2B LE]

#define HMMD_UART   Serial2

MmwaveSensor mmwaveSensor;

// ── begin ─────────────────────────────────────────────────────────────────────

void MmwaveSensor::begin() {
    HMMD_UART.begin(115200, SERIAL_8N1, MMWAVE_RX_PIN, MMWAVE_TX_PIN);
    Logger::info("[Mmwave] ready on RX=%d TX=%d", MMWAVE_RX_PIN, MMWAVE_TX_PIN);
}

// ── update ────────────────────────────────────────────────────────────────────

void MmwaveSensor::update() {
    // Drain UART into buffer
    while (HMMD_UART.available() && _bufLen < sizeof(_buf)) {
        _buf[_bufLen++] = (uint8_t)HMMD_UART.read();
    }
    // Parse as many complete frames as possible
    while (_bufLen > 0) {
        if (!_tryParse()) break;
    }
}

// ── _dropByte ────────────────────────────────────────────────────────────────

void MmwaveSensor::_dropByte() {
    if (_bufLen > 1) memmove(_buf, _buf + 1, _bufLen - 1);
    if (_bufLen > 0) _bufLen--;
}

// ── _tryParse ─────────────────────────────────────────────────────────────────

bool MmwaveSensor::_tryParse() {
    if (_bufLen < 4) return false;

    // ── Normal Mode header: FD FC FB FA ──────────────────────────────────────
    if (_buf[0] == 0xFD && _buf[1] == 0xFC &&
        _buf[2] == 0xFB && _buf[3] == 0xFA)
    {
        if (_bufLen < 6) return false;                       // need length bytes
        uint16_t dataLen  = (uint16_t)_buf[4] | ((uint16_t)_buf[5] << 8);
        uint16_t totalLen = 4 + 2 + dataLen + 4;

        if (dataLen > 32 || totalLen > sizeof(_buf)) {       // implausible length
            _dropByte(); return true;
        }
        if (_bufLen < totalLen) return false;                // wait for more

        // Verify tail: 04 03 02 01
        const uint8_t *tail = _buf + 4 + 2 + dataLen;
        if (tail[0] == 0x04 && tail[1] == 0x03 &&
            tail[2] == 0x02 && tail[3] == 0x01)
        {
            _handleNormalFrame(_buf + 6, dataLen);
        } else {
            Logger::warn("[Mmwave] bad normal tail — skipping byte");
        }
        // Consume frame regardless of tail validity
        uint16_t remain = _bufLen - totalLen;
        memmove(_buf, _buf + totalLen, remain);
        _bufLen = remain;
        return true;
    }

    // ── Report Mode header: F4 F3 F2 F1 ─────────────────────────────────────
    if (_buf[0] == 0xF4 && _buf[1] == 0xF3 &&
        _buf[2] == 0xF2 && _buf[3] == 0xF1)
    {
        if (_bufLen < 6) return false;
        uint16_t dataLen  = (uint16_t)_buf[4] | ((uint16_t)_buf[5] << 8);
        uint16_t totalLen = 4 + 2 + dataLen + 4;

        if (dataLen > 40 || totalLen > sizeof(_buf)) {
            _dropByte(); return true;
        }
        if (_bufLen < totalLen) return false;

        // Verify tail: F8 F7 F6 F5
        const uint8_t *tail = _buf + 4 + 2 + dataLen;
        if (tail[0] == 0xF8 && tail[1] == 0xF7 &&
            tail[2] == 0xF6 && tail[3] == 0xF5)
        {
            _handleReportFrame(_buf + 6, dataLen);
        } else {
            Logger::warn("[Mmwave] bad report tail — skipping byte");
        }
        uint16_t remain = _bufLen - totalLen;
        memmove(_buf, _buf + totalLen, remain);
        _bufLen = remain;
        return true;
    }

    // ── Unknown first byte: discard ───────────────────────────────────────────
    _dropByte();
    return true;
}

// ── _handleNormalFrame ────────────────────────────────────────────────────────
// In-frame data layout (len=8):
//   [0..1] command = 0x0012
//   [2..3] flags / sub-state
//   [4..7] distance_cm (uint32 LE)

void MmwaveSensor::_handleNormalFrame(const uint8_t *data, uint16_t len) {
    if (len < 8) return;
    uint16_t cmd = (uint16_t)data[0] | ((uint16_t)data[1] << 8);
    if (cmd != 0x0012) return;   // only care about detection reports

    uint32_t val = (uint32_t)data[4]
                 | ((uint32_t)data[5] << 8)
                 | ((uint32_t)data[6] << 16)
                 | ((uint32_t)data[7] << 24);

    _data.present     = (val > 0);
    _data.distanceCm  = (uint16_t)(val > 0xFFFF ? 0xFFFF : val);
    _data.lastUpdateMs = millis();
    Logger::debug("[Mmwave] NRM present=%d dist=%ucm", (int)_data.present, _data.distanceCm);
}

// ── _handleReportFrame ────────────────────────────────────────────────────────
// In-frame data layout (len ≥ 3):
//   [0]    detection result: 0x00=absent, 0x01=present
//   [1..2] target distance (uint16 LE)
//   [3+]   per-gate energy values (optional)

void MmwaveSensor::_handleReportFrame(const uint8_t *data, uint16_t len) {
    if (len < 3) return;
    _data.present     = (data[0] == 0x01);
    _data.distanceCm  = (uint16_t)data[1] | ((uint16_t)data[2] << 8);
    _data.lastUpdateMs = millis();
    Logger::debug("[Mmwave] RPT present=%d dist=%ucm", (int)_data.present, _data.distanceCm);
}
