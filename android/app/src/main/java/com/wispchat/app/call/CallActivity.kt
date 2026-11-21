package com.wispchat.app.call

import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Bluetooth
import androidx.compose.material.icons.rounded.CallEnd
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.FlipCameraAndroid
import androidx.compose.material.icons.rounded.Headset
import androidx.compose.material.icons.rounded.KeyboardArrowDown
import androidx.compose.material.icons.rounded.Mic
import androidx.compose.material.icons.rounded.MicOff
import androidx.compose.material.icons.rounded.PhoneInTalk
import androidx.compose.material.icons.rounded.Videocam
import androidx.compose.material.icons.rounded.VideocamOff
import androidx.compose.material.icons.rounded.VolumeUp
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import com.wispchat.app.calls
import com.wispchat.app.ui.Sheet
import com.wispchat.app.ui.WispTheme
import kotlinx.coroutines.delay
import org.webrtc.RendererCommon
import org.webrtc.SurfaceViewRenderer
import org.webrtc.VideoTrack
import kotlin.math.roundToInt

/**
 * The live call, phone-app style: big caller photo (voice) or full-screen video with a draggable self-view, live status,
 * audio output picker (earpiece / speaker / Bluetooth / headset), and Back just minimises it — the call carries on with the
 * green bar in the app and the ongoing-call notification.
 */
class CallActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        if (android.os.Build.VERSION.SDK_INT >= 27) setShowWhenLocked(true)
        else @Suppress("DEPRECATION") window.addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        setContent { WispTheme(forceDark = true) { CallUi(onClose = { finish() }, onMinimize = ::minimise) } }
    }

    /** Leave the call screen without hanging up — back to the chats (opening the app if the call was answered from the lock screen). */
    private fun minimise() {
        if (isTaskRoot) startActivity(android.content.Intent(this, com.wispchat.app.ui.MainActivity::class.java).addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK))
        finish()
    }
}

private fun routeIcon(r: AudioRoute): ImageVector = when (r) {
    AudioRoute.SPEAKER -> Icons.Rounded.VolumeUp
    AudioRoute.BLUETOOTH -> Icons.Rounded.Bluetooth
    AudioRoute.WIRED -> Icons.Rounded.Headset
    AudioRoute.EARPIECE -> Icons.Rounded.PhoneInTalk
}
private fun routeLabel(r: AudioRoute) = when (r) { AudioRoute.SPEAKER -> "Speaker"; AudioRoute.BLUETOOTH -> "Bluetooth"; AudioRoute.WIRED -> "Headset"; AudioRoute.EARPIECE -> "Phone" }

