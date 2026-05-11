package app.chiho.nexari.system

import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import app.chiho.nexari.kiosk.NexariDeviceAdminReceiver

/**
 * Power and lifecycle controls. True reboot/power off requires the app to
 * be Device Owner (provisioned via QR enrolment); on plain installs we fall
 * back to lockNow + relaunch.
 */
class PowerCtl(private val ctx: Context) {

    private val dpm = ctx.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
    private val admin = ComponentName(ctx, NexariDeviceAdminReceiver::class.java)

    fun state(): String = "on" // WebView host always reports 'on' when running.

    fun reboot(): Map<String, Any> {
        return if (dpm.isDeviceOwnerApp(ctx.packageName)) {
            try { dpm.reboot(admin); mapOf("supported" to true) }
            catch (e: Exception) { mapOf("supported" to false, "error" to (e.message ?: "")) }
        } else {
            mapOf("supported" to false, "error" to "not device owner")
        }
    }

    fun powerOff(): Map<String, Any> = sleep() // no real power-off without root; sleep instead.

    fun sleep(): Map<String, Any> {
        return try {
            // First, remove the FLAG_KEEP_SCREEN_ON so the device CAN sleep,
            // and force the screen brightness to 0 to simulate sleep.
            (ctx as? android.app.Activity)?.runOnUiThread {
                val window = ctx.window
                window.clearFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                val lp = window.attributes
                lp.screenBrightness = 0.0f
                window.attributes = lp
            }

            if (dpm.isAdminActive(admin)) {
                dpm.lockNow()
                mapOf("supported" to true)
            } else {
                // Device Admin not active — dim/flag already applied.
                android.util.Log.w("PowerCtl", "Device Admin not active; dimming to 0 as sleep fallback")
                mapOf("supported" to true, "fallback" to "dim")
            }
        } catch (e: SecurityException) {
            mapOf("supported" to false, "error" to (e.message ?: "denied"))
        }
    }
}
