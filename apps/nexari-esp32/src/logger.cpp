#include "logger.h"
#include <ArduinoJson.h>
#include <stdarg.h>

// ── Static members ────────────────────────────────────────────────────────────
LogEntry Logger::_buf[LOG_BUFFER_MAX];
uint16_t Logger::_head  = 0;
uint16_t Logger::_count = 0;

Logger Log;

// ── Helpers ───────────────────────────────────────────────────────────────────

static const char *levelName(LogLevel l) {
    switch (l) {
        case LogLevel::DEBUG: return "debug";
        case LogLevel::INFO:  return "info";
        case LogLevel::WARN:  return "warn";
        case LogLevel::ERROR: return "error";
    }
    return "info";
}

void Logger::append(LogLevel level, const char *line) {
    // Mirror to Serial for physical debug
    Serial.printf("[%s] %s\n", levelName(level), line);

    uint16_t idx;
    if (_count < LOG_BUFFER_MAX) {
        idx = (_head + _count) % LOG_BUFFER_MAX;
        _count++;
    } else {
        // Overwrite oldest entry
        idx   = _head;
        _head = (_head + 1) % LOG_BUFFER_MAX;
    }
    _buf[idx].level = level;
    strncpy(_buf[idx].line, line, sizeof(_buf[idx].line) - 1);
    _buf[idx].line[sizeof(_buf[idx].line) - 1] = '\0';
}

static void doLog(LogLevel level, const char *fmt, va_list args) {
    char buf[192];
    vsnprintf(buf, sizeof(buf), fmt, args);
    Logger::append(level, buf);
}

// ── Public API ────────────────────────────────────────────────────────────────

void Logger::debug(const char *fmt, ...) {
    va_list a; va_start(a, fmt); doLog(LogLevel::DEBUG, fmt, a); va_end(a);
}
void Logger::info(const char *fmt, ...) {
    va_list a; va_start(a, fmt); doLog(LogLevel::INFO, fmt, a); va_end(a);
}
void Logger::warn(const char *fmt, ...) {
    va_list a; va_start(a, fmt); doLog(LogLevel::WARN, fmt, a); va_end(a);
}
void Logger::error(const char *fmt, ...) {
    va_list a; va_start(a, fmt); doLog(LogLevel::ERROR, fmt, a); va_end(a);
}

// ── Drain ─────────────────────────────────────────────────────────────────────

String Logger::drainBatch() {
    if (_count == 0) return "";

    uint16_t take = (_count < LOG_BATCH_MAX) ? _count : LOG_BATCH_MAX;

    // Use the level of the first entry as the batch level
    LogLevel batchLevel = _buf[_head].level;

    JsonDocument doc;
    doc["type"] = "device_log";
    JsonObject payload = doc["payload"].to<JsonObject>();
    payload["level"]   = levelName(batchLevel);
    JsonArray lines    = payload["lines"].to<JsonArray>();

    for (uint16_t i = 0; i < take; i++) {
        uint16_t idx = (_head + i) % LOG_BUFFER_MAX;
        lines.add(_buf[idx].line);
    }

    // Advance ring buffer
    _head  = (_head + take) % LOG_BUFFER_MAX;
    _count = (_count > take) ? (_count - take) : 0;

    String out;
    serializeJson(doc, out);
    return out;
}
