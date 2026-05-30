#include "ui.h"
#include <Arduino.h>

// ── Internals ─────────────────────────────────────────────────────────────────

static Screen    g_screen      = Screen::AP_PORTAL;
static lv_obj_t *g_scrAP       = nullptr;
static lv_obj_t *g_scrPairing  = nullptr;
static lv_obj_t *g_scrDash     = nullptr;
static lv_obj_t *g_scrSignage  = nullptr;

// Live label handles so update functions can reuse screens
static lv_obj_t *g_pairingCodeLbl  = nullptr;
static lv_obj_t *g_dashIpLbl       = nullptr;
static lv_obj_t *g_dashWsLbl       = nullptr;
static lv_obj_t *g_dashNowLbl      = nullptr;
static lv_obj_t *g_dashStatusDot   = nullptr;
static lv_obj_t *g_dashBattLbl     = nullptr;
static lv_obj_t *g_sigScheduleLbl  = nullptr;
static lv_obj_t *g_sigNowLbl       = nullptr;
static lv_obj_t *g_sigNextLbl      = nullptr;
static lv_obj_t *g_sigStatusDot    = nullptr;
static lv_obj_t *g_sigBattLbl      = nullptr;

// ── Helpers ───────────────────────────────────────────────────────────────────

static lv_obj_t *makeScreen() {
    lv_obj_t *s = lv_obj_create(nullptr);
    lv_obj_set_style_bg_color(s, C_BG, 0);
    lv_obj_set_style_bg_opa(s, LV_OPA_COVER, 0);
    lv_obj_set_style_pad_all(s, 0, 0);          // remove default padding
    lv_obj_set_style_border_width(s, 0, 0);
    lv_obj_clear_flag(s, LV_OBJ_FLAG_SCROLLABLE); // no scroll → pos works correctly
    return s;
}

static lv_obj_t *makeCard(lv_obj_t *parent, int y, int h) {
    lv_obj_t *c = lv_obj_create(parent);
    lv_obj_set_size(c, DISPLAY_WIDTH - 16, h);
    lv_obj_set_pos(c, 8, y);
    lv_obj_set_style_bg_color(c, C_CARD, 0);
    lv_obj_set_style_bg_opa(c, LV_OPA_COVER, 0);
    lv_obj_set_style_border_width(c, 0, 0);
    lv_obj_set_style_radius(c, 10, 0);
    lv_obj_set_style_pad_all(c, 10, 0);
    lv_obj_clear_flag(c, LV_OBJ_FLAG_SCROLLABLE);
    return c;
}

static lv_obj_t *makeLabel(lv_obj_t *parent, const char *text,
                            lv_color_t col, const lv_font_t *font,
                            int x, int y) {
    lv_obj_t *l = lv_label_create(parent);
    lv_obj_set_style_text_color(l, col, 0);
    lv_obj_set_style_text_font(l, font, 0);
    lv_label_set_text(l, text);
    lv_obj_set_pos(l, x, y);
    return l;
}

static lv_obj_t *makeStatusDot(lv_obj_t *parent, int x, int y, bool connected) {
    lv_obj_t *dot = lv_obj_create(parent);
    lv_obj_set_size(dot, 10, 10);
    lv_obj_set_pos(dot, x, y);
    lv_obj_set_style_radius(dot, LV_RADIUS_CIRCLE, 0);
    lv_obj_set_style_border_width(dot, 0, 0);
    lv_obj_set_style_bg_opa(dot, LV_OPA_COVER, 0);
    lv_obj_set_style_bg_color(dot, connected ? C_GREEN : C_RED, 0);
    lv_obj_clear_flag(dot, LV_OBJ_FLAG_SCROLLABLE);
    return dot;
}

static void updateDot(lv_obj_t *dot, bool connected) {
    if (!dot) return;
    lv_obj_set_style_bg_color(dot, connected ? C_GREEN : C_RED, 0);
}

