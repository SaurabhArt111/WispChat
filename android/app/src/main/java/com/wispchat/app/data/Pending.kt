package com.wispchat.app.data

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * The offline action queue: everything you do while the server can't be reached (react, edit, delete,
 * mute / pin / archive, mark read, clear / delete chat, status views and posts, likes, friend requests, profile…)
 * is applied on the phone straight away, written to [LocalDb] and replayed **one by one, in the order it
 * happened** as soon as the server answers again. It survives the app being closed or the phone restarting
 * (a WorkManager job retries in the background — see [SyncWorker]).
 *
 * Messages themselves keep using the dedicated outbox in [Repo] (they carry files and end-to-end keys).
 */
class Pending(private val repo: Repo) {
    private val db get() = repo.db
    private val lock = Mutex()
    private val _count = MutableStateFlow(0)
    /** Queued actions + unsent messages — shown as "N pending" while offline. */
    val count: StateFlow<Int> = _count

    suspend fun refreshCount() { _count.value = runCatching { db.countPending() }.getOrDefault(_count.value) }

    /**
     * Queues an action and tries to send it right away.
     * [extra] holds what's needed to re-apply it locally (overlays) and to finish it once the server answers.
     */
    suspend fun enqueue(kind: String, method: String, path: String, body: JSONObject?, extra: JSONObject? = null, dedupe: String? = null) {
        db.addAction(kind, method, path, body?.toString(), extra?.toString(), dedupe)
        refreshCount()
        repo.requestSync()
    }

    /** A multipart upload (status photo / new post) — the picked file is copied first so it survives until we're online. */
    suspend fun enqueueUpload(kind: String, method: String, path: String, fields: Map<String, String>, file: Triple<String, String, ByteArray>?, fileField: String = "file", extra: JSONObject? = null) {
        val x = extra ?: JSONObject()
        if (file != null) {
            val dir = File(repo.appContext.filesDir, "pending").apply { mkdirs() }
            val f = File(dir, java.util.UUID.randomUUID().toString())
            kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) { f.writeBytes(file.third) }
            x.put("file", f.absolutePath).put("name", file.first).put("mime", file.second).put("field", fileField)
        }
        db.addAction(kind, "MULTIPART:$method", path, JSONObject(fields).toString(), x.toString(), null)
        refreshCount()
        repo.requestSync()
    }

    suspend fun cancel(dedupe: String) { db.removeActionsByDedupe(dedupe); refreshCount() }

    suspend fun all(): List<LocalDb.ActionRow> = db.actions()

    /**
     * Replays the queue, oldest first, stopping at the first sign the server is still unreachable.
     * Returns true when the queue is empty afterwards.
     */
    suspend fun flush(): Boolean {
        if (!repo.net.online || repo.me.value == null) return false
        lock.withLock {
            var touchedChats = false; var touchedStatus = false; var touchedPeople = false
            try {
                for (a in db.actions()) {
                    val extra = a.extra?.let { runCatching { JSONObject(it) }.getOrNull() } ?: JSONObject()
                    try {
                        val res = execute(a, extra)
                        db.removeAction(a.id)
                        cleanupFile(extra)
                        repo.onActionDone(a, extra, res)
                    } catch (e: ApiException) {
                        if (e.transient || e.status == 0) return false // still can't reach the server: keep everything, try later
                        // The server refused it for good (message gone, not allowed…): drop it and let a refresh restore the truth.
                        db.removeAction(a.id); cleanupFile(extra)
                        repo.onActionRejected(a, extra)
                    } catch (e: CancellationException) {
                        throw e
                    } catch (e: Exception) {
                        // A broken entry (bad JSON, file gone): don't let it block the queue forever.
                        if (a.attempts >= 4) { db.removeAction(a.id); cleanupFile(extra) } else { db.bumpAction(a.id); return false }
                    } finally { refreshCount() }
                    when (a.kind) {
                        "status-text", "status-media", "status-delete", "status-view", "status-react" -> touchedStatus = true
                        "friend-request", "friend-respond", "block" -> touchedPeople = true
                        "flag", "folder", "clear", "delete-chat" -> touchedChats = true
                    }
                }
                return true
            } finally {
                if (touchedChats) repo.scope.launchSafe { repo.refreshConversations() }
                if (touchedStatus) repo.scope.launchSafe { repo.social.refreshStatus() }
                if (touchedPeople) repo.scope.launchSafe { repo.social.refreshRequests(); repo.social.refreshContacts() }
            }
        }
    }

    private suspend fun execute(a: LocalDb.ActionRow, extra: JSONObject): JSONObject {
        if (a.method.startsWith("MULTIPART:")) {
            val fields = JSONObject(a.body ?: "{}")
            val map = LinkedHashMap<String, String>(); fields.keys().forEach { k -> map[k] = fields.optString(k) }
            val path = extra.optString("file")
            val file = if (path.isNotEmpty()) {
                val f = File(path)
                if (!f.exists()) throw IllegalStateException("file gone")
                Triple(extra.optString("name", "upload"), extra.optString("mime", "application/octet-stream"), kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) { f.readBytes() })
            } else null
            return repo.api.multipart(a.method.removePrefix("MULTIPART:"), a.path, map, file, extra.optString("field", "file"))
        }
        return repo.api.request(a.method, a.path, a.body?.let { JSONObject(it) }, 0)
    }

    private fun cleanupFile(extra: JSONObject) { extra.optString("file").takeIf { it.isNotEmpty() }?.let { runCatching { File(it).delete() } } }

    companion object {
        /** Same rule the server uses for reactions: one per person; the queued state is what the person last picked. */
        fun patchReaction(j: JSONObject, me: String, emoji: String) {
            val src = j.optJSONArray("reactions") ?: JSONArray()
            val out = JSONArray()
            for (i in 0 until src.length()) {
                val r = src.optJSONObject(i) ?: continue
                val u = r.opt("user"); val uid = if (u is JSONObject) u.optString("_id") else r.optString("user")
                if (uid != me) out.put(r)
            }
            if (emoji.isNotEmpty()) out.put(JSONObject().put("user", me).put("emoji", emoji))
            j.put("reactions", out)
        }

        fun patchEdit(j: JSONObject, body: JSONObject) {
            j.put("text", body.optString("text")).put("edited", true)
            if (body.has("iv")) j.put("iv", body.opt("iv"))
            if (body.has("keys")) j.put("keys", body.opt("keys"))
        }

        fun patchDeleted(j: JSONObject) { j.put("deletedForEveryone", true).put("text", "").put("attachments", JSONArray()) }
    }
}

/** launch {} that never lets an exception escape (background refreshes). */
internal fun kotlinx.coroutines.CoroutineScope.launchSafe(block: suspend () -> Unit): kotlinx.coroutines.Job =
    launch { try { block() } catch (e: CancellationException) { throw e } catch (_: Exception) {} }
