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
            } catch (e: Exception) { ctx.toast(e.message ?: "Couldn't start the call") }
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
                    placeholder = { Text("Search calls") }, leadingIcon = { Icon(Icons.Filled.Search, null) })
            } else {
                WispTopBar("Calls") {
                    IconButton(onClick = { searching = true }) { Icon(Icons.Filled.Search, "Search") }
                    Box {
                        IconButton(onClick = { menu = true }) { Icon(Icons.Filled.MoreVert, "More") }
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
                            EmptyState(Icons.Filled.Call, if (missedOnly) "No missed calls" else "No calls yet", if (missedOnly) "You're all caught up." else "Start a voice or video call with any of your contacts.") {
                                if (!missedOnly) Button(onClick = { nav.push(Route.NewCall) }) { Icon(Icons.Filled.Call, null); Text("  New call") }
                            }
                        }
                    } else {
                        item { SectionTitle("Recent") }
                        items(shown, key = { it.id }) { c ->
                            val name = c.peer?.displayName ?: c.convName.ifEmpty { "Unknown" }
                            Row(Modifier.fillMaxWidth().combinedClickable(onClick = { callBack(c, c.kind) }, onLongClick = { actions = c }).padding(horizontal = 16.dp, vertical = 9.dp), verticalAlignment = Alignment.CenterVertically) {
                                if (c.isGroup) Avatar(name, "#7c5cff", 48.dp, url = c.convAvatar) else UserAvatar(c.peer, 48.dp)
                                Column(Modifier.weight(1f).padding(horizontal = 14.dp)) {
                                    Text(name, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis, color = if (c.missed) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface)
                                    Row(verticalAlignment = Alignment.CenterVertically) {
                                        Icon(if (c.outgoing) Icons.Filled.CallMade else if (c.missed) Icons.Filled.CallMissed else Icons.Filled.CallReceived, null, Modifier.size(15.dp),
                                            tint = if (c.missed) MaterialTheme.colorScheme.error else wc.wisp)
                                        Text("  ${callSubtitle(c)} · ${formatListTime(c.createdAt)}", fontSize = 13.sp, color = wc.dim, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                    }
                                }
                                IconButton(onClick = { callBack(c, c.kind) }) { Icon(if (c.kind == "video") Icons.Filled.Videocam else Icons.Filled.Call, "Call back", tint = wc.wisp) }
                            }
                        }
                        if (hasMore) item { Box(Modifier.fillMaxWidth().padding(16.dp), Alignment.Center) { CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = 2.dp) } }
                    }
                }
            }
        }
        FloatingActionButton(onClick = { nav.push(Route.NewCall) }, Modifier.align(Alignment.BottomEnd).padding(18.dp), containerColor = MaterialTheme.colorScheme.primary, contentColor = WispInk) {
            Icon(Icons.Filled.AddIcCall, "New call")
        }
    }

    actions?.let { c ->
        val peerId = c.peer?.id
        Sheet({ actions = null }) {
            Text(c.peer?.displayName ?: c.convName, fontWeight = FontWeight.Bold, fontSize = 18.sp, modifier = Modifier.padding(horizontal = 22.dp, vertical = 8.dp))
            SheetItem(Icons.Filled.Call, "Voice call", { actions = null; callBack(c, "audio") })
            SheetItem(Icons.Filled.Videocam, "Video call", { actions = null; callBack(c, "video") })
            SheetItem(Icons.Filled.Chat, "Open chat", { actions = null; nav.openChat(c.convId) })
            if (peerId != null) {
                val fav = peerId in favs
                SheetItem(if (fav) Icons.Filled.StarBorder else Icons.Filled.Star, if (fav) "Remove from favourites" else "Add to favourites", {
                    actions = null; repo.settings.toggleCallFav(peerId); favs = repo.settings.callFavs()
                })
            }
            SheetItem(Icons.Filled.Delete, "Delete from call log", { actions = null; scope.launch { social.deleteCallLogLocal(setOf(c.id)) } }, tint = MaterialTheme.colorScheme.error)
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
            placeholder = { Text("Search contacts") }, leadingIcon = { Icon(Icons.Filled.Search, null) })
        when {
            !loaded && contacts.isEmpty() -> SkeletonList(7, 46.dp)
            shown.isEmpty() -> EmptyState(Icons.Filled.People, if (contacts.isEmpty()) "No contacts yet" else "No matches", if (contacts.isEmpty()) "Add people from Explore or New chat to call them." else "")
            else -> LazyColumn(Modifier.fillMaxSize()) {
                items(shown, key = { it.id }) { u ->
                    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 7.dp), verticalAlignment = Alignment.CenterVertically) {
                        UserAvatar(u, 46.dp)
                        Column(Modifier.weight(1f).padding(horizontal = 14.dp)) {
                            Text(u.displayName, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Text("@${u.username}", fontSize = 13.sp, color = wc.dim, maxLines = 1)
                        }
                        val fav = u.id in favs
                        IconButton(onClick = { repo.settings.toggleCallFav(u.id); favs = repo.settings.callFavs() }) { Icon(if (fav) Icons.Filled.Star else Icons.Filled.StarBorder, "Favourite", tint = if (fav) Color(0xFFFFC857) else wc.dim) }
                        IconButton(onClick = { startCall({ repo.openDirect(u.id) }, "audio") }) { Icon(Icons.Filled.Call, "Voice call", tint = wc.wisp) }
                        IconButton(onClick = { startCall({ repo.openDirect(u.id) }, "video") }) { Icon(Icons.Filled.Videocam, "Video call", tint = wc.wisp) }
                    }
                }
            }
        }
    }
}
