#pragma once
#include <Arduino.h>
#include <AceButton.h>
using namespace ace_button;

#include "config.h"
#include "logger.h"

enum class BtnAction {
    NONE,
    TOGGLE_SCREEN,    // IO21 short press  — swap Dashboard ↔ Signage
    REFRESH,          // IO0  short press  — re-fetch schedule + health
    FACTORY_RESET     // IO0  long press (≥3 s) — clear NVS + restart
};

/**
 * ButtonManager — wraps AceButton for two hardware buttons:
 *   IO0  (BOOT): short click = REFRESH, long press ≥ 3 s = FACTORY_RESET
 *   IO21 (USER): short click = TOGGLE_SCREEN
 *
 * Both GPIOs use INPUT_PULLUP (active-low).
 *
 * Usage:
 *   buttonManager.begin();          // call once in setup()
 *   buttonManager.loop();           // call every loop()
 *   BtnAction a = buttonManager.poll();  // consume pending action
 */
class ButtonManager {
public:
    void      begin();
    void      loop();
    BtnAction poll();     // returns and clears the pending action

private:
    AceButton    _btn0{(uint8_t)BTN_BOOT_PIN};
    AceButton    _btn21{(uint8_t)BTN_USER_PIN};
    ButtonConfig _cfg0;
    ButtonConfig _cfg21;

    static BtnAction _pending;
    static void _handler(AceButton *btn, uint8_t eventType, uint8_t btnState);
};

extern ButtonManager buttonManager;
