package com.wispchat.app.call

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.BitmapShader
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Shader
import android.graphics.Typeface
import android.util.LruCache
import com.wispchat.app.repo
import com.wispchat.app.util.ImageUtil
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull

/** Round caller pictures for call notifications: their photo when we can get it, otherwise their initial on their colour. */
object CallAvatar {
    private val cache = LruCache<String, Bitmap>(12)

    suspend fun load(ctx: Context, name: String, colorHex: String, url: String, size: Int = 256): Bitmap = withContext(Dispatchers.IO) {
        val key = "$url|$name|$colorHex|$size"
        cache.get(key)?.let { return@withContext it }
        val photo: Bitmap? = try {
            when {
                url.startsWith("data:") -> ImageUtil.decodeDataUrl(url)
                url.isNotEmpty() -> withTimeoutOrNull(6_000) { ctx.repo.api.download(url) }?.let { BitmapFactory.decodeByteArray(it, 0, it.size) }
                else -> null
            }
        } catch (_: Exception) { null }
        val out = photo?.let { circle(it, size) } ?: initials(name, colorHex, size)
        cache.put(key, out)
        out
    }

    fun initials(name: String, colorHex: String, size: Int = 256): Bitmap {
        val bmp = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
        val c = Canvas(bmp)
        val bg = try { android.graphics.Color.parseColor(colorHex.ifEmpty { "#6EE7B7" }) } catch (_: Exception) { 0xFF6EE7B7.toInt() }
        c.drawCircle(size / 2f, size / 2f, size / 2f, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = bg })
        val p = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = 0xFF0A1020.toInt(); textSize = size * 0.44f; typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD); textAlign = Paint.Align.CENTER
        }
        val letter = name.trim().take(1).uppercase().ifEmpty { "?" }
        c.drawText(letter, size / 2f, size / 2f - (p.descent() + p.ascent()) / 2, p)
        return bmp
    }

    private fun circle(src: Bitmap, size: Int): Bitmap {
        val side = minOf(src.width, src.height)
        val square = Bitmap.createBitmap(src, (src.width - side) / 2, (src.height - side) / 2, side, side)
        val scaled = Bitmap.createScaledBitmap(square, size, size, true)
        val out = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
        val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { shader = BitmapShader(scaled, Shader.TileMode.CLAMP, Shader.TileMode.CLAMP) }
        Canvas(out).drawCircle(size / 2f, size / 2f, size / 2f, paint)
        return out
    }
}
