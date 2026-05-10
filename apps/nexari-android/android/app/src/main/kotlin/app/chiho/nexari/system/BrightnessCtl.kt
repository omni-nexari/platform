package app.chiho.nexari.system

import android.content.ContentResolver
import android.content.Context
import android.provider.Settings

class BrightnessCtl(ctx: Context) {
    private val cr: ContentResolver = ctx.contentResolver

    fun setBrightness(pct: Int): Map<String, Any> {
        val v = (pct.coerceIn(0, 100) * 255 / 100)
        return try {
            // Requires WRITE_SETTINGS — granted only on system / DPC builds.
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
