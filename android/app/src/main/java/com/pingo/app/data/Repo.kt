package com.pingo.app.data

import android.content.ContentResolver
import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import com.pingo.app.crypto.E2ee
import com.pingo.app.net.Realtime
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.security.PrivateKey
import java.util.UUID

/** Single source of truth for the signed-in session, chats and messages. UI observes the StateFlows. */
class Repo(private val ctx: Context, val store: Store, val api: Api) {
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    /** The UI-process socket (live chat + call signalling). */
    val rt = Realtime(api.base, { store.token }, background = false)

    private val _me = MutableStateFlow<User?>(null)
    val me: StateFlow<User?> = _me
    private val _checking = MutableStateFlow(true)
    val checking: StateFlow<Boolean> = _checking
    private val _conversations = MutableStateFlow<List<Conversation>>(emptyList())
    val conversations: StateFlow<List<Conversation>> = _conversations
    private val _convLoading = MutableStateFlow(false)
    val convLoading: StateFlow<Boolean> = _convLoading
    private val _convError = MutableStateFlow(false)
    val convError: StateFlow<Boolean> = _convError
    private val _messages = MutableStateFlow<Map<String, List<Message>>>(emptyMap())
    val messages: StateFlow<Map<String, List<Message>>> = _messages
    private val _typing = MutableStateFlow<Map<String, Set<String>>>(emptyMap())
    val typing: StateFlow<Map<String, Set<String>>> = _typing
    /** Decrypted one-line previews for the chat list. */
    private val _previews = MutableStateFlow<Map<String, String>>(emptyMap())
    val previews: StateFlow<Map<String, String>> = _previews
    private val _authNotice = MutableStateFlow<String?>(null)
    val authNotice: StateFlow<String?> = _authNotice

    private val _calls = MutableSharedFlow<Realtime.Event>(extraBufferCapacity = 64)
    /** Call signalling events, consumed by CallEngine. */
    val callEvents: SharedFlow<Realtime.Event> = _calls

    @Volatile private var priv: PrivateKey? = null
    @Volatile var appVisible = false
    @Volatile var callActive = false
        set(v) { field = v; syncSocket() }

    val myId get() = _me.value?.id.orEmpty()

    init {
        // Load the saved identity synchronously so the background service (which can start the
        // process without any UI) can already decrypt messages for notifications.
        try {
            store.userJson?.let { _me.value = User.from(JSONObject(it)) }
            priv = store.privateD?.let { E2ee.privateKeyFromJwk(it) }
        } catch (_: Exception) {}
        rt.onAuthInvalid = { scope.launch { signOutLocal("Your session expired. Please sign in again.") } }
        scope.launch {
            rt.events.collect { handle(it) }
        }
        // Keep the UI socket up only while the app is on screen (or a call is running); the
        // foreground service's lightweight socket delivers notifications the rest of the time.
        ProcessLifecycleOwner.get().lifecycle.addObserver(object : DefaultLifecycleObserver {
            override fun onStart(owner: LifecycleOwner) { appVisible = true; syncSocket() }
            override fun onStop(owner: LifecycleOwner) { appVisible = false; syncSocket() }
        })
    }

    private fun syncSocket() {
        if (_me.value != null && (appVisible || callActive)) rt.connect() else if (!callActive) rt.disconnect()
    }

    // ------------------------------------------------------------------ session
    fun restore() {
        scope.launch {
            val tok = store.token; val u = store.userJson; val d = store.privateD
            if (tok != null && u != null) {
                try {
                    _me.value = User.from(JSONObject(u))
                    priv = d?.let { E2ee.privateKeyFromJwk(it) }
                } catch (e: Exception) { store.clearSession(); _me.value = null }
            }
            _checking.value = false
            if (_me.value != null) {
                afterSignIn()
                // Validate quietly: only a real 401/403 ends the session, a network error never does.
                try {
                    val r = api.get("/auth/me")
                    val fresh = r.getJSONObject("user")
                    fresh.optJSONObject("e2ee")?.apply { remove("wrappedPrivateKey"); remove("wrapIv"); remove("kdfSalt"); remove("kdfIterations") }
                    store.userJson = fresh.toString()
                    _me.value = User.from(fresh)
                } catch (e: ApiException) {
                    if (e.status == 401 || e.status == 403) signOutLocal("Your session expired. Please sign in again.")
                }
            }
        }
    }

