#include "ws_client.h"
#include "logger.h"
#include <ArduinoJson.h>
#include <WiFi.h>

WsClient wsClient;

// ── begin ─────────────────────────────────────────────────────────────────────

void WsClient::begin(const String &host, uint16_t port, bool ssl,
                     const String &token) {
    String path = "/api/v1/devices/ws/device?token=" + token;
    _state = WsState::CONNECTING;

    if (ssl) {
        _ws.beginSSL(host.c_str(), port, path.c_str());
    } else {
        _ws.begin(host.c_str(), port, path.c_str());
    }

    _ws.setReconnectInterval(WS_RECONNECT_MS);
    _ws.enableHeartbeat(25000, 5000, 3);  // ping 25s, timeout 5s, 3 missed → disconnect

    _ws.onEvent([this](WStype_t t, uint8_t *p, size_t l) {
        _onEvent(t, p, l);
    });

    Logger::info("[WS] Connecting to %s:%u%s  ssl=%d",
                 host.c_str(), port, path.c_str(), ssl ? 1 : 0);
}

// ── loop ──────────────────────────────────────────────────────────────────────

void WsClient::loop() {
    _ws.loop();
}

void WsClient::stop() {
    _ws.disconnect();
    _state = WsState::DISCONNECTED;
}

// ── send ──────────────────────────────────────────────────────────────────────

bool WsClient::send(const String &json) {
    if (!isConnected()) return false;
    return _ws.sendTXT(json.c_str(), json.length());
}

// ── flushLogs ─────────────────────────────────────────────────────────────────

void WsClient::flushLogs() {
    if (!isConnected()) return;
    while (Logger::hasEntries()) {
        String batch = Logger::drainBatch();
        if (batch.length() == 0) break;
        _ws.sendTXT(batch.c_str(), batch.length());
        yield();
    }
}

// ── sendHeartbeat ─────────────────────────────────────────────────────────────

void WsClient::sendHeartbeat(float tempC, uint32_t uptimeSec) {
    if (!isConnected()) return;

    JsonDocument doc;
    doc["type"] = "heartbeat";
    JsonObject p = doc["payload"].to<JsonObject>();
    p["playerVersion"]     = FIRMWARE_VERSION;
    p["firmwareVersion"]   = FIRMWARE_VERSION;
    p["powerState"]        = "on";
    p["temperatureCelsius"] = tempC;
    p["deviceUptimeSec"]   = uptimeSec;
    p["resolution"]        = "240x536";

    String msg;
    serializeJson(doc, msg);
    _ws.sendTXT(msg.c_str(), msg.length());
}

// ── sendNetworkInfo ──────────────────────────────────────────────────────────

void WsClient::sendNetworkInfo() {
    if (!isConnected()) return;

    JsonDocument doc;
    doc["type"] = "network_info";
    JsonObject p = doc["payload"].to<JsonObject>();
    p["ip"]             = WiFi.localIP().toString();
    p["mac"]            = WiFi.macAddress();         // "AA:BB:CC:DD:EE:FF"
    p["connectionType"] = "wifi";
    p["wifiSsid"]       = WiFi.SSID();
    p["wifiStrength"]   = WiFi.RSSI();               // dBm
    // ESP32 serial = 64-bit eFuse MAC as hex string
    char serial[17];
    snprintf(serial, sizeof(serial), "%016llx", (unsigned long long)ESP.getEfuseMac());
    p["serialNumber"]   = serial;

    String msg;
    serializeJson(doc, msg);
    _ws.sendTXT(msg.c_str(), msg.length());
    Logger::info("[WS] network_info sent: ip=%s mac=%s ssid=%s rssi=%d",
                 WiFi.localIP().toString().c_str(),
                 WiFi.macAddress().c_str(),
                 WiFi.SSID().c_str(),
                 (int)WiFi.RSSI());
}

// ── event handler ─────────────────────────────────────────────────────────────

void WsClient::_onEvent(WStype_t type, uint8_t *payload, size_t length) {
    switch (type) {
        case WStype_CONNECTED:
            _state = WsState::CONNECTED;
            Logger::info("[WS] Connected");
            sendNetworkInfo();
            break;

        case WStype_DISCONNECTED:
            _state = WsState::DISCONNECTED;
            Logger::warn("[WS] Disconnected");
            break;

        case WStype_ERROR:
            Logger::error("[WS] Error");
            break;

        case WStype_TEXT: {
            String raw = String((char *)payload, length);

            // Parse type field
            JsonDocument doc;
            if (deserializeJson(doc, raw) != DeserializationError::Ok) break;
            String msgType = doc["type"] | "";

            // Handle dump_logs inline
            if (msgType == "dump_logs") {
                Logger::info("[WS] dump_logs received — flushing");
                flushLogs();
                break;
            }

            // Dispatch to application handler
            if (_onMessage && msgType.length() > 0) {
                _onMessage(msgType, raw);
            }
            break;
        }

        default:
            break;
    }
}
