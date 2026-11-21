package com.wispchat.app.ui

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Cake
import androidx.compose.material.icons.outlined.Call
import androidx.compose.material.icons.outlined.CameraAlt
import androidx.compose.material.icons.outlined.ChatBubbleOutline
import androidx.compose.material.icons.outlined.Cloud
import androidx.compose.material.icons.outlined.EmojiEmotions
import androidx.compose.material.icons.outlined.FavoriteBorder
import androidx.compose.material.icons.outlined.Headphones
import androidx.compose.material.icons.outlined.Image
import androidx.compose.material.icons.outlined.LocalCafe
import androidx.compose.material.icons.outlined.LocalFlorist
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.Mic
import androidx.compose.material.icons.outlined.MusicNote
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material.icons.outlined.Pets
import androidx.compose.material.icons.outlined.Send
import androidx.compose.material.icons.outlined.StarOutline
import androidx.compose.material.icons.outlined.Videocam
import androidx.compose.material.icons.outlined.WbSunny
import androidx.compose.material.icons.rounded.AddPhotoAlternate
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.Restore
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Slider
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.ImageShader
import androidx.compose.ui.graphics.ShaderBrush
import androidx.compose.ui.graphics.TileMode
import androidx.compose.ui.graphics.drawscope.CanvasDrawScope
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.VectorPainter
import androidx.compose.ui.graphics.vector.rememberVectorPainter
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import com.wispchat.app.repo
import com.wispchat.app.util.ImageUtil
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import kotlin.random.Random

// ================================================================================================ presets (same as the web app + more)

enum class WpKind { PATTERN, PLAIN, DOTS, GRADIENT, SOLID }

/** One built-in wallpaper. [dark] / [light] are the brushes for each theme (most are the same). */
data class Wallpaper(val id: String, val label: String, val kind: WpKind, val dark: Brush? = null, val light: Brush? = null) {
    fun brush(isDark: Boolean): Brush? = if (isDark) dark else (light ?: dark)
}

private fun solid(c: Long) = Brush.linearGradient(listOf(Color(c), Color(c)))

val Wallpapers: List<Wallpaper> = listOf(
    Wallpaper("doodle", "WispChat", WpKind.PATTERN, solid(0xFF0B1217), solid(0xFFECE7DF)),
    Wallpaper("none", "Plain", WpKind.PLAIN),
    Wallpaper("dots", "Doodle grid", WpKind.DOTS, solid(0xFF0D1512), solid(0xFFE9EFEC)),
    // web gradients, 1:1
    Wallpaper("midnight", "Midnight", WpKind.GRADIENT, Brush.radialGradient(listOf(Color(0xFF163A33), Color(0xFF0B1614)), center = Offset(250f, 300f), radius = 1400f)),
    Wallpaper("emerald", "Emerald Haze", WpKind.GRADIENT, Brush.radialGradient(listOf(Color(0xFF114B3C), Color(0xFF071312)), center = Offset(900f, 0f), radius = 1500f)),
    Wallpaper("violet", "Violet Dusk", WpKind.GRADIENT, Brush.radialGradient(listOf(Color(0xFF2A1F4D), Color(0xFF100B22)), center = Offset(200f, 1800f), radius = 1600f)),
    Wallpaper("ember", "Ember", WpKind.GRADIENT, Brush.radialGradient(listOf(Color(0xFF4A2410), Color(0xFF170E08)), center = Offset(900f, 1800f), radius = 1600f)),
    Wallpaper("slate", "Slate", WpKind.GRADIENT, Brush.linearGradient(listOf(Color(0xFF1B2430), Color(0xFF0D1218)))),
    // solids
    Wallpaper("ocean", "Ocean", WpKind.SOLID, solid(0xFF0F2A3A), solid(0xFFCFE6F2)),
    Wallpaper("forest", "Forest", WpKind.SOLID, solid(0xFF13261D), solid(0xFFD5EBDD)),
    Wallpaper("plum", "Plum", WpKind.SOLID, solid(0xFF2A1830), solid(0xFFEADAF0)),
    Wallpaper("rose", "Rose", WpKind.SOLID, solid(0xFF3A1F27), solid(0xFFF5DCE2)),
    Wallpaper("sand", "Sand", WpKind.SOLID, solid(0xFF2B2418), solid(0xFFEFE4CF)),
    Wallpaper("graphite", "Graphite", WpKind.SOLID, solid(0xFF1A1D22), solid(0xFFE3E5E8)),
)

