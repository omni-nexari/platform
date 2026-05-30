#include "mmwave_sensor.h"
#include "config.h"
#include "logger.h"

// -- Waveshare HMMD 24GHz � simple ASCII text output mode ---------------------
// The sensor emits plain text lines separated by \r\n:
//   ON\r\n           � person detected
//   Range N\r\n      � detected gate N (0.75 m per gate -> distCm = N * 75)
//   OFF\r\n          � no person detected

#define HMMD_UART   Serial2

MmwaveSensor mmwaveSensor;

// -- begin ---------------------------------------------------------------------

void MmwaveSensor::begin() {
    HMMD_UART.begin(115200, SERIAL_8N1, MMWAVE_RX_PIN, MMWAVE_TX_PIN);
    Logger::info("[Mmwave] ready on RX=%d TX=%d", MMWAVE_RX_PIN, MMWAVE_TX_PIN);
}

// -- update --------------------------------------------------------------------

void MmwaveSensor::update() {
    while (HMMD_UART.available() && _bufLen < sizeof(_buf) - 1) {
        char c = (char)HMMD_UART.read();
        if (c == '\r') continue;
        if (c == '\n') {
            _buf[_bufLen] = '\0';
            _parseLine((const char *)_buf);
            _bufLen = 0;
            continue;
        }
        _buf[_bufLen++] = (uint8_t)c;
    }
}

// -- _parseLine ----------------------------------------------------------------

void MmwaveSensor::_parseLine(const char *line) {
    if (strcmp(line, "ON") == 0) {
        _data.present      = true;
        _data.lastUpdateMs = millis();
        Logger::debug("[Mmwave] present=1");
    } else if (strcmp(line, "OFF") == 0) {
        _data.present      = false;
        _data.distanceCm   = 0;
        _data.lastUpdateMs = millis();
        Logger::debug("[Mmwave] present=0");
    } else if (strncmp(line, "Range ", 6) == 0) {
        int raw      = atoi(line + 6);
        int adjusted = raw + MMWAVE_DIST_OFFSET_CM;
        if (adjusted < 0) adjusted = 0;
        // Exponential moving average to smooth jitter
        if (!_smoothInit) { _smoothedCm = (float)adjusted; _smoothInit = true; }
        else _smoothedCm = MMWAVE_EMA_ALPHA * (float)adjusted
                         + (1.0f - MMWAVE_EMA_ALPHA) * _smoothedCm;
        _data.distanceCm   = (uint16_t)(_smoothedCm + 0.5f);
        _data.lastUpdateMs = millis();
        Logger::debug("[Mmwave] raw=%dcm offset=%d smoothed=%ucm",
                      raw, MMWAVE_DIST_OFFSET_CM, _data.distanceCm);
    }
    // Ignore unrecognised lines (version strings, blank lines, etc.)
}
