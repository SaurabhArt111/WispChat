package com.wispchat.app.call

import android.Manifest
import android.app.KeyguardManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.clickable
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Call
import androidx.compose.material.icons.filled.CallEnd
import androidx.compose.material.icons.filled.Videocam
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.wispchat.app.calls
import com.wispchat.app.ui.Avatar
import com.wispchat.app.ui.WispTheme

/** Full-screen incoming call, shown over the lock screen. */
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
                LaunchedEffect(st.phase) { if (st.phase == Phase.ENDED || st.phase == Phase.IDLE) finish() }
                IncomingUi(st.peerName, st.kind, onAccept = ::accept, onDecline = { calls.decline(); finish() })
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
private fun IncomingUi(name: String, kind: String, onAccept: () -> Unit, onDecline: () -> Unit) {
    Box(Modifier.fillMaxSize().background(Brush.verticalGradient(listOf(Color(0xFF18233A), Color(0xFF080B12)))).safeDrawingPadding()) {
        Column(Modifier.fillMaxSize().padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.SpaceBetween) {
            Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.padding(top = 56.dp)) {
                Avatar(name, "#6EE7B7", 120.dp)
                Spacer(Modifier.height(24.dp))
                Text(name, fontSize = 30.sp, fontWeight = FontWeight.Bold)
                Icon(if (kind == "video") Icons.Filled.Videocam else Icons.Filled.Call, null, Modifier.padding(top = 12.dp).size(26.dp), tint = MaterialTheme.colorScheme.primary)
            }
            Row(Modifier.fillMaxWidth().padding(bottom = 48.dp), horizontalArrangement = Arrangement.SpaceEvenly) {
                RoundButton(Icons.Filled.CallEnd, Color(0xFFE5484D), "Decline", onDecline)
                RoundButton(if (kind == "video") Icons.Filled.Videocam else Icons.Filled.Call, Color(0xFF2FBF71), "Answer", onAccept)
            }
        }
    }
}

@Composable
internal fun RoundButton(icon: androidx.compose.ui.graphics.vector.ImageVector, color: Color, desc: String, onClick: () -> Unit, size: Int = 76) {
    Box(Modifier.size(size.dp).clip(CircleShape).background(color).clickable(onClick = onClick), Alignment.Center) {
        Icon(icon, desc, tint = Color.White, modifier = Modifier.size((size * 0.42f).dp))
    }
}
