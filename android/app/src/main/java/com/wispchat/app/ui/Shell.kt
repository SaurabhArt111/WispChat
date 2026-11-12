package com.wispchat.app.ui

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.MutableTransitionState
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.slideInHorizontally
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Call
import androidx.compose.material.icons.filled.CallEnd
import androidx.compose.material.icons.filled.ChatBubble
import androidx.compose.material.icons.filled.Explore
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.text.font.FontWeight
import com.wispchat.app.call.Phase
import com.wispchat.app.call.CallActivity
import com.wispchat.app.calls
import com.wispchat.app.repo
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.math.roundToInt

/** The 5 swipeable tabs: Chats · Status · Explore · Calls · Profile — drag sideways or tap the bar. */
@Composable
fun AppShell(nav: Nav, wide: Boolean = false, modifier: Modifier = Modifier) {
    val ctx = LocalContext.current
    val repo = ctx.repo
    val pager = rememberPagerState(pageCount = { 5 })
    val scope = rememberCoroutineScope()
    val chats by repo.conversations.collectAsState()
    val status by repo.social.status.collectAsState()
    val me by repo.me.collectAsState()
    val unread = chats.filter { !it.archived && !it.muted }.sumOf { it.unread }
    val unseenStatus = status.any { it.user.id != me?.id && !it.allSeen }

    LaunchedEffect(nav.tabRequest) { nav.tabRequest?.let { pager.animateScrollToPage(it); nav.tabRequest = null } }
    BackHandler(enabled = pager.currentPage != TAB_CHATS && nav.stack.isEmpty()) { scope.launch { pager.animateScrollToPage(TAB_CHATS) } }

    val pick: (Int) -> Unit = { page -> scope.launch { pager.animateScrollToPage(page) } }
    val tabs: @Composable (Modifier) -> Unit = { m ->
        Column(m.background(MaterialTheme.colorScheme.background)) {
            CallBar()
            HorizontalPager(state = pager, modifier = Modifier.weight(1f).fillMaxWidth(), beyondViewportPageCount = 1) { page ->
                when (page) {
                    TAB_CHATS -> ChatsTab(nav)
                    TAB_STATUS -> StatusTab(nav)
                    TAB_EXPLORE -> ExploreTab(nav)
                    TAB_CALLS -> CallsTab(nav)
                    else -> ProfileTab(nav)
                }
            }
            if (!wide) BottomNav(pager.currentPage, unread, unseenStatus, me, pick)
        }
    }
    if (wide) Row(modifier.fillMaxSize()) {
        SideRail(pager.currentPage, unread, unseenStatus, me, pick)
        tabs(Modifier.weight(1f).fillMaxHeight())
    } else tabs(modifier.fillMaxSize())
}

/** One tab icon with its badges — shared by the bottom bar (phones) and the side rail (tablets / unfolded foldables). */
@Composable
private fun BoxScope.TabIcon(i: Int, active: Boolean, unread: Int, unseenStatus: Boolean, me: com.wispchat.app.data.User?) {
    Box(Modifier.width(58.dp).height(36.dp).clip(RoundedCornerShape(18.dp)).background(if (active) wc.wispDim else Color.Transparent), Alignment.Center) {
        val tint = if (active) wc.wisp else wc.dim
        when (i) {
            TAB_CHATS -> Icon(Icons.Filled.ChatBubble, "Chats", Modifier.size(25.dp), tint = tint)
            TAB_STATUS -> StatusRingIcon(tint)
            TAB_EXPLORE -> Icon(Icons.Filled.Explore, "Explore", Modifier.size(26.dp), tint = tint)
            TAB_CALLS -> Icon(Icons.Filled.Call, "Calls", Modifier.size(25.dp), tint = tint)
            else -> Box(Modifier.size(30.dp).clip(CircleShape).background(if (active) wc.wisp else Color.Transparent), Alignment.Center) {
                UserAvatar(me, if (active) 25.dp else 29.dp)
            }
        }
    }
    if (i == TAB_CHATS && unread > 0) Box(Modifier.align(Alignment.TopCenter).offset(x = 18.dp, y = 0.dp).clip(CircleShape).background(MaterialTheme.colorScheme.primary).height(18.dp).width(if (unread > 9) 24.dp else 18.dp), Alignment.Center) {
        Text(if (unread > 99) "99+" else unread.toString(), color = WispInk, fontSize = 10.sp, fontWeight = FontWeight.Bold)
    }
    if (i == TAB_STATUS && unseenStatus) Box(Modifier.align(Alignment.TopCenter).offset(x = 16.dp, y = 2.dp).size(9.dp).clip(CircleShape).background(MaterialTheme.colorScheme.primary))
}

