@file:OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class, androidx.compose.material3.ExperimentalMaterial3Api::class)

package com.wispchat.app.ui

import android.Manifest
import android.content.Intent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.*
import androidx.compose.material.icons.outlined.*
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
import com.wispchat.app.call.CallActivity
import com.wispchat.app.calls
import com.wispchat.app.data.CallLog
import com.wispchat.app.data.Conversation
import com.wispchat.app.data.User
import com.wispchat.app.repo
import kotlinx.coroutines.launch

/**
 * Returns a function that asks for the mic (+camera for video) and then rings. The conversation is
 * produced lazily because for a contact we first have to open (or create) the direct chat.
 */
@Composable
fun rememberCallStarter(): (suspend () -> Conversation?, String) -> Unit {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var pending by remember { mutableStateOf<Pair<suspend () -> Conversation?, String>?>(null) }
    val perms = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { res ->
        val p = pending; pending = null
        if (p == null) return@rememberLauncherForActivityResult
        if (res[Manifest.permission.RECORD_AUDIO] != true) { ctx.toast("Microphone permission is needed to call"); return@rememberLauncherForActivityResult }
        scope.launch {
            try {
                val conv = p.first() ?: run { ctx.toast("Couldn't start the call"); return@launch }
                ctx.calls.startOutgoing(conv, p.second)
                ctx.startActivity(Intent(ctx, CallActivity::class.java))
            } catch (e: Exception) { ctx.toastErr(e, "Couldn't start the call") }
        }
    }
    return remember {
        { provider, kind ->
            if (!ctx.repo.net.online) ctx.toast("You're offline")
            else {
                pending = provider to kind
                perms.launch(if (kind == "video") arrayOf(Manifest.permission.RECORD_AUDIO, Manifest.permission.CAMERA) else arrayOf(Manifest.permission.RECORD_AUDIO))
            }
        }
    }
}

private fun callSubtitle(c: CallLog): String {
    val what = if (c.kind == "video") "Video" else "Voice"
    return when {
        c.status == "missed" -> "Missed ${what.lowercase()} call"
        c.status == "declined" -> "$what call declined"
        c.durationSec > 0 -> "$what · ${formatDuration(c.durationSec)}"
        else -> "$what call"
    }
}

// ================================================================================================ Calls tab

