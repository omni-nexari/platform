#include "wifi_manager.h"
#include "storage.h"
#include <ArduinoJson.h>

WifiManager wifiManager;

// ── Portal HTML ───────────────────────────────────────────────────────────────
static const char PORTAL_PAGE[] PROGMEM = R"rawhtml(
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Nexari Setup</title>
<style>
  body{font-family:sans-serif;background:#0f172a;color:#e2e8f0;margin:0;padding:20px}
  h1{color:#38bdf8;margin-bottom:4px;font-size:1.4rem}
  p{color:#94a3b8;margin:0 0 20px;font-size:.85rem}
  .card{background:#1e293b;border-radius:12px;padding:20px;margin-bottom:16px}
  label{display:block;margin-bottom:6px;font-size:.85rem;color:#94a3b8}
  select,input{width:100%;box-sizing:border-box;background:#0f172a;border:1px solid #334155;
    color:#e2e8f0;border-radius:8px;padding:10px;font-size:1rem;margin-bottom:14px}
  button{width:100%;background:#38bdf8;color:#0f172a;border:none;border-radius:8px;
    padding:12px;font-size:1rem;font-weight:700;cursor:pointer}
  button:active{opacity:.8}
  #status{margin-top:12px;text-align:center;font-size:.9rem;color:#4ade80;display:none}
  #err{margin-top:12px;text-align:center;font-size:.9rem;color:#f87171;display:none}
</style>
</head>
<body>
<h1>Nexari Setup</h1>
<p>Connect this device to your Wi-Fi network</p>
<div class="card">
  <label>Wi-Fi Network</label>
  <select id="ssidSel" onchange="onSel()">
    <option value="">Scanning...</option>
  </select>
  <label>Or enter manually</label>
  <input id="ssidMan" placeholder="Network name (SSID)" type="text">
  <label>Password</label>
  <input id="pass" type="password" placeholder="Wi-Fi password">
  <button onclick="save()">Connect</button>
  <div id="status">Saving... Device will restart.</div>
  <div id="err"></div>
</div>
<script>
function onSel(){
  var v=document.getElementById('ssidSel').value;
  if(v) document.getElementById('ssidMan').value=v;
}
function save(){
  var ssid=(document.getElementById('ssidMan').value||document.getElementById('ssidSel').value).trim();
  var pass=document.getElementById('pass').value;
  if(!ssid){document.getElementById('err').style.display='block';document.getElementById('err').textContent='Please enter a network name';return;}
  document.getElementById('status').style.display='block';
  document.getElementById('err').style.display='none';
  fetch('/save',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:'ssid='+encodeURIComponent(ssid)+'&pass='+encodeURIComponent(pass)})
    .then(r=>r.json()).then(d=>{
      if(d.ok){document.getElementById('status').textContent='Saved! Restarting...';}
      else{document.getElementById('err').style.display='block';document.getElementById('err').textContent=d.error||'Error';}
    }).catch(()=>{document.getElementById('err').style.display='block';document.getElementById('err').textContent='Request failed';});
}
// Scan on load
fetch('/scan').then(r=>r.json()).then(nets=>{
  var sel=document.getElementById('ssidSel');
  sel.innerHTML='<option value="">-- select network --</option>';
  nets.forEach(function(n){var o=document.createElement('option');o.value=n;o.textContent=n;sel.appendChild(o);});
}).catch(()=>{document.getElementById('ssidSel').innerHTML='<option value="">Scan failed</option>';});
</script>
</body>
</html>
)rawhtml";

// ── Constructor ───────────────────────────────────────────────────────────────

WifiManager::WifiManager() : _server(80) {}

// ── AP mode ───────────────────────────────────────────────────────────────────

void WifiManager::startAP() {
    WiFi.disconnect(true);
    WiFi.mode(WIFI_AP);

    // SSID = "NexariSetup-XXYY" (last 4 MAC hex chars)
    uint8_t mac[6];
    WiFi.softAPmacAddress(mac);
    char suffix[5];
    snprintf(suffix, sizeof(suffix), "%02X%02X", mac[4], mac[5]);
    _apSSID = String(AP_SSID_PREFIX) + suffix;

    WiFi.softAP(_apSSID.c_str());
    WiFi.softAPConfig(
        IPAddress(192, 168, 4, 1),
        IPAddress(192, 168, 4, 1),
        IPAddress(255, 255, 255, 0)
    );

    _setupPortalRoutes();
    _server.begin();
    _state = WifiState::AP_MODE;

    Logger::info("[WiFi] AP mode started: SSID=%s  IP=192.168.4.1", _apSSID.c_str());
}

void WifiManager::_setupPortalRoutes() {
    // Main portal page
    _server.on("/", HTTP_GET, [this]() {
        _server.send(200, "text/html", FPSTR(PORTAL_PAGE));
    });

    // Captive portal redirect for iOS/Android/Windows
    _server.on("/generate_204",     HTTP_GET, [this]() { _server.sendHeader("Location", "http://192.168.4.1"); _server.send(302); });
    _server.on("/hotspot-detect.html", HTTP_GET, [this]() { _server.sendHeader("Location", "http://192.168.4.1"); _server.send(302); });
    _server.on("/ncsi.txt",         HTTP_GET, [this]() { _server.sendHeader("Location", "http://192.168.4.1"); _server.send(302); });
    _server.onNotFound([this]() {
        _server.sendHeader("Location", String("http://192.168.4.1"));
        _server.send(302, "text/plain", "");
    });

    // WiFi scan
    _server.on("/scan", HTTP_GET, [this]() {
        _server.send(200, "application/json", _buildScanJson());
    });

    // Save credentials
    _server.on("/save", HTTP_POST, [this]() {
        if (!_server.hasArg("ssid")) {
            _server.send(400, "application/json", "{\"ok\":false,\"error\":\"missing ssid\"}");
            return;
        }
        String ssid = _server.arg("ssid");
        String pass = _server.arg("pass");

        if (ssid.length() == 0) {
            _server.send(400, "application/json", "{\"ok\":false,\"error\":\"ssid empty\"}");
            return;
        }

        storage.setWifi(ssid, pass);
        _server.send(200, "application/json", "{\"ok\":true}");

        Logger::info("[WiFi] Credentials saved via portal. SSID=%s", ssid.c_str());

        if (_onCredentialsSaved) _onCredentialsSaved(ssid, pass);

        delay(800);
        ESP.restart();
    });
}

String WifiManager::_buildScanJson() {
    int n = WiFi.scanNetworks();
    JsonDocument doc;
    JsonArray arr = doc.to<JsonArray>();
    for (int i = 0; i < n; i++) {
        arr.add(WiFi.SSID(i));
    }
    String out;
    serializeJson(doc, out);
    return out;
}

// ── STA mode ─────────────────────────────────────────────────────────────────

void WifiManager::connectSta(const String &ssid, const String &pass) {
    Logger::info("[WiFi] Connecting to SSID: %s", ssid.c_str());
    WiFi.mode(WIFI_STA);
    WiFi.begin(ssid.c_str(), pass.c_str());
    _state     = WifiState::CONNECTING;
    _connectAt = millis();
    _retries   = 0;
}

// ── Loop ──────────────────────────────────────────────────────────────────────

void WifiManager::loop() {
    if (_state == WifiState::AP_MODE) {
        _server.handleClient();
        return;
    }

    if (_state == WifiState::CONNECTING) {
        if (WiFi.status() == WL_CONNECTED) {
            _state = WifiState::CONNECTED;
            Logger::info("[WiFi] Connected. IP=%s", WiFi.localIP().toString().c_str());
            if (_onConnected) _onConnected();
        } else if (millis() - _connectAt > 15000) {
            _retries++;
            if (_retries >= 3) {
                _state = WifiState::FAILED;
                Logger::warn("[WiFi] Connection failed after 3 attempts");
            } else {
                Logger::warn("[WiFi] Timeout, retrying (%u/3)...", _retries);
                WiFi.disconnect();
                delay(500);
                WiFi.begin(storage.getWifiSsid().c_str(), storage.getWifiPass().c_str());
                _connectAt = millis();
            }
        }
        return;
    }

    if (_state == WifiState::CONNECTED) {
        if (WiFi.status() != WL_CONNECTED) {
            _state = WifiState::CONNECTING;
            _connectAt = millis();
            _retries   = 0;
            Logger::warn("[WiFi] Connection dropped, reconnecting...");
            WiFi.reconnect();
        }
    }
}