// Key/value row: key in C_MUTED montserrat_12; value truncated to 144px.
static lv_obj_t *makeRow(lv_obj_t *parent, const char *key, const char *val,
                          lv_color_t valColor, const lv_font_t *valFont, int y) {
    makeLabel(parent, key, C_MUTED, &lv_font_montserrat_12, 0, y + 2);
    lv_obj_t *v = makeLabel(parent, val, valColor, valFont, 60, y);
    lv_obj_set_width(v, DISPLAY_WIDTH - 16 - 20 - 60);  // 144px
    lv_label_set_long_mode(v, LV_LABEL_LONG_DOT);
    return v;
}

// ── uiInit ────────────────────────────────────────────────────────────────────

void uiInit() {
    // Static style — heap alloc is unnecessary and risks null-ptr crash
    static lv_style_t s_defaultStyle;
    lv_style_init(&s_defaultStyle);
    lv_style_set_text_color(&s_defaultStyle, C_TEXT);
    lv_obj_add_style(lv_scr_act(), &s_defaultStyle, 0);
}

// ── showAPPortal ──────────────────────────────────────────────────────────────

void showAPPortal(const char *apSSID) {
    if (!g_scrAP) {
        g_scrAP = makeScreen();

        // ── Nexari logo bar ───────────────────────────────────────────────
        lv_obj_t *logoBg = lv_obj_create(g_scrAP);
        lv_obj_set_size(logoBg, DISPLAY_WIDTH, 90);
        lv_obj_set_pos(logoBg, 0, 0);
        lv_obj_set_style_bg_color(logoBg, C_CARD, 0);
        lv_obj_set_style_bg_opa(logoBg, LV_OPA_COVER, 0);
        lv_obj_set_style_border_width(logoBg, 0, 0);
        lv_obj_set_style_radius(logoBg, 0, 0);
        lv_obj_set_style_pad_all(logoBg, 0, 0);
        lv_obj_clear_flag(logoBg, LV_OBJ_FLAG_SCROLLABLE);

        // Accent bar on left edge
        lv_obj_t *accentBar = lv_obj_create(g_scrAP);
        lv_obj_set_size(accentBar, 4, 90);
        lv_obj_set_pos(accentBar, 0, 0);
        lv_obj_set_style_bg_color(accentBar, C_ACCENT, 0);
        lv_obj_set_style_bg_opa(accentBar, LV_OPA_COVER, 0);
        lv_obj_set_style_border_width(accentBar, 0, 0);
        lv_obj_set_style_radius(accentBar, 0, 0);
        lv_obj_clear_flag(accentBar, LV_OBJ_FLAG_SCROLLABLE);

        // "NEXARI" wordmark
        lv_obj_t *wordmark = lv_label_create(g_scrAP);
        lv_label_set_text(wordmark, "NEXARI");
        lv_obj_set_style_text_font(wordmark, &lv_font_montserrat_48, 0);
        lv_obj_set_style_text_color(wordmark, C_ACCENT, 0);
        lv_obj_set_pos(wordmark, 14, 8);

        // Sub-tagline
        lv_obj_t *tag = lv_label_create(g_scrAP);
        lv_label_set_text(tag, "Digital Signage Player");
        lv_obj_set_style_text_font(tag, &lv_font_montserrat_12, 0);
        lv_obj_set_style_text_color(tag, C_MUTED, 0);
        lv_obj_set_pos(tag, 14, 62);

        // ── WiFi setup section ────────────────────────────────────────────
        int y = 106;
        makeLabel(g_scrAP, "WiFi Setup Required", C_TEXT, &lv_font_montserrat_16, 8, y);
        y += 28;
        makeLabel(g_scrAP, "Connect to this network:", C_MUTED, &lv_font_montserrat_12, 8, y);
        y += 20;
        makeLabel(g_scrAP, apSSID, C_ACCENT, &lv_font_montserrat_18, 8, y);
        y += 34;

        lv_obj_t *divider = lv_obj_create(g_scrAP);
        lv_obj_set_size(divider, DISPLAY_WIDTH - 16, 1);
        lv_obj_set_pos(divider, 8, y);
        lv_obj_set_style_bg_color(divider, C_MUTED, 0);
        lv_obj_set_style_bg_opa(divider, LV_OPA_30, 0);
        lv_obj_set_style_border_width(divider, 0, 0);
        lv_obj_set_style_radius(divider, 0, 0);
        lv_obj_clear_flag(divider, LV_OBJ_FLAG_SCROLLABLE);
        y += 14;

        makeLabel(g_scrAP, "Then open in browser:", C_MUTED, &lv_font_montserrat_12, 8, y);
        y += 20;
        makeLabel(g_scrAP, "http://192.168.4.1", C_ACCENT, &lv_font_montserrat_16, 8, y);
        y += 28;
        makeLabel(g_scrAP, "to configure WiFi & connect", C_MUTED, &lv_font_montserrat_12, 8, y);
    }

    g_screen = Screen::AP_PORTAL;
    lv_scr_load(g_scrAP);
}