    private fun wrapBody(pub: com.pingo.app.crypto.E2ee.PublicJwk, w: E2ee.WrappedPrivateKey) = JSONObject()
        .put("publicKeyJwk", JSONObject(pub.toMap()))
        .put("wrappedPrivateKey", w.wrappedPrivateKey).put("wrapIv", w.wrapIv)
        .put("kdfSalt", w.kdfSalt).put("kdfIterations", w.kdfIterations)

    suspend fun login(identifier: String, password: String) {
        val r = api.post("/auth/login", JSONObject().put("identifier", identifier).put("password", password))
        store.token = r.getString("token")
        var user = r.getJSONObject("user")
        try {
            if (r.optBoolean("needsE2EESetup") || user.optJSONObject("e2ee")?.optString("wrappedPrivateKey").isNullOrEmpty()) {
                val kp = withContext(Dispatchers.Default) { E2ee.generateIdentity() }
                val w = withContext(Dispatchers.Default) { E2ee.wrapPrivateKeyWithPassword(kp.private, kp.public, password) }
                val res = api.post("/auth/e2ee-setup", wrapBody(E2ee.publicJwk(kp.public), w))
                user = res.getJSONObject("user")
                priv = kp.private
            } else {
                val e = user.getJSONObject("e2ee")
                val w = E2ee.WrappedPrivateKey(e.getString("wrappedPrivateKey"), e.getString("wrapIv"), e.getString("kdfSalt"), e.getInt("kdfIterations"))
                priv = withContext(Dispatchers.Default) { E2ee.unwrapPrivateKeyWithPassword(password, w) }
            }
        } catch (e: Exception) {
            store.clearSession()
            throw if (e is ApiException) e else ApiException(0, "Signed in, but your encrypted chats couldn't be unlocked.")
        }
        finishSignIn(user)
    }

    suspend fun register(username: String, displayName: String, email: String, password: String) {
        val kp = withContext(Dispatchers.Default) { E2ee.generateIdentity() }
        val w = withContext(Dispatchers.Default) { E2ee.wrapPrivateKeyWithPassword(kp.private, kp.public, password) }
        val r = api.post("/auth/register", JSONObject().put("username", username).put("displayName", displayName)
            .put("email", email).put("password", password).put("e2ee", wrapBody(E2ee.publicJwk(kp.public), w)))
        store.token = r.getString("token")
        priv = kp.private
        finishSignIn(r.getJSONObject("user"))
    }

    private fun finishSignIn(user: JSONObject) {
        // The wrapped private key stays on the server; on this device only the unwrapped scalar is kept, in the Keystore-backed store.
        user.optJSONObject("e2ee")?.apply { remove("wrappedPrivateKey"); remove("wrapIv"); remove("kdfSalt"); remove("kdfIterations") }
        store.userJson = user.toString()
        store.privateD = priv?.let { E2ee.privateD(it) }
        _authNotice.value = null
        _me.value = User.from(user)
        afterSignIn()
    }

    private fun afterSignIn() {
        com.pingo.app.service.RealtimeService.startIfWanted(ctx)
        syncSocket()
        scope.launch { refreshConversations() }
    }

    suspend fun logout() {
        try { api.request("POST", "/auth/logout", JSONObject(), 0) } catch (_: Exception) {}
        signOutLocal(null)
    }

    private suspend fun signOutLocal(notice: String?) {
        rt.disconnect()
        com.pingo.app.service.RealtimeService.stop(ctx)
        store.clearSession()
        priv = null
        _conversations.value = emptyList(); _messages.value = emptyMap(); _previews.value = emptyMap()
        _authNotice.value = notice
        _me.value = null
    }

