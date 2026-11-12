@file:OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class, androidx.compose.material3.ExperimentalMaterial3Api::class)

package com.wispchat.app.ui

import android.net.Uri
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.*
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.wispchat.app.data.Conversation
import com.wispchat.app.data.Post
import com.wispchat.app.data.Suggestion
import com.wispchat.app.data.User
import com.wispchat.app.repo
import com.wispchat.app.util.ImageUtil
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

// ================================================================================================ Archived

@Composable
fun ArchivedScreen(nav: Nav) {
    val ctx = LocalContext.current
    val repo = ctx.repo
    val scope = rememberCoroutineScope()
    val all by repo.conversations.collectAsState()
    val previews by repo.previews.collectAsState()
    val list = all.filter { it.archived }.sortedByDescending { it.lastMessageAt }
    var sheet by remember { mutableStateOf<Conversation?>(null) }
    var confirm by remember { mutableStateOf<Conversation?>(null) }
    val myId = repo.myId

    Column(Modifier.fillMaxSize()) {
        WispTopBar("Archived", onBack = { nav.pop() }, subtitle = if (list.isEmpty()) null else "${list.size} chat${if (list.size > 1) "s" else ""}")
        if (list.isEmpty()) EmptyState(Icons.Filled.Archive, "No archived chats", "Archive a chat from the Chats tab to tuck it away here.")
        else LazyColumn(Modifier.fillMaxSize()) {
            items(list, key = { it.id }) { c ->
                ConversationRow(c, myId, previews[c.id].orEmpty(), false, "", false,
                    modifier = Modifier.animateItem().combinedClickable(onClick = { nav.openChat(c.id) }, onLongClick = { sheet = c }))
            }
        }
    }
    sheet?.let { c ->
        Sheet({ sheet = null }) {
            Text(c.title(myId), fontWeight = FontWeight.Bold, fontSize = 18.sp, modifier = Modifier.padding(horizontal = 22.dp, vertical = 8.dp))
            SheetItem(Icons.Filled.Unarchive, "Unarchive", { sheet = null; scope.launch { try { repo.setFlag(c.id, "archive", false); ctx.toast("Moved back to chats") } catch (e: Exception) { ctx.toast(e.message ?: "Failed") } } })
            SheetItem(Icons.Filled.Delete, "Delete chat", { sheet = null; confirm = c }, tint = MaterialTheme.colorScheme.error)
        }
    }
    confirm?.let { c ->
        ConfirmDialog("Delete chat?", "It will leave your list. It comes back if someone writes to you again.", "Delete", true,
            { scope.launch { try { repo.deleteChat(c.id) } catch (e: Exception) { ctx.toast(e.message ?: "Couldn't delete") } } }, { confirm = null })
    }
}

// ================================================================================================ Groups

@Composable
fun GroupsScreen(nav: Nav) {
    val repo = LocalContext.current.repo
    val all by repo.conversations.collectAsState()
    val previews by repo.previews.collectAsState()
    val groups = all.filter { it.isGroup }.sortedByDescending { it.lastMessageAt }
    Column(Modifier.fillMaxSize()) {
        WispTopBar("Groups", onBack = { nav.pop() }) { IconButton(onClick = { nav.push(Route.NewGroup) }) { Icon(Icons.Filled.GroupAdd, "New group") } }
        if (groups.isEmpty()) EmptyState(Icons.Filled.Groups, "No groups yet", "Create a group to chat with several people at once.") {
            Button(onClick = { nav.push(Route.NewGroup) }) { Icon(Icons.Filled.GroupAdd, null); Text("  New group") }
        }
        else LazyColumn(Modifier.fillMaxSize()) {
            items(groups, key = { it.id }) { c ->
                ConversationRow(c, repo.myId, previews[c.id].orEmpty(), false, "", false, modifier = Modifier.clickable { nav.openChat(c.id) })
            }
        }
    }
}

// ================================================================================================ New chat

