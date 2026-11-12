package com.wispchat.app.data

import android.content.ContentValues
import android.content.Context
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import com.wispchat.app.crypto.E2ee
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.io.File
import java.security.MessageDigest
import java.util.concurrent.ConcurrentHashMap

/**
 * Media kept on the phone. Files are stored exactly as downloaded (still end-to-end ENCRYPTED for secure
 * chats) inside the app's private folder — other apps can't read them. They are decrypted in memory to
 * display, and only written in readable form to the gallery/Downloads when the person asks (or turns on
 * "Media visibility").
 */
class MediaCache(private val ctx: Context, private val db: LocalDb, private val api: Api, private val settings: Settings) {
    private val dir = File(ctx.filesDir, "media").apply { mkdirs() }
    private val locks = ConcurrentHashMap<String, Mutex>()

    private fun key(url: String): String = MessageDigest.getInstance("SHA-1").digest(url.toByteArray()).joinToString("") { "%02x".format(it) }
    fun file(url: String) = File(dir, key(url))
    fun isCached(url: String) = file(url).let { it.exists() && it.length() > 0 }

    /** Returns the stored (possibly still encrypted) bytes, downloading once if needed. */
    suspend fun bytes(conv: String, messageId: String, a: Attachment): ByteArray {
        val f = file(a.url)
        if (!(f.exists() && f.length() > 0)) {
            locks.getOrPut(a.url) { Mutex() }.withLock {
                if (!(f.exists() && f.length() > 0)) {
                    val raw = api.download(a.url)
                    withContext(Dispatchers.IO) { val tmp = File(f.path + ".part"); tmp.writeBytes(raw); tmp.renameTo(f) }
                    db.putMedia(LocalDb.MediaRow(a.url, conv, messageId, a.name, a.mimeType, a.kind, raw.size.toLong(), null))
                }
            }
        }
        return withContext(Dispatchers.IO) { f.readBytes() }
    }

    /** Decrypts for display / export. */
    fun plain(raw: ByteArray, a: Attachment, mk: ByteArray?): ByteArray =
        if (a.encrypted && a.iv != null && mk != null) E2ee.decryptBytes(mk, raw, a.iv) else raw

    /** May this attachment be downloaded automatically right now (per the Storage-and-data settings)? */
    fun autoAllowed(a: Attachment, net: Net.Kind): Boolean {
        val level = when (net) { Net.Kind.WIFI -> settings.onWifi.value; Net.Kind.ROAMING -> settings.onRoaming.value; Net.Kind.MOBILE -> settings.onMobile.value; Net.Kind.NONE -> AutoDownload.NONE }
        return when (level) { AutoDownload.ALL -> true; AutoDownload.PHOTOS -> a.kind == "image"; AutoDownload.NONE -> false }
    }

    // ------------------------------------------------------------ gallery / downloads
    /** Copies a readable version into the phone's gallery (images/video/audio) or Downloads. Returns the new Uri. */
    suspend fun saveToDevice(url: String, name: String, mime: String, plain: ByteArray): Uri? = withContext(Dispatchers.IO) {
        val cleanName = name.ifBlank { "wisp_" + System.currentTimeMillis() }
        val (collection, folder) = when {
            mime.startsWith("image/") -> MediaStore.Images.Media.EXTERNAL_CONTENT_URI to Environment.DIRECTORY_PICTURES
            mime.startsWith("video/") -> MediaStore.Video.Media.EXTERNAL_CONTENT_URI to Environment.DIRECTORY_MOVIES
            mime.startsWith("audio/") -> MediaStore.Audio.Media.EXTERNAL_CONTENT_URI to Environment.DIRECTORY_MUSIC
            else -> (if (Build.VERSION.SDK_INT >= 29) MediaStore.Downloads.EXTERNAL_CONTENT_URI else MediaStore.Files.getContentUri("external")) to Environment.DIRECTORY_DOWNLOADS
        }
        val values = ContentValues().apply {
            put(MediaStore.MediaColumns.DISPLAY_NAME, cleanName)
            put(MediaStore.MediaColumns.MIME_TYPE, mime.ifEmpty { "application/octet-stream" })
            if (Build.VERSION.SDK_INT >= 29) {
                put(MediaStore.MediaColumns.RELATIVE_PATH, "$folder/WispChat")
                put(MediaStore.MediaColumns.IS_PENDING, 1)
            }
        }
        val resolver = ctx.contentResolver
        try {
            val uri = if (Build.VERSION.SDK_INT >= 29) resolver.insert(collection, values) else {
                // Android 8–9: write to the public folder directly (needs WRITE_EXTERNAL_STORAGE, declared up to API 28).
                val d = File(Environment.getExternalStoragePublicDirectory(folder), "WispChat").apply { mkdirs() }
                val f = File(d, cleanName); f.writeBytes(plain)
                values.put(MediaStore.MediaColumns.DATA, f.absolutePath)
                resolver.insert(collection, values)
            } ?: return@withContext null
            if (Build.VERSION.SDK_INT >= 29) {
                resolver.openOutputStream(uri)?.use { it.write(plain) }
                resolver.update(uri, ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) }, null, null)
            }
            db.setGalleryUri(url, uri.toString())
            uri
        } catch (e: Exception) { null }
    }

    /** Removes the gallery copy we made (if the person asked to delete it from the device too). */
    suspend fun removeFromGallery(url: String) = withContext(Dispatchers.IO) {
        val row = db.mediaRow(url) ?: return@withContext
        row.galleryUri?.let { try { ctx.contentResolver.delete(Uri.parse(it), null, null) } catch (_: Exception) {} }
        db.setGalleryUri(url, null)
    }

    // ------------------------------------------------------------ deleting from the device
    /** Deletes the stored copy of these files (the message itself is untouched). */
    suspend fun deleteFiles(urls: List<String>, alsoGallery: Boolean) = withContext(Dispatchers.IO) {
        urls.forEach { u -> if (alsoGallery) removeFromGallery(u); file(u).delete() }
        db.removeMedia(urls)
    }

    suspend fun sizeOf(conv: String): Long = db.mediaForConversation(conv).sumOf { file(it.url).length() }
    suspend fun totalSize(): Long = dir.listFiles()?.sumOf { it.length() } ?: 0L

    suspend fun clearConversation(conv: String, alsoGallery: Boolean = false) = deleteFiles(db.mediaForConversation(conv).map { it.url }, alsoGallery)
    suspend fun clearAll() { deleteFiles(db.allMedia().map { it.url }, false); dir.listFiles()?.forEach { it.delete() } }
}
