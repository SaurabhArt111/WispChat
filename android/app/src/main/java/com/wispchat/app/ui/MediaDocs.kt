package com.wispchat.app.ui

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.ChevronRight
import androidx.compose.material.icons.rounded.Description
import androidx.compose.material.icons.rounded.Link
import androidx.compose.material.icons.rounded.OpenInNew
import androidx.compose.material.icons.rounded.PhotoLibrary
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.TabRowDefaults
import androidx.compose.material3.TabRowDefaults.tabIndicatorOffset
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.wispchat.app.data.Attachment
import com.wispchat.app.data.Message
import com.wispchat.app.repo
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** What a chat has shared, newest first. */
private class ChatShared(val media: List<MediaItem>, val links: List<Pair<Message, String>>, val docs: List<Pair<Message, Attachment>>) {
    val total get() = media.size + links.size + docs.size
}

private fun indexShared(list: List<Message>): ChatShared {
    val media = ArrayList<MediaItem>(); val links = ArrayList<Pair<Message, String>>(); val docs = ArrayList<Pair<Message, Attachment>>()
    for (m in list) {
        for (a in m.attachments) when {
            a.url.startsWith("outbox:") -> {}
            (a.kind == "image" || a.kind == "video") && !isStickerAttachment(a) -> media += MediaItem(m, a)
            a.kind == "file" || a.kind == "audio" && !a.name.startsWith("voice-note") -> docs += m to a
        }
        if (m.text.isNotBlank()) urlRegex.findAll(m.text).forEach { links += m to it.value.trimEnd('.', ',', ')', '!', '?') }
    }
    return ChatShared(media, links.distinctBy { it.first.id + it.second }, docs)
}

@Composable
private fun rememberShared(convId: String): ChatShared? {
    val repo = LocalContext.current.repo
    val all by repo.messages.collectAsState()
    val tick by repo.mediaTick.collectAsState()
    val onScreen = all[convId]?.size ?: 0
    val shared by produceState<ChatShared?>(null, convId, onScreen, tick) { value = indexShared(repo.chatArchive(convId)) }
    return shared
}

/**
 * Contact / group info row: "Media, links and docs  N >" with the 4 newest photos & videos underneath.
 * Tap the row for the full Media | Links | Docs page, a picture to open it.
 */
@Composable
fun MediaLinksDocsRow(convId: String, nav: Nav) {
    val shared = rememberShared(convId)
    var viewer by remember { mutableStateOf<Int?>(null) }
    Column(Modifier.fillMaxWidth()) {
        Row(Modifier.fillMaxWidth().clickable { nav.push(Route.MediaDocs(convId)) }.padding(horizontal = 20.dp, vertical = 14.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("Media, links and docs", fontSize = 15.sp, modifier = Modifier.weight(1f))
            Text(shared?.total?.takeIf { it > 0 }?.toString().orEmpty(), color = wc.dim, fontSize = 14.sp)
            Icon(Icons.Rounded.ChevronRight, null, tint = wc.dim)
        }
        val latest = shared?.media?.take(4).orEmpty()
        if (latest.isNotEmpty()) Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, bottom = 14.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            latest.forEachIndexed { i, mi -> MediaCell(mi.m, mi.a, Modifier.weight(1f).aspectRatio(1f), { _, _ -> viewer = i }) }
            repeat(4 - latest.size) { Box(Modifier.weight(1f)) }
        }
    }
    val items = shared?.media.orEmpty()
    viewer?.let { i -> MediaViewer(items, i, onDismiss = { viewer = null }, onShowInChat = { m -> viewer = null; nav.showMessage(convId, m.id) }) }
}