fun wallpaperById(id: String): Wallpaper = Wallpapers.firstOrNull { it.id == id } ?: Wallpapers[0]
fun isPhotoWallpaper(id: String) = id.startsWith("file:")

// ================================================================================================ the doodle pattern

private val DoodleIcons: List<ImageVector> = listOf(
    Icons.Outlined.ChatBubbleOutline, Icons.Outlined.FavoriteBorder, Icons.Outlined.StarOutline, Icons.Outlined.CameraAlt,
    Icons.Outlined.MusicNote, Icons.Outlined.Call, Icons.Outlined.EmojiEmotions, Icons.Outlined.Mic, Icons.Outlined.Cloud,
    Icons.Outlined.Image, Icons.Outlined.LocalCafe, Icons.Outlined.Pets, Icons.Outlined.Videocam, Icons.Outlined.Notifications,
    Icons.Outlined.Lock, Icons.Outlined.Send, Icons.Outlined.Headphones, Icons.Outlined.Cake, Icons.Outlined.LocalFlorist, Icons.Outlined.WbSunny,
)

private class Spot(val icon: Int, val x: Float, val y: Float, val sizeDp: Float, val rot: Float)

/** A jittered 5×5 grid: looks hand-scattered but never overlaps, and tiles seamlessly. */
private val DoodleSpots: List<Spot> = run {
    val r = Random(20240611)
    val n = 5
    buildList {
        for (row in 0 until n) for (col in 0 until n) {
            val shift = if (row % 2 == 1) 0.5f else 0f
            val x = ((col + shift + 0.5f) / n + (r.nextFloat() - 0.5f) * 0.06f).mod(1f)
            val y = (row + 0.5f) / n + (r.nextFloat() - 0.5f) * 0.05f
            add(Spot((row * n + col * 3 + r.nextInt(4)) % DoodleIcons.size, x, y, 20f + r.nextFloat() * 9f, (r.nextFloat() - 0.5f) * 56f))
        }
    }
}

/** Renders one 230dp tile of the doodle pattern into a bitmap once, then repeats it as a shader (cheap to draw). */
@Composable
fun rememberDoodleBrush(tint: Color): Brush {
    val density = LocalDensity.current
    val painters: List<VectorPainter> = DoodleIcons.map { rememberVectorPainter(it) }
    return remember(tint, density.density) { doodleCache.getOrPut(tint.value to density.density) {
        val tile = (230 * density.density).toInt().coerceAtLeast(64)
        val bmp = ImageBitmap(tile, tile)
        val canvas = androidx.compose.ui.graphics.Canvas(bmp)
        val filter = ColorFilter.tint(tint)
        CanvasDrawScope().draw(Density(density.density), LayoutDirection.Ltr, canvas, Size(tile.toFloat(), tile.toFloat())) {
            for (s in DoodleSpots) {
                val px = s.sizeDp * density.density
                // draw each icon (and its wrap-around copies at the edges) so the tile repeats without seams
                for (dx in listOf(-tile.toFloat(), 0f, tile.toFloat())) for (dy in listOf(-tile.toFloat(), 0f, tile.toFloat())) {
                    val cx = s.x * tile + dx; val cy = s.y * tile + dy
                    if (cx < -px || cx > tile + px || cy < -px || cy > tile + px) continue
                    withTransform({ translate(cx - px / 2, cy - px / 2); rotate(s.rot, Offset(px / 2, px / 2)) }) {
                        with(painters[s.icon]) { draw(Size(px, px), 1f, filter) }
                    }
                }
            }
            // a few tiny dots between the drawings
            val dotR = 1.6f * density.density
            for (i in 0 until 14) {
                val x = ((i * 0.37f + 0.11f) % 1f) * tile; val y = ((i * 0.61f + 0.29f) % 1f) * tile
                drawCircle(tint, dotR, Offset(x, y))
            }
        }
        ShaderBrush(ImageShader(bmp, TileMode.Repeated, TileMode.Repeated))
    } }
}

/** One tile bitmap per colour + screen density for the whole app (the picker shows many thumbnails at once). */
private val doodleCache = HashMap<Pair<ULong, Float>, Brush>()

// ================================================================================================ drawing a wallpaper

