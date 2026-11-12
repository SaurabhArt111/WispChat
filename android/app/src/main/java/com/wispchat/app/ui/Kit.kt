package com.wispchat.app.ui

import android.content.Context
import android.graphics.Bitmap
import android.widget.Toast
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import com.wispchat.app.data.User
import com.wispchat.app.util.ImageUtil
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.text.DateFormat
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

fun Context.toast(msg: String) = Toast.makeText(this, msg, Toast.LENGTH_SHORT).show()

// ------------------------------------------------------------------------------------------------ loading

/** Soft moving highlight used by every skeleton: the "loading" look of WhatsApp / Instagram. */
fun Modifier.shimmer(): Modifier = composed {
    val t = rememberInfiniteTransition(label = "shimmer")
    val x by t.animateFloat(-1f, 2f, infiniteRepeatable(tween(1300, easing = LinearEasing), RepeatMode.Restart), label = "x")
    val base = wc.surface3.copy(alpha = if (wc.dark) 0.55f else 0.9f)
    val hi = wc.surface4.copy(alpha = if (wc.dark) 0.75f else 0.9f)
    drawBehind {
        val w = size.width.coerceAtLeast(1f)
        drawRect(Brush.horizontalGradient(listOf(base, hi, base), startX = x * w, endX = x * w + w))
    }
}

@Composable
fun SkeletonBox(width: Dp? = null, height: Dp, radius: Dp = 8.dp, modifier: Modifier = Modifier) {
    Box((if (width != null) modifier.width(width) else modifier.fillMaxWidth()).height(height).clip(RoundedCornerShape(radius)).shimmer())
}

@Composable
fun SkeletonCircle(size: Dp) = Box(Modifier.size(size).clip(CircleShape).shimmer())

/** A fake chat / call / status row. */
@Composable
fun SkeletonRow(index: Int = 0, avatar: Dp = 52.dp) {
    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
        SkeletonCircle(avatar)
        Column(Modifier.weight(1f).padding(start = 14.dp), verticalArrangement = Arrangement.spacedBy(9.dp)) {
            SkeletonBox(width = (120 + (index * 37) % 90).dp, height = 13.dp)
            SkeletonBox(width = (170 + (index * 53) % 110).dp, height = 11.dp)
        }
    }
}

@Composable
fun SkeletonList(count: Int = 9, avatar: Dp = 52.dp) {
    Column(Modifier.fillMaxSize()) { repeat(count) { SkeletonRow(it, avatar) } }
}

// ------------------------------------------------------------------------------------------------ avatars

private val dataAvatarCache = object : android.util.LruCache<String, Bitmap>(8 * 1024 * 1024) {
    override fun sizeOf(key: String, value: Bitmap) = value.byteCount
}

fun parseColor(hex: String, fallback: Color = Mint): Color =
    try { Color(android.graphics.Color.parseColor(hex.ifEmpty { "#6EE7B7" })) } catch (_: Exception) { fallback }

/** Initial on a colour; the person's photo (a URL or a `data:` URL, like the web app stores) fades in over it. */
@Composable
fun Avatar(name: String, colorHex: String, size: Dp, modifier: Modifier = Modifier, url: String = "") {
    val c = parseColor(colorHex)
    Box(modifier.size(size).clip(CircleShape).background(c), Alignment.Center) {
        Text(name.trim().take(1).uppercase().ifEmpty { "?" }, color = Color(0xFF0A1020), fontWeight = FontWeight.Bold, fontSize = (size.value * 0.42f).sp)
        if (url.isNotEmpty()) AvatarPhoto(url, name)
    }
}

