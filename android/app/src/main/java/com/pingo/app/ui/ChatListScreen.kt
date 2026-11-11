package com.pingo.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.CloudOff
import androidx.compose.material.icons.filled.Logout
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.pingo.app.data.Conversation
import com.pingo.app.data.User
import com.pingo.app.repo
import com.pingo.app.service.RealtimeService
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.text.DateFormat
import java.util.Date

@Composable
fun ChatListScreen(onOpen: (String) -> Unit, onSettings: () -> Unit) {
    val ctx = LocalContext.current
    val repo = ctx.repo
    val scope = rememberCoroutineScope()
    val me by repo.me.collectAsState()
    val list by repo.conversations.collectAsState()
    val loading by repo.convLoading.collectAsState()
    val error by repo.convError.collectAsState()
    val previews by repo.previews.collectAsState()
    val typing by repo.typing.collectAsState()
    val connected by repo.rt.connected.collectAsState()
    var newChat by remember { mutableStateOf(false) }
    var menu by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) { repo.refreshConversations() }

    Box(Modifier.fillMaxSize().safeDrawingPadding()) {
        Column(Modifier.fillMaxSize()) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                Logo(34.dp)
                Spacer(Modifier.weight(1f))
                if (!connected) Icon(Icons.Filled.CloudOff, "Offline", tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(end = 8.dp))
                IconButton(onClick = { newChat = true }) { Icon(Icons.Filled.Search, "Find people") }
                IconButton(onClick = onSettings) { Icon(Icons.Filled.Settings, "Settings") }
            }
            val netKind by repo.net.kind.collectAsState()
            if (netKind == com.pingo.app.data.Net.Kind.NONE) Row(Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surfaceVariant).padding(horizontal = 16.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Filled.CloudOff, null, Modifier.size(16.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                Text("  Offline — showing saved chats", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            if (loading && list.isEmpty()) Box(Modifier.fillMaxSize(), Alignment.Center) { CircularProgressIndicator() }
            else if (error && list.isEmpty()) Column(Modifier.fillMaxSize(), Arrangement.Center, Alignment.CenterHorizontally) {
                Icon(Icons.Filled.CloudOff, null, Modifier.size(48.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                Text("Can't reach the server", color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(12.dp))
                TextButton(onClick = { scope.launch { repo.refreshConversations() } }) { Text("Try again") }
            } else if (list.isEmpty()) Column(Modifier.fillMaxSize(), Arrangement.Center, Alignment.CenterHorizontally) {
                Logo(80.dp); Spacer(Modifier.height(16.dp))
                TextButton(onClick = { newChat = true }) { Icon(Icons.Filled.Add, null); Text("  New chat") }
            } else LazyColumn(Modifier.fillMaxSize()) {
                items(list, key = { it.id }) { c ->
                    ConversationRow(c, me?.id.orEmpty(), previews[c.id].orEmpty(), typing[c.id].orEmpty().isNotEmpty()) { onOpen(c.id) }
                }
            }
        }
        FloatingActionButton(onClick = { newChat = true }, modifier = Modifier.align(Alignment.BottomEnd).padding(20.dp),
            containerColor = MaterialTheme.colorScheme.primary, contentColor = Color(0xFF04141C)) { Icon(Icons.Filled.Add, "New chat") }
    }

    if (newChat) NewChatDialog(onDismiss = { newChat = false }, onPick = { u ->
        newChat = false
        scope.launch { try { onOpen(repo.openDirect(u.id).id) } catch (_: Exception) {} }
    })
}

@Composable
private fun ConversationRow(c: Conversation, me: String, preview: String, typing: Boolean, onClick: () -> Unit) {
    val title = c.title(me)
    val other = c.other(me)
    Row(Modifier.fillMaxWidth().clickable(onClick = onClick).padding(horizontal = 16.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
        Avatar(title, other?.avatarColor.orEmpty(), 52.dp)
        Column(Modifier.weight(1f).padding(horizontal = 14.dp)) {
            Text(title, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(if (typing) "typing…" else preview, maxLines = 1, overflow = TextOverflow.Ellipsis, fontSize = 14.sp,
                color = if (typing) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Column(horizontalAlignment = Alignment.End) {
            if (c.lastMessageAt > 0) Text(DateFormat.getTimeInstance(DateFormat.SHORT).format(Date(c.lastMessageAt)), fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            if (c.unread > 0) Box(Modifier.padding(top = 6.dp).clip(CircleShape).background(MaterialTheme.colorScheme.primary).size(22.dp), Alignment.Center) {
                Text(if (c.unread > 99) "99+" else c.unread.toString(), color = Color(0xFF04141C), fontSize = 11.sp, fontWeight = FontWeight.Bold)
            }
        }
    }
}

@Composable
private fun NewChatDialog(onDismiss: () -> Unit, onPick: (User) -> Unit) {
    val repo = LocalContext.current.repo
    var q by remember { mutableStateOf("") }
    var results by remember { mutableStateOf<List<User>>(emptyList()) }
    LaunchedEffect(q) {
        if (q.trim().length < 2) { results = emptyList(); return@LaunchedEffect }
        delay(300) // debounce
        results = try { repo.searchUsers(q.trim()).filter { it.id != repo.myId } } catch (_: Exception) { emptyList() }
    }
    AlertDialog(onDismissRequest = onDismiss, confirmButton = {}, dismissButton = { TextButton(onClick = onDismiss) { Text("Close") } },
        title = { Icon(Icons.Filled.Search, null) },
        text = {
            Column {
                OutlinedTextField(q, { q = it }, singleLine = true, label = { Text("Name or username") }, modifier = Modifier.fillMaxWidth())
                LazyColumn(Modifier.height(280.dp)) {
                    items(results, key = { it.id }) { u ->
                        Row(Modifier.fillMaxWidth().clickable { onPick(u) }.padding(vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                            Avatar(u.displayName, u.avatarColor, 40.dp)
                            Column(Modifier.padding(start = 12.dp)) { Text(u.displayName); Text("@${u.username}", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                        }
                    }
                }
            }
        })
}

