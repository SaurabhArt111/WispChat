package com.wispchat.app.data

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import com.wispchat.app.crypto.E2ee
import com.wispchat.app.net.Realtime
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.security.PrivateKey
import java.util.UUID

/**
 * Single source of truth, OFFLINE-FIRST: every screen is fed from the on-device database
 * ([LocalDb]) and media folder ([MediaCache]); the network only refreshes them in the background.
 * With no internet the app opens instantly with all chats, messages and downloaded media, and
 * anything typed meanwhile waits in the outbox and is sent automatically when the phone is back online.
 */
class Repo(
    private val ctx: Context, val store: Store, val api: Api,
    val db: LocalDb, val media: MediaCache, val net: Net, val settings: Settings,
) {
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
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
    private val _previews = MutableStateFlow<Map<String, String>>(emptyMap())
    val previews: StateFlow<Map<String, String>> = _previews
    private val _authNotice = MutableStateFlow<String?>(null)
    val authNotice: StateFlow<String?> = _authNotice
    /** Bumped whenever a media file finishes downloading / is removed, so bubbles refresh. */
    private val _mediaTick = MutableStateFlow(0)
    val mediaTick: StateFlow<Int> = _mediaTick

    data class Presence(val online: Boolean, val lastSeen: Long)
    private val _presence = MutableStateFlow<Map<String, Presence>>(emptyMap())
    val presence: StateFlow<Map<String, Presence>> = _presence
    /** Latest known presence of a person: live socket updates win over what the conversation list said. */
    fun presenceOf(u: User): Presence = _presence.value[u.id] ?: Presence(u.isOnline, u.lastSeen)

    /** Everything that is not chats: status, Explore, call log, contacts, friend requests. */
    val social: Social by lazy { Social(this) }

    private val _calls = MutableSharedFlow<Realtime.Event>(extraBufferCapacity = 64)
    val callEvents: SharedFlow<Realtime.Event> = _calls

    @Volatile private var priv: PrivateKey? = null
    @Volatile var appVisible = false
    @Volatile var callActive = false
        set(v) { field = v; syncSocket() }

    private val outboxLock = Mutex()
    private val downloading = HashSet<String>()
    private val outboxDir = File(ctx.filesDir, "outbox").apply { mkdirs() }

    val myId get() = _me.value?.id.orEmpty()
    val appContext: Context get() = ctx

    init {
        try {
            store.userJson?.let { _me.value = User.from(JSONObject(it)) }
            priv = store.privateD?.let { E2ee.privateKeyFromJwk(it) }
        } catch (_: Exception) {}
        rt.onAuthInvalid = { scope.launch { signOutLocal("Your session expired. Please sign in again.", wipe = false) } }
        scope.launch { rt.events.collect { handle(it) } }
        net.onBackOnline = { scope.launch { syncNow() } }
        ProcessLifecycleOwner.get().lifecycle.addObserver(object : DefaultLifecycleObserver {
            override fun onStart(owner: LifecycleOwner) { appVisible = true; syncSocket() }
            override fun onStop(owner: LifecycleOwner) { appVisible = false; syncSocket() }
        })
        // Show the cached chat list immediately — before (and regardless of) any network call.
        if (_me.value != null) scope.launch { loadConversationsFromDb() }
    }

    private fun syncSocket() {
        if (_me.value != null && (appVisible || callActive)) rt.connect() else if (!callActive) rt.disconnect()
    }

    /** Everything that should happen as soon as we're online again. */
    suspend fun syncNow() {
        if (_me.value == null) return
        refreshConversations()
        flushOutbox()
        store.activeConversation.takeIf { it.isNotEmpty() }?.let { loadMessages(it) }
    }

    // ------------------------------------------------------------------ session
    fun restore() {
        scope.launch {
            val tok = store.token
            if (tok != null && _me.value == null) {
                try {
                    _me.value = store.userJson?.let { User.from(JSONObject(it)) }
                    priv = store.privateD?.let { E2ee.privateKeyFromJwk(it) }
                } catch (e: Exception) { store.clearSession(); _me.value = null }
            }
            _checking.value = false
            if (_me.value != null) {
                afterSignIn()
                try { // quiet validation: only a real 401/403 ends the session; being offline never does
                    val fresh = api.get("/auth/me").getJSONObject("user")
                    fresh.optJSONObject("e2ee")?.apply { remove("wrappedPrivateKey"); remove("wrapIv"); remove("kdfSalt"); remove("kdfIterations") }
                    store.userJson = fresh.toString()
                    _me.value = User.from(fresh)
                } catch (e: ApiException) {
                    if (e.status == 401 || e.status == 403) signOutLocal("Your session expired. Please sign in again.", wipe = false)
                }
            }
        }
    }

    private fun wrapBody(pub: E2ee.PublicJwk, w: E2ee.WrappedPrivateKey) = JSONObject()
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
                user = api.post("/auth/e2ee-setup", wrapBody(E2ee.publicJwk(kp.public), w)).getJSONObject("user")
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

    private suspend fun finishSignIn(user: JSONObject) {
        user.optJSONObject("e2ee")?.apply { remove("wrappedPrivateKey"); remove("wrapIv"); remove("kdfSalt"); remove("kdfIterations") }
        // A different person on this phone must never see the previous account's cached data.
        val id = user.optString("_id")
        if (store.lastUserId != null && store.lastUserId != id) wipeLocalData()
        store.lastUserId = id
        store.userJson = user.toString()
        store.privateD = priv?.let { E2ee.privateD(it) }
        _authNotice.value = null
        _me.value = User.from(user)
        afterSignIn()
    }

    private fun afterSignIn() {
        com.wispchat.app.service.RealtimeService.startIfWanted(ctx)
        com.wispchat.app.notify.PushRegistrar.register(this)
        social.onSignedIn()
        syncSocket()
        scope.launch { if (_conversations.value.isEmpty()) loadConversationsFromDb(); refreshConversations(); flushOutbox() }
    }

    /** Explicit sign-out: also removes this account's downloaded data from the phone. */
    suspend fun logout() {
        try { api.request("POST", "/auth/logout", JSONObject(), 0) } catch (_: Exception) {}
        signOutLocal(null, wipe = true)
    }

    private suspend fun signOutLocal(notice: String?, wipe: Boolean) {
        rt.disconnect()
        com.wispchat.app.service.RealtimeService.stop(ctx)
        com.wispchat.app.notify.PushRegistrar.unregister(this)
        social.onSignedOut()
        store.clearSession()
        priv = null
        if (wipe) { wipeLocalData(); store.lastUserId = null }
        _conversations.value = emptyList(); _messages.value = emptyMap(); _previews.value = emptyMap()
        _authNotice.value = notice
        _me.value = null
    }

    private suspend fun wipeLocalData() {
        media.clearAll(); db.wipe(); outboxDir.listFiles()?.forEach { it.delete() }
    }

    // ------------------------------------------------------------------ conversations
    private suspend fun loadConversationsFromDb() {
        val rows = db.loadConversations()
        if (rows.isEmpty() || _conversations.value.isNotEmpty()) return
        _conversations.value = rows.map { Conversation.from(it, myId) }
        _conversations.value.forEach { c -> c.lastMessage?.let { m -> setPreview(c.id, decrypt(m)) } }
    }

    suspend fun refreshConversations() {
        _convLoading.value = _conversations.value.isEmpty()
        try {
            val arr = api.request("GET", "/conversations", null, if (net.online) 4 else 0).getJSONArray("conversations")
            val raws = (0 until arr.length()).map { arr.getJSONObject(it) }
            val list = raws.map { Conversation.from(it, myId) }
            _conversations.value = list.sortedByDescending { it.lastMessageAt }
            _convError.value = false
            db.saveConversations(list.zip(raws).map { (c, r) -> Triple(c.id, c.lastMessageAt, r) })
            list.forEach { c -> c.lastMessage?.let { m -> setPreview(c.id, decrypt(m)) } }
        } catch (e: Exception) {
            _convError.value = _conversations.value.isEmpty() // cached chats are shown, so this is not an error screen
        } finally { _convLoading.value = false }
    }

    suspend fun openDirect(userId: String): Conversation {
        val c = Conversation.from(api.post("/conversations/direct", JSONObject().put("userId", userId)).getJSONObject("conversation"), myId)
        _conversations.update { listOf(c) + it.filter { x -> x.id != c.id } }
        return c
    }

    suspend fun searchUsers(q: String): List<User> {
        val arr = api.get("/users/search?q=" + java.net.URLEncoder.encode(q, "UTF-8")).optJSONArray("users") ?: JSONArray()
        return (0 until arr.length()).map { User.from(arr.getJSONObject(it)) }
    }

    private fun previewOf(m: Message): String = when {
        m.deleted -> "This message was deleted"
        m.statusReply != null -> if (m.statusReply.isReaction) "Reacted to a status" else "Replied to a status"
        m.callKind != null -> if (m.callStatus == "missed") "Missed ${m.callKind} call" else "${m.callKind!!.replaceFirstChar { it.uppercase() }} call"
        m.locked -> "🔒 Encrypted message"
        m.text.isNotBlank() -> m.text
        m.attachments.isNotEmpty() -> when (m.attachments.first().kind) { "image" -> "📷 Photo"; "video" -> "🎬 Video"; "audio" -> "🎤 Audio"; else -> "📎 File" }
        else -> ""
    }
    fun previewText(m: Message) = previewOf(m)
    private fun setPreview(convId: String, m: Message) = _previews.update { it + (convId to previewOf(m)) }

    suspend fun fetchForNotification(convId: String, messageId: String): Message? = try {
        val arr = api.request("GET", "/messages/$convId?limit=8", null, 1).getJSONArray("messages")
        (0 until arr.length()).map { Message.from(arr.getJSONObject(it), convId) }.firstOrNull { it.id == messageId }?.let { decrypt(it) }
    } catch (_: Exception) { null }

    // ------------------------------------------------------------------ decrypt
    fun decrypt(m: Message): Message {
        val out = decryptCore(m)
        val r = m.replyTo ?: return out
        return out.copy(replyTo = decryptCore(r))
    }

    private fun decryptCore(m: Message): Message {
        if (!m.encrypted) return m
        val key = priv ?: return m.copy(locked = true)
        return try {
            val mine = m.keys.firstOrNull { it.user == myId } ?: return m.copy(locked = true)
            val sender = m.sender ?: return m.copy(locked = true)
            if (!sender.hasKey) return m.copy(locked = true)
            val mk = E2ee.unwrapMessageKey(mine.wrappedKey, mine.keyIv, key, E2ee.publicKeyFromJwk(sender.pubX!!, sender.pubY!!))
            val txt = if (m.rawText.isNotEmpty() && m.iv != null) E2ee.decryptText(mk, m.rawText, m.iv) else ""
            m.copy(text = txt, locked = false, mk = mk)
        } catch (e: Exception) { m.copy(locked = true) }
    }

    // ------------------------------------------------------------------ messages (local first)
    private suspend fun fromRows(conv: String, rows: List<JSONObject>): List<Message> =
        withContext(Dispatchers.Default) { rows.map { decrypt(Message.from(it, conv)) } }

    /** Pending/failed messages from the outbox, shaped like normal messages so they appear in the chat. */
    private suspend fun pendingMessages(conv: String): List<Message> = withContext(Dispatchers.Default) {
        val meJson = store.userJson?.let { JSONObject(it) } ?: return@withContext emptyList()
        db.outbox(conv).map { row ->
            val j = JSONObject(row.body.toString())
            j.put("_id", "local-" + row.clientId).put("conversation", conv).put("sender", meJson)
                .put("createdAt", java.time.Instant.ofEpochMilli(row.createdAt).toString())
            if (row.kind == "media") {
                val atts = JSONArray()
                row.files.forEach { f ->
                    val p = f.split("\t")
                    atts.put(JSONObject().put("url", "outbox:" + p[0]).put("name", p.getOrElse(1) { "file" }).put("mimeType", p.getOrElse(2) { "" }).put("kind", p.getOrElse(3) { "file" }).put("encrypted", false))
                }
                j.put("attachments", atts)
            }
            val rid = j.optString("replyTo"); j.remove("replyTo")
            val quoted = if (rid.isNotEmpty()) _messages.value[conv]?.firstOrNull { it.id == rid } else null
            decrypt(Message.from(j, conv)).copy(sendState = if (row.failed) 2 else 1, replyTo = quoted)
        }
    }

    /** Opens a chat: shows what's on the phone immediately, then refreshes from the server if reachable. */
    suspend fun loadMessages(convId: String) {
        val local = fromRows(convId, db.loadMessages(convId, 80))
        publish(convId, local)
        local.lastOrNull()?.let { setPreview(convId, it) }
        autoDownload(local)
        try {
            val arr = api.request("GET", "/messages/$convId?limit=60", null, if (net.online) 3 else 0).getJSONArray("messages")
            val raws = (0 until arr.length()).map { arr.getJSONObject(it) }.filterNot { db.isHidden(it.optString("_id")) }
            db.saveMessages(convId, raws)
            val merged = fromRows(convId, db.loadMessages(convId, maxOf(80, local.size)))
            publish(convId, merged)
            merged.lastOrNull()?.let { setPreview(convId, it) }
            autoDownload(merged)
        } catch (_: Exception) { /* offline: the on-device copy is already on screen */ }
    }

    private suspend fun publish(convId: String, serverMessages: List<Message>) {
        val pending = pendingMessages(convId)
        _messages.update { it + (convId to (serverMessages + pending).sortedBy { m -> m.createdAt }) }
    }

    suspend fun loadOlder(convId: String) {
        val first = _messages.value[convId]?.firstOrNull { !it.id.startsWith("local-") } ?: return
        var rows = db.loadMessages(convId, 40, first.createdAt)
        if (rows.size < 40 && net.online) {
            try {
                val arr = api.get("/messages/$convId?limit=60&before=" + java.net.URLEncoder.encode(java.time.Instant.ofEpochMilli(first.createdAt).toString(), "UTF-8")).getJSONArray("messages")
                db.saveMessages(convId, (0 until arr.length()).map { arr.getJSONObject(it) }.filterNot { db.isHidden(it.optString("_id")) })
                rows = db.loadMessages(convId, 40, first.createdAt)
            } catch (_: Exception) {}
        }
        val older = fromRows(convId, rows)
        _messages.update { it + (convId to (older + it[convId].orEmpty()).distinctBy { m -> m.id }) }
    }

    // ---- sending: always through the outbox, so it works with or without internet ----
    private data class Envelope(val mk: ByteArray, val keys: List<E2ee.KeyEnvelope>)

    private fun conversationOrNull(id: String) = _conversations.value.firstOrNull { it.id == id }

    private fun envelopeFor(conv: Conversation): Envelope? {
        val key = priv ?: return null
        val recipients = LinkedHashMap<String, User>()
        for (p in conv.participants) { if (!p.hasKey) return null; recipients[p.id] = p }
        _me.value?.takeIf { it.hasKey }?.let { recipients[it.id] = it }
        val mk = E2ee.newMessageKey()
        return Envelope(mk, recipients.values.map { E2ee.wrapMessageKey(mk, key, E2ee.publicKeyFromJwk(it.pubX!!, it.pubY!!), it.id) })
    }

    private fun sealBody(clientId: String, env: Envelope?, text: String, replyTo: String?, statusReplyId: String? = null, statusReaction: Boolean = false): JSONObject {
        val body = JSONObject().put("clientId", clientId)
        if (replyTo != null) body.put("replyTo", replyTo)
        if (statusReplyId != null) body.put("statusReplyId", statusReplyId).put("statusReplyIsReaction", statusReaction)
        if (env != null) {
            val sealed = E2ee.encryptText(env.mk, text)
            body.put("text", sealed.ciphertextB64).put("iv", sealed.ivB64).put("encrypted", true)
                .put("keys", JSONArray(env.keys.map { JSONObject().put("user", it.user).put("wrappedKey", it.wrappedKey).put("keyIv", it.keyIv) }))
        } else body.put("text", text).put("encrypted", false)
        return body
    }

    suspend fun sendText(conv: Conversation, text: String, replyTo: String? = null, statusReplyId: String? = null, statusReaction: Boolean = false) {
        val clean = text.trim(); if (clean.isEmpty()) return
        val clientId = UUID.randomUUID().toString()
        val body = withContext(Dispatchers.Default) { sealBody(clientId, envelopeFor(conv), clean, replyTo, statusReplyId, statusReaction) }
        body.put("attachments", JSONArray())
        db.putOutbox(LocalDb.OutboxRow(clientId, conv.id, System.currentTimeMillis(), "text", body, emptyList(), false))
        publish(conv.id, _messages.value[conv.id].orEmpty().filterNot { it.sendState != 0 })
        flushOutbox()
    }

    /** One file waiting to be sent: already copied into private storage. */
    private data class OutItem(val file: File, val name: String, val mime: String, val kind: String)

    private fun kindOf(mime: String) = when { mime.startsWith("image/") -> "image"; mime.startsWith("video/") -> "video"; mime.startsWith("audio/") -> "audio"; else -> "file" }

    suspend fun sendAttachments(conv: Conversation, uris: List<Uri>, caption: String = "", replyTo: String? = null) {
        val cr = ctx.contentResolver
        val items = ArrayList<OutItem>()
        for (u in uris) {
            val mime = cr.getType(u) ?: "application/octet-stream"
            val name = cr.query(u, null, null, null, null)?.use { c -> if (c.moveToFirst()) c.getString(c.getColumnIndexOrThrow(OpenableColumns.DISPLAY_NAME)) else null } ?: "file"
            // Copy into private storage right away: the picker's Uri may stop working before we're back online.
            val dest = File(outboxDir, UUID.randomUUID().toString())
            withContext(Dispatchers.IO) { cr.openInputStream(u)?.use { i -> dest.outputStream().use { o -> i.copyTo(o) } } }
            if (dest.length() > 0) items += OutItem(dest, name, mime, kindOf(mime))
        }
        enqueueMedia(conv, items, caption, replyTo)
    }

    /** Sends a file we produced ourselves (voice note, camera photo): it is moved into the outbox. */
    suspend fun sendFile(conv: Conversation, file: File, name: String, mime: String, caption: String = "", replyTo: String? = null) {
        if (!file.exists() || file.length() == 0L) return
        val dest = File(outboxDir, UUID.randomUUID().toString())
        withContext(Dispatchers.IO) { file.copyTo(dest, overwrite = true); file.delete() }
        enqueueMedia(conv, listOf(OutItem(dest, name, mime, kindOf(mime))), caption, replyTo)
    }

    private suspend fun enqueueMedia(conv: Conversation, items: List<OutItem>, caption: String, replyTo: String?) {
        if (items.isEmpty()) return
        val clientId = UUID.randomUUID().toString()
        val files = items.map { listOf(it.file.absolutePath, it.name, it.mime, it.kind).joinToString("\t") }
        val body = withContext(Dispatchers.Default) { sealBody(clientId, envelopeFor(conv), caption.trim(), replyTo) }
        db.putOutbox(LocalDb.OutboxRow(clientId, conv.id, System.currentTimeMillis(), "media", body, files, false))
        publish(conv.id, _messages.value[conv.id].orEmpty().filter { it.sendState == 0 })
        flushOutbox()
    }

    /** Sends everything waiting in the outbox, oldest first. Safe to call any time; stops quietly while offline. */
    suspend fun flushOutbox() {
        if (!net.online || _me.value == null) return
        outboxLock.withLock {
            for (row in db.outbox()) {
                if (row.failed) continue
                try {
                    val conv = conversationOrNull(row.conv) ?: run { refreshConversations(); conversationOrNull(row.conv) } ?: continue
                    val body = JSONObject(row.body.toString())
                    if (row.kind == "media") {
                        val env = withContext(Dispatchers.Default) { envelopeFor(conv) }
                        val up = ArrayList<Triple<String, String, ByteArray>>(); val metas = ArrayList<String?>(); val kinds = ArrayList<String>()
                        for (f in row.files) {
                            val p = f.split("\t")
                            val bytes = withContext(Dispatchers.IO) { File(p[0]).readBytes() }
                            if (env != null) { val (ct, iv) = withContext(Dispatchers.Default) { E2ee.encryptBytes(env.mk, bytes) }; up += Triple(p[1], p[2], ct); metas += iv }
                            else { up += Triple(p[1], p[2], bytes); metas += null }
                        }
                        val atts = api.upload(up, metas)
                        body.put("attachments", JSONArray(atts.map { it.toJson() }))
                        // the caption must be sealed with the SAME key that encrypted the files
                        if (env != null) {
                            val caption = decrypt(Message.from(JSONObject(row.body.toString()).put("sender", JSONObject(store.userJson!!)), row.conv)).text
                            val sealed = E2ee.encryptText(env.mk, caption)
                            body.put("text", sealed.ciphertextB64).put("iv", sealed.ivB64).put("encrypted", true)
                                .put("keys", JSONArray(env.keys.map { JSONObject().put("user", it.user).put("wrappedKey", it.wrappedKey).put("keyIv", it.keyIv) }))
                        }
                    }
                    val saved = api.request("POST", "/messages/${row.conv}", body, 0).getJSONObject("message")
                    db.saveMessages(row.conv, listOf(saved))
                    db.removeOutbox(row.clientId)
                    row.files.forEach { File(it.split("\t")[0]).delete() }
                    val m = decrypt(Message.from(saved, row.conv))
                    putMessage(m, saved)
                } catch (e: ApiException) {
                    if (e.transient || e.status == 0) return // still no usable connection: keep waiting
                    db.putOutbox(row.copy(failed = true)) // the server rejected it: let the person retry or delete
                    publish(row.conv, _messages.value[row.conv].orEmpty().filter { it.sendState == 0 })
                } catch (e: Exception) { return }
            }
        }
    }

    suspend fun retryFailed(clientId: String) {
        db.outbox().firstOrNull { it.clientId == clientId }?.let { db.putOutbox(it.copy(failed = false)); publish(it.conv, _messages.value[it.conv].orEmpty().filter { m -> m.sendState == 0 }) }
        flushOutbox()
    }

    /** Cancels a message that hasn't been sent yet. */
    suspend fun cancelPending(m: Message) {
        val row = db.outbox().firstOrNull { "local-" + it.clientId == m.id } ?: return
        db.removeOutbox(row.clientId); row.files.forEach { File(it.split("\t")[0]).delete() }
        _messages.update { cur -> cur + (m.conversationId to cur[m.conversationId].orEmpty().filterNot { it.id == m.id }) }
    }

    private suspend fun putMessage(m: Message, raw: JSONObject?) {
        if (db.isHidden(m.id)) return
        _messages.update { cur ->
            val list = cur[m.conversationId].orEmpty()
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
        autoDownload(listOf(m))
    }

    fun setActive(convId: String) { store.activeConversation = convId }

    suspend fun markRead(convId: String) {
        _conversations.update { l -> l.map { if (it.id == convId) it.copy(unread = 0) else it } }
        com.wispchat.app.notify.Notifier.clearConversation(ctx, convId)
        if (net.online) try { api.request("POST", "/messages/$convId/read", JSONObject(), 0) } catch (_: Exception) {}
    }

    fun typing(convId: String, on: Boolean) = rt.emit(if (on) "typing:start" else "typing:stop", JSONObject().put("conversationId", convId))

    // ------------------------------------------------------------------ media
    /** Readable bytes of an attachment: from the phone if present, otherwise downloaded once and kept. */
    suspend fun attachmentBytes(m: Message, a: Attachment): ByteArray {
        if (a.url.startsWith("outbox:")) return withContext(Dispatchers.IO) { File(a.url.removePrefix("outbox:")).readBytes() }
        val raw = media.bytes(m.conversationId, m.id, a)
        _mediaTick.update { it + 1 }
        maybeSaveToGallery(a, media.plain(raw, a, m.mk))
        return media.plain(raw, a, m.mk)
    }

    fun isDownloaded(a: Attachment) = a.url.startsWith("outbox:") || media.isCached(a.url)

    private suspend fun maybeSaveToGallery(a: Attachment, plain: ByteArray) {
        if (!settings.saveToGallery.value || !(a.kind == "image" || a.kind == "video")) return
        if (db.mediaRow(a.url)?.galleryUri != null) return
        media.saveToDevice(a.url, a.name, a.mimeType, plain)
    }

    /** Honours Settings → Storage and data → "Media auto-download" for the current kind of network. */
    private fun autoDownload(list: List<Message>) {
        val kind = net.kind.value
        if (kind == Net.Kind.NONE) return
        for (m in list) for (a in m.attachments) {
            if (a.url.startsWith("outbox:") || media.isCached(a.url) || m.deleted) continue
            if (!media.autoAllowed(a, kind)) continue
            if (!synchronized(downloading) { downloading.add(a.url) }) continue
            scope.launch {
                try { attachmentBytes(m, a) } catch (_: Exception) {} finally { synchronized(downloading) { downloading.remove(a.url) } }
            }
        }
    }

    /** Person tapped "download" on an attachment that wasn't auto-downloaded. */
    suspend fun downloadNow(m: Message, a: Attachment) { attachmentBytes(m, a) }

    /** Save a readable copy to Gallery / Downloads. */
    suspend fun saveAttachmentToDevice(m: Message, a: Attachment): Boolean {
        val plain = attachmentBytes(m, a)
        return media.saveToDevice(a.url, a.name, a.mimeType, plain) != null
    }

    // ------------------------------------------------------------------ deleting (message and/or device copy)
    /** "Delete for me": the message disappears here and stays gone; others keep it. [alsoMedia] also frees the files on this phone. */
    suspend fun deleteForMe(m: Message, alsoMedia: Boolean) {
        if (m.sendState != 0) { cancelPending(m); return }
        if (alsoMedia) media.deleteFiles(m.attachments.map { it.url }, alsoGallery = true)
        db.hideMessage(m.id)
        _messages.update { cur -> cur + (m.conversationId to cur[m.conversationId].orEmpty().filterNot { it.id == m.id }) }
        _mediaTick.update { it + 1 }
        if (net.online) try { api.request("DELETE", "/messages/msg/${m.id}", JSONObject().put("forEveryone", false), 0) } catch (_: Exception) {}
    }

    /** "Delete for everyone" (own messages, needs internet). */
    suspend fun deleteForEveryone(m: Message, alsoMedia: Boolean) {
        api.request("DELETE", "/messages/msg/${m.id}", JSONObject().put("forEveryone", true), 0)
        if (alsoMedia) media.deleteFiles(m.attachments.map { it.url }, alsoGallery = true)
        markDeletedLocally(m.id, m.conversationId)
    }

    /** Keeps the message but removes its files from this phone (they can be downloaded again while still on the server). */
    suspend fun removeMediaOnly(m: Message, alsoGallery: Boolean) {
        media.deleteFiles(m.attachments.map { it.url }, alsoGallery)
        _mediaTick.update { it + 1 }
    }

    private suspend fun markDeletedLocally(id: String, conv: String) {
        db.messageJson(id)?.let { j -> j.put("deletedForEveryone", true).put("text", "").put("attachments", JSONArray()); db.saveMessages(conv, listOf(j)) }
        _messages.update { cur -> cur + (conv to cur[conv].orEmpty().map { if (it.id == id) it.copy(deleted = true, text = "", attachments = emptyList()) else it }) }
    }

    suspend fun clearChat(convId: String, alsoMedia: Boolean) {
        if (alsoMedia) media.clearConversation(convId, alsoGallery = false)
        db.clearConversationMessages(convId)
        _messages.update { it + (convId to emptyList()) }
        _previews.update { it + (convId to "") }
        _mediaTick.update { it + 1 }
    }

    // ------------------------------------------------------------------ storage + blocked (settings)
    data class ChatStorage(val convId: String, val title: String, val bytes: Long, val files: Int)

    suspend fun storageByChat(): List<ChatStorage> {
        val all = db.allMedia().groupBy { it.conv }
        return all.map { (conv, rows) ->
            ChatStorage(conv, conversationOrNull(conv)?.title(myId) ?: "Chat", rows.sumOf { media.file(it.url).length() }, rows.size)
        }.filter { it.bytes > 0 }.sortedByDescending { it.bytes }
    }

    suspend fun blocked(): List<User> {
        val arr = api.get("/users/blocked").optJSONArray("blocked") ?: JSONArray()
        return (0 until arr.length()).map { User.from(arr.getJSONObject(it)) }
    }
    suspend fun toggleBlock(userId: String) { api.post("/users/block/$userId") }

    // ------------------------------------------------------------------ realtime
    private suspend fun handle(e: Realtime.Event) {
        val d = e.data
        when (e.name) {
            "message:new" -> {
                val m = withContext(Dispatchers.Default) { decrypt(Message.from(d)) }
                if (_conversations.value.none { it.id == m.conversationId }) refreshConversations()
                if (db.isHidden(m.id)) return
                db.saveMessages(m.conversationId, listOf(d))
                putMessage(m, d)
                if (m.isCall) social.recordCall(d)
                if (store.activeConversation == m.conversationId && appVisible && m.sender?.id != myId) markRead(m.conversationId)
            }
            "message:edited", "message:reaction" -> {
                val m = withContext(Dispatchers.Default) { decrypt(Message.from(d)) }
                replaceMessage(m, d)
            }
            "conversation:flags" -> applyFlags(d.optString("conversationId"), d.optJSONObject("patch") ?: JSONObject())
            "conversation:cleared" -> d.optString("conversationId").takeIf { it.isNotEmpty() }?.let { clearChat(it, alsoMedia = false) }
            "presence:update" -> {
                val uid = d.optString("userId")
                if (uid.isNotEmpty()) _presence.update { it + (uid to Presence(d.optBoolean("isOnline"), if (d.has("lastSeen")) isoToMillis(d.optString("lastSeen")) else System.currentTimeMillis())) }
            }
            "user:updated" -> d.optJSONObject("user")?.let { applyUserUpdate(it) }
            "me:updated" -> d.optJSONObject("user")?.let { applyMeUpdate(it) }
            "message:deleted" -> {
                val id = d.optString("id", d.optString("_id")); val everyone = d.optBoolean("forEveryone")
                val conv = _messages.value.entries.firstOrNull { en -> en.value.any { it.id == id } }?.key
                if (conv != null) {
                    if (everyone) markDeletedLocally(id, conv)
                    else { db.hideMessage(id); _messages.update { cur -> cur + (conv to cur[conv].orEmpty().filterNot { it.id == id }) } }
                }
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
            "session:ready" -> syncNow()
            "status:changed", "post:new", "post:stats", "post:comment", "post:comment-deleted", "post:comment-updated",
            "post:deleted", "post:updated", "post:liked", "post:commented", "contacts:changed",
            "friend-request:new", "friend-request:resolved", "friend-request:changed" -> social.handle(e)
            else -> if (e.name.startsWith("call:")) _calls.tryEmit(e)
        }
    }

    fun conversation(id: String) = _conversations.value.firstOrNull { it.id == id }

    // ------------------------------------------------------------------ message updates (edit / react)
    /** Swaps one message in the open list (and the on-device copy) without touching chat ordering or unread counts. */
    private suspend fun replaceMessage(m: Message, raw: JSONObject?) {
        if (db.isHidden(m.id)) return
        raw?.let { db.saveMessages(m.conversationId, listOf(it)) }
        _messages.update { cur ->
            val list = cur[m.conversationId] ?: return@update cur
            if (list.none { it.id == m.id }) cur else cur + (m.conversationId to list.map { if (it.id == m.id) m.copy(sendState = 0) else it })
        }
        _conversations.update { l -> l.map { c -> if (c.id == m.conversationId && c.lastMessage?.id == m.id) c.copy(lastMessage = m) else c } }
        if (_conversations.value.firstOrNull { it.id == m.conversationId }?.lastMessage?.id == m.id) setPreview(m.conversationId, m)
    }

    private fun patchMessage(conv: String, id: String, f: (Message) -> Message) =
        _messages.update { cur -> val l = cur[conv] ?: return@update cur; cur + (conv to l.map { if (it.id == id) f(it) else it }) }

    suspend fun react(m: Message, emoji: String) {
        if (m.sendState != 0) return
        val before = m.reactions
        val mine = before.firstOrNull { it.userId == myId }
        val myName = _me.value?.displayName.orEmpty()
        val next = if (mine?.emoji == emoji) before.filter { it.userId != myId } else before.filter { it.userId != myId } + Reaction(myId, myName, emoji)
        patchMessage(m.conversationId, m.id) { it.copy(reactions = next) }
        try { api.request("POST", "/messages/msg/${m.id}/react", JSONObject().put("emoji", emoji), 0) }
        catch (e: Exception) { patchMessage(m.conversationId, m.id) { it.copy(reactions = before) }; throw e }
    }

    /** Edit your own message. The new text is sealed with the message's existing key, so attached files stay readable. */
    suspend fun edit(m: Message, newText: String) {
        val clean = newText.trim(); if (clean.isEmpty()) return
        val body = JSONObject()
        if (m.encrypted) {
            val mk = m.mk ?: throw ApiException(0, "This message can't be edited on this device.")
            val sealed = E2ee.encryptText(mk, clean)
            body.put("text", sealed.ciphertextB64).put("iv", sealed.ivB64).put("encrypted", true)
                .put("keys", JSONArray(m.keys.map { JSONObject().put("user", it.user).put("wrappedKey", it.wrappedKey).put("keyIv", it.keyIv) }))
        } else body.put("text", clean)
        val saved = api.request("PATCH", "/messages/msg/${m.id}", body, 0).getJSONObject("message")
        replaceMessage(withContext(Dispatchers.Default) { decrypt(Message.from(saved, m.conversationId)) }, saved)
    }

    /** Forward re-encrypts the message (and re-uploads its files) separately for every destination chat. */
    suspend fun forward(m: Message, destinations: List<String>) {
        if (m.sendState != 0 || destinations.isEmpty()) return
        val items = JSONArray()
        for (id in destinations) {
            val dest = conversationOrNull(id) ?: continue
            val env = withContext(Dispatchers.Default) { envelopeFor(dest) }
            val body = JSONObject().put("conversationId", id)
            if (m.attachments.isNotEmpty()) {
                val up = ArrayList<Triple<String, String, ByteArray>>(); val metas = ArrayList<String?>()
                for (a in m.attachments) {
                    val plain = media.plain(media.bytes(m.conversationId, m.id, a), a, m.mk)
                    if (env != null) { val (ct, iv) = withContext(Dispatchers.Default) { E2ee.encryptBytes(env.mk, plain) }; up += Triple(a.name, a.mimeType, ct); metas += iv }
                    else { up += Triple(a.name, a.mimeType, plain); metas += null }
                }
                body.put("attachments", JSONArray(api.upload(up, metas).map { it.toJson() }))
            }
            val text = m.text
            if (env != null) {
                val sealed = E2ee.encryptText(env.mk, text)
                body.put("text", sealed.ciphertextB64).put("iv", sealed.ivB64).put("encrypted", true)
                    .put("keys", JSONArray(env.keys.map { JSONObject().put("user", it.user).put("wrappedKey", it.wrappedKey).put("keyIv", it.keyIv) }))
            } else body.put("text", text).put("encrypted", false)
            items.put(body)
        }
        if (items.length() > 0) api.request("POST", "/messages/msg/${m.id}/forward", JSONObject().put("items", items), 0)
    }

    // ------------------------------------------------------------------ chat flags (pin / mute / archive / folder)
    private fun applyFlags(convId: String, patch: JSONObject) {
        if (convId.isEmpty()) return
        _conversations.update { l -> l.map { c ->
            if (c.id != convId) c else c.copy(
                muted = if (patch.has("muted")) patch.optBoolean("muted") else c.muted,
                pinned = if (patch.has("pinned")) patch.optBoolean("pinned") else c.pinned,
                archived = if (patch.has("archived")) patch.optBoolean("archived") else c.archived,
                folder = if (patch.has("folder")) patch.str("folder").ifEmpty { null } else c.folder,
            )
        } }
    }

    /** Optimistic: the row changes instantly; if the server refuses, it is put back. [flag] = "mute" | "pin" | "archive". */
    suspend fun setFlag(convId: String, flag: String, value: Boolean) {
        val key = mapOf("mute" to "muted", "pin" to "pinned", "archive" to "archived")[flag] ?: return
        val old = conversationOrNull(convId) ?: return
        val before = when (flag) { "mute" -> old.muted; "pin" -> old.pinned; else -> old.archived }
        applyFlags(convId, JSONObject().put(key, value))
        try { api.request("POST", "/conversations/$convId/flag", JSONObject().put("flag", flag).put("value", value), 0) }
        catch (e: Exception) { applyFlags(convId, JSONObject().put(key, before)); throw e }
    }

    suspend fun setFolder(convId: String, folder: String?) {
        val r = api.request("POST", "/conversations/$convId/folder", JSONObject().put("folder", folder ?: JSONObject.NULL), 0)
        applyFlags(convId, JSONObject().put("folder", r.str("folder")))
    }

    /** "Clear chat": empties the history for me (server + this phone). */
    suspend fun clearChatEverywhere(convId: String, alsoMedia: Boolean) {
        api.request("POST", "/conversations/$convId/clear", JSONObject(), 0)
        clearChat(convId, alsoMedia)
    }

    /** "Delete chat": one-sided — it leaves my list and comes back when someone writes again. */
    suspend fun deleteChat(convId: String) {
        api.request("POST", "/conversations/$convId/delete", JSONObject(), 0)
        clearChat(convId, alsoMedia = true)
        _conversations.update { it.filterNot { c -> c.id == convId } }
        refreshConversations()
    }

    suspend fun markUnread(convId: String) { _conversations.update { l -> l.map { if (it.id == convId && it.unread == 0) it.copy(unread = 1) else it } } }

    // ------------------------------------------------------------------ groups
    private fun upsertConversation(o: JSONObject): Conversation {
        val c = Conversation.from(o, myId)
        _conversations.update { listOf(c) + it.filter { x -> x.id != c.id } }
        _conversations.update { it.sortedByDescending { x -> x.lastMessageAt } }
        return c
    }

    suspend fun createGroup(name: String, members: List<String>, description: String = "", avatarDataUrl: String = ""): Conversation {
        val r = api.request("POST", "/conversations/group", JSONObject().put("name", name).put("participantIds", JSONArray(members))
            .put("description", description).put("avatar", avatarDataUrl), 0)
        return upsertConversation(r.getJSONObject("conversation"))
    }

    suspend fun updateGroup(id: String, name: String? = null, description: String? = null, avatar: String? = null, onlyAdmins: Boolean? = null): Conversation {
        val b = JSONObject()
        name?.let { b.put("name", it) }; description?.let { b.put("description", it) }; avatar?.let { b.put("avatar", it) }
        onlyAdmins?.let { b.put("onlyAdminsCanMessage", it) }
        return upsertConversation(api.request("PATCH", "/conversations/group/$id", b, 0).getJSONObject("conversation"))
    }

    suspend fun updateMembers(id: String, add: List<String> = emptyList(), remove: List<String> = emptyList()): Conversation =
        upsertConversation(api.request("PATCH", "/conversations/group/$id/members", JSONObject().put("add", JSONArray(add)).put("remove", JSONArray(remove)), 0).getJSONObject("conversation"))

    suspend fun updateAdmins(id: String, promote: List<String> = emptyList(), demote: List<String> = emptyList()): Conversation =
        upsertConversation(api.request("PATCH", "/conversations/group/$id/admins", JSONObject().put("promote", JSONArray(promote)).put("demote", JSONArray(demote)), 0).getJSONObject("conversation"))

    suspend fun leaveGroup(id: String) {
        api.request("POST", "/conversations/group/$id/leave", JSONObject(), 0)
        _conversations.update { it.filterNot { c -> c.id == id } }
    }

    // ------------------------------------------------------------------ people + profile
    private fun applyUserUpdate(u: JSONObject) {
        val id = u.id(); if (id.isEmpty()) return
        fun merge(x: User) = if (x.id != id) x else x.copy(
            displayName = u.str("displayName").ifEmpty { x.displayName }, avatar = if (u.has("avatar")) u.str("avatar") else x.avatar,
            avatarColor = u.str("avatarColor").ifEmpty { x.avatarColor }, about = if (u.has("about")) u.str("about") else x.about)
        _conversations.update { l -> l.map { c -> c.copy(participants = c.participants.map(::merge)) } }
        social.userChanged(id)
    }

    private fun applyMeUpdate(u: JSONObject) {
        val cur = store.userJson?.let { JSONObject(it) } ?: return
        for (k in listOf("displayName", "about", "avatar", "avatarColor", "statusPrivacy")) if (u.has(k)) cur.put(k, u.get(k))
        store.userJson = cur.toString()
        _me.value = User.from(cur)
    }

    /** Saves name / about / photo. [avatarDataUrl] is a cropped square JPEG as a data URL, exactly like the web app. */
    suspend fun updateProfile(displayName: String? = null, about: String? = null, avatarDataUrl: String? = null, avatarColor: String? = null) {
        val b = JSONObject()
        displayName?.let { b.put("displayName", it.trim()) }; about?.let { b.put("about", it.trim()) }
        avatarDataUrl?.let { b.put("avatar", it) }; avatarColor?.let { b.put("avatarColor", it) }
        val u = api.request("PATCH", "/users/profile", b, 0).getJSONObject("user")
        applyMeUpdate(u)
    }

    fun statusPrivacy(): JSONObject = store.userJson?.let { JSONObject(it).optJSONObject("statusPrivacy") } ?: JSONObject().put("mode", "contacts")

    fun joinConversationRoom(convId: String) = rt.emit("conversation:join", JSONObject().put("conversationId", convId))
}
