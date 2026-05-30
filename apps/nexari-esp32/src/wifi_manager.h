#pragma once
#include <Arduino.h>
#include <WiFi.h>
#include <WebServer.h>
#include "config.h"
#include "logger.h"

enum class WifiState {
    IDLE,
    AP_MODE,       // captive portal active
    CONNECTING,
    CONNECTED,
    FAILED
};

/**
 * WifiManager — handles:
 *  - AP mode captive portal (scan + save WiFi credentials)
 *  - STA mode connection
 *
 * AP SSID: "NexariSetup-XXYY" (last 4 hex chars of MAC)
 * Portal URL: http://192.168.4.1
 */
class WifiManager {
public:
    WifiManager();

    /** Start AP mode captive portal */
    void startAP();

    /** Connect to stored credentials (non-blocking, call loop() each tick) */
    void connectSta(const String &ssid, const String &pass);

    /** Must be called in Arduino loop() */
    void loop();

    WifiState state() const { return _state; }
    bool isConnected() const { return _state == WifiState::CONNECTED; }

    /** Callback fired once when STA connects */
    void onConnected(std::function<void()> cb) { _onConnected = cb; }

    /** Callback fired once when new credentials saved via portal → ESP restarts */
    void onCredentialsSaved(std::function<void(String ssid, String pass)> cb) {
        _onCredentialsSaved = cb;
    }

    String apSSID() const { return _apSSID; }

private:
    void _setupPortalRoutes();
    String _buildScanJson();
    String _buildPortalPage();

    WebServer  _server;
    WifiState  _state      = WifiState::IDLE;
    String     _apSSID;
    uint32_t   _connectAt  = 0;
    uint8_t    _retries    = 0;

    std::function<void()>                          _onConnected;
    std::function<void(String ssid, String pass)>  _onCredentialsSaved;
};

extern WifiManager wifiManager;