@Composable
fun CallsTab(nav: Nav) {
    val ctx = LocalContext.current
    val repo = ctx.repo
    val social = repo.social
    val scope = rememberCoroutineScope()
    val calls by social.calls.collectAsState()
    val loading by social.callsLoading.collectAsState()
    val hasMore by social.callsHasMore.collectAsState()
    val contacts by social.contacts.collectAsState()
    val convs by repo.conversations.collectAsState()
    val startCall = rememberCallStarter()
    var missedOnly by remember { mutableStateOf(false) }
    var searching by remember { mutableStateOf(false) }
    var query by remember { mutableStateOf("") }
    var favs by remember { mutableStateOf(repo.settings.callFavs()) }
    var actions by remember { mutableStateOf<CallLog?>(null) }
    var menu by remember { mutableStateOf(false) }
    val list = rememberLazyListState()

    LaunchedEffect(Unit) { social.refreshCalls() }
    val shown = remember(calls, missedOnly, query) {
        calls.filter { !missedOnly || it.missed }.filter { query.isBlank() || (it.peer?.displayName ?: it.convName).contains(query.trim(), true) }
    }
    val favPeople = contacts.filter { it.id in favs }
    val nearEnd by remember { derivedStateOf { (list.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0) >= shown.size - 4 } }
    LaunchedEffect(nearEnd, shown.size) { if (nearEnd && hasMore && shown.isNotEmpty()) social.loadMoreCalls() }

    fun callBack(c: CallLog, kind: String) = startCall({ repo.conversation(c.convId) ?: convs.firstOrNull { it.id == c.convId } }, kind)
    fun callUser(u: User, kind: String) = startCall({ repo.openDirect(u.id) }, kind)

    Box(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize()) {
            if (searching) {
                WispTopBar("", onBack = { searching = false; query = "" }) {}
                // search field replaces the title row
                OutlinedTextField(query, { query = it }, Modifier.fillMaxWidth().padding(horizontal = 14.dp), singleLine = true, shape = RoundedCornerShape(26.dp),
                    placeholder = { Text("Search calls") }, leadingIcon = { Icon(Icons.Rounded.Search, null) })
            } else {
                WispTopBar("Calls") {
                    IconButton(onClick = { searching = true }) { Icon(Icons.Rounded.Search, "Search") }
                    Box {
                        IconButton(onClick = { menu = true }) { Icon(Icons.Rounded.MoreVert, "More") }
                        DropdownMenu(menu, { menu = false }) {
                            DropdownMenuItem({ Text("New call") }, onClick = { menu = false; nav.push(Route.NewCall) })
                            DropdownMenuItem({ Text("Refresh") }, onClick = { menu = false; scope.launch { social.refreshCalls() } })
                            DropdownMenuItem({ Text(if (missedOnly) "Show all calls" else "Show missed only") }, onClick = { menu = false; missedOnly = !missedOnly })
                            DropdownMenuItem({ Text("Settings") }, onClick = { menu = false; nav.push(Route.Settings) })
                        }
                    }
                }
            }
            Row(Modifier.padding(horizontal = 12.dp, vertical = 6.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilterChip(!missedOnly, { missedOnly = false }, { Text("All") })
                FilterChip(missedOnly, { missedOnly = true }, { Text("Missed") })
            }
            when {
                loading && calls.isEmpty() -> SkeletonList(8, 48.dp)
                else -> LazyColumn(Modifier.fillMaxSize(), list, contentPadding = PaddingValues(bottom = 90.dp)) {
                    if (favPeople.isNotEmpty() && !searching && !missedOnly) {
                        item { SectionTitle("Favourites") }
                        item {
                            LazyRow(contentPadding = PaddingValues(horizontal = 14.dp), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                                items(favPeople, key = { it.id }) { p ->
                                    Column(Modifier.width(66.dp).clip(RoundedCornerShape(12.dp)).clickable { callUser(p, "audio") }.padding(vertical = 4.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                                        UserAvatar(p, 52.dp)
                                        Text(p.displayName.substringBefore(' '), fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 4.dp))
                                    }
                                }
                            }
                        }
                    }
                    if (shown.isEmpty()) item {
                        Box(Modifier.fillParentMaxHeight(0.7f)) {
                            EmptyState(Icons.Rounded.Call, if (missedOnly) "No missed calls" else "No calls yet", if (missedOnly) "You're all caught up." else "Start a voice or video call with any of your contacts.") {
                                if (!missedOnly) Button(onClick = { nav.push(Route.NewCall) }) { Icon(Icons.Rounded.Call, null); Text("  New call") }
                            }
                        }
                    } else {
                        item { SectionTitle("Recent") }
                        items(shown, key = { it.id }) { c ->
                            val name = c.peer?.displayName ?: c.convName.ifEmpty { "Unknown" }
                            Row(Modifier.fillMaxWidth().combinedClickable(onClick = { nav.push(Route.CallInfo(c.convId)) }, onLongClick = { actions = c }).padding(horizontal = 16.dp, vertical = 9.dp), verticalAlignment = Alignment.CenterVertically) {
                                if (c.isGroup) Avatar(name, "#7c5cff", 48.dp, url = c.convAvatar) else UserAvatar(c.peer, 48.dp)
                                Column(Modifier.weight(1f).padding(horizontal = 14.dp)) {
                                    Text(name, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis, color = if (c.missed) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface)
                                    Row(verticalAlignment = Alignment.CenterVertically) {
                                        Icon(if (c.outgoing) Icons.Rounded.CallMade else if (c.missed) Icons.Rounded.CallMissed else Icons.Rounded.CallReceived, null, Modifier.size(15.dp),
                                            tint = if (c.missed) MaterialTheme.colorScheme.error else wc.wisp)
                                        Text("  ${callSubtitle(c)} · ${formatListTime(c.createdAt)}", fontSize = 13.sp, color = wc.dim, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                    }
                                }
                                IconButton(onClick = { callBack(c, c.kind) }) { Icon(if (c.kind == "video") Icons.Rounded.Videocam else Icons.Rounded.Call, "Call back", tint = wc.wisp) }
                            }
                        }
                        if (hasMore) item { Box(Modifier.fillMaxWidth().padding(16.dp), Alignment.Center) { CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = 2.dp) } }
                    }
                }
            }
        }
        FloatingActionButton(onClick = { nav.push(Route.NewCall) }, Modifier.align(Alignment.BottomEnd).padding(18.dp), containerColor = MaterialTheme.colorScheme.primary, contentColor = WispInk) {
            Icon(Icons.Rounded.AddIcCall, "New call")
        }
    }

    actions?.let { c ->
        val peerId = c.peer?.id
        Sheet({ actions = null }) {
            Text(c.peer?.displayName ?: c.convName, fontWeight = FontWeight.Bold, fontSize = 18.sp, modifier = Modifier.padding(horizontal = 22.dp, vertical = 8.dp))
            SheetItem(Icons.Rounded.Call, "Voice call", { actions = null; callBack(c, "audio") })
            SheetItem(Icons.Rounded.Videocam, "Video call", { actions = null; callBack(c, "video") })
            SheetItem(Icons.Rounded.Chat, "Open chat", { actions = null; nav.openChat(c.convId) })
            if (peerId != null) {
                val fav = peerId in favs
                SheetItem(if (fav) Icons.Rounded.StarBorder else Icons.Rounded.Star, if (fav) "Remove from favourites" else "Add to favourites", {
                    actions = null; repo.settings.toggleCallFav(peerId); favs = repo.settings.callFavs()
                })
            }
            SheetItem(Icons.Rounded.Delete, "Delete from call log", { actions = null; scope.launch { social.deleteCallLogLocal(setOf(c.id)) } }, tint = MaterialTheme.colorScheme.error)
        }
    }
}

