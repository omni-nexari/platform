#include "pairing.h"
#include "storage.h"
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

PairingClient pairingClient;

// ── Helpers ───────────────────────────────────────────────────────────────────

String PairingClient::_buildBaseUrl() const {
    String scheme = _https ? "https" : "http";
    return scheme + "://" + _host + ":" + String(_port) + "/api/v1/devices";
}

// ── Public ────────────────────────────────────────────────────────────────────

void PairingClient::begin(const String &host, uint16_t port, bool useHttps,
                           const String &duid) {
    _host   = host;
    _port   = port;
    _https  = useHttps;
    _duid   = duid;
    _state  = PairingState::REQUESTING;
    _lastAt = 0;   // trigger immediate request on first loop()
}

void PairingClient::reset() {
    _state = PairingState::IDLE;
    _code  = "";
}

void PairingClient::loop() {
    switch (_state) {
        case PairingState::REQUESTING:
            if (millis() - _lastAt >= 500) {   // small debounce before first request
                _doRequest();
            }
            break;
        case PairingState::WAITING:
            if (millis() - _lastAt >= PAIR_POLL_MS) {
                _doPoll();
            }
            break;
        default:
            break;
    }
}

// ── POST /pair/request ────────────────────────────────────────────────────────

void PairingClient::_doRequest() {
    _lastAt = millis();
    Logger::info("[Pair] POST /pair/request  duid=%s", _duid.c_str());

    HTTPClient http;
    if (_https) {
        WiFiClientSecure *cli = new WiFiClientSecure();
        cli->setInsecure();  // no cert pinning for IoT device
        http.begin(*cli, _buildBaseUrl() + "/pair/request");
    } else {
        http.begin(_buildBaseUrl() + "/pair/request");
    }
    http.addHeader("Content-Type", "application/json");

    // Build body: { duid, modelName, platform, firmwareVersion, serialNumber }
    JsonDocument body;
    body["duid"]            = _duid;
    body["modelName"]       = MODEL_NAME;
    body["platform"]        = PLATFORM_NAME;
    body["firmwareVersion"] = FIRMWARE_VERSION;
    // ESP32 serial number = chip eFuse MAC (64-bit, hex, no colons)
    uint64_t chipId = ESP.getEfuseMac();
    char serial[17];
    snprintf(serial, sizeof(serial), "%016llx", chipId);
    body["serialNumber"] = serial;
    String bodyStr;
    serializeJson(body, bodyStr);

    int code = http.POST(bodyStr);
    String resp = http.getString();
    http.end();

    Logger::info("[Pair] Response %d: %s", code, resp.c_str());

    if (code == 200) {
        // Already claimed (device token still valid)
        JsonDocument doc;
        if (deserializeJson(doc, resp) == DeserializationError::Ok) {
            String token    = doc["deviceToken"] | "";
            String deviceId = doc["deviceId"]    | "";
            if (token.length() > 0 && deviceId.length() > 0) {
                _state = PairingState::CLAIMED;
                if (_onClaimed) _onClaimed(token, deviceId);
                return;
            }
        }
    }

    if (code == 201) {
        JsonDocument doc;
        if (deserializeJson(doc, resp) == DeserializationError::Ok) {
            _code  = doc["code"]     | "";
            _state = PairingState::WAITING;
            Logger::info("[Pair] Code=%s  Waiting for claim...", _code.c_str());
            return;
        }
    }

    // Error
    _state = PairingState::ERROR;
    String msg = "pair/request failed (" + String(code) + ")";
    Logger::error("[Pair] %s", msg.c_str());
    if (_onError) _onError(msg);
}

// ── GET /pair/status ──────────────────────────────────────────────────────────

void PairingClient::_doPoll() {
    _lastAt = millis();

    String url = _buildBaseUrl() + "/pair/status?code=" + _code;
    Logger::debug("[Pair] GET %s", url.c_str());

    HTTPClient http;
    if (_https) {
        WiFiClientSecure *cli = new WiFiClientSecure();
        cli->setInsecure();
        http.begin(*cli, url);
    } else {
        http.begin(url);
    }

    int code = http.GET();
    String resp = http.getString();
    http.end();

    if (code != 200) {
        Logger::warn("[Pair] poll HTTP %d", code);
        return;
    }

    JsonDocument doc;
    if (deserializeJson(doc, resp) != DeserializationError::Ok) return;

    String status = doc["status"] | "pending";
    if (status == "claimed") {
        String token    = doc["deviceToken"] | "";
        String deviceId = doc["deviceId"]    | "";
        _state = PairingState::CLAIMED;
        Logger::info("[Pair] Claimed! deviceId=%s", deviceId.c_str());
        if (_onClaimed) _onClaimed(token, deviceId);
    }
}
