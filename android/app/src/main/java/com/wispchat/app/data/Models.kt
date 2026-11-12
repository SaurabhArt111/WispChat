package com.wispchat.app.data

import org.json.JSONArray
import org.json.JSONObject

internal fun JSONObject.str(k: String): String = if (isNull(k)) "" else optString(k, "")
internal fun JSONObject.id(k: String = "_id"): String = str(k)
internal inline fun <T> JSONArray?.mapObjects(f: (JSONObject) -> T): List<T> {
    if (this == null) return emptyList()
    val out = ArrayList<T>(length())
    for (i in 0 until length()) optJSONObject(i)?.let { out += f(it) }
    return out
}
/** Ids from an array that holds either plain id strings or populated objects. */
internal fun JSONArray?.idList(): List<String> {
    if (this == null) return emptyList()
    val out = ArrayList<String>(length())
    for (i in 0 until length()) { val v = opt(i); out += if (v is JSONObject) v.id() else v.toString() }
    return out
}
internal fun isoToMillis(s: String): Long = try { java.time.Instant.parse(s).toEpochMilli() } catch (e: Exception) { 0L }

data class User(
    val id: String,
    val username: String,
    val displayName: String,
    val avatar: String,
    val avatarColor: String,
    val pubX: String?,
    val pubY: String?,
    val about: String = "",
    val isOnline: Boolean = false,
    val lastSeen: Long = 0L,
) {
    val hasKey get() = !pubX.isNullOrEmpty() && !pubY.isNullOrEmpty()

    companion object {
        fun from(o: JSONObject): User {
            val jwk = o.optJSONObject("e2ee")?.optJSONObject("publicKeyJwk")
            return User(o.id(), o.str("username"), o.str("displayName").ifEmpty { o.str("username") },
                o.str("avatar"), o.str("avatarColor"), jwk?.str("x"), jwk?.str("y"),
                o.str("about"), o.optBoolean("isOnline"), isoToMillis(o.str("lastSeen")))
        }
    }
}

data class Attachment(
    val url: String, val name: String, val mimeType: String, val size: Long,
    val kind: String, val encrypted: Boolean, val iv: String?,
    val width: Int = 0, val height: Int = 0, val duration: Double = 0.0,
) {
    companion object {
        fun from(o: JSONObject) = Attachment(o.str("url"), o.str("name"), o.str("mimeType"), o.optLong("size"),
            o.str("kind").ifEmpty { "file" }, o.optBoolean("encrypted"), if (o.isNull("iv")) null else o.optString("iv"),
            o.optInt("width"), o.optInt("height"), o.optDouble("duration", 0.0).let { if (it.isNaN()) 0.0 else it })
    }
    fun toJson(): JSONObject = JSONObject().put("url", url).put("name", name).put("mimeType", mimeType)
        .put("size", size).put("kind", kind).put("encrypted", encrypted).put("iv", iv ?: JSONObject.NULL)
        .put("width", width).put("height", height).put("duration", duration)
}

data class KeyEntry(val user: String, val wrappedKey: String, val keyIv: String)

data class Reaction(val userId: String, val name: String, val emoji: String)

/** The status slide a message was written in reply to (WhatsApp "reply to status"). */
data class StatusReply(val kind: String, val url: String, val text: String, val bgColor: String, val caption: String, val isReaction: Boolean, val ownerId: String)

