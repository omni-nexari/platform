package app.chiho.nexari.system

import android.content.Context
import android.media.AudioManager

class AudioCtl(ctx: Context) {
    private val am = ctx.getSystemService(Context.AUDIO_SERVICE) as AudioManager

    fun setVolume(pct: Int): Map<String, Any> {
        val max = am.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
        val v = (pct.coerceIn(0, 100) * max / 100)
        return try {
            am.setStreamVolume(AudioManager.STREAM_MUSIC, v, 0)
            mapOf("supported" to true)
        } catch (e: SecurityException) {
            mapOf("supported" to false, "error" to (e.message ?: "denied"))
        }
    }

    fun getVolume(): Int {
        val max = am.getStreamMaxVolume(AudioManager.STREAM_MUSIC).coerceAtLeast(1)
        val cur = am.getStreamVolume(AudioManager.STREAM_MUSIC)
        return (cur * 100 / max)
    }

    fun setMute(muted: Boolean): Map<String, Any> {
        return try {
            am.adjustStreamVolume(
                AudioManager.STREAM_MUSIC,
                if (muted) AudioManager.ADJUST_MUTE else AudioManager.ADJUST_UNMUTE,
                0,
            )
            mapOf("supported" to true)
        } catch (e: SecurityException) {
            mapOf("supported" to false, "error" to (e.message ?: "denied"))
        }
    }
}
