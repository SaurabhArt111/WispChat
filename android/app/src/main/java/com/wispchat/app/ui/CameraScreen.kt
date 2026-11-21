package com.wispchat.app.ui

import android.Manifest
import android.annotation.SuppressLint
import android.content.ContentUris
import android.content.Context
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.Camera
import androidx.camera.core.CameraSelector
import androidx.camera.core.FocusMeteringAction
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.video.FallbackStrategy
import androidx.camera.video.FileOutputOptions
import androidx.camera.video.Quality
import androidx.camera.video.QualitySelector
import androidx.camera.video.Recorder
import androidx.camera.video.Recording
import androidx.camera.video.VideoCapture
import androidx.camera.video.VideoRecordEvent
import androidx.camera.view.PreviewView
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.gestures.detectVerticalDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.ArrowDropDown
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.FlashAuto
import androidx.compose.material.icons.rounded.FlashOff
import androidx.compose.material.icons.rounded.FlashOn
import androidx.compose.material.icons.rounded.FlipCameraAndroid
import androidx.compose.material.icons.rounded.KeyboardArrowUp
import androidx.compose.material.icons.rounded.LibraryAddCheck
import androidx.compose.material.icons.rounded.PhotoLibrary
import androidx.compose.material.icons.rounded.Send
import androidx.compose.material.icons.rounded.Videocam
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.core.content.ContextCompat
import coil.compose.AsyncImage
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import java.io.File
import kotlin.coroutines.resume
import kotlin.math.roundToInt

// ================================================================================================ phone gallery

/** One photo / video from the phone's gallery. */
data class DeviceMedia(val uri: Uri, val video: Boolean, val durationMs: Long, val bucketId: String, val bucket: String, val dateAdded: Long)

private fun mediaPermissions(): Array<String> = when {
    Build.VERSION.SDK_INT >= 34 -> arrayOf(Manifest.permission.READ_MEDIA_IMAGES, Manifest.permission.READ_MEDIA_VIDEO, Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED)
    Build.VERSION.SDK_INT >= 33 -> arrayOf(Manifest.permission.READ_MEDIA_IMAGES, Manifest.permission.READ_MEDIA_VIDEO)
    else -> arrayOf(Manifest.permission.READ_EXTERNAL_STORAGE)
}

private fun hasMediaAccess(ctx: Context): Boolean {
    fun g(p: String) = ContextCompat.checkSelfPermission(ctx, p) == PackageManager.PERMISSION_GRANTED
    return when {
        Build.VERSION.SDK_INT >= 34 -> g(Manifest.permission.READ_MEDIA_IMAGES) || g(Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED)
        Build.VERSION.SDK_INT >= 33 -> g(Manifest.permission.READ_MEDIA_IMAGES)
        else -> g(Manifest.permission.READ_EXTERNAL_STORAGE)
    }
}

/** Newest photos and videos first ("Recents"), straight from MediaStore. */
private suspend fun loadDeviceMedia(ctx: Context, limit: Int = 600): List<DeviceMedia> = withContext(Dispatchers.IO) {
    val out = ArrayList<DeviceMedia>()
    val uri = MediaStore.Files.getContentUri("external")
    val proj = arrayOf(MediaStore.Files.FileColumns._ID, MediaStore.Files.FileColumns.MEDIA_TYPE, MediaStore.Video.VideoColumns.DURATION,
        MediaStore.MediaColumns.BUCKET_ID, MediaStore.MediaColumns.BUCKET_DISPLAY_NAME, MediaStore.MediaColumns.DATE_ADDED)
    val sel = "${MediaStore.Files.FileColumns.MEDIA_TYPE}=? OR ${MediaStore.Files.FileColumns.MEDIA_TYPE}=?"
    val args = arrayOf(MediaStore.Files.FileColumns.MEDIA_TYPE_IMAGE.toString(), MediaStore.Files.FileColumns.MEDIA_TYPE_VIDEO.toString())
    try {
        ctx.contentResolver.query(uri, proj, sel, args, "${MediaStore.MediaColumns.DATE_ADDED} DESC")?.use { c ->
            while (c.moveToNext() && out.size < limit) {
                val id = c.getLong(0)
                val video = c.getInt(1) == MediaStore.Files.FileColumns.MEDIA_TYPE_VIDEO
                val base = if (video) MediaStore.Video.Media.EXTERNAL_CONTENT_URI else MediaStore.Images.Media.EXTERNAL_CONTENT_URI
                out += DeviceMedia(ContentUris.withAppendedId(base, id), video, if (c.isNull(2)) 0 else c.getLong(2),
                    c.getString(3) ?: "", c.getString(4) ?: "Other", c.getLong(5))
            }
        }
    } catch (_: Exception) {}
    out
}