@Composable
private fun BoxScope.AvatarPhoto(url: String, name: String) {
    if (url.startsWith("data:")) {
        val bmp by produceState<Bitmap?>(dataAvatarCache.get(url), url) {
            if (value == null) value = withContext(Dispatchers.Default) { ImageUtil.decodeDataUrl(url)?.also { dataAvatarCache.put(url, it) } }
        }
        bmp?.let { Image(it.asImageBitmap(), name, Modifier.fillMaxSize(), contentScale = ContentScale.Crop) }
    } else {
        val base = com.wispchat.app.App.instance.repo.api.base
        AsyncImage(model = if (url.startsWith("http")) url else base + url, contentDescription = name, modifier = Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
    }
}

@Composable
fun UserAvatar(user: User?, size: Dp, modifier: Modifier = Modifier) =
    Avatar(user?.displayName.orEmpty(), user?.avatarColor.orEmpty(), size, modifier, user?.avatar.orEmpty())

/** Avatar with the WhatsApp-style status ring around it. [seen] greys it out. */
@Composable
fun StatusRing(size: Dp, seen: Boolean, active: Boolean = true, content: @Composable () -> Unit) {
    val brush = if (!active) Brush.linearGradient(listOf(wc.surface4, wc.surface4)) else if (seen) Brush.linearGradient(listOf(wc.surface4, wc.surface4)) else Brand
    Box(Modifier.size(size + 10.dp).border(BorderStroke(2.5.dp, brush), CircleShape).padding(4.dp), Alignment.Center) { content() }
}

@Composable
fun OnlineDot(modifier: Modifier = Modifier) =
    Box(modifier.size(13.dp).clip(CircleShape).background(MaterialTheme.colorScheme.background).padding(2.dp).clip(CircleShape).background(Online))

// ------------------------------------------------------------------------------------------------ chrome

@Composable
fun WispTopBar(title: String, onBack: (() -> Unit)? = null, subtitle: String? = null, actions: @Composable RowScope.() -> Unit = {}) {
    Row(Modifier.fillMaxWidth().statusBarsPadding().padding(horizontal = 4.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
        if (onBack != null) IconButton(onClick = onBack) { Icon(Icons.Filled.ArrowBack, "Back") } else Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.titleLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (subtitle != null) Text(subtitle, fontSize = 12.sp, color = wc.dim, maxLines = 1)
        }
        actions()
    }
}

@Composable
fun EmptyState(icon: ImageVector, title: String, body: String = "", action: (@Composable () -> Unit)? = null) {
    Column(Modifier.fillMaxSize().padding(32.dp), Arrangement.Center, Alignment.CenterHorizontally) {
        Box(Modifier.size(76.dp).clip(CircleShape).background(wc.wispDim), Alignment.Center) { Icon(icon, null, Modifier.size(34.dp), tint = wc.wisp) }
        Text(title, fontWeight = FontWeight.SemiBold, fontSize = 17.sp, modifier = Modifier.padding(top = 16.dp))
        if (body.isNotEmpty()) Text(body, color = wc.dim, fontSize = 14.sp, modifier = Modifier.padding(top = 6.dp), textAlign = androidx.compose.ui.text.style.TextAlign.Center)
        if (action != null) Box(Modifier.padding(top = 14.dp)) { action() }
    }
}

@Composable
fun SectionTitle(text: String) = Text(text, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = wc.dim, modifier = Modifier.padding(start = 20.dp, top = 16.dp, bottom = 6.dp))

@Composable
fun ConfirmDialog(title: String, text: String, confirm: String, danger: Boolean = false, onConfirm: () -> Unit, onDismiss: () -> Unit) {
    AlertDialog(onDismissRequest = onDismiss, containerColor = wc.surface2, title = { Text(title) }, text = { Text(text, color = wc.dim) },
        confirmButton = { TextButton(onClick = { onDismiss(); onConfirm() }) { Text(confirm, color = if (danger) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } })
}

/** Bottom sheet used for every menu / picker. Drag it down or tap outside to dismiss. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun Sheet(onDismiss: () -> Unit, content: @Composable ColumnScope.() -> Unit) {
    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = false), containerColor = wc.surface2) {
        Column(Modifier.navigationBarsPadding().padding(bottom = 12.dp)) { content() }
    }
}

@Composable
fun SheetItem(icon: ImageVector?, label: String, onClick: () -> Unit, tint: Color = Color.Unspecified, subtitle: String? = null) {
    Row(Modifier.fillMaxWidth().clickable(onClick = onClick).padding(horizontal = 22.dp, vertical = 14.dp), verticalAlignment = Alignment.CenterVertically) {
        if (icon != null) Icon(icon, null, Modifier.size(22.dp), tint = if (tint == Color.Unspecified) wc.dim else tint)
        Column(Modifier.padding(start = if (icon != null) 18.dp else 0.dp)) {
            Text(label, fontSize = 16.sp, color = if (tint == Color.Unspecified) MaterialTheme.colorScheme.onSurface else tint)
            if (subtitle != null) Text(subtitle, fontSize = 12.sp, color = wc.dim)
        }
    }
}

// ------------------------------------------------------------------------------------------------ time

fun formatClock(ms: Long): String = DateFormat.getTimeInstance(DateFormat.SHORT).format(Date(ms))

private fun sameDay(a: Calendar, b: Calendar) = a.get(Calendar.YEAR) == b.get(Calendar.YEAR) && a.get(Calendar.DAY_OF_YEAR) == b.get(Calendar.DAY_OF_YEAR)

/** Chat-list time: clock today, "Yesterday", weekday this week, otherwise a short date. */
fun formatListTime(ms: Long): String {
    if (ms <= 0) return ""
    val now = Calendar.getInstance(); val t = Calendar.getInstance().apply { timeInMillis = ms }
    if (sameDay(now, t)) return formatClock(ms)
    val y = Calendar.getInstance().apply { add(Calendar.DAY_OF_YEAR, -1) }
    if (sameDay(y, t)) return "Yesterday"
    if (now.timeInMillis - ms < 6 * 24 * 3600 * 1000L) return SimpleDateFormat("EEEE", Locale.getDefault()).format(Date(ms))
    return DateFormat.getDateInstance(DateFormat.SHORT).format(Date(ms))
}

/** Day separator inside a chat. */
fun formatDayLabel(ms: Long): String {
    val now = Calendar.getInstance(); val t = Calendar.getInstance().apply { timeInMillis = ms }
    if (sameDay(now, t)) return "Today"
    val y = Calendar.getInstance().apply { add(Calendar.DAY_OF_YEAR, -1) }
    if (sameDay(y, t)) return "Yesterday"
    return SimpleDateFormat("d MMMM yyyy", Locale.getDefault()).format(Date(ms))
}

fun dayKey(ms: Long): Int { val c = Calendar.getInstance().apply { timeInMillis = ms }; return c.get(Calendar.YEAR) * 1000 + c.get(Calendar.DAY_OF_YEAR) }

fun formatLastSeen(ms: Long): String {
    if (ms <= 0) return ""
    val now = Calendar.getInstance(); val t = Calendar.getInstance().apply { timeInMillis = ms }
    return when {
        sameDay(now, t) -> "last seen today at ${formatClock(ms)}"
        else -> {
            val y = Calendar.getInstance().apply { add(Calendar.DAY_OF_YEAR, -1) }
            if (sameDay(y, t)) "last seen yesterday at ${formatClock(ms)}" else "last seen ${DateFormat.getDateInstance(DateFormat.MEDIUM).format(Date(ms))}"
        }
    }
}

fun formatDuration(sec: Int): String {
    val m = sec / 60; val s = sec % 60
    return if (m > 0) "${m}m ${s}s" else "${s}s"
}

fun formatBytes(b: Long): String = when {
    b < 1024 -> "$b B"
    b < 1024 * 1024 -> "${b / 1024} KB"
    b < 1024L * 1024 * 1024 -> "%.1f MB".format(b / 1048576.0)
    else -> "%.2f GB".format(b / 1073741824.0)
}

// ------------------------------------------------------------------------------------------------ wallpapers (same presets as the web app)

data class Wallpaper(val id: String, val label: String, val brush: Brush?)

val Wallpapers: List<Wallpaper> = listOf(
    Wallpaper("none", "Default", null),
    Wallpaper("midnight", "Midnight", Brush.radialGradient(listOf(Color(0xFF163A33), Color(0xFF0B1614)), center = androidx.compose.ui.geometry.Offset(250f, 300f), radius = 1400f)),
    Wallpaper("emerald", "Emerald Haze", Brush.radialGradient(listOf(Color(0xFF114B3C), Color(0xFF071312)), center = androidx.compose.ui.geometry.Offset(900f, 0f), radius = 1500f)),
    Wallpaper("violet", "Violet Dusk", Brush.radialGradient(listOf(Color(0xFF2A1F4D), Color(0xFF100B22)), center = androidx.compose.ui.geometry.Offset(200f, 1800f), radius = 1600f)),
    Wallpaper("ember", "Ember", Brush.radialGradient(listOf(Color(0xFF4A2410), Color(0xFF170E08)), center = androidx.compose.ui.geometry.Offset(900f, 1800f), radius = 1600f)),
    Wallpaper("slate", "Slate", Brush.linearGradient(listOf(Color(0xFF1B2430), Color(0xFF0D1218)))),
)

fun wallpaperById(id: String): Wallpaper = Wallpapers.firstOrNull { it.id == id } ?: Wallpapers[0]
