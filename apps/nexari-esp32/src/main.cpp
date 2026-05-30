#include <Arduino.h>
#include <LilyGo_AMOLED.h>
#include <LV_Helper.h>   // beginLvglHelperDMA — official LVGL integration
#include <lvgl.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>

#include "config.h"
#include "storage.h"
#include "logger.h"
#include "wifi_manager.h"
#include "pairing.h"
#include "ws_client.h"
#include "schedule_client.h"
#include "buttons.h"
#include "ui.h"
#include "image_player.h"
#include "mmwave_sensor.h"

// ── Hardware ──────────────────────────────────────────────────────────────────
// Non-static so image_player.cpp can extern it.
LilyGo_Class amoled;

// ── Application state ─────────────────────────────────────────────────────────
static String  g_duid;
static String  g_mac;
static bool    g_wsRunning    = false;
static uint32_t g_lastHB      = 0;
static uint32_t g_lastLogFlush = 0;
static uint32_t g_lastSched   = 0;
static uint32_t g_lastHealth  = 0;
static uint32_t g_lastBatt    = 0;

// Schedule data (refreshed on schedule poll)
static ScheduleInfo g_sched;

// Pairing flow entry point
static void startPairing();
static void startWs();
static void doHealthCheck();
static void doScheduleFetch();
static void doBatteryUpdate();

// ── Setup ──────────────────────────────────────────────────────────────────────