// ── showPairing ───────────────────────────────────────────────────────────────

void showPairing(const char *code) {
    if (!g_scrPairing) {
        g_scrPairing = makeScreen();

        makeLabel(g_scrPairing, "Pair Device", C_ACCENT, &lv_font_montserrat_20, 8, 40);
        makeLabel(g_scrPairing, "Your pairing code:", C_MUTED, &lv_font_montserrat_14, 8, 76);

        // Big code label
        g_pairingCodeLbl = lv_label_create(g_scrPairing);
        lv_obj_set_style_text_color(g_pairingCodeLbl, C_TEXT, 0);
        lv_obj_set_style_text_font(g_pairingCodeLbl, &lv_font_montserrat_48, 0);
        lv_label_set_text(g_pairingCodeLbl, code);
        lv_obj_align(g_pairingCodeLbl, LV_ALIGN_TOP_MID, 0, 110);

        makeLabel(g_scrPairing, "Visit:", C_MUTED, &lv_font_montserrat_14, 8, 200);
        makeLabel(g_scrPairing, "portal.chiho.app", C_ACCENT, &lv_font_montserrat_16, 8, 220);
        makeLabel(g_scrPairing, "→ Devices → Add Device", C_MUTED, &lv_font_montserrat_14, 8, 248);
        makeLabel(g_scrPairing, "and enter the code above", C_MUTED, &lv_font_montserrat_14, 8, 268);
    } else if (g_pairingCodeLbl) {
        lv_label_set_text(g_pairingCodeLbl, code);
    }

    g_screen = Screen::PAIRING;
    lv_scr_load(g_scrPairing);
}

// ── showDashboard ─────────────────────────────────────────────────────────────

