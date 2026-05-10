package app.chiho.nexari.system

import android.app.UiModeManager
import android.content.Context
import android.content.res.Configuration
import android.net.wifi.WifiManager
import android.os.BatteryManager
import android.os.Build
import android.provider.Settings
import java.util.TimeZone

class DeviceInfoProvider(private val ctx: Context) {

    fun snapshot(): Map<String, Any?> {
        val resolution = run {
            val m = ctx.resources.displayMetrics
            "${maxOf(m.widthPixels, m.heightPixels)}x${minOf(m.widthPixels, m.heightPixels)}"
        }
        val androidId = Settings.Secure.getString(ctx.contentResolver, Settings.Secure.ANDROID_ID) ?: ""
        val kind = detectKind()
        val platform = when (kind) {
            "androidtv" -> "androidtv"
            "firetv"    -> "firetv"
            else        -> "android"
        }
        val battery = (ctx.getSystemService(Context.BATTERY_SERVICE) as? BatteryManager)
            ?.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
            ?.takeIf { it in 0..100 }
        return mapOf(
            "deviceId"        to "android-$androidId",
            "kind"            to kind,
            "platform"        to platform,
            "manufacturer"    to Build.MANUFACTURER,
            "modelName"       to Build.MODEL,
            "modelCode"       to Build.DEVICE,
            "serialNumber"    to safeSerial(),
            "firmwareVersion" to Build.VERSION.RELEASE,
            "playerVersion"   to (try { ctx.packageManager.getPackageInfo(ctx.packageName, 0).versionName } catch (_: Throwable) { null }),
            "resolution"      to resolution,
            "timezone"        to TimeZone.getDefault().id,
            "batteryPct"      to battery,
            "macAddress"      to null, // 6.0+ blocks MAC reads; left null intentionally.
        )
    }

    fun network(): Map<String, Any?> {
        val wm = ctx.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
        @Suppress("DEPRECATION") val info = wm?.connectionInfo
        @Suppress("DEPRECATION") val ipInt = info?.ipAddress ?: 0
        val ip = if (ipInt == 0) null else String.format(
            "%d.%d.%d.%d",
            ipInt and 0xff,
            (ipInt shr 8) and 0xff,
            (ipInt shr 16) and 0xff,
            (ipInt shr 24) and 0xff,
        )
        @Suppress("DEPRECATION") val ssid = info?.ssid?.trim('"')
        return mapOf(
            "ipAddress"      to ip,
            "ssid"           to ssid,
            "connectionType" to "wifi",
            "signalPct"      to null,
        )
    }

    private fun detectKind(): String {
        val pm = ctx.packageManager
        val isFireTv = Build.MANUFACTURER.equals("Amazon", ignoreCase = true) &&
            (pm.hasSystemFeature("amazon.hardware.fire_tv") || Build.MODEL.startsWith("AFT"))
        if (isFireTv) return "firetv"
        val uim = ctx.getSystemService(Context.UI_MODE_SERVICE) as? UiModeManager
        if (uim?.currentModeType == Configuration.UI_MODE_TYPE_TELEVISION) return "androidtv"
        return "android"
    }

    @Suppress("DEPRECATION")
    private fun safeSerial(): String? = try { Build.SERIAL.takeIf { it != Build.UNKNOWN } } catch (_: Throwable) { null }
}
