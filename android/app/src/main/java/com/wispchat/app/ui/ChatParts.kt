@file:OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class, androidx.compose.material3.ExperimentalMaterial3Api::class)

package com.wispchat.app.ui

import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.MediaPlayer
import android.net.Uri
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.spring
import androidx.compose.foundation.*
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectVerticalDragGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.*
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withLink
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.core.content.FileProvider
import com.wispchat.app.App
import com.wispchat.app.data.Attachment
import com.wispchat.app.data.Message
import com.wispchat.app.data.Repo
import com.wispchat.app.data.Social
import com.wispchat.app.repo
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.security.MessageDigest
import kotlin.math.roundToInt

// ================================================================================================ helpers

val QuickReactions = listOf("👍", "❤️", "😂", "😮", "😢", "🙏")

private val urlRegex = Regex("""https?://[^\s<>"']+""")
fun firstUrl(text: String): String? = urlRegex.find(text)?.value?.trimEnd('.', ',', ')', '!', '?')

/** Text with tappable links (LinkAnnotation opens them through the system browser). */
fun linkified(text: String, linkColor: Color): AnnotatedString = buildAnnotatedString {
    var last = 0
    for (m in urlRegex.findAll(text)) {
        append(text.substring(last, m.range.first))
        val url = m.value.trimEnd('.', ',', ')', '!', '?')
        withLink(LinkAnnotation.Url(url, TextLinkStyles(SpanStyle(color = linkColor, textDecoration = TextDecoration.Underline)))) { append(url) }
        append(m.value.substring(url.length))
        last = m.range.last + 1
    }
    append(text.substring(last))
}

private fun sha1(s: String) = MessageDigest.getInstance("SHA-1").digest(s.toByteArray()).joinToString("") { "%02x".format(it) }

/** A real file for players / share sheets: the decrypted attachment is written once into the cache directory. */
suspend fun Repo.playableFile(m: Message, a: Attachment): File = withContext(Dispatchers.IO) {
    if (a.url.startsWith("outbox:")) return@withContext File(a.url.removePrefix("outbox:"))
    val ext = a.name.substringAfterLast('.', "").take(5).ifEmpty { when (a.kind) { "video" -> "mp4"; "audio" -> "m4a"; "image" -> "jpg"; else -> "bin" } }
    val f = File(App.instance.cacheDir, "play_${sha1(a.url)}.$ext")
    if (!f.exists() || f.length() == 0L) f.writeBytes(attachmentBytes(m, a))
    f
}

fun fileUri(file: File): Uri = FileProvider.getUriForFile(App.instance, App.instance.packageName + ".files", file)

private val bitmapCache = object : android.util.LruCache<String, Bitmap>(32 * 1024 * 1024) {
    override fun sizeOf(key: String, v: Bitmap) = v.byteCount
}

private fun decodeSampled(bytes: ByteArray, maxPx: Int): Bitmap? {
    val o = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, o)
    var sample = 1
    while (o.outWidth / (sample * 2) >= maxPx || o.outHeight / (sample * 2) >= maxPx) sample *= 2
    return BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample })
}

/** Decoded image attachment (cached). Null while it is not on the phone yet or still decoding. */
@Composable
private fun rememberAttachmentBitmap(m: Message, a: Attachment, downloaded: Boolean, maxPx: Int): State<Bitmap?> {
    val repo = LocalContext.current.repo
    val key = "${a.url}@$maxPx"
    return produceState<Bitmap?>(bitmapCache.get(key), key, downloaded, m.mk) {
        if (value == null && downloaded) value = withContext(Dispatchers.IO) {
            try { decodeSampled(repo.attachmentBytes(m, a), maxPx)?.also { bitmapCache.put(key, it) } } catch (_: Exception) { null }
        }
    }
}

// ================================================================================================ small pieces

@Composable
fun DayPill(label: String) {
    Box(Modifier.fillMaxWidth().padding(vertical = 8.dp), Alignment.Center) {
        Text(label, fontSize = 12.sp, color = wc.dim, modifier = Modifier.clip(RoundedCornerShape(10.dp)).background(wc.surface3).padding(horizontal = 12.dp, vertical = 4.dp))
    }
}

