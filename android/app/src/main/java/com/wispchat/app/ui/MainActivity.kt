package com.wispchat.app.ui

import android.Manifest
import android.content.Intent
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.wispchat.app.call.Phase
import com.wispchat.app.call.CallActivity
import com.wispchat.app.calls
import com.wispchat.app.repo

class MainActivity : ComponentActivity() {
    private var openConv by mutableStateOf<String?>(null)
    private var callBack by mutableStateOf<Pair<String, String>?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        openConv = intent.getStringExtra(EXTRA_CONVERSATION)
        readCallBack(intent)
        repo.restore()
        setContent {
            WispTheme {
                val me by repo.me.collectAsState()
                // Screenshots / screen recordings of WispChat come out black (Settings → Privacy → Screen security).
                val secure by repo.settings.screenSecurity.collectAsState()
                LaunchedEffect(secure) { applySecure(this@MainActivity, secure) }
                // after sign-in: every permission the app needs, asked one by one with a reason
                if (me != null) PermissionOnboarding()
                Root(openConv, onConsumed = { openConv = null }, callBack = callBack, onCallBackDone = { callBack = null })
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        intent.getStringExtra(EXTRA_CONVERSATION)?.let { openConv = it }
        readCallBack(intent)
    }

    /** "Call back" on a missed-call notification. */
    private fun readCallBack(i: Intent) {
        val conv = i.getStringExtra(EXTRA_CONVERSATION) ?: return
        val kind = i.getStringExtra(EXTRA_CALL_BACK) ?: return
        callBack = conv to kind
        i.removeExtra(EXTRA_CALL_BACK)
        com.wispchat.app.notify.Notifier.clearConversation(this, conv)
    }

    companion object {
        /** FLAG_SECURE: blocks screenshots and makes screen recordings / recent-apps previews black. */
        fun applySecure(a: android.app.Activity, on: Boolean) {
            if (on) a.window.addFlags(android.view.WindowManager.LayoutParams.FLAG_SECURE)
            else a.window.clearFlags(android.view.WindowManager.LayoutParams.FLAG_SECURE)
        }
        const val EXTRA_CONVERSATION = "conversationId"
        const val EXTRA_CALL_BACK = "callBack"
    }
}

@Composable
private fun Root(initialConv: String?, onConsumed: () -> Unit, callBack: Pair<String, String>?, onCallBackDone: () -> Unit) {
    val ctx = androidx.compose.ui.platform.LocalContext.current
    val repo = ctx.repo
    val me by repo.me.collectAsState()
    val checking by repo.checking.collectAsState()
    val call by ctx.calls.state.collectAsState()
    val nav = remember { Nav() }

    // Tapping a message notification: drop whatever was open and go straight to that chat.
    LaunchedEffect(initialConv) { if (initialConv != null) { nav.popAll(); nav.openChat(initialConv); onConsumed() } }
    // (The call screen is opened by whoever starts / answers a call, so minimising it to chat during a call sticks.)
    val startCall = rememberCallStarter()
    LaunchedEffect(callBack, me) {
        val cb = callBack ?: return@LaunchedEffect
        if (me == null) return@LaunchedEffect
        onCallBackDone()
        if (call.phase == Phase.IDLE || call.phase == Phase.ENDED) startCall({ repo.conversation(cb.first) ?: run { repo.refreshConversations(); repo.conversation(cb.first) } }, cb.second)
    }
    // Signing out clears every open page.
    LaunchedEffect(me == null) { if (me == null) nav.popAll() }

    Box(Modifier.fillMaxSize().background(androidx.compose.material3.MaterialTheme.colorScheme.background)) {
        when {
            checking -> Box(Modifier.fillMaxSize(), Alignment.Center) { Logo(96.dp) }
            me == null -> AuthScreen()
            else -> BoxWithConstraints(Modifier.fillMaxSize()) {
                val w = maxWidth
                val wide = w >= 720.dp
                nav.twoPane = wide
                val pages: @Composable () -> Unit = {
                    nav.stack.forEachIndexed { i, route ->
                        // keyed by the route too: replacing a page (New chat → the chat) gives it a fresh host instead of reusing the old one
                        key(i, route) {
                            RouteHost(isTop = i == nav.stack.lastIndex, onBack = { nav.pop() }) { RouteContent(route, nav) }
                        }
                    }
                }
                if (!wide) { AppShell(nav); pages() }
                else Row(Modifier.fillMaxSize()) {
                    AppShell(nav, wide = true, modifier = Modifier.width(if (w >= 1100.dp) 540.dp else 460.dp))
                    Box(Modifier.width(1.dp).fillMaxHeight().background(wc.border))
                    Box(Modifier.weight(1f).fillMaxHeight()) {
                        if (nav.stack.isEmpty()) Column(Modifier.fillMaxSize(), Arrangement.Center, Alignment.CenterHorizontally) {
                            Logo(88.dp)
                            androidx.compose.material3.Text("Select a chat to start messaging", color = wc.dim, modifier = Modifier.padding(top = 16.dp))
                        }
                        pages()
                    }
                }
            }
        }
    }
}

/** Every full-screen page that can open above the tabs. */
@Composable
private fun RouteContent(route: Route, nav: Nav) {
    when (route) {
        is Route.Chat -> ChatScreen(route.id, route.jumpTo, nav)
        Route.Settings -> SettingsScreen(onBack = { nav.pop() }, nav = nav)
        Route.Archived -> ArchivedScreen(nav)
        Route.Groups -> GroupsScreen(nav)
        Route.NewChat -> NewChatScreen(nav)
        Route.NewGroup -> NewGroupScreen(nav)
        Route.MediaStorage -> MediaStorageScreen(nav)
        Route.Broadcast -> BroadcastScreen(nav)
        Route.FriendRequests -> FriendRequestsScreen(nav)
        is Route.Person -> PersonScreen(route.user, nav)
        is Route.ContactInfo -> ContactInfoScreen(route.convId, nav)
        is Route.CallInfo -> CallInfoScreen(route.convId, nav)
        is Route.GroupInfo -> GroupInfoScreen(route.convId, nav)
        is Route.StatusView -> StatusViewerScreen(route.userId, nav)
        Route.StatusText -> StatusTextEditor(nav)
        is Route.StatusMedia -> StatusMediaEditor(route.uri, nav)
        Route.StatusPrivacy -> StatusPrivacyScreen(nav)
        is Route.PostView -> PostViewerScreen(route.posts, route.index, nav)
        Route.EditProfile -> EditProfileScreen(nav)
        is Route.NewPost -> NewPostScreen(route.uri, route.editing, nav)
        Route.NewCall -> NewCallScreen(nav)
        is Route.MediaDocs -> MediaDocsScreen(route.convId, nav)
    }
}