data class Message(
    val id: String,
    val conversationId: String,
    val sender: User?,
    /** ciphertext when [encrypted], otherwise plain text */
    val rawText: String,
    val encrypted: Boolean,
    val iv: String?,
    val keys: List<KeyEntry>,
    val attachments: List<Attachment>,
    val createdAt: Long,
    val clientId: String,
    val deleted: Boolean,
    val callKind: String?,
    val callStatus: String?,
    val callDuration: Int,
    val readBy: Set<String>,
    // filled in after decryption (never stored on disk)
    val text: String = if (encrypted) "" else rawText,
    val locked: Boolean = false,
    val mk: ByteArray? = null,
    /** 0 = delivered, 1 = waiting to send (offline / sending), 2 = failed */
    val sendState: Int = 0,
    val edited: Boolean = false,
    val reactions: List<Reaction> = emptyList(),
    val replyTo: Message? = null,
    val forwardedFrom: User? = null,
    val statusReply: StatusReply? = null,
) {
    val isCall get() = callKind != null
    val isMedia get() = attachments.isNotEmpty()

    companion object {
        fun from(o: JSONObject, fallbackConv: String = ""): Message {
            val call = o.optJSONObject("callInfo")
            val keys = o.optJSONArray("keys").mapObjects { k ->
                val u = k.opt("user")
                KeyEntry(if (u is JSONObject) u.id() else k.str("user"), k.str("wrappedKey"), k.str("keyIv"))
            }
            val conv = o.opt("conversation")
            val reactions = o.optJSONArray("reactions").mapObjects { r ->
                val u = r.opt("user")
                Reaction(if (u is JSONObject) u.id() else r.str("user"), if (u is JSONObject) u.str("displayName") else "", r.str("emoji"))
            }.filter { it.emoji.isNotEmpty() }
            val sr = o.optJSONObject("statusReply")?.let {
                val owner = it.opt("owner")
                StatusReply(it.str("kind"), it.str("url"), it.str("text"), it.str("bgColor"), it.str("caption"), it.optBoolean("isReaction"),
                    if (owner is JSONObject) owner.id() else it.str("owner"))
            }
            return Message(
                id = o.id(),
                conversationId = if (conv is JSONObject) conv.id() else o.str("conversation").ifEmpty { fallbackConv },
                sender = o.optJSONObject("sender")?.let(User::from),
                rawText = o.str("text"),
                encrypted = o.optBoolean("encrypted"),
                iv = if (o.isNull("iv")) null else o.optString("iv"),
                keys = keys,
                attachments = o.optJSONArray("attachments").mapObjects(Attachment::from),
                createdAt = o.str("createdAt").let { if (it.isEmpty()) System.currentTimeMillis() else parseIso(it) },
                clientId = o.str("clientId"),
                deleted = o.optBoolean("deletedForEveryone"),
                callKind = call?.str("kind"),
                callStatus = call?.str("status"),
                callDuration = call?.optInt("durationSec") ?: 0,
                readBy = o.optJSONArray("readBy").idList().toSet(),
                edited = o.optBoolean("edited"),
                reactions = reactions,
                replyTo = o.optJSONObject("replyTo")?.let { from(it, fallbackConv) },
                forwardedFrom = o.optJSONObject("forwardedFrom")?.let(User::from),
                statusReply = sr,
            )
        }

        fun parseIso(s: String): Long = try {
            java.time.Instant.parse(s).toEpochMilli()
        } catch (e: Exception) { System.currentTimeMillis() }
    }
}

data class Conversation(
    val id: String,
    val isGroup: Boolean,
    val name: String,
    val avatar: String,
    val participants: List<User>,
    val lastMessage: Message?,
    val lastMessageAt: Long,
    val unread: Int,
    val muted: Boolean,
    val pinned: Boolean = false,
    val archived: Boolean = false,
    val folder: String? = null,
    val description: String = "",
    val admins: List<String> = emptyList(),
    val createdBy: String = "",
    val onlyAdminsCanMessage: Boolean = false,
) {
    fun title(me: String): String =
        if (isGroup) name.ifEmpty { "Group" } else (participants.firstOrNull { it.id != me } ?: participants.firstOrNull())?.displayName ?: "Chat"

    fun other(me: String): User? = if (isGroup) null else participants.firstOrNull { it.id != me }
    fun isAdmin(me: String) = admins.contains(me)

    companion object {
        fun from(o: JSONObject, me: String): Conversation {
            val parts = o.optJSONArray("participants").mapObjects(User::from)
            val last = o.optJSONObject("lastMessage")?.let { Message.from(it, o.id()) }
            // The server sends booleans (muted/pinned/archived); the arrays are only on raw documents.
            val muted = if (o.has("muted")) o.optBoolean("muted") else o.optJSONArray("mutedBy").idList().contains(me)
            val pinned = if (o.has("pinned")) o.optBoolean("pinned") else o.optJSONArray("pinnedBy").idList().contains(me)
            val archived = if (o.has("archived")) o.optBoolean("archived") else o.optJSONArray("archivedBy").idList().contains(me)
            val createdBy = o.opt("createdBy").let { if (it is JSONObject) it.id() else it?.toString().orEmpty().takeIf { s -> s != "null" }.orEmpty() }
            return Conversation(o.id(), o.optBoolean("isGroup"), o.str("name"), o.str("avatar"), parts, last,
                isoToMillis(o.str("lastMessageAt")), o.optInt("unreadCount"), muted, pinned, archived,
                o.str("folder").ifEmpty { null }, o.str("description"), o.optJSONArray("admins").idList(), createdBy,
                o.optBoolean("onlyAdminsCanMessage"))
        }
    }
}

// ------------------------------------------------------------------------------------------ status

data class StatusViewer(val user: User, val at: Long, val count: Int, val emoji: String?)

data class StatusItem(
    val id: String, val kind: String, val url: String, val text: String, val bgColor: String, val caption: String,
    val fit: String, val createdAt: Long, val viewerCount: Int, val viewedByMe: Boolean,
    val viewers: List<StatusViewer>, val myReaction: String?,
) {
    companion object {
        fun from(o: JSONObject) = StatusItem(
            o.id(), o.str("kind"), o.str("url"), o.str("text"), o.str("bgColor").ifEmpty { "#5ef2c0" }, o.str("caption"),
            o.str("fit").ifEmpty { "cover" }, isoToMillis(o.str("createdAt")), o.optInt("viewerCount"), o.optBoolean("viewedByMe"),
            o.optJSONArray("viewers").mapObjects { v ->
                val u = v.optJSONObject("user")
                StatusViewer(if (u != null) User.from(u) else User(v.str("user"), "", "Someone", "", "", null, null),
                    isoToMillis(v.str("at")), v.optInt("count", 1), v.str("emoji").ifEmpty { null })
            },
            o.str("myReaction").ifEmpty { null },
        )
    }
}

