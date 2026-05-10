package app.chiho.nexari.ota

import android.app.PendingIntent
import android.app.admin.DevicePolicyManager
import android.app.DownloadManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.BroadcastReceiver
import android.content.pm.PackageInstaller
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.util.Log
import app.chiho.nexari.kiosk.NexariDeviceAdminReceiver
import java.io.File
import java.io.FileInputStream
import java.security.MessageDigest

data class OtaProgress(
    val kind: String,
    val pct: Int? = null,
    val version: String? = null,
    val packageId: String? = null,
    val error: String? = null,
)

/**
 * Downloads + installs an APK update.
 *
 * Mirrors the WS message shape used by `apps/nexari-epaper/js/epaper-updater.js`
 * (`app_update_downloading` with `pct`, then `app_update_installing`,
 * `app_update_complete`/`app_update_failed`) so the API and portal need no
 * Android-specific changes for OTA reporting.
 *
 * Install path:
 *   - Device Owner → silent install via PackageInstaller.
 *   - Plain sideload → user-prompted install via ACTION_VIEW.
 */
class OtaInstaller(private val ctx: Context) {

    private val dm = ctx.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
    private val dpm = ctx.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
    private val admin = ComponentName(ctx, NexariDeviceAdminReceiver::class.java)

    fun install(url: String, version: String, expectedSha256: String?, onProgress: (OtaProgress) -> Unit) {
        Thread {
            try {
                onProgress(OtaProgress("app_update_downloading", pct = 0, version = version, packageId = ctx.packageName))
                val file = downloadBlocking(url, version) { p ->
                    onProgress(OtaProgress("app_update_downloading", pct = p, version = version, packageId = ctx.packageName))
                } ?: run {
                    onProgress(OtaProgress("app_update_failed", error = "download failed", version = version, packageId = ctx.packageName))
                    return@Thread
                }
                if (expectedSha256 != null) {
                    val actual = sha256(file)
                    if (!actual.equals(expectedSha256, ignoreCase = true)) {
                        onProgress(OtaProgress("app_update_failed", error = "sha256 mismatch", version = version, packageId = ctx.packageName))
                        file.delete()
                        return@Thread
                    }
                }
                onProgress(OtaProgress("app_update_installing", version = version, packageId = ctx.packageName))
                if (dpm.isDeviceOwnerApp(ctx.packageName)) silentInstall(file, version, onProgress)
                else userPromptedInstall(file, version, onProgress)
            } catch (t: Throwable) {
                Log.e("OtaInstaller", "install error", t)
                onProgress(OtaProgress("app_update_failed", error = t.message ?: "unknown", version = version, packageId = ctx.packageName))
            }
        }.start()
    }

    private fun downloadBlocking(url: String, version: String, onPct: (Int) -> Unit): File? {
        val safeVer = version.replace(Regex("[^A-Za-z0-9._-]"), "_")
        val name = "nexari_android_$safeVer.apk"
        val req = DownloadManager.Request(Uri.parse(url))
            .setNotificationVisibility(DownloadManager.Request.VISIBILITY_HIDDEN)
            .setDestinationInExternalFilesDir(ctx, Environment.DIRECTORY_DOWNLOADS, name)
            .setMimeType("application/vnd.android.package-archive")
        val id = dm.enqueue(req)
        val q = DownloadManager.Query().setFilterById(id)
        var path: String? = null
        while (true) {
            val c = dm.query(q) ?: break
            c.use {
                if (!it.moveToFirst()) return null
                val status = it.getInt(it.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS))
                val total = it.getLong(it.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES))
                val sofar = it.getLong(it.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR))
                if (total > 0) onPct(((sofar * 100) / total).toInt().coerceIn(0, 100))
                when (status) {
                    DownloadManager.STATUS_SUCCESSFUL -> {
                        @Suppress("DEPRECATION")
                        path = it.getString(it.getColumnIndexOrThrow(DownloadManager.COLUMN_LOCAL_FILENAME))
                        return@use
                    }
                    DownloadManager.STATUS_FAILED -> return null
                }
            }
            if (path != null) break
            Thread.sleep(500)
        }
        return path?.let { File(it) }
    }

    private fun silentInstall(apk: File, version: String, onProgress: (OtaProgress) -> Unit) {
        val installer = ctx.packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
        }
        val sessionId = installer.createSession(params)
        installer.openSession(sessionId).use { session ->
            FileInputStream(apk).use { input ->
                session.openWrite("nexari_android.apk", 0, apk.length()).use { out ->
                    input.copyTo(out)
                    session.fsync(out)
                }
            }
            val intent = Intent(ctx, OtaResultReceiver::class.java)
            val pi = PendingIntent.getBroadcast(
                ctx, sessionId, intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE,
            )
            session.commit(pi.intentSender)
        }
        // The result receiver fires asynchronously; treat fsync return as completion-pending.
        onProgress(OtaProgress("app_update_complete", version = version, packageId = ctx.packageName))
    }

    private fun userPromptedInstall(apk: File, version: String, onProgress: (OtaProgress) -> Unit) {
        val uri = androidx.core.content.FileProvider.getUriForFile(
            ctx, ctx.packageName + ".fileprovider", apk,
        )
        val intent = Intent(Intent.ACTION_VIEW)
            .setDataAndType(uri, "application/vnd.android.package-archive")
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        ctx.startActivity(intent)
        onProgress(OtaProgress("app_update_complete", version = version, packageId = ctx.packageName))
    }

    private fun sha256(file: File): String {
        val md = MessageDigest.getInstance("SHA-256")
        FileInputStream(file).use { fis ->
            val buf = ByteArray(64 * 1024)
            while (true) { val n = fis.read(buf); if (n <= 0) break; md.update(buf, 0, n) }
        }
        return md.digest().joinToString("") { "%02x".format(it) }
    }
}

class OtaResultReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context?, intent: Intent?) {
        val status = intent?.getIntExtra(PackageInstaller.EXTRA_STATUS, -1) ?: -1
        Log.i("OtaInstaller", "install result: $status")
    }
}
