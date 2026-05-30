#pragma once
#include <Arduino.h>

// ── Waveshare HMMD mmWave Sensor driver ──────────────────────────────────────
// UART 115200 8N1. Default output is Normal Mode binary frames.
// Sensor TX wired to ESP32 RX=MMWAVE_RX_PIN (pin 44).
// Sensor RX wired to ESP32 TX=MMWAVE_TX_PIN (pin 43).

struct MmwaveData {
    bool     present     = false;   // human body detected
    uint16_t distanceCm  = 0;       // radial distance in cm (0 if absent)
    uint32_t lastUpdateMs = 0;      // millis() of last valid frame
};

class MmwaveSensor {
public:
    void begin();
    // Call from loop() — drains UART RX and parses any complete frames.
    void update();

    bool     isPresent()    const { return _data.present; }
    uint16_t getDistanceCm() const { return _data.distanceCm; }
    // True once at least one valid frame has been received.
    bool     hasData()      const { return _data.lastUpdateMs > 0; }
    const MmwaveData &data() const { return _data; }

private:
    MmwaveData _data;
    uint8_t    _buf[64];
    uint8_t    _bufLen = 0;

    // Remove the first byte from the buffer (bad/unrecognised byte).
    void _dropByte();
    // Try to parse and consume a complete frame at the start of _buf.
    // Returns true if a frame was consumed (caller should loop).
    bool _tryParse();
    void _handleNormalFrame(const uint8_t *data, uint16_t len);
    void _handleReportFrame(const uint8_t *data, uint16_t len);
};

extern MmwaveSensor mmwaveSensor;
