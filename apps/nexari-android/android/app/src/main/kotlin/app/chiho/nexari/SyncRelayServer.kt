package app.chiho.nexari

import android.util.Base64
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.io.OutputStream
import java.net.ServerSocket
import java.net.Socket
import java.security.MessageDigest
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit

/**
 * LAN sync relay — JSON protocol, fully compatible with sync.ts (cloud relay protocol).
 *
 * Handles:
 *   WS_REGISTER → track peer, broadcast PEERS to group
 *   PING        → PONG { t1, t2 } for clock sync
 *   READY       → barrier: when all group peers ready, broadcast GO { playAt }
 *   LOOP_READY  → barrier: when all group peers loop-ready, broadcast LOOP_GO { playAt }
 *   HEARTBEAT_PEERS every 5 s → { peers: [id, ...] }
 *   all other messages → fanout to group with `from` field appended
 */
class SyncRelayServer(private val port: Int) {

    private val TAG = "SyncRelayServer"

    private var serverSocket: ServerSocket? = null
    private val executor: ScheduledExecutorService = Executors.newScheduledThreadPool(4)

    private val peers     = CopyOnWriteArrayList<ClientHandler>()
    private val readySet  = CopyOnWriteArrayList<ClientHandler>()
    // groupId → set of deviceIds that sent LOOP_READY for the current loop
    private val loopReady = HashMap<String, MutableSet<String>>()