void showDashboard(const char *duid, const char *mac,
                   const char *ip,   const char *ssid,
                   const char *nowPlaying, bool wsConnected) {
    if (!g_scrDash) {
        g_scrDash = makeScreen();

        // ── Header bar ───────────────────────────────────────────────────
        lv_obj_t *hdr = lv_obj_create(g_scrDash);
        lv_obj_set_size(hdr, DISPLAY_WIDTH, 76);
        lv_obj_set_pos(hdr, 0, 0);
        lv_obj_set_style_bg_color(hdr, C_CARD, 0);
        lv_obj_set_style_bg_opa(hdr, LV_OPA_COVER, 0);
        lv_obj_set_style_border_width(hdr, 0, 0);
        lv_obj_set_style_radius(hdr, 0, 0);
        lv_obj_set_style_pad_all(hdr, 0, 0);
        lv_obj_clear_flag(hdr, LV_OBJ_FLAG_SCROLLABLE);

        lv_obj_t *accent = lv_obj_create(g_scrDash);
        lv_obj_set_size(accent, 4, 76);
        lv_obj_set_pos(accent, 0, 0);
        lv_obj_set_style_bg_color(accent, C_ACCENT, 0);
        lv_obj_set_style_bg_opa(accent, LV_OPA_COVER, 0);
        lv_obj_set_style_border_width(accent, 0, 0);
        lv_obj_set_style_radius(accent, 0, 0);
        lv_obj_clear_flag(accent, LV_OBJ_FLAG_SCROLLABLE);

        makeLabel(g_scrDash, "NEXARI", C_ACCENT, &lv_font_montserrat_20, 14, 14);
        makeLabel(g_scrDash, "Digital Signage Player", C_MUTED, &lv_font_montserrat_12, 14, 44);
        g_dashStatusDot = makeStatusDot(g_scrDash, DISPLAY_WIDTH - 22, 20, wsConnected);
        // Battery label — top-right corner of header, updated via uiSetBattery()
        g_dashBattLbl = lv_label_create(g_scrDash);
        lv_obj_set_style_text_font(g_dashBattLbl, &lv_font_montserrat_12, 0);
        lv_obj_set_style_text_color(g_dashBattLbl, C_MUTED, 0);
        lv_label_set_text(g_dashBattLbl, "---%");
        lv_obj_set_pos(g_dashBattLbl, DISPLAY_WIDTH - 66, 44);

        // ── Device card: serial, MAC, IP, connection ──────────────────────
        lv_obj_t *devCard = makeCard(g_scrDash, 84, 118);
        makeLabel(devCard, "DEVICE", C_MUTED, &lv_font_montserrat_12, 0, 0);
        makeRow(devCard, "SERIAL", duid ? duid : "-", C_TEXT,   &lv_font_montserrat_12, 20);
        makeRow(devCard, "MAC",    mac  ? mac  : "-", C_TEXT,   &lv_font_montserrat_12, 42);
        g_dashIpLbl = makeRow(devCard, "IP", ip ? ip : "-",     C_ACCENT, &lv_font_montserrat_12, 64);
        char connBuf[52];
        if (ssid && *ssid) snprintf(connBuf, sizeof(connBuf), "WiFi - %s", ssid);
        else               snprintf(connBuf, sizeof(connBuf), "WiFi");
        makeRow(devCard, "TYPE", connBuf, C_TEXT, &lv_font_montserrat_12, 86);

        // ── Server card: host, WS status ──────────────────────────────────
        lv_obj_t *srvCard = makeCard(g_scrDash, 210, 70);
        makeLabel(srvCard, "SERVER", C_MUTED, &lv_font_montserrat_12, 0, 0);
        makeRow(srvCard, "HOST", DEFAULT_API_HOST, C_TEXT, &lv_font_montserrat_12, 20);
        g_dashWsLbl = makeRow(srvCard, "WS",
                              wsConnected ? "Connected" : "Offline",
                              wsConnected ? C_GREEN : C_RED,
                              &lv_font_montserrat_12, 42);

        // ── Now Playing card ──────────────────────────────────────────────
        lv_obj_t *cntCard = makeCard(g_scrDash, 288, 90);
        makeLabel(cntCard, "NOW PLAYING", C_MUTED, &lv_font_montserrat_12, 0, 0);
        g_dashNowLbl = lv_label_create(cntCard);
        lv_obj_set_style_text_color(g_dashNowLbl, C_TEXT, 0);
        lv_obj_set_style_text_font(g_dashNowLbl, &lv_font_montserrat_14, 0);
        lv_label_set_text(g_dashNowLbl, nowPlaying && *nowPlaying ? nowPlaying : "-");
        lv_obj_set_pos(g_dashNowLbl, 0, 22);
        lv_obj_set_width(g_dashNowLbl, DISPLAY_WIDTH - 16 - 20);  // 204px, wraps
        lv_label_set_long_mode(g_dashNowLbl, LV_LABEL_LONG_WRAP);
        lv_obj_clear_flag(g_dashNowLbl, LV_OBJ_FLAG_SCROLLABLE);

        makeLabel(g_scrDash, "IO21: toggle signage view", C_MUTED, &lv_font_montserrat_12, 8, 390);
    }

    // Update live fields
    if (g_dashIpLbl)  lv_label_set_text(g_dashIpLbl,  ip && *ip ? ip : "-");
    if (g_dashWsLbl) {
        lv_label_set_text(g_dashWsLbl, wsConnected ? "Connected" : "Offline");
        lv_obj_set_style_text_color(g_dashWsLbl, wsConnected ? C_GREEN : C_RED, 0);
    }
    if (g_dashNowLbl) lv_label_set_text(g_dashNowLbl, nowPlaying && *nowPlaying ? nowPlaying : "-");
    updateDot(g_dashStatusDot, wsConnected);

    g_screen = Screen::DASHBOARD;
    lv_scr_load(g_scrDash);
}

// ── showSignage ───────────────────────────────────────────────────────────────

