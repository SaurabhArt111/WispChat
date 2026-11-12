package com.wispchat.app.data

import android.net.Uri
import android.provider.OpenableColumns
import com.wispchat.app.net.Realtime
import com.wispchat.app.util.ImageUtil
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
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

/**
 * Everything that isn't a chat: Status (stories), Explore posts, the call log, contacts and friend requests.
 * Same rule as the chats: the on-device copy paints first (so screens never start empty), the network refreshes it.
 */
class Social(private val repo: Repo) {
    private val api get() = repo.api
    private val db get() = repo.db
    private val scope get() = repo.scope
    private val ctx get() = repo.appContext

    // ---------------------------------------------------------------- state
    private val _contacts = MutableStateFlow<List<User>>(emptyList())
    val contacts: StateFlow<List<User>> = _contacts
    private val _contactsLoaded = MutableStateFlow(false)
    val contactsLoaded: StateFlow<Boolean> = _contactsLoaded

    private val _requests = MutableStateFlow<List<FriendRequest>>(emptyList())
    val requests: StateFlow<List<FriendRequest>> = _requests

    private val _status = MutableStateFlow<List<StatusEntry>>(emptyList())
    val status: StateFlow<List<StatusEntry>> = _status
    private val _statusLoading = MutableStateFlow(true)
    val statusLoading: StateFlow<Boolean> = _statusLoading

    private val _calls = MutableStateFlow<List<CallLog>>(emptyList())
    val calls: StateFlow<List<CallLog>> = _calls
    private val _callsLoading = MutableStateFlow(true)
    val callsLoading: StateFlow<Boolean> = _callsLoading
    private val _callsHasMore = MutableStateFlow(false)
    val callsHasMore: StateFlow<Boolean> = _callsHasMore

    private val _newPosts = MutableStateFlow(0)
    /** Posts other people published since Explore was last refreshed ("N new posts" pill). */
    val newPosts: StateFlow<Int> = _newPosts
    fun clearNewPosts() { _newPosts.value = 0 }

    private val _userTick = MutableStateFlow(0)
    val userTick: StateFlow<Int> = _userTick
    internal fun userChanged(@Suppress("UNUSED_PARAMETER") id: String) { _userTick.update { it + 1 } }

    /** Post / status events for screens that need to patch themselves live. */
    private val _events = MutableSharedFlow<Realtime.Event>(extraBufferCapacity = 128)
    val events: SharedFlow<Realtime.Event> = _events

    private var statusJob: Job? = null

    val myStatus: StatusEntry? get() = _status.value.firstOrNull { it.user.id == repo.myId }
    val othersStatus: List<StatusEntry> get() = _status.value.filter { it.user.id != repo.myId }.sortedByDescending { it.latestAt }
    val hasUnseenStatus: Boolean get() = othersStatus.any { !it.allSeen }

    // ---------------------------------------------------------------- lifecycle
    fun onSignedIn() {
        scope.launch {
            runCatching { db.kvGet("contacts")?.let { s -> _contacts.value = JSONArray(s).mapObjects(User::from) } }
            runCatching { db.kvGet("status")?.let { s -> _status.value = JSONArray(s).mapObjects(StatusEntry::from); _statusLoading.value = false } }
            runCatching { db.kvGet("calls")?.let { s -> _calls.value = JSONArray(s).mapObjects(CallLog::fromStored) } }
            if (_calls.value.isNotEmpty()) _callsLoading.value = false
            launch { refreshContacts() }
            launch { refreshRequests() }
            launch { refreshStatus() }
            launch { refreshCalls() }
        }
    }

    fun onSignedOut() {
        _contacts.value = emptyList(); _requests.value = emptyList(); _status.value = emptyList(); _calls.value = emptyList()
        _statusLoading.value = true; _callsLoading.value = true; _newPosts.value = 0; _contactsLoaded.value = false
    }

