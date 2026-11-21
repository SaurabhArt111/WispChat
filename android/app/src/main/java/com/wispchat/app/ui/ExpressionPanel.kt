package com.wispchat.app.ui

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.spring
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectVerticalDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.foundation.lazy.staggeredgrid.LazyVerticalStaggeredGrid
import androidx.compose.foundation.lazy.staggeredgrid.StaggeredGridCells
import androidx.compose.foundation.lazy.staggeredgrid.items
import androidx.compose.foundation.lazy.staggeredgrid.rememberLazyStaggeredGridState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.EmojiEmotions
import androidx.compose.material.icons.outlined.StickyNote2
import androidx.compose.material.icons.rounded.Backspace
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.History
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import com.wispchat.app.data.ApiException
import com.wispchat.app.repo
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

// ================================================================================================ emoji data

private class EmojiGroup(val icon: String, val name: String, val list: List<String>)

private val EmojiGroups: List<EmojiGroup> = listOf(
    EmojiGroup("😀", "Smileys & people", ("😀 😃 😄 😁 😆 😅 😂 🤣 🥲 🙂 🙃 😉 😊 😇 🥰 😍 🤩 😘 😗 😚 😙 😋 😛 😜 🤪 😝 🤑 🤗 🤭 🫢 🤫 🤔 🫡 🤐 🤨 😐 😑 😶 🫥 😏 😒 🙄 😬 🤥 😌 😔 😪 🤤 😴 😷 🤒 🤕 🤢 🤮 🤧 🥵 🥶 🥴 😵 🤯 🤠 🥳 🥸 😎 🤓 🧐 😕 🫤 😟 🙁 😮 😯 😲 😳 🥺 🥹 😦 😧 😨 😰 😥 😢 😭 😱 😖 😣 😞 😓 😩 😫 🥱 😤 😡 😠 🤬 😈 👿 💀 ☠️ 💩 🤡 👹 👺 👻 👽 👾 🤖 😺 😸 😹 😻 😼 😽 🙀 😿 😾 " +
        "👶 🧒 👦 👧 🧑 👱 👨 🧔 👩 🧓 👴 👵 🙍 🙎 🙅 🙆 💁 🙋 🧏 🙇 🤦 🤷 👮 🕵️ 💂 👷 🤴 👸 👳 👲 🧕 🤵 👰 🤰 🤱 👼 🎅 🤶 🦸 🦹 🧙 🧚 🧛 🧜 🧝 🧞 🧟 💆 💇 🚶 🧍 🧎 🏃 💃 🕺 👯 🧖 🧘 👭 👫 👬 💏 💑 👪").split(" ")),
    EmojiGroup("👋", "Gestures & body", "👋 🤚 🖐️ ✋ 🖖 🫱 🫲 👌 🤌 🤏 ✌️ 🤞 🫰 🤟 🤘 🤙 👈 👉 👆 🖕 👇 ☝️ 🫵 👍 👎 ✊ 👊 🤛 🤜 👏 🙌 🫶 👐 🤲 🤝 🙏 ✍️ 💅 🤳 💪 🦾 🦵 🦶 👂 👃 🧠 🫀 🫁 🦷 🦴 👀 👁️ 👅 👄 🫦".split(" ")),
    EmojiGroup("🐶", "Animals & nature", "🐶 🐱 🐭 🐹 🐰 🦊 🐻 🐼 🐻‍❄️ 🐨 🐯 🦁 🐮 🐷 🐸 🐵 🙈 🙉 🙊 🐔 🐧 🐦 🐤 🦆 🦅 🦉 🦇 🐺 🐗 🐴 🦄 🐝 🪱 🐛 🦋 🐌 🐞 🐜 🦗 🕷️ 🦂 🐢 🐍 🦎 🐙 🦑 🦐 🦀 🐡 🐠 🐟 🐬 🐳 🐋 🦈 🐊 🐅 🐆 🦓 🦍 🐘 🦛 🦏 🐪 🦒 🦘 🐃 🐄 🐎 🐖 🐑 🐐 🦌 🐕 🐈 🐓 🦃 🦚 🦜 🦢 🕊️ 🐇 🦝 🦔 🌵 🎄 🌲 🌳 🌴 🌱 🌿 ☘️ 🍀 🍃 🍂 🍁 🍄 🌾 💐 🌷 🌹 🥀 🌺 🌸 🌼 🌻 🌞 🌝 🌚 🌙 ⭐ 🌟 ✨ ⚡ 🔥 🌈 ☀️ ⛅ ☁️ 🌧️ ⛈️ ❄️ ☃️ 💨 💧 🌊".split(" ")),
    EmojiGroup("🍔", "Food & drink", "🍏 🍎 🍐 🍊 🍋 🍌 🍉 🍇 🍓 🫐 🍈 🍒 🍑 🥭 🍍 🥥 🥝 🍅 🍆 🥑 🥦 🥬 🥒 🌶️ 🌽 🥕 🧄 🧅 🥔 🍠 🥐 🥯 🍞 🥖 🧀 🥚 🍳 🥞 🧇 🥓 🥩 🍗 🍖 🌭 🍔 🍟 🍕 🥪 🌮 🌯 🥗 🍝 🍜 🍲 🍛 🍣 🍱 🥟 🍤 🍙 🍚 🍘 🍢 🍡 🍧 🍨 🍦 🥧 🧁 🍰 🎂 🍮 🍭 🍬 🍫 🍿 🍩 🍪 🥜 🍯 🥛 ☕ 🍵 🧃 🥤 🧋 🍶 🍺 🍻 🥂 🍷 🥃 🍸 🍹 🧉 🧊".split(" ")),
    EmojiGroup("⚽", "Activities", "⚽ 🏀 🏈 ⚾ 🥎 🎾 🏐 🏉 🥏 🎱 🏓 🏸 🏒 🏑 🏏 🥅 ⛳ 🪁 🏹 🎣 🥊 🥋 🎽 🛹 ⛸️ 🎿 🏂 🏋️ 🤸 🤺 🏌️ 🏇 🧗 🚴 🏊 🏆 🥇 🥈 🥉 🏅 🎖️ 🎗️ 🎫 🎟️ 🎪 🎭 🎨 🎬 🎤 🎧 🎼 🎹 🥁 🎷 🎺 🎸 🪕 🎻 🎲 ♟️ 🎯 🎳 🎮 🎰 🧩 🎉 🎊 🎈 🎁 🎀 🪅".split(" ")),
    EmojiGroup("🚗", "Travel & places", "🚗 🚕 🚙 🚌 🏎️ 🚓 🚑 🚒 🚐 🛻 🚚 🚛 🚜 🛵 🏍️ 🛺 🚲 🛴 🚨 🚔 🚍 🚘 🚖 ✈️ 🛫 🛬 🚀 🛸 🚁 ⛵ 🚤 🛳️ ⛴️ 🚢 ⚓ 🚧 ⛽ 🚦 🗺️ 🗿 🗽 🗼 🏰 🏯 🏟️ 🎡 🎢 🎠 ⛲ 🏖️ 🏝️ 🏜️ 🌋 ⛰️ 🏔️ 🏕️ 🏠 🏡 🏢 🏬 🏥 🏦 🏨 🏪 🏫 🕌 🛕 ⛪ 🌅 🌄 🌠 🎇 🎆 🌇 🌆 🏙️ 🌃 🌌 🌉".split(" ")),
    EmojiGroup("💡", "Objects", "⌚ 📱 💻 ⌨️ 🖥️ 🖨️ 🖱️ 💾 💿 📷 📸 📹 🎥 📞 ☎️ 📺 📻 🎙️ ⏰ ⏳ 🔋 🔌 💡 🔦 🕯️ 💸 💵 💰 💳 💎 ⚖️ 🧰 🔧 🔨 🛠️ ⚙️ 🔫 💣 🔪 🛡️ 🔮 💊 💉 🩺 🧬 🧪 🌡️ 🧹 🧺 🧻 🚽 🛁 🧼 🔑 🗝️ 🚪 🛋️ 🛏️ 🧸 🖼️ 🛍️ 🛒 🎁 ✉️ 📩 📦 📮 📝 📁 📅 📌 📎 ✂️ 🔒 🔓 📚 📖 🔖 ✏️ 🖊️ 🖌️ 🔍".split(" ")),
    EmojiGroup("❤️", "Symbols & flags", "❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💔 ❤️‍🔥 ❣️ 💕 💞 💓 💗 💖 💘 💝 💟 ☮️ ✝️ ☪️ 🕉️ ☯️ 🔯 ♈ ♉ ♊ ♋ ♌ ♍ ♎ ♏ ♐ ♑ ♒ ♓ 🆗 🆕 🆒 🆓 🆙 🆘 ⛔ 🚫 ❌ ⭕ ❗ ❓ ‼️ ⁉️ 💯 ✅ ☑️ ✔️ ➕ ➖ ➗ ✖️ 💲 💱 ™️ ©️ ®️ 🔴 🟠 🟡 🟢 🔵 🟣 ⚫ ⚪ 🟤 🔺 🔻 🔶 🔷 💠 🔘 🏁 🚩 🎌 🏴 🏳️ 🏳️‍🌈 🇮🇳 🇺🇸 🇬🇧 🇨🇦 🇦🇺 🇩🇪 🇫🇷 🇯🇵 🇧🇷 🇦🇪 🇸🇦 🇳🇵 🇧🇩 🇵🇰 🇱🇰".split(" ")),
)