private fun durationLabel(ms: Long): String { val s = (ms / 1000).toInt(); return "%d:%02d".format(s / 60, s % 60) }

// ================================================================================================ camera

private enum class CamMode { PHOTO, VIDEO }

/**
 * WhatsApp-style camera: full-screen preview (tap to focus, pinch to zoom, double-tap to flip), flash, Photo / Video,
 * a strip of your most recent photos & videos above the shutter, and the full "Recents" gallery when you swipe up
 * (or tap the gallery button). Calls [onDone] with the captured / picked items.
 */
@SuppressLint("MissingPermission")
@Composable
fun WispCamera(onDismiss: () -> Unit, onDone: (List<Uri>) -> Unit) {
    val ctx = LocalContext.current
    val lifecycle = LocalLifecycleOwner.current
    val scope = rememberCoroutineScope()
    val density = LocalDensity.current
    val main = remember { ContextCompat.getMainExecutor(ctx) }

    var mode by remember { mutableStateOf(CamMode.PHOTO) }
    var front by remember { mutableStateOf(false) }
    var flash by remember { mutableIntStateOf(ImageCapture.FLASH_MODE_OFF) }
    var camera by remember { mutableStateOf<Camera?>(null) }
    var imageCapture by remember { mutableStateOf<ImageCapture?>(null) }
    var videoCapture by remember { mutableStateOf<VideoCapture<Recorder>?>(null) }
    var recording by remember { mutableStateOf<Recording?>(null) }
    var recSecs by remember { mutableIntStateOf(0) }
    var busy by remember { mutableStateOf(false) }
    var focus by remember { mutableStateOf<Offset?>(null) }
    var galleryOpen by remember { mutableStateOf(false) }
    var media by remember { mutableStateOf<List<DeviceMedia>>(emptyList()) }
    var mediaAccess by remember { mutableStateOf(hasMediaAccess(ctx)) }
    val previewView = remember { PreviewView(ctx).apply { implementationMode = PreviewView.ImplementationMode.COMPATIBLE; scaleType = PreviewView.ScaleType.FILL_CENTER } }

    val askMedia = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { mediaAccess = hasMediaAccess(ctx) }
    val askMic = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { }
    val systemPicker = rememberLauncherForActivityResult(ActivityResultContracts.PickMultipleVisualMedia(10)) { uris: List<Uri> -> if (uris.isNotEmpty()) onDone(uris) }

    LaunchedEffect(Unit) { if (!mediaAccess) askMedia.launch(mediaPermissions()) }
    LaunchedEffect(mediaAccess) { if (mediaAccess) media = loadDeviceMedia(ctx) }
    LaunchedEffect(recording) { recSecs = 0; while (recording != null) { delay(1000); recSecs++ } }
    LaunchedEffect(focus) { if (focus != null) { delay(900); focus = null } }

    // (re)bind the camera whenever the lens or the mode changes
    LaunchedEffect(front, mode) {
        val provider = suspendCancellableCoroutine<ProcessCameraProvider> { k ->
            val f = ProcessCameraProvider.getInstance(ctx)
            f.addListener({ runCatching { k.resume(f.get()) } }, main)
        }
        val preview = Preview.Builder().build().also { it.setSurfaceProvider(previewView.surfaceProvider) }
        val selector = if (front) CameraSelector.DEFAULT_FRONT_CAMERA else CameraSelector.DEFAULT_BACK_CAMERA
        try {
            provider.unbindAll()
            if (mode == CamMode.PHOTO) {
                val ic = ImageCapture.Builder().setCaptureMode(ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY).setFlashMode(flash).build()
                camera = provider.bindToLifecycle(lifecycle, selector, preview, ic)
                imageCapture = ic; videoCapture = null
            } else {
                val recorder = Recorder.Builder().setQualitySelector(QualitySelector.from(Quality.HD, FallbackStrategy.lowerQualityOrHigherThan(Quality.SD))).build()
                val vc = VideoCapture.withOutput(recorder)
                camera = provider.bindToLifecycle(lifecycle, selector, preview, vc)
                videoCapture = vc; imageCapture = null
            }
        } catch (e: Exception) { ctx.toast("Camera unavailable") }
    }
    DisposableEffect(Unit) {
        onDispose {
            recording?.stop()
            runCatching { ProcessCameraProvider.getInstance(ctx).get().unbindAll() }
        }
    }
    LaunchedEffect(flash, imageCapture) { imageCapture?.flashMode = flash }
    LaunchedEffect(flash, camera, mode) { if (mode == CamMode.VIDEO) camera?.cameraControl?.enableTorch(flash == ImageCapture.FLASH_MODE_ON) }

    fun takePhoto() {
        val ic = imageCapture ?: return
        if (busy) return
        busy = true
        val f = File(ctx.cacheDir, "cam_${System.currentTimeMillis()}.jpg")
        val meta = ImageCapture.Metadata().apply { isReversedHorizontal = front }
        ic.takePicture(ImageCapture.OutputFileOptions.Builder(f).setMetadata(meta).build(), main, object : ImageCapture.OnImageSavedCallback {
            override fun onImageSaved(output: ImageCapture.OutputFileResults) { busy = false; onDone(listOf(fileUri(f))) }
            override fun onError(exception: ImageCaptureException) { busy = false; ctx.toast("Couldn't take the photo") }
        })
    }
    fun toggleRecording() {
        val active = recording
        if (active != null) { active.stop(); recording = null; return }
        val vc = videoCapture ?: return
        val f = File(ctx.cacheDir, "vid_${System.currentTimeMillis()}.mp4")
        var pending = vc.output.prepareRecording(ctx, FileOutputOptions.Builder(f).build())
        if (ContextCompat.checkSelfPermission(ctx, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) pending = pending.withAudioEnabled()
        recording = pending.start(main) { ev ->
            if (ev is VideoRecordEvent.Finalize) {
                recording = null
                if (!ev.hasError() || (f.exists() && f.length() > 0)) onDone(listOf(fileUri(f))) else ctx.toast("Couldn't record the video")
            }
        }
    }

    BackHandler(enabled = galleryOpen) { galleryOpen = false }

    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false, dismissOnClickOutside = false)) {
        Box(Modifier.fillMaxSize().background(Color.Black)) {
            // ---- preview: tap = focus, double tap = flip, pinch = zoom, swipe up = gallery
            var swipe by remember { mutableStateOf(0f) }
            AndroidView({ previewView }, Modifier.fillMaxSize()
                .pointerInput(Unit) {
                    detectTapGestures(
                        onTap = { p ->
                            focus = p
                            runCatching { camera?.cameraControl?.startFocusAndMetering(FocusMeteringAction.Builder(previewView.meteringPointFactory.createPoint(p.x, p.y)).build()) }
                        },
                        onDoubleTap = { if (recording == null) front = !front },
                    )
                }
                .pointerInput(Unit) {
                    detectTransformGestures { _, pan, zoom, _ ->
                        if (zoom != 1f) camera?.let { c -> val cur = c.cameraInfo.zoomState.value?.zoomRatio ?: 1f; c.cameraControl.setZoomRatio(cur * zoom) }
                        else { swipe += pan.y; if (swipe < -with(density) { 90.dp.toPx() } && mediaAccess) { galleryOpen = true; swipe = 0f } }
                    }
                })
            focus?.let { p ->
                Box(Modifier.offset { IntOffset((p.x - with(density) { 34.dp.toPx() }).roundToInt(), (p.y - with(density) { 34.dp.toPx() }).roundToInt()) }
                    .size(68.dp).border(1.5.dp, Color.White, CircleShape))
            }

            // ---- top bar
            Row(Modifier.fillMaxWidth().statusBarsPadding().padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                CamRound(Icons.Rounded.Close, "Close") { onDismiss() }
                Spacer(Modifier.weight(1f))
                if (recording != null) Row(Modifier.clip(RoundedCornerShape(14.dp)).background(Color(0xCCE5484D)).padding(horizontal = 12.dp, vertical = 5.dp), verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.size(8.dp).clip(CircleShape).background(Color.White))
                    Text("  " + durationLabel(recSecs * 1000L), color = Color.White, fontWeight = FontWeight.SemiBold)
                }
                Spacer(Modifier.weight(1f))
                CamRound(when (flash) { ImageCapture.FLASH_MODE_ON -> Icons.Rounded.FlashOn; ImageCapture.FLASH_MODE_AUTO -> Icons.Rounded.FlashAuto; else -> Icons.Rounded.FlashOff }, "Flash") {
                    flash = when (flash) {
                        ImageCapture.FLASH_MODE_OFF -> ImageCapture.FLASH_MODE_ON
                        ImageCapture.FLASH_MODE_ON -> if (mode == CamMode.PHOTO) ImageCapture.FLASH_MODE_AUTO else ImageCapture.FLASH_MODE_OFF
                        else -> ImageCapture.FLASH_MODE_OFF
                    }
                }
            }

            // ---- bottom: recents strip, controls, modes
            Column(Modifier.align(Alignment.BottomCenter).fillMaxWidth()
                .pointerInput(mediaAccess) {
                    var acc = 0f
                    detectVerticalDragGestures(onDragStart = { acc = 0f }, onVerticalDrag = { ch, dy ->
                        acc += dy
                        if (acc < -60f && mediaAccess) { ch.consume(); galleryOpen = true; acc = 0f }
                    })
                }) {
                if (recording == null) {
                    if (mediaAccess && media.isNotEmpty()) {
                        Box(Modifier.fillMaxWidth().clickable { galleryOpen = true }.padding(bottom = 6.dp), Alignment.Center) {
                            Icon(Icons.Rounded.KeyboardArrowUp, "Open gallery", tint = Color.White)
                        }
                        LazyRow(contentPadding = PaddingValues(horizontal = 2.dp), horizontalArrangement = Arrangement.spacedBy(3.dp)) {
                            items(media.take(40), key = { it.uri.toString() }) { m ->
                                Box(Modifier.size(78.dp).clickable { onDone(listOf(m.uri)) }) {
                                    AsyncImage(model = m.uri, contentDescription = null, modifier = Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
                                    if (m.video) Text(durationLabel(m.durationMs), color = Color.White, fontSize = 10.sp, modifier = Modifier.align(Alignment.BottomStart).padding(3.dp))
                                }
                            }
                        }
                    } else if (!mediaAccess) Text("Allow photo access to see your recent photos here", color = Color.White.copy(alpha = 0.85f), fontSize = 13.sp,
                        modifier = Modifier.align(Alignment.CenterHorizontally).clip(RoundedCornerShape(14.dp)).background(Color(0x66000000))
                            .clickable { askMedia.launch(mediaPermissions()) }.padding(horizontal = 14.dp, vertical = 7.dp))
                }
                Row(Modifier.fillMaxWidth().padding(horizontal = 26.dp, vertical = 18.dp), verticalAlignment = Alignment.CenterVertically) {
                    CamRound(Icons.Rounded.PhotoLibrary, "Gallery", size = 56) {
                        if (mediaAccess) galleryOpen = true else systemPicker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageAndVideo))
                    }
                    Spacer(Modifier.weight(1f))
                    Shutter(mode, recording != null, busy) { if (mode == CamMode.PHOTO) takePhoto() else toggleRecording() }
                    Spacer(Modifier.weight(1f))
                    CamRound(Icons.Rounded.FlipCameraAndroid, "Switch camera", size = 56, enabled = recording == null) { front = !front }
                }
                Row(Modifier.fillMaxWidth().background(Color.Black).navigationBarsPadding().padding(top = 10.dp, bottom = 14.dp), horizontalArrangement = Arrangement.Center) {
                    listOf(CamMode.VIDEO to "Video", CamMode.PHOTO to "Photo").forEach { (m, label) ->
                        val on = mode == m
                        Text(label, color = Color.White, fontSize = 16.sp, fontWeight = if (on) FontWeight.SemiBold else FontWeight.Normal,
                            modifier = Modifier.padding(horizontal = 8.dp).clip(RoundedCornerShape(20.dp)).background(if (on) Color(0xFF2A2F36) else Color.Transparent)
                                .clickable(enabled = recording == null) {
                                    mode = m
                                    if (m == CamMode.VIDEO && ContextCompat.checkSelfPermission(ctx, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) askMic.launch(Manifest.permission.RECORD_AUDIO)
                                }.padding(horizontal = 20.dp, vertical = 8.dp))
                    }
                }
            }

            // ---- full gallery (swipe up)
            AnimatedVisibility(galleryOpen, enter = slideInVertically(tween(260)) { it }, exit = slideOutVertically(tween(220)) { it }) {
                GalleryPicker(media, onClose = { galleryOpen = false }, onPick = { onDone(it) })
            }
        }
    }
}