@Composable
fun NewChatScreen(nav: Nav) {
    val ctx = LocalContext.current
    val repo = ctx.repo
    val social = repo.social
    val scope = rememberCoroutineScope()
    val contacts by social.contacts.collectAsState()
    val loaded by social.contactsLoaded.collectAsState()
    val requests by social.requests.collectAsState()
    var query by remember { mutableStateOf("") }
    var remote by remember { mutableStateOf<List<User>?>(null) }
    var liked by remember { mutableStateOf<List<Suggestion>>(emptyList()) }
    var suggested by remember { mutableStateOf<List<Suggestion>>(emptyList()) }
    var requested by remember { mutableStateOf(setOf<String>()) }
    val incoming = requests.count { !it.outgoing }

    LaunchedEffect(Unit) {
        social.refreshContacts()
        try { val (l, s) = social.suggestions(); liked = l; suggested = s } catch (_: Exception) {}
    }
    LaunchedEffect(query) {
        val q = query.trim()
        if (q.isEmpty()) { remote = null; return@LaunchedEffect }
        delay(300)
        remote = try { repo.searchUsers(q.removePrefix("@")).filter { it.id != repo.myId } } catch (_: Exception) { emptyList() }
    }
    fun open(u: User) { scope.launch { try { val c = repo.openDirect(u.id); nav.replaceTop(Route.Chat(c.id)) } catch (e: Exception) { ctx.toast(e.message ?: "Couldn't open the chat") } } }
    fun add(u: User) { requested = requested + u.id; scope.launch { try { social.sendRequest(u.id); ctx.toast("Request sent to ${u.displayName}") } catch (e: Exception) { requested = requested - u.id; ctx.toast(e.message ?: "Couldn't send the request") } } }
    val isContact = { id: String -> contacts.any { it.id == id } }
    val pending = { id: String -> id in requested || social.hasPendingRequest(id) }

    @Composable
    fun AddButton(u: User) {
        if (isContact(u.id)) TextButton(onClick = { open(u) }) { Text("Message") }
        else if (pending(u.id)) Text("Requested", color = wc.dim, fontSize = 13.sp, modifier = Modifier.padding(end = 12.dp))
        else FilledTonalButton(onClick = { add(u) }, contentPadding = PaddingValues(horizontal = 14.dp)) { Text("Add") }
    }

    Column(Modifier.fillMaxSize()) {
        WispTopBar("New chat", onBack = { nav.pop() }, subtitle = "${contacts.size} contact${if (contacts.size == 1) "" else "s"}")
        OutlinedTextField(query, { query = it }, Modifier.fillMaxWidth().padding(horizontal = 14.dp), singleLine = true, shape = RoundedCornerShape(26.dp),
            placeholder = { Text("Search name, @username or email") }, leadingIcon = { Icon(Icons.Filled.Search, null) },
            trailingIcon = { if (query.isNotEmpty()) IconButton(onClick = { query = "" }) { Icon(Icons.Filled.Close, "Clear") } })
        LazyColumn(Modifier.fillMaxSize()) {
            if (query.isBlank()) {
                item { SheetItem(Icons.Filled.GroupAdd, "New group", { nav.push(Route.NewGroup) }) }
                item { SheetItem(Icons.Filled.PersonAdd, if (incoming > 0) "Friend requests ($incoming)" else "Friend requests", { nav.push(Route.FriendRequests) }) }
                item { SectionTitle("Contacts") }
                if (!loaded && contacts.isEmpty()) items(5) { SkeletonRow(it, 46.dp) }
                else if (contacts.isEmpty()) item { Text("No contacts yet — search above or add people you like below.", color = wc.dim, modifier = Modifier.padding(horizontal = 22.dp, vertical = 8.dp)) }
                items(contacts.sortedBy { it.displayName.lowercase() }, key = { "c" + it.id }) { u -> PersonRow(u) { open(u) } }
                if (liked.isNotEmpty()) {
                    item { SectionTitle("Authors you liked") }
                    items(liked, key = { "l" + it.user.id }) { s -> PersonRow(s.user, { AddButton(s.user) }) { nav.push(Route.Person(s.user)) } }
                }
                if (suggested.isNotEmpty()) {
                    item { SectionTitle("People you may know") }
                    items(suggested, key = { "s" + it.user.id }) { s -> PersonRow(s.user, { AddButton(s.user) }) { nav.push(Route.Person(s.user)) } }
                }
            } else {
                val r = remote
                if (r == null) items(4) { SkeletonRow(it, 46.dp) }
                else if (r.isEmpty()) item { Text("No one found for “${query.trim()}”", color = wc.dim, modifier = Modifier.fillMaxWidth().padding(32.dp), textAlign = TextAlign.Center) }
                else items(r, key = { it.id }) { u -> PersonRow(u, { AddButton(u) }) { if (isContact(u.id)) open(u) else nav.push(Route.Person(u)) } }
            }
            item { Spacer(Modifier.height(24.dp)) }
        }
    }
}

// ================================================================================================ New group