private sealed interface GridRow
private data class Header(val title: String) : GridRow
private data class Cell(val e: String, val key: String) : GridRow

private enum class PanelTab { EMOJI, GIF, STICKER }

private data class Gif(val id: String, val preview: String, val url: String, val w: Int, val h: Int)

// ================================================================================================ the panel

/**
 * WhatsApp-style expression panel under the composer: Emoji · GIF · Stickers.
 * Drag the handle (or the tab row) up to expand it to most of the screen, down to shrink it back.
 */
@Composable
fun ExpressionPanel(onEmoji: (String) -> Unit, onBackspace: () -> Unit, onGif: (url: String, sticker: Boolean) -> Unit) {
    val ctx = LocalContext.current
    val repo = ctx.repo
    val scope = rememberCoroutineScope()
    val density = LocalDensity.current
    val screenH = LocalConfiguration.current.screenHeightDp.dp
    val minH = 300.dp
    val maxH = screenH * 0.72f
    val minPx = with(density) { minH.toPx() }
    val maxPx = with(density) { maxH.toPx() }
    val height = remember { Animatable(minPx) }
    var tab by remember { mutableStateOf(PanelTab.EMOJI) }
    var searching by remember { mutableStateOf(false) }
    var query by remember { mutableStateOf("") }

    fun settle(velocity: Float = 0f) = scope.launch {
        val mid = (minPx + maxPx) / 2
        val target = when { velocity < -800f -> maxPx; velocity > 800f -> minPx; height.value > mid -> maxPx; else -> minPx }
        height.animateTo(target, spring(stiffness = 500f))
    }
    val dragHandle = Modifier.pointerInput(Unit) {
        detectVerticalDragGestures(
            onDragEnd = { settle() },
            onDragCancel = { settle() },
            onVerticalDrag = { change, dy -> change.consume(); scope.launch { height.snapTo((height.value - dy).coerceIn(minPx * 0.85f, maxPx)) } },
        )
    }

    Column(Modifier.fillMaxWidth().height(with(density) { height.value.toDp() }).clip(RoundedCornerShape(topStart = 22.dp, topEnd = 22.dp)).background(wc.surface2)) {
        // grip
        Box(Modifier.fillMaxWidth().then(dragHandle).clickable(indication = null, interactionSource = remember { androidx.compose.foundation.interaction.MutableInteractionSource() }) {
            scope.launch { height.animateTo(if (height.value < (minPx + maxPx) / 2) maxPx else minPx, spring(stiffness = 500f)) }
        }.padding(top = 8.dp, bottom = 6.dp), Alignment.Center) {
            Box(Modifier.width(40.dp).height(4.dp).clip(CircleShape).background(wc.dim.copy(alpha = 0.6f)))
        }
        // search · [emoji | GIF | sticker] · backspace
        Row(Modifier.fillMaxWidth().then(dragHandle).padding(horizontal = 8.dp, vertical = 2.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = { searching = !searching; if (!searching) query = "" }, enabled = tab != PanelTab.EMOJI) {
                Icon(Icons.Rounded.Search, "Search", tint = if (tab == PanelTab.EMOJI) wc.dim.copy(alpha = 0.3f) else wc.dim)
            }
            Row(Modifier.weight(1f).padding(horizontal = 8.dp).height(38.dp).clip(RoundedCornerShape(19.dp)).border(1.dp, wc.border, RoundedCornerShape(19.dp))) {
                PanelTab.values().forEachIndexed { i, t ->
                    val on = t == tab
                    Box(Modifier.weight(1f).fillMaxSize().background(if (on) wc.surface4 else Color.Transparent).clickable { tab = t; searching = false; query = "" }, Alignment.Center) {
                        when (t) {
                            PanelTab.EMOJI -> Icon(Icons.Outlined.EmojiEmotions, "Emoji", Modifier.size(22.dp), tint = if (on) MaterialTheme.colorScheme.onSurface else wc.dim)
                            PanelTab.GIF -> Text("GIF", fontWeight = FontWeight.Bold, fontSize = 13.sp, color = if (on) MaterialTheme.colorScheme.onSurface else wc.dim)
                            PanelTab.STICKER -> Icon(Icons.Outlined.StickyNote2, "Stickers", Modifier.size(21.dp), tint = if (on) MaterialTheme.colorScheme.onSurface else wc.dim)
                        }
                    }
                    if (i < 2) Box(Modifier.width(1.dp).fillMaxSize().background(wc.border))
                }
            }
            IconButton(onClick = onBackspace) { Icon(Icons.Rounded.Backspace, "Delete", tint = wc.dim) }
        }
        if (searching && tab != PanelTab.EMOJI) Row(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 4.dp).clip(RoundedCornerShape(20.dp)).background(wc.surface3).padding(horizontal = 14.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            BasicTextField(query, { query = it.take(60) }, Modifier.weight(1f), singleLine = true, textStyle = TextStyle(color = MaterialTheme.colorScheme.onSurface, fontSize = 15.sp),
                cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
                decorationBox = { inner -> Box { if (query.isEmpty()) Text(if (tab == PanelTab.GIF) "Search GIFs" else "Search stickers", color = wc.dim, fontSize = 15.sp); inner() } })
            if (query.isNotEmpty()) Icon(Icons.Rounded.Close, "Clear", Modifier.size(18.dp).clickable { query = "" }, tint = wc.dim)
        }
        Box(Modifier.weight(1f).fillMaxWidth()) {
            when (tab) {
                PanelTab.EMOJI -> EmojiGrid(onEmoji = { e -> repo.settings.useEmoji(e); onEmoji(e) })
                PanelTab.GIF -> GifGrid(stickers = false, query = query) { onGif(it, false) }
                PanelTab.STICKER -> GifGrid(stickers = true, query = query) { onGif(it, true) }
            }
        }
    }
}

