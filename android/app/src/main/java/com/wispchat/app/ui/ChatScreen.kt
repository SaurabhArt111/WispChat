@file:OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class, androidx.compose.material3.ExperimentalMaterial3Api::class)

package com.wispchat.app.ui

import android.Manifest
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.media.MediaRecorder
import android.net.Uri
import android.os.Build
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.*
import androidx.compose.material.icons.outlined.Call as OutlinedCall
import androidx.compose.material.icons.outlined.Videocam as OutlinedVideocam
import androidx.compose.material.icons.outlined.Keyboard as OutlinedKeyboard
import androidx.compose.material.icons.outlined.EmojiEmotions as OutlinedEmoji
import androidx.compose.material.icons.outlined.CameraAlt as OutlinedCamera
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.*
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.animation.*
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import coil.compose.AsyncImage
import com.wispchat.app.calls
import com.wispchat.app.data.Conversation
import com.wispchat.app.data.Message
import com.wispchat.app.data.Net
import com.wispchat.app.repo
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.launch
import java.io.File

private sealed interface ChatRow {
    data class Day(val key: Int, val label: String) : ChatRow
    data class Msg(val m: Message, val showName: Boolean) : ChatRow
}

private class RecHolder { var rec: MediaRecorder? = null; var file: File? = null }

