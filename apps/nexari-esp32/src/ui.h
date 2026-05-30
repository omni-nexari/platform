#pragma once
#include <lvgl.h>
#include "config.h"

// ── Color palette (LVGL lv_color_hex) ────────────────────────────────────────
#define C_BG     lv_color_hex(0x0F172A)   // Slate-950 background
#define C_CARD   lv_color_hex(0x1E293B)   // Slate-800  card surface
#define C_ACCENT lv_color_hex(0x38BDF8)   // Sky-400    accent / links
#define C_GREEN  lv_color_hex(0x4ADE80)   // Green-400  success / online
#define C_AMBER  lv_color_hex(0xFBBF24)   // Amber-400  warning
#define C_RED    lv_color_hex(0xF87171)   // Red-400    error / offline
#define C_TEXT   lv_color_hex(0xE2E8F0)   // Slate-200  primary text
#define C_MUTED  lv_color_hex(0x64748B)   // Slate-500  secondary text

enum class Screen {
    AP_PORTAL,
    PAIRING,
    DASHBOARD,
    SIGNAGE
};

/**
 * uiInit() — must be called once after lv_init() and the display driver
 *             is registered.  Sets theme, allocates screen objects.
 */
void uiInit();

/** Show captive-portal screen */
void showAPPortal(const char *apSSID);

/** Show pairing code screen */
void showPairing(const char *code);

/**
 * Show dashboard: device counts + up to 3 "now playing" device names
 * wsConnected — controls status indicator
 */
void showDashboard(uint16_t online, uint16_t total,
                   const char *np1, const char *np2, const char *np3,
                   bool wsConnected);

/** Show signage info (schedule + now/next + WS status) */
void showSignage(const char *scheduleName,
                 const char *nowPlaying,
                 const char *nextUp,
                 bool wsConnected);

/** Refresh WS status dot on whichever screen is active */
void uiSetWsStatus(bool connected);

Screen uiCurrentScreen();