@Composable
private fun CamRound(icon: androidx.compose.ui.graphics.vector.ImageVector, desc: String, size: Int = 46, enabled: Boolean = true, onClick: () -> Unit) {
    Box(Modifier.size(size.dp).clip(CircleShape).background(Color(0x66000000)).clickable(enabled = enabled, onClick = onClick), Alignment.Center) {
        Icon(icon, desc, tint = Color.White.copy(alpha = if (enabled) 1f else 0.4f), modifier = Modifier.size((size * 0.48f).dp))
    }
}

@Composable
private fun Shutter(mode: CamMode, recording: Boolean, busy: Boolean, onClick: () -> Unit) {
    val inner by animateDpAsState(if (recording) 30.dp else 64.dp, tween(180), label = "inner")
    Box(Modifier.size(84.dp).border(5.dp, Color.White, CircleShape).padding(6.dp).clickable(enabled = !busy, onClick = onClick), Alignment.Center) {
        Box(Modifier.size(inner).clip(if (recording) RoundedCornerShape(8.dp) else CircleShape).background(if (mode == CamMode.VIDEO) Color(0xFFE5484D) else Color.White))
        if (mode == CamMode.VIDEO && !recording) Icon(Icons.Rounded.Videocam, null, tint = Color.White, modifier = Modifier.size(26.dp))
    }
}

