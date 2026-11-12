package com.wispchat.app.ui

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.*
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectVerticalDragGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.*
import androidx.compose.foundation.shape.*
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.*
import androidx.compose.ui.draw.*
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.*
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.*
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.*
import androidx.compose.ui.text.style.*
import androidx.compose.ui.unit.*
import coil.compose.AsyncImage
import com.wispchat.app.data.StatusEntry
import com.wispchat.app.data.StatusItem
import com.wispchat.app.repo
import kotlinx.coroutines.launch

const val MAX_STATUSES = 5
private val STATUS_COLORS = listOf("#5ef2c0", "#38bdf8", "#a78bfa", "#f5a65b", "#f87171", "#ec4899", "#22c55e", "#64748b", "#0f141d")

private fun hex(h: String): Color = try { Color(android.graphics.Color.parseColor(h)) } catch (_: Exception) { Mint }

/** Ring made of one arc per status slide; seen slides are grey, like WhatsApp. */
@Composable
fun SegmentedRing(count: Int, seenCount: Int, size: Dp, content: @Composable () -> Unit) {
    val grey = wc.surface4
    Box(Modifier.size(size + 12.dp), Alignment.Center) {
        Canvas(Modifier.fillMaxSize()) {
            val w = 3.dp.toPx(); val n = count.coerceAtLeast(1)
            val gap = if (n == 1) 0f else 10f; val sweep = 360f / n - gap
            for (i in 0 until n) {
                val c: Brush = if (i < seenCount) Brush.linearGradient(listOf(grey, grey)) else Brand
                drawArc(c, -90f + i * (360f / n) + gap / 2, sweep, false, Offset(w / 2, w / 2), Size(this.size.width - w, this.size.height - w), style = Stroke(w, cap = StrokeCap.Round))
            }
        }
        content()
    }
}

// ================================================================================================ tab

@Composable
fun StatusTab(nav: Nav) {
    val ctx = LocalContext.current
    val repo = ctx.repo
    val social = repo.social
    val me by repo.me.collectAsState()
    val feed by social.status.collectAsState()
    val loading by social.statusLoading.collectAsState()
    val my = feed.firstOrNull { it.user.id == me?.id }
    val others = feed.filter { it.user.id != me?.id }.sortedByDescending { it.latestAt }
    val unseen = others.filter { !it.allSeen }
    val seen = others.filter { it.allSeen }
    val atLimit = (my?.items?.size ?: 0) >= MAX_STATUSES

    val picker = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri: Uri? -> if (uri != null) nav.push(Route.StatusMedia(uri)) }
    fun addMedia() { if (atLimit) ctx.toast("You can only have $MAX_STATUSES active status updates at once") else picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageAndVideo)) }
    fun addText() { if (atLimit) ctx.toast("You can only have $MAX_STATUSES active status updates at once") else nav.push(Route.StatusText) }
    LaunchedEffect(Unit) { social.refreshStatus() }

    Box(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize()) {
            WispTopBar("Status") {
                IconButton(onClick = { nav.push(Route.StatusPrivacy) }) { Icon(Icons.Filled.Shield, "Status privacy") }
            }
            if (loading && feed.isEmpty()) SkeletonList(6, 50.dp)
            else LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 150.dp)) {
                item(key = "me") {
                    Row(Modifier.fillMaxWidth().clickable { if (my != null) nav.push(Route.StatusView(me?.id.orEmpty())) else addMedia() }.padding(horizontal = 16.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                        Box {
                            if (my != null) SegmentedRing(my.items.size, 0, 50.dp) { UserAvatar(me, 50.dp) } else Box(Modifier.size(62.dp), Alignment.Center) { UserAvatar(me, 56.dp) }
                            if (my == null) Box(Modifier.align(Alignment.BottomEnd).size(22.dp).clip(CircleShape).background(MaterialTheme.colorScheme.primary), Alignment.Center) { Icon(Icons.Filled.Add, null, Modifier.size(16.dp), tint = WispInk) }
                        }
                        Column(Modifier.padding(start = 14.dp).weight(1f)) {
                            Text("My Status", fontWeight = FontWeight.SemiBold, fontSize = 16.sp)
                            Text(if (my != null) "${my.items.size}/$MAX_STATUSES update${if (my.items.size > 1) "s" else ""} · ${formatListTime(my.latestAt)}" else "Tap to add a status update", color = wc.dim, fontSize = 13.sp)
                        }
                    }
                }
                if (unseen.isNotEmpty()) { item(key = "t1") { SectionTitle("Remaining to watch") }; items(unseen, key = { "u" + it.user.id }) { StatusRow(it, false, nav) } }
                if (seen.isNotEmpty()) { item(key = "t2") { SectionTitle("Watched") }; items(seen, key = { "s" + it.user.id }) { StatusRow(it, true, nav) } }
                if (others.isEmpty()) item(key = "empty") {
                    Column(Modifier.fillMaxWidth().padding(40.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                        StatusRingIcon(wc.dim, 40.dp)
                        Text("When your contacts post updates, they'll show up here. Statuses disappear after 24 hours.", color = wc.dim, textAlign = TextAlign.Center, modifier = Modifier.padding(top = 14.dp), fontSize = 14.sp)
                    }
                }
            }
        }
        Column(Modifier.align(Alignment.BottomEnd).padding(18.dp), horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(14.dp)) {
            SmallFloatingActionButton(onClick = { addText() }, containerColor = wc.surface3, contentColor = MaterialTheme.colorScheme.onSurface) { Icon(Icons.Filled.TextFields, "Text status") }
            FloatingActionButton(onClick = { addMedia() }, containerColor = MaterialTheme.colorScheme.primary, contentColor = WispInk) { Icon(Icons.Filled.PhotoCamera, "Photo or video status") }
        }
    }
}