/** Date chip that floats at the top of the message list while scrolling. */
@Composable
fun BoxScope.StickyDay(label: String?, visible: Boolean) {
    AnimatedVisibility(visible && label != null, Modifier.align(Alignment.TopCenter).padding(top = 8.dp), enter = fadeIn(), exit = fadeOut()) {
        Text(label.orEmpty(), fontSize = 12.sp, color = wc.dim, modifier = Modifier.clip(RoundedCornerShape(10.dp)).background(wc.surface3).padding(horizontal = 12.dp, vertical = 4.dp))
    }
}

@Composable
fun CallPill(m: Message, mine: Boolean) {
    val kind = if (m.callKind == "video") "video" else "voice"
    val missed = m.callStatus == "missed"
    val label = when {
        missed -> if (mine) "No answer · $kind call" else "Missed $kind call"
        m.callStatus == "declined" -> "$kind call declined".replaceFirstChar { it.uppercase() }
        m.callDuration > 0 -> "${kind.replaceFirstChar { it.uppercase() }} call · ${formatDuration(m.callDuration)}"
        else -> "${kind.replaceFirstChar { it.uppercase() }} call"
    }
    Box(Modifier.fillMaxWidth().padding(vertical = 6.dp), Alignment.Center) {
        Row(Modifier.clip(RoundedCornerShape(14.dp)).background(wc.surface3).padding(horizontal = 12.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(if (m.callKind == "video") Icons.Filled.Videocam else Icons.Filled.Call, null, Modifier.size(16.dp), tint = if (missed) MaterialTheme.colorScheme.error else wc.wisp)
            Text("  $label · ${formatClock(m.createdAt)}", fontSize = 12.sp, color = wc.dim)
        }
    }
}

private val senderColors = listOf(Color(0xFF3DDBA7), Color(0xFF5CC8FF), Color(0xFFB39DFF), Color(0xFFFF9E6B), Color(0xFFFF7A8A), Color(0xFFFFD166), Color(0xFFA3E635), Color(0xFFF472B6))
private fun senderColor(id: String) = senderColors[(id.hashCode() and 0x7fffffff) % senderColors.size]

// ================================================================================================ message bubble

/**
 * One message. Drag it to the right to reply, long-press for the menu, tap an image to open the viewer.
 * [enabledSwipe] is off in selection mode and for messages that can't be replied to.
 */
@Composable
fun MessageBubble(
    m: Message, mine: Boolean, showName: Boolean, selected: Boolean, highlighted: Boolean, selecting: Boolean,
    onOpenMedia: (Message, Attachment) -> Unit, onJumpTo: (String) -> Unit, onReact: (Message, String) -> Unit,
    onRetry: () -> Unit, onReply: () -> Unit, onLong: () -> Unit, onTap: () -> Unit, modifier: Modifier = Modifier,
) {
    val scope = rememberCoroutineScope()
    val haptic = LocalHapticFeedback.current
    val off = remember { Animatable(0f) }
    val trigger = with(LocalDensity.current) { 64.dp.toPx() }
    var fired by remember { mutableStateOf(false) }
    val canReply = !selecting && !m.deleted && m.sendState == 0
    val shape = RoundedCornerShape(18.dp, 18.dp, if (mine) 4.dp else 18.dp, if (mine) 18.dp else 4.dp)
    val ink = if (mine) wc.onBubbleMine else wc.onBubbleTheirs
    val faintInk = ink.copy(alpha = 0.65f)

    Box(
        modifier.fillMaxWidth()
            .background(if (selected) wc.wisp.copy(alpha = 0.26f) else if (highlighted) wc.wisp.copy(alpha = 0.16f) else Color.Transparent)
            // the whole row (not just the bubble) selects / toggles selection
            .combinedClickable(
                indication = null, interactionSource = remember { androidx.compose.foundation.interaction.MutableInteractionSource() },
                onClick = { if (selecting) onTap() }, onLongClick = onLong,
            )
            .then(if (canReply) Modifier.pointerInput(m.id) {
                detectHorizontalDragGestures(
                    onDragStart = { fired = false },
                    onDragEnd = { scope.launch { off.animateTo(0f, spring()) } },
                    onDragCancel = { scope.launch { off.animateTo(0f, spring()) } },
                    onHorizontalDrag = { change, dx ->
                        val next = (off.value + dx * 0.55f).coerceIn(0f, trigger * 1.3f)
                        if (next > 0f || off.value > 0f) change.consume()
                        scope.launch { off.snapTo(next) }
                        if (next >= trigger && !fired) { fired = true; haptic.performHapticFeedback(HapticFeedbackType.LongPress); onReply() }
                    },
                )
            } else Modifier)
            .padding(horizontal = 10.dp, vertical = 2.dp),
    ) {
        // the reply arrow that appears behind the bubble while dragging
        if (off.value > 8f) Box(Modifier.align(Alignment.CenterStart).graphicsLayer { alpha = (off.value / trigger).coerceIn(0f, 1f); scaleX = 0.6f + 0.4f * (off.value / trigger).coerceIn(0f, 1f); scaleY = scaleX }
            .size(32.dp).clip(CircleShape).background(wc.surface4), Alignment.Center) { Icon(Icons.Filled.Reply, null, Modifier.size(18.dp), tint = wc.wisp) }

        Row(Modifier.fillMaxWidth().offset { IntOffset(off.value.roundToInt(), 0) }, horizontalArrangement = if (mine) Arrangement.End else Arrangement.Start) {
            Column(horizontalAlignment = if (mine) Alignment.End else Alignment.Start) {
                Column(
                    Modifier.widthIn(max = 310.dp).clip(shape)
                        .then(if (mine) Modifier.background(wc.bubbleMine) else Modifier.background(wc.bubbleTheirs))
                        .combinedClickable(onClick = { if (m.sendState == 2 && !selecting) onRetry() else onTap() }, onLongClick = onLong)
                        .padding(horizontal = 6.dp, vertical = 5.dp),
                ) {
                    if (showName && !mine) Text(m.sender?.displayName.orEmpty(), color = senderColor(m.sender?.id.orEmpty()), fontSize = 12.5.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(start = 6.dp, end = 6.dp, top = 2.dp, bottom = 2.dp))
                    if (m.forwardedFrom != null) Row(Modifier.padding(horizontal = 6.dp, vertical = 2.dp), verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Filled.Shortcut, null, Modifier.size(13.dp), tint = faintInk)
                        Text(" Forwarded", fontSize = 11.5.sp, fontStyle = FontStyle.Italic, color = faintInk)
                    }
                    m.replyTo?.let { r -> ReplyQuote(r, mine, ink) { onJumpTo(r.id) } }
                    m.statusReply?.let { StatusReplyCard(it, ink) }
                    if (!m.deleted && m.attachments.isNotEmpty()) AttachmentsBlock(m, mine, ink, onOpenMedia)
                    val text = m.text
                    when {
                        m.deleted -> Row(Modifier.padding(horizontal = 6.dp, vertical = 2.dp), verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.Filled.Block, null, Modifier.size(14.dp), tint = faintInk); Text(" This message was deleted", fontSize = 14.sp, fontStyle = FontStyle.Italic, color = faintInk)
                        }
                        m.locked -> Row(Modifier.padding(horizontal = 6.dp, vertical = 2.dp), verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.Filled.Lock, null, Modifier.size(14.dp), tint = faintInk); Text(" Can't decrypt on this device", fontSize = 13.sp, color = faintInk)
                        }
                        text.isNotEmpty() -> {
                            Text(linkified(text, if (mine) ink else wc.wisp), fontSize = 16.sp, color = ink, modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp))
                            firstUrl(text)?.let { LinkPreviewCard(it, ink) }
                        }
                    }
                    Row(Modifier.align(Alignment.End).padding(horizontal = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                        if (m.sendState == 2) Text("Failed — tap to retry  ", fontSize = 11.sp, color = MaterialTheme.colorScheme.error)
                        if (m.edited && !m.deleted) Text("edited  ", fontSize = 11.sp, color = faintInk)
                        Text(formatClock(m.createdAt), fontSize = 11.sp, color = faintInk)
                        if (mine && !m.deleted) Icon(
                            when { m.sendState == 1 -> Icons.Filled.Schedule; m.sendState == 2 -> Icons.Filled.ErrorOutline; m.readBy.size > 1 -> Icons.Filled.DoneAll; else -> Icons.Filled.Done },
                            null, Modifier.padding(start = 4.dp).size(15.dp),
                            tint = when { m.sendState == 2 -> MaterialTheme.colorScheme.error; m.readBy.size > 1 -> Sky; else -> faintInk })
                    }
                }
                if (m.reactions.isNotEmpty() && !m.deleted) ReactionsRow(m, mine, onReact)
            }
        }
    }
}