/** "Recents" gallery: album switcher, single tap to send one, or multi-select up to 10 and Send. */
@Composable
private fun GalleryPicker(all: List<DeviceMedia>, onClose: () -> Unit, onPick: (List<Uri>) -> Unit) {
    var album by remember { mutableStateOf<String?>(null) }
    var albumMenu by remember { mutableStateOf(false) }
    var multi by remember { mutableStateOf(false) }
    var picked by remember { mutableStateOf(listOf<Uri>()) }
    val albums = remember(all) { all.groupBy { it.bucketId }.map { (id, l) -> id to l.first().bucket }.sortedBy { it.second.lowercase() } }
    val shown = remember(all, album) { if (album == null) all else all.filter { it.bucketId == album } }
    val title = album?.let { id -> albums.firstOrNull { it.first == id }?.second } ?: "Recents"

    Box(Modifier.fillMaxSize().background(Color.Black)) {
        Column(Modifier.fillMaxSize()) {
            Row(Modifier.fillMaxWidth().statusBarsPadding().padding(horizontal = 6.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = onClose) { Icon(Icons.Rounded.Close, "Close", tint = Color.White) }
                Box(Modifier.weight(1f), Alignment.Center) {
                    Row(Modifier.clip(RoundedCornerShape(12.dp)).clickable { albumMenu = true }.padding(horizontal = 10.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(title, color = Color.White, fontSize = 20.sp, fontWeight = FontWeight.Medium)
                        Icon(Icons.Rounded.ArrowDropDown, null, tint = Color.White)
                    }
                    DropdownMenu(albumMenu, { albumMenu = false }) {
                        DropdownMenuItem({ Text("Recents") }, onClick = { album = null; albumMenu = false })
                        albums.forEach { (id, name) -> DropdownMenuItem({ Text(name) }, onClick = { album = id; albumMenu = false }) }
                    }
                }
                IconButton(onClick = { multi = !multi; if (!multi) picked = emptyList() }) {
                    Icon(Icons.Rounded.LibraryAddCheck, "Select multiple", tint = if (multi) Color(0xFF6FF7CF) else Color.White)
                }
            }
            LazyVerticalGrid(GridCells.Fixed(3), Modifier.fillMaxSize(), horizontalArrangement = Arrangement.spacedBy(2.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                items(shown, key = { it.uri.toString() }) { m ->
                    val idx = picked.indexOf(m.uri)
                    Box(Modifier.aspectRatio(1f).clickable {
                        if (multi) picked = if (idx >= 0) picked - m.uri else if (picked.size < 10) picked + m.uri else picked
                        else onPick(listOf(m.uri))
                    }) {
                        AsyncImage(model = m.uri, contentDescription = null, modifier = Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
                        if (m.video) Text("▶ " + durationLabel(m.durationMs), color = Color.White, fontSize = 11.sp, fontWeight = FontWeight.SemiBold,
                            modifier = Modifier.align(Alignment.BottomStart).padding(5.dp).clip(RoundedCornerShape(5.dp)).background(Color(0x88000000)).padding(horizontal = 4.dp, vertical = 1.dp))
                        if (multi) Box(Modifier.align(Alignment.TopEnd).padding(6.dp).size(24.dp).clip(CircleShape)
                            .background(if (idx >= 0) Color(0xFF22C55E) else Color(0x55000000)).border(1.5.dp, Color.White, CircleShape), Alignment.Center) {
                            if (idx >= 0) Text("${idx + 1}", color = Color.White, fontSize = 12.sp, fontWeight = FontWeight.Bold)
                        }
                        if (idx >= 0) Box(Modifier.fillMaxSize().background(Color(0x33FFFFFF)))
                    }
                }
            }
        }
        if (picked.isNotEmpty()) Row(Modifier.align(Alignment.BottomEnd).navigationBarsPadding().padding(18.dp).clip(RoundedCornerShape(28.dp)).background(Color(0xFF22C55E))
            .clickable { onPick(picked) }.padding(horizontal = 20.dp, vertical = 14.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Rounded.Send, null, tint = Color.White)
            Text("  Send ${picked.size}", color = Color.White, fontWeight = FontWeight.SemiBold)
        }
        if (shown.isEmpty()) Box(Modifier.fillMaxSize(), Alignment.Center) { Text("No photos or videos", color = Color.White.copy(alpha = 0.7f)) }
    }
}