@Composable
private fun StatusRow(e: StatusEntry, allSeen: Boolean, nav: Nav) {
    Row(Modifier.fillMaxWidth().clickable { nav.push(Route.StatusView(e.user.id)) }.padding(horizontal = 16.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
        SegmentedRing(e.items.size, e.items.count { it.viewedByMe }, 50.dp) { UserAvatar(e.user, 50.dp) }
        Column(Modifier.padding(start = 14.dp)) {
            Text(e.user.displayName, fontWeight = FontWeight.SemiBold, fontSize = 16.sp)
            Text(formatListTime(e.latestAt), color = wc.dim, fontSize = 13.sp)
        }
    }
}

// ================================================================================================ viewer

private val QUICK = listOf("👍", "❤️", "😂", "😮", "😢", "🙏")

/** Full-screen story viewer: segmented timer, tap left/right, hold to pause, swipe down to close, reply + react, viewers for your own. */
@Composable
fun StatusViewerScreen(userId: String, nav: Nav) {
    val ctx = LocalContext.current
    val repo = ctx.repo
    val social = repo.social
    val scope = rememberCoroutineScope()
    val feed by social.status.collectAsState()
    val myId = repo.myId
    val queue = remember {
        if (userId == myId) listOf(userId) else {
            val others = social.othersStatus
            val i = others.indexOfFirst { it.user.id == userId }
            if (i < 0) listOf(userId) else others.drop(i).map { it.user.id }
        }
    }
    var q by remember { mutableIntStateOf(0) }
    val entry = feed.firstOrNull { it.user.id == queue.getOrNull(q) }
    if (entry == null || entry.items.isEmpty()) { LaunchedEffect(feed.size, q) { nav.pop() }; Box(Modifier.fillMaxSize().background(Color.Black)); return }

    var idx by remember(q) { mutableIntStateOf(if (entry.user.id == myId) 0 else entry.items.indexOfFirst { !it.viewedByMe }.coerceAtLeast(0)) }
    val item = entry.items[idx.coerceIn(0, entry.items.lastIndex)]
    val own = entry.user.id == myId

    var touchPaused by remember { mutableStateOf(false) }
    var typingReply by remember { mutableStateOf(false) }
    var sheet by remember { mutableStateOf(false) }
    var confirmDelete by remember { mutableStateOf(false) }
    var durationMs by remember(item.id) { mutableIntStateOf(if (item.kind == "video") 30_000 else 5_000) }
    val paused = touchPaused || typingReply || sheet || confirmDelete
    val progress = remember(item.id) { Animatable(0f) }
    var dy by remember { mutableFloatStateOf(0f) }

    fun next() { if (idx < entry.items.lastIndex) idx++ else if (q < queue.lastIndex) q++ else nav.pop() }
    fun prev() { if (idx > 0) idx-- else if (q > 0) q-- }

    LaunchedEffect(item.id) { if (!own) social.viewStatus(item) }
    LaunchedEffect(item.id, paused, durationMs) {
        if (!paused) {
            progress.animateTo(1f, tween(((1f - progress.value) * durationMs).toInt().coerceAtLeast(1), easing = LinearEasing))
            next()
        }
    }

    Box(Modifier.fillMaxSize().background(Color.Black).offset { IntOffset(0, dy.toInt().coerceAtLeast(0)) }) {
        // ---- content
        when (item.kind) {
            "text" -> Box(Modifier.fillMaxSize().background(hex(item.bgColor)).padding(32.dp), Alignment.Center) {
                Text(item.text, fontSize = 30.sp, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center, color = if (hex(item.bgColor).luminance() > 0.55f) Color(0xFF0B1220) else Color.White)
            }
            "video" -> VideoPlayer(Uri.parse(absoluteUrl(item.url)), Modifier.fillMaxSize(), playing = !paused, onPrepared = { if (it > 0) durationMs = it })
            else -> NetworkImage(item.url, Modifier.fillMaxSize(), if (item.fit == "contain") ContentScale.Fit else ContentScale.Crop)
        }
        // ---- gestures (a transparent layer above the content, below the controls)
        Box(Modifier.fillMaxSize()
            .pointerInput(item.id) {
                detectTapGestures(onPress = { touchPaused = true; tryAwaitRelease(); touchPaused = false }, onTap = { p -> if (p.x < size.width * 0.33f) prev() else next() })
            }
            .pointerInput(Unit) { detectVerticalDragGestures(onDragEnd = { if (dy > 220f) nav.pop() else dy = 0f }, onDragCancel = { dy = 0f }) { _, amount -> dy += amount } })
        // ---- top: progress + who
        Column(Modifier.fillMaxWidth().background(Brush.verticalGradient(listOf(Color(0x99000000), Color.Transparent))).statusBarsPadding().padding(horizontal = 10.dp, vertical = 8.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                entry.items.forEachIndexed { i, _ ->
                    LinearProgressIndicator(progress = { if (i < idx) 1f else if (i == idx) progress.value else 0f }, Modifier.weight(1f).height(3.dp).clip(RoundedCornerShape(2.dp)), color = Color.White, trackColor = Color(0x55FFFFFF), strokeCap = StrokeCap.Butt, gapSize = 0.dp, drawStopIndicator = {})
                }
            }
            Row(Modifier.padding(top = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = { nav.pop() }, Modifier.size(36.dp)) { Icon(Icons.Filled.ArrowBack, "Close", tint = Color.White) }
                UserAvatar(entry.user, 38.dp)
                Column(Modifier.padding(start = 10.dp).weight(1f)) {
                    Text(if (own) "My Status" else entry.user.displayName, color = Color.White, fontWeight = FontWeight.SemiBold)
                    Text(formatListTime(item.createdAt), color = Color(0xCCFFFFFF), fontSize = 12.sp)
                }
                if (own) IconButton(onClick = { confirmDelete = true }) { Icon(Icons.Filled.Delete, "Delete", tint = Color.White) }
            }
        }
        // ---- bottom: caption, then viewers / reply
        Column(Modifier.align(Alignment.BottomCenter).fillMaxWidth().background(Brush.verticalGradient(listOf(Color.Transparent, Color(0xAA000000)))).navigationBarsPadding().imePadding().padding(12.dp)) {
            if (item.caption.isNotBlank()) Text(item.caption, color = Color.White, fontSize = 16.sp, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(bottom = 10.dp))
            if (own) {
                Row(Modifier.fillMaxWidth().clickable { sheet = true }.padding(vertical = 8.dp), horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Filled.Visibility, null, tint = Color.White, modifier = Modifier.size(18.dp))
                    Text("  ${item.viewerCount}", color = Color.White, fontWeight = FontWeight.SemiBold)
                }
            } else {
                var reply by remember(item.id) { mutableStateOf("") }
                Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(bottom = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    QUICK.forEach { e ->
                        Box(Modifier.clip(CircleShape).background(if (item.myReaction == e) Color(0x66FFFFFF) else Color(0x33FFFFFF)).clickable {
                            scope.launch { try { social.reactStatus(item, e); ctx.toast("Reacted $e") } catch (ex: Exception) { ctx.toast(ex.message ?: "Couldn't react") } }
                        }.padding(horizontal = 12.dp, vertical = 6.dp)) { Text(e, fontSize = 22.sp) }
                    }
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    OutlinedTextField(reply, { reply = it }, Modifier.weight(1f).onFocusChanged { typingReply = it.isFocused }, singleLine = true, placeholder = { Text("Reply to ${entry.user.displayName}…", color = Color(0xCCFFFFFF)) },
                        shape = RoundedCornerShape(28.dp), colors = OutlinedTextFieldDefaults.colors(focusedTextColor = Color.White, unfocusedTextColor = Color.White, focusedBorderColor = Color(0x99FFFFFF), unfocusedBorderColor = Color(0x66FFFFFF), cursorColor = Color.White))
                    IconButton(enabled = reply.isNotBlank(), onClick = {
                        val text = reply; reply = ""
                        scope.launch {
                            try {
                                val c = repo.openDirect(entry.user.id)
                                repo.sendText(c, text, statusReplyId = item.id)
                                ctx.toast("Reply sent")
                            } catch (ex: Exception) { ctx.toast(ex.message ?: "Couldn't send") }
                        }
                    }) { Icon(Icons.Filled.Send, "Send", tint = MaterialTheme.colorScheme.primary) }
                }
            }
        }
    }

    if (sheet) Sheet(onDismiss = { sheet = false }) {
        Text("Viewed by ${item.viewerCount}", fontWeight = FontWeight.Bold, fontSize = 18.sp, modifier = Modifier.padding(horizontal = 22.dp, vertical = 8.dp))
        if (item.viewers.isEmpty()) Text("No views yet", color = wc.dim, modifier = Modifier.padding(22.dp))
        item.viewers.sortedByDescending { it.at }.forEach { v ->
            Row(Modifier.fillMaxWidth().padding(horizontal = 22.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                UserAvatar(v.user, 42.dp)
                Column(Modifier.padding(start = 14.dp).weight(1f)) {
                    Text(v.user.displayName, fontWeight = FontWeight.Medium)
                    Text(formatListTime(v.at) + if (v.count > 1) " · ${v.count} views" else "", color = wc.dim, fontSize = 12.sp)
                }
                v.emoji?.let { Text(it, fontSize = 22.sp) }
            }
        }
    }
    if (confirmDelete) ConfirmDialog("Delete this status?", "It will be removed for everyone.", "Delete", true, {
        scope.launch { try { social.deleteStatus(item.id) } catch (ex: Exception) { ctx.toast(ex.message ?: "Couldn't delete") } }
    }, { confirmDelete = false })
}

// ================================================================================================ editors

@Composable
fun StatusTextEditor(nav: Nav) {
    val ctx = LocalContext.current
    val social = ctx.repo.social
    val scope = rememberCoroutineScope()
    var text by remember { mutableStateOf("") }
    var color by remember { mutableStateOf(STATUS_COLORS[0]) }
    var busy by remember { mutableStateOf(false) }
    val bg = hex(color)
    val ink = if (bg.luminance() > 0.55f) Color(0xFF0B1220) else Color.White
    Box(Modifier.fillMaxSize().background(bg)) {
        BasicTextField(text, { text = it.take(700) }, Modifier.align(Alignment.Center).fillMaxWidth().padding(32.dp),
            textStyle = TextStyle(color = ink, fontSize = 30.sp, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center), cursorBrush = SolidColor(ink),
            decorationBox = { inner -> Box(contentAlignment = Alignment.Center) { if (text.isEmpty()) Text("Type a status", color = ink.copy(alpha = 0.55f), fontSize = 30.sp, fontWeight = FontWeight.Bold); inner() } })
        Row(Modifier.fillMaxWidth().statusBarsPadding().padding(8.dp)) {
            IconButton(onClick = { nav.pop() }) { Icon(Icons.Filled.Close, "Cancel", tint = ink) }
        }
        Row(Modifier.align(Alignment.BottomCenter).fillMaxWidth().navigationBarsPadding().imePadding().padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
            Row(Modifier.weight(1f).horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                STATUS_COLORS.forEach { c ->
                    Box(Modifier.size(32.dp).clip(CircleShape).background(hex(c)).border(if (c == color) 3.dp else 1.dp, if (c == color) ink else ink.copy(alpha = 0.3f), CircleShape).clickable { color = c })
                }
            }
            FloatingActionButton(onClick = {
                if (text.isBlank() || busy) return@FloatingActionButton
                busy = true
                scope.launch { try { social.postTextStatus(text, color); nav.pop() } catch (e: Exception) { ctx.toast(e.message ?: "Couldn't post"); busy = false } }
            }, containerColor = MaterialTheme.colorScheme.primary, contentColor = WispInk) {
                if (busy) CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = 2.dp, color = WispInk) else Icon(Icons.Filled.Send, "Post")
            }
        }
    }
}

