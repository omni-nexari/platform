package app.chiho.nexari.kiosk

import android.app.admin.DeviceAdminReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * Device Admin / Device Owner entry point. The receiver is bound by the
 * AndroidManifest <meta-data device_admin> and is the component name used
 * for QR-code provisioning JSON.
 */
class NexariDeviceAdminReceiver : DeviceAdminReceiver() {

    override fun onEnabled(context: Context, intent: Intent) {
        Log.i("NexariDPC", "device admin enabled")
    }

    override fun onProfileProvisioningComplete(context: Context, intent: Intent) {
        Log.i("NexariDPC", "device owner provisioning complete")
        // Apply default kiosk policy on first enrolment.
        try { KioskController(context).applyDefaultPolicy() } catch (t: Throwable) { Log.w("NexariDPC", "policy apply failed: $t") }
    }
}
