package com.pingo.app.ui

import android.Manifest
import android.graphics.BitmapFactory
import android.net.Uri
import android.widget.Toast
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.AttachFile
import androidx.compose.material.icons.filled.Call
import androidx.compose.material.icons.filled.CloudDownload
import androidx.compose.material.icons.filled.CloudOff
import androidx.compose.material.icons.filled.Done
import androidx.compose.material.icons.filled.DoneAll
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.Image
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material.icons.filled.Send
import androidx.compose.material.icons.filled.Videocam
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.pingo.app.call.CallActivity
import com.pingo.app.calls
import com.pingo.app.data.Attachment
import com.pingo.app.data.Message
import com.pingo.app.data.Net
import com.pingo.app.repo
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.text.DateFormat
import java.util.Date

@Composable
fun ChatScreen(convId: String, onBack: () -> Unit) {
    val ctx = LocalContext.current
    val repo = ctx.repo
    val scope = rememberCoroutineScope()
    val me by repo.me.collectAsState()
    val convs by repo.conversations.collectAsState()
    val all by repo.messages.collectAsState()
    val typing by repo.typing.collectAsState()
    val netKind by repo.net.kind.collectAsState()
    val enterSend by repo.settings.enterIsSend.collectAsState()
    val conv = convs.firstOrNull { it.id == convId }
    val msgs = all[convId].orEmpty()
    val title = conv?.title(me?.id.orEmpty()) ?: ""
    var text by remember { mutableStateOf("") }
    var loaded by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var actionFor by remember { mutableStateOf<Message?>(null) }
    var deleteFor by remember { mutableStateOf<Message?>(null) }
    val listState = rememberLazyListState()
    val clipboard = LocalClipboardManager.current
    BackHandler(onBack = onBack)

    DisposableEffect(convId) {
        repo.setActive(convId)
        onDispose { repo.setActive("") }
    }
    // Local copy shows instantly (also with no internet); the server refresh follows in the background.
    LaunchedEffect(convId) { repo.loadMessages(convId); loaded = true; repo.markRead(convId) }
    LaunchedEffect(msgs.size) { if (msgs.isNotEmpty()) listState.animateScrollToItem(msgs.lastIndex) }
    LaunchedEffect(text) { if (text.isNotEmpty() && repo.net.online) { repo.typing(convId, true); delay(2500); repo.typing(convId, false) } }

    fun send() {
        val c = conv ?: return; val t = text; if (t.isBlank()) return
        text = ""; error = null
        scope.launch { try { repo.sendText(c, t) } catch (e: Exception) { error = e.message; text = t } }
    }

    val pick = rememberLauncherForActivityResult(ActivityResultContracts.PickMultipleVisualMedia(10)) { uris: List<Uri> ->
        if (uris.isNotEmpty() && conv != null) scope.launch { try { repo.sendAttachments(conv, uris) } catch (e: Exception) { error = e.message } }
    }
    val pickFile = rememberLauncherForActivityResult(ActivityResultContracts.GetMultipleContents()) { uris: List<Uri> ->
        if (uris.isNotEmpty() && conv != null) scope.launch { try { repo.sendAttachments(conv, uris) } catch (e: Exception) { error = e.message } }
    }

    var pendingKind by remember { mutableStateOf<String?>(null) }
    val perms = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { res ->
        val kind = pendingKind; pendingKind = null
        if (kind != null && res[Manifest.permission.RECORD_AUDIO] == true && conv != null) {
            ctx.calls.startOutgoing(conv, kind)
            ctx.startActivity(android.content.Intent(ctx, CallActivity::class.java))
        }
    }
    fun call(kind: String) {
        if (!repo.net.online) { Toast.makeText(ctx, "You're offline", Toast.LENGTH_SHORT).show(); return }
        pendingKind = kind
        perms.launch(if (kind == "video") arrayOf(Manifest.permission.RECORD_AUDIO, Manifest.permission.CAMERA) else arrayOf(Manifest.permission.RECORD_AUDIO))
    }

    Column(Modifier.fillMaxSize().safeDrawingPadding().imePadding()) {
        Row(Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surface).padding(horizontal = 4.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) { Icon(Icons.Filled.ArrowBack, "Back") }
            Avatar(title, conv?.other(me?.id.orEmpty())?.avatarColor.orEmpty(), 38.dp)
            Column(Modifier.weight(1f).padding(start = 10.dp)) {
                Text(title, fontWeight = androidx.compose.ui.text.font.FontWeight.SemiBold, maxLines = 1)
                if (typing[convId].orEmpty().isNotEmpty()) Text("typing…", fontSize = 12.sp, color = MaterialTheme.colorScheme.primary)
            }
            if (conv?.isGroup == false) {
                IconButton(onClick = { call("audio") }) { Icon(Icons.Filled.Call, "Voice call") }
                IconButton(onClick = { call("video") }) { Icon(Icons.Filled.Videocam, "Video call") }
            }
        }
        if (netKind == Net.Kind.NONE) Row(Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surfaceVariant).padding(horizontal = 16.dp, vertical = 5.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Filled.CloudOff, null, Modifier.size(14.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
            Text("  Offline — messages will send when you're back online", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Box(Modifier.weight(1f).fillMaxWidth()) {
            if (!loaded && msgs.isEmpty()) CircularProgressIndicator(Modifier.align(Alignment.Center))
            LazyColumn(Modifier.fillMaxSize(), state = listState, contentPadding = PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                items(msgs, key = { it.id }) { m ->
                    Bubble(m, mine = m.sender?.id == me?.id, group = conv?.isGroup == true,
                        onLong = { actionFor = m }, onRetry = { scope.launch { repo.retryFailed(m.clientId) } })
                }
            }
        }
        error?.let { Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(horizontal = 16.dp), fontSize = 13.sp) }
        Row(Modifier.fillMaxWidth().padding(8.dp), verticalAlignment = Alignment.Bottom) {
            IconButton(onClick = { pick.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageAndVideo)) }) { Icon(Icons.Filled.Image, "Photo or video") }
            IconButton(onClick = { pickFile.launch("*/*") }) { Icon(Icons.Filled.AttachFile, "File") }
            OutlinedTextField(text, { text = it }, Modifier.weight(1f), maxLines = 5, shape = RoundedCornerShape(24.dp),
                keyboardOptions = KeyboardOptions(imeAction = if (enterSend) ImeAction.Send else ImeAction.Default),
                keyboardActions = KeyboardActions(onSend = { send() }),
                leadingIcon = { Icon(Icons.Filled.Lock, null, Modifier.size(16.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant) })
            IconButton(enabled = text.isNotBlank() && conv != null, onClick = { send() }) { Icon(Icons.Filled.Send, "Send", tint = MaterialTheme.colorScheme.primary) }
        }
    }

    // ---- long-press menu ----
    actionFor?.let { m ->
        AlertDialog(onDismissRequest = { actionFor = null }, confirmButton = {}, dismissButton = { TextButton(onClick = { actionFor = null }) { Text("Close") } },
            text = {
                Column {
                    if (m.text.isNotEmpty()) MenuRow("Copy") { clipboard.setText(AnnotatedString(m.text)); actionFor = null }
                    val downloadable = m.attachments.filter { !it.url.startsWith("outbox:") }
                    if (downloadable.isNotEmpty()) MenuRow("Save to gallery / Downloads") {
                        actionFor = null
                        scope.launch {
                            val ok = downloadable.map { repo.saveAttachmentToDevice(m, it) }.all { it }
                            Toast.makeText(ctx, if (ok) "Saved to your device" else "Couldn't save", Toast.LENGTH_SHORT).show()
                        }
                    }
                    if (downloadable.any { repo.isDownloaded(it) }) MenuRow("Remove downloaded files from this phone") {
                        actionFor = null; scope.launch { repo.removeMediaOnly(m, alsoGallery = false); Toast.makeText(ctx, "Removed from this phone", Toast.LENGTH_SHORT).show() }
                    }
                    MenuRow("Delete…", MaterialTheme.colorScheme.error) { deleteFor = m; actionFor = null }
                }
            })
    }

    // ---- delete options: message only vs. also remove the files from the device ----
    deleteFor?.let { m ->
        val mine = m.sender?.id == me?.id
        val hasFiles = m.attachments.isNotEmpty() && m.sendState == 0
        var alsoFiles by remember(m.id) { mutableStateOf(true) }
        AlertDialog(onDismissRequest = { deleteFor = null },
            title = { Text("Delete message?") },
            text = {
                Column {
                    if (hasFiles) Row(Modifier.fillMaxWidth().clickable { alsoFiles = !alsoFiles }, verticalAlignment = Alignment.CenterVertically) {
                        Checkbox(alsoFiles, { alsoFiles = it })
                        Text("Also delete the files from this phone (including the copy saved in your gallery)", fontSize = 14.sp)
                    }
                }
            },
            confirmButton = {
                Column(horizontalAlignment = Alignment.End) {
                    TextButton(onClick = { deleteFor = null; scope.launch { repo.deleteForMe(m, hasFiles && alsoFiles) } }) { Text("Delete for me") }
                    if (mine && m.sendState == 0) TextButton(onClick = {
                        deleteFor = null
                        scope.launch { try { repo.deleteForEveryone(m, hasFiles && alsoFiles) } catch (e: Exception) { Toast.makeText(ctx, "Needs internet: ${e.message}", Toast.LENGTH_SHORT).show() } }
                    }) { Text("Delete for everyone", color = MaterialTheme.colorScheme.error) }
                    TextButton(onClick = { deleteFor = null }) { Text("Cancel") }
                }
            })
    }
}

