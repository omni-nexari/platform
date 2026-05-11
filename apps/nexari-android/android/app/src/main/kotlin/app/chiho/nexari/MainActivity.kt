package app.chiho.nexari

import android.Manifest
import android.annotation.SuppressLint
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.view.View
import android.view.WindowManager
import android.webkit.WebView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import app.chiho.nexari.kiosk.NexariDeviceAdminReceiver

/**
 * Hosts the full-screen [PlayerView] WebView and wires up the [PlatformBridge].
 *
 * The activity does almost nothing: it owns the WebView lifecycle and keeps
 * the screen on. All rendering, sync, and content scheduling lives inside
 * the @signage/player-web bundle loaded into the WebView from assets.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var playerView: PlayerView

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
        }

        // Enable Chrome DevTools inspection for debug builds.
        if (BuildConfig.DEBUG) WebView.setWebContentsDebuggingEnabled(true)

        playerView = PlayerView(this)
        setContentView(playerView)
        applyImmersiveMode()
        requestLocationPermissionIfNeeded()
        requestSpecialPermissions()
        playerView.boot()
    }

    private fun requestLocationPermissionIfNeeded() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION)
            != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(
                this,
                arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION),
                1001,
            )
        }
    }

    /**
     * Request special permissions that cannot be granted at install time:
     *  1. WRITE_SETTINGS  — needed for screen brightness control
     *  2. Device Admin    — needed for screen-lock (sleep) command
     *
     * Both prompts are one-time; Android remembers the grant across reboots.
     */
    private fun requestSpecialPermissions() {
        // 1. WRITE_SETTINGS (Modify System Settings)
        if (!Settings.System.canWrite(this)) {
            val intent = Intent(Settings.ACTION_MANAGE_WRITE_SETTINGS)
                .setData(Uri.parse("package:$packageName"))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            startActivity(intent)
        }
        // 2. Device Admin (needed for lockNow / reboot via DPM)
        val dpm = getSystemService(DEVICE_POLICY_SERVICE) as DevicePolicyManager
        val admin = ComponentName(this, NexariDeviceAdminReceiver::class.java)
        if (!dpm.isAdminActive(admin)) {
            val intent = Intent(DevicePolicyManager.ACTION_ADD_DEVICE_ADMIN).apply {
                putExtra(DevicePolicyManager.EXTRA_DEVICE_ADMIN, admin)
                putExtra(
                    DevicePolicyManager.EXTRA_ADD_EXPLANATION,
                    "Nexari needs Device Admin to lock the screen on the Sleep command."
                )
            }
            startActivity(intent)
        }
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) applyImmersiveMode()
    }

    @Suppress("DEPRECATION")
    private fun applyImmersiveMode() {
        // Hide system bars; prefer WindowInsetsController on R+, fall back on
        // older API levels (Fire TV Stick OS 6 = API 22 path is excluded by minSdk 24).
        window.decorView.systemUiVisibility = (
            View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
            or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
            or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
            or View.SYSTEM_UI_FLAG_FULLSCREEN
            or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
        )
    }

    override fun onDestroy() {
        playerView.shutdown()
        super.onDestroy()
    }

    @Suppress("DEPRECATION")
    override fun onBackPressed() {
        // Swallow back to keep the kiosk locked. Long-press menu key still
        // exits via system intent for unprovisioned dev devices.
    }
}
