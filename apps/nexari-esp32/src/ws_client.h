#pragma once
#include <Arduino.h>
#include <WebSocketsClient.h>
#include <functional>
#include <vector>
#include "config.h"
#include "logger.h"
#include "ble_scanner.h"

enum class WsState { DISCONNECTED, CONNECTING, CONNECTED };

using WsMessageCb = std::function<void(const String &type, const String &raw)>;

/**
 * WsClient — wraps WebSocketsClient with:
 *  - auto SSL/plain selection
 *  - device WS path + token
 *  - periodic heartbeat
 *  - log drain (device_log messages)
 *  - incoming command dispatch (content-update, dump_logs, command …)
 */
class WsClient {
public:
    void begin(const String &host, uint16_t port, bool ssl, const String &token);
    void loop();
    void stop();
    bool send(const String &json);

    WsState state()       const { return _state; }
    bool    isConnected() const { return _state == WsState::CONNECTED; }

    void setOnMessage(WsMessageCb cb) { _onMessage = cb; }

    /** Drain Logger ring buffer → send device_log messages */
    void flushLogs();

    /**
     * Send a heartbeat message:
     *   {"type":"heartbeat","payload":{playerVersion,firmwareVersion,
     *    powerState,temperatureCelsius,deviceUptimeSec,resolution}}
     */
    void sendHeartbeat(float tempC, uint32_t uptimeSec);

    /**
     * Send a network_info message so the server stores MAC, IP, SSID
     * and connection type — populates the Info tab in the dashboard.
     */
    void sendNetworkInfo();

    /**
     * Send a ble_scan_result message containing the beacons discovered
     * during the most recent BLE scan.
     */
    void sendBleScanResult(const std::vector<BleBeacon> &beacons);

private:
    void _onEvent(WStype_t type, uint8_t *payload, size_t length);

    WebSocketsClient _ws;
    WsState          _state = WsState::DISCONNECTED;
    WsMessageCb      _onMessage;
};

extern WsClient wsClient;