data class StatusEntry(val user: User, val items: List<StatusItem>) {
    val allSeen get() = items.all { it.viewedByMe }
    val latestAt get() = items.maxOfOrNull { it.createdAt } ?: 0L
    companion object {
        fun from(o: JSONObject) = StatusEntry(User.from(o.getJSONObject("user")), o.optJSONArray("items").mapObjects(StatusItem::from))
    }
}

// ------------------------------------------------------------------------------------------ posts (Explore)

data class Comment(val id: String, val user: User?, val text: String, val edited: Boolean, val createdAt: Long, val mine: Boolean) {
    companion object {
        fun from(o: JSONObject) = Comment(o.id(), o.optJSONObject("user")?.let(User::from), o.str("text"), o.optBoolean("edited"),
            isoToMillis(o.str("createdAt")), o.optBoolean("mine"))
    }
}

data class Post(
    val id: String, val user: User, val kind: String, val url: String, val mimeType: String, val caption: String,
    val edited: Boolean, val createdAt: Long, val likeCount: Int, val likedByMe: Boolean, val isContact: Boolean,
    val isMine: Boolean, val commentCount: Int, val comments: List<Comment>,
) {
    companion object {
        fun from(o: JSONObject): Post? {
            val u = o.optJSONObject("user") ?: return null
            return Post(o.id(), User.from(u), o.str("kind").ifEmpty { "image" }, o.str("url"), o.str("mimeType"), o.str("caption"),
                o.optBoolean("edited"), isoToMillis(o.str("createdAt")), o.optInt("likeCount"), o.optBoolean("likedByMe"),
                o.optBoolean("isContact"), o.optBoolean("isMine"), o.optInt("commentCount"),
                o.optJSONArray("comments").mapObjects(Comment::from))
        }
    }
}

// ------------------------------------------------------------------------------------------ calls + contacts

data class CallLog(
    val id: String, val convId: String, val convName: String, val convAvatar: String, val isGroup: Boolean,
    val peer: User?, val outgoing: Boolean, val kind: String, val status: String, val durationSec: Int, val createdAt: Long,
) {
    val missed get() = status == "missed"

    fun toJson(): JSONObject = JSONObject().put("id", id).put("convId", convId).put("convName", convName).put("convAvatar", convAvatar)
        .put("isGroup", isGroup).put("outgoing", outgoing).put("kind", kind).put("status", status).put("durationSec", durationSec)
        .put("createdAt", createdAt)
        .put("peer", peer?.let { JSONObject().put("_id", it.id).put("username", it.username).put("displayName", it.displayName)
            .put("avatar", it.avatar).put("avatarColor", it.avatarColor) } ?: JSONObject.NULL)

    companion object {
        fun fromStored(o: JSONObject) = CallLog(o.str("id"), o.str("convId"), o.str("convName"), o.str("convAvatar"), o.optBoolean("isGroup"),
            o.optJSONObject("peer")?.let(User::from), o.optBoolean("outgoing"), o.str("kind"), o.str("status"),
            o.optInt("durationSec"), o.optLong("createdAt"))

        /** From the server's call-log message (`/messages/calls`) or a live `message:new` carrying `callInfo`. */
        fun fromMessage(o: JSONObject, me: String): CallLog? {
            val info = o.optJSONObject("callInfo") ?: return null
            val conv = o.opt("conversation")
            val c = conv as? JSONObject
            val convId = if (c != null) c.id() else o.str("conversation")
            val senderId = o.opt("sender").let { if (it is JSONObject) it.id() else it?.toString().orEmpty() }
            val parts = c?.optJSONArray("participants").mapObjects(User::from).orEmpty()
            val peer = parts.firstOrNull { it.id != me } ?: o.optJSONObject("sender")?.let(User::from)?.takeIf { it.id != me }
            return CallLog(o.id(), convId, c?.str("name").orEmpty(), c?.str("avatar").orEmpty(), c?.optBoolean("isGroup") ?: false, peer,
                senderId == me, info.str("kind").ifEmpty { "audio" }, info.str("status").ifEmpty { "completed" },
                info.optInt("durationSec"), isoToMillis(o.str("createdAt")).let { if (it == 0L) System.currentTimeMillis() else it })
        }
    }
}

data class FriendRequest(val id: String, val user: User, val outgoing: Boolean) {
    companion object {
        fun from(o: JSONObject, outgoing: Boolean): FriendRequest? {
            val u = o.optJSONObject(if (outgoing) "to" else "from") ?: return null
            return FriendRequest(o.id(), User.from(u), outgoing)
        }
    }
}

/** A person on the "New chat" page's discovery lists. */
data class Suggestion(val user: User, val reason: String, val isContact: Boolean, val requestPending: Boolean)
