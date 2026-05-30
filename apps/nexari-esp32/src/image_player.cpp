#include "image_player.h"
#include "config.h"
#include "logger.h"
#include <LilyGo_AMOLED.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <lvgl.h>

// Defined as a (non-static) global in main.cpp
extern LilyGo_Class amoled;

ImagePlayer imagePlayer;
JPEGDEC     ImagePlayer::_jpeg;

// ── JPEGDEC strip callback ────────────────────────────────────────────────────
// Called for each decoded MCU row. pDraw->pPixels is RGB565 in native byte
// order (little-endian uint16_t on ESP32). The RM67162 QSPI controller sends
// each byte MSB-first over the wire, so little-endian uint16_t are sent low
// byte first. Empirically this produces wrong colours; swapping bytes per
// pixel fixes it to match LVGL's output.
int ImagePlayer::_drawCb(JPEGDRAW *pDraw) {
    uint16_t *px = (uint16_t *)pDraw->pPixels;
    const int  n  = pDraw->iWidth * pDraw->iHeight;
    for (int i = 0; i < n; i++) px[i] = __builtin_bswap16(px[i]);
    amoled.pushColors(pDraw->x, pDraw->y,
                      pDraw->iWidth, pDraw->iHeight,
                      (uint16_t *)pDraw->pPixels);
    return 1; // continue decoding
}

// ── show ──────────────────────────────────────────────────────────────────────
bool ImagePlayer::show(const String &host, uint16_t port,
                       bool ssl, const String &token) {
    _active = false;

    // ── Download ──────────────────────────────────────────────────────────────
    String scheme = ssl ? "https" : "http";
    String url    = scheme + "://" + host + ":" + String(port)
                  + "/api/v1/devices/device/signage-image";
    Logger::info("[Img] GET %s", url.c_str());

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
        Logger::warn("[Img] HTTP %d", code);
        http.end();
        return false;
    }

    // Read body into a String (handles chunked and fixed-length responses)
    String body = http.getString();
    http.end();

    size_t jpegLen = body.length();
    if (jpegLen == 0 || jpegLen > 200 * 1024) {
        Logger::warn("[Img] Unexpected size: %u bytes", jpegLen);
        return false;
    }
    Logger::info("[Img] Downloaded %u bytes", jpegLen);

    // Copy to a separate heap buffer that persists while _active (JPEGDEC
    // keeps a pointer into this buffer during decode).
    if (_jpegBuf) { free(_jpegBuf); _jpegBuf = nullptr; }
    _jpegBuf = (uint8_t *)malloc(jpegLen);
    if (!_jpegBuf) {
        Logger::error("[Img] OOM — need %u bytes", jpegLen);
        return false;
    }
    memcpy(_jpegBuf, body.c_str(), jpegLen);
    body = String(); // release String's internal buffer early

    // ── Decode + push ─────────────────────────────────────────────────────────
    // Signal loop() to stop calling lv_task_handler() so LVGL doesn't paint
    // over us. Any in-flight LVGL DMA has already completed since we're
    // running sequentially inside loop().
    _active = true;

    if (!_jpeg.openRAM(_jpegBuf, (int)jpegLen, _drawCb)) {
        Logger::error("[Img] JPEG open failed (corrupt or not JPEG)");
        free(_jpegBuf); _jpegBuf = nullptr;
        _active = false;
        return false;
    }

    Logger::info("[Img] Decoding %dx%d JPEG → display",
                 _jpeg.getWidth(), _jpeg.getHeight());

    // JPEG_SWAP_ENDIAN swaps byte order for displays that consume little-endian
    // RGB565. Try 0 first; if colours look wrong, change to JPEG_SWAP_ENDIAN.
    int rc = _jpeg.decode(0, 0, 0);
    _jpeg.close();

    if (rc == 0) {
        Logger::error("[Img] JPEG decode failed");
        free(_jpegBuf); _jpegBuf = nullptr;
        _active = false;
        return false;
    }

    Logger::info("[Img] Image displayed");
    return true;
}

// ── clear ─────────────────────────────────────────────────────────────────────
void ImagePlayer::clear() {
    _active = false;
    if (_jpegBuf) { free(_jpegBuf); _jpegBuf = nullptr; }
    // Direct pushColors() bypassed LVGL's dirty tracking: the AMOLED has image
    // pixels but LVGL thinks its last-rendered screen is still showing.
    // Invalidate the current LVGL screen so lv_task_handler() fully repaints it.
    lv_obj_t *scr = lv_scr_act();
    if (scr) lv_obj_invalidate(scr);
}
