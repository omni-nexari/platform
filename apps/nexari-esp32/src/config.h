#pragma once
#include <Arduino.h>

// ── Display ───────────────────────────────────────────────────────────────────
#define DISPLAY_WIDTH   240
#define DISPLAY_HEIGHT  536

// ── Buttons ───────────────────────────────────────────────────────────────────
#define BTN_BOOT_PIN   0    // BOOT button (IO0)
#define BTN_USER_PIN   21   // USER button (IO21)

// ── mmWave sensor (Waveshare HMMD) ───────────────────────────────────────────
// Sensor TX → ESP32 RX=44,  Sensor RX ← ESP32 TX=43
#define MMWAVE_TX_PIN  43
#define MMWAVE_RX_PIN  44

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
