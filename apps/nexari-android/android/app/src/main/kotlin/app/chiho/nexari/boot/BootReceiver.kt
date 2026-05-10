package app.chiho.nexari.boot

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import app.chiho.nexari.MainActivity

/**
 * Relaunches the player after device boot, package replace, or unlock.
 * Together with `setLockTaskPackages` (Device Owner) this gives reliable
 * always-on kiosk behaviour.
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val launch = Intent(context, MainActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        }
        context.startActivity(launch)
    }
}
