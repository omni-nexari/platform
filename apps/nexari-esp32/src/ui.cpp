#include "ui.h"
#include <Arduino.h>
#include <math.h>

// ── Internals ─────────────────────────────────────────────────────────────────

static Screen    g_screen      = Screen::AP_PORTAL;
static lv_obj_t *g_scrAP       = nullptr;
static lv_obj_t *g_scrPairing  = nullptr;
static lv_obj_t *g_scrSignage  = nullptr;

// Pairing / signage live labels
static lv_obj_t *g_pairingCodeLbl  = nullptr;
static lv_obj_t *g_sigScheduleLbl  = nullptr;
static lv_obj_t *g_sigNowLbl       = nullptr;
static lv_obj_t *g_sigNextLbl      = nullptr;
static lv_obj_t *g_sigStatusDot    = nullptr;
static lv_obj_t *g_sigBattLbl      = nullptr;

// ── Sensor dashboard ──────────────────────────────────────────────────────────
#define RADAR_W   200
#define RADAR_H   200
#define RADAR_CX  (RADAR_W / 2)
#define RADAR_CY  (RADAR_H / 2)
#define RADAR_R   90   // pixels == 6 m  (15 px per metre)

static lv_obj_t  *g_scrSensor       = nullptr;
static lv_obj_t  *g_sensorCanvas    = nullptr;
static uint16_t  *g_canvasBuf       = nullptr;
static lv_obj_t  *g_sensPresenceLbl = nullptr;
static lv_obj_t  *g_sensDistLbl     = nullptr;
static lv_obj_t  *g_sensBattLbl     = nullptr;
static lv_obj_t  *g_sensStatusDot   = nullptr;

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

// ── _drawRadar ────────────────────────────────────────────────────────────────

static void _drawRadar(bool present, uint16_t distCm) {
    if (!g_sensorCanvas || !g_canvasBuf) return;

    lv_canvas_fill_bg(g_sensorCanvas, lv_color_make(10, 18, 36), LV_OPA_COVER);

    // Grid rings 1-6 m
    lv_draw_arc_dsc_t arc;
    lv_draw_arc_dsc_init(&arc);
    arc.width = 1;
    for (int m = 1; m <= 6; m++) {
        arc.color = (m % 2) ? lv_color_make(30, 40, 60) : lv_color_make(42, 54, 78);
        lv_canvas_draw_arc(g_sensorCanvas, RADAR_CX, RADAR_CY,
                           (lv_coord_t)(m * 15), 0, 360, &arc);
    }

    // Radial spokes every 30 deg (0 = north)
    lv_draw_line_dsc_t line;
    lv_draw_line_dsc_init(&line);
    line.color = lv_color_make(35, 46, 68);
    line.width = 1;
    for (int deg = 0; deg < 360; deg += 30) {
        float rad = deg * 3.14159265f / 180.0f;
        lv_point_t pts[2] = {
            { (lv_coord_t)RADAR_CX, (lv_coord_t)RADAR_CY },
            { (lv_coord_t)(RADAR_CX + (int)(RADAR_R * sinf(rad))),
              (lv_coord_t)(RADAR_CY - (int)(RADAR_R * cosf(rad))) }
        };
        lv_canvas_draw_line(g_sensorCanvas, pts, 2, &line);
    }

    // Ring distance labels (north side, offset right of centre)
    lv_draw_label_dsc_t txt;
    lv_draw_label_dsc_init(&txt);
    txt.color = lv_color_make(65, 85, 115);
    txt.font  = &lv_font_montserrat_12;
    lv_canvas_draw_text(g_sensorCanvas, RADAR_CX + 3, RADAR_CY - 30 - 14, 24, &txt, "2m");
    lv_canvas_draw_text(g_sensorCanvas, RADAR_CX + 3, RADAR_CY - 60 - 14, 24, &txt, "4m");
    lv_canvas_draw_text(g_sensorCanvas, RADAR_CX + 3, RADAR_CY - 88,      24, &txt, "6m");

    // Motion range — orange, 5.5 m = 82 px
    lv_draw_arc_dsc_t mot;
    lv_draw_arc_dsc_init(&mot);
    mot.color = lv_color_make(249, 115, 22);
    mot.width = 2;
    lv_canvas_draw_arc(g_sensorCanvas, RADAR_CX, RADAR_CY, 82, 0, 360, &mot);

    // Micro-motion range — blue, 4.5 m = 67 px
    lv_draw_arc_dsc_t micro;
    lv_draw_arc_dsc_init(&micro);
    micro.color = lv_color_make(59, 130, 246);
    micro.width = 2;
    lv_canvas_draw_arc(g_sensorCanvas, RADAR_CX, RADAR_CY, 67, 0, 360, &micro);

    // Detected distance ring — green
    if (present && distCm > 0 && distCm <= 600) {
        int pr = (int)(distCm / 100.0f * 15.0f);
        if (pr < 3)       pr = 3;
        if (pr > RADAR_R) pr = RADAR_R;
        lv_draw_arc_dsc_t det;
        lv_draw_arc_dsc_init(&det);
        det.color = lv_color_make(74, 222, 128);
        det.width = 3;
        lv_canvas_draw_arc(g_sensorCanvas, RADAR_CX, RADAR_CY,
                           (lv_coord_t)pr, 0, 360, &det);
    }

    // Centre dot: green = present, dim = absent
    lv_draw_rect_dsc_t dot;
    lv_draw_rect_dsc_init(&dot);
    dot.bg_color     = present ? lv_color_make(74, 222, 128) : lv_color_make(55, 65, 90);
    dot.bg_opa       = LV_OPA_COVER;
    dot.radius       = LV_RADIUS_CIRCLE;
    dot.border_width = 0;
    lv_canvas_draw_rect(g_sensorCanvas,
                        RADAR_CX - 6, RADAR_CY - 6, 12, 12, &dot);

    lv_obj_invalidate(g_sensorCanvas);
}

