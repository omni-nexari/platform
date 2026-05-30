#include "buttons.h"

ButtonManager buttonManager;
BtnAction ButtonManager::_pending = BtnAction::NONE;

// ── begin ─────────────────────────────────────────────────────────────────────

void ButtonManager::begin() {
    // IO0 — BOOT button (active-low, internal pull-up)
    pinMode(BTN_BOOT_PIN, INPUT_PULLUP);
    _cfg0.setEventHandler(_handler);
    _cfg0.setFeature(ButtonConfig::kFeatureClick);
    _cfg0.setFeature(ButtonConfig::kFeatureLongPress);
    _cfg0.setFeature(ButtonConfig::kFeatureSuppressAfterLongPress);
    _cfg0.setLongPressDelay(3000);
    _btn0.setButtonConfig(&_cfg0);

    // IO21 — USER button (active-low, internal pull-up)
    // NOTE: IO21 is NOT in the AMOLED board's built-in button array,
    //       so we configure it independently.
    pinMode(BTN_USER_PIN, INPUT_PULLUP);
    _cfg21.setEventHandler(_handler);
    _cfg21.setFeature(ButtonConfig::kFeatureClick);
    _btn21.setButtonConfig(&_cfg21);

    Logger::info("[Btn] init IO%d (BOOT) + IO%d (USER)", BTN_BOOT_PIN, BTN_USER_PIN);
}

// ── loop ──────────────────────────────────────────────────────────────────────

void ButtonManager::loop() {
    _btn0.check();
    _btn21.check();
}

// ── poll ──────────────────────────────────────────────────────────────────────

BtnAction ButtonManager::poll() {
    BtnAction a = _pending;
    _pending = BtnAction::NONE;
    return a;
}

// ── static event handler ──────────────────────────────────────────────────────

void ButtonManager::_handler(AceButton *btn, uint8_t eventType, uint8_t /*btnState*/) {
    uint8_t pin = btn->getPin();

    if (pin == BTN_BOOT_PIN) {
        if (eventType == AceButton::kEventClicked) {
            Logger::debug("[Btn] IO0 short click → REFRESH");
            _pending = BtnAction::REFRESH;
        } else if (eventType == AceButton::kEventLongPressed) {
            Logger::warn("[Btn] IO0 long press → FACTORY_RESET");
            _pending = BtnAction::FACTORY_RESET;
        }
    } else if (pin == BTN_USER_PIN) {
        if (eventType == AceButton::kEventClicked) {
            Logger::debug("[Btn] IO21 click → TOGGLE_SCREEN");
            _pending = BtnAction::TOGGLE_SCREEN;
        }
    }
}
