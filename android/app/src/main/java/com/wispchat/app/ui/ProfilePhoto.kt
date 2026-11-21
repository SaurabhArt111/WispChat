package com.wispchat.app.ui

import android.graphics.Bitmap
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Call
import androidx.compose.material.icons.outlined.Chat
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.Videocam
import androidx.compose.material.icons.rounded.ArrowBack
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import coil.compose.AsyncImage
import com.wispchat.app.data.Conversation
import com.wispchat.app.util.ImageUtil
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** The profile photo as a square picture (URL or the web app's `data:` URLs); the initial on its colour if there is none. */
@Composable
fun SquarePhoto(name: String, url: String, colorHex: String, modifier: Modifier = Modifier, contentScale: ContentScale = ContentScale.Crop) {
    Box(modifier.background(parseColor(colorHex)), Alignment.Center) {
        if (url.isEmpty()) Text(name.trim().take(1).uppercase().ifEmpty { "?" }, color = Color(0xFF0A1020), fontWeight = FontWeight.Bold, fontSize = 96.sp)
        else if (url.startsWith("data:")) {
            val bmp by produceState<Bitmap?>(null, url) { value = withContext(Dispatchers.Default) { ImageUtil.decodeDataUrl(url) } }
            bmp?.let { Image(it.asImageBitmap(), name, Modifier.fillMaxSize(), contentScale = contentScale) }
        } else AsyncImage(model = absoluteUrl(url), contentDescription = name, modifier = Modifier.fillMaxSize(), contentScale = contentScale)
    }
}

/** Full-screen profile photo (tap someone's picture). Pinch to zoom, double-tap to zoom in / out. */
@Composable
fun ProfilePhotoViewer(name: String, url: String, colorHex: String, onDismiss: () -> Unit) {
    var scale by remember { mutableFloatStateOf(1f) }
    var offset by remember { mutableStateOf(Offset.Zero) }
    Dialog(onDismiss, DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        Box(Modifier.fillMaxSize().background(Color.Black)) {
            SquarePhoto(name, url, colorHex,
                Modifier.align(Alignment.Center).fillMaxWidth().aspectRatio(1f)
                    .pointerInput(Unit) {
                        detectTransformGestures { _, pan, zoom, _ ->
                            scale = (scale * zoom).coerceIn(1f, 5f)
                            offset = if (scale == 1f) Offset.Zero else offset + pan
                        }
                    }
                    .pointerInput(Unit) { detectTapGestures(onDoubleTap = { if (scale > 1f) { scale = 1f; offset = Offset.Zero } else scale = 2.5f }) }
                    .graphicsLayer { scaleX = scale; scaleY = scale; translationX = offset.x; translationY = offset.y },
                contentScale = ContentScale.Fit)
            Row(Modifier.fillMaxWidth().background(Color(0x99000000)).statusBarsPadding().padding(4.dp), verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = onDismiss) { Icon(Icons.Rounded.ArrowBack, "Back", tint = Color.White) }
                Text(name, color = Color.White, fontSize = 19.sp, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
    }
}

/** WhatsApp chat-list popup: tap a picture → photo with the name, and Message · Call · Video · Info underneath. */
@Composable
fun ProfilePopup(c: Conversation, myId: String, nav: Nav, onDismiss: () -> Unit) {
    val startCall = rememberCallStarter()
    val other = c.other(myId)
    val name = c.title(myId)
    val url = if (c.isGroup) c.avatar else other?.avatar.orEmpty()
    val color = if (c.isGroup) "#64748b" else other?.avatarColor.orEmpty()
    var full by remember { mutableStateOf(false) }
    Dialog(onDismiss) {
        Column(Modifier.width(280.dp).clip(RoundedCornerShape(6.dp)).background(MaterialTheme.colorScheme.surface)) {
            Box(Modifier.fillMaxWidth().aspectRatio(1f).clickable { full = true }) {
                SquarePhoto(name, url, color, Modifier.fillMaxSize())
                Text(name, color = Color.White, fontSize = 17.sp, maxLines = 1, overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.fillMaxWidth().background(Color(0x66000000)).padding(horizontal = 14.dp, vertical = 8.dp))
            }
            Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), horizontalArrangement = Arrangement.SpaceEvenly) {
                IconButton(onClick = { onDismiss(); nav.openChat(c.id) }) { Icon(Icons.Outlined.Chat, "Message", tint = MaterialTheme.colorScheme.primary) }
                IconButton(onClick = { onDismiss(); startCall({ c }, "audio") }) { Icon(Icons.Outlined.Call, "Voice call", tint = MaterialTheme.colorScheme.primary) }
                IconButton(onClick = { onDismiss(); startCall({ c }, "video") }) { Icon(Icons.Outlined.Videocam, "Video call", tint = MaterialTheme.colorScheme.primary) }
                IconButton(onClick = { onDismiss(); nav.push(if (c.isGroup) Route.GroupInfo(c.id) else Route.ContactInfo(c.id)) }) { Icon(Icons.Outlined.Info, "Info", tint = MaterialTheme.colorScheme.primary) }
            }
        }
    }
    if (full) ProfilePhotoViewer(name, url, color) { full = false }
}
