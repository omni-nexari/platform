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
static lv_obj_t *g_dashOnlineLbl   = nullptr;
static lv_obj_t *g_dashNP1Lbl      = nullptr;
static lv_obj_t *g_dashNP2Lbl      = nullptr;
static lv_obj_t *g_dashNP3Lbl      = nullptr;
static lv_obj_t *g_dashStatusDot   = nullptr;
static lv_obj_t *g_sigScheduleLbl  = nullptr;
static lv_obj_t *g_sigNowLbl       = nullptr;
static lv_obj_t *g_sigNextLbl      = nullptr;
static lv_obj_t *g_sigStatusDot    = nullptr;

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

void showDashboard(uint16_t online, uint16_t total,
                   const char *np1, const char *np2, const char *np3,
                   bool wsConnected) {
    if (!g_scrDash) {
        g_scrDash = makeScreen();

        // Header
        makeLabel(g_scrDash, "NEXARI", C_ACCENT, &lv_font_montserrat_20, 8, 12);
        makeLabel(g_scrDash, "Dashboard", C_MUTED, &lv_font_montserrat_14, 8, 38);

        // Status dot top-right
        g_dashStatusDot = makeStatusDot(g_scrDash, DISPLAY_WIDTH - 22, 12, wsConnected);

        // Devices card
        lv_obj_t *card1 = makeCard(g_scrDash, 62, 90);
        makeLabel(card1, "DEVICES", C_MUTED, &lv_font_montserrat_12, 0, 0);
        g_dashOnlineLbl = makeLabel(card1, "-- / --", C_TEXT, &lv_font_montserrat_24, 0, 18);

        // Now Playing card
        lv_obj_t *card2 = makeCard(g_scrDash, 162, 220);
        makeLabel(card2, "NOW PLAYING", C_MUTED, &lv_font_montserrat_12, 0, 0);
        g_dashNP1Lbl = makeLabel(card2, np1 && *np1 ? np1 : "—", C_TEXT, &lv_font_montserrat_14, 0, 22);
        g_dashNP2Lbl = makeLabel(card2, np2 && *np2 ? np2 : "", C_MUTED, &lv_font_montserrat_14, 0, 46);
        g_dashNP3Lbl = makeLabel(card2, np3 && *np3 ? np3 : "", C_MUTED, &lv_font_montserrat_14, 0, 70);

        // Status bar
        makeLabel(g_scrDash, "IO21: toggle signage view", C_MUTED, &lv_font_montserrat_12, 8, 394);
    }

    // Update live data
    char onlineBuf[16];
    snprintf(onlineBuf, sizeof(onlineBuf), "%u / %u", online, total);
    lv_label_set_text(g_dashOnlineLbl, onlineBuf);
    lv_label_set_text(g_dashNP1Lbl, np1 && *np1 ? np1 : "—");
    lv_label_set_text(g_dashNP2Lbl, np2 && *np2 ? np2 : "");
    lv_label_set_text(g_dashNP3Lbl, np3 && *np3 ? np3 : "");
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
}

// ── uiCurrentScreen ───────────────────────────────────────────────────────────

Screen uiCurrentScreen() { return g_screen; }
