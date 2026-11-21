package com.wispchat.app.call

import android.Manifest
import android.app.KeyguardManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Call
import androidx.compose.material.icons.rounded.CallEnd
import androidx.compose.material.icons.rounded.Chat
import androidx.compose.material.icons.rounded.Videocam
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.wispchat.app.calls
import com.wispchat.app.ui.MainActivity
import com.wispchat.app.ui.WispTheme

/** Full-screen incoming call (also over the lock screen): caller photo with pulsing rings, Decline · Message · Answer. */
class IncomingCallActivity : ComponentActivity() {
    private var wantsAnswer by mutableStateOf(false)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        showOverLockScreen()
        handle(intent)
        setContent {
            WispTheme(forceDark = true) {
                val st by calls.state.collectAsState()
                val needVideo = st.kind == "video"
                val permLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { res ->
                    if (res[Manifest.permission.RECORD_AUDIO] == true) { calls.answer(); openCall() } else calls.decline()
                }
                fun accept() = permLauncher.launch(if (needVideo) arrayOf(Manifest.permission.RECORD_AUDIO, Manifest.permission.CAMERA) else arrayOf(Manifest.permission.RECORD_AUDIO))
                // Opened via the notification's "Answer" button: go straight to answering.
                LaunchedEffect(wantsAnswer) { if (wantsAnswer) { wantsAnswer = false; accept() } }
                LaunchedEffect(st.phase) {
                    if (st.phase == Phase.ENDED || st.phase == Phase.IDLE) finish()
                    if (st.phase == Phase.CONNECTING || st.phase == Phase.CONNECTED) openCall() // answered (e.g. from the notification)
                }
                BackHandler { /* keep ringing; the notification stays — like the phone app */ moveTaskToBack(true) }
                IncomingUi(st, onAccept = ::accept, onDecline = { calls.decline(); finish() }, onMessage = {
                    val conv = st.convId
                    calls.decline()
                    startActivity(Intent(this, MainActivity::class.java).putExtra(MainActivity.EXTRA_CONVERSATION, conv).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP))
                    finish()
                })
            }
        }
    }

    override fun onNewIntent(intent: Intent) { super.onNewIntent(intent); handle(intent) }

    private fun handle(i: Intent) {
        val callId = i.getStringExtra("callId") ?: return
        calls.onIncoming(callId, i.getStringExtra("convId").orEmpty(), i.getStringExtra("kind") ?: "audio",
            i.getStringExtra("name") ?: "Someone", i.getStringExtra("callerId").orEmpty(), null)
        if (i.getStringExtra("action") == "answer") wantsAnswer = true
    }

    private fun openCall() { startActivity(Intent(this, CallActivity::class.java)); finish() }

    private fun showOverLockScreen() {
        if (Build.VERSION.SDK_INT >= 27) { setShowWhenLocked(true); setTurnScreenOn(true) }
        else @Suppress("DEPRECATION") window.addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        (getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager).requestDismissKeyguard(this, null)
    }
}

@Composable
private fun IncomingUi(st: CallState, onAccept: () -> Unit, onDecline: () -> Unit, onMessage: () -> Unit) {
    val video = st.kind == "video"
    CallBackdrop {
        Column(Modifier.fillMaxSize().safeDrawingPadding().padding(horizontal = 28.dp, vertical = 24.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.SpaceBetween) {
            Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.padding(top = 24.dp)) {
                EncryptedLabel()
                Spacer(Modifier.height(18.dp))
                Text(if (video) "WispChat video call" else "WispChat voice call", fontSize = 15.sp, color = Color.White.copy(alpha = 0.7f))
                Text(st.peerName, fontSize = 32.sp, fontWeight = FontWeight.Bold, color = Color.White, modifier = Modifier.padding(top = 6.dp))
            }
            CallerPortrait(st.peerName, st.peerAvatar, st.peerColor, 132.dp, pulsing = true)
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                // the Answer button gently bobs, like the phone app's "swipe up" hint
                val t = rememberInfiniteTransition(label = "bob")
                val bob by t.animateFloat(0f, -8f, infiniteRepeatable(tween(700, easing = FastOutSlowInEasing), RepeatMode.Reverse), label = "y")
                Row(Modifier.fillMaxWidth().padding(bottom = 24.dp), horizontalArrangement = Arrangement.SpaceEvenly, verticalAlignment = Alignment.Bottom) {
                    CallControl(Icons.Rounded.CallEnd, "Decline", onDecline, color = Color(0xFFE5484D), size = 72.dp)
                    CallControl(Icons.Rounded.Chat, "Message", onMessage, size = 52.dp)
                    Box(Modifier.offset(y = bob.dp)) { CallControl(if (video) Icons.Rounded.Videocam else Icons.Rounded.Call, "Answer", onAccept, color = Color(0xFF22C55E), size = 72.dp) }
                }
            }
        }
    }
}

/** Kept for other screens that used the old helper. */
@Composable
internal fun RoundButton(icon: androidx.compose.ui.graphics.vector.ImageVector, color: Color, desc: String, onClick: () -> Unit, size: Int = 76) =
    CallControl(icon, desc, onClick, color = color, size = size.dp)
