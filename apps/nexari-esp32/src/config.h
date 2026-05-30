#pragma once
#include <Arduino.h>

// ── Display ───────────────────────────────────────────────────────────────────
#define DISPLAY_WIDTH   240
#define DISPLAY_HEIGHT  536

// ── Buttons ───────────────────────────────────────────────────────────────────
#define BTN_BOOT_PIN   0    // BOOT button (IO0)
#define BTN_USER_PIN   21   // USER button (IO21)

// ── mmWave sensor (Waveshare HMMD) ───────────────────────────────────────────
// Physical wiring: Sensor TX → ESP32 IO43,  Sensor RX ← ESP32 IO44
// So ESP32 RX=43 receives sensor TX, ESP32 TX=44 drives sensor RX
#define MMWAVE_RX_PIN  43
#define MMWAVE_TX_PIN  44

// ── mmWave calibration ────────────────────────────────────────────────────────
// MMWAVE_DIST_OFFSET_CM: signed offset added to every reading (cm).
//   Positive = sensor reads too low (add cm).  Negative = reads too high.
//   Example: if standing 100 cm away and display shows 120, set to -20.
#define MMWAVE_DIST_OFFSET_CM   0
// MMWAVE_EMA_ALPHA: smoothing factor for exponential moving average (0..1).
//   Lower = smoother but more lag.  1.0 = no smoothing (raw values).
#define MMWAVE_EMA_ALPHA        0.25f

// ── Identity ──────────────────────────────────────────────────────────────────
#define FIRMWARE_VERSION   "1.0.0"
#define PLATFORM_NAME      "esp32-amoled"
#define MODEL_NAME         "T-Display-S3-AMOLED"

// ── API defaults (overridden by build flags from platformio.ini) ──────────────
#ifndef DEFAULT_API_HOST
  #define DEFAULT_API_HOST  "192.168.1.17"
#endif
#ifndef DEFAULT_API_PORT
  #define DEFAULT_API_PORT  80
#endif
#ifndef DEFAULT_API_HTTPS
  #define DEFAULT_API_HTTPS 0
#endif
#ifndef BUILD_ENV
  #define BUILD_ENV "dev"
#endif

// ── Timing ───────────────────────────────────────────────────────────────────
#define HEARTBEAT_INTERVAL_MS   30000UL   // 30 s
#define LOG_FLUSH_INTERVAL_MS   15000UL   // 15 s — flush log buffer via WS
#define SCHEDULE_POLL_MS        60000UL   // 60 s
#define HEALTH_CHECK_MS        120000UL   // 2 min
#define PAIR_POLL_MS             5000UL   // 5 s
#define WS_RECONNECT_MS         10000UL   // 10 s

// ── AP / captive portal ───────────────────────────────────────────────────────
#define AP_SSID_PREFIX  "NexariSetup-"
#define AP_PORTAL_HOST  "192.168.4.1"

// ── Logger ────────────────────────────────────────────────────────────────────
#define LOG_BUFFER_MAX  200   // ring buffer capacity (entries)
#define LOG_BATCH_MAX    50   // max lines per device_log WS send