/** The chat background for [id] (preset id or "file:" photo), honouring the theme, dim level and the doodles switch. */
@Composable
fun ChatWallpaper(id: String, modifier: Modifier = Modifier, preview: Boolean = false, content: @Composable BoxScope.() -> Unit = {}) {
    val settings = LocalContext.current.repo.settings
    val dim by settings.wallpaperDim.collectAsState()
    val doodlesOn by settings.wallpaperDoodles.collectAsState()
    val dark = wc.dark
    val doodleTint = if (dark) Color(0xFF6FF7CF).copy(alpha = 0.075f) else Color(0xFF0B3A33).copy(alpha = 0.085f)
    val lightDoodle = Color.White.copy(alpha = 0.06f)
    Box(modifier) {
        if (isPhotoWallpaper(id)) {
            AsyncImage(model = File(id.removePrefix("file:")), contentDescription = null, modifier = Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
            Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = if (dark) dim else dim * 0.5f)))
        } else {
            val w = wallpaperById(id)
            when (w.kind) {
                WpKind.PLAIN -> Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background))
                WpKind.PATTERN -> {
                    val doodle = rememberDoodleBrush(doodleTint)
                    Box(Modifier.fillMaxSize().background(w.brush(dark)!!).background(doodle))
                }
                WpKind.DOTS -> {
                    val dot = if (dark) Color(0xFF5EF2C0).copy(alpha = 0.09f) else Color(0xFF0B8F72).copy(alpha = 0.12f)
                    Box(Modifier.fillMaxSize().background(w.brush(dark)!!).drawBehind {
                        val step = 22.dp.toPx(); val r = 1.5.dp.toPx()
                        var y = step / 2
                        while (y < size.height) { var x = step / 2; while (x < size.width) { drawCircle(dot, r, Offset(x, y)); x += step }; y += step }
                    })
                }
                WpKind.GRADIENT, WpKind.SOLID -> {
                    Box(Modifier.fillMaxSize().background(w.brush(dark)!!))
                    if (doodlesOn) {
                        val tint = if (w.kind == WpKind.GRADIENT || dark) lightDoodle else doodleTint
                        val doodle = rememberDoodleBrush(tint)
                        Box(Modifier.fillMaxSize().background(doodle))
                    }
                }
            }
        }
        content()
    }
}

// ================================================================================================ picker

/**
 * Wallpaper picker, used for one chat ([convId]) or for the default of every chat ([convId] = null, from Settings → Chats).
 * Same choices as the web app — presets, the doodle grid and your own photo — plus "Use default" for a single chat.
 */