@Composable
private fun SideRail(current: Int, unread: Int, unseenStatus: Boolean, me: com.wispchat.app.data.User?, onPick: (Int) -> Unit) {
    Column(Modifier.width(76.dp).fillMaxHeight().background(wc.surface2).statusBarsPadding().navigationBarsPadding().padding(vertical = 12.dp),
        horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Logo(34.dp, Modifier.padding(bottom = 10.dp))
        for (i in 0 until 5) {
            Box(Modifier.fillMaxWidth().height(52.dp).clickable(indication = null, interactionSource = remember { androidx.compose.foundation.interaction.MutableInteractionSource() }) { onPick(i) }, Alignment.Center) {
                TabIcon(i, i == current, unread, unseenStatus, me)
            }
        }
    }
}

@Composable
private fun BottomNav(current: Int, unread: Int, unseenStatus: Boolean, me: com.wispchat.app.data.User?, onPick: (Int) -> Unit) {
    Row(Modifier.fillMaxWidth().background(wc.surface2.copy(alpha = 0.97f)).navigationBarsPadding().height(64.dp), verticalAlignment = Alignment.CenterVertically) {
        for (i in 0 until 5) {
            val active = i == current
            Box(Modifier.weight(1f).fillMaxHeight().clickable(indication = null, interactionSource = remember { androidx.compose.foundation.interaction.MutableInteractionSource() }) { onPick(i) }, Alignment.Center) {
                TabIcon(i, active, unread, unseenStatus, me)
            }
        }
    }
}

/** Dashed ring — the Status tab icon. */
@Composable
fun StatusRingIcon(tint: Color, size: androidx.compose.ui.unit.Dp = 25.dp) {
    Canvas(Modifier.size(size)) {
        val w = 2.2.dp.toPx()
        val r = this.size.minDimension / 2 - w
        val dashes = 10
        val sweep = 360f / dashes
        for (k in 0 until dashes) drawArc(tint, k * sweep + 4f, sweep - 12f, false, Offset(w, w), Size(r * 2, r * 2), style = Stroke(w, cap = StrokeCap.Round))
        drawCircle(tint, r * 0.32f, center)
    }
}

/** Green "tap to return to call" bar shown on top of the app while a call is running but minimised. */
@Composable
fun CallBar() {
    val ctx = LocalContext.current
    val engine = ctx.calls
    val st by engine.state.collectAsState()
    val live = st.phase == Phase.CONNECTED || st.phase == Phase.CONNECTING || st.phase == Phase.OUTGOING
    if (!live) return
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) { while (true) { now = System.currentTimeMillis(); delay(1000) } }
    val label = when (st.phase) {
        Phase.CONNECTED -> "%02d:%02d".format(((now - st.connectedAt) / 1000) / 60, ((now - st.connectedAt) / 1000) % 60)
        Phase.OUTGOING -> "Calling…"
        else -> "Connecting…"
    }
    Row(Modifier.fillMaxWidth().background(Color(0xFF16A34A)).statusBarsPadding().clickable {
        ctx.startActivity(android.content.Intent(ctx, CallActivity::class.java).addFlags(android.content.Intent.FLAG_ACTIVITY_SINGLE_TOP))
    }.padding(horizontal = 16.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(Icons.Filled.Call, null, Modifier.size(18.dp), tint = Color.White)
        Text("  ${st.peerName} · $label", color = Color.White, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
        Text("Tap to return", color = Color.White.copy(alpha = 0.85f), fontSize = 12.sp)
        IconButton(onClick = { engine.hangUp() }, modifier = Modifier.size(32.dp)) { Icon(Icons.Filled.CallEnd, "Hang up", tint = Color.White, modifier = Modifier.size(18.dp)) }
    }
}

// ------------------------------------------------------------------------------------------------ page host

/**
 * Hosts one pushed page: slides in from the right, Back pops it, and dragging from the left edge
 * pulls the page away (swipe-back) just like Android's own apps.
 */
@Composable
fun RouteHost(isTop: Boolean, onBack: () -> Unit, content: @Composable () -> Unit) {
    val state = remember { MutableTransitionState(false).apply { targetState = true } }
    var drag by remember { mutableFloatStateOf(0f) }
    val edge = 26.dp
    BackHandler(enabled = isTop, onBack = onBack)
    AnimatedVisibility(visibleState = state, enter = slideInHorizontally(tween(220)) { it / 3 } + fadeIn(tween(220))) {
        Box(Modifier.fillMaxSize().offset { IntOffset(drag.roundToInt(), 0) }.background(MaterialTheme.colorScheme.background)) {
            content()
            if (isTop) Box(Modifier.align(Alignment.CenterStart).width(edge).fillMaxHeight(0.82f).pointerInput(Unit) {
                detectHorizontalDragGestures(
                    onDragStart = { },
                    onDragEnd = { if (drag > 110.dp.toPx()) onBack() else drag = 0f },
                    onDragCancel = { drag = 0f },
                    onHorizontalDrag = { change, amount -> change.consume(); drag = (drag + amount).coerceAtLeast(0f) },
                )
            })
        }
    }
}