    /** Re-sync everything (pull-to-refresh, app back to foreground, network back). */
    suspend fun refreshAll() { refreshContacts(); refreshRequests(); refreshStatus(); refreshCalls() }

    // ---------------------------------------------------------------- realtime
    suspend fun handle(e: Realtime.Event) {
        when (e.name) {
            "status:changed" -> {
                statusJob?.cancel()
                statusJob = scope.launch { delay(400); refreshStatus() }
            }
            "friend-request:new", "friend-request:resolved", "friend-request:changed", "contacts:changed" -> {
                refreshRequests(); refreshContacts()
                if (e.name == "friend-request:resolved" || e.name == "contacts:changed") repo.refreshConversations()
            }
            "post:new" -> {
                val uid = e.data.optJSONObject("post")?.opt("user").let { if (it is JSONObject) it.id() else it?.toString().orEmpty() }
                if (uid != repo.myId) _newPosts.update { it + 1 }
                _events.tryEmit(e)
            }
            else -> _events.tryEmit(e)
        }
    }

    // ---------------------------------------------------------------- contacts + requests
    suspend fun refreshContacts() {
        try {
            val arr = api.get("/users/contacts").optJSONArray("contacts") ?: JSONArray()
            _contacts.value = arr.mapObjects(User::from)
            db.kvPut("contacts", arr.toString())
        } catch (_: Exception) {} finally { _contactsLoaded.value = true }
    }

    suspend fun refreshRequests() {
        try {
            val r = api.get("/users/friend-requests")
            val incoming = r.optJSONArray("incoming").mapObjects { FriendRequest.from(it, false) }.filterNotNull()
            val outgoing = r.optJSONArray("outgoing").mapObjects { FriendRequest.from(it, true) }.filterNotNull()
            _requests.value = incoming + outgoing
        } catch (_: Exception) {}
    }

    suspend fun sendRequest(userId: String) {
        api.post("/users/friend-requests", JSONObject().put("userId", userId))
        refreshRequests()
    }

    suspend fun respond(requestId: String, accept: Boolean) {
        api.post("/users/friend-requests/$requestId/respond", JSONObject().put("accept", accept))
        _requests.update { it.filterNot { r -> r.id == requestId } }
        refreshContacts()
        if (accept) repo.refreshConversations()
    }

    fun isContact(userId: String) = _contacts.value.any { it.id == userId }
    fun hasPendingRequest(userId: String) = _requests.value.any { it.user.id == userId }

    suspend fun suggestions(): Pair<List<Suggestion>, List<Suggestion>> {
        val r = api.get("/users/suggestions")
        val liked = r.optJSONArray("likedAuthors").mapObjects { o ->
            Suggestion(User.from(o), "Liked ${o.optInt("likedCount")} of their posts", o.optBoolean("isContact"), o.optBoolean("requestPending"))
        }
        val sugg = r.optJSONArray("suggested").mapObjects { o -> Suggestion(User.from(o), o.str("reason"), false, false) }
        return liked to sugg
    }

    // ---------------------------------------------------------------- status
    suspend fun refreshStatus() {
        try {
            val arr = api.request("GET", "/status", null, if (repo.net.online) 3 else 0).optJSONArray("feed") ?: JSONArray()
            _status.value = arr.mapObjects(StatusEntry::from)
            db.kvPut("status", arr.toString())
        } catch (_: Exception) {} finally { _statusLoading.value = false }
    }

    suspend fun postTextStatus(text: String, bgColor: String) {
        api.post("/status", JSONObject().put("kind", "text").put("text", text.trim()).put("bgColor", bgColor))
        refreshStatus()
    }

    suspend fun postMediaStatus(uri: Uri, caption: String, fit: String) {
        val up = readUpload(uri, 1600)
        api.multipart("POST", "/status", mapOf("caption" to caption.trim(), "fit" to fit), up)
        refreshStatus()
    }

