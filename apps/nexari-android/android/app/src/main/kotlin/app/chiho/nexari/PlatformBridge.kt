package app.chiho.nexari

import android.annotation.SuppressLint
import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.Process
import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.WebView
import app.chiho.nexari.kiosk.KioskController
import app.chiho.nexari.ota.OtaInstaller
import app.chiho.nexari.system.AudioCtl
import app.chiho.nexari.system.BrightnessCtl
import app.chiho.nexari.system.DeviceInfoProvider
import app.chiho.nexari.system.PowerCtl
import app.chiho.nexari.system.ResourcesProvider
import app.chiho.nexari.system.Screenshotter
import com.google.gson.Gson
import org.json.JSONObject

/**
 * JS-bridge implementation of `PlatformAdapter` from `@signage/player-web`.
 *
 * The TS interface is async (Promise-returning); WebView's
 * `@JavascriptInterface` is synchronous. We bridge that gap with a tiny
 * helper on the JS side (`makeJsAdapter()`) that wraps each call in
 * `Promise.resolve(JSON.parse(AndroidBridge.<method>(...)))`. Methods that
 * are inherently async (download / install) accept a callback id and post
 * progress back via `evaluateJavascript('window.__nexariOta_<id>(...)')`.
 *
 * All return values are JSON strings so the JS side can `JSON.parse` once.
 */
