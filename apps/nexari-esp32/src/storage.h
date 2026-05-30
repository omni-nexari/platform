#pragma once
#include <Arduino.h>
#include <Preferences.h>
#include "config.h"

/**
 * Storage — thin NVS Preferences wrapper.
 * Namespace: "nexari"
 * Keys: wifi_ssid, wifi_pass, api_host, api_port, api_https,
 *       dev_token, dev_id
 */
class Storage {
public:
    void begin();

    // WiFi
    String getWifiSsid() const;
    String getWifiPass() const;
    void   setWifi(const String &ssid, const String &pass);

    // API target (stored so user can override from portal)
    String getApiHost() const;
    uint16_t getApiPort() const;
    bool   getApiHttps() const;
    void   setApiTarget(const String &host, uint16_t port, bool https);

    // Device auth
    String getDeviceToken() const;
    String getDeviceId() const;
    void   setDeviceAuth(const String &token, const String &id);
    void   clearDeviceAuth();

    bool hasWifi() const;
    bool isPaired() const;

    /** Factory reset — wipe all keys in "nexari" namespace */
    void clear();

private:
    Preferences _prefs;
};

extern Storage storage;