    suspend fun viewStatus(item: StatusItem) {
        if (item.viewedByMe) return
        // Mark seen locally right away so the ring turns grey instantly.
        _status.update { l -> l.map { e -> e.copy(items = e.items.map { if (it.id == item.id) it.copy(viewedByMe = true) else it }) } }
        try { api.request("POST", "/status/${item.id}/view", JSONObject(), 0) } catch (_: Exception) {}
    }

    suspend fun reactStatus(item: StatusItem, emoji: String) {
        _status.update { l -> l.map { e -> e.copy(items = e.items.map { if (it.id == item.id) it.copy(myReaction = emoji) else it }) } }
        api.post("/status/${item.id}/react", JSONObject().put("emoji", emoji))
    }

    suspend fun deleteStatus(id: String) {
        api.delete("/status/$id")
        _status.update { l -> l.map { e -> e.copy(items = e.items.filterNot { it.id == id }) }.filter { it.items.isNotEmpty() } }
        refreshStatus()
    }

    suspend fun setStatusPrivacy(mode: String, exceptUsers: List<String>, onlyUsers: List<String>) {
        val r = api.patch("/users/status-privacy", JSONObject().put("mode", mode).put("exceptUsers", JSONArray(exceptUsers)).put("onlyUsers", JSONArray(onlyUsers)))
        r.optJSONObject("user")?.let { u ->
            val cur = repo.store.userJson?.let { JSONObject(it) } ?: return@let
            u.optJSONObject("statusPrivacy")?.let { cur.put("statusPrivacy", it) }
            repo.store.userJson = cur.toString()
        }
    }

    // ---------------------------------------------------------------- Explore posts
    suspend fun feed(scopeName: String, exclude: List<String>, limit: Int = 24): Pair<List<Post>, Boolean> {
        val q = "/posts/feed?limit=$limit&scope=$scopeName" + if (exclude.isNotEmpty()) "&exclude=" + exclude.takeLast(400).joinToString(",") else ""
        val r = api.get(q)
        return r.optJSONArray("posts").mapObjects { Post.from(it) }.filterNotNull() to r.optBoolean("hasMore", true)
    }

    suspend fun userPosts(userId: String): List<Post> =
        api.get("/posts/user/$userId").optJSONArray("posts").mapObjects { Post.from(it) }.filterNotNull()

    suspend fun post(id: String): Post? = Post.from(api.get("/posts/$id").getJSONObject("post"))

    /** Returns (liked, count). */
    suspend fun like(postId: String): Pair<Boolean, Int> {
        val r = api.post("/posts/$postId/like")
        return r.optBoolean("likedByMe") to r.optInt("likeCount")
    }

    suspend fun comment(postId: String, text: String): Comment =
        Comment.from(api.post("/posts/$postId/comment", JSONObject().put("text", text.trim())).getJSONObject("comment"))

    suspend fun editComment(postId: String, commentId: String, text: String) {
        api.patch("/posts/$postId/comment/$commentId", JSONObject().put("text", text.trim()))
    }

    suspend fun deleteComment(postId: String, commentId: String) { api.delete("/posts/$postId/comment/$commentId") }

    suspend fun createPost(uri: Uri, caption: String): Post? {
        val up = readUpload(uri, 1800)
        val r = api.multipart("POST", "/posts", mapOf("caption" to caption.trim()), up)
        return r.optJSONObject("post")?.let { Post.from(it) }
    }

    suspend fun updatePost(id: String, caption: String, uri: Uri?): Post? {
        val up = uri?.let { readUpload(it, 1800) }
        val r = api.multipart("PATCH", "/posts/$id", mapOf("caption" to caption.trim()), up)
        return r.optJSONObject("post")?.let { Post.from(it) }
    }

    suspend fun deletePost(id: String) { api.delete("/posts/$id") }

