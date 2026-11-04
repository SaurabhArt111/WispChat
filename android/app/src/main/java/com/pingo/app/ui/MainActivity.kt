package com.pingo.app.ui

import android.Manifest
import android.content.Intent
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.contract.ActivityResultContracts
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.pingo.app.call.Phase
import com.pingo.app.call.CallActivity
import com.pingo.app.calls
import com.pingo.app.repo

class MainActivity : ComponentActivity() {
    private var openConv by mutableStateOf<String?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        openConv = intent.getStringExtra(EXTRA_CONVERSATION)
        repo.restore()
        setContent {
            PingoTheme {
                val askNotif = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {}
                LaunchedEffect(Unit) {
                    if (Build.VERSION.SDK_INT >= 33) askNotif.launch(Manifest.permission.POST_NOTIFICATIONS)
                }
                Root(openConv, onConsumed = { openConv = null })
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        intent.getStringExtra(EXTRA_CONVERSATION)?.let { openConv = it }
    }

    companion object { const val EXTRA_CONVERSATION = "conversationId" }
}

@Composable
private fun Root(initialConv: String?, onConsumed: () -> Unit) {
    val ctx = androidx.compose.ui.platform.LocalContext.current
    val repo = ctx.repo
    val me by repo.me.collectAsState()
    val checking by repo.checking.collectAsState()
    val call by ctx.calls.state.collectAsState()
    var convId by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(initialConv) { if (initialConv != null) { convId = initialConv; onConsumed() } }
    // Bring the call screen up whenever a call is live and the person is in the app.
    LaunchedEffect(call.phase) {
        if (call.phase == Phase.OUTGOING || call.phase == Phase.CONNECTING || call.phase == Phase.CONNECTED)
            ctx.startActivity(Intent(ctx, CallActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP))
    }

    Box(Modifier.fillMaxSize().background(Surface0)) {
        when {
            checking -> Box(Modifier.fillMaxSize(), Alignment.Center) { Logo(96.dp) }
            me == null -> AuthScreen()
            convId != null -> ChatScreen(convId!!, onBack = { convId = null })
            else -> ChatListScreen(onOpen = { convId = it })
        }
    }
}
