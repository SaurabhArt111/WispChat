package com.wispchat.app.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.*
import androidx.compose.foundation.shape.*
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.*
import androidx.compose.ui.draw.*
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.*
import androidx.compose.ui.platform.*
import androidx.compose.ui.text.font.*
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.*
import androidx.compose.ui.unit.*
import com.wispchat.app.data.Conversation
import com.wispchat.app.data.Net
import com.wispchat.app.repo
import kotlinx.coroutines.launch

private enum class ChatFilter { ALL, UNREAD, GROUPS }

/** Tab 1 — all chats, WhatsApp-style: filters, search, long-press selection, pinned / muted / draft / typing states. */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun ChatsTab(nav: Nav) {
    var photoFor by remember { mutableStateOf<com.wispchat.app.data.Conversation?>(null) }
    val ctx = LocalContext.current
    val repo = ctx.repo
    val scope = rememberCoroutineScope()
    val me by repo.me.collectAsState()
    val all by repo.conversations.collectAsState()
    val loading by repo.convLoading.collectAsState()
    val error by repo.convError.collectAsState()
    val previews by repo.previews.collectAsState()
    val typing by repo.typing.collectAsState()
    val drafts by repo.settings.drafts.collectAsState()
    val presence by repo.presence.collectAsState()
    val connected by repo.rt.connected.collectAsState()
    val netKind by repo.net.kind.collectAsState()
    val reachable by repo.reachable.collectAsState()
    val pendingCount by repo.pending.count.collectAsState()
    val requests by repo.social.requests.collectAsState()
    val myId = me?.id.orEmpty()

    var filter by remember { mutableStateOf(ChatFilter.ALL) }
    var folder by remember { mutableStateOf<String?>(null) }
    var searching by remember { mutableStateOf(false) }
    var query by remember { mutableStateOf("") }
    var selected by remember { mutableStateOf(setOf<String>()) }
    var menu by remember { mutableStateOf(false) }
    var folderFor by remember { mutableStateOf<String?>(null) }
    var confirm by remember { mutableStateOf<String?>(null) } // "delete" | "clear"
    val selecting = selected.isNotEmpty()

    BackHandler(enabled = selecting) { selected = emptySet() }
    BackHandler(enabled = searching && !selecting) { searching = false; query = "" }
    LaunchedEffect(Unit) { repo.refreshConversations() }

    val visible = remember(all, filter, folder, query, previews, myId) {
        all.filter { !it.archived }
            .filter { c ->
                when {
                    folder != null -> c.folder == folder
                    filter == ChatFilter.UNREAD -> c.unread > 0
                    filter == ChatFilter.GROUPS -> c.isGroup
                    else -> true
                }
            }
            .filter { c -> query.isBlank() || c.title(myId).contains(query.trim(), true) || previews[c.id].orEmpty().contains(query.trim(), true) }
            .sortedWith(compareByDescending<Conversation> { it.pinned }.thenByDescending { it.lastMessageAt })
    }
    val archivedCount = all.count { it.archived }
    val folders = remember(all) { all.mapNotNull { it.folder }.distinct().sorted() }
    val selectedConvs = all.filter { it.id in selected }

    // The "Archived" row sits above the first chat but starts scrolled out of view; pull down to reveal it.
    val listState = rememberLazyListState()
    var archiveHidden by remember { mutableStateOf(false) }
    val archiveRowShown = archivedCount > 0 && filter == ChatFilter.ALL && folder == null && query.isBlank() && !selecting
    LaunchedEffect(archiveRowShown, visible.isNotEmpty()) {
        if (archiveRowShown && !archiveHidden && visible.isNotEmpty()) { listState.scrollToItem(1); archiveHidden = true }
    }

    fun run(block: suspend () -> Unit) = scope.launch { try { block() } catch (e: Exception) { ctx.toastErr(e, "That didn't work") } }

    Box(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize()) {
            // ---------------------------------------------------------- header / selection bar
            if (selecting) {
                val allPinned = selectedConvs.all { it.pinned }
                val allMuted = selectedConvs.all { it.muted }
                WispTopBar("${selected.size} selected", onBack = { selected = emptySet() }) {
                    IconButton(onClick = { val v = !allPinned; run { selectedConvs.forEach { repo.setFlag(it.id, "pin", v) }; selected = emptySet() } }) { Icon(Icons.Rounded.PushPin, if (allPinned) "Unpin" else "Pin") }
                    IconButton(onClick = { val v = !allMuted; run { selectedConvs.forEach { repo.setFlag(it.id, "mute", v) }; selected = emptySet() } }) { Icon(if (allMuted) Icons.Rounded.NotificationsActive else Icons.Rounded.NotificationsOff, if (allMuted) "Unmute" else "Mute") }
                    IconButton(onClick = { run { selectedConvs.forEach { repo.setFlag(it.id, "archive", true) }; selected = emptySet(); ctx.toast("Archived") } }) { Icon(Icons.Rounded.Archive, "Archive") }
                    var more by remember { mutableStateOf(false) }
                    Box {
                        IconButton(onClick = { more = true }) { Icon(Icons.Rounded.MoreVert, "More") }
                        DropdownMenu(more, { more = false }) {
                            if (selected.size == 1) {
                                val c = selectedConvs.firstOrNull()
                                DropdownMenuItem({ Text("View info") }, onClick = { more = false; c?.let { nav.push(if (it.isGroup) Route.GroupInfo(it.id) else Route.ContactInfo(it.id)); selected = emptySet() } })
                                DropdownMenuItem({ Text(if (c?.folder != null) "Folder: ${c.folder}" else "Add to folder") }, onClick = { more = false; folderFor = c?.id })
                            }
                            DropdownMenuItem({ Text("Mark as unread") }, onClick = { more = false; run { selectedConvs.forEach { repo.markUnread(it.id) }; selected = emptySet() } })
                            DropdownMenuItem({ Text("Clear chat") }, onClick = { more = false; confirm = "clear" })
                            DropdownMenuItem({ Text("Delete chat", color = MaterialTheme.colorScheme.error) }, onClick = { more = false; confirm = "delete" })
                        }
                    }
                }
            } else if (searching) {
                Row(Modifier.fillMaxWidth().statusBarsPadding().padding(horizontal = 8.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    IconButton(onClick = { searching = false; query = "" }) { Icon(Icons.Rounded.ArrowBack, "Close search") }
                    val focus = remember { androidx.compose.ui.focus.FocusRequester() }
                    LaunchedEffect(Unit) { focus.requestFocus() }
                    OutlinedTextField(query, { query = it }, Modifier.weight(1f).focusRequester(focus), singleLine = true, placeholder = { Text("Search chats") },
                        shape = RoundedCornerShape(26.dp), keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search), keyboardActions = KeyboardActions(onSearch = {}),
                        trailingIcon = { if (query.isNotEmpty()) IconButton(onClick = { query = "" }) { Icon(Icons.Rounded.Close, "Clear") } })
                }
            } else {
                Row(Modifier.fillMaxWidth().statusBarsPadding().padding(start = 16.dp, end = 4.dp, top = 10.dp, bottom = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                    Logo(34.dp)
                    Column(Modifier.padding(start = 10.dp).weight(1f)) {
                        Text("WispChat", style = MaterialTheme.typography.titleLarge)
                        val sub = when { netKind == Net.Kind.NONE -> "Waiting for network…"; !connected -> "Connecting…"; else -> null }
                        if (sub != null) Text(sub, fontSize = 11.sp, color = wc.dim)
                    }
                    IconButton(onClick = { searching = true }) { Icon(Icons.Rounded.Search, "Search") }
                    Box {
                        IconButton(onClick = { menu = true }) { BadgedBox(badge = { if (requests.any { !it.outgoing }) Badge() }) { Icon(Icons.Rounded.MoreVert, "More") } }
                    }
                }
            }

            // ---------------------------------------------------------- filter chips
            if (!selecting) Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 12.dp, vertical = 2.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilterChip(selected = filter == ChatFilter.ALL && folder == null, onClick = { filter = ChatFilter.ALL; folder = null }, label = { Text("All") })
                FilterChip(selected = filter == ChatFilter.UNREAD && folder == null, onClick = { filter = ChatFilter.UNREAD; folder = null }, label = { Text("Unread") })
                FilterChip(selected = filter == ChatFilter.GROUPS && folder == null, onClick = { filter = ChatFilter.GROUPS; folder = null }, label = { Text("Groups") })
                folders.forEach { f -> FilterChip(selected = folder == f, onClick = { folder = if (folder == f) null else f }, label = { Text(f) }, leadingIcon = { Icon(Icons.Rounded.Folder, null, Modifier.size(16.dp)) }) }
            }

            if (netKind == Net.Kind.NONE || !reachable || pendingCount > 0) Row(Modifier.fillMaxWidth().background(wc.surface2).padding(horizontal = 16.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(if (reachable) Icons.Rounded.Sync else Icons.Rounded.CloudOff, null, Modifier.size(16.dp), tint = wc.dim)
                val head = when { netKind == Net.Kind.NONE -> "Offline — showing saved chats"; !reachable -> "Can't reach WispChat — retrying"; else -> "Syncing" }
                Text("  $head" + if (pendingCount > 0) " · $pendingCount pending" else "", fontSize = 12.sp, color = wc.dim, modifier = Modifier.weight(1f))
                if (pendingCount > 0 && netKind != Net.Kind.NONE) Text("Retry", fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.clip(RoundedCornerShape(8.dp)).clickable { repo.requestSync() }.padding(horizontal = 8.dp, vertical = 2.dp))
            }

            // ---------------------------------------------------------- list
            when {
                loading && all.isEmpty() -> SkeletonList()
                error && all.isEmpty() -> EmptyState(Icons.Rounded.CloudOff, "Can't reach the server", "Your saved chats will appear as soon as the connection is back.") {
                    TextButton(onClick = { scope.launch { repo.refreshConversations() } }) { Text("Try again") }
                }
                all.isEmpty() -> EmptyState(Icons.Rounded.ChatBubble, "No chats yet", "Start a conversation with someone you know.") {
                    Button(onClick = { nav.push(Route.NewChat) }) { Icon(Icons.Rounded.Add, null); Text("  New chat") }
                }
                else -> LazyColumn(Modifier.fillMaxSize(), listState, contentPadding = PaddingValues(bottom = 96.dp)) {
                    if (archivedCount > 0 && filter == ChatFilter.ALL && folder == null && query.isBlank() && !selecting) item(key = "archived") {
                        Row(Modifier.fillMaxWidth().clickable { nav.push(Route.Archived) }.padding(horizontal = 20.dp, vertical = 14.dp), verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.Rounded.Archive, null, Modifier.size(22.dp), tint = wc.wisp)
                            Text("Archived", Modifier.padding(start = 24.dp).weight(1f), fontWeight = FontWeight.Medium)
                            Text(archivedCount.toString(), color = wc.dim, fontSize = 13.sp)
                        }
                    }
                    if (visible.isEmpty()) item(key = "none") {
                        Text(if (query.isNotBlank()) "No chats match “${query.trim()}”" else "Nothing here", color = wc.dim, modifier = Modifier.fillMaxWidth().padding(40.dp), textAlign = TextAlign.Center)
                    }
                    items(visible, key = { it.id }) { c ->
                        val other = c.other(myId)
                        ConversationRow(
                            c = c, myId = myId, preview = previews[c.id].orEmpty(), typing = typing[c.id].orEmpty().isNotEmpty(),
                            draft = drafts[c.id].orEmpty(), online = other?.let { repo.presenceOf(it).online } == true || (other != null && presence[other.id]?.online == true),
                            selected = c.id in selected,
                            modifier = Modifier.animateItem().combinedClickable(
                                onClick = { if (selecting) selected = if (c.id in selected) selected - c.id else selected + c.id else nav.openChat(c.id) },
                                onLongClick = { selected = if (c.id in selected) selected - c.id else selected + c.id },
                            ),
                            onAvatarClick = if (selecting) null else ({ photoFor = c }),
                        )
                    }
                }
            }
        }
        FloatingActionButton(onClick = { nav.push(Route.NewChat) }, modifier = Modifier.align(Alignment.BottomEnd).padding(18.dp), containerColor = MaterialTheme.colorScheme.primary, contentColor = WispInk) {
            Icon(Icons.Rounded.Chat, "New chat")
        }
    }

    photoFor?.let { c -> ProfilePopup(c, myId, nav) { photoFor = null } }
    if (menu) Sheet(onDismiss = { menu = false }) {
        SheetItem(Icons.Rounded.GroupAdd, "New group", { menu = false; nav.push(Route.NewGroup) })
        SheetItem(Icons.Rounded.Group, "Groups", { menu = false; nav.push(Route.Groups) })
        SheetItem(Icons.Rounded.PersonAdd, "Friend requests", { menu = false; nav.push(Route.FriendRequests) }, subtitle = requests.count { !it.outgoing }.takeIf { it > 0 }?.let { "$it waiting" })
        SheetItem(Icons.Rounded.Archive, "Archived", { menu = false; nav.push(Route.Archived) })
        SheetItem(Icons.Rounded.Storage, "Media & Storage", { menu = false; nav.push(Route.MediaStorage) })
        SheetItem(Icons.Rounded.Campaign, "Broadcast lists", { menu = false; nav.push(Route.Broadcast) })
        SheetItem(Icons.Rounded.Settings, "Settings", { menu = false; nav.push(Route.Settings) })
    }

    folderFor?.let { id -> FolderSheet(all.firstOrNull { it.id == id }, folders, onDismiss = { folderFor = null }) { f -> run { repo.setFolder(id, f); selected = emptySet() } } }

    when (confirm) {
        "delete" -> ConfirmDialog("Delete ${if (selected.size == 1) "this chat" else "${selected.size} chats"}?", "The chat disappears from your list and its messages are removed from this phone. Other people keep their copy, and it returns if they write again.", "Delete", true, { run { selectedConvs.forEach { repo.deleteChat(it.id) }; selected = emptySet() } }, { confirm = null })
        "clear" -> ConfirmDialog("Clear ${if (selected.size == 1) "this chat" else "${selected.size} chats"}?", "All messages are removed for you. The chat stays in your list.", "Clear", true, { run { selectedConvs.forEach { repo.clearChatEverywhere(it.id, false) }; selected = emptySet() } }, { confirm = null })
    }
}

