#pragma once
#include <Arduino.h>
#include "config.h"
#include "logger.h"

enum class PairingState {
    IDLE,
    REQUESTING,   // POST /pair/request in flight
    WAITING,      // polling GET /pair/status
    CLAIMED,      // token received
    ERROR
};

/**
 * PairingClient — handles the pair/request + pair/status polling flow
 * identical to Tizen, Android, Windows players.
 *
 * Flow:
 *   1. begin(host, port, https, duid) → POST /api/v1/devices/pair/request
 *   2. On 201: store code, display on screen
 *   3. Poll GET /api/v1/devices/pair/status?code=XXXXXX every PAIR_POLL_MS
 *   4. On claimed: fires onClaimed(token, deviceId) callback
 */
class PairingClient {
public:
    void begin(const String &host, uint16_t port, bool useHttps,
               const String &duid);
    void loop();
    void reset();

    PairingState state()        const { return _state; }
    String       pairingCode()  const { return _code; }

    void onClaimed(std::function<void(String token, String deviceId)> cb) {
        _onClaimed = cb;
    }
    void onError(std::function<void(String msg)> cb) {
        _onError = cb;
    }

private:
    void _doRequest();
    void _doPoll();
    String _buildBaseUrl() const;

    String  _host;
    uint16_t _port  = 80;
    bool    _https  = false;
    String  _duid;
    String  _code;

    PairingState _state   = PairingState::IDLE;
    uint32_t     _lastAt  = 0;

    std::function<void(String token, String deviceId)> _onClaimed;
    std::function<void(String msg)>                    _onError;
};

extern PairingClient pairingClient;
