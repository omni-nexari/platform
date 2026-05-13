package app.chiho.nexari

import android.annotation.SuppressLint
import android.content.Context
import android.util.Log
import android.view.View
import android.webkit.ConsoleMessage
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.webkit.WebViewAssetLoader

/**
 * Single-WebView wrapper. The WebView loads the bundled player-web assets via
 * an in-process [WebViewAssetLoader] mapped to
 * `https://appassets.androidplatform.net/`. Serving the SPA over an https://
 * origin lets us turn off the dangerous `allowFileAccessFromFileURLs` /
 * `allowUniversalAccessFromFileURLs` flags and enforce `MIXED_CONTENT_NEVER_ALLOW`
 * while still letting the page reach the bundle, ES modules, and the
 * `window.AndroidBridge` JS interface (see [PlatformBridge]).
 */
class PlayerView(context: Context) : FrameLayout(context) {

    private val webView: WebView = WebView(context)
    private val bridge: PlatformBridge
    private val assetLoader: WebViewAssetLoader = WebViewAssetLoader.Builder()
        .setDomain(ASSET_DOMAIN)
        .addPathHandler("/", WebViewAssetLoader.AssetsPathHandler(context))
        .build()

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
        // file:// access is no longer required because the app is served via
        // WebViewAssetLoader on an https:// origin. Disabling these closes the
        // file://-origin SOP bypass that would otherwise combine with the
        // AndroidBridge JS interface.
        s.allowFileAccess = false
        @Suppress("DEPRECATION")
        s.allowFileAccessFromFileURLs = false
        @Suppress("DEPRECATION")
        s.allowUniversalAccessFromFileURLs = false
        s.mediaPlaybackRequiresUserGesture = false
        // The page is served on https://appassets.androidplatform.net. For
        // production (https API) we never allow mixed content. For dev builds
        // that talk to a cleartext LAN API (http://192.168.1.17), the WebView
        // would otherwise block fetch/WS calls as mixed-content even though the
        // network security config permits the cleartext. Detect that and fall
        // back to compatibility mode for the dev case only.
        val apiIsCleartext = BuildConfig.DEFAULT_API_BASE.startsWith("http://") ||
                              BuildConfig.DEFAULT_WS_BASE.startsWith("ws://")
        s.mixedContentMode = if (apiIsCleartext)
            android.webkit.WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
        else
            android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW
        s.userAgentString = s.userAgentString + " NexariPlayer/${BuildConfig.VERSION_NAME}"
        s.cacheMode = android.webkit.WebSettings.LOAD_DEFAULT
        webView.setBackgroundColor(0xFF000000.toInt())
        webView.setLayerType(View.LAYER_TYPE_HARDWARE, null)
        webView.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(
                view: WebView,
                request: WebResourceRequest
            ): WebResourceResponse? = assetLoader.shouldInterceptRequest(request.url)
        }
        webView.webChromeClient = object : WebChromeClient() {
            override fun getDefaultVideoPoster(): android.graphics.Bitmap? {
                // Return an empty transparent bitmap to hide the giant play button
                return android.graphics.Bitmap.createBitmap(1, 1, android.graphics.Bitmap.Config.ARGB_8888)
            }

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
        webView.loadUrl("https://$ASSET_DOMAIN/web/index.html")
    }

    fun shutdown() {
        try { webView.stopLoading() } catch (_: Throwable) {}
        try { webView.removeAllViews() } catch (_: Throwable) {}
        try { webView.destroy() } catch (_: Throwable) {}
        bridge.shutdown()
    }

    private companion object {
        const val ASSET_DOMAIN = "appassets.androidplatform.net"
    }
}
