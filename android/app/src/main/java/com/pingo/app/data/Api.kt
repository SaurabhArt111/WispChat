package com.pingo.app.data

import com.pingo.app.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit

class ApiException(val status: Int, message: String, val transient: Boolean = false) : IOException(message)

/** Thin REST client for the Pingo Node backend. Adds the bearer token, retries safe reads while a sleeping host wakes up. */
class Api(private val store: Store, counter: okhttp3.Interceptor? = null) {
    val base: String = BuildConfig.BACKEND_URL
    val http: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(25, TimeUnit.SECONDS)
        .readTimeout(35, TimeUnit.SECONDS)
        .writeTimeout(60, TimeUnit.SECONDS)
        .pingInterval(25, TimeUnit.SECONDS)
        .apply { counter?.let { addInterceptor(it) } }
        .build()

    private val json = "application/json; charset=utf-8".toMediaType()

    fun absolute(path: String) = if (path.startsWith("http")) path else base + path

    private fun builder(path: String): Request.Builder =
        Request.Builder().url(absolute("/api$path")).apply { store.token?.let { header("Authorization", "Bearer $it") } }

    /** [retries] is only honoured for GET: replaying a POST could send a message twice. */
    suspend fun request(method: String, path: String, body: JSONObject? = null, retries: Int = if (method == "GET") 4 else 0): JSONObject =
        withContext(Dispatchers.IO) {
            var attempt = 0
            while (true) {
                try {
                    val rb: RequestBody? = if (method == "GET") null else (body ?: JSONObject()).toString().toRequestBody(json)
                    val req = builder(path).method(method, rb).build()
                    http.newCall(req).execute().use { res ->
                        val text = res.body?.string().orEmpty()
                        val obj = try { if (text.isBlank()) JSONObject() else JSONObject(text) } catch (e: Exception) { JSONObject() }
                        if (res.isSuccessful) return@withContext obj
                        val transient = res.code in intArrayOf(408, 429, 502, 503, 504)
                        throw ApiException(res.code, obj.optString("message", "Request failed (${res.code})"), transient)
                    }
                } catch (e: ApiException) {
                    if (!e.transient || attempt >= retries) throw e
                } catch (e: IOException) {
                    if (attempt >= retries) throw ApiException(0, "Can't reach the server. Check your connection.", true)
                }
                delay(longArrayOf(1500, 3000, 6000, 10000)[minOf(attempt, 3)])
                attempt++
            }
            @Suppress("UNREACHABLE_CODE") JSONObject()
        }

    suspend fun get(path: String) = request("GET", path)
    suspend fun post(path: String, body: JSONObject = JSONObject()) = request("POST", path, body)
    suspend fun patch(path: String, body: JSONObject = JSONObject()) = request("PATCH", path, body)
    suspend fun delete(path: String) = request("DELETE", path)

    /** Uploads (already encrypted) files; returns the attachment objects the server created. */
    suspend fun upload(files: List<Triple<String, String, ByteArray>>, encMeta: List<String?>): List<Attachment> =
        withContext(Dispatchers.IO) {
            val mp = MultipartBody.Builder().setType(MultipartBody.FORM)
            files.forEach { (name, mime, bytes) -> mp.addFormDataPart("files", name, bytes.toRequestBody(mime.toMediaType())) }
            val meta = encMeta.joinToString(prefix = "[", postfix = "]") { if (it == null) "null" else "{\"iv\":\"$it\"}" }
            mp.addFormDataPart("encMeta", meta)
            val req = builder("/messages/upload/media").post(mp.build()).build()
            http.newCall(req).execute().use { res ->
                val text = res.body?.string().orEmpty()
                if (!res.isSuccessful) throw ApiException(res.code, "Upload failed (${res.code})")
                val arr = JSONObject(text).optJSONArray("attachments") ?: return@use emptyList()
                (0 until arr.length()).map { Attachment.from(arr.getJSONObject(it)) }
            }
        }

    /** Downloads attachment bytes (auth header included). */
    suspend fun download(url: String): ByteArray = withContext(Dispatchers.IO) {
        val req = Request.Builder().url(absolute(url)).apply { store.token?.let { header("Authorization", "Bearer $it") } }.build()
        http.newCall(req).execute().use { res ->
            if (!res.isSuccessful) throw ApiException(res.code, "Download failed (${res.code})")
            res.body?.bytes() ?: ByteArray(0)
        }
    }
}