@Composable
fun NewGroupScreen(nav: Nav) {
    val ctx = LocalContext.current
    val repo = ctx.repo
    val social = repo.social
    val scope = rememberCoroutineScope()
    val contacts by social.contacts.collectAsState()
    var selected by remember { mutableStateOf(listOf<String>()) }
    var step by remember { mutableStateOf(1) }
    var name by remember { mutableStateOf("") }
    var desc by remember { mutableStateOf("") }
    var avatar by remember { mutableStateOf("") }
    var query by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    val pick = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { u: Uri? ->
        if (u != null) scope.launch {
            avatar = withContext(Dispatchers.IO) { ImageUtil.decodeScaled(ctx, u, 800)?.let { ImageUtil.avatarDataUrl(ImageUtil.squareCrop(it), 256) } } ?: ""
        }
    }
    BackHandler(enabled = step == 2) { step = 1 }
    LaunchedEffect(Unit) { social.refreshContacts() }

    Column(Modifier.fillMaxSize().imePadding()) {
        if (step == 1) {
            WispTopBar("New group", onBack = { nav.pop() }, subtitle = if (selected.isEmpty()) "Add members" else "${selected.size} selected") {
                TextButton(enabled = selected.isNotEmpty(), onClick = { step = 2 }) { Text("Next", fontWeight = FontWeight.Bold) }
            }
            if (selected.isNotEmpty()) LazyRow(contentPadding = PaddingValues(horizontal = 14.dp, vertical = 6.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                items(selected, key = { it }) { id ->
                    contacts.firstOrNull { it.id == id }?.let { u ->
                        Column(Modifier.width(60.dp).clickable { selected = selected - id }, horizontalAlignment = Alignment.CenterHorizontally) {
                            Box { UserAvatar(u, 48.dp); Box(Modifier.align(Alignment.BottomEnd).size(18.dp).clip(CircleShape).background(wc.surface4), Alignment.Center) { Icon(Icons.Filled.Close, null, Modifier.size(12.dp)) } }
                            Text(u.displayName.substringBefore(' '), fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                    }
                }
            }
            OutlinedTextField(query, { query = it }, Modifier.fillMaxWidth().padding(horizontal = 14.dp), singleLine = true, shape = RoundedCornerShape(26.dp), placeholder = { Text("Search contacts") }, leadingIcon = { Icon(Icons.Filled.Search, null) })
            val shown = contacts.filter { query.isBlank() || it.displayName.contains(query.trim(), true) || it.username.contains(query.trim(), true) }.sortedBy { it.displayName.lowercase() }
            if (contacts.isEmpty()) EmptyState(Icons.Filled.People, "No contacts yet", "Add people first, then create a group.")
            else LazyColumn(Modifier.fillMaxSize()) {
                items(shown, key = { it.id }) { u ->
                    val on = u.id in selected
                    PersonRow(u, { Checkbox(on, null) }) { selected = if (on) selected - u.id else selected + u.id }
                }
            }
        } else {
            WispTopBar("Group details", onBack = { step = 1 }) {
                TextButton(enabled = name.isNotBlank() && !busy, onClick = {
                    busy = true
                    scope.launch {
                        try { val c = repo.createGroup(name.trim(), selected, desc.trim(), avatar); nav.replaceTop(Route.Chat(c.id)) }
                        catch (e: Exception) { ctx.toast(e.message ?: "Couldn't create the group"); busy = false }
                    }
                }) { if (busy) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp) else Text("Create", fontWeight = FontWeight.Bold) }
            }
            Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Box(Modifier.clickable { pick.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) }) {
                    Avatar(name.ifBlank { "G" }, "#64748b", 110.dp, url = avatar)
                    Box(Modifier.align(Alignment.BottomEnd).size(36.dp).clip(CircleShape).background(MaterialTheme.colorScheme.primary), Alignment.Center) { Icon(Icons.Filled.CameraAlt, "Photo", Modifier.size(19.dp), tint = WispInk) }
                }
                OutlinedTextField(name, { name = it.take(40) }, Modifier.fillMaxWidth().padding(top = 22.dp), label = { Text("Group name") }, singleLine = true, shape = RoundedCornerShape(14.dp))
                OutlinedTextField(desc, { desc = it.take(200) }, Modifier.fillMaxWidth().padding(top = 12.dp), label = { Text("Description (optional)") }, maxLines = 4, shape = RoundedCornerShape(14.dp))
                Text("${selected.size} member${if (selected.size == 1) "" else "s"} + you", color = wc.dim, modifier = Modifier.padding(top = 14.dp))
            }
        }
    }
}

// ================================================================================================ Contact info

