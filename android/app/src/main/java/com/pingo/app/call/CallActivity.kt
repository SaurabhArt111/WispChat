package com.pingo.app.call

import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CallEnd
import androidx.compose.material.icons.filled.FlipCameraAndroid
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.MicOff
import androidx.compose.material.icons.filled.Videocam
import androidx.compose.material.icons.filled.VideocamOff
import androidx.compose.material.icons.filled.VolumeUp
import androidx.compose.material.icons.filled.VolumeDown
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import com.pingo.app.calls
import com.pingo.app.ui.Avatar
import com.pingo.app.ui.PingoTheme
import kotlinx.coroutines.delay
import org.webrtc.RendererCommon
import org.webrtc.SurfaceViewRenderer
import org.webrtc.VideoTrack

/** The live call: remote video full-screen, local preview, and big icon controls. */
class CallActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        if (android.os.Build.VERSION.SDK_INT >= 27) setShowWhenLocked(true)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        setContent { PingoTheme { CallUi(onClose = { finish() }) } }
    }
}

@Composable
private fun CallUi(onClose: () -> Unit) {
    val engine = LocalContext.current.calls
    val st by engine.state.collectAsState()
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) { while (true) { now = System.currentTimeMillis(); delay(1000) } }
    LaunchedEffect(st.phase) {
        if (st.phase == Phase.ENDED) { delay(1500); onClose() }
        if (st.phase == Phase.IDLE) onClose()
    }

    val video = st.kind == "video"
    val status = when (st.phase) {
        Phase.OUTGOING -> "Calling…"
        Phase.INCOMING, Phase.CONNECTING -> "Connecting…"
        Phase.CONNECTED -> if (st.unstable) "Reconnecting…" else duration((now - st.connectedAt) / 1000)
        Phase.ENDED -> st.endReason.replaceFirstChar { it.uppercase() }
        Phase.IDLE -> ""
    }

    Box(Modifier.fillMaxSize().background(Brush.verticalGradient(listOf(Color(0xFF18233A), Color(0xFF080B12))))) {
        if (video && st.remoteVideo != null && !st.remoteCameraOff) VideoView(st.remoteVideo!!, engine.egl, Modifier.fillMaxSize(), mirror = false)
        else Column(Modifier.fillMaxSize().padding(top = 120.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Avatar(st.peerName, "#6EE7B7", 140.dp)
        }
        Column(Modifier.fillMaxWidth().safeDrawingPadding().padding(top = 24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Text(st.peerName, fontSize = 26.sp, fontWeight = FontWeight.Bold)
            Text(status, fontSize = 16.sp, color = Color.White.copy(alpha = 0.75f))
        }
        if (video && st.localVideo != null && st.cameraOn)
            VideoView(st.localVideo!!, engine.egl, Modifier.align(Alignment.TopEnd).safeDrawingPadding().padding(16.dp).padding(top = 64.dp).width(104.dp).height(148.dp).clip(RoundedCornerShape(16.dp)), mirror = true)

        Row(Modifier.align(Alignment.BottomCenter).fillMaxWidth().safeDrawingPadding().padding(bottom = 28.dp), horizontalArrangement = Arrangement.SpaceEvenly, verticalAlignment = Alignment.CenterVertically) {
            RoundButton(if (st.muted) Icons.Filled.MicOff else Icons.Filled.Mic, if (st.muted) Color(0xFFE5484D) else Color(0x33FFFFFF), "Mute", engine::toggleMute, 58)
            if (video) {
                RoundButton(if (st.cameraOn) Icons.Filled.Videocam else Icons.Filled.VideocamOff, if (st.cameraOn) Color(0x33FFFFFF) else Color(0xFFE5484D), "Camera", engine::toggleCamera, 58)
                RoundButton(Icons.Filled.FlipCameraAndroid, Color(0x33FFFFFF), "Flip camera", engine::switchCamera, 58)
            }
            RoundButton(if (st.speaker) Icons.Filled.VolumeUp else Icons.Filled.VolumeDown, if (st.speaker) Color(0x66FFFFFF) else Color(0x33FFFFFF), "Speaker", engine::toggleSpeaker, 58)
            RoundButton(Icons.Filled.CallEnd, Color(0xFFE5484D), "End call", engine::hangUp, 68)
        }
    }
}

@Composable
private fun VideoView(track: VideoTrack, egl: org.webrtc.EglBase, modifier: Modifier, mirror: Boolean) {
    val holder = remember { arrayOfNulls<SurfaceViewRenderer>(1) }
    AndroidView(modifier = modifier, factory = { c ->
        SurfaceViewRenderer(c).also {
            it.init(egl.eglBaseContext, null)
            it.setScalingType(RendererCommon.ScalingType.SCALE_ASPECT_FILL)
            it.setEnableHardwareScaler(true)
            it.setMirror(mirror)
            if (mirror) it.setZOrderMediaOverlay(true)
            track.addSink(it)
            holder[0] = it
        }
    })
    DisposableEffect(track) { onDispose { holder[0]?.let { track.removeSink(it); it.release() }; holder[0] = null } }
}

private fun duration(sec: Long): String = "%02d:%02d".format(sec / 60, sec % 60)