@Composable
private fun CallUi(onClose: () -> Unit, onMinimize: () -> Unit) {
    val engine = LocalContext.current.calls
    val st by engine.state.collectAsState()
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    var controls by remember { mutableStateOf(true) }
    var routePicker by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { while (true) { now = System.currentTimeMillis(); delay(1000) } }
    LaunchedEffect(st.phase) {
        if (st.phase == Phase.ENDED) { delay(1600); onClose() }
        if (st.phase == Phase.IDLE) onClose()
    }
    BackHandler { if (st.phase == Phase.ENDED) onClose() else onMinimize() } // the call keeps going

    val video = st.kind == "video"
    val showRemoteVideo = video && st.remoteVideo != null && !st.remoteCameraOff && st.phase == Phase.CONNECTED
    // In a video call the controls fade away after a few seconds; tap the picture to bring them back.
    LaunchedEffect(controls, showRemoteVideo) { if (controls && showRemoteVideo) { delay(5000); controls = false } }
    val status = when (st.phase) {
        Phase.OUTGOING -> if (st.ringing) "Ringing…" else "Calling…"
        Phase.INCOMING, Phase.CONNECTING -> "Connecting…"
        Phase.CONNECTED -> if (st.unstable) "Reconnecting…" else duration((now - st.connectedAt) / 1000)
        Phase.ENDED -> when (st.endReason) { "ended" -> "Call ended"; "declined" -> "Declined"; "busy" -> "Busy on another call"; "unavailable" -> "Unavailable"; "no answer" -> "No answer"; "failed" -> "Couldn't connect"; else -> st.endReason.replaceFirstChar { it.uppercase() } }
        Phase.IDLE -> ""
    }

    CallBackdrop(Modifier.clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) { controls = !controls }) {
        if (showRemoteVideo) VideoView(st.remoteVideo!!, engine.egl, Modifier.fillMaxSize(), mirror = false, overlay = false)

        // header: minimise + who + status
        AnimatedVisibility(controls || !showRemoteVideo, enter = fadeIn(), exit = fadeOut()) {
            Box(Modifier.fillMaxWidth().background(if (showRemoteVideo) Color(0x66000000) else Color.Transparent).statusBarsPadding()) {
                IconButton(onClick = onMinimize, modifier = Modifier.padding(6.dp)) { Icon(Icons.Rounded.KeyboardArrowDown, "Minimise", tint = Color.White) }
                Column(Modifier.fillMaxWidth().padding(top = if (showRemoteVideo) 8.dp else 4.dp, bottom = 10.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    EncryptedLabel()
                    if (showRemoteVideo) {
                        Text(st.peerName, fontSize = 20.sp, fontWeight = FontWeight.Bold, color = Color.White, modifier = Modifier.padding(top = 8.dp))
                        Text(status, fontSize = 14.sp, color = Color.White.copy(alpha = 0.8f))
                    }
                }
            }
        }

        if (!showRemoteVideo) Column(Modifier.fillMaxSize().safeDrawingPadding().padding(top = 96.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Text(st.peerName, fontSize = 30.sp, fontWeight = FontWeight.Bold, color = Color.White)
            Text(status, fontSize = 16.sp, color = Color.White.copy(alpha = 0.78f), modifier = Modifier.padding(top = 4.dp))
            if (st.remoteMuted && st.phase == Phase.CONNECTED) Text("${st.peerName.substringBefore(' ')} muted their microphone", fontSize = 13.sp, color = Color.White.copy(alpha = 0.6f), modifier = Modifier.padding(top = 4.dp))
            if (video && st.remoteCameraOff && st.phase == Phase.CONNECTED) Text("Camera is off", fontSize = 13.sp, color = Color.White.copy(alpha = 0.6f), modifier = Modifier.padding(top = 4.dp))
            Spacer(Modifier.height(36.dp))
            CallerPortrait(st.peerName, st.peerAvatar, st.peerColor, 136.dp, pulsing = st.phase == Phase.OUTGOING || st.phase == Phase.CONNECTING)
        }

        // self-view (drag it to any corner)
        if (video && st.localVideo != null && st.cameraOn && st.phase != Phase.ENDED) {
            BoxWithConstraints(Modifier.fillMaxSize().safeDrawingPadding()) {
                val density = LocalDensity.current
                val maxX = with(density) { (maxWidth - 124.dp).toPx() }
                val maxY = with(density) { (maxHeight - 190.dp).toPx() }
                var pos by remember { mutableStateOf(Offset(maxX, with(density) { 72.dp.toPx() })) }
                Box(Modifier.offset { IntOffset(pos.x.roundToInt(), pos.y.roundToInt()) }.width(108.dp).height(160.dp).clip(RoundedCornerShape(16.dp))
                    .pointerInput(Unit) { detectDragGestures { change, drag -> change.consume(); pos = Offset((pos.x + drag.x).coerceIn(0f, maxX), (pos.y + drag.y).coerceIn(0f, maxY)) } }) {
                    VideoView(st.localVideo!!, engine.egl, Modifier.fillMaxSize(), mirror = true, overlay = true)
                }
            }
        }

        // controls
        AnimatedVisibility(controls || !showRemoteVideo, Modifier.align(Alignment.BottomCenter), enter = fadeIn(), exit = fadeOut()) {
            Column(Modifier.fillMaxWidth().navigationBarsPadding().padding(horizontal = 14.dp, vertical = 18.dp)
                .clip(RoundedCornerShape(30.dp)).background(Color(0x99101820)).padding(vertical = 18.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly) {
                    val multi = st.routes.any { it == AudioRoute.BLUETOOTH || it == AudioRoute.WIRED }
                    CallControl(routeIcon(st.route), routeLabel(st.route), { if (multi) routePicker = true else engine.toggleSpeaker() }, on = st.route == AudioRoute.SPEAKER || st.route == AudioRoute.BLUETOOTH)
                    if (video) CallControl(if (st.cameraOn) Icons.Rounded.Videocam else Icons.Rounded.VideocamOff, if (st.cameraOn) "Camera" else "Camera off", engine::toggleCamera, on = !st.cameraOn)
                    CallControl(if (st.muted) Icons.Rounded.MicOff else Icons.Rounded.Mic, if (st.muted) "Unmute" else "Mute", engine::toggleMute, on = st.muted)
                    if (video) CallControl(Icons.Rounded.FlipCameraAndroid, "Flip", engine::switchCamera)
                }
                Spacer(Modifier.height(18.dp))
                Box(Modifier.width(168.dp).height(56.dp).clip(RoundedCornerShape(28.dp)).background(Color(0xFFE5484D)).clickable(enabled = st.phase != Phase.ENDED) { engine.hangUp() }, Alignment.Center) {
                    Icon(Icons.Rounded.CallEnd, "End call", tint = Color.White, modifier = Modifier.size(30.dp))
                }
            }
        }
    }

    if (routePicker) Sheet({ routePicker = false }) {
        Text("Audio output", fontWeight = FontWeight.Bold, fontSize = 18.sp, modifier = Modifier.padding(horizontal = 22.dp, vertical = 8.dp))
        for (r in listOf(AudioRoute.EARPIECE, AudioRoute.WIRED, AudioRoute.BLUETOOTH, AudioRoute.SPEAKER).filter { it in st.routes }) {
            Row(Modifier.fillMaxWidth().clickable { engine.selectRoute(r); routePicker = false }.padding(horizontal = 22.dp, vertical = 14.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(routeIcon(r), null, Modifier.size(24.dp))
                Text(routeLabel(r), fontSize = 16.sp, modifier = Modifier.weight(1f).padding(start = 18.dp))
                if (r == st.route) Icon(Icons.Rounded.Check, null, tint = Color(0xFF6FF7CF))
            }
        }
    }
}

@Composable
private fun VideoView(track: VideoTrack, egl: org.webrtc.EglBase, modifier: Modifier, mirror: Boolean, overlay: Boolean) {
    val holder = remember { arrayOfNulls<SurfaceViewRenderer>(1) }
    AndroidView(modifier = modifier, factory = { c ->
        SurfaceViewRenderer(c).also {
            it.init(egl.eglBaseContext, null)
            it.setScalingType(RendererCommon.ScalingType.SCALE_ASPECT_FILL)
            it.setEnableHardwareScaler(true)
            it.setMirror(mirror)
            if (overlay) it.setZOrderMediaOverlay(true)
            track.addSink(it)
            holder[0] = it
        }
    })
    DisposableEffect(track) { onDispose { holder[0]?.let { track.removeSink(it); it.release() }; holder[0] = null } }
}

private fun duration(sec: Long): String = if (sec >= 3600) "%d:%02d:%02d".format(sec / 3600, (sec / 60) % 60, sec % 60) else "%02d:%02d".format(sec / 60, sec % 60)