// ── showSensorDashboard ───────────────────────────────────────────────────────

void showSensorDashboard() {
    if (!g_scrSensor) {
        g_scrSensor = makeScreen();

        // Header
        lv_obj_t *hdr = lv_obj_create(g_scrSensor);
        lv_obj_set_size(hdr, DISPLAY_WIDTH, 50);
        lv_obj_set_pos(hdr, 0, 0);
        lv_obj_set_style_bg_color(hdr, C_CARD, 0);
        lv_obj_set_style_bg_opa(hdr, LV_OPA_COVER, 0);
        lv_obj_set_style_border_width(hdr, 0, 0);
        lv_obj_set_style_radius(hdr, 0, 0);
        lv_obj_set_style_pad_all(hdr, 0, 0);
        lv_obj_clear_flag(hdr, LV_OBJ_FLAG_SCROLLABLE);

        lv_obj_t *accent = lv_obj_create(g_scrSensor);
        lv_obj_set_size(accent, 4, 50);
        lv_obj_set_pos(accent, 0, 0);
        lv_obj_set_style_bg_color(accent, C_ACCENT, 0);
        lv_obj_set_style_bg_opa(accent, LV_OPA_COVER, 0);
        lv_obj_set_style_border_width(accent, 0, 0);
        lv_obj_set_style_radius(accent, 0, 0);
        lv_obj_clear_flag(accent, LV_OBJ_FLAG_SCROLLABLE);

        makeLabel(g_scrSensor, "mmWave Sensor",       C_ACCENT, &lv_font_montserrat_16, 12, 10);
        makeLabel(g_scrSensor, "24GHz Human Presence", C_MUTED,  &lv_font_montserrat_12, 12, 32);
        g_sensStatusDot = makeStatusDot(g_scrSensor, DISPLAY_WIDTH - 22, 12, false);
        g_sensBattLbl = lv_label_create(g_scrSensor);
        lv_obj_set_style_text_font(g_sensBattLbl, &lv_font_montserrat_12, 0);
        lv_obj_set_style_text_color(g_sensBattLbl, C_MUTED, 0);
        lv_label_set_text(g_sensBattLbl, "---%");
        lv_obj_set_pos(g_sensBattLbl, DISPLAY_WIDTH - 66, 32);

        // Radar canvas (200x200, centred horizontally)
        g_sensorCanvas = lv_canvas_create(g_scrSensor);
        lv_obj_set_size(g_sensorCanvas, RADAR_W, RADAR_H);
        lv_obj_set_pos(g_sensorCanvas, (DISPLAY_WIDTH - RADAR_W) / 2, 56);
        g_canvasBuf = (uint16_t *)heap_caps_malloc(
            RADAR_W * RADAR_H * sizeof(uint16_t), MALLOC_CAP_SPIRAM);
        if (!g_canvasBuf)
            g_canvasBuf = (uint16_t *)malloc(RADAR_W * RADAR_H * sizeof(uint16_t));
        if (g_canvasBuf)
            lv_canvas_set_buffer(g_sensorCanvas, g_canvasBuf,
                                 RADAR_W, RADAR_H, LV_IMG_CF_TRUE_COLOR);

        // Legend
        lv_obj_t *motBar = lv_obj_create(g_scrSensor);
        lv_obj_set_size(motBar, 18, 4);
        lv_obj_set_pos(motBar, 20, 266);
        lv_obj_set_style_bg_color(motBar, lv_color_hex(0xF97316), 0);
        lv_obj_set_style_bg_opa(motBar, LV_OPA_COVER, 0);
        lv_obj_set_style_border_width(motBar, 0, 0);
        lv_obj_set_style_radius(motBar, 2, 0);
        lv_obj_clear_flag(motBar, LV_OBJ_FLAG_SCROLLABLE);
        makeLabel(g_scrSensor, "Motion  5.5 m",       C_MUTED, &lv_font_montserrat_12, 44, 260);

        lv_obj_t *microBar = lv_obj_create(g_scrSensor);
        lv_obj_set_size(microBar, 18, 4);
        lv_obj_set_pos(microBar, 20, 282);
        lv_obj_set_style_bg_color(microBar, lv_color_hex(0x3B82F6), 0);
        lv_obj_set_style_bg_opa(microBar, LV_OPA_COVER, 0);
        lv_obj_set_style_border_width(microBar, 0, 0);
        lv_obj_set_style_radius(microBar, 2, 0);
        lv_obj_clear_flag(microBar, LV_OBJ_FLAG_SCROLLABLE);
        makeLabel(g_scrSensor, "Micro-motion  4.5 m", C_MUTED, &lv_font_montserrat_12, 44, 276);

        // Separator
        lv_obj_t *sep = lv_obj_create(g_scrSensor);
        lv_obj_set_size(sep, DISPLAY_WIDTH - 16, 1);
        lv_obj_set_pos(sep, 8, 300);
        lv_obj_set_style_bg_color(sep, C_MUTED, 0);
        lv_obj_set_style_bg_opa(sep, LV_OPA_30, 0);
        lv_obj_set_style_border_width(sep, 0, 0);
        lv_obj_set_style_radius(sep, 0, 0);
        lv_obj_clear_flag(sep, LV_OBJ_FLAG_SCROLLABLE);

        // Presence status (centred)
        g_sensPresenceLbl = lv_label_create(g_scrSensor);
        lv_obj_set_style_text_font(g_sensPresenceLbl, &lv_font_montserrat_20, 0);
        lv_obj_set_style_text_color(g_sensPresenceLbl, C_MUTED, 0);
        lv_label_set_text(g_sensPresenceLbl, "NO PERSON");
        lv_obj_set_width(g_sensPresenceLbl, DISPLAY_WIDTH);
        lv_obj_set_style_text_align(g_sensPresenceLbl, LV_TEXT_ALIGN_CENTER, 0);
        lv_obj_set_pos(g_sensPresenceLbl, 0, 312);

        // Distance (large, centred)
        g_sensDistLbl = lv_label_create(g_scrSensor);
        lv_obj_set_style_text_font(g_sensDistLbl, &lv_font_montserrat_48, 0);
        lv_obj_set_style_text_color(g_sensDistLbl, C_MUTED, 0);
        lv_label_set_text(g_sensDistLbl, "---");
        lv_obj_set_width(g_sensDistLbl, DISPLAY_WIDTH);
        lv_obj_set_style_text_align(g_sensDistLbl, LV_TEXT_ALIGN_CENTER, 0);
        lv_obj_set_pos(g_sensDistLbl, 0, 342);

        makeLabel(g_scrSensor, "IO21: toggle signage", C_MUTED, &lv_font_montserrat_12, 8, 494);
    }

    _drawRadar(false, 0);

    g_screen = Screen::SENSOR_DASH;
    lv_scr_load(g_scrSensor);
}