/** One row of the chat list (also used by Archived and Groups). */
@Composable
fun ConversationRow(
    c: Conversation, myId: String, preview: String, typing: Boolean, draft: String, online: Boolean,
    selected: Boolean = false, modifier: Modifier = Modifier, onAvatarClick: (() -> Unit)? = null,
) {
    val title = c.title(myId)
    val other = c.other(myId)
    val unread = c.unread > 0
    Row(
        modifier.fillMaxWidth().background(if (selected) wc.wisp.copy(alpha = 0.22f) else Color.Transparent).padding(horizontal = 16.dp, vertical = 11.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(if (onAvatarClick != null) Modifier.clip(CircleShape).clickable(onClick = onAvatarClick) else Modifier) {
            if (c.isGroup) Avatar(title, "#64748b", 52.dp, url = c.avatar) else UserAvatar(other, 52.dp)
            if (online) OnlineDot(Modifier.align(Alignment.BottomEnd))
            if (selected) Box(Modifier.align(Alignment.BottomEnd).size(20.dp).clip(CircleShape).background(MaterialTheme.colorScheme.primary), Alignment.Center) { Icon(Icons.Rounded.Check, null, Modifier.size(14.dp), tint = WispInk) }
        }
        Column(Modifier.weight(1f).padding(horizontal = 14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(title, fontWeight = if (unread) FontWeight.Bold else FontWeight.SemiBold, fontSize = 16.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                if (c.pinned) Icon(Icons.Rounded.PushPin, "Pinned", Modifier.padding(start = 6.dp).size(13.dp), tint = wc.dim)
            }
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 2.dp)) {
                when {
                    typing -> Text("typing…", color = MaterialTheme.colorScheme.primary, fontSize = 14.sp, maxLines = 1)
                    draft.isNotEmpty() -> {
                        Text("Draft: ", color = MaterialTheme.colorScheme.primary, fontSize = 14.sp)
                        Text(draft, color = wc.dim, fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                    else -> {
                        val mine = c.lastMessage?.sender?.id == myId && preview.isNotEmpty()
                        Text(if (mine) "You: $preview" else preview, color = if (unread) MaterialTheme.colorScheme.onSurface else wc.dim, fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                }
            }
        }
        Column(horizontalAlignment = Alignment.End) {
            if (c.lastMessageAt > 0) Text(formatListTime(c.lastMessageAt), fontSize = 12.sp, color = if (unread && !c.muted) MaterialTheme.colorScheme.primary else wc.dim)
            Row(Modifier.padding(top = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                if (c.muted) Icon(Icons.Rounded.NotificationsOff, "Muted", Modifier.size(15.dp).padding(end = 2.dp), tint = wc.dim)
                if (unread) Box(
                    Modifier.padding(start = 4.dp).clip(CircleShape).background(if (c.muted) wc.surface4 else MaterialTheme.colorScheme.primary).defaultMinSize(minWidth = 22.dp, minHeight = 22.dp).padding(horizontal = 6.dp),
                    Alignment.Center,
                ) { Text(if (c.unread > 99) "99+" else c.unread.toString(), color = if (c.muted) MaterialTheme.colorScheme.onSurface else WispInk, fontSize = 11.sp, fontWeight = FontWeight.Bold) }
            }
        }
    }
}

@Composable
private fun FolderSheet(conv: Conversation?, folders: List<String>, onDismiss: () -> Unit, onPick: (String?) -> Unit) {
    var name by remember { mutableStateOf("") }
    Sheet(onDismiss) {
        Text("Add to folder", fontWeight = FontWeight.Bold, fontSize = 18.sp, modifier = Modifier.padding(horizontal = 22.dp, vertical = 8.dp))
        folders.forEach { f -> SheetItem(Icons.Rounded.Folder, f, { onDismiss(); onPick(f) }, subtitle = if (conv?.folder == f) "Current folder" else null) }
        Row(Modifier.fillMaxWidth().padding(horizontal = 18.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            OutlinedTextField(name, { name = it.take(24) }, Modifier.weight(1f), singleLine = true, placeholder = { Text("New folder name") })
            TextButton(enabled = name.isNotBlank(), onClick = { onDismiss(); onPick(name.trim()) }) { Text("Create") }
        }
        if (conv?.folder != null) SheetItem(Icons.Rounded.Close, "Remove from folder", { onDismiss(); onPick(null) }, tint = MaterialTheme.colorScheme.error)
    }
}