@Composable
private fun EmojiGrid(onEmoji: (String) -> Unit) {
    val repo = LocalContext.current.repo
    val scope = rememberCoroutineScope()
    val recents by repo.settings.recentEmoji.collectAsState()
    val grid = rememberLazyGridState()
    // one long grid: Recents, then every category with its title (WhatsApp layout)
    val rows = remember(recents) {
        buildList<GridRow> {
            if (recents.isNotEmpty()) { add(Header("Recents")); recents.forEach { add(Cell(it, "r$it")) } }
            EmojiGroups.forEach { g -> add(Header(g.name)); g.list.filter { it.isNotBlank() }.forEach { add(Cell(it, g.name + it)) } }
        }
    }
    val starts = remember(rows) { rows.mapIndexedNotNull<GridRow, Pair<String, Int>> { i, r -> if (r is Header) r.title to i else null }.toMap() }
    val currentSection by remember(rows) { derivedStateOf { rows.take(grid.firstVisibleItemIndex + 1).lastOrNull { it is Header }?.let { (it as Header).title } } }

    Column(Modifier.fillMaxSize()) {
        LazyVerticalGrid(GridCells.Adaptive(46.dp), Modifier.weight(1f).fillMaxWidth(), grid, contentPadding = PaddingValues(horizontal = 6.dp, vertical = 2.dp)) {
            items(rows, key = { r -> when (r) { is Header -> "h" + r.title; is Cell -> r.key } }, span = { r -> if (r is Header) GridItemSpan(maxLineSpan) else GridItemSpan(1) }) { r ->
                when (r) {
                    is Header -> Text(r.title, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = wc.dim, modifier = Modifier.padding(start = 8.dp, top = 12.dp, bottom = 4.dp))
                    is Cell -> Box(Modifier.aspectRatio(1f).clip(CircleShape).clickable { onEmoji(r.e) }, Alignment.Center) { Text(r.e, fontSize = 28.sp) }
                }
            }
        }
        // category bar — jumps to a section
        Row(Modifier.fillMaxWidth().background(wc.surface2).padding(horizontal = 4.dp, vertical = 4.dp), horizontalArrangement = Arrangement.SpaceEvenly, verticalAlignment = Alignment.CenterVertically) {
            val entries = buildList { if (recents.isNotEmpty()) add("Recents" to ""); EmojiGroups.forEach { add(it.name to it.icon) } }
            entries.forEach { (name, icon) ->
                val on = currentSection == name
                Box(Modifier.size(38.dp).clip(CircleShape).background(if (on) wc.surface4 else Color.Transparent).clickable { starts[name]?.let { scope.launch { grid.scrollToItem(it) } } }, Alignment.Center) {
                    if (icon.isEmpty()) Icon(Icons.Rounded.History, name, Modifier.size(20.dp), tint = if (on) MaterialTheme.colorScheme.onSurface else wc.dim)
                    else Text(icon, fontSize = 18.sp, modifier = Modifier.graphicsLayer { alpha = if (on) 1f else 0.55f })
                }
            }
        }
    }
}