@Composable
fun ContactInfoScreen(convId: String, nav: Nav) {
    val ctx = LocalContext.current
    val repo = ctx.repo
    val social = repo.social
    val scope = rememberCoroutineScope()
    val all by repo.conversations.collectAsState()
    val presence by repo.presence.collectAsState()
    val conv = all.firstOrNull { it.id == convId }
    val other = conv?.other(repo.myId)
    val startCall = rememberCallStarter()
    var posts by remember { mutableStateOf<List<Post>?>(null) }
    var confirm by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(other?.id) { other?.let { posts = try { social.userPosts(it.id) } catch (_: Exception) { emptyList() } } }
    if (conv == null || other == null) { LaunchedEffect(Unit) { nav.pop() }; return }
    val online = presence[other.id]?.online ?: other.isOnline
    val lastSeen = presence[other.id]?.lastSeen ?: other.lastSeen
    fun run(ok: String? = null, block: suspend () -> Unit) { scope.launch { try { block(); if (ok != null) ctx.toast(ok) } catch (e: Exception) { ctx.toast(e.message ?: "That didn't work") } } }

    Column(Modifier.fillMaxSize()) {
        WispTopBar("Contact info", onBack = { nav.pop() })
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
            Column(Modifier.fillMaxWidth().padding(20.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                UserAvatar(other, 110.dp)
                Text(other.displayName, fontSize = 22.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 12.dp))
                Text("@${other.username}", color = wc.dim)
                Text(if (online) "online" else formatLastSeen(lastSeen), color = if (online) MaterialTheme.colorScheme.primary else wc.dim, fontSize = 13.sp, modifier = Modifier.padding(top = 2.dp))
                Row(Modifier.padding(top = 16.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    OutlinedButton(onClick = { nav.pop() }) { Icon(Icons.Filled.Chat, null); Text("  Message") }
                    OutlinedButton(onClick = { startCall({ conv }, "audio") }) { Icon(Icons.Filled.Call, null); Text("  Audio") }
                    OutlinedButton(onClick = { startCall({ conv }, "video") }) { Icon(Icons.Filled.Videocam, null); Text("  Video") }
                }
            }
            if (other.about.isNotBlank()) { SectionTitle("About"); Text(other.about, Modifier.padding(horizontal = 20.dp, vertical = 4.dp)) }
            HorizontalDivider(color = wc.border, modifier = Modifier.padding(top = 12.dp))
            InfoSwitch(Icons.Filled.NotificationsOff, "Mute notifications", conv.muted) { v -> run { repo.setFlag(conv.id, "mute", v) } }
            InfoSwitch(Icons.Filled.PushPin, "Pin chat", conv.pinned) { v -> run { repo.setFlag(conv.id, "pin", v) } }
            InfoSwitch(Icons.Filled.Archive, "Archive chat", conv.archived) { v -> run(if (v) "Archived" else "Unarchived") { repo.setFlag(conv.id, "archive", v) } }
            HorizontalDivider(color = wc.border)
            SheetItem(Icons.Filled.CleaningServices, "Clear chat", { confirm = "clear" })
            SheetItem(Icons.Filled.Delete, "Delete chat", { confirm = "delete" }, tint = MaterialTheme.colorScheme.error)
            SheetItem(Icons.Filled.Block, "Block ${other.displayName}", { confirm = "block" }, tint = MaterialTheme.colorScheme.error)
            HorizontalDivider(color = wc.border)
            Row(Modifier.padding(horizontal = 18.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) { Icon(Icons.Filled.GridOn, null, Modifier.size(18.dp), tint = wc.wisp); Text("  Posts", fontWeight = FontWeight.SemiBold) }
            val p = posts
            when {
                p == null -> Row(Modifier.fillMaxWidth()) { repeat(3) { Box(Modifier.weight(1f).aspectRatio(1f).padding(1.dp).shimmer()) } }
                p.isEmpty() -> Text("No posts yet", color = wc.dim, modifier = Modifier.fillMaxWidth().padding(24.dp), textAlign = TextAlign.Center)
                else -> PostsGrid(p) { i -> nav.push(Route.PostView(p, i)) }
            }
            Spacer(Modifier.height(32.dp).navigationBarsPadding())
        }
    }
    when (confirm) {
        "clear" -> ConfirmDialog("Clear this chat?", "All messages are removed for you. Media saved on this phone is deleted too.", "Clear", true, { run("Chat cleared") { repo.clearChatEverywhere(conv.id, true) } }, { confirm = null })
        "delete" -> ConfirmDialog("Delete this chat?", "It leaves your list and comes back if ${other.displayName} writes again.", "Delete", true, { run { repo.deleteChat(conv.id); nav.popAll() } }, { confirm = null })
        "block" -> ConfirmDialog("Block ${other.displayName}?", "They won't be able to message or call you.", "Block", true, { run("Blocked") { repo.toggleBlock(other.id); nav.pop() } }, { confirm = null })
    }
}

@Composable
private fun InfoSwitch(icon: androidx.compose.ui.graphics.vector.ImageVector, label: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth().clickable { onChange(!checked) }.padding(horizontal = 22.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, null, Modifier.size(22.dp), tint = wc.dim)
        Text(label, fontSize = 16.sp, modifier = Modifier.weight(1f).padding(start = 18.dp))
        Switch(checked, onChange)
    }
}

