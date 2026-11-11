package com.pingo.app.data

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject

/**
 * On-device copy of everything the person has seen, so the app opens instantly and works with no internet.
 *
 * Messages are stored exactly as the server sent them. For end-to-end encrypted messages that means
 * ciphertext + wrapped keys: the database never holds readable text for them — it is decrypted in memory
 * with the key from the Keystore-backed [Store] only when shown. (Legacy un-encrypted messages are stored as received.)
 *
 * Plain SQLiteOpenHelper on purpose: no annotation processing, nothing extra to configure in the build.
 */
class LocalDb(context: Context) : SQLiteOpenHelper(context, "pingo.db", null, 1) {

    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL("CREATE TABLE conversations(id TEXT PRIMARY KEY, lastAt INTEGER, json TEXT NOT NULL)")
        db.execSQL("CREATE TABLE messages(id TEXT PRIMARY KEY, conv TEXT NOT NULL, createdAt INTEGER NOT NULL, clientId TEXT, json TEXT NOT NULL)")
        db.execSQL("CREATE INDEX idx_msg_conv ON messages(conv, createdAt)")
        db.execSQL("CREATE INDEX idx_msg_client ON messages(clientId)")
        // "Delete for me": ids that must stay hidden even when the server sends them again.
        db.execSQL("CREATE TABLE hidden(id TEXT PRIMARY KEY)")
        // Downloaded media on disk.
        db.execSQL("CREATE TABLE media(url TEXT PRIMARY KEY, conv TEXT, messageId TEXT, name TEXT, mime TEXT, kind TEXT, size INTEGER, galleryUri TEXT)")
        db.execSQL("CREATE INDEX idx_media_conv ON media(conv)")
        // Messages written while offline, waiting to be sent.
        db.execSQL("CREATE TABLE outbox(clientId TEXT PRIMARY KEY, conv TEXT NOT NULL, createdAt INTEGER NOT NULL, kind TEXT NOT NULL, body TEXT NOT NULL, files TEXT, failed INTEGER NOT NULL DEFAULT 0)")
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {}

    // ------------------------------------------------------------ conversations
    suspend fun saveConversations(items: List<Triple<String, Long, JSONObject>>) = withContext(Dispatchers.IO) {
        val db = writableDatabase
        db.beginTransaction()
        try {
            db.delete("conversations", null, null) // the list endpoint is authoritative for which chats exist
            for ((id, at, json) in items) db.insertWithOnConflict("conversations", null,
                ContentValues().apply { put("id", id); put("lastAt", at); put("json", json.toString()) }, SQLiteDatabase.CONFLICT_REPLACE)
            db.setTransactionSuccessful()
        } finally { db.endTransaction() }
    }

    suspend fun loadConversations(): List<JSONObject> = withContext(Dispatchers.IO) {
        val out = ArrayList<JSONObject>()
        readableDatabase.rawQuery("SELECT json FROM conversations ORDER BY lastAt DESC", null).use { c -> while (c.moveToNext()) out += JSONObject(c.getString(0)) }
        out
    }

    // ------------------------------------------------------------ messages
    suspend fun saveMessages(conv: String, list: List<JSONObject>) = withContext(Dispatchers.IO) {
        if (list.isEmpty()) return@withContext
        val db = writableDatabase
        db.beginTransaction()
        try {
            for (m in list) {
                val id = m.optString("_id"); if (id.isEmpty()) continue
                val client = m.optString("clientId")
                // The server copy replaces the optimistic one that was stored under the same clientId.
                if (client.isNotEmpty()) db.delete("messages", "clientId=? AND id LIKE 'local-%'", arrayOf(client))
                db.insertWithOnConflict("messages", null, ContentValues().apply {
                    put("id", id); put("conv", conv); put("createdAt", Message.parseIso(m.optString("createdAt")))
                    put("clientId", client); put("json", m.toString())
                }, SQLiteDatabase.CONFLICT_REPLACE)
            }
            db.setTransactionSuccessful()
        } finally { db.endTransaction() }
    }

    /** Newest [limit] messages (older than [before] if given), oldest first, minus anything the person hid. */
    suspend fun loadMessages(conv: String, limit: Int, before: Long? = null): List<JSONObject> = withContext(Dispatchers.IO) {
        val sql = "SELECT json FROM messages WHERE conv=? AND id NOT IN (SELECT id FROM hidden)" +
            (if (before != null) " AND createdAt<?" else "") + " ORDER BY createdAt DESC LIMIT ?"
        val args = if (before != null) arrayOf(conv, before.toString(), limit.toString()) else arrayOf(conv, limit.toString())
        val out = ArrayList<JSONObject>()
        readableDatabase.rawQuery(sql, args).use { c -> while (c.moveToNext()) out += JSONObject(c.getString(0)) }
        out.reverse(); out
    }

    suspend fun messageJson(id: String): JSONObject? = withContext(Dispatchers.IO) {
        readableDatabase.rawQuery("SELECT json FROM messages WHERE id=?", arrayOf(id)).use { c -> if (c.moveToFirst()) JSONObject(c.getString(0)) else null }
    }