void showSignage(const char *scheduleName,
                 const char *nowPlaying,
                 const char *nextUp,
                 bool wsConnected) {
    if (!g_scrSignage) {
        g_scrSignage = makeScreen();

        makeLabel(g_scrSignage, "SIGNAGE", C_ACCENT, &lv_font_montserrat_20, 8, 12);
        g_sigStatusDot = makeStatusDot(g_scrSignage, DISPLAY_WIDTH - 22, 12, wsConnected);
        // Battery label — right side below the header row
        g_sigBattLbl = lv_label_create(g_scrSignage);
        lv_obj_set_style_text_font(g_sigBattLbl, &lv_font_montserrat_12, 0);
        lv_obj_set_style_text_color(g_sigBattLbl, C_MUTED, 0);
        lv_label_set_text(g_sigBattLbl, "---%");
        lv_obj_set_pos(g_sigBattLbl, DISPLAY_WIDTH - 66, 34);

        // Schedule card
        lv_obj_t *card = makeCard(g_scrSignage, 50, 340);
        makeLabel(card, "SCHEDULE", C_MUTED, &lv_font_montserrat_12, 0, 0);
        g_sigScheduleLbl = makeLabel(card, scheduleName ? scheduleName : "—",
                                     C_TEXT, &lv_font_montserrat_16, 0, 18);

        makeLabel(card, "NOW PLAYING", C_MUTED, &lv_font_montserrat_12, 0, 52);
        g_sigNowLbl = makeLabel(card, nowPlaying ? nowPlaying : "—",
                                C_GREEN, &lv_font_montserrat_18, 0, 70);

        makeLabel(card, "NEXT UP", C_MUTED, &lv_font_montserrat_12, 0, 116);
        g_sigNextLbl = makeLabel(card, nextUp ? nextUp : "—",
                                 C_MUTED, &lv_font_montserrat_16, 0, 134);

        makeLabel(g_scrSignage, "IO21: toggle dashboard", C_MUTED, &lv_font_montserrat_12, 8, 410);
    }

    lv_label_set_text(g_sigScheduleLbl, scheduleName && *scheduleName ? scheduleName : "—");
    lv_label_set_text(g_sigNowLbl,      nowPlaying  && *nowPlaying   ? nowPlaying  : "—");
    lv_label_set_text(g_sigNextLbl,     nextUp      && *nextUp       ? nextUp      : "—");
    updateDot(g_sigStatusDot, wsConnected);

    g_screen = Screen::SIGNAGE;
    lv_scr_load(g_scrSignage);
}

// ── uiSetWsStatus ─────────────────────────────────────────────────────────────

void uiSetWsStatus(bool connected) {
    updateDot(g_dashStatusDot, connected);
    updateDot(g_sigStatusDot,  connected);
    if (g_dashWsLbl) {
        lv_label_set_text(g_dashWsLbl, connected ? "Connected" : "Offline");
        lv_obj_set_style_text_color(g_dashWsLbl, connected ? C_GREEN : C_RED, 0);
    }
}

// ── uiSetBattery ──────────────────────────────────────────────────────────────

void uiSetBattery(int pct, bool charging) {
    char buf[16];
    if (pct < 0) {
        snprintf(buf, sizeof(buf), "---%");
    } else if (charging) {
        snprintf(buf, sizeof(buf), "CHG %d%%", pct);
    } else {
        snprintf(buf, sizeof(buf), "%d%%", pct);
    }

    // Color: green when charging, amber when low, red when critical, muted otherwise
    lv_color_t col;
    if (charging)    col = C_GREEN;
    else if (pct < 0)    col = C_MUTED;
    else if (pct < 20)   col = C_RED;
    else if (pct < 50)   col = C_AMBER;
    else                 col = C_MUTED;

    if (g_dashBattLbl) {
        lv_label_set_text(g_dashBattLbl, buf);
        lv_obj_set_style_text_color(g_dashBattLbl, col, 0);
    }
    if (g_sigBattLbl) {
        lv_label_set_text(g_sigBattLbl, buf);
        lv_obj_set_style_text_color(g_sigBattLbl, col, 0);
    }
}

// ── uiCurrentScreen ───────────────────────────────────────────────────────────

Screen uiCurrentScreen() { return g_screen; }