/** The conversation page: header, endless history, composer — WhatsApp-style gestures included. */
@Composable
fun ChatScreen(convId: String, jumpTo: String?, nav: Nav) {
    val ctx = LocalContext.current
    val repo = ctx.repo
    val scope = rememberCoroutineScope()
    val me by repo.me.collectAsState()
    val convs by repo.conversations.collectAsState()
    val all by repo.messages.collectAsState()
    val typing by repo.typing.collectAsState()
    val presence by repo.presence.collectAsState()
    val netKind by repo.net.kind.collectAsState()
    val enterSend by repo.settings.enterIsSend.collectAsState()
    val wpTick by repo.settings.wallpaperTick.collectAsState()
    val conv = convs.firstOrNull { it.id == convId }
    val msgs = all[convId].orEmpty()
    val myId = me?.id.orEmpty()
    val other = conv?.other(myId)
    val title = conv?.title(myId).orEmpty()
    val wallpaperId = remember(wpTick, convId) { repo.settings.wallpaper(convId) }
    val reachable by repo.reachable.collectAsState()
    val pendingCount by repo.pending.count.collectAsState()
    val syncingChats by repo.syncingChats.collectAsState()
    val syncing = convId in syncingChats
    val startCall = rememberCallStarter()

    // ---- UI state
    var tfv by remember(convId) { mutableStateOf(repo.settings.draft(convId).let { TextFieldValue(it, TextRange(it.length)) }) }
    var replyTo by remember(convId) { mutableStateOf<Message?>(null) }
    var editing by remember(convId) { mutableStateOf<Message?>(null) }
    var selected by remember(convId) { mutableStateOf(setOf<String>()) }
    var menuFor by remember { mutableStateOf<Message?>(null) }
    var reactPickerFor by remember { mutableStateOf<Message?>(null) }
    var quickReactFor by remember { mutableStateOf<Message?>(null) }
    val haptic = androidx.compose.ui.platform.LocalHapticFeedback.current
    var deleteFor by remember { mutableStateOf<List<Message>?>(null) }
    var forwardMsgs by remember { mutableStateOf<List<Message>?>(null) }
    var viewer by remember { mutableStateOf<Pair<List<MediaItem>, Int>?>(null) }
    var emojiOpen by remember { mutableStateOf(false) }
    var attachSheet by remember { mutableStateOf(false) }
    var headerMenu by remember { mutableStateOf(false) }
    var wallpaperSheet by remember { mutableStateOf(false) }
    var confirmClear by remember { mutableStateOf(false) }
    var searching by remember { mutableStateOf(false) }
    var query by remember { mutableStateOf("") }
    var matchPos by remember { mutableStateOf(0) }
    var highlightId by remember { mutableStateOf<String?>(null) }
    var loaded by remember(convId) { mutableStateOf(false) }
    var pendingMedia by remember { mutableStateOf<List<Uri>>(emptyList()) }
    var recording by remember { mutableStateOf(false) }
    var recSecs by remember { mutableStateOf(0) }
    val rec = remember { RecHolder() }
    val listState = rememberLazyListState()
    val keyboard = LocalSoftwareKeyboardController.current
    val focus = remember { FocusRequester() }
    val text = tfv.text
    val selecting = selected.isNotEmpty()

    // ---- rows (day separators + messages)
    val rows = remember(msgs, conv?.isGroup) {
        val out = ArrayList<ChatRow>(msgs.size + 8)
        var lastDay = -1; var lastSender: String? = null
        for (m in msgs) {
            val d = dayKey(m.createdAt)
            if (d != lastDay) { out += ChatRow.Day(d, formatDayLabel(m.createdAt)); lastDay = d; lastSender = null }
            val sid = m.sender?.id
            out += ChatRow.Msg(m, showName = conv?.isGroup == true && !m.isCall && sid != lastSender)
            lastSender = if (m.isCall) null else sid
        }
        out
    }
    val matches = remember(rows, query) {
        if (query.isBlank()) emptyList() else rows.mapIndexedNotNull { i, r -> if (r is ChatRow.Msg && r.m.text.contains(query.trim(), true)) i else null }
    }
    val atBottom by remember { derivedStateOf { val last = listState.layoutInfo.visibleItemsInfo.lastOrNull(); last == null || last.index >= rows.lastIndex - 1 } }
    var newBelow by remember { mutableStateOf(0) }

    BackHandler(enabled = emojiOpen) { emojiOpen = false }
    BackHandler(enabled = selecting) { selected = emptySet() }
    BackHandler(enabled = searching) { searching = false; query = "" }

    DisposableEffect(convId) { repo.setActive(convId); onDispose { repo.setActive("") } }
    LaunchedEffect(convId) {
        repo.joinConversationRoom(convId)
        // Local first: what's on the phone shows instantly (no endless skeleton while the server wakes up)…
        repo.loadLocalMessages(convId); loaded = true; repo.markRead(convId)
        // …then the newest history is fetched in the background.
        repo.refreshMessages(convId)
    }
    // draft persistence (debounced)
    LaunchedEffect(text, editing) { if (editing == null) { delay(350); repo.settings.setDraft(convId, text) } }
    LaunchedEffect(text) { if (text.isNotEmpty() && editing == null && repo.net.online) { repo.typing(convId, true); delay(2500); repo.typing(convId, false) } }
    // first paint at the newest message
    LaunchedEffect(loaded) { if (loaded && rows.isNotEmpty() && jumpTo == null) listState.scrollToItem(rows.lastIndex) }
    // follow new messages if we're at the bottom (or I sent it); otherwise count them
    var lastSeenId by remember(convId) { mutableStateOf<String?>(null) }
    LaunchedEffect(msgs.lastOrNull()?.id) {
        val last = msgs.lastOrNull() ?: return@LaunchedEffect
        if (lastSeenId == null) { lastSeenId = last.id; return@LaunchedEffect }
        if (last.id == lastSeenId) return@LaunchedEffect
        lastSeenId = last.id
        if (last.sender?.id == myId || atBottom) { listState.animateScrollToItem(rows.lastIndex); newBelow = 0; repo.markRead(convId) } else newBelow++
    }
    LaunchedEffect(atBottom) { if (atBottom) newBelow = 0 }
    // older history while scrolling up
    LaunchedEffect(convId, loaded) {
        if (!loaded) return@LaunchedEffect
        snapshotFlow { listState.firstVisibleItemIndex }.distinctUntilChanged().collect { if (it < 4) repo.loadOlder(convId) }
    }

    fun jumpToMessage(id: String) {
        val idx = rows.indexOfFirst { it is ChatRow.Msg && it.m.id == id }
        if (idx < 0) { ctx.toast("That message isn't loaded yet"); return }
        scope.launch { listState.animateScrollToItem((idx - 2).coerceAtLeast(0)); highlightId = id; delay(1600); highlightId = null }
    }
    // Opened at a specific message (reply quote, "Media, links and docs", search…): load older history until it's there.
    val latestRows by rememberUpdatedState(rows)
    LaunchedEffect(jumpTo, loaded) {
        if (jumpTo == null || !loaded) return@LaunchedEffect
        delay(150)
        repeat(40) {
            val idx = latestRows.indexOfFirst { it is ChatRow.Msg && it.m.id == jumpTo }
            if (idx >= 0) {
                listState.scrollToItem((idx - 2).coerceAtLeast(0))
                highlightId = jumpTo; delay(1800); highlightId = null
                return@LaunchedEffect
            }
            val before = repo.messages.value[convId]?.size ?: 0
            repo.loadOlder(convId)
            delay(120) // let the list recompose with the older messages
            if ((repo.messages.value[convId]?.size ?: 0) == before) { ctx.toast("That message isn't on this phone anymore"); return@LaunchedEffect }
        }
    }
    LaunchedEffect(matchPos, matches) {
        val i = matches.getOrNull(matchPos) ?: return@LaunchedEffect
        listState.animateScrollToItem((i - 2).coerceAtLeast(0))
        (rows[i] as? ChatRow.Msg)?.let { highlightId = it.m.id }
    }
    LaunchedEffect(query) { matchPos = 0 }

    // ---- actions
    fun send() {
        val c = conv ?: return; val t = text.trim(); if (t.isEmpty()) return
        val ed = editing; val rp = replyTo
        tfv = TextFieldValue(""); replyTo = null; editing = null
        repo.settings.setDraft(convId, "")
        scope.launch {
            try { if (ed != null) repo.edit(ed, t) else repo.sendText(c, t, rp?.id) }
            catch (e: Exception) { ctx.toastErr(e, "Couldn't send"); tfv = TextFieldValue(t, TextRange(t.length)); if (ed != null) editing = ed }
            if (ed == null && rows.isNotEmpty()) listState.animateScrollToItem(rows.lastIndex)
        }
    }
    fun react(m: Message, emoji: String) { scope.launch { try { repo.react(m, emoji) } catch (e: Exception) { ctx.toastErr(e, "Couldn't react") } } }
    fun startReply(m: Message) { editing = null; replyTo = m; scope.launch { delay(60); runCatching { focus.requestFocus() } } }
    fun startEdit(m: Message) { replyTo = null; editing = m; tfv = TextFieldValue(m.text, TextRange(m.text.length)); scope.launch { delay(60); runCatching { focus.requestFocus() } } }
    fun copyText(list: List<Message>) {
        val s = list.sortedBy { it.createdAt }.joinToString("\n") { it.text }.trim(); if (s.isEmpty()) return
        (ctx.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText("message", s)); ctx.toast("Copied")
    }
    fun openViewer(m: Message, a: com.wispchat.app.data.Attachment) {
        val items = msgs.filter { !it.deleted }.flatMap { x -> x.attachments.filter { it.kind == "image" || it.kind == "video" }.map { MediaItem(x, it) } }
        val i = items.indexOfFirst { it.m.id == m.id && it.a.url == a.url }
        if (i >= 0) viewer = items to i
    }

    // pickers
    val pickMedia = rememberLauncherForActivityResult(ActivityResultContracts.PickMultipleVisualMedia(10)) { uris: List<Uri> -> if (uris.isNotEmpty()) pendingMedia = uris }
    val pickFiles = rememberLauncherForActivityResult(ActivityResultContracts.GetMultipleContents()) { uris: List<Uri> ->
        val c = conv
        if (uris.isNotEmpty() && c != null) scope.launch { try { repo.sendAttachments(c, uris, "", replyTo?.id); replyTo = null } catch (e: Exception) { ctx.toastErr(e, "Couldn't attach") } }
    }
    var camFile by remember { mutableStateOf<File?>(null) }
    var cameraOpen by remember { mutableStateOf(false) }
    val takePhoto = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { ok ->
        val f = camFile; camFile = null
        if (ok && f != null && f.length() > 0) pendingMedia = listOf(fileUri(f))
    }
    val camPerm = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) cameraOpen = true else ctx.toast("Camera permission is needed")
    }

    // voice notes
    fun startRec() {
        val f = File(ctx.cacheDir, "voice_${System.currentTimeMillis()}.m4a")
        @Suppress("DEPRECATION") val r = if (Build.VERSION.SDK_INT >= 31) MediaRecorder(ctx) else MediaRecorder()
        try {
            r.setAudioSource(MediaRecorder.AudioSource.MIC); r.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4); r.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
            r.setAudioEncodingBitRate(64000); r.setAudioSamplingRate(44100); r.setOutputFile(f.path); r.prepare(); r.start()
            rec.rec = r; rec.file = f; recSecs = 0; recording = true
        } catch (e: Exception) { try { r.release() } catch (_: Exception) {}; ctx.toast("Couldn't start recording") }
    }
    fun stopRec(send: Boolean) {
        val r = rec.rec ?: return; val f = rec.file; rec.rec = null; rec.file = null; recording = false
        try { r.stop() } catch (_: Exception) { /* too short */ }
        try { r.release() } catch (_: Exception) {}
        val c = conv
        if (send && f != null && c != null && recSecs >= 1) {
            val rp = replyTo?.id; replyTo = null
            scope.launch { try { repo.sendFile(c, f, "voice-note.m4a", "audio/mp4", "", rp) } catch (e: Exception) { ctx.toastErr(e, "Couldn't send the voice note") } }
        } else f?.delete()
    }
    val micPerm = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted -> if (granted) startRec() else ctx.toast("Microphone permission is needed") }
    LaunchedEffect(recording) { while (recording) { delay(1000); recSecs++ } }
    DisposableEffect(Unit) { onDispose { rec.rec?.let { try { it.stop() } catch (_: Exception) {}; try { it.release() } catch (_: Exception) {} }; rec.rec = null; rec.file?.delete() } }

    // ---- layout
    Column(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background).imePadding()) {
        // header
        when {
            selecting -> {
                val picked = msgs.filter { it.id in selected }
                WispTopBar("${selected.size} selected", onBack = { selected = emptySet() }) {
                    if (selected.size == 1 && picked.firstOrNull()?.let { !it.deleted && it.sendState == 0 } == true) IconButton(onClick = { startReply(picked[0]); selected = emptySet() }) { Icon(Icons.Rounded.Reply, "Reply") }
                    if (picked.any { it.text.isNotEmpty() }) IconButton(onClick = { copyText(picked); selected = emptySet() }) { Icon(Icons.Rounded.ContentCopy, "Copy") }
                    if (picked.all { it.sendState == 0 && !it.deleted }) IconButton(onClick = { forwardMsgs = picked; selected = emptySet() }) { Icon(Icons.Rounded.Shortcut, "Forward") }
                    IconButton(onClick = { deleteFor = picked; selected = emptySet() }) { Icon(Icons.Rounded.Delete, "Delete") }
                }
            }
            searching -> Row(Modifier.fillMaxWidth().statusBarsPadding().padding(horizontal = 4.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = { searching = false; query = ""; highlightId = null }) { Icon(Icons.Rounded.ArrowBack, "Close search") }
                OutlinedTextField(query, { query = it }, Modifier.weight(1f), singleLine = true, shape = RoundedCornerShape(24.dp), placeholder = { Text("Search in chat") })
                Text(if (matches.isEmpty()) (if (query.isBlank()) "" else "0") else "${matchPos + 1}/${matches.size}", color = wc.dim, fontSize = 12.sp, modifier = Modifier.padding(horizontal = 6.dp))
                IconButton(enabled = matches.isNotEmpty(), onClick = { matchPos = (matchPos + 1) % matches.size }) { Icon(Icons.Rounded.KeyboardArrowUp, "Older match") }
                IconButton(enabled = matches.isNotEmpty(), onClick = { matchPos = (matchPos - 1 + matches.size) % matches.size }) { Icon(Icons.Rounded.KeyboardArrowDown, "Newer match") }
            }
            else -> Row(Modifier.fillMaxWidth().background(wc.surface2).statusBarsPadding().padding(horizontal = 4.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = { nav.pop() }) { Icon(Icons.Rounded.ArrowBack, "Back") }
                val openInfo = { conv?.let { nav.push(if (it.isGroup) Route.GroupInfo(it.id) else Route.ContactInfo(it.id)) }; Unit }
                Row(Modifier.weight(1f).clip(RoundedCornerShape(12.dp)).clickable(onClick = openInfo).padding(vertical = 2.dp), verticalAlignment = Alignment.CenterVertically) {
                    if (conv?.isGroup == true) Avatar(title, "#64748b", 40.dp, url = conv.avatar) else UserAvatar(other, 40.dp)
                    Column(Modifier.padding(start = 10.dp)) {
                        Text(title, fontWeight = FontWeight.SemiBold, fontSize = 17.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        val typers = typing[convId].orEmpty().filter { it != myId }
                        val sub = when {
                            typers.isNotEmpty() -> if (conv?.isGroup == true) (conv.participants.firstOrNull { it.id == typers.first() }?.displayName?.substringBefore(' ').orEmpty() + " is typing…") else "typing…"
                            conv?.isGroup == true -> conv.participants.joinToString(", ") { if (it.id == myId) "You" else it.displayName.substringBefore(' ') }
                            !reachable -> if (netKind == Net.Kind.NONE) "waiting for network…" else "connecting…"
                            other != null -> { val p = presence[other.id]; val on = p?.online ?: other.isOnline; if (on) "online" else formatLastSeen(p?.lastSeen ?: other.lastSeen) }
                            else -> ""
                        }
                        if (sub.isNotEmpty()) Text(sub, fontSize = 12.sp, color = if (typers.isNotEmpty() || sub == "online") MaterialTheme.colorScheme.primary else wc.dim, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                }
                if (conv?.isGroup == false) {
                    IconButton(onClick = { conv.let { c -> startCall({ c }, "video") } }) { Icon(Icons.Outlined.OutlinedVideocam, "Video call") }
                    IconButton(onClick = { conv.let { c -> startCall({ c }, "audio") } }) { Icon(Icons.Outlined.OutlinedCall, "Voice call") }
                }
                Box {
                    IconButton(onClick = { headerMenu = true }) { Icon(Icons.Rounded.MoreVert, "More") }
                    DropdownMenu(headerMenu, { headerMenu = false }) {
                        DropdownMenuItem({ Text(if (conv?.isGroup == true) "Group info" else "View contact") }, onClick = { headerMenu = false; openInfo() })
                        DropdownMenuItem({ Text("Search") }, onClick = { headerMenu = false; searching = true })
                        DropdownMenuItem({ Text(if (conv?.muted == true) "Unmute notifications" else "Mute notifications") }, onClick = { headerMenu = false; conv?.let { c -> scope.launch { try { repo.setFlag(c.id, "mute", !c.muted) } catch (e: Exception) { ctx.toastErr(e, "Failed") } } } })
                        DropdownMenuItem({ Text("Wallpaper") }, onClick = { headerMenu = false; wallpaperSheet = true })
                        DropdownMenuItem({ Text("Clear chat") }, onClick = { headerMenu = false; confirmClear = true })
                    }
                }
            }
        }
        if (!reachable) Row(Modifier.fillMaxWidth().background(wc.surface3).padding(horizontal = 16.dp, vertical = 5.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Rounded.CloudOff, null, Modifier.size(14.dp), tint = wc.dim)
            val what = if (netKind == Net.Kind.NONE) "You're offline" else "Can't reach WispChat — retrying"
            Text("  $what" + if (pendingCount > 0) " · $pendingCount pending, sent automatically when back" else " · changes are saved and sent later", fontSize = 12.sp, color = wc.dim, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }

        // messages
        ChatWallpaper(wallpaperId, Modifier.weight(1f).fillMaxWidth()) {
            when {
                msgs.isEmpty() && (!loaded || syncing) -> Column(Modifier.fillMaxSize().padding(14.dp), verticalArrangement = Arrangement.Bottom) {
                    repeat(6) { i -> Box(Modifier.fillMaxWidth().padding(vertical = 5.dp), contentAlignment = if (i % 2 == 0) Alignment.CenterStart else Alignment.CenterEnd) { SkeletonBox(width = (140 + (i * 37) % 120).dp, height = 38.dp, radius = 16.dp) } }
                }
                msgs.isEmpty() -> EmptyState(Icons.Rounded.Lock, "No messages yet", if (reachable) "Messages in this chat are end-to-end encrypted. Say hi 👋" else "Nothing saved on this phone yet. Messages you write now are sent when you're back online.")
                else -> LazyColumn(Modifier.fillMaxSize(), listState, contentPadding = PaddingValues(vertical = 8.dp)) {
                    items(rows, key = { when (it) { is ChatRow.Day -> "d${it.key}"; is ChatRow.Msg -> it.m.id } },
                        // lets the list recycle message rows with message rows (cheaper, smoother scrolling)
                        contentType = { when (it) { is ChatRow.Day -> 0; is ChatRow.Msg -> if (it.m.isCall) 1 else if (it.m.attachments.isEmpty()) 2 else 3 } }) { row ->
                        when (row) {
                            is ChatRow.Day -> DayPill(row.label)
                            is ChatRow.Msg -> {
                                val m = row.m
                                val mine = m.sender?.id == myId
                                if (m.isCall) CallPill(m, mine) else MessageBubble(
                                    m, mine, row.showName, selected = m.id in selected, highlighted = highlightId == m.id, selecting = selecting,
                                    onOpenMedia = ::openViewer, onJumpTo = ::jumpToMessage, onReact = ::react,
                                    onRetry = { scope.launch { repo.retryFailed(m.clientId) } }, onReply = { startReply(m) },
                                    onLong = { if (selecting) selected = if (m.id in selected) selected - m.id else selected + m.id else menuFor = m },
                                    onTap = { if (selecting) selected = if (m.id in selected) selected - m.id else selected + m.id },
                                    onDoubleTap = { haptic.performHapticFeedback(androidx.compose.ui.hapticfeedback.HapticFeedbackType.LongPress); quickReactFor = m },
                                    modifier = Modifier.animateItem(),
                                )
                            }
                        }
                    }
                }
            }
            val stickyLabel by remember { derivedStateOf { rows.take(listState.firstVisibleItemIndex + 1).lastOrNull { it is ChatRow.Day }?.let { (it as ChatRow.Day).label } } }
            var showSticky by remember { mutableStateOf(false) }
            LaunchedEffect(listState.isScrollInProgress) { if (listState.isScrollInProgress) showSticky = true else { delay(1200); showSticky = false } }
            StickyDay(stickyLabel, showSticky)
            JumpToLatestButton(!atBottom && rows.isNotEmpty(), newBelow, wc.surface3) { scope.launch { listState.animateScrollToItem(rows.lastIndex) } }
        }

        // composer
        val blockedByAdmin = conv?.isGroup == true && conv.onlyAdminsCanMessage && !conv.isAdmin(myId) && conv.createdBy != myId
        when {
            blockedByAdmin -> Text("Only admins can send messages in this group", color = wc.dim, fontSize = 13.sp, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().background(wc.surface2).navigationBarsPadding().padding(16.dp))
            recording -> Row(Modifier.fillMaxWidth().background(wc.surface2).navigationBarsPadding().padding(10.dp), verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = { stopRec(false) }) { Icon(Icons.Rounded.Delete, "Cancel", tint = MaterialTheme.colorScheme.error) }
                Box(Modifier.size(10.dp).clip(CircleShape).background(MaterialTheme.colorScheme.error))
                Text("  ${recSecs / 60}:${"%02d".format(recSecs % 60)}", fontSize = 16.sp, modifier = Modifier.weight(1f))
                FilledIconButton(onClick = { stopRec(true) }, Modifier.size(48.dp)) { Icon(Icons.Rounded.Send, "Send voice note") }
            }
            else -> Column(Modifier.fillMaxWidth().background(wc.surface2)) {
                (replyTo ?: editing)?.let { q ->
                    val isEdit = editing != null
                    Row(Modifier.fillMaxWidth().padding(start = 10.dp, end = 4.dp, top = 8.dp).clip(RoundedCornerShape(12.dp)).background(wc.surface3).height(IntrinsicSize.Min), verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.width(4.dp).fillMaxHeight().background(MaterialTheme.colorScheme.primary))
                        Column(Modifier.weight(1f).padding(horizontal = 10.dp, vertical = 6.dp)) {
                            Text(if (isEdit) "Editing message" else if (q.sender?.id == myId) "You" else q.sender?.displayName.orEmpty(), color = MaterialTheme.colorScheme.primary, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                            Text(repo.previewText(q), color = wc.dim, fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                        IconButton(onClick = { if (isEdit) { editing = null; tfv = TextFieldValue(repo.settings.draft(convId)) } else replyTo = null }) { Icon(Icons.Rounded.Close, "Cancel") }
                    }
                }
                // WhatsApp-style input bar: a slim rounded pill (emoji · text · attach · camera) + one round button that
                // morphs between mic and send. Grows up to 6 lines, camera hides while typing to give the text room.
                Row(Modifier.fillMaxWidth().padding(start = 6.dp, end = 6.dp, top = 6.dp, bottom = 6.dp), verticalAlignment = Alignment.Bottom) {
                    Row(Modifier.weight(1f).heightIn(min = 48.dp).clip(RoundedCornerShape(24.dp)).background(wc.surface3), verticalAlignment = Alignment.Bottom) {
                        IconButton(onClick = { if (emojiOpen) { emojiOpen = false; focus.requestFocus(); keyboard?.show() } else { keyboard?.hide(); emojiOpen = true } }) {
                            Crossfade(emojiOpen, label = "emojiKb") { open -> Icon(if (open) Icons.Outlined.OutlinedKeyboard else Icons.Outlined.OutlinedEmoji, "Emoji", tint = wc.dim) }
                        }
                        Box(Modifier.weight(1f).padding(vertical = 13.dp), Alignment.CenterStart) {
                            if (tfv.text.isEmpty()) Text("Message", color = wc.dim, fontSize = 17.sp)
                            BasicTextField(
                                tfv, { tfv = it },
                                Modifier.fillMaxWidth().focusRequester(focus).onFocusChanged { if (it.isFocused) emojiOpen = false },
                                textStyle = androidx.compose.ui.text.TextStyle(color = MaterialTheme.colorScheme.onSurface, fontSize = 17.sp, lineHeight = 22.sp),
                                cursorBrush = SolidColor(MaterialTheme.colorScheme.primary), maxLines = 6,
                                keyboardOptions = KeyboardOptions(capitalization = androidx.compose.ui.text.input.KeyboardCapitalization.Sentences, imeAction = if (enterSend) ImeAction.Send else ImeAction.Default),
                                keyboardActions = KeyboardActions(onSend = { send() }),
                            )
                        }
                        IconButton(onClick = { attachSheet = true }) { Icon(Icons.Rounded.AttachFile, "Attach", tint = wc.dim, modifier = Modifier.rotate(-35f)) }
                        AnimatedVisibility(text.isEmpty(), enter = fadeIn() + expandHorizontally(), exit = fadeOut() + shrinkHorizontally()) {
                            IconButton(onClick = { camPerm.launch(Manifest.permission.CAMERA) }) { Icon(Icons.Outlined.OutlinedCamera, "Camera", tint = wc.dim) }
                        }
                    }
                    Spacer(Modifier.width(6.dp))
                    val sendMode = text.isNotBlank()
                    Box(Modifier.size(48.dp).clip(CircleShape).background(if (conv != null) MaterialTheme.colorScheme.primary else wc.surface4)
                        .clickable(enabled = conv != null) { if (sendMode) send() else micPerm.launch(Manifest.permission.RECORD_AUDIO) }, Alignment.Center) {
                        AnimatedContent(if (sendMode) (if (editing != null) 2 else 1) else 0, transitionSpec = {
                            (scaleIn(initialScale = 0.6f) + fadeIn()) togetherWith (scaleOut(targetScale = 0.6f) + fadeOut())
                        }, label = "micSend") { mode ->
                            Icon(when (mode) { 2 -> Icons.Rounded.Check; 1 -> Icons.Rounded.Send; else -> Icons.Rounded.Mic }, if (mode > 0) "Send" else "Record voice note", tint = WispInk)
                        }
                    }
                }
                if (emojiOpen) ExpressionPanel(
                    onGif = { url, sticker ->
                        val c = conv; val rp = replyTo?.id; replyTo = null
                        if (c != null) repo.scope.launch { try { repo.sendRemoteGif(c, url, sticker, rp) } catch (e: Exception) { if (e !is kotlinx.coroutines.CancellationException) android.os.Handler(android.os.Looper.getMainLooper()).post { ctx.toast(e.message ?: "Couldn't send") } } }
                    },
                    onEmoji = { e -> val s = tfv.selection; tfv = TextFieldValue(tfv.text.replaceRange(s.min, s.max, e), TextRange(s.min + e.length)) },
                    onBackspace = {
                        val s = tfv.selection
                        if (s.min != s.max) tfv = TextFieldValue(tfv.text.removeRange(s.min, s.max), TextRange(s.min))
                        else if (s.min > 0) {
                            val bi = java.text.BreakIterator.getCharacterInstance().apply { setText(tfv.text) }
                            val prev = bi.preceding(s.min).let { if (it == java.text.BreakIterator.DONE) 0 else it }
                            tfv = TextFieldValue(tfv.text.removeRange(prev, s.min), TextRange(prev))
                        }
                    },
                )
                Spacer(Modifier.navigationBarsPadding())
            }
        }
    }

    // ---- double-tap: just the reaction row (WhatsApp)
    quickReactFor?.let { m ->
        val mineEmoji = m.reactions.firstOrNull { it.userId == myId }?.emoji
        androidx.compose.ui.window.Dialog({ quickReactFor = null }) {
            Row(Modifier.clip(RoundedCornerShape(32.dp)).background(wc.surface2).padding(horizontal = 8.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                QuickReactions.forEach { e ->
                    Box(Modifier.size(46.dp).clip(CircleShape).background(if (e == mineEmoji) wc.wispDim else Color.Transparent).clickable { quickReactFor = null; react(m, e) }, Alignment.Center) { Text(e, fontSize = 28.sp) }
                }
                Box(Modifier.size(40.dp).clip(CircleShape).background(wc.surface4).clickable { quickReactFor = null; reactPickerFor = m }, Alignment.Center) { Icon(Icons.Rounded.Add, "More reactions") }
            }
        }
    }

    // ---- long-press menu
    menuFor?.let { m ->
        val mine = m.sender?.id == myId
        Sheet({ menuFor = null }) {
            if (m.sendState == 0 && !m.deleted) Row(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 6.dp), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                val mineEmoji = m.reactions.firstOrNull { it.userId == myId }?.emoji
                QuickReactions.forEach { e ->
                    Box(Modifier.size(46.dp).clip(CircleShape).background(if (e == mineEmoji) wc.wispDim else Color.Transparent).clickable { menuFor = null; react(m, e) }, Alignment.Center) { Text(e, fontSize = 27.sp) }
                }
                Box(Modifier.size(40.dp).clip(CircleShape).background(wc.surface4).clickable { menuFor = null; reactPickerFor = m }, Alignment.Center) { Icon(Icons.Rounded.Add, "More reactions") }
            }
            if (!m.deleted && m.sendState == 0) SheetItem(Icons.Rounded.Reply, "Reply", { menuFor = null; startReply(m) })
            if (m.text.isNotEmpty() && !m.deleted) SheetItem(Icons.Rounded.ContentCopy, "Copy", { menuFor = null; copyText(listOf(m)) })
            if (!m.deleted && m.sendState == 0) SheetItem(Icons.Rounded.Shortcut, "Forward", { menuFor = null; forwardMsgs = listOf(m) })
            if (mine && !m.deleted && m.sendState == 0 && m.text.isNotEmpty() && !m.isCall) SheetItem(Icons.Rounded.Edit, "Edit", { menuFor = null; startEdit(m) })
            val saveable = m.attachments.filter { !it.url.startsWith("outbox:") }
            if (saveable.isNotEmpty() && !m.deleted) SheetItem(Icons.Rounded.Download, "Save to device", {
                menuFor = null
                scope.launch { val ok = saveable.map { try { repo.saveAttachmentToDevice(m, it) } catch (_: Exception) { false } }.all { it }; ctx.toast(if (ok) "Saved to your device" else "Couldn't save") }
            })
            if (saveable.any { repo.isDownloaded(it) }) SheetItem(Icons.Rounded.FolderOff, "Remove downloaded files from this phone", { menuFor = null; scope.launch { repo.removeMediaOnly(m, alsoGallery = false); ctx.toast("Removed from this phone") } })
            SheetItem(Icons.Rounded.CheckCircle, "Select", { menuFor = null; selected = selected + m.id })
            SheetItem(Icons.Rounded.Delete, "Delete", { menuFor = null; deleteFor = listOf(m) }, tint = MaterialTheme.colorScheme.error)
        }
    }
    reactPickerFor?.let { m -> Sheet({ reactPickerFor = null }) { EmojiPanel(onPick = { e -> reactPickerFor = null; react(m, e) }, onBackspace = { reactPickerFor = null }) } }

    // ---- delete
    deleteFor?.let { list ->
        val allMine = list.all { it.sender?.id == myId && it.sendState == 0 && !it.deleted }
        val hasFiles = list.any { it.attachments.isNotEmpty() && it.sendState == 0 }
        var alsoFiles by remember(list) { mutableStateOf(true) }
        AlertDialog(onDismissRequest = { deleteFor = null }, containerColor = wc.surface2,
            title = { Text(if (list.size == 1) "Delete message?" else "Delete ${list.size} messages?") },
            text = {
                if (hasFiles) Row(Modifier.fillMaxWidth().clickable { alsoFiles = !alsoFiles }, verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(alsoFiles, { alsoFiles = it }); Text("Also delete the files from this phone (including the copy saved in your gallery)", fontSize = 14.sp)
                }
            },
            confirmButton = {
                Column(horizontalAlignment = Alignment.End) {
                    TextButton(onClick = { deleteFor = null; scope.launch { list.forEach { repo.deleteForMe(it, hasFiles && alsoFiles) } } }) { Text("Delete for me") }
                    if (allMine) TextButton(onClick = {
                        deleteFor = null
                        scope.launch { try { list.forEach { repo.deleteForEveryone(it, hasFiles && alsoFiles) } } catch (e: Exception) { ctx.toastErr(e, "Couldn't delete") } }
                    }) { Text("Delete for everyone", color = MaterialTheme.colorScheme.error) }
                    TextButton(onClick = { deleteFor = null }) { Text("Cancel") }
                }
            })
    }
    if (confirmClear) ConfirmDialog("Clear this chat?", "All messages are removed for you. Media saved on this phone is deleted too.", "Clear", true,
        { scope.launch { try { repo.clearChatEverywhere(convId, true); ctx.toast("Chat cleared") } catch (e: Exception) { ctx.toastErr(e, "Couldn't clear") } } }, { confirmClear = false })

    forwardMsgs?.let { list -> ForwardSheet(list, convId, onDismiss = { forwardMsgs = null }) }
    viewer?.let { (items, i) -> MediaViewer(items, i, onDismiss = { viewer = null }) }

    // ---- attach menu
    if (attachSheet) Sheet({ attachSheet = false }) {
        SheetItem(Icons.Rounded.PhotoLibrary, "Photos & videos", { attachSheet = false; pickMedia.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageAndVideo)) })
        SheetItem(Icons.Rounded.CameraAlt, "Camera", { attachSheet = false; camPerm.launch(Manifest.permission.CAMERA) })
        SheetItem(Icons.Rounded.InsertDriveFile, "Document or audio", { attachSheet = false; pickFiles.launch("*/*") })
    }
    if (wallpaperSheet) WallpaperPickerSheet(convId) { wallpaperSheet = false }
    if (cameraOpen) WispCamera(onDismiss = { cameraOpen = false }, onDone = { uris -> cameraOpen = false; pendingMedia = uris })
    if (pendingMedia.isNotEmpty()) SendMediaDialog(pendingMedia, onCancel = { pendingMedia = emptyList() }, onSend = { caption ->
        val uris = pendingMedia; pendingMedia = emptyList(); val c = conv; val rp = replyTo?.id; replyTo = null
        if (c != null) scope.launch { try { repo.sendAttachments(c, uris, caption, rp) } catch (e: Exception) { ctx.toastErr(e, "Couldn't send") } }
    })
}

/** Preview of the chosen photos / videos with an optional caption before they are sent. */
// Standalone so only BoxScope is an implicit receiver (inside ChatScreen the outer ColumnScope hijacks AnimatedVisibility).
@Composable
private fun BoxScope.JumpToLatestButton(visible: Boolean, newBelow: Int, container: Color, onClick: () -> Unit) {
    AnimatedVisibility(visible, Modifier.align(Alignment.BottomEnd).padding(14.dp)) {
        Box {
            SmallFloatingActionButton(onClick = onClick, containerColor = container, contentColor = MaterialTheme.colorScheme.onSurface) { Icon(Icons.Rounded.KeyboardArrowDown, "Latest") }
            if (newBelow > 0) Text(if (newBelow > 99) "99+" else "$newBelow", color = WispInk, fontSize = 11.sp, fontWeight = FontWeight.Bold,
                modifier = Modifier.align(Alignment.TopEnd).clip(CircleShape).background(MaterialTheme.colorScheme.primary).padding(horizontal = 6.dp, vertical = 1.dp))
        }
    }
}

@Composable
private fun SendMediaDialog(uris: List<Uri>, onCancel: () -> Unit, onSend: (String) -> Unit) {
    var caption by remember { mutableStateOf("") }
    var current by remember { mutableStateOf(0) }
    Dialog(onDismissRequest = onCancel, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        Column(Modifier.fillMaxSize().background(Color.Black).systemBarsPadding().imePadding()) {
            Row(Modifier.fillMaxWidth().padding(4.dp), verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = onCancel) { Icon(Icons.Rounded.Close, "Cancel", tint = Color.White) }
                Text("${uris.size} selected", color = Color.White, modifier = Modifier.weight(1f))
            }
            Box(Modifier.weight(1f).fillMaxWidth(), Alignment.Center) {
                AsyncImage(model = uris[current.coerceIn(0, uris.lastIndex)], contentDescription = null, modifier = Modifier.fillMaxSize(), contentScale = ContentScale.Fit)
            }
            if (uris.size > 1) LazyRow(contentPadding = PaddingValues(10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                items(uris.size) { i ->
                    AsyncImage(model = uris[i], contentDescription = null, modifier = Modifier.size(56.dp).clip(RoundedCornerShape(8.dp)).border(if (i == current) 2.dp else 0.dp, MaterialTheme.colorScheme.primary, RoundedCornerShape(8.dp)).clickable { current = i }, contentScale = ContentScale.Crop)
                }
            }
            Row(Modifier.fillMaxWidth().padding(10.dp), verticalAlignment = Alignment.Bottom) {
                OutlinedTextField(caption, { caption = it }, Modifier.weight(1f), placeholder = { Text("Add a caption…", color = Color(0x99FFFFFF)) }, maxLines = 4, shape = RoundedCornerShape(24.dp))
                FilledIconButton(onClick = { onSend(caption.trim()) }, Modifier.padding(start = 8.dp, bottom = 4.dp).size(50.dp)) { Icon(Icons.Rounded.Send, "Send") }
            }
        }
    }
}

/** Pick one or more chats to forward the message(s) to. */
@Composable
private fun ForwardSheet(list: List<Message>, fromConv: String, onDismiss: () -> Unit) {
    val ctx = LocalContext.current
    val repo = ctx.repo
    val scope = rememberCoroutineScope()
    val convs by repo.conversations.collectAsState()
    val myId = repo.myId
    var picked by remember { mutableStateOf(setOf<String>()) }
    var query by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    val shown = convs.filter { query.isBlank() || it.title(myId).contains(query.trim(), true) }.sortedByDescending { it.lastMessageAt }
    Sheet(onDismiss) {
        Text("Forward to…", fontWeight = FontWeight.Bold, fontSize = 18.sp, modifier = Modifier.padding(horizontal = 22.dp, vertical = 8.dp))
        OutlinedTextField(query, { query = it }, Modifier.fillMaxWidth().padding(horizontal = 16.dp), singleLine = true, shape = RoundedCornerShape(24.dp), placeholder = { Text("Search chats") }, leadingIcon = { Icon(Icons.Rounded.Search, null) })
        Column(Modifier.heightIn(max = 380.dp).verticalScroll(rememberScrollState())) {
            shown.forEach { c ->
                val on = c.id in picked
                Row(Modifier.fillMaxWidth().clickable { picked = if (on) picked - c.id else picked + c.id }.padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    if (c.isGroup) Avatar(c.title(myId), "#64748b", 42.dp, url = c.avatar) else UserAvatar(c.other(myId), 42.dp)
                    Text(c.title(myId), Modifier.weight(1f).padding(horizontal = 14.dp), maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Checkbox(on, null)
                }
            }
        }
        Button(enabled = picked.isNotEmpty() && !busy, onClick = {
            busy = true
            scope.launch {
                try { list.sortedBy { it.createdAt }.forEach { repo.forward(it, picked.toList()) }; ctx.toast("Forwarded"); onDismiss() }
                catch (e: Exception) { ctx.toastErr(e, "Couldn't forward"); busy = false }
            }
        }, modifier = Modifier.fillMaxWidth().padding(16.dp)) { if (busy) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp) else Text("Send to ${picked.size} chat${if (picked.size == 1) "" else "s"}") }
    }
}
