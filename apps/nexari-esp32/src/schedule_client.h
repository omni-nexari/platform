#pragma once
#include <Arduino.h>

struct ScheduleInfo {
    String scheduleName;
    String nowPlaying;
    String nextUp;
    bool   valid = false;
};

/**
 * ScheduleClient — fetches GET /api/v1/devices/device/schedule
 * with Authorization: Bearer {token} and parses the legacy schedule shape.
 */
class ScheduleClient {
public:
    /**
     * Performs a blocking HTTP(S) GET.
     * Returns true on success; info() has the result.
     */
    bool fetch(const String &host, uint16_t port, bool ssl,
               const String &token);

    const ScheduleInfo &info() const { return _info; }

private:
    ScheduleInfo _parse(const String &json) const;
    ScheduleInfo _info;
};

extern ScheduleClient scheduleClient;
