package app.chiho.nexari.kiosk

import android.app.admin.DevicePolicyManager
import android.app.admin.SystemUpdatePolicy
import android.content.ComponentName
import android.content.Context
import android.os.Build
import android.os.UserManager

/**
 * Applies and toggles the kiosk policy. All operations are best-effort:
 * when the app is not Device Owner, methods silently no-op so that plain
 * sideload installs still work in degraded mode.
 */
class KioskController(private val ctx: Context) {

    private val dpm = ctx.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
    private val admin = ComponentName(ctx, NexariDeviceAdminReceiver::class.java)

    private fun isOwner() = dpm.isDeviceOwnerApp(ctx.packageName)

    fun lock(): Map<String, Any> {
        if (!isOwner()) return mapOf("supported" to false, "error" to "not device owner")
        return try {
            dpm.setLockTaskPackages(admin, arrayOf(ctx.packageName))
            mapOf("supported" to true)
        } catch (e: Exception) { mapOf("supported" to false, "error" to (e.message ?: "")) }
    }

    fun unlock(): Map<String, Any> {
        if (!isOwner()) return mapOf("supported" to false)
        return try {
            dpm.setLockTaskPackages(admin, emptyArray())
            mapOf("supported" to true)
        } catch (e: Exception) { mapOf("supported" to false, "error" to (e.message ?: "")) }
    }

    fun isActive(): Boolean = isOwner() && dpm.isLockTaskPermitted(ctx.packageName)

    /**
     * Applies the production kiosk lockdown. Idempotent. Called once at
     * Device Owner enrolment and again from the player on demand.
     */
    fun applyDefaultPolicy() {
        if (!isOwner()) return
        // Pin our package as the only lock-task whitelist entry.
        try { dpm.setLockTaskPackages(admin, arrayOf(ctx.packageName)) } catch (_: Throwable) {}
        // Block factory reset and USB.
        for (r in arrayOf(
            UserManager.DISALLOW_FACTORY_RESET,
            UserManager.DISALLOW_SAFE_BOOT,
            UserManager.DISALLOW_ADD_USER,
            UserManager.DISALLOW_USB_FILE_TRANSFER,
            UserManager.DISALLOW_DEBUGGING_FEATURES,
            UserManager.DISALLOW_INSTALL_UNKNOWN_SOURCES,
        )) try { dpm.addUserRestriction(admin, r) } catch (_: Throwable) {}
        // Auto-accept system updates so OS upgrades don't pause the kiosk.
        try { dpm.setSystemUpdatePolicy(admin, SystemUpdatePolicy.createAutomaticInstallPolicy()) } catch (_: Throwable) {}
        // Hide status bar / disable keyguard on supported APIs.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            try { dpm.setStatusBarDisabled(admin, true) } catch (_: Throwable) {}
            try { dpm.setKeyguardDisabled(admin, true) } catch (_: Throwable) {}
        }
    }
}