// ================================================================================================ Group info

@Composable
fun GroupInfoScreen(convId: String, nav: Nav) {
    val ctx = LocalContext.current
    val repo = ctx.repo
    val social = repo.social
    val scope = rememberCoroutineScope()
    val all by repo.conversations.collectAsState()
    val contacts by social.contacts.collectAsState()
    val conv = all.firstOrNull { it.id == convId }
    val myId = repo.myId
    var editing by remember { mutableStateOf(false) }
    var name by remember(conv?.name) { mutableStateOf(conv?.name.orEmpty()) }
    var desc by remember(conv?.description) { mutableStateOf(conv?.description.orEmpty()) }
    var memberSheet by remember { mutableStateOf<User?>(null) }
    var adding by remember { mutableStateOf(false) }
    var confirm by remember { mutableStateOf<String?>(null) }
    val pick = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { u: Uri? ->
        if (u != null) scope.launch {
            try {
                val url = withContext(Dispatchers.IO) { ImageUtil.decodeScaled(ctx, u, 800)?.let { ImageUtil.avatarDataUrl(ImageUtil.squareCrop(it), 256) } } ?: return@launch
                repo.updateGroup(convId, avatar = url)
            } catch (e: Exception) { ctx.toast(e.message ?: "Couldn't update the photo") }
        }
    }
    if (conv == null) { LaunchedEffect(Unit) { nav.pop() }; return }
    val amAdmin = conv.isAdmin(myId) || conv.createdBy == myId
    fun run(ok: String? = null, block: suspend () -> Unit) { scope.launch { try { block(); if (ok != null) ctx.toast(ok) } catch (e: Exception) { ctx.toast(e.message ?: "That didn't work") } } }

    Column(Modifier.fillMaxSize()) {
        WispTopBar("Group info", onBack = { nav.pop() }) {
            if (amAdmin) IconButton(onClick = {
                if (editing) run("Group updated") { repo.updateGroup(convId, name = name.trim().ifEmpty { conv.name }, description = desc.trim()); editing = false } else editing = true
            }) { Icon(if (editing) Icons.Filled.Check else Icons.Filled.Edit, if (editing) "Save" else "Edit") }
        }
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
            Column(Modifier.fillMaxWidth().padding(20.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Box(Modifier.then(if (amAdmin) Modifier.clickable { pick.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) } else Modifier)) {
                    Avatar(conv.name.ifEmpty { "G" }, "#64748b", 110.dp, url = conv.avatar)
                    if (amAdmin) Box(Modifier.align(Alignment.BottomEnd).size(34.dp).clip(CircleShape).background(MaterialTheme.colorScheme.primary), Alignment.Center) { Icon(Icons.Filled.CameraAlt, "Photo", Modifier.size(18.dp), tint = WispInk) }
                }
                if (editing) {
                    OutlinedTextField(name, { name = it.take(40) }, Modifier.fillMaxWidth().padding(top = 16.dp), label = { Text("Group name") }, singleLine = true, shape = RoundedCornerShape(14.dp))
                    OutlinedTextField(desc, { desc = it.take(200) }, Modifier.fillMaxWidth().padding(top = 10.dp), label = { Text("Description") }, maxLines = 4, shape = RoundedCornerShape(14.dp))
                } else {
                    Text(conv.name.ifEmpty { "Group" }, fontSize = 22.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 12.dp))
                    Text("Group · ${conv.participants.size} members", color = wc.dim)
                    if (conv.description.isNotBlank()) Text(conv.description, Modifier.padding(top = 10.dp), textAlign = TextAlign.Center)
                }
            }
            HorizontalDivider(color = wc.border)
            InfoSwitch(Icons.Filled.NotificationsOff, "Mute notifications", conv.muted) { v -> run { repo.setFlag(conv.id, "mute", v) } }
            InfoSwitch(Icons.Filled.PushPin, "Pin chat", conv.pinned) { v -> run { repo.setFlag(conv.id, "pin", v) } }
            if (amAdmin) InfoSwitch(Icons.Filled.AdminPanelSettings, "Only admins can send messages", conv.onlyAdminsCanMessage) { v -> run { repo.updateGroup(convId, onlyAdmins = v) } }
            HorizontalDivider(color = wc.border)
            SectionTitle("${conv.participants.size} members")
            if (amAdmin) SheetItem(Icons.Filled.PersonAdd, "Add members", { adding = true })
            conv.participants.sortedWith(compareByDescending<User> { conv.isAdmin(it.id) || it.id == conv.createdBy }.thenBy { it.displayName.lowercase() }).forEach { u ->
                Row(Modifier.fillMaxWidth().combinedClickable(onClick = { if (u.id != myId) nav.push(Route.Person(u)) }, onLongClick = { if (amAdmin && u.id != myId) memberSheet = u })
                    .padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    UserAvatar(u, 44.dp)
                    Column(Modifier.weight(1f).padding(horizontal = 14.dp)) {
                        Text(if (u.id == myId) "You" else u.displayName, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        if (u.about.isNotBlank()) Text(u.about, fontSize = 12.sp, color = wc.dim, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                    if (conv.isAdmin(u.id) || u.id == conv.createdBy) Text("Admin", fontSize = 11.sp, color = MaterialTheme.colorScheme.primary, modifier = Modifier.clip(RoundedCornerShape(6.dp)).background(wc.wispDim).padding(horizontal = 7.dp, vertical = 2.dp))
                }
            }
            HorizontalDivider(color = wc.border, modifier = Modifier.padding(top = 8.dp))
            SheetItem(Icons.Filled.CleaningServices, "Clear chat", { confirm = "clear" })
            SheetItem(Icons.Filled.ExitToApp, "Leave group", { confirm = "leave" }, tint = MaterialTheme.colorScheme.error)
            Spacer(Modifier.height(32.dp).navigationBarsPadding())
        }
    }
    memberSheet?.let { u ->
        val isAdm = conv.isAdmin(u.id)
        Sheet({ memberSheet = null }) {
            Text(u.displayName, fontWeight = FontWeight.Bold, fontSize = 18.sp, modifier = Modifier.padding(horizontal = 22.dp, vertical = 8.dp))
            SheetItem(Icons.Filled.Person, "View profile", { memberSheet = null; nav.push(Route.Person(u)) })
            SheetItem(if (isAdm) Icons.Filled.RemoveModerator else Icons.Filled.AddModerator, if (isAdm) "Remove as admin" else "Make admin", {
                memberSheet = null; run { if (isAdm) repo.updateAdmins(convId, demote = listOf(u.id)) else repo.updateAdmins(convId, promote = listOf(u.id)) }
            })
            SheetItem(Icons.Filled.PersonRemove, "Remove from group", { memberSheet = null; run("${u.displayName} removed") { repo.updateMembers(convId, remove = listOf(u.id)) } }, tint = MaterialTheme.colorScheme.error)
        }
    }
    if (adding) {
        val candidates = contacts.filter { c -> conv.participants.none { it.id == c.id } }
        var picked by remember { mutableStateOf(setOf<String>()) }
        Sheet({ adding = false }) {
            Text("Add members", fontWeight = FontWeight.Bold, fontSize = 18.sp, modifier = Modifier.padding(horizontal = 22.dp, vertical = 8.dp))
            if (candidates.isEmpty()) Text("All your contacts are already in this group.", color = wc.dim, modifier = Modifier.padding(22.dp))
            else {
                Column(Modifier.heightIn(max = 420.dp).verticalScroll(rememberScrollState())) {
                    candidates.forEach { u -> PersonRow(u, { Checkbox(u.id in picked, null) }) { picked = if (u.id in picked) picked - u.id else picked + u.id } }
                }
                Button(enabled = picked.isNotEmpty(), onClick = { val ids = picked.toList(); adding = false; run("Added") { repo.updateMembers(convId, add = ids) } }, modifier = Modifier.fillMaxWidth().padding(16.dp)) { Text("Add ${picked.size}") }
            }
        }
    }
    when (confirm) {
        "clear" -> ConfirmDialog("Clear this chat?", "All messages are removed for you.", "Clear", true, { run("Chat cleared") { repo.clearChatEverywhere(convId, true) } }, { confirm = null })
        "leave" -> ConfirmDialog("Leave group?", "You'll stop receiving messages from “${conv.name}”.", "Leave", true, { run { repo.leaveGroup(convId); nav.popAll() } }, { confirm = null })
    }
}

// ================================================================================================ Friend requests

@Composable
fun FriendRequestsScreen(nav: Nav) {
    val ctx = LocalContext.current
    val social = ctx.repo.social
    val scope = rememberCoroutineScope()
    val requests by social.requests.collectAsState()
    var busy by remember { mutableStateOf(setOf<String>()) }
    LaunchedEffect(Unit) { social.refreshRequests() }
    val incoming = requests.filter { !it.outgoing }
    val outgoing = requests.filter { it.outgoing }
    fun respond(id: String, accept: Boolean) {
        busy = busy + id
        scope.launch { try { social.respond(id, accept); if (accept) ctx.toast("Added to contacts") } catch (e: Exception) { ctx.toast(e.message ?: "Failed") } finally { busy = busy - id } }
    }
    Column(Modifier.fillMaxSize()) {
        WispTopBar("Friend requests", onBack = { nav.pop() })
        if (requests.isEmpty()) EmptyState(Icons.Filled.PersonAdd, "No pending requests", "When someone adds you, it shows up here.")
        else LazyColumn(Modifier.fillMaxSize()) {
            if (incoming.isNotEmpty()) item { SectionTitle("Received") }
            items(incoming, key = { "i" + it.id }) { r ->
                PersonRow(r.user, {
                    Row {
                        FilledTonalButton(enabled = r.id !in busy, onClick = { respond(r.id, true) }, contentPadding = PaddingValues(horizontal = 14.dp)) { Text("Accept") }
                        IconButton(enabled = r.id !in busy, onClick = { respond(r.id, false) }) { Icon(Icons.Filled.Close, "Decline") }
                    }
                }) { nav.push(Route.Person(r.user)) }
            }
            if (outgoing.isNotEmpty()) item { SectionTitle("Sent") }
            items(outgoing, key = { "o" + it.id }) { r -> PersonRow(r.user, { Text("Pending", color = wc.dim, fontSize = 13.sp) }) { nav.push(Route.Person(r.user)) } }
        }
    }
}

// ================================================================================================ Media & storage

@Composable
fun MediaStorageScreen(nav: Nav) {
    val ctx = LocalContext.current
    val repo = ctx.repo
    val scope = rememberCoroutineScope()
    var stats by remember { mutableStateOf<org.json.JSONObject?>(null) }
    var failed by remember { mutableStateOf(false) }
    var rows by remember { mutableStateOf<List<com.wispchat.app.data.Repo.ChatStorage>?>(null) }
    var confirmAll by remember { mutableStateOf(false) }
    fun reload() { scope.launch { rows = repo.storageByChat() } }
    LaunchedEffect(Unit) {
        reload()
        try { stats = repo.social.mediaStats() } catch (_: Exception) { failed = true }
    }

    Column(Modifier.fillMaxSize()) {
        WispTopBar("Media & storage", onBack = { nav.pop() })
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
            SectionTitle("In your chats (on the server)")
            val s = stats
            when {
                s != null -> {
                    val counts = s.optJSONObject("counts"); val bytes = s.optJSONObject("bytes")
                    val total = s.optLong("totalBytes").coerceAtLeast(1L)
                    Text("${s.optInt("totalCount")} files · ${formatBytes(s.optLong("totalBytes"))}", fontSize = 20.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(horizontal = 20.dp, vertical = 4.dp))
                    listOf(Triple("image", "Photos", Icons.Filled.Image), Triple("video", "Videos", Icons.Filled.Videocam), Triple("audio", "Audio", Icons.Filled.Mic), Triple("file", "Documents", Icons.Filled.Description)).forEach { (k, label, icon) ->
                        val b = bytes?.optLong(k) ?: 0L
                        Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 8.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Icon(icon, null, Modifier.size(20.dp), tint = wc.wisp)
                                Text(label, Modifier.weight(1f).padding(start = 12.dp))
                                Text("${counts?.optInt(k) ?: 0} · ${formatBytes(b)}", color = wc.dim, fontSize = 13.sp)
                            }
                            LinearProgressIndicator(progress = { (b.toFloat() / total).coerceIn(0f, 1f) }, Modifier.fillMaxWidth().padding(top = 6.dp).height(5.dp).clip(CircleShape), color = MaterialTheme.colorScheme.primary, trackColor = wc.surface3)
                        }
                    }
                }
                failed -> Text("Needs internet to load.", color = wc.dim, modifier = Modifier.padding(20.dp))
                else -> Column(Modifier.padding(horizontal = 20.dp)) { repeat(4) { SkeletonBox(height = 22.dp, modifier = Modifier.padding(vertical = 8.dp).fillMaxWidth()) } }
            }
            HorizontalDivider(color = wc.border, modifier = Modifier.padding(top = 12.dp))
            SectionTitle("Downloaded to this phone")
            val r = rows
            when {
                r == null -> Column(Modifier.padding(horizontal = 20.dp)) { repeat(3) { SkeletonBox(height = 22.dp, modifier = Modifier.padding(vertical = 8.dp).fillMaxWidth()) } }
                r.isEmpty() -> Text("Nothing downloaded yet.", color = wc.dim, modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp))
                else -> {
                    Text(formatBytes(r.sumOf { it.bytes }), fontSize = 20.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(horizontal = 20.dp, vertical = 4.dp))
                    r.forEach { row ->
                        Row(Modifier.fillMaxWidth().clickable { nav.openChat(row.convId) }.padding(horizontal = 20.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) { Text(row.title, maxLines = 1, overflow = TextOverflow.Ellipsis); Text("${formatBytes(row.bytes)} · ${row.files} file${if (row.files == 1) "" else "s"}", fontSize = 12.sp, color = wc.dim) }
                            IconButton(onClick = { scope.launch { repo.media.clearConversation(row.convId, alsoGallery = false); reload() } }) { Icon(Icons.Filled.Delete, "Free up space", tint = wc.dim) }
                        }
                    }
                    OutlinedButton(onClick = { confirmAll = true }, Modifier.padding(20.dp)) { Icon(Icons.Filled.DeleteSweep, null); Text("  Delete all downloaded media") }
                }
            }
            Spacer(Modifier.height(32.dp).navigationBarsPadding())
        }
    }
    if (confirmAll) ConfirmDialog("Delete all downloaded media?", "Messages stay. Files can be downloaded again while they are still on the server.", "Delete", true,
        { scope.launch { repo.db.allMedia().map { it.url }.let { repo.media.deleteFiles(it, false) }; repo.media.clearAll(); reload() } }, { confirmAll = false })
}

