# Keep PlatformBridge methods callable from JavaScript.
-keep public class app.chiho.nexari.PlatformBridge {
    public *;
}
-keepattributes JavascriptInterface
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