@Composable
private fun MenuRow(label: String, color: Color = Color.Unspecified, onClick: () -> Unit) =
    Text(label, color = color, modifier = Modifier.fillMaxWidth().clickable(onClick = onClick).padding(vertical = 14.dp), fontSize = 16.sp)

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun Bubble(m: Message, mine: Boolean, group: Boolean, onLong: () -> Unit, onRetry: () -> Unit) {
    val shape = RoundedCornerShape(20.dp, 20.dp, if (mine) 6.dp else 20.dp, if (mine) 20.dp else 6.dp)
    Row(Modifier.fillMaxWidth(), horizontalArrangement = if (mine) Arrangement.End else Arrangement.Start) {
        Column(Modifier.widthIn(max = 300.dp).clip(shape)
            .background(if (mine) MintBubble else MaterialTheme.colorScheme.surfaceVariant)
            .combinedClickable(onClick = { if (m.sendState == 2) onRetry() }, onLongClick = onLong)
            .padding(horizontal = 12.dp, vertical = 8.dp)) {
            if (group && !mine) Text(m.sender?.displayName.orEmpty(), color = MaterialTheme.colorScheme.secondary, fontSize = 12.sp)
            m.attachments.forEach { AttachmentView(m, it) }
            val ink = if (mine) Color(0xFF04141C) else MaterialTheme.colorScheme.onSurface
            when {
                m.callKind != null -> Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(if (m.callKind == "video") Icons.Filled.Videocam else Icons.Filled.Call, null, Modifier.size(18.dp), tint = ink)
                    Text("  " + (if (m.callStatus == "missed") "Missed call" else "Call"), fontSize = 15.sp, color = ink)
                }
                m.deleted -> Text("This message was deleted", color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 14.sp)
                m.locked -> Row(verticalAlignment = Alignment.CenterVertically) { Icon(Icons.Filled.Lock, null, Modifier.size(14.dp), tint = ink); Text("  Can't decrypt on this device", fontSize = 13.sp, color = ink) }
                m.text.isNotEmpty() -> Text(m.text, fontSize = 16.sp, color = ink)
            }
            Row(Modifier.align(Alignment.End), verticalAlignment = Alignment.CenterVertically) {
                if (m.sendState == 2) Text("Failed — tap to retry  ", fontSize = 11.sp, color = MaterialTheme.colorScheme.error)
                Text(DateFormat.getTimeInstance(DateFormat.SHORT).format(Date(m.createdAt)), fontSize = 11.sp, color = ink.copy(alpha = 0.6f))
                if (mine) Icon(
                    when { m.sendState == 1 -> Icons.Filled.Schedule; m.sendState == 2 -> Icons.Filled.ErrorOutline; m.readBy.size > 1 -> Icons.Filled.DoneAll; else -> Icons.Filled.Done },
                    null, Modifier.padding(start = 4.dp).size(14.dp), tint = if (m.sendState == 2) MaterialTheme.colorScheme.error else ink.copy(alpha = 0.6f))
            }
        }
    }
}