    private var heartbeatFuture: ScheduledFuture<*>? = null

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    fun start() {
        if (serverSocket?.isClosed == false) {
            Log.d(TAG, "relay already running on :$port")
            return
        }
        try {
            val ss = ServerSocket(port)
            serverSocket = ss
            Log.i(TAG, "relay listening on :$port")

            // Heartbeat: broadcast HEARTBEAT_PEERS to each group every 5 s
            heartbeatFuture = executor.scheduleAtFixedRate({
                val groups = synchronized(loopReady) { peers.map { it.groupId }.toSet() }
                for (gid in groups) {
                    if (gid.isEmpty()) continue
                    val group = peers.filter { it.groupId == gid }
                    val idsJson = JSONArray().apply { group.forEach { put(it.deviceId) } }
                    val frame = JSONObject().put("type", "HEARTBEAT_PEERS").put("peers", idsJson).toString()
                    group.forEach { it.send(frame) }
                }
            }, 5, 5, TimeUnit.SECONDS)

            executor.execute {
                while (!ss.isClosed) {
                    try {
                        val socket = ss.accept()
                        Log.d(TAG, "relay: new client ${socket.remoteSocketAddress}")
                        val handler = ClientHandler(socket, this)
                        peers.add(handler)
                        executor.execute { handler.run() }
                    } catch (_: IOException) { }
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "relay start error: ${e.message}")
        }
    }

    fun stop() {
        Log.i(TAG, "relay stopping")
        heartbeatFuture?.cancel(false)
        try { serverSocket?.close() } catch (_: Throwable) {}
        serverSocket = null
        peers.forEach { it.close() }
        peers.clear()
        readySet.clear()
        synchronized(loopReady) { loopReady.clear() }
    }

    // ── Internal callbacks from ClientHandler ──────────────────────────────────

    fun onClientRemoved(client: ClientHandler) {
        peers.remove(client)
        readySet.remove(client)
        if (client.groupId.isNotEmpty()) sendPeersToGroup(client.groupId)
    }

    fun onRegistered(client: ClientHandler) {
        sendPeersToGroup(client.groupId)
    }

    fun onReady(client: ClientHandler) {
        if (!readySet.contains(client)) readySet.add(client)
        val group = peers.filter { it.groupId == client.groupId }
        val total = group.size
        Log.d(TAG, "relay: READY ${readySet.size}/$total group=${client.groupId}")
        if (total > 0 && readySet.size >= total) {
            readySet.clear()
            val playAt = System.currentTimeMillis() + 400
            broadcastGroup(client.groupId, JSONObject().put("type", "GO").put("playAt", playAt).toString(), null)
            Log.i(TAG, "relay: GO broadcast playAt=$playAt")
        }
    }

    fun onLoopReady(client: ClientHandler, deviceId: String, groupId: String) {
        synchronized(loopReady) {
            val set = loopReady.getOrPut(groupId) { mutableSetOf() }
            set.add(deviceId)
            val group = peers.filter { it.groupId == groupId }
            if (group.size >= 2 && set.size >= group.size) {
                loopReady[groupId] = mutableSetOf()
                val playAt = System.currentTimeMillis() + 400
                val loopGo = JSONObject().put("type", "LOOP_GO").put("playAt", playAt).toString()
                group.forEach { it.send(loopGo) }
            }
        }
    }

    fun broadcastGroup(groupId: String, msg: String, except: ClientHandler?) {
        peers.filter { it.groupId == groupId && it !== except }.forEach { it.send(msg) }
    }

    private fun sendPeersToGroup(groupId: String) {
        val group = peers.filter { it.groupId == groupId }
        val peersArr = JSONArray().apply {
            group.forEach { p ->
                put(JSONObject().put("deviceId", p.deviceId).put("ip", "").put("registeredAt", p.registeredAt))
            }
        }
        val frame = JSONObject()
            .put("type", "PEERS")
            .put("groupId", groupId)
            .put("peers", peersArr)
            .put("serverTimeMs", System.currentTimeMillis())
            .toString()
        group.forEach { it.send(frame) }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-connection handler
// ─────────────────────────────────────────────────────────────────────────────

class ClientHandler(
    private val socket: Socket,
    private val relay: SyncRelayServer,
) {
    private val out: OutputStream = socket.getOutputStream()
    private val ins = socket.getInputStream()

    var deviceId:    String = ""
    var groupId:     String = ""
    var registeredAt: Long  = 0L

    fun run() {
        try {
            doHandshake()
            frameLoop()
        } catch (_: Throwable) {
        } finally {
            relay.onClientRemoved(this)
            close()
        }
    }

    // ── RFC 6455 handshake ────────────────────────────────────────────────────

    private fun doHandshake() {
        val sb = StringBuilder()
        var b3 = -1; var b2 = -1; var b1 = -1
        while (true) {
            val b0 = ins.read()
            if (b0 < 0) throw IOException("EOF during handshake")
            sb.append(b0.toChar())
            if (b3 == '\r'.code && b2 == '\n'.code && b1 == '\r'.code && b0 == '\n'.code) break
            b3 = b2; b2 = b1; b1 = b0
        }
        val key = sb.lines()
            .firstOrNull { it.startsWith("Sec-WebSocket-Key:", ignoreCase = true) }
            ?.substringAfter(":")?.trim()
            ?: throw IOException("No Sec-WebSocket-Key")
        val accept = computeAccept(key)
        val response = "HTTP/1.1 101 Switching Protocols\r\n" +
            "Upgrade: websocket\r\n" +
            "Connection: Upgrade\r\n" +
            "Sec-WebSocket-Accept: $accept\r\n\r\n"
        out.write(response.toByteArray(Charsets.UTF_8))
        out.flush()
    }

    private fun computeAccept(key: String): String {
        val sha1 = MessageDigest.getInstance("SHA-1")
        sha1.update("${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11".toByteArray(Charsets.UTF_8))
        return Base64.encodeToString(sha1.digest(), Base64.NO_WRAP)
    }

    // ── Frame loop ────────────────────────────────────────────────────────────

    private fun frameLoop() {
        while (!socket.isClosed) {
            val msg = readFrame() ?: break
            if (msg.isNotEmpty()) dispatch(msg)
        }
    }

    private fun readFrame(): String? {
        val b0 = ins.read().takeIf { it >= 0 } ?: return null
        val b1 = ins.read().takeIf { it >= 0 } ?: return null
        val opcode = b0 and 0x0F
        val masked  = (b1 and 0x80) != 0
        var payLen  = (b1 and 0x7F).toLong()
        payLen = when (payLen.toInt()) {
            126  -> ((ins.read() shl 8) or ins.read()).toLong()
            127  -> { var v = 0L; repeat(8) { v = (v shl 8) or ins.read().toLong() }; v }
            else -> payLen
        }
        val maskKey = if (masked) ByteArray(4) { ins.read().toByte() } else null
        val payload = ByteArray(payLen.toInt())
        var off = 0
        while (off < payload.size) {
            val r = ins.read(payload, off, payload.size - off)
            if (r < 0) return null
            off += r
        }
        if (maskKey != null) {
            for (i in payload.indices) payload[i] = (payload[i].toInt() xor maskKey[i % 4].toInt()).toByte()
        }
        return when (opcode) {
            0x1  -> String(payload, Charsets.UTF_8)
            0x8  -> null
            0x9  -> { sendPong(payload); "" }
            else -> ""
        }
    }

    // ── Frame writers ─────────────────────────────────────────────────────────

    fun send(msg: String) {
        val frame = buildTextFrame(msg.toByteArray(Charsets.UTF_8))
        try { synchronized(out) { out.write(frame); out.flush() } } catch (_: Throwable) {}
    }

    private fun sendPong(payload: ByteArray) {
        try { synchronized(out) { out.write(buildFrame(0x8A, payload)); out.flush() } } catch (_: Throwable) {}
    }

    private fun buildTextFrame(payload: ByteArray) = buildFrame(0x81, payload)

    private fun buildFrame(opcode: Int, payload: ByteArray): ByteArray {
        val len = payload.size
        val header = when {
            len <= 125   -> byteArrayOf(opcode.toByte(), len.toByte())
            len <= 65535 -> byteArrayOf(opcode.toByte(), 126.toByte(), (len shr 8).toByte(), (len and 0xFF).toByte())
            else -> byteArrayOf(opcode.toByte(), 127.toByte(),
                0, 0, 0, 0,
                (len shr 24).toByte(), (len shr 16).toByte(), (len shr 8).toByte(), (len and 0xFF).toByte())
        }
        return header + payload
    }

    fun close() { try { socket.close() } catch (_: Throwable) {} }

    // ── Message dispatch (JSON protocol) ─────────────────────────────────────

    private fun dispatch(raw: String) {
        val msg = try { JSONObject(raw) } catch (_: Throwable) { return }
        when (val type = msg.optString("type")) {
            "PING" -> {
                val pong = JSONObject().put("type", "PONG").put("t1", msg.opt("t1")).put("t2", System.currentTimeMillis())
                send(pong.toString())
            }
            "WS_REGISTER" -> {
                deviceId     = msg.optString("deviceId", "anon-${System.currentTimeMillis()}")
                groupId      = msg.optString("groupId",  "default")
                registeredAt = System.currentTimeMillis()
                relay.onRegistered(this)
            }
            "READY" -> relay.onReady(this)
            "LOOP_READY" -> {
                val gid = msg.optString("groupId", groupId).ifEmpty { groupId }
                val did = msg.optString("deviceId", deviceId).ifEmpty { deviceId }
                relay.onLoopReady(this, did, gid)
            }
            else -> {
                if (type.isEmpty()) return
                // Fanout to group with `from` appended
                msg.put("from", deviceId.ifEmpty { "relay" })
                relay.broadcastGroup(groupId, msg.toString(), this)
            }
        }
    }
}