class PlatformBridge(
    private val context: Context,
    private val webView: WebView,
) {
    private val gson = Gson()
    private val main = Handler(Looper.getMainLooper())

    private val info     = DeviceInfoProvider(context)
    private val audio    = AudioCtl(context)
    private val bright   = BrightnessCtl(context)
    private val power    = PowerCtl(context)
    private val resources= ResourcesProvider(context)
    private val shooter  = Screenshotter(context, webView)
    private val kiosk    = KioskController(context)
    private val ota      = OtaInstaller(context)

    fun shutdown() { /* nothing yet */ }

    // ── Static config exposed at boot ──────────────────────────────────────────

    @JavascriptInterface
    fun getConfig(): String {
        val obj = JSONObject().apply {
            put("apiBase", BuildConfig.DEFAULT_API_BASE)
            put("wsBase",  BuildConfig.DEFAULT_WS_BASE)
            put("otaUrl",  BuildConfig.DEFAULT_OTA_URL)
            put("otaEnabled", BuildConfig.OTA_ENABLED)
            put("playerVersion", BuildConfig.VERSION_NAME)
            put("flavor", BuildConfig.FLAVOR)
        }
        return obj.toString()
    }

    /**
     * Returns a small JS shim that wraps every sync bridge call in a Promise
     * to satisfy the async PlatformAdapter contract. Hosts inject the result
     * by calling `eval(AndroidBridge.makeJsAdapter())`.
     */
    @JavascriptInterface
    @SuppressLint("JavascriptInterface")
    fun makeJsAdapterScript(): String = ADAPTER_SHIM_JS

    // ── Synchronous methods returning JSON strings ─────────────────────────────

    @JavascriptInterface
    fun getDeviceInfo(): String = gson.toJson(info.snapshot())

    @JavascriptInterface
    fun getNetworkInfo(): String = gson.toJson(info.network())

    @JavascriptInterface
    fun getPowerState(): String = gson.toJson(mapOf("state" to power.state()))

    @JavascriptInterface
    fun getResources(): String = gson.toJson(resources.snapshot())

    @JavascriptInterface fun reboot():    String {
        val res = power.reboot()
        // Device Owner not provisioned → fall back to a full app restart so the
        // operator still sees *something* happen rather than a silent no-op.
        if (res["supported"] == false) {
            Log.w(TAG, "reboot not supported (not device owner) — falling back to relaunch")
            main.postDelayed({ doRelaunch() }, 200)
            return gson.toJson(mapOf("supported" to true, "fallback" to "relaunch"))
        }
        return gson.toJson(res)
    }
    @JavascriptInterface fun powerOff():  String = gson.toJson(power.powerOff())
    @JavascriptInterface fun powerOn():   String = gson.toJson(mapOf("supported" to true))
    @JavascriptInterface fun sleep():     String = gson.toJson(power.sleep())

    @JavascriptInterface fun setVolume(pct: Int):       String = gson.toJson(audio.setVolume(pct))
    @JavascriptInterface fun getVolume():               String = gson.toJson(mapOf("pct" to audio.getVolume()))
    @JavascriptInterface fun setMute(muted: Boolean):   String = gson.toJson(audio.setMute(muted))
    @JavascriptInterface fun setBrightness(pct: Int):   String = gson.toJson(bright.setBrightness(pct))
    @JavascriptInterface fun getBrightness():           String = gson.toJson(mapOf("pct" to bright.getBrightness()))

    @JavascriptInterface
    fun screenshot(): String {
        // Synchronous-from-JS: PixelCopy is async on the main thread, but the
        // bundle calls this off the rendering thread (heartbeat tick), so we
        // block briefly. Returns null-string on failure.
        return shooter.captureBlockingJson() ?: "null"
    }

    @JavascriptInterface
    fun relaunch():     String { main.post { doRelaunch() }; return "{}" }

    /**
     * Full process restart using AlarmManager so the relaunch fires OUTSIDE
     * the dying process — startActivity + killProcess in the same process
     * kills the new activity before it can establish itself.
     *
     * Sequence:
     *  1. AlarmManager schedules a one-shot launch 1.5 s from now.
     *  2. After 400 ms we kill our process (WS closes, device goes offline).
     *  3. 1.1 s later Android fires the PendingIntent → fresh app start.
     */
    private fun doRelaunch() {
        try {
            val intent = context.packageManager.getLaunchIntentForPackage(context.packageName)
            if (intent != null) {
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
                val pi = PendingIntent.getActivity(
                    context, 0, intent,
                    PendingIntent.FLAG_CANCEL_CURRENT or PendingIntent.FLAG_IMMUTABLE,
                )
                val am = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
                am.set(AlarmManager.RTC, System.currentTimeMillis() + 1500L, pi)
            }
        } catch (e: Exception) {
            Log.w(TAG, "relaunch schedule failed: ${e.message}")
        }
        main.postDelayed({
            try { Process.killProcess(Process.myPid()) } catch (_: Exception) {}
        }, 400)
    }

    @JavascriptInterface
    fun clearCache():   String { main.post { webView.clearCache(true) }; return "{}" }

    @JavascriptInterface
    fun reloadRenderer(): String { main.post { webView.reload() }; return "{}" }

    @JavascriptInterface
    fun lockKiosk():    String = gson.toJson(kiosk.lock())

    @JavascriptInterface
    fun unlockKiosk():  String = gson.toJson(kiosk.unlock())

    @JavascriptInterface
    fun isKioskActive(): String = gson.toJson(mapOf("active" to kiosk.isActive()))

    // ── Async OTA ──────────────────────────────────────────────────────────────
    // The JS side passes a callback id; we evaluateJavascript to push progress.

    @JavascriptInterface
    fun installUpdate(url: String, version: String, sha256: String?, callbackId: String) {
        ota.install(url, version, sha256) { progress ->
            val json = gson.toJson(progress)
            main.post {
                webView.evaluateJavascript(
                    "window.__nexariOta && window.__nexariOta('$callbackId', $json)",
                    null,
                )
            }
        }
    }

    companion object {
        private const val TAG = "PlatformBridge"

        // Injected into the WebView page; turns the synchronous bridge into an
        // async PlatformAdapter that the TS Player can consume directly.
        private const val ADAPTER_SHIM_JS = """
(function() {
  if (window.AndroidBridge && !window.AndroidBridge.makeJsAdapter) {
    const b = window.AndroidBridge;
    const p = (s) => Promise.resolve(JSON.parse(s));
    const otaCbs = window.__nexariOtaCbs = (window.__nexariOtaCbs || {});
    window.__nexariOta = (id, prog) => {
      const cb = otaCbs[id]; if (!cb) return;
      cb.onProgress && cb.onProgress(prog);
      if (prog && (prog.kind === 'app_update_complete' || prog.kind === 'app_update_failed')) {
        cb.resolve(prog); delete otaCbs[id];
      }
    };
    b.makeJsAdapter = () => ({
      getDeviceInfo:   () => p(b.getDeviceInfo()),
      getNetworkInfo:  () => p(b.getNetworkInfo()),
      getPowerState:   () => p(b.getPowerState()).then(x => x.state),
      getResources:    () => p(b.getResources()),
      reboot:          () => p(b.reboot()),
      powerOff:        () => p(b.powerOff()),
      powerOn:         () => p(b.powerOn()),
      sleep:           () => p(b.sleep()),
      setVolume:       (pct) => p(b.setVolume(pct|0)),
      getVolume:       () => p(b.getVolume()).then(x => x.pct),
      setMute:         (m) => p(b.setMute(!!m)),
      setBrightness:   (pct) => p(b.setBrightness(pct|0)),
      getBrightness:   () => p(b.getBrightness()).then(x => x.pct),
      screenshot:      () => Promise.resolve(JSON.parse(b.screenshot())),
      relaunch:        () => { b.relaunch(); return Promise.resolve(); },
      clearCache:      () => { b.clearCache(); return Promise.resolve(); },
      reloadRenderer:  () => { b.reloadRenderer(); return Promise.resolve(); },
      lockKiosk:       () => p(b.lockKiosk()),
      unlockKiosk:     () => p(b.unlockKiosk()),
      isKioskActive:   () => p(b.isKioskActive()).then(x => !!x.active),
      installUpdate:   (args) => new Promise((resolve, reject) => {
        const id = 'ota_' + Date.now() + '_' + Math.random().toString(36).slice(2);
        otaCbs[id] = { resolve, reject, onProgress: args.onProgress };
        b.installUpdate(args.url, args.version, args.sha256 || null, id);
      }),
    });
  }
})();
"""
    }
}