@Composable
fun StatusMediaEditor(uri: Uri, nav: Nav) {
    val ctx = LocalContext.current
    val social = ctx.repo.social
    val scope = rememberCoroutineScope()
    val isVideo = remember(uri) { ctx.contentResolver.getType(uri)?.startsWith("video") == true }
    var caption by remember { mutableStateOf("") }
    var fit by remember { mutableStateOf("cover") }
    var busy by remember { mutableStateOf(false) }
    Box(Modifier.fillMaxSize().background(Color.Black)) {
        if (isVideo) VideoPlayer(uri, Modifier.fillMaxSize(), loop = true)
        else AsyncImage(model = uri, contentDescription = null, modifier = Modifier.fillMaxSize(), contentScale = if (fit == "contain") ContentScale.Fit else ContentScale.Crop)
        Row(Modifier.fillMaxWidth().statusBarsPadding().padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = { nav.pop() }) { Icon(Icons.Filled.Close, "Cancel", tint = Color.White) }
            Spacer(Modifier.weight(1f))
            if (!isVideo) {
                FilterChip(selected = fit == "cover", onClick = { fit = "cover" }, label = { Text("Fill") })
                Spacer(Modifier.width(8.dp))
                FilterChip(selected = fit == "contain", onClick = { fit = "contain" }, label = { Text("Fit") })
            }
        }
        Row(Modifier.align(Alignment.BottomCenter).fillMaxWidth().background(Brush.verticalGradient(listOf(Color.Transparent, Color(0xCC000000)))).navigationBarsPadding().imePadding().padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
            OutlinedTextField(caption, { caption = it.take(300) }, Modifier.weight(1f), placeholder = { Text("Add a caption…", color = Color(0xCCFFFFFF)) }, maxLines = 3, shape = RoundedCornerShape(26.dp),
                colors = OutlinedTextFieldDefaults.colors(focusedTextColor = Color.White, unfocusedTextColor = Color.White, focusedBorderColor = Color(0x99FFFFFF), unfocusedBorderColor = Color(0x66FFFFFF), cursorColor = Color.White))
            Spacer(Modifier.width(10.dp))
            FloatingActionButton(onClick = {
                if (busy) return@FloatingActionButton
                busy = true
                scope.launch { try { social.postMediaStatus(uri, caption, fit); nav.pop() } catch (e: Exception) { ctx.toast(e.message ?: "Couldn't post"); busy = false } }
            }, containerColor = MaterialTheme.colorScheme.primary, contentColor = WispInk) {
                if (busy) CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = 2.dp, color = WispInk) else Icon(Icons.Filled.Send, "Post")
            }
        }
    }
}