// ── uiUpdateSensor ────────────────────────────────────────────────────────────

void uiUpdateSensor(bool present, uint16_t distCm) {
    if (!g_scrSensor) return;

    _drawRadar(present, distCm);

    if (g_sensPresenceLbl) {
        lv_label_set_text(g_sensPresenceLbl, present ? "PRESENT" : "NO PERSON");
        lv_obj_set_style_text_color(g_sensPresenceLbl,
                                    present ? C_GREEN : C_MUTED, 0);
    }
    if (g_sensDistLbl) {
        if (present && distCm > 0) {
            char buf[16];
            snprintf(buf, sizeof(buf), "%.1f m", distCm / 100.0f);
            lv_label_set_text(g_sensDistLbl, buf);
            lv_obj_set_style_text_color(g_sensDistLbl, C_TEXT, 0);
        } else {
            lv_label_set_text(g_sensDistLbl, "---");
            lv_obj_set_style_text_color(g_sensDistLbl, C_MUTED, 0);
        }
    }
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
    updateDot(g_sensStatusDot, connected);
    updateDot(g_sigStatusDot,  connected);
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

    if (g_sensBattLbl) {
        lv_label_set_text(g_sensBattLbl, buf);
        lv_obj_set_style_text_color(g_sensBattLbl, col, 0);
    }
    if (g_sigBattLbl) {
        lv_label_set_text(g_sigBattLbl, buf);
        lv_obj_set_style_text_color(g_sigBattLbl, col, 0);
    }
}

// ── uiCurrentScreen ───────────────────────────────────────────────────────────

Screen uiCurrentScreen() { return g_screen; }