    // ------------------------------------------------------------------ conversations
    suspend fun refreshConversations() {
        _convLoading.value = _conversations.value.isEmpty()
        try {
            val arr = api.get("/conversations").getJSONArray("conversations")
            val list = (0 until arr.length()).map { Conversation.from(arr.getJSONObject(it), myId) }
            _conversations.value = list.sortedByDescending { it.lastMessageAt }
            _convError.value = false
            list.forEach { c -> c.lastMessage?.let { m -> scope.launch { setPreview(c.id, decrypt(m)) } } }
        } catch (e: Exception) {
            _convError.value = true
        } finally {
            _convLoading.value = false
        }
    }

    suspend fun openDirect(userId: String): Conversation {
        val c = Conversation.from(api.post("/conversations/direct", JSONObject().put("userId", userId)).getJSONObject("conversation"), myId)
        _conversations.update { (listOf(c) + it.filter { x -> x.id != c.id }) }
        return c
    }

    suspend fun searchUsers(q: String): List<User> {
        val arr = api.get("/users/search?q=" + java.net.URLEncoder.encode(q, "UTF-8")).optJSONArray("users") ?: JSONArray()
        return (0 until arr.length()).map { User.from(arr.getJSONObject(it)) }
    }

    private fun previewOf(m: Message): String = when {
        m.deleted -> "This message was deleted"
        m.callKind != null -> if (m.callStatus == "missed") "Missed ${m.callKind} call" else "${m.callKind!!.replaceFirstChar { it.uppercase() }} call"
        m.locked -> "🔒 Encrypted message"
        m.text.isNotBlank() -> m.text
        m.attachments.isNotEmpty() -> when (m.attachments.first().kind) { "image" -> "📷 Photo"; "video" -> "🎬 Video"; "audio" -> "🎤 Audio"; else -> "📎 File" }
        else -> ""
    }

    /** For the notification service: newest message of a chat, decrypted, so the alert shows real text. */
    suspend fun fetchForNotification(convId: String, messageId: String): Message? = try {
        val arr = api.request("GET", "/messages/$convId?limit=8", null, 1).getJSONArray("messages")
        (0 until arr.length()).map { Message.from(arr.getJSONObject(it), convId) }.firstOrNull { it.id == messageId }?.let { decrypt(it) }
    } catch (_: Exception) { null }

    fun previewText(m: Message) = previewOf(m)

    private fun setPreview(convId: String, m: Message) = _previews.update { it + (convId to previewOf(m)) }

    // ------------------------------------------------------------------ decrypt
    fun decrypt(m: Message): Message {
        if (!m.encrypted) return m
        val key = priv ?: return m.copy(locked = true)
        return try {
            val mine = m.keys.firstOrNull { it.user == myId } ?: return m.copy(locked = true)
            val sender = m.sender ?: return m.copy(locked = true)
            if (!sender.hasKey) return m.copy(locked = true)
            val mk = E2ee.unwrapMessageKey(mine.wrappedKey, mine.keyIv, key, E2ee.publicKeyFromJwk(sender.pubX!!, sender.pubY!!))
            val txt = if (m.rawText.isNotEmpty() && m.iv != null) E2ee.decryptText(mk, m.rawText, m.iv) else ""
            m.copy(text = txt, locked = false, mk = mk)
        } catch (e: Exception) {
            m.copy(locked = true)
        }
    }

    // ------------------------------------------------------------------ messages
    suspend fun loadMessages(convId: String) {
        try {
            val arr = api.get("/messages/$convId?limit=60").getJSONArray("messages")
            val list = withContext(Dispatchers.Default) { (0 until arr.length()).map { decrypt(Message.from(arr.getJSONObject(it), convId)) } }
            _messages.update { cur ->
                val pending = cur[convId].orEmpty().filter { it.id.startsWith("local-") && list.none { s -> s.clientId == it.clientId } }
                cur + (convId to (list + pending))
            }
            list.lastOrNull()?.let { setPreview(convId, it) }
        } catch (_: Exception) { /* the screen shows what it has; pull-to-refresh/reconnect retries */ }
    }