// ================================================================================================ privacy

@Composable
fun StatusPrivacyScreen(nav: Nav) {
    val ctx = LocalContext.current
    val repo = ctx.repo
    val scope = rememberCoroutineScope()
    val contacts by repo.social.contacts.collectAsState()
    val initial = remember { repo.statusPrivacy() }
    var mode by remember { mutableStateOf(initial.optString("mode", "contacts")) }
    fun ids(k: String): Set<String> = initial.optJSONArray(k)?.let { a -> (0 until a.length()).map { i -> a.opt(i).toString() }.toSet() } ?: emptySet()
    var except by remember { mutableStateOf(ids("exceptUsers")) }
    var only by remember { mutableStateOf(ids("onlyUsers")) }
    var busy by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { repo.social.refreshContacts() }

    Column(Modifier.fillMaxSize()) {
        WispTopBar("Status privacy", onBack = { nav.pop() })
        Text("Who can see my status updates", color = wc.dim, fontSize = 14.sp, modifier = Modifier.padding(horizontal = 20.dp, vertical = 6.dp))
        listOf("contacts" to "My contacts", "contacts_except" to "My contacts except…", "only_share_with" to "Only share with…").forEach { (m, label) ->
            Row(Modifier.fillMaxWidth().clickable { mode = m }.padding(horizontal = 12.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                RadioButton(mode == m, { mode = m }); Text(label, fontSize = 16.sp)
            }
        }
        if (mode != "contacts") {
            SectionTitle(if (mode == "contacts_except") "Hide from" else "Share with")
            val sel = if (mode == "contacts_except") except else only
            LazyColumn(Modifier.weight(1f)) {
                items(contacts, key = { it.id }) { u ->
                    val on = u.id in sel
                    Row(Modifier.fillMaxWidth().clickable {
                        val next = if (on) sel - u.id else sel + u.id
                        if (mode == "contacts_except") except = next else only = next
                    }.padding(horizontal = 20.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                        UserAvatar(u, 40.dp); Text(u.displayName, Modifier.padding(start = 14.dp).weight(1f)); Checkbox(on, null)
                    }
                }
            }
        } else Spacer(Modifier.weight(1f))
        Button(onClick = {
            busy = true
            scope.launch { try { repo.social.setStatusPrivacy(mode, except.toList(), only.toList()); ctx.toast("Status privacy saved"); nav.pop() } catch (e: Exception) { ctx.toast(e.message ?: "Couldn't save"); busy = false } }
        }, enabled = !busy && (mode == "contacts" || (if (mode == "contacts_except") true else only.isNotEmpty())), modifier = Modifier.fillMaxWidth().padding(16.dp).navigationBarsPadding().height(50.dp)) { Text("Save") }
    }
}