    suspend fun hideMessage(id: String) = withContext(Dispatchers.IO) {
        val db = writableDatabase
        db.insertWithOnConflict("hidden", null, ContentValues().apply { put("id", id) }, SQLiteDatabase.CONFLICT_IGNORE)
        db.delete("messages", "id=?", arrayOf(id))
    }

    suspend fun isHidden(id: String): Boolean = withContext(Dispatchers.IO) {
        readableDatabase.rawQuery("SELECT 1 FROM hidden WHERE id=?", arrayOf(id)).use { it.moveToFirst() }
    }

    suspend fun clearConversationMessages(conv: String) = withContext(Dispatchers.IO) {
        val db = writableDatabase
        db.execSQL("INSERT OR IGNORE INTO hidden(id) SELECT id FROM messages WHERE conv=?", arrayOf(conv))
        db.delete("messages", "conv=?", arrayOf(conv))
    }

    // ------------------------------------------------------------ media index
    data class MediaRow(val url: String, val conv: String, val messageId: String, val name: String, val mime: String, val kind: String, val size: Long, val galleryUri: String?)

    suspend fun putMedia(r: MediaRow) = withContext(Dispatchers.IO) {
        writableDatabase.insertWithOnConflict("media", null, ContentValues().apply {
            put("url", r.url); put("conv", r.conv); put("messageId", r.messageId); put("name", r.name); put("mime", r.mime)
            put("kind", r.kind); put("size", r.size); put("galleryUri", r.galleryUri)
        }, SQLiteDatabase.CONFLICT_REPLACE)
    }

    suspend fun setGalleryUri(url: String, uri: String?) = withContext(Dispatchers.IO) {
        writableDatabase.execSQL("UPDATE media SET galleryUri=? WHERE url=?", arrayOf(uri, url))
    }

    suspend fun mediaRow(url: String): MediaRow? = withContext(Dispatchers.IO) {
        readableDatabase.rawQuery("SELECT url,conv,messageId,name,mime,kind,size,galleryUri FROM media WHERE url=?", arrayOf(url)).use { c ->
            if (c.moveToFirst()) row(c) else null
        }
    }

    suspend fun mediaForConversation(conv: String): List<MediaRow> = withContext(Dispatchers.IO) {
        val out = ArrayList<MediaRow>()
        readableDatabase.rawQuery("SELECT url,conv,messageId,name,mime,kind,size,galleryUri FROM media WHERE conv=?", arrayOf(conv)).use { c -> while (c.moveToNext()) out += row(c) }
        out
    }

    suspend fun allMedia(): List<MediaRow> = withContext(Dispatchers.IO) {
        val out = ArrayList<MediaRow>()
        readableDatabase.rawQuery("SELECT url,conv,messageId,name,mime,kind,size,galleryUri FROM media", null).use { c -> while (c.moveToNext()) out += row(c) }
        out
    }

    suspend fun removeMedia(urls: List<String>) = withContext(Dispatchers.IO) {
        val db = writableDatabase
        db.beginTransaction()
        try { urls.forEach { db.delete("media", "url=?", arrayOf(it)) }; db.setTransactionSuccessful() } finally { db.endTransaction() }
    }

    private fun row(c: android.database.Cursor) = MediaRow(c.getString(0), c.getString(1) ?: "", c.getString(2) ?: "", c.getString(3) ?: "", c.getString(4) ?: "", c.getString(5) ?: "file", c.getLong(6), c.getString(7))

    // ------------------------------------------------------------ outbox
    data class OutboxRow(val clientId: String, val conv: String, val createdAt: Long, val kind: String, val body: JSONObject, val files: List<String>, val failed: Boolean)

    suspend fun putOutbox(r: OutboxRow) = withContext(Dispatchers.IO) {
        writableDatabase.insertWithOnConflict("outbox", null, ContentValues().apply {
            put("clientId", r.clientId); put("conv", r.conv); put("createdAt", r.createdAt); put("kind", r.kind)
            put("body", r.body.toString()); put("files", r.files.joinToString("\n")); put("failed", if (r.failed) 1 else 0)
        }, SQLiteDatabase.CONFLICT_REPLACE)
    }

    suspend fun outbox(conv: String? = null): List<OutboxRow> = withContext(Dispatchers.IO) {
        val out = ArrayList<OutboxRow>()
        val (sql, args) = if (conv == null) "SELECT clientId,conv,createdAt,kind,body,files,failed FROM outbox ORDER BY createdAt" to null
        else "SELECT clientId,conv,createdAt,kind,body,files,failed FROM outbox WHERE conv=? ORDER BY createdAt" to arrayOf(conv)
        readableDatabase.rawQuery(sql, args).use { c ->
            while (c.moveToNext()) out += OutboxRow(c.getString(0), c.getString(1), c.getLong(2), c.getString(3), JSONObject(c.getString(4)),
                (c.getString(5) ?: "").split("\n").filter { it.isNotEmpty() }, c.getInt(6) == 1)
        }
        out
    }

    suspend fun removeOutbox(clientId: String) = withContext(Dispatchers.IO) { writableDatabase.delete("outbox", "clientId=?", arrayOf(clientId)) }

    suspend fun wipe() = withContext(Dispatchers.IO) {
        val db = writableDatabase
        listOf("conversations", "messages", "hidden", "media", "outbox").forEach { db.delete(it, null, null) }
    }
}
