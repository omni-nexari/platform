#include "schedule_client.h"
#include "logger.h"
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

ScheduleClient scheduleClient;

// ── fetch ─────────────────────────────────────────────────────────────────────

bool ScheduleClient::fetch(const String &host, uint16_t port, bool ssl,
                            const String &token) {
    String scheme = ssl ? "https" : "http";
    String url = scheme + "://" + host + ":" + String(port)
                 + "/api/v1/devices/device/schedule";

    Logger::debug("[Sched] GET %s", url.c_str());

    HTTPClient http;
    if (ssl) {
        WiFiClientSecure *cli = new WiFiClientSecure();
        cli->setInsecure();
        http.begin(*cli, url);
    } else {
        http.begin(url);
    }
    http.addHeader("Authorization", "Bearer " + token);

    int code = http.GET();
    if (code != 200) {
        Logger::warn("[Sched] HTTP %d", code);
        http.end();
        _info.valid = false;
        return false;
    }

    String body = http.getString();
    http.end();

    _info = _parse(body);
    Logger::info("[Sched] schedule='%s' now='%s' next='%s'",
                 _info.scheduleName.c_str(),
                 _info.nowPlaying.c_str(),
                 _info.nextUp.c_str());
    return _info.valid;
}

// ── _parse ────────────────────────────────────────────────────────────────────
/**
 * Legacy schedule shape:
 * {
 *   schedule: {
 *     name: "...",
 *     slots: [
 *       { playlist: { name: "..." }, content: { name: "..." } },
 *       ...
 *     ]
 *   }
 * }
 */
ScheduleInfo ScheduleClient::_parse(const String &json) const {
    ScheduleInfo info;

    JsonDocument doc;
    if (deserializeJson(doc, json) != DeserializationError::Ok) return info;

    JsonObjectConst schedule = doc["schedule"].as<JsonObjectConst>();
    if (schedule.isNull()) {
        // Try top-level (some API versions omit wrapper)
        schedule = doc.as<JsonObjectConst>();
    }

    info.scheduleName = schedule["name"] | "";

    JsonArrayConst slots = schedule["slots"].as<JsonArrayConst>();
    if (!slots.isNull()) {
        if (slots.size() > 0) {
            JsonObjectConst s0 = slots[0];
            // Prefer playlist name, fall back to content name
            String pName = s0["playlist"]["name"] | "";
            String cName = s0["content"]["name"]  | "";
            info.nowPlaying = pName.length() > 0 ? pName : cName;
        }
        if (slots.size() > 1) {
            JsonObjectConst s1 = slots[1];
            String pName = s1["playlist"]["name"] | "";
            String cName = s1["content"]["name"]  | "";
            info.nextUp = pName.length() > 0 ? pName : cName;
        }
    }

    info.valid = true;
    return info;
}
