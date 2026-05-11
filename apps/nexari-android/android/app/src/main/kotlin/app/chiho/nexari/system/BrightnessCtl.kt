package app.chiho.nexari.system

import android.content.ContentResolver
import android.content.Context
import android.provider.Settings

class BrightnessCtl(private val ctx: Context) {
    private val cr: ContentResolver = ctx.contentResolver

    fun setBrightness(pct: Int): Map<String, Any> {
        // WRITE_SETTINGS is a special permission on Android 6+. Declaring it in the
        // manifest is not enough — the user must grant it via Special App Access.
        if (!Settings.System.canWrite(ctx)) {
            android.util.Log.w("BrightnessCtl", "WRITE_SETTINGS not granted — cannot set brightness")
            return mapOf("supported" to false, "error" to "requires_write_settings")
        }
        val v = (pct.coerceIn(0, 100) * 255 / 100)
        return try {
            Settings.System.putInt(cr, Settings.System.SCREEN_BRIGHTNESS, v)
            mapOf("supported" to true)
        } catch (e: Exception) {
            mapOf("supported" to false, "error" to (e.message ?: "denied"))
        }
    }

    fun getBrightness(): Int {
        return try {
            val v = Settings.System.getInt(cr, Settings.System.SCREEN_BRIGHTNESS, 128)
            (v * 100 / 255)
        } catch (_: Exception) { 50 }
    }
}