// ================================================================================================ New call

/** Pick a contact to voice / video call; star people to pin them at the top of the Calls tab. */
@Composable
fun NewCallScreen(nav: Nav) {
    val ctx = LocalContext.current
    val repo = ctx.repo
    val social = repo.social
    val scope = rememberCoroutineScope()
    val contacts by social.contacts.collectAsState()
    val loaded by social.contactsLoaded.collectAsState()
    val startCall = rememberCallStarter()
    var query by remember { mutableStateOf("") }
    var favs by remember { mutableStateOf(repo.settings.callFavs()) }
    LaunchedEffect(Unit) { social.refreshContacts() }
    val shown = contacts.filter { query.isBlank() || it.displayName.contains(query.trim(), true) || it.username.contains(query.trim().removePrefix("@"), true) }
        .sortedWith(compareByDescending<User> { it.id in favs }.thenBy { it.displayName.lowercase() })

    Column(Modifier.fillMaxSize()) {
        WispTopBar("New call", onBack = { nav.pop() }, subtitle = "${contacts.size} contacts")
        OutlinedTextField(query, { query = it }, Modifier.fillMaxWidth().padding(horizontal = 14.dp), singleLine = true, shape = RoundedCornerShape(26.dp),
            placeholder = { Text("Search contacts") }, leadingIcon = { Icon(Icons.Rounded.Search, null) })
        when {
            !loaded && contacts.isEmpty() -> SkeletonList(7, 46.dp)
            shown.isEmpty() -> EmptyState(Icons.Rounded.People, if (contacts.isEmpty()) "No contacts yet" else "No matches", if (contacts.isEmpty()) "Add people from Explore or New chat to call them." else "")
            else -> LazyColumn(Modifier.fillMaxSize()) {
                items(shown, key = { it.id }) { u ->
                    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 7.dp), verticalAlignment = Alignment.CenterVertically) {
                        UserAvatar(u, 46.dp)
                        Column(Modifier.weight(1f).padding(horizontal = 14.dp)) {
                            Text(u.displayName, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Text("@${u.username}", fontSize = 13.sp, color = wc.dim, maxLines = 1)
                        }
                        val fav = u.id in favs
                        IconButton(onClick = { repo.settings.toggleCallFav(u.id); favs = repo.settings.callFavs() }) { Icon(if (fav) Icons.Rounded.Star else Icons.Rounded.StarBorder, "Favourite", tint = if (fav) Color(0xFFFFC857) else wc.dim) }
                        IconButton(onClick = { startCall({ repo.openDirect(u.id) }, "audio") }) { Icon(Icons.Rounded.Call, "Voice call", tint = wc.wisp) }
                        IconButton(onClick = { startCall({ repo.openDirect(u.id) }, "video") }) { Icon(Icons.Rounded.Videocam, "Video call", tint = wc.wisp) }
                    }
                }
            }
        }
    }
}


// ================================================================================================ Call info