@Composable
fun WallpaperPickerSheet(convId: String?, onDismiss: () -> Unit) {
    val ctx = LocalContext.current
    val settings = ctx.repo.settings
    val scope = rememberCoroutineScope()
    val tick by settings.wallpaperTick.collectAsState()
    val dim by settings.wallpaperDim.collectAsState()
    val doodles by settings.wallpaperDoodles.collectAsState()
    val own = remember(tick, convId) { convId?.let { settings.chatWallpaper(it) } }
    val effective = remember(tick, convId) { settings.wallpaper(convId) }
    val followsDefault = convId != null && own == null
    var busy by remember { mutableStateOf(false) }

    val pickPhoto = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri: Uri? ->
        if (uri != null) {
            busy = true
            scope.launch {
                val path = withContext(Dispatchers.IO) {
                    runCatching {
                        val bmp = ImageUtil.decodeScaled(ctx, uri, 2200) ?: return@runCatching null
                        val dir = File(ctx.filesDir, "wallpapers").apply { mkdirs() }
                        File(dir, "wp_${System.currentTimeMillis()}.jpg").also { it.writeBytes(ImageUtil.toJpeg(bmp, 88)) }.absolutePath
                    }.getOrNull()
                }
                busy = false
                if (path != null) settings.setWallpaper(convId, "file:$path") else ctx.toast("Couldn't use that photo")
            }
        }
    }

    Sheet(onDismiss) {
        Column(Modifier.heightIn(max = 640.dp).verticalScroll(rememberScrollState())) {
            Text(if (convId == null) "Default chat wallpaper" else "Chat wallpaper", fontWeight = FontWeight.Bold, fontSize = 18.sp,
                modifier = Modifier.padding(horizontal = 22.dp, vertical = 6.dp))
            Text(if (convId == null) "Used by every chat that doesn't have its own wallpaper." else "Only for this chat. Your default is set in Settings → Chats.",
                color = wc.dim, fontSize = 13.sp, modifier = Modifier.padding(horizontal = 22.dp))

            // live preview with sample bubbles
            ChatWallpaper(effective, Modifier.padding(16.dp).fillMaxWidth().height(170.dp).clip(RoundedCornerShape(18.dp)).border(1.dp, wc.border, RoundedCornerShape(18.dp)), preview = true) {
                Column(Modifier.fillMaxSize().padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Hey! How's it going? 👋", fontSize = 13.sp, color = wc.onBubbleTheirs,
                        modifier = Modifier.clip(RoundedCornerShape(14.dp)).background(wc.bubbleTheirs).padding(horizontal = 12.dp, vertical = 7.dp))
                    Box(Modifier.fillMaxWidth(), Alignment.CenterEnd) {
                        Text("All good — loving the new wallpaper", fontSize = 13.sp, color = wc.onBubbleMine,
                            modifier = Modifier.clip(RoundedCornerShape(14.dp)).background(wc.bubbleMine).padding(horizontal = 12.dp, vertical = 7.dp))
                    }
                }
            }

            val tiles = buildList<String?> {
                if (convId != null) add(null) // "Use default"
                Wallpapers.forEach { add(it.id) }
                add("photo")
            }
            tiles.chunked(4).forEach { row ->
                Row(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 5.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    row.forEach { t ->
                        Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally) {
                            val selected = when (t) { null -> followsDefault; "photo" -> !followsDefault && isPhotoWallpaper(effective); else -> !followsDefault && effective == t }
                            val shape = RoundedCornerShape(14.dp)
                            Box(Modifier.fillMaxWidth().aspectRatio(0.72f).clip(shape)
                                .border(if (selected) 3.dp else 1.dp, if (selected) MaterialTheme.colorScheme.primary else wc.border, shape)
                                .clickable(enabled = !busy) {
                                    when (t) {
                                        null -> settings.setWallpaper(convId, null)
                                        "photo" -> pickPhoto.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
                                        else -> settings.setWallpaper(convId, t)
                                    }
                                }, Alignment.Center) {
                                when (t) {
                                    null -> { ChatWallpaper(settings.globalWallpaper(), Modifier.fillMaxSize()); Icon(Icons.Rounded.Restore, null, Modifier.size(26.dp).clip(CircleShape).background(Color(0x99000000)).padding(4.dp), tint = Color.White) }
                                    "photo" -> if (isPhotoWallpaper(effective) && !followsDefault) ChatWallpaper(effective, Modifier.fillMaxSize())
                                        else Box(Modifier.fillMaxSize().background(wc.surface3), Alignment.Center) { Icon(Icons.Rounded.AddPhotoAlternate, null, Modifier.size(28.dp), tint = wc.wisp) }
                                    else -> ChatWallpaper(t, Modifier.fillMaxSize())
                                }
                                if (selected) Icon(Icons.Rounded.Check, null, Modifier.align(Alignment.TopEnd).padding(5.dp).size(20.dp).clip(CircleShape).background(MaterialTheme.colorScheme.primary).padding(2.dp), tint = WispInk)
                            }
                            Text(when (t) { null -> "Use default"; "photo" -> if (busy) "Loading…" else "My photo"; else -> wallpaperById(t).label },
                                fontSize = 11.sp, maxLines = 1, modifier = Modifier.padding(top = 4.dp))
                        }
                    }
                    repeat(4 - row.size) { Spacer(Modifier.weight(1f)) }
                }
            }

            if (isPhotoWallpaper(effective)) {
                Text("Dim photo", fontSize = 14.sp, modifier = Modifier.padding(start = 22.dp, top = 10.dp))
                Slider(dim, { settings.setWallpaperDim(it) }, Modifier.padding(horizontal = 18.dp), valueRange = 0f..0.8f)
            }
            Row(Modifier.fillMaxWidth().clickable { settings.setWallpaperDoodles(!doodles) }.padding(horizontal = 22.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("Doodles", fontSize = 15.sp)
                    Text("Add the WispChat doodle pattern on top of colour wallpapers", fontSize = 12.sp, color = wc.dim)
                }
                Switch(doodles, { settings.setWallpaperDoodles(it) })
            }
            Spacer(Modifier.height(8.dp).width(1.dp))
        }
    }
}