@Composable
private fun ReplyQuote(r: Message, mine: Boolean, ink: Color, onClick: () -> Unit) {
    val ctx = LocalContext.current
    val me = ctx.repo.myId
    val who = if (r.sender?.id == me) "You" else r.sender?.displayName.orEmpty()
    val bar = if (r.sender?.id == me) wc.wisp else senderColor(r.sender?.id.orEmpty())
    Row(Modifier.padding(bottom = 4.dp).clip(RoundedCornerShape(10.dp)).background(Color.Black.copy(alpha = if (mine) 0.14f else 0.18f)).clickable(onClick = onClick).height(IntrinsicSize.Min)) {
        Box(Modifier.width(4.dp).fillMaxHeight().background(bar))
        Column(Modifier.padding(horizontal = 8.dp, vertical = 5.dp).widthIn(min = 120.dp)) {
            Text(who, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = bar, maxLines = 1)
            Text(ctx.repo.previewText(r).ifEmpty { "Message" }, fontSize = 13.sp, color = ink.copy(alpha = 0.8f), maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
    }
}

@Composable
private fun StatusReplyCard(s: com.wispchat.app.data.StatusReply, ink: Color) {
    Row(Modifier.padding(bottom = 4.dp).clip(RoundedCornerShape(10.dp)).background(Color.Black.copy(alpha = 0.16f)), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.padding(horizontal = 10.dp, vertical = 6.dp).widthIn(max = 200.dp)) {
            Text(if (s.isReaction) "Reacted to a status" else "Replied to a status", fontSize = 11.5.sp, fontWeight = FontWeight.SemiBold, color = ink.copy(alpha = 0.75f))
            val body = s.text.ifEmpty { s.caption }
            if (body.isNotEmpty()) Text(body, fontSize = 13.sp, color = ink.copy(alpha = 0.85f), maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
        if (s.kind == "image" && s.url.isNotEmpty()) NetworkImage(s.url, Modifier.size(52.dp))
        else if (s.kind == "text") Box(Modifier.size(52.dp).background(parseColor(s.bgColor, wc.surface4)))
    }
}

@Composable
private fun ReactionsRow(m: Message, mine: Boolean, onReact: (Message, String) -> Unit) {
    val me = LocalContext.current.repo.myId
    val groups = m.reactions.groupBy { it.emoji }
    Row(Modifier.padding(top = 2.dp, start = 6.dp, end = 6.dp).offset(y = (-4).dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        groups.forEach { (emoji, list) ->
            val iReacted = list.any { it.userId == me }
            Row(Modifier.clip(RoundedCornerShape(12.dp)).background(if (iReacted) wc.wispDim else wc.surface3)
                .border(1.dp, if (iReacted) wc.wisp else wc.border, RoundedCornerShape(12.dp))
                .clickable { onReact(m, emoji) }.padding(horizontal = 7.dp, vertical = 2.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(emoji, fontSize = 13.sp)
                if (list.size > 1) Text(" ${list.size}", fontSize = 12.sp, color = wc.dim)
            }
        }
    }
}

@Composable
private fun LinkPreviewCard(url: String, ink: Color) {
    val social = LocalContext.current.repo.social
    val uri = androidx.compose.ui.platform.LocalUriHandler.current
    val preview by produceState<Social.LinkPreview?>(null, url) { value = try { social.linkPreview(url) } catch (_: Exception) { null } }
    val p = preview ?: return
    if (p.title.isEmpty() && p.image.isEmpty()) return
    Column(Modifier.padding(top = 4.dp, bottom = 2.dp).clip(RoundedCornerShape(10.dp)).background(Color.Black.copy(alpha = 0.16f)).clickable { try { uri.openUri(url) } catch (_: Exception) {} }) {
        if (p.image.isNotEmpty()) NetworkImage(p.image, Modifier.fillMaxWidth().heightIn(max = 150.dp).aspectRatio(1.9f))
        Column(Modifier.padding(horizontal = 10.dp, vertical = 6.dp)) {
            if (p.siteName.isNotEmpty()) Text(p.siteName, fontSize = 11.sp, color = ink.copy(alpha = 0.6f), maxLines = 1)
            if (p.title.isNotEmpty()) Text(p.title, fontSize = 13.5.sp, fontWeight = FontWeight.SemiBold, color = ink, maxLines = 2, overflow = TextOverflow.Ellipsis)
            if (p.description.isNotEmpty()) Text(p.description, fontSize = 12.sp, color = ink.copy(alpha = 0.75f), maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
    }
}

// ================================================================================================ attachments

@Composable
private fun AttachmentsBlock(m: Message, mine: Boolean, ink: Color, onOpen: (Message, Attachment) -> Unit) {
    val visual = m.attachments.filter { it.kind == "image" || it.kind == "video" }
    val others = m.attachments.filter { it.kind != "image" && it.kind != "video" }
    if (visual.isNotEmpty()) {
        val cell = 124.dp
        when (visual.size) {
            1 -> {
                val a = visual[0]
                val ratio = if (a.width > 0 && a.height > 0) (a.width.toFloat() / a.height).coerceIn(0.72f, 1.5f) else 1f
                MediaCell(m, a, Modifier.width(250.dp).aspectRatio(ratio), onOpen)
            }
            else -> Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                visual.take(4).chunked(2).forEachIndexed { r, row ->
                    Row(horizontalArrangement = Arrangement.spacedBy(2.dp)) {
                        row.forEachIndexed { c, a ->
                            val extra = if (r == 1 && c == 1 && visual.size > 4) visual.size - 4 else 0
                            MediaCell(m, a, Modifier.size(cell), onOpen, extra)
                        }
                    }
                }
            }
        }
    }
    others.forEach { a -> if (a.kind == "audio") AudioRow(m, a, mine, ink) else FileRow(m, a, ink) }
}

@Composable
private fun MediaCell(m: Message, a: Attachment, modifier: Modifier, onOpen: (Message, Attachment) -> Unit, extra: Int = 0) {
    val repo = LocalContext.current.repo
    val scope = rememberCoroutineScope()
    val tick by repo.mediaTick.collectAsState()
    val downloaded = remember(tick, a.url) { repo.isDownloaded(a) }
    var busy by remember { mutableStateOf(false) }
    var failed by remember { mutableStateOf(false) }
    val bmp by rememberAttachmentBitmap(m, a, downloaded && a.kind == "image", 640)
    Box(modifier.clip(RoundedCornerShape(12.dp)).background(Color(0xFF111820)).clickable(enabled = !busy) {
        if (downloaded) onOpen(m, a) else { busy = true; failed = false; scope.launch { try { repo.downloadNow(m, a) } catch (_: Exception) { failed = true }; busy = false } }
    }, Alignment.Center) {
        bmp?.let { Image(it.asImageBitmap(), a.name, Modifier.fillMaxSize(), contentScale = ContentScale.Crop) }
        if (bmp == null && downloaded && a.kind == "image") CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = 2.dp)
        if (!downloaded) Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Box(Modifier.size(44.dp).clip(CircleShape).background(Color(0x99000000)), Alignment.Center) {
                if (busy) CircularProgressIndicator(Modifier.size(24.dp), strokeWidth = 2.dp, color = Color.White) else Icon(if (failed) Icons.Filled.Refresh else Icons.Filled.Download, null, tint = Color.White)
            }
            Text(if (failed) "Retry" else if (a.size > 0) formatBytes(a.size) else "Download", color = Color.White, fontSize = 11.sp, modifier = Modifier.padding(top = 4.dp))
        } else if (a.kind == "video") {
            Box(Modifier.size(46.dp).clip(CircleShape).background(Color(0x99000000)), Alignment.Center) { Icon(Icons.Filled.PlayArrow, null, tint = Color.White, modifier = Modifier.size(30.dp)) }
            if (a.duration > 0) Text(formatDuration(a.duration.toInt()), color = Color.White, fontSize = 11.sp, modifier = Modifier.align(Alignment.BottomStart).padding(6.dp).clip(RoundedCornerShape(6.dp)).background(Color(0x99000000)).padding(horizontal = 5.dp, vertical = 1.dp))
        }
        if (extra > 0) Box(Modifier.fillMaxSize().background(Color(0x99000000)), Alignment.Center) { Text("+$extra", color = Color.White, fontSize = 26.sp, fontWeight = FontWeight.Bold) }
    }
}

@Composable
private fun FileRow(m: Message, a: Attachment, ink: Color) {
    val ctx = LocalContext.current
    val repo = ctx.repo
    val scope = rememberCoroutineScope()
    val tick by repo.mediaTick.collectAsState()
    val downloaded = remember(tick, a.url) { repo.isDownloaded(a) }
    var busy by remember { mutableStateOf(false) }
    Row(Modifier.padding(bottom = 3.dp).widthIn(min = 200.dp).clip(RoundedCornerShape(12.dp)).background(Color.Black.copy(alpha = 0.16f)).clickable(enabled = !busy) {
        busy = true
        scope.launch {
            try {
                val f = repo.playableFile(m, a)
                val mime = a.mimeType.ifEmpty { "*/*" }
                ctx.startActivity(Intent.createChooser(Intent(Intent.ACTION_VIEW).setDataAndType(fileUri(f), mime).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION), a.name.ifEmpty { "Open file" }))
            } catch (e: android.content.ActivityNotFoundException) { ctx.toast("No app can open this file") } catch (e: Exception) { ctx.toast("Couldn't download — check your connection") }
            busy = false
        }
    }.padding(10.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(40.dp).clip(RoundedCornerShape(10.dp)).background(wc.wispDim), Alignment.Center) {
            if (busy) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp) else Icon(if (downloaded) Icons.Filled.InsertDriveFile else Icons.Filled.CloudDownload, null, tint = wc.wisp)
        }
        Column(Modifier.padding(start = 10.dp).weight(1f, fill = false)) {
            Text(a.name.ifEmpty { "File" }, fontSize = 14.sp, color = ink, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Text(if (a.size > 0) formatBytes(a.size) else "", fontSize = 11.sp, color = ink.copy(alpha = 0.6f))
        }
    }
}

@Composable
private fun AudioRow(m: Message, a: Attachment, mine: Boolean, ink: Color) {
    val repo = LocalContext.current.repo
    val scope = rememberCoroutineScope()
    val tick by repo.mediaTick.collectAsState()
    val downloaded = remember(tick, a.url) { repo.isDownloaded(a) }
    var player by remember { mutableStateOf<MediaPlayer?>(null) }
    var playing by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var pos by remember { mutableStateOf(0) }
    var dur by remember { mutableStateOf((a.duration * 1000).toInt()) }
    DisposableEffect(a.url) { onDispose { try { player?.release() } catch (_: Exception) {} } }
    LaunchedEffect(playing) { while (playing) { pos = try { player?.currentPosition ?: 0 } catch (_: Exception) { 0 }; delay(150) } }

    fun toggle() {
        val p = player
        if (p != null) { if (playing) { p.pause(); playing = false } else { p.start(); playing = true }; return }
        busy = true
        scope.launch {
            try {
                val f = repo.playableFile(m, a)
                val mp = MediaPlayer().apply {
                    setDataSource(f.path); prepare()
                    setOnCompletionListener { playing = false; pos = 0; seekTo(0) }
                }
                dur = mp.duration; player = mp; mp.start(); playing = true
            } catch (_: Exception) {}
            busy = false
        }
    }
    Row(Modifier.padding(horizontal = 4.dp, vertical = 2.dp).widthIn(min = 220.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(42.dp).clip(CircleShape).background(if (mine) Color.Black.copy(alpha = 0.18f) else wc.wispDim).clickable(enabled = !busy) { toggle() }, Alignment.Center) {
            if (busy) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
            else Icon(if (!downloaded) Icons.Filled.Download else if (playing) Icons.Filled.Pause else Icons.Filled.PlayArrow, null, tint = if (mine) ink else wc.wisp)
        }
        Column(Modifier.padding(start = 10.dp).weight(1f)) {
            LinearProgressIndicator(progress = { if (dur > 0) (pos.toFloat() / dur).coerceIn(0f, 1f) else 0f }, Modifier.fillMaxWidth().height(4.dp).clip(CircleShape), color = if (mine) ink else wc.wisp, trackColor = ink.copy(alpha = 0.2f))
            Text(if (dur > 0) "${formatDuration((if (playing || pos > 0) pos else dur) / 1000)}" else formatBytes(a.size), fontSize = 11.sp, color = ink.copy(alpha = 0.65f), modifier = Modifier.padding(top = 3.dp))
        }
        Icon(Icons.Filled.Mic, null, Modifier.padding(start = 6.dp).size(18.dp), tint = ink.copy(alpha = 0.55f))
    }
}

// ================================================================================================ full-screen media viewer

data class MediaItem(val m: Message, val a: Attachment)

/** Swipe left / right through every photo and video of the chat; pinch / double-tap to zoom; drag down to close. */
@Composable
fun MediaViewer(items: List<MediaItem>, start: Int, onDismiss: () -> Unit) {
    val ctx = LocalContext.current
    val repo = ctx.repo
    val scope = rememberCoroutineScope()
    val pager = rememberPagerState(initialPage = start.coerceIn(0, (items.size - 1).coerceAtLeast(0)), pageCount = { items.size })
    var chrome by remember { mutableStateOf(true) }
    var dragY by remember { mutableStateOf(0f) }
    val dismissAt = with(LocalDensity.current) { 140.dp.toPx() }
    val cur = items.getOrNull(pager.currentPage)

    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = (1f - (dragY / (dismissAt * 3f))).coerceIn(0f, 1f)))
            .pointerInput(Unit) {
                detectVerticalDragGestures(
                    onDragEnd = { if (dragY > dismissAt) onDismiss() else dragY = 0f },
                    onDragCancel = { dragY = 0f },
                    onVerticalDrag = { change, dy -> if (dragY > 0f || dy > 0f) { dragY = (dragY + dy).coerceAtLeast(0f); change.consume() } },
                )
            }) {
            HorizontalPager(pager, Modifier.fillMaxSize().graphicsLayer { translationY = dragY }, beyondViewportPageCount = 1, key = { items[it].a.url + items[it].m.id }) { page ->
                val (m, a) = items[page]
                if (a.kind == "video") {
                    val file by produceState<File?>(null, a.url) { value = try { repo.playableFile(m, a) } catch (_: Exception) { null } }
                    Box(Modifier.fillMaxSize().clickable(indication = null, interactionSource = remember { androidx.compose.foundation.interaction.MutableInteractionSource() }) { chrome = !chrome }, Alignment.Center) {
                        file?.let { VideoPlayer(Uri.fromFile(it), Modifier.fillMaxSize(), playing = pager.currentPage == page, loop = false) } ?: CircularProgressIndicator(color = Color.White)
                    }
                } else {
                    val bmp by rememberAttachmentBitmap(m, a, true, 2400)
                    ZoomBox(Modifier.fillMaxSize(), onTap = { chrome = !chrome }) {
                        bmp?.let { Image(it.asImageBitmap(), a.name, Modifier.fillMaxSize(), contentScale = ContentScale.Fit) } ?: Box(Modifier.fillMaxSize(), Alignment.Center) { CircularProgressIndicator(color = Color.White) }
                    }
                }
            }
            AnimatedVisibility(chrome && dragY == 0f, Modifier.align(Alignment.TopCenter), enter = fadeIn(), exit = fadeOut()) {
                Row(Modifier.fillMaxWidth().background(Color(0x99000000)).statusBarsPadding().padding(4.dp), verticalAlignment = Alignment.CenterVertically) {
                    IconButton(onClick = onDismiss) { Icon(Icons.Filled.ArrowBack, "Close", tint = Color.White) }
                    Column(Modifier.weight(1f)) {
                        Text(if (cur?.m?.sender?.id == repo.myId) "You" else cur?.m?.sender?.displayName.orEmpty(), color = Color.White, fontWeight = FontWeight.SemiBold, maxLines = 1)
                        cur?.let { Text("${formatDayLabel(it.m.createdAt)}, ${formatClock(it.m.createdAt)}  ·  ${pager.currentPage + 1}/${items.size}", color = Color(0xB3FFFFFF), fontSize = 12.sp) }
                    }
                    IconButton(onClick = { cur?.let { c -> scope.launch { ctx.toast(if (try { repo.saveAttachmentToDevice(c.m, c.a) } catch (_: Exception) { false }) "Saved to your device" else "Couldn't save") } } }) { Icon(Icons.Filled.Download, "Save", tint = Color.White) }
                    IconButton(onClick = {
                        cur?.let { c -> scope.launch {
                            try {
                                val f = repo.playableFile(c.m, c.a)
                                ctx.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType(c.a.mimeType.ifEmpty { "*/*" }).putExtra(Intent.EXTRA_STREAM, fileUri(f)).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION), "Share"))
                            } catch (_: Exception) { ctx.toast("Couldn't share") }
                        } }
                    }) { Icon(Icons.Filled.Share, "Share", tint = Color.White) }
                }
            }
            val caption = cur?.m?.text.orEmpty()
            AnimatedVisibility(chrome && dragY == 0f && caption.isNotBlank(), Modifier.align(Alignment.BottomCenter), enter = fadeIn(), exit = fadeOut()) {
                Text(caption, color = Color.White, fontSize = 15.sp, maxLines = 4, overflow = TextOverflow.Ellipsis, modifier = Modifier.fillMaxWidth().background(Color(0x99000000)).navigationBarsPadding().padding(16.dp))
            }
        }
    }
}