    suspend fun loadOlder(convId: String) {
        val first = _messages.value[convId]?.firstOrNull { !it.id.startsWith("local-") } ?: return
        try {
            val arr = api.get("/messages/$convId?limit=60&before=" + java.net.URLEncoder.encode(java.time.Instant.ofEpochMilli(first.createdAt).toString(), "UTF-8")).getJSONArray("messages")
            val older = withContext(Dispatchers.Default) { (0 until arr.length()).map { decrypt(Message.from(arr.getJSONObject(it), convId)) } }
            _messages.update { it + (convId to (older + it[convId].orEmpty())) }
        } catch (_: Exception) {}
    }

    private data class Envelope(val mk: ByteArray, val keys: List<E2ee.KeyEnvelope>)

    private fun envelopeFor(conv: Conversation): Envelope? {
        val key = priv ?: return null
        val recipients = LinkedHashMap<String, User>()
        for (p in conv.participants) { if (!p.hasKey) return null; recipients[p.id] = p }
        _me.value?.takeIf { it.hasKey }?.let { recipients[it.id] = it }
        val mk = E2ee.newMessageKey()
        return Envelope(mk, recipients.values.map { E2ee.wrapMessageKey(mk, key, E2ee.publicKeyFromJwk(it.pubX!!, it.pubY!!), it.id) })
    }

    suspend fun sendText(conv: Conversation, text: String, replyTo: String? = null) {
        val clean = text.trim()
        if (clean.isEmpty()) return
        send(conv, clean, emptyList(), replyTo)
    }

    suspend fun sendAttachments(conv: Conversation, uris: List<Uri>, caption: String = "") {
        val cr: ContentResolver = ctx.contentResolver
        val env = withContext(Dispatchers.Default) { envelopeFor(conv) }
        val files = ArrayList<Triple<String, String, ByteArray>>()
        val metas = ArrayList<String?>()
        for (u in uris) {
            val bytes = withContext(Dispatchers.IO) { cr.openInputStream(u)?.use { it.readBytes() } } ?: continue
            val mime = cr.getType(u) ?: "application/octet-stream"
            val name = cr.query(u, null, null, null, null)?.use { c -> if (c.moveToFirst()) c.getString(c.getColumnIndexOrThrow(OpenableColumns.DISPLAY_NAME)) else null } ?: "file"
            if (env != null) {
                val (ct, iv) = withContext(Dispatchers.Default) { E2ee.encryptBytes(env.mk, bytes) }
                files += Triple(name, mime, ct); metas += iv
            } else { files += Triple(name, mime, bytes); metas += null }
        }
        if (files.isEmpty()) return
        val atts = api.upload(files, metas)
        send(conv, caption.trim(), atts, null, env)
    }

    private suspend fun send(conv: Conversation, text: String, atts: List<Attachment>, replyTo: String?, given: Envelope? = null) {
        val clientId = UUID.randomUUID().toString()
        val localId = "local-$clientId"
        val optimistic = Message(localId, conv.id, _me.value?.let { User(it.id, it.username, it.displayName, it.avatar, it.avatarColor, it.pubX, it.pubY) },
            text, false, null, emptyList(), atts, System.currentTimeMillis(), clientId, false, null, null, 0, setOf(myId), text = text)
        _messages.update { it + (conv.id to (it[conv.id].orEmpty() + optimistic)) }
        try {
            val env = given ?: withContext(Dispatchers.Default) { envelopeFor(conv) }
            val body = JSONObject().put("clientId", clientId).put("attachments", JSONArray(atts.map { it.toJson() }))
            if (replyTo != null) body.put("replyTo", replyTo)
            if (env != null) {
                val sealed = withContext(Dispatchers.Default) { E2ee.encryptText(env.mk, text) }
                body.put("text", sealed.ciphertextB64).put("iv", sealed.ivB64).put("encrypted", true)
                    .put("keys", JSONArray(env.keys.map { JSONObject().put("user", it.user).put("wrappedKey", it.wrappedKey).put("keyIv", it.keyIv) }))
            } else body.put("text", text).put("encrypted", false)
            val saved = decrypt(Message.from(api.post("/messages/${conv.id}", body).getJSONObject("message"), conv.id))
            putMessage(saved)
        } catch (e: Exception) {
            _messages.update { cur -> cur + (conv.id to cur[conv.id].orEmpty().filterNot { it.id == localId }) }
            throw e
        }
    }

