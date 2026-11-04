package com.pingo.app.data

import org.json.JSONArray
import org.json.JSONObject

private fun JSONObject.str(k: String): String = if (isNull(k)) "" else optString(k, "")
private fun JSONObject.id(k: String = "_id"): String = str(k)
private inline fun <T> JSONArray?.mapObjects(f: (JSONObject) -> T): List<T> {
    if (this == null) return emptyList()
    val out = ArrayList<T>(length())
    for (i in 0 until length()) optJSONObject(i)?.let { out += f(it) }
    return out
}

data class User(
    val id: String,
    val username: String,
    val displayName: String,
    val avatar: String,
    val avatarColor: String,
    val pubX: String?,
    val pubY: String?,
) {
    val hasKey get() = !pubX.isNullOrEmpty() && !pubY.isNullOrEmpty()

    companion object {
        fun from(o: JSONObject): User {
            val jwk = o.optJSONObject("e2ee")?.optJSONObject("publicKeyJwk")
            return User(o.id(), o.str("username"), o.str("displayName").ifEmpty { o.str("username") },
                o.str("avatar"), o.str("avatarColor"), jwk?.str("x"), jwk?.str("y"))
        }
    }
}

data class Attachment(
    val url: String, val name: String, val mimeType: String, val size: Long,
    val kind: String, val encrypted: Boolean, val iv: String?,
) {
    companion object {
        fun from(o: JSONObject) = Attachment(o.str("url"), o.str("name"), o.str("mimeType"), o.optLong("size"),
            o.str("kind").ifEmpty { "file" }, o.optBoolean("encrypted"), if (o.isNull("iv")) null else o.optString("iv"))
    }
    fun toJson(): JSONObject = JSONObject().put("url", url).put("name", name).put("mimeType", mimeType)
        .put("size", size).put("kind", kind).put("encrypted", encrypted).put("iv", iv ?: JSONObject.NULL)
}

data class KeyEntry(val user: String, val wrappedKey: String, val keyIv: String)

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
) {
    companion object {
        fun from(o: JSONObject, fallbackConv: String = ""): Message {
            val call = o.optJSONObject("callInfo")
            val keys = o.optJSONArray("keys").mapObjects { k ->
                val u = k.opt("user")
                KeyEntry(if (u is JSONObject) u.id() else k.str("user"), k.str("wrappedKey"), k.str("keyIv"))
            }
            val read = HashSet<String>()
            o.optJSONArray("readBy")?.let { a -> for (i in 0 until a.length()) { val v = a.opt(i); read += if (v is JSONObject) v.id() else v.toString() } }
            val conv = o.opt("conversation")
            return Message(
                id = o.id(),
                conversationId = if (conv is JSONObject) conv.id() else o.str("conversation").ifEmpty { fallbackConv },
                sender = o.optJSONObject("sender")?.let(User::from),
                rawText = o.str("text"),
                encrypted = o.optBoolean("encrypted"),
                iv = if (o.isNull("iv")) null else o.optString("iv"),
                keys = keys,
                attachments = o.optJSONArray("attachments").mapObjects(Attachment::from),
                createdAt = parseIso(o.str("createdAt")),
                clientId = o.str("clientId"),
                deleted = o.optBoolean("deletedForEveryone"),
                callKind = call?.str("kind"),
                callStatus = call?.str("status"),
                callDuration = call?.optInt("durationSec") ?: 0,
                readBy = read,
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
) {
    fun title(me: String): String =
        if (isGroup) name.ifEmpty { "Group" } else (participants.firstOrNull { it.id != me } ?: participants.firstOrNull())?.displayName ?: "Chat"

    fun other(me: String): User? = if (isGroup) null else participants.firstOrNull { it.id != me }

    companion object {
        fun from(o: JSONObject, me: String): Conversation {
            val parts = o.optJSONArray("participants").mapObjects(User::from)
            val last = o.optJSONObject("lastMessage")?.let { Message.from(it, o.id()) }
            val muted = o.optJSONArray("mutedBy")?.let { a -> (0 until a.length()).any { a.opt(it).toString() == me } } ?: false
            return Conversation(o.id(), o.optBoolean("isGroup"), o.str("name"), o.str("avatar"), parts, last,
                Message.parseIso(o.str("lastMessageAt")), o.optInt("unreadCount"), muted)
        }
    }
}