// ================================================================================================ emoji panel

private val EmojiCategories: List<Pair<String, List<String>>> = listOf(
    "😀" to "😀 😃 😄 😁 😆 😅 😂 🤣 🙂 🙃 😉 😊 😇 🥰 😍 🤩 😘 😗 😚 😋 😛 😜 🤪 😝 🤑 🤗 🤭 🤫 🤔 🤐 😐 😑 😶 😏 😒 🙄 😬 🤥 😌 😔 😪 😴 😷 🤒 🤕 🤢 🤮 🥵 🥶 🥴 😵 🤯 🤠 🥳 😎 🤓 🧐 😕 😟 🙁 😮 😯 😲 😳 🥺 😦 😧 😨 😰 😥 😢 😭 😱 😖 😣 😞 😓 😩 😫 🥱 😤 😡 😠 🤬 😈 👿 💀 💩 🤡 👻 👽 🤖".split(" "),
    "👍" to "👍 👎 👌 ✌️ 🤞 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ ✋ 🤚 🖐 🖖 👋 🤏 💪 🙏 🤝 👏 🙌 👐 🤲 ✍️ 💅 🤳 👀 🧠 👂 👃 👄 👅".split(" "),
    "❤️" to "❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 💟 ♥️ 💋 💯 💢 💥 💫 💦 💨 🔥 ✨ ⭐ 🌟 🎉 🎊 🎈 🎁 🏆".split(" "),
    "🐶" to "🐶 🐱 🐭 🐹 🐰 🦊 🐻 🐼 🐨 🐯 🦁 🐮 🐷 🐸 🐵 🙈 🙉 🙊 🐔 🐧 🐦 🦆 🦉 🦄 🐝 🦋 🐌 🐢 🐍 🐙 🐬 🐳 🌸 🌹 🌻 🌲 🌴 🍀 🌈 ☀️ 🌙 ⚡ ❄️ 🌊".split(" "),
    "🍕" to "🍏 🍎 🍌 🍉 🍇 🍓 🍒 🍑 🍍 🥭 🥑 🍅 🌽 🥕 🍕 🍔 🍟 🌭 🌮 🌯 🍣 🍜 🍝 🍰 🎂 🍩 🍪 🍫 🍿 ☕ 🍵 🍺 🍷 🥂 🍹".split(" "),
    "⚽" to "⚽ 🏀 🏈 ⚾ 🎾 🏐 🏓 🎱 🎮 🎯 🎲 🎵 🎶 🎤 🎧 🎸 📱 💻 📷 🎥 📞 💡 🔑 🔒 💰 💳 ✈️ 🚗 🚀 🏠 🌍 ⏰ 📌 ✅ ❌ ⚠️ ❓ ❗".split(" "),
)

@Composable
fun EmojiPanel(onPick: (String) -> Unit, onBackspace: () -> Unit) {
    var tab by remember { mutableStateOf(0) }
    Column(Modifier.fillMaxWidth().height(280.dp).background(wc.surface2)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            EmojiCategories.forEachIndexed { i, (icon, _) ->
                Box(Modifier.weight(1f).clickable { tab = i }.padding(vertical = 10.dp), Alignment.Center) {
                    Text(icon, fontSize = 20.sp, modifier = Modifier.graphicsLayer { alpha = if (tab == i) 1f else 0.5f })
                }
            }
            IconButton(onClick = onBackspace) { Icon(Icons.Filled.Backspace, "Delete", tint = wc.dim) }
        }
        HorizontalDivider(color = wc.border)
        LazyVerticalGrid(GridCells.Adaptive(44.dp), Modifier.fillMaxSize(), contentPadding = PaddingValues(6.dp)) {
            items(EmojiCategories[tab].second) { e -> Box(Modifier.size(44.dp).clip(CircleShape).clickable { onPick(e) }, Alignment.Center) { Text(e, fontSize = 26.sp) } }
        }
    }
}