/** Full page: Media | Links | Docs. Tap anything to jump to that message in the chat. */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun MediaDocsScreen(convId: String, nav: Nav) {
    val ctx = LocalContext.current
    val repo = ctx.repo
    val scope = rememberCoroutineScope()
    val convs by repo.conversations.collectAsState()
    val title = convs.firstOrNull { it.id == convId }?.title(repo.myId).orEmpty()
    val shared = rememberShared(convId)
    val pager = rememberPagerState(pageCount = { 3 })
    var viewer by remember { mutableStateOf<Int?>(null) }
    val tabs = listOf("Media", "Links", "Docs")

    Column(Modifier.fillMaxSize()) {
        WispTopBar(title.ifEmpty { "Media, links and docs" }, onBack = { nav.pop() })
        TabRow(pager.currentPage, containerColor = MaterialTheme.colorScheme.background, contentColor = MaterialTheme.colorScheme.primary,
            indicator = { pos -> TabRowDefaults.SecondaryIndicator(Modifier.tabIndicatorOffset(pos[pager.currentPage]), color = MaterialTheme.colorScheme.primary) }) {
            tabs.forEachIndexed { i, t ->
                Tab(pager.currentPage == i, { scope.launch { pager.animateScrollToPage(i) } },
                    text = { Text(t, fontWeight = if (pager.currentPage == i) FontWeight.SemiBold else FontWeight.Normal) },
                    selectedContentColor = MaterialTheme.colorScheme.primary, unselectedContentColor = wc.dim)
            }
        }
        HorizontalPager(pager, Modifier.weight(1f).fillMaxWidth()) { page ->
            val s = shared
            when {
                s == null -> SkeletonList(6, 44.dp)
                page == 0 -> if (s.media.isEmpty()) EmptyState(Icons.Rounded.PhotoLibrary, "No media", "Photos and videos you share in this chat will appear here.")
                    else MediaGrid(s.media) { viewer = it }
                page == 1 -> if (s.links.isEmpty()) EmptyState(Icons.Rounded.Link, "No links", "Links you share in this chat will appear here.")
                    else LazyColumn(Modifier.fillMaxSize()) {
                        items(s.links, key = { it.first.id + it.second }) { (m, url) ->
                            Row(Modifier.fillMaxWidth().clickable { nav.showMessage(convId, m.id) }.padding(horizontal = 16.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                                Box(Modifier.size(48.dp).clip(RoundedCornerShape(10.dp)).background(wc.surface3), Alignment.Center) { Icon(Icons.Rounded.Link, null, tint = wc.wisp) }
                                Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
                                    Text(Uri.parse(if (url.startsWith("http")) url else "https://$url").host?.removePrefix("www.") ?: url, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                    Text(url, color = wc.wisp, fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                    Text("${senderLabel(m, repo.myId)} · ${shortDate(m.createdAt)}", color = wc.dim, fontSize = 12.sp, maxLines = 1)
                                }
                                IconButton(onClick = { runCatching { ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(if (url.startsWith("http")) url else "https://$url"))) } }) {
                                    Icon(Icons.Rounded.OpenInNew, "Open link", tint = wc.dim)
                                }
                            }
                        }
                    }
                else -> if (s.docs.isEmpty()) EmptyState(Icons.Rounded.Description, "No documents", "Documents you share in this chat will appear here.")
                    else LazyColumn(Modifier.fillMaxSize()) {
                        items(s.docs, key = { it.first.id + it.second.url }) { (m, a) ->
                            Row(Modifier.fillMaxWidth().clickable { nav.showMessage(convId, m.id) }.padding(horizontal = 16.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                                val ext = a.name.substringAfterLast('.', "").uppercase().take(4).ifEmpty { "FILE" }
                                Box(Modifier.size(48.dp).clip(RoundedCornerShape(10.dp)).background(wc.wispDim), Alignment.Center) {
                                    Text(ext, color = wc.wisp, fontWeight = FontWeight.Bold, fontSize = 12.sp)
                                }
                                Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
                                    Text(a.name.ifEmpty { "Document" }, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                    Text("${formatBytes(a.size)} · $ext · ${shortDate(m.createdAt)}", color = wc.dim, fontSize = 12.sp, maxLines = 1)
                                    Text(senderLabel(m, repo.myId), color = wc.dim, fontSize = 12.sp, maxLines = 1)
                                }
                                Icon(Icons.Rounded.ChevronRight, null, tint = wc.dim)
                            }
                        }
                    }
            }
        }
    }
    val media = shared?.media.orEmpty()
    viewer?.let { i -> MediaViewer(media, i, onDismiss = { viewer = null }, onShowInChat = { m -> viewer = null; nav.showMessage(convId, m.id) }) }
}

/** Month-grouped 4-column grid, like WhatsApp. */
@Composable
private fun MediaGrid(media: List<MediaItem>, onOpen: (Int) -> Unit) {
    val month = remember { SimpleDateFormat("MMMM yyyy", Locale.getDefault()) }
    val groups = remember(media) { media.withIndex().groupBy { month.format(Date(it.value.m.createdAt)) } }
    LazyVerticalGrid(GridCells.Fixed(4), Modifier.fillMaxSize(), contentPadding = PaddingValues(2.dp),
        horizontalArrangement = Arrangement.spacedBy(2.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        groups.forEach { (label, list) ->
            item(key = "h$label", span = { GridItemSpan(maxLineSpan) }) {
                Text(label, color = wc.dim, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(start = 12.dp, top = 14.dp, bottom = 6.dp))
            }
            items(list, key = { it.value.m.id + it.value.a.url }) { (i, mi) ->
                MediaCell(mi.m, mi.a, Modifier.aspectRatio(1f), { _, _ -> onOpen(i) })
            }
        }
    }
}

private fun senderLabel(m: Message, me: String) = if (m.sender?.id == me) "You" else m.sender?.displayName.orEmpty()
private fun shortDate(ms: Long): String = SimpleDateFormat("d MMM yyyy", Locale.getDefault()).format(Date(ms))
