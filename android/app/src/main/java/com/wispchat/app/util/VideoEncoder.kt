package com.wispchat.app.util

import android.content.Context
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.Handler
import android.os.Looper
import androidx.annotation.OptIn
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.UnstableApi
import androidx.media3.effect.Presentation
import androidx.media3.transformer.Composition
import androidx.media3.transformer.DefaultEncoderFactory
import androidx.media3.transformer.EditedMediaItem
import androidx.media3.transformer.Effects
import androidx.media3.transformer.ExportException
import androidx.media3.transformer.ExportResult
import androidx.media3.transformer.Transformer
import androidx.media3.transformer.VideoEncoderSettings
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import java.io.File
import kotlin.coroutines.resume

/**
 * Shrinks videos before sending, using the phone's own HARDWARE encoder (MediaCodec via Media3 Transformer):
 * H.264 + AAC, at most 720p (short side), ~2 Mbit/s — what WhatsApp does. Fast and battery-friendly because the
 * device's media chip does the work. Small clips are sent untouched; if the device can't encode, the original is sent.
 */
@OptIn(UnstableApi::class)
object VideoEncoder {
    private const val SHORT_SIDE = 720
    private const val BITRATE = 2_000_000

    /** Returns a smaller copy of [src], or null to keep the original. */
    suspend fun compress(ctx: Context, src: File): File? {
        val info = withContext(Dispatchers.IO) { probe(src) } ?: return null
        val (w, h, bitrate) = info
        val short = minOf(w, h)
        if (short <= SHORT_SIDE && (bitrate in 1..(BITRATE * 3 / 2) || src.length() < 4L * 1024 * 1024)) return null
        val out = File(src.parentFile, src.name + ".enc.mp4")
        // Presentation works on the frame as displayed; scale so the SHORT side becomes 720.
        val targetHeight = if (h >= w) (h.toLong() * SHORT_SIDE / w).toInt() else SHORT_SIDE
        val result = withContext(Dispatchers.Main) {
            suspendCancellableCoroutine<Boolean> { cont ->
                val transformer = Transformer.Builder(ctx.applicationContext)
                    .setVideoMimeType(MimeTypes.VIDEO_H264)
                    .setAudioMimeType(MimeTypes.AUDIO_AAC)
                    .setEncoderFactory(
                        DefaultEncoderFactory.Builder(ctx.applicationContext)
                            .setRequestedVideoEncoderSettings(VideoEncoderSettings.Builder().setBitrate(BITRATE).build())
                            .setEnableFallback(true)
                            .build(),
                    )
                    .addListener(object : Transformer.Listener {
                        override fun onCompleted(composition: Composition, exportResult: ExportResult) { if (cont.isActive) cont.resume(true) }
                        override fun onError(composition: Composition, exportResult: ExportResult, exportException: ExportException) { if (cont.isActive) cont.resume(false) }
                    })
                    .build()
                val item = EditedMediaItem.Builder(MediaItem.fromUri(Uri.fromFile(src)))
                    .setEffects(Effects(emptyList(), listOf(Presentation.createForHeight(targetHeight))))
                    .build()
                try { transformer.start(item, out.absolutePath) } catch (_: Exception) { if (cont.isActive) cont.resume(false) }
                cont.invokeOnCancellation { Handler(Looper.getMainLooper()).post { runCatching { transformer.cancel() } } }
            }
        }
        return if (result && out.length() > 0 && out.length() < src.length()) out else { out.delete(); null }
    }

    /** Displayed width, height (rotation applied) and bitrate. */
    private fun probe(f: File): Triple<Int, Int, Int>? = try {
        val r = MediaMetadataRetriever()
        try {
            r.setDataSource(f.absolutePath)
            val w = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)?.toIntOrNull() ?: return null
            val h = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)?.toIntOrNull() ?: return null
            val rot = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION)?.toIntOrNull() ?: 0
            val br = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_BITRATE)?.toIntOrNull() ?: 0
            if (rot == 90 || rot == 270) Triple(h, w, br) else Triple(w, h, br)
        } finally { r.release() }
    } catch (_: Exception) { null }
}