void setup() {
    Serial.begin(115200);
    // Prevent USB CDC from blocking/hanging when no host is connected.
    // Without this, Serial.printf() stalls the entire setup() on ESP32-S3.
    Serial.setTxTimeoutMs(0);
    delay(1000);  // wait for USB host to enumerate
    Serial.println("\n=== Nexari Boot ===");
    Logger::info("[Main] Nexari ESP32 v%s (%s)", FIRMWARE_VERSION, BUILD_ENV);

    // NVS
    storage.begin();

    // AMOLED (non-touch → false)
    if (!amoled.beginAMOLED_191(false)) {
        Logger::error("[Main] AMOLED init failed — halting");
        while (true) delay(1000);
    }
    // rotation=1 → portrait: width=240, height=536
    // Must be called BEFORE beginLvglHelperDMA so it uses the correct dims.
    amoled.setRotation(1);
    Logger::info("[Main] AMOLED %u x %u", amoled.width(), amoled.height());

    // LVGL — uses beginLvglHelperDMA (1/10-screen DMA buffers from internal heap).
    // This is the library's official LVGL integration; it handles the rounder_cb
    // required by the RM67162 QSPI controller and flush via setAddrWindow+pushColorsDMA.
    beginLvglHelperDMA(amoled);
    mmwaveSensor.begin();
    Logger::info("[Main] LVGL ready");
    uiInit();

    // Buttons
    buttonManager.begin();

    // DUID = "esp32-" + MAC lowercase no colons
    uint8_t mac[6];
    WiFi.macAddress(mac);
    char macStr[18];
    snprintf(macStr, sizeof(macStr), "%02x%02x%02x%02x%02x%02x",
             mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
    g_duid = String("esp32-") + macStr;
    g_mac  = WiFi.macAddress();  // "AA:BB:CC:DD:EE:FF"
    Logger::info("[Main] DUID: %s  MAC: %s", g_duid.c_str(), g_mac.c_str());

    // WiFi
    if (!storage.hasWifi()) {
        Logger::info("[Main] No WiFi config — starting AP");
        wifiManager.startAP();                       // sets SSID internally
        showAPPortal(wifiManager.apSSID().c_str());  // now SSID is populated
        // AP mode; portal runs in loop() via wifiManager.loop()
        return;
    }

    // Show pairing screen while connecting
    showPairing("------");

    wifiManager.onConnected([]() {
        Logger::info("[Main] WiFi connected");
        if (storage.isPaired()) {
            startWs();
        } else {
            startPairing();
        }
    });
    wifiManager.connectSta(storage.getWifiSsid(), storage.getWifiPass());

    // WS message handler
    wsClient.setOnMessage([](const String &type, const String &raw) {
        // Server sends "refresh_schedule" when content/playlist/schedule is published.
        // Also handle legacy event names from older server versions.
        if (type == "refresh_schedule" ||
            type == "content-update"   ||
            type == "content.published" ||
            type == "schedule.updated" ||
            type == "schedule.created" ||
            type == "schedule.deleted") {
            Logger::info("[WS] Refresh trigger: %s", type.c_str());
            doScheduleFetch();
        }
    });
}

// ── Private helpers ───────────────────────────────────────────────────────────

static void startPairing() {
    showPairing("------");
    pairingClient.onClaimed([](String token, String deviceId) {
        Logger::info("[Main] Paired! deviceId=%s", deviceId.c_str());
        storage.setDeviceAuth(token, deviceId);
        startWs();
    });
    pairingClient.onError([](String msg) {
        Logger::error("[Main] Pairing error: %s", msg.c_str());
    });
    pairingClient.begin(storage.getApiHost(), storage.getApiPort(),
                        storage.getApiHttps(), g_duid);
}

static void startWs() {
    g_wsRunning = true;
    wsClient.begin(storage.getApiHost(), storage.getApiPort(),
                   storage.getApiHttps(), storage.getDeviceToken());
    // Fetch initial schedule then show sensor dashboard
    doScheduleFetch();
    showSensorDashboard();
    doBatteryUpdate(); // show initial battery reading on boot
}

static void doScheduleFetch() {
    scheduleClient.fetch(storage.getApiHost(), storage.getApiPort(),
                         storage.getApiHttps(), storage.getDeviceToken());
    g_sched = scheduleClient.info();
    g_lastSched = millis();

    // Refresh whichever screen is active
    if (imagePlayer.isActive() || uiCurrentScreen() == Screen::SIGNAGE) {
        if (g_sched.contentType == "image") {
            // Re-fetch image (content may have changed)
            imagePlayer.show(storage.getApiHost(), storage.getApiPort(),
                             storage.getApiHttps(), storage.getDeviceToken());
        } else {
            // Non-image content — exit image mode and show LVGL signage
            if (imagePlayer.isActive()) imagePlayer.clear();
            showSignage(g_sched.scheduleName.c_str(),
                        g_sched.nowPlaying.c_str(),
                        g_sched.nextUp.c_str(),
                        wsClient.isConnected());
        }
    }
}

static void doHealthCheck() {
    // Simple GET /api/v1/health — use HTTPClient, log result
    String scheme = storage.getApiHttps() ? "https" : "http";
    String url = scheme + "://" + storage.getApiHost() + ":"
                 + String(storage.getApiPort()) + "/api/v1/health";
    Logger::debug("[Health] GET %s", url.c_str());

    HTTPClient http;
    if (storage.getApiHttps()) {
        WiFiClientSecure *cli = new WiFiClientSecure();
        cli->setInsecure();
        http.begin(*cli, url);
    } else {
        http.begin(url);
    }
    int code = http.GET();
    if (code == 200) {
        Logger::info("[Health] server OK");
    } else {
        Logger::warn("[Health] server returned HTTP %d", code);
    }
    http.end();
    g_lastHealth = millis();
}

static void doBatteryUpdate() {
    // T-Display-S3 AMOLED 1.91" has no PMU — battery voltage is read via
    // ADC pin 4 with a /2 voltage divider. getBattVoltage() returns mV.
    uint16_t mv  = amoled.getBattVoltage();
    int      pct = -1;
    if (mv >= 2500 && mv <= 4400) {   // valid LiPo range
        pct = (int)map((long)mv, 3000L, 4200L, 0L, 100L);
        pct = constrain(pct, 0, 100);
    }
    // No charging-status pin on this board; isCharging() will always be false.
    uiSetBattery(pct, false);
    Logger::debug("[Batt] %umV -> %d%%", (unsigned)mv, pct);
    g_lastBatt = millis();
}

// ── Loop ──────────────────────────────────────────────────────────────────────

void loop() {
    // Suspend LVGL while an image is being shown directly via pushColors.
    // The OLED holds pixels until explicitly overwritten, so the image stays
    // on screen without any refresh loop.
    if (!imagePlayer.isActive()) {
        lv_task_handler();
    }

    mmwaveSensor.update();
    // Redraw sensor dashboard only when new data arrives
    if (uiCurrentScreen() == Screen::SENSOR_DASH && !imagePlayer.isActive()) {
        static uint32_t s_lastSensorTs = 0;
        uint32_t ts = mmwaveSensor.data().lastUpdateMs;
        if (ts != s_lastSensorTs) {
            s_lastSensorTs = ts;
            uiUpdateSensor(mmwaveSensor.isPresent(), mmwaveSensor.getDistanceCm());
        }
    }
    wifiManager.loop();
    buttonManager.loop();

    if (g_wsRunning) {
        wsClient.loop();
    }

    // Pairing poll (only while not yet paired)
    if (!storage.isPaired()) {
        pairingClient.loop();
        // Update pairing code on screen when available
        static String lastCode;
        if (pairingClient.pairingCode() != lastCode) {
            lastCode = pairingClient.pairingCode();
            if (lastCode.length() > 0) showPairing(lastCode.c_str());
        }
    }

    uint32_t now = millis();

    // Heartbeat
    if (g_wsRunning && wsClient.isConnected() &&
        now - g_lastHB >= HEARTBEAT_INTERVAL_MS) {
        float tempC   = temperatureRead();
        uint32_t upSec = now / 1000;
        wsClient.sendHeartbeat(tempC, upSec);
        g_lastHB = now;
    }

    // Log flush
    if (g_wsRunning && wsClient.isConnected() &&
        now - g_lastLogFlush >= LOG_FLUSH_INTERVAL_MS) {
        wsClient.flushLogs();
        g_lastLogFlush = now;
    }

    // Schedule poll
    if (g_wsRunning && now - g_lastSched >= SCHEDULE_POLL_MS) {
        doScheduleFetch();
    }

    // Health check
    if (g_wsRunning && now - g_lastHealth >= HEALTH_CHECK_MS) {
        doHealthCheck();
    }

    // Battery poll every 30 seconds
    static constexpr uint32_t BATT_POLL_MS = 30000;
    if (g_wsRunning && now - g_lastBatt >= BATT_POLL_MS) {
        doBatteryUpdate();
    }

    // Button actions
    BtnAction action = buttonManager.poll();
    switch (action) {
        case BtnAction::TOGGLE_SCREEN:
            if (imagePlayer.isActive()) {
                // Image mode -> back to sensor dashboard
                imagePlayer.clear();
                showSensorDashboard();
            } else if (uiCurrentScreen() == Screen::SENSOR_DASH) {
                if (g_sched.contentType == "image") {
                    // Show image fullscreen; LVGL suspended while active
                    imagePlayer.show(storage.getApiHost(), storage.getApiPort(),
                                     storage.getApiHttps(), storage.getDeviceToken());
                } else {
                    showSignage(g_sched.scheduleName.c_str(),
                                g_sched.nowPlaying.c_str(),
                                g_sched.nextUp.c_str(),
                                wsClient.isConnected());
                }
            } else if (uiCurrentScreen() == Screen::SIGNAGE) {
                showSensorDashboard();
            }
            break;

        case BtnAction::REFRESH:
            Logger::info("[Main] Manual refresh");
            doScheduleFetch();
            doHealthCheck();
            break;

        case BtnAction::FACTORY_RESET:
            Logger::warn("[Main] Factory reset initiated");
            storage.clear();
            delay(500);
            ESP.restart();
            break;

        default:
            break;
    }

    // Update WS status dot (cheap, no screen reload)
    static bool lastWsConnected = false;
    bool nowConnected = wsClient.isConnected();
    if (nowConnected != lastWsConnected) {
        lastWsConnected = nowConnected;
        uiSetWsStatus(nowConnected);
    }

    delay(5);   // yield ~5 ms; lv_task_handler uses LV_TICK_CUSTOM millis()
}