/** WhatsApp-style "Call info": photo, name, Message · Voice · Video · Info, and every call with this person / group by day. */
@Composable
fun CallInfoScreen(convId: String, nav: Nav) {
    val ctx = LocalContext.current
    val repo = ctx.repo
    val calls by repo.social.calls.collectAsState()
    val convs by repo.conversations.collectAsState()
    val startCall = rememberCallStarter()
    val list = remember(calls, convId) { calls.filter { it.convId == convId }.sortedByDescending { it.createdAt } }
    val conv = convs.firstOrNull { it.id == convId }
    val first = list.firstOrNull()
    val peer = first?.peer ?: conv?.participants?.firstOrNull { it.id != repo.myId }
    val isGroup = conv?.isGroup ?: first?.isGroup ?: false
    val name = if (isGroup) (conv?.title(repo.myId) ?: first?.convName.orEmpty()) else peer?.displayName ?: first?.convName.orEmpty()
    var photo by remember { mutableStateOf(false) }
    val day = remember { java.text.SimpleDateFormat("d MMMM yyyy", java.util.Locale.getDefault()) }
    val clock = remember { java.text.SimpleDateFormat("h:mm a", java.util.Locale.getDefault()) }

    Column(Modifier.fillMaxSize()) {
        WispTopBar("Call info", onBack = { nav.pop() })
        LazyColumn(Modifier.fillMaxSize()) {
            item {
                Column(Modifier.fillMaxWidth().padding(top = 18.dp, bottom = 8.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    Box(Modifier.clip(CircleShape).clickable { photo = true }) {
                        if (isGroup) Avatar(name, "#7c5cff", 120.dp, url = conv?.avatar ?: first?.convAvatar.orEmpty()) else UserAvatar(peer, 120.dp)
                    }
                    Text(name, fontSize = 24.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = 14.dp, start = 20.dp, end = 20.dp), maxLines = 2, overflow = TextOverflow.Ellipsis)
                    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 20.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        ActionTile(Icons.Outlined.Chat, "Message", Modifier.weight(1f)) { nav.openChat(convId) }
                        ActionTile(Icons.Outlined.Call, "Voice", Modifier.weight(1f)) { startCall({ repo.conversation(convId) ?: conv }, "audio") }
                        ActionTile(Icons.Outlined.Videocam, "Video", Modifier.weight(1f)) { startCall({ repo.conversation(convId) ?: conv }, "video") }
                        ActionTile(Icons.Outlined.Info, "Info", Modifier.weight(1f)) { nav.push(if (isGroup) Route.GroupInfo(convId) else Route.ContactInfo(convId)) }
                    }
                }
                HorizontalDivider(color = wc.border)
            }
            if (list.isEmpty()) item { Text("No calls with ${name.ifEmpty { "them" }} on this phone yet.", color = wc.dim, modifier = Modifier.padding(20.dp)) }
            var lastDay = ""
            list.forEach { c ->
                val d = day.format(java.util.Date(c.createdAt))
                if (d != lastDay) { lastDay = d; item(key = "d$d") { Text(d, color = wc.dim, fontWeight = FontWeight.SemiBold, fontSize = 14.sp, modifier = Modifier.padding(start = 20.dp, top = 18.dp, bottom = 6.dp)) } }
                item(key = c.id) {
                    val what = if (c.kind == "video") "video" else "voice"
                    val missed = c.missed
                    Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                        Icon(if (c.outgoing) Icons.Rounded.CallMade else if (missed) Icons.Rounded.CallMissed else Icons.Rounded.CallReceived, null,
                            Modifier.size(22.dp), tint = if (missed) MaterialTheme.colorScheme.error else wc.dim)
                        Column(Modifier.weight(1f).padding(horizontal = 16.dp)) {
                            Text((if (c.outgoing) "Outgoing" else if (missed) "Missed" else "Incoming") + " $what call", fontSize = 16.sp)
                            Text(clock.format(java.util.Date(c.createdAt)), color = wc.dim, fontSize = 14.sp)
                        }
                        Text(when {
                            c.durationSec > 0 -> formatDuration(c.durationSec)
                            c.status == "declined" -> "Declined"
                            missed && !c.outgoing -> "Missed"
                            else -> "Not answered"
                        }, color = wc.dim, fontSize = 14.sp)
                    }
                }
            }
        }
    }
    if (photo) ProfilePhotoViewer(name, if (isGroup) conv?.avatar ?: first?.convAvatar.orEmpty() else peer?.avatar.orEmpty(), if (isGroup) "#7c5cff" else peer?.avatarColor ?: "#6EE7B7") { photo = false }
}