private val MintBubble = Color(0xFF6FF7CF).copy(alpha = 0.88f)

private val imageCache = object : android.util.LruCache<String, android.graphics.Bitmap>(24 * 1024 * 1024) {
    override fun sizeOf(key: String, v: android.graphics.Bitmap) = v.byteCount
}

@Composable
private fun AttachmentView(m: Message, a: Attachment) {
    val repo = LocalContext.current.repo
    val scope = rememberCoroutineScope()
    val tick by repo.mediaTick.collectAsState()
    val downloaded = remember(tick, a.url) { repo.isDownloaded(a) }
    var busy by remember { mutableStateOf(false) }
    var failed by remember { mutableStateOf(false) }

    if (a.kind == "image" && downloaded) {
        val bmp by produceState<android.graphics.Bitmap?>(imageCache.get(a.url), a.url, m.mk, tick) {
            if (value == null) value = try {
                val bytes = repo.attachmentBytes(m, a)
                BitmapFactory.decodeByteArray(bytes, 0, bytes.size)?.also { imageCache.put(a.url, it) }
            } catch (_: Exception) { null }
        }
        Box(Modifier.padding(bottom = 6.dp).clip(RoundedCornerShape(14.dp)).size(220.dp).background(Color.Black.copy(alpha = 0.2f)), Alignment.Center) {
            bmp?.let { Image(it.asImageBitmap(), a.name, Modifier.fillMaxSize(), contentScale = ContentScale.Crop) } ?: CircularProgressIndicator(Modifier.size(24.dp), strokeWidth = 2.dp)
        }
    } else if (!downloaded) {
        // Not on the phone yet (auto-download is off for this network, or it's still waiting): tap to download.
        Row(Modifier.padding(bottom = 6.dp).clip(RoundedCornerShape(12.dp)).background(Color.Black.copy(alpha = 0.12f))
            .clickable(enabled = !busy) {
                busy = true; failed = false
                scope.launch { try { repo.downloadNow(m, a) } catch (_: Exception) { failed = true }; busy = false }
            }.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
            if (busy) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp) else Icon(if (failed) Icons.Filled.CloudOff else Icons.Filled.CloudDownload, null)
            Column(Modifier.padding(start = 10.dp)) {
                Text(a.name.ifEmpty { if (a.kind == "image") "Photo" else "File" }, fontSize = 14.sp, maxLines = 1)
                Text(if (failed) "Couldn't download — tap to retry" else sizeText(a.size), fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    } else {
        Row(Modifier.padding(bottom = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Filled.AttachFile, null, Modifier.size(18.dp)); Text("  " + a.name.ifEmpty { "File" }, fontSize = 14.sp, maxLines = 1)
        }
    }
}

private fun sizeText(b: Long): String = when {
    b <= 0 -> "Tap to download"
    b < 1024 * 1024 -> "${b / 1024} KB · tap to download"
    else -> "%.1f MB · tap to download".format(b / 1048576.0)
}
