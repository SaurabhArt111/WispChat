package com.wispchat.app.ui

import android.net.Uri
import android.widget.VideoView
import androidx.compose.foundation.gestures.calculatePan
import androidx.compose.foundation.gestures.calculateZoom
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.positionChanged
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import coil.compose.AsyncImage
import com.wispchat.app.App
import kotlinx.coroutines.delay

/** An image at a server path (`/uploads/…`) or a full URL. */
@Composable
fun NetworkImage(url: String, modifier: Modifier = Modifier, contentScale: ContentScale = ContentScale.Crop, description: String? = null) {
    val full = if (url.startsWith("http")) url else App.instance.repo.api.base + url
    AsyncImage(model = full, contentDescription = description, modifier = modifier, contentScale = contentScale)
}

fun absoluteUrl(path: String): String = if (path.startsWith("http")) path else App.instance.repo.api.base + path

/**
 * Video playback without extra libraries (Android's own VideoView). [playing] pauses / resumes it,
 * [onPrepared] reports the length so story timers can match the clip.
 */
@Composable
fun VideoPlayer(
    uri: Uri, modifier: Modifier = Modifier, playing: Boolean = true, loop: Boolean = false, muted: Boolean = false,
    onPrepared: (durationMs: Int) -> Unit = {}, onProgress: (positionMs: Int) -> Unit = {}, onEnd: () -> Unit = {},
) {
    val ctx = LocalContext.current
    val view = remember(uri) { VideoView(ctx) }
    var prepared by remember(uri) { mutableStateOf(false) }
    val endCb by rememberUpdatedState(onEnd)
    val prepCb by rememberUpdatedState(onPrepared)
    val playingNow by rememberUpdatedState(playing)
    AndroidView(modifier = modifier, factory = {
        view.apply {
            setVideoURI(uri)
            setOnPreparedListener { mp ->
                prepared = true; mp.isLooping = loop
                if (muted) mp.setVolume(0f, 0f)
                prepCb(mp.duration)
                if (playingNow) start()
            }
            setOnCompletionListener { endCb() }
            setOnErrorListener { _, _, _ -> true }
        }
    })
    LaunchedEffect(playing, prepared) { if (prepared) { if (playing) view.start() else view.pause() } }
    LaunchedEffect(prepared) { while (prepared) { if (view.isPlaying) onProgress(view.currentPosition); delay(120) } }
    DisposableEffect(view) { onDispose { try { view.stopPlayback() } catch (_: Exception) {} } }
}

/**
 * Pinch-to-zoom + double-tap image. It only grabs touches while zoomed in (or with two fingers), so
 * a one-finger swipe at normal size still flips pages in a pager.
 */
@Composable
fun ZoomBox(modifier: Modifier = Modifier, onTap: () -> Unit = {}, content: @Composable () -> Unit) {
    var scale by remember { mutableFloatStateOf(1f) }
    var offset by remember { mutableStateOf(Offset.Zero) }
    Box(
        modifier
            .pointerInput(Unit) {
                awaitEachGesture {
                    awaitFirstDown(requireUnconsumed = false)
                    do {
                        val event = awaitPointerEvent(PointerEventPass.Main)
                        val multi = event.changes.size > 1
                        if (multi || scale > 1f) {
                            val z = event.calculateZoom(); val p = event.calculatePan()
                            scale = (scale * z).coerceIn(1f, 5f)
                            offset = if (scale > 1f) offset + p else Offset.Zero
                            event.changes.forEach { if (it.positionChanged()) it.consume() }
                        }
                    } while (event.changes.any { it.pressed })
                    if (scale <= 1.02f) { scale = 1f; offset = Offset.Zero }
                }
            }
            .pointerInput(Unit) {
                detectTapGestures(onTap = { onTap() }, onDoubleTap = { if (scale > 1f) { scale = 1f; offset = Offset.Zero } else scale = 2.5f })
            }
            .graphicsLayer(scaleX = scale, scaleY = scale, translationX = offset.x, translationY = offset.y),
        Alignment.Center,
    ) { content() }
}
