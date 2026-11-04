package com.pingo.app.net

import android.os.Handler
import android.os.Looper
import io.socket.client.IO
import io.socket.client.Socket
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import org.json.JSONObject

/** One Socket.IO connection to the Node backend. [background] = the lightweight "push only" session used by the foreground service. */
class Realtime(private val base: String, private val tokenProvider: () -> String?, private val background: Boolean) {
    data class Event(val name: String, val data: JSONObject)

    private val _events = MutableSharedFlow<Event>(extraBufferCapacity = 512)
    val events: SharedFlow<Event> = _events
    private val _connected = MutableStateFlow(false)
    val connected: StateFlow<Boolean> = _connected
    /** Fired when the server says the saved login is no longer valid (token expired / account gone). */
    var onAuthInvalid: (() -> Unit)? = null

    private var socket: Socket? = null
    private val main = Handler(Looper.getMainLooper())
    private var retry = 0
    private var wanted = false

    private val names = listOf(
        "message:new", "message:edited", "message:deleted", "message:reaction", "message:read",
        "typing:update", "presence:update", "conversation:new", "conversation:updated", "conversation:member-left", "conversation:removed",
        "friend-request:new", "friend-request:resolved", "session:ready", "push",
        "call:incoming", "call:ringing", "call:answered", "call:ice-candidate", "call:signal", "call:media-state", "call:device",
        "call:declined", "call:ended", "call:busy", "call:unavailable", "call:timeout", "call:handled-elsewhere",
        "call:peer-reconnected", "call:peer-unstable",
    )

    @Synchronized
    fun connect() {
        wanted = true
        if (socket?.connected() == true) return
        open()
    }

    private fun open() {
        val token = tokenProvider() ?: return
        close(keepWanted = true)
        val opts = IO.Options().apply {
            forceNew = true
            reconnection = true
            reconnectionDelay = 1000
            reconnectionDelayMax = 10_000
            timeout = 20_000
            transports = arrayOf("websocket")
            auth = if (background) mapOf("token" to token, "background" to "true") else mapOf("token" to token)
        }
        val s = IO.socket(base, opts)
        names.forEach { n ->
            s.on(n) { args ->
                val o = (args.firstOrNull() as? JSONObject) ?: JSONObject()
                _events.tryEmit(Event(n, o))
            }
        }
        s.on(Socket.EVENT_CONNECT) { retry = 0; _connected.value = true }
        s.on(Socket.EVENT_DISCONNECT) { args ->
            _connected.value = false
            // The server hanging up on us is not retried by socket.io itself.
            if (args.firstOrNull()?.toString() == "io server disconnect") scheduleRetry()
        }
        s.on(Socket.EVENT_CONNECT_ERROR) { args ->
            _connected.value = false
            val msg = args.firstOrNull()?.toString().orEmpty()
            if (Regex("No token|User not found|Auth failed").containsMatchIn(msg)) {
                wanted = false
                main.post { onAuthInvalid?.invoke() }
            } else if (!s.isActive) scheduleRetry() // e.g. "Server busy" while the host wakes up
        }
        socket = s
        s.connect()
    }

    private fun scheduleRetry() {
        if (!wanted) return
        val delay = minOf(1000L shl minOf(retry++, 4), 15_000L)
        main.postDelayed({ if (wanted && socket?.connected() != true) socket?.connect() ?: open() }, delay)
    }

    fun emit(event: String, data: JSONObject = JSONObject()) {
        socket?.emit(event, data)
    }

    @Synchronized
    fun disconnect() {
        wanted = false
        close(keepWanted = false)
    }

    private fun close(keepWanted: Boolean) {
        socket?.let { it.off(); it.disconnect(); it.close() }
        socket = null
        _connected.value = false
        if (!keepWanted) main.removeCallbacksAndMessages(null)
    }
}
