#pragma once
#include <Arduino.h>
#include "config.h"

/**
 * Logger — ring-buffer log system with WebSocket drain support.
 *
 * - Stores up to LOG_BUFFER_MAX entries in SRAM (heap) ring buffer.
 * - Mirrors every entry to Serial immediately.
 * - drainBatch() produces a "device_log" JSON payload (up to LOG_BATCH_MAX
 *   lines) ready to send over the device WebSocket.
 * - Called periodically from ws_client.flushLogs() every LOG_FLUSH_INTERVAL_MS.
 */

enum class LogLevel : uint8_t { DEBUG = 0, INFO, WARN, ERROR };

struct LogEntry {
    LogLevel level;
    char     line[192];
};

class Logger {
public:
    static void debug(const char *fmt, ...);
    static void info (const char *fmt, ...);
    static void warn (const char *fmt, ...);
    static void error(const char *fmt, ...);

    /**
     * Drain up to LOG_BATCH_MAX entries and return a JSON string:
     *   {"type":"device_log","payload":{"level":"info","lines":[...]}}
     * Returns "" if the buffer is empty.
     */
    static String drainBatch();

    static bool hasEntries() { return _count > 0; }

    // Internal — exposed so logf() helper in .cpp can call it
    static void append(LogLevel level, const char *line);

private:
    static LogEntry  _buf[LOG_BUFFER_MAX];
    static uint16_t  _head;
    static uint16_t  _count;
};

extern Logger Log;
