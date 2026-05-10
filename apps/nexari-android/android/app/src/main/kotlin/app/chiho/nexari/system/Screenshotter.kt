package app.chiho.nexari.system

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Bitmap
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.util.Base64
import android.view.PixelCopy
import android.webkit.WebView
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * Captures the WebView surface as JPEG bytes, base64-encoded, in the JSON
 * shape expected by the player-web `screenshot()` adapter contract.
 *
 * Uses [PixelCopy] on API 26+ for correct hardware-accelerated capture; falls
 * back to the deprecated draw-cache path on older devices (minSdk 24/25).
 */
class Screenshotter(private val ctx: Context, private val webView: WebView) {

    @SuppressLint("WrongThread")
    fun captureBlockingJson(): String? {
        return try {
            val bmp = capture() ?: return null
            val jpeg = ByteArrayOutputStream().use { bmp.compress(Bitmap.CompressFormat.JPEG, 70, it); it.toByteArray() }
            val b64 = Base64.encodeToString(jpeg, Base64.NO_WRAP)
            JSONObject().apply {
                put("jpegBase64", b64)
                put("width", bmp.width)
                put("height", bmp.height)
            }.toString()
        } catch (_: Throwable) { null }
    }

    private fun capture(): Bitmap? {
        val w = webView.width; val h = webView.height
        if (w <= 0 || h <= 0) return null
        val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val ht = HandlerThread("nexari-pixelcopy").also { it.start() }
            val latch = CountDownLatch(1)
            var ok = false
            try {
                webView.post {
                    PixelCopy.request(
                        (ctx as? android.app.Activity)?.window ?: return@post,
                        intArrayOf(0, 0, w, h).let { android.graphics.Rect(0, 0, w, h) },
                        bmp,
                        { result -> ok = (result == PixelCopy.SUCCESS); latch.countDown() },
                        Handler(ht.looper),
                    )
                }
                latch.await(2, TimeUnit.SECONDS)
            } finally { ht.quitSafely() }
            if (!ok) return null
        } else {
            @Suppress("DEPRECATION")
            webView.isDrawingCacheEnabled = true
            @Suppress("DEPRECATION")
            webView.buildDrawingCache(true)
            @Suppress("DEPRECATION")
            val src = webView.drawingCache ?: return null
            android.graphics.Canvas(bmp).drawBitmap(src, 0f, 0f, null)
        }
        return bmp
    }
}