    private fun putMessage(m: Message) {
        _messages.update { cur ->
            val list = cur[m.conversationId].orEmpty()
            // Replace the optimistic copy (same clientId) or an earlier delivery of the same message.
            val without = list.filterNot { it.id == m.id || (m.clientId.isNotEmpty() && it.clientId == m.clientId && it.id.startsWith("local-")) }
            cur + (m.conversationId to (without + m).sortedBy { it.createdAt })
        }
        setPreview(m.conversationId, m)
        _conversations.update { list ->
            list.map { c ->
                if (c.id != m.conversationId) c else {
                    val incoming = m.sender?.id != myId && store.activeConversation != c.id
                    c.copy(lastMessage = m, lastMessageAt = m.createdAt, unread = if (incoming) c.unread + 1 else c.unread)
                }
            }.sortedByDescending { it.lastMessageAt }
        }
    }

    fun setActive(convId: String) { store.activeConversation = convId }

    suspend fun markRead(convId: String) {
        _conversations.update { l -> l.map { if (it.id == convId) it.copy(unread = 0) else it } }
        com.pingo.app.notify.Notifier.clearConversation(ctx, convId)
        try { api.request("POST", "/messages/$convId/read", JSONObject(), 0) } catch (_: Exception) {}
    }

    fun typing(convId: String, on: Boolean) = rt.emit(if (on) "typing:start" else "typing:stop", JSONObject().put("conversationId", convId))

    /** Fetches and (if encrypted) decrypts one attachment. */
    suspend fun attachmentBytes(m: Message, a: Attachment): ByteArray {
        val raw = api.download(a.url)
        val mk = m.mk
        return if (a.encrypted && a.iv != null && mk != null) withContext(Dispatchers.Default) { E2ee.decryptBytes(mk, raw, a.iv) } else raw
    }

    // ------------------------------------------------------------------ realtime
    private suspend fun handle(e: Realtime.Event) {
        val d = e.data
        when (e.name) {
            "message:new" -> {
                val m = withContext(Dispatchers.Default) { decrypt(Message.from(d)) }
                if (_conversations.value.none { it.id == m.conversationId }) refreshConversations()
                putMessage(m)
                if (store.activeConversation == m.conversationId && appVisible && m.sender?.id != myId) markRead(m.conversationId)
            }
            "message:deleted", "message:edited" -> {
                val id = d.optString("_id", d.optString("messageId"))
                val conv = d.optString("conversation", d.optString("conversationId"))
                if (conv.isNotEmpty()) loadMessages(conv) else if (id.isNotEmpty()) _messages.value.keys.forEach { loadMessages(it) }
            }
            "message:read" -> {
                val conv = d.optString("conversationId"); val uid = d.optString("userId")
                _messages.update { cur -> cur + (conv to cur[conv].orEmpty().map { it.copy(readBy = it.readBy + uid) }) }
            }
            "typing:update" -> {
                val conv = d.optString("conversationId"); val uid = d.optString("userId")
                _typing.update { cur -> cur + (conv to if (d.optBoolean("typing")) cur[conv].orEmpty() + uid else cur[conv].orEmpty() - uid) }
            }
            "conversation:new", "conversation:updated", "conversation:removed", "conversation:member-left" -> refreshConversations()
            "session:ready" -> {
                refreshConversations()
                store.activeConversation.takeIf { it.isNotEmpty() }?.let { loadMessages(it) }
            }
            else -> if (e.name.startsWith("call:")) _calls.tryEmit(e)
        }
    }

    // ------------------------------------------------------------------ small helpers for UI
    fun conversation(id: String) = _conversations.value.firstOrNull { it.id == id }
    suspend fun retryDelay(ms: Long) = delay(ms)
}