/** Trending / searched GIFs or stickers (GIPHY, through the WispChat server). Tap one to send it. */
@Composable
private fun GifGrid(stickers: Boolean, query: String, onPick: (String) -> Unit) {
    val repo = LocalContext.current.repo
    var items by remember(stickers) { mutableStateOf<List<Gif>>(emptyList()) }
    var loading by remember(stickers) { mutableStateOf(true) }
    var problem by remember(stickers) { mutableStateOf<String?>(null) }
    val grid = rememberLazyStaggeredGridState()
    LaunchedEffect(stickers, query) {
        loading = true; problem = null
        if (query.isNotBlank()) delay(350)
        try {
            val r = repo.api.get("/gifs?type=${if (stickers) "stickers" else "gifs"}&q=" + java.net.URLEncoder.encode(query.trim(), "UTF-8"))
            val arr = r.optJSONArray("items")
            items = (0 until (arr?.length() ?: 0)).mapNotNull { i -> arr!!.optJSONObject(i)?.let { o ->
                Gif(o.optString("id"), o.optString("preview"), o.optString("url"), o.optInt("width", 200), o.optInt("height", 200)).takeIf { it.url.isNotEmpty() }
            } }
            grid.scrollToItem(0)
        } catch (e: ApiException) {
            problem = if (e.status == 503) "GIFs and stickers need a free GIPHY key on the server: set GIPHY_API_KEY in server/.env and restart it."
            else if (e.status == 0) "You're offline — GIFs load when you're back online." else (e.message ?: "Couldn't load")
        } catch (e: kotlinx.coroutines.CancellationException) { throw e } catch (_: Exception) { problem = "Couldn't load" }
        loading = false
    }
    when {
        problem != null -> Box(Modifier.fillMaxSize().padding(28.dp), Alignment.Center) { Text(problem!!, color = wc.dim, fontSize = 14.sp, textAlign = androidx.compose.ui.text.style.TextAlign.Center) }
        loading && items.isEmpty() -> Box(Modifier.fillMaxSize(), Alignment.Center) { CircularProgressIndicator(Modifier.size(28.dp), strokeWidth = 2.dp) }
        items.isEmpty() -> Box(Modifier.fillMaxSize(), Alignment.Center) { Text("Nothing found", color = wc.dim) }
        else -> LazyVerticalStaggeredGrid(StaggeredGridCells.Fixed(if (stickers) 4 else 2), Modifier.fillMaxSize(), grid,
            contentPadding = PaddingValues(6.dp), verticalItemSpacing = 6.dp, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            items(items, key = { it.id }) { g ->
                AsyncImage(model = g.preview.ifEmpty { g.url }, contentDescription = null,
                    modifier = Modifier.fillMaxWidth().aspectRatio((g.w.toFloat() / g.h.coerceAtLeast(1)).coerceIn(0.5f, 2.2f)).clip(RoundedCornerShape(10.dp))
                        .then(if (stickers) Modifier else Modifier.background(wc.surface3)).clickable { onPick(g.url) },
                    contentScale = if (stickers) ContentScale.Fit else ContentScale.Crop)
            }
        }
    }
    if (!stickers || problem == null) Box(Modifier.fillMaxSize(), Alignment.BottomEnd) {
        if (items.isNotEmpty()) Text("Powered by GIPHY", fontSize = 10.sp, color = Color.White.copy(alpha = 0.7f),
            modifier = Modifier.padding(8.dp).clip(RoundedCornerShape(6.dp)).background(Color(0x99000000)).padding(horizontal = 6.dp, vertical = 2.dp))
    }
}