    // ---------------------------------------------------------------- calls
    suspend fun refreshCalls() {
        try {
            val r = api.request("GET", "/messages/calls?limit=100", null, if (repo.net.online) 3 else 0)
            val fresh = r.optJSONArray("calls").mapObjects { CallLog.fromMessage(it, repo.myId) }.filterNotNull()
            mergeCalls(fresh)
            _callsHasMore.value = r.optBoolean("hasMore")
        } catch (_: Exception) {} finally { _callsLoading.value = false }
    }

    suspend fun loadMoreCalls() {
        val last = _calls.value.lastOrNull() ?: return
        try {
            val before = java.net.URLEncoder.encode(java.time.Instant.ofEpochMilli(last.createdAt).toString(), "UTF-8")
            val r = api.get("/messages/calls?limit=50&before=$before")
            mergeCalls(r.optJSONArray("calls").mapObjects { CallLog.fromMessage(it, repo.myId) }.filterNotNull())
            _callsHasMore.value = r.optBoolean("hasMore")
        } catch (_: Exception) {}
    }

    /** A call-summary message arrived live. */
    suspend fun recordCall(raw: JSONObject) {
        val conv = repo.conversation((raw.opt("conversation") as? JSONObject)?.id() ?: raw.str("conversation"))
        val log = CallLog.fromMessage(raw, repo.myId) ?: return
        // The live message only carries the conversation id, so fill in who it was with from the chat list.
        val filled = if (conv != null) log.copy(convName = conv.name, convAvatar = conv.avatar, isGroup = conv.isGroup, peer = conv.other(repo.myId) ?: log.peer) else log
        mergeCalls(listOf(filled))
    }

    private suspend fun mergeCalls(entries: List<CallLog>) {
        val merged = (entries + _calls.value).distinctBy { it.id }.sortedByDescending { it.createdAt }.take(400)
        _calls.value = merged
        db.kvPut("calls", JSONArray(merged.map { it.toJson() }).toString())
    }

    suspend fun deleteCallLogLocal(ids: Set<String>) {
        val kept = _calls.value.filterNot { it.id in ids }
        _calls.value = kept
        db.kvPut("calls", JSONArray(kept.map { it.toJson() }).toString())
    }

    // ---------------------------------------------------------------- misc
    suspend fun linkPreview(url: String): LinkPreview? = linkCache.getOrPut(url) {
        try {
            val p = api.get("/link-preview?url=" + java.net.URLEncoder.encode(url, "UTF-8")).optJSONObject("preview")
            p?.let { LinkPreview(it.str("url").ifEmpty { url }, it.str("title"), it.str("description"), it.str("image"), it.str("siteName")) }
        } catch (_: Exception) { null }
    }
    data class LinkPreview(val url: String, val title: String, val description: String, val image: String, val siteName: String)
    private val linkCache = HashMap<String, LinkPreview?>()

    /** Server-side totals for Media & Storage. */
    suspend fun mediaStats(): JSONObject = api.get("/messages/media/stats")

    /** Reads a picked file for upload; photos are downscaled + re-encoded as JPEG, everything else goes as-is. */
    private suspend fun readUpload(uri: Uri, maxPx: Int): Triple<String, String, ByteArray> = withContext(Dispatchers.IO) {
        val cr = ctx.contentResolver
        val mime = cr.getType(uri) ?: "image/jpeg"
        val name = cr.query(uri, null, null, null, null)?.use { c -> if (c.moveToFirst()) c.getString(c.getColumnIndexOrThrow(OpenableColumns.DISPLAY_NAME)) else null } ?: "upload"
        if (mime.startsWith("image/") && mime != "image/gif") {
            val bmp = ImageUtil.decodeScaled(ctx, uri, maxPx) ?: throw ApiException(0, "Couldn't read that photo.")
            Triple(name.substringBeforeLast('.') + ".jpg", "image/jpeg", ImageUtil.toJpeg(bmp, 86))
        } else {
            val bytes = cr.openInputStream(uri)?.use { it.readBytes() } ?: throw ApiException(0, "Couldn't read that file.")
            Triple(name, mime.ifEmpty { "application/octet-stream" }, bytes)
        }
    }
}
