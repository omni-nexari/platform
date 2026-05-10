package app.chiho.nexari

import android.Manifest
import android.annotation.SuppressLint
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.view.View
import android.view.WindowManager
import android.webkit.WebView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat

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

    override fun onBackPressed() {
        // Swallow back to keep the kiosk locked. Long-press menu key still
        // exits via system intent for unprovisioned dev devices.
    }
}
