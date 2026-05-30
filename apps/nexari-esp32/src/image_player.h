#pragma once
#include <Arduino.h>
#include <JPEGDEC.h>

/**
 * ImagePlayer — downloads GET /api/v1/devices/device/signage-image
 * (a server-resized 240×536 JPEG), decodes it with JPEGDEC strip-by-strip,
 * and pushes each MCU row directly to the AMOLED via amoled.pushColors().
 *
 * While an image is active, the caller MUST NOT call lv_task_handler() so
 * LVGL doesn't overwrite the framebuffer. Check isActive() in loop().
 */
class ImagePlayer {
public:
    /**
     * Download, decode, and display the device's published image.
     * Blocking — typically 1–3 s on a LAN connection.
     * Sets isActive() = true on success; LVGL must be suspended by caller.
     */
    bool show(const String &host, uint16_t port, bool ssl, const String &token);

    /**
     * Exit image mode: frees the JPEG buffer and signals loop() to resume
     * calling lv_task_handler(). The AMOLED holds the last pixels until LVGL
     * repaints (OLED — no refresh needed).
     */
    void clear();

    bool isActive() const { return _active; }

private:
    bool     _active   = false;
    uint8_t *_jpegBuf  = nullptr;

    static JPEGDEC  _jpeg;
    static int      _drawCb(JPEGDRAW *pDraw);
};

extern ImagePlayer imagePlayer;
