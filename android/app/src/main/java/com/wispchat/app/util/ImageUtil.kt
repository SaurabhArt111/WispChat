package com.wispchat.app.util

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.ExifInterface
import android.net.Uri
import android.util.Base64
import java.io.ByteArrayOutputStream

/** Small bitmap helpers: decode with EXIF rotation, downscale, square-crop, JPEG / data-URL encode. */
object ImageUtil {
    /** Decodes [uri] no larger than [maxPx] on its long side, honouring the photo's EXIF rotation. */
    fun decodeScaled(ctx: Context, uri: Uri, maxPx: Int): Bitmap? = try {
        val cr = ctx.contentResolver
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        cr.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
        var sample = 1
        while (maxOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= maxPx) sample *= 2
        val opts = BitmapFactory.Options().apply { inSampleSize = sample }
        var bmp = cr.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, opts) }
        if (bmp != null) {
            val rotation = try {
                cr.openInputStream(uri)?.use { ExifInterface(it).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL) } ?: ExifInterface.ORIENTATION_NORMAL
            } catch (_: Exception) { ExifInterface.ORIENTATION_NORMAL }
            val deg = when (rotation) { ExifInterface.ORIENTATION_ROTATE_90 -> 90f; ExifInterface.ORIENTATION_ROTATE_180 -> 180f; ExifInterface.ORIENTATION_ROTATE_270 -> 270f; else -> 0f }
            if (deg != 0f) bmp = Bitmap.createBitmap(bmp, 0, 0, bmp.width, bmp.height, Matrix().apply { postRotate(deg) }, true)
            val longSide = maxOf(bmp.width, bmp.height)
            if (longSide > maxPx) { val k = maxPx.toFloat() / longSide; bmp = Bitmap.createScaledBitmap(bmp, (bmp.width * k).toInt().coerceAtLeast(1), (bmp.height * k).toInt().coerceAtLeast(1), true) }
        }
        bmp
    } catch (_: Exception) { null }

    fun squareCrop(b: Bitmap): Bitmap {
        val side = minOf(b.width, b.height)
        return Bitmap.createBitmap(b, (b.width - side) / 2, (b.height - side) / 2, side, side)
    }

    fun toJpeg(b: Bitmap, quality: Int = 85): ByteArray = ByteArrayOutputStream().also { b.compress(Bitmap.CompressFormat.JPEG, quality, it) }.toByteArray()

    /** Square, 512px, JPEG data URL — what the web app stores in `user.avatar`. */
    fun avatarDataUrl(b: Bitmap, size: Int = 512): String {
        val sq = squareCrop(b)
        val scaled = if (sq.width > size) Bitmap.createScaledBitmap(sq, size, size, true) else sq
        return "data:image/jpeg;base64," + Base64.encodeToString(toJpeg(scaled, 86), Base64.NO_WRAP)
    }

    fun decodeDataUrl(url: String): Bitmap? = try {
        val bytes = Base64.decode(url.substringAfter("base64,"), Base64.DEFAULT)
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
    } catch (_: Exception) { null }
}
