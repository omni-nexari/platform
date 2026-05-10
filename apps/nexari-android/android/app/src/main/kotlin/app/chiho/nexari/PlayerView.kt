package app.chiho.nexari

import android.annotation.SuppressLint
import android.content.Context
import android.util.Log
import android.webkit.ConsoleMessage
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout

/**
 * Single-WebView wrapper. The WebView loads
 * `file:///android_asset/web/index.html`, which boots the
 * @signage/player-web bundle and connects to the host via
 * `window.AndroidBridge` (see [PlatformBridge]).
 */
class PlayerView(context: Context) : FrameLayout(context) {

    private val webView: WebView = WebView(context)
    private val bridge: PlatformBridge

    init {
        addView(webView, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
        configureWebView()
        bridge = PlatformBridge(context, webView)
        webView.addJavascriptInterface(bridge, "AndroidBridge")
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun configureWebView() {
        val s = webView.settings
        s.javaScriptEnabled = true
        s.domStorageEnabled = true
        s.databaseEnabled = true
        s.allowFileAccess = true
        @Suppress("DEPRECATION")
        s.allowFileAccessFromFileURLs = true   // required for ES module imports from file://
        @Suppress("DEPRECATION")
        s.allowUniversalAccessFromFileURLs = true
        s.mediaPlaybackRequiresUserGesture = false
        s.mixedContentMode = android.webkit.WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
        s.userAgentString = s.userAgentString + " NexariPlayer/${BuildConfig.VERSION_NAME}"
        s.cacheMode = android.webkit.WebSettings.LOAD_DEFAULT
        webView.setBackgroundColor(0xFF000000.toInt())
        webView.webViewClient = WebViewClient()
        webView.webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(msg: ConsoleMessage): Boolean {
                val level = when (msg.messageLevel()) {
                    ConsoleMessage.MessageLevel.ERROR -> Log.ERROR
                    ConsoleMessage.MessageLevel.WARNING -> Log.WARN
                    else -> Log.DEBUG
                }
                Log.println(level, "Nexari", "${msg.message()} (${msg.sourceId()}:${msg.lineNumber()})")
                return true
            }
        }
    }

    fun boot() {
        webView.loadUrl("file:///android_asset/web/index.html")
    }

    fun shutdown() {
        try { webView.stopLoading() } catch (_: Throwable) {}
        try { webView.removeAllViews() } catch (_: Throwable) {}
        try { webView.destroy() } catch (_: Throwable) {}
        bridge.shutdown()
    }
}
