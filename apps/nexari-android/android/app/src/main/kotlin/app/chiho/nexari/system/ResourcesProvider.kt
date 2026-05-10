package app.chiho.nexari.system

import android.app.ActivityManager
import android.content.Context
import android.os.Environment
import android.os.StatFs
import android.os.SystemClock
import java.io.RandomAccessFile

/**
 * Snapshot of runtime resources for the heartbeat payload.
 *
 * Field names match the WS `HeartbeatSchema` in `packages/shared` so the JS
 * adapter can splat the result directly into the heartbeat payload.
 */
class ResourcesProvider(private val ctx: Context) {

    /** Cached previous CPU sample for delta computation. */
    @Volatile private var lastCpu: LongArray? = null

    fun snapshot(): Map<String, Any?> {
        val mem = readMemory()
        val storage = readStorage()
        val uptime = SystemClock.elapsedRealtime() / 1000L
        val cpu = readCpuLoadPct()
        return mapOf(
            "cpuLoad"          to cpu,
            "memoryFreeBytes"  to mem.free,
            "memoryTotalBytes" to mem.total,
            "storageFreeBytes" to storage.free,
            "deviceUptimeSec"  to uptime,
        )
    }

    private data class Mem(val free: Long?, val total: Long?)
    private fun readMemory(): Mem {
        return try {
            val am = ctx.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager
                ?: return Mem(null, null)
            val mi = ActivityManager.MemoryInfo()
            am.getMemoryInfo(mi)
            Mem(free = mi.availMem, total = mi.totalMem)
        } catch (_: Throwable) {
            Mem(null, null)
        }
    }

    private data class Storage(val free: Long?, val total: Long?)
    private fun readStorage(): Storage {
        return try {
            val path = Environment.getDataDirectory()
            val sf = StatFs(path.absolutePath)
            Storage(free = sf.availableBytes, total = sf.totalBytes)
        } catch (_: Throwable) {
            Storage(null, null)
        }
    }

    /**
     * Read /proc/stat aggregated CPU line, compare against previous sample.
     * Returns 0..100 percent or null if not yet sampled / unreadable.
     *
     * The first call seeds [lastCpu] and returns null; subsequent calls return
     * the delta-based load. Heartbeats fire every 30s so a freshly booted
     * device reports null for one cycle, then real numbers.
     */
    private fun readCpuLoadPct(): Double? {
        return try {
            val sample = RandomAccessFile("/proc/stat", "r").use { f ->
                val line = f.readLine() ?: return null
                // "cpu  user nice system idle iowait irq softirq steal guest guest_nice"
                val parts = line.trim().split(Regex("\\s+"))
                if (parts.size < 5 || parts[0] != "cpu") return null
                LongArray(parts.size - 1) { i -> parts[i + 1].toLongOrNull() ?: 0L }
            }
            val prev = lastCpu
            lastCpu = sample
            if (prev == null || prev.size != sample.size) return null
            val idleIdx = 3
            val ioWaitIdx = 4
            var totalPrev = 0L; var totalNow = 0L
            for (i in sample.indices) { totalPrev += prev[i]; totalNow += sample[i] }
            val idlePrev = prev[idleIdx] + (prev.getOrNull(ioWaitIdx) ?: 0L)
            val idleNow  = sample[idleIdx] + (sample.getOrNull(ioWaitIdx) ?: 0L)
            val totalDelta = totalNow - totalPrev
            val idleDelta  = idleNow  - idlePrev
            if (totalDelta <= 0) return null
            val load = 100.0 * (totalDelta - idleDelta).toDouble() / totalDelta.toDouble()
            load.coerceIn(0.0, 100.0)
        } catch (_: Throwable) {
            null
        }
    }
}