// ================================================================================================ Broadcast

/** Pick contacts, write one message, and it goes out as a normal separate DM to each (nobody sees who else got it). */
@Composable
fun BroadcastScreen(nav: Nav) {
    val ctx = LocalContext.current
    val repo = ctx.repo
    val social = repo.social
    val scope = rememberCoroutineScope()
    val contacts by social.contacts.collectAsState()
    val loaded by social.contactsLoaded.collectAsState()
    var selected by remember { mutableStateOf(setOf<String>()) }
    var text by remember { mutableStateOf("") }
    var sending by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { social.refreshContacts() }

    Column(Modifier.fillMaxSize().imePadding()) {
        WispTopBar("Broadcast", onBack = { nav.pop() }, subtitle = if (selected.isEmpty()) "Choose recipients" else "${selected.size} selected") {
            if (contacts.isNotEmpty()) TextButton(onClick = { selected = if (selected.size == contacts.size) emptySet() else contacts.map { it.id }.toSet() }) { Text(if (selected.size == contacts.size) "Clear" else "Select all") }
        }
        Text("Each person gets your message as a normal one-to-one chat. They can't see who else received it.", color = wc.dim, fontSize = 13.sp, modifier = Modifier.padding(horizontal = 18.dp, vertical = 6.dp))
        when {
            !loaded && contacts.isEmpty() -> Box(Modifier.weight(1f)) { SkeletonList(6, 44.dp) }
            contacts.isEmpty() -> Box(Modifier.weight(1f)) { EmptyState(Icons.Filled.Campaign, "No contacts yet", "Add people first, then broadcast to them.") }
            else -> LazyColumn(Modifier.weight(1f)) {
                items(contacts.sortedBy { it.displayName.lowercase() }, key = { it.id }) { u ->
                    val on = u.id in selected
                    PersonRow(u, { Checkbox(on, null) }) { selected = if (on) selected - u.id else selected + u.id }
                }
            }
        }
        Row(Modifier.fillMaxWidth().navigationBarsPadding().padding(10.dp), verticalAlignment = Alignment.Bottom) {
            OutlinedTextField(text, { text = it }, Modifier.weight(1f), placeholder = { Text("Message to broadcast") }, maxLines = 4, shape = RoundedCornerShape(22.dp))
            FilledIconButton(enabled = text.isNotBlank() && selected.isNotEmpty() && !sending, onClick = {
                sending = true
                val body = text.trim(); val ids = selected.toList()
                scope.launch {
                    var ok = 0
                    for (id in ids) { try { val c = repo.openDirect(id); repo.sendText(c, body); ok++ } catch (_: Exception) {} }
                    sending = false
                    ctx.toast("Sent to $ok of ${ids.size} contact${if (ids.size > 1) "s" else ""}")
                    if (ok > 0) { text = ""; selected = emptySet() }
                }
            }, modifier = Modifier.padding(start = 8.dp, bottom = 4.dp).size(48.dp)) {
                if (sending) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp, color = WispInk) else Icon(Icons.Filled.Send, "Send")
            }
        }
    }
}
