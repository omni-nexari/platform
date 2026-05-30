#include "storage.h"

Storage storage;

void Storage::begin() {
    _prefs.begin("nexari", false);
}

// ── WiFi ─────────────────────────────────────────────────────────────────────

String Storage::getWifiSsid() const {
    Preferences p;
    p.begin("nexari", true);
    String v = p.isKey("wifi_ssid") ? p.getString("wifi_ssid", "") : "";
    p.end();
    return v;
}

String Storage::getWifiPass() const {
    Preferences p;
    p.begin("nexari", true);
    String v = p.isKey("wifi_pass") ? p.getString("wifi_pass", "") : "";
    p.end();
    return v;
}

void Storage::setWifi(const String &ssid, const String &pass) {
    Preferences p;
    p.begin("nexari", false);
    p.putString("wifi_ssid", ssid);
    p.putString("wifi_pass", pass);
    p.end();
}

// ── API target ────────────────────────────────────────────────────────────────

String Storage::getApiHost() const {
    Preferences p;
    p.begin("nexari", true);
    String v = p.getString("api_host", DEFAULT_API_HOST);
    p.end();
    return v;
}

uint16_t Storage::getApiPort() const {
    Preferences p;
    p.begin("nexari", true);
    uint16_t v = (uint16_t)p.getUShort("api_port", DEFAULT_API_PORT);
    p.end();
    return v;
}

bool Storage::getApiHttps() const {
    Preferences p;
    p.begin("nexari", true);
    bool v = p.getBool("api_https", DEFAULT_API_HTTPS != 0);
    p.end();
    return v;
}

void Storage::setApiTarget(const String &host, uint16_t port, bool https) {
    Preferences p;
    p.begin("nexari", false);
    p.putString("api_host", host);
    p.putUShort("api_port", port);
    p.putBool("api_https", https);
    p.end();
}

// ── Device auth ───────────────────────────────────────────────────────────────

String Storage::getDeviceToken() const {
    Preferences p;
    p.begin("nexari", true);
    String v = p.isKey("dev_token") ? p.getString("dev_token", "") : "";
    p.end();
    return v;
}

String Storage::getDeviceId() const {
    Preferences p;
    p.begin("nexari", true);
    String v = p.isKey("dev_id") ? p.getString("dev_id", "") : "";
    p.end();
    return v;
}

void Storage::setDeviceAuth(const String &token, const String &id) {
    Preferences p;
    p.begin("nexari", false);
    p.putString("dev_token", token);
    p.putString("dev_id", id);
    p.end();
}

void Storage::clearDeviceAuth() {
    Preferences p;
    p.begin("nexari", false);
    p.remove("dev_token");
    p.remove("dev_id");
    p.end();
}

// ── Helpers ───────────────────────────────────────────────────────────────────

bool Storage::hasWifi() const {
    return getWifiSsid().length() > 0;
}

bool Storage::isPaired() const {
    Preferences p;
    p.begin("nexari", true);
    bool paired = p.isKey("dev_token");
    p.end();
    return paired;
}

void Storage::clear() {
    Preferences p;
    p.begin("nexari", false);
    p.clear();
    p.end();
}
