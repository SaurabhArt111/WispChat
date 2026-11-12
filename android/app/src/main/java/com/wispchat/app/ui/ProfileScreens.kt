@file:OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class, androidx.compose.material3.ExperimentalMaterial3Api::class)

package com.wispchat.app.ui

import android.graphics.Bitmap
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.*
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.*
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.wispchat.app.data.Post
import com.wispchat.app.repo
import com.wispchat.app.util.ImageUtil
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

// ================================================================================================ Profile tab

@Composable
fun ProfileTab(nav: Nav) {
    val ctx = LocalContext.current
    val repo = ctx.repo
    val social = repo.social
    val me by repo.me.collectAsState()
    val requests by social.requests.collectAsState()
    val clipboard = LocalClipboardManager.current
    var posts by remember { mutableStateOf<List<Post>?>(null) }
    val pick = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { u: Uri? -> if (u != null) nav.push(Route.NewPost(u)) }
    val user = me

    // reload on first show, and again whenever we come back from a page that may have changed posts
    LaunchedEffect(user?.id, nav.stack.size) {
        val id = user?.id ?: return@LaunchedEffect
        if (nav.stack.isEmpty() || posts == null) posts = try { social.userPosts(id) } catch (_: Exception) { posts ?: emptyList() }
    }
    LaunchedEffect(Unit) {
        social.events.collect { e ->
            if (e.name == "post:deleted") { val id = e.data.optString("postId"); posts = posts?.filterNot { it.id == id } }
        }
    }

    if (user == null) { SkeletonList(3, 60.dp); return }
    val incoming = requests.count { !it.outgoing }

    Column(Modifier.fillMaxSize()) {
        WispTopBar("Profile") { IconButton(onClick = { nav.push(Route.Settings) }) { Icon(Icons.Filled.Settings, "Settings") } }
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
            Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 12.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Box(Modifier.clickable { nav.push(Route.EditProfile) }) {
                    UserAvatar(user, 120.dp)
                    Box(Modifier.align(Alignment.BottomEnd).size(34.dp).clip(CircleShape).background(MaterialTheme.colorScheme.primary), Alignment.Center) { Icon(Icons.Filled.Edit, "Edit", Modifier.size(18.dp), tint = WispInk) }
                }
                Text(user.displayName, fontSize = 24.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 12.dp))
                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.clip(RoundedCornerShape(10.dp)).clickable {
                    clipboard.setText(AnnotatedString("@${user.username}")); ctx.toast("Username copied to clipboard")
                }.padding(horizontal = 8.dp, vertical = 2.dp)) {
                    Text("@${user.username}", color = wc.dim)
                    Icon(Icons.Filled.ContentCopy, "Copy", Modifier.padding(start = 6.dp).size(14.dp), tint = wc.dim)
                }
                if (user.about.isNotBlank()) Text(user.about, Modifier.padding(top = 10.dp), textAlign = TextAlign.Center)
                Row(Modifier.padding(top = 14.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Button(onClick = { nav.push(Route.EditProfile) }) { Text("Edit profile") }
                    OutlinedButton(onClick = { pick.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageAndVideo)) }) { Icon(Icons.Filled.AddPhotoAlternate, null); Text("  New post") }
                }
            }
            HorizontalDivider(color = wc.border)
            SheetItem(Icons.Filled.PersonAdd, if (incoming > 0) "Friend requests ($incoming)" else "Friend requests", { nav.push(Route.FriendRequests) })
            SheetItem(Icons.Filled.Visibility, "Status privacy", { nav.push(Route.StatusPrivacy) })
            HorizontalDivider(color = wc.border)
            Row(Modifier.padding(horizontal = 18.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Filled.GridOn, null, Modifier.size(18.dp), tint = wc.wisp)
                Text("  Posts${posts?.let { " · ${it.size}" } ?: ""}", fontWeight = FontWeight.SemiBold)
            }
            val p = posts
            when {
                p == null -> Column { repeat(2) { Row(Modifier.fillMaxWidth()) { repeat(3) { Box(Modifier.weight(1f).aspectRatio(1f).padding(1.dp).shimmer()) } } } }
                p.isEmpty() -> Column(Modifier.fillMaxWidth().padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    Box(Modifier.size(64.dp).clip(CircleShape).background(wc.wispDim), Alignment.Center) { Icon(Icons.Filled.GridOn, null, tint = wc.wisp) }
                    Text("Share your first post", fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = 12.dp))
                    Text("Your posts will appear here.", color = wc.dim, fontSize = 14.sp)
                }
                else -> PostsGrid(p) { i -> nav.push(Route.PostView(p, i)) }
            }
            Spacer(Modifier.height(100.dp))
        }
    }
}

// ================================================================================================ Edit profile

private val AvatarColors = listOf("#3ddba7", "#5cc8ff", "#7c5cff", "#ff8a5c", "#ff5a6e", "#ffc857", "#a3e635", "#f472b6")

@Composable
fun EditProfileScreen(nav: Nav) {
    val ctx = LocalContext.current
    val repo = ctx.repo
    val scope = rememberCoroutineScope()
    val me by repo.me.collectAsState()
    val user = me ?: run { LaunchedEffect(Unit) { nav.pop() }; return }
    var name by remember { mutableStateOf(user.displayName) }
    var about by remember { mutableStateOf(user.about) }
    var color by remember { mutableStateOf(user.avatarColor.ifEmpty { AvatarColors[0] }) }
    var newAvatar by remember { mutableStateOf<String?>(null) }   // data URL; "" = remove
    var cropping by remember { mutableStateOf<Bitmap?>(null) }
    var busy by remember { mutableStateOf(false) }
    var photoMenu by remember { mutableStateOf(false) }
    val pick = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { u: Uri? ->
        if (u != null) scope.launch { cropping = withContext(Dispatchers.IO) { ImageUtil.decodeScaled(ctx, u, 1600) } ?: run { ctx.toast("Couldn't read that image"); null } }
    }
    val previewUrl = newAvatar ?: user.avatar
    val dirty = name.trim() != user.displayName || about.trim() != user.about || newAvatar != null || color != user.avatarColor

    Column(Modifier.fillMaxSize().imePadding()) {
        WispTopBar("Edit profile", onBack = { nav.pop() }) {
            TextButton(enabled = dirty && name.isNotBlank() && !busy, onClick = {
                busy = true
                scope.launch {
                    try { repo.updateProfile(name, about, newAvatar, if (color != user.avatarColor) color else null); ctx.toast("Profile updated"); nav.pop() }
                    catch (e: Exception) { ctx.toast(e.message ?: "Couldn't save"); busy = false }
                }
            }) { if (busy) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp) else Text("Save", fontWeight = FontWeight.Bold) }
        }
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Box(Modifier.clickable { photoMenu = true }) {
                Avatar(name.ifBlank { user.displayName }, color, 130.dp, url = previewUrl)
                Box(Modifier.align(Alignment.BottomEnd).size(38.dp).clip(CircleShape).background(MaterialTheme.colorScheme.primary), Alignment.Center) { Icon(Icons.Filled.CameraAlt, "Change photo", Modifier.size(20.dp), tint = WispInk) }
            }
            Text("Accent colour", color = wc.dim, fontSize = 13.sp, modifier = Modifier.padding(top = 18.dp, bottom = 8.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                AvatarColors.forEach { c ->
                    Box(Modifier.size(30.dp).clip(CircleShape).background(parseColor(c)).border(if (c.equals(color, true)) 3.dp else 0.dp, MaterialTheme.colorScheme.onSurface, CircleShape).clickable { color = c })
                }
            }
            OutlinedTextField(name, { name = it.take(40) }, Modifier.fillMaxWidth().padding(top = 22.dp), label = { Text("Name") }, singleLine = true, shape = RoundedCornerShape(14.dp))
            OutlinedTextField(about, { about = it.take(140) }, Modifier.fillMaxWidth().padding(top = 12.dp), label = { Text("About") }, supportingText = { Text("${about.length}/140") }, maxLines = 4, shape = RoundedCornerShape(14.dp))
            OutlinedTextField("@${user.username}", {}, Modifier.fillMaxWidth().padding(top = 4.dp), label = { Text("Username") }, enabled = false, singleLine = true, shape = RoundedCornerShape(14.dp))
        }
    }
    if (photoMenu) Sheet({ photoMenu = false }) {
        SheetItem(Icons.Filled.PhotoLibrary, "Choose from gallery", { photoMenu = false; pick.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) })
        if (previewUrl.isNotEmpty()) SheetItem(Icons.Filled.Delete, "Remove photo", { photoMenu = false; newAvatar = "" }, tint = MaterialTheme.colorScheme.error)
    }
    cropping?.let { bmp ->
        AvatarCropper(bmp, onCancel = { cropping = null }, onDone = { out ->
            cropping = null
            scope.launch { newAvatar = withContext(Dispatchers.Default) { ImageUtil.avatarDataUrl(out, 512) } }
        })
    }
}

/** Full-screen pinch / drag square cropper. The visible square is what gets saved. */
@Composable
private fun AvatarCropper(src: Bitmap, onCancel: () -> Unit, onDone: (Bitmap) -> Unit) {
    var box by remember { mutableStateOf(0) }           // side of the crop square in px
    var zoom by remember { mutableStateOf(1f) }
    var off by remember { mutableStateOf(androidx.compose.ui.geometry.Offset.Zero) }
    val w = src.width.toFloat(); val h = src.height.toFloat()
    fun base() = if (box == 0) 1f else box / minOf(w, h)                      // scale that makes the short side fill the square
    fun clamp(o: androidx.compose.ui.geometry.Offset, z: Float): androidx.compose.ui.geometry.Offset {
        val k = base() * z
        val mx = ((w * k - box) / 2f).coerceAtLeast(0f); val my = ((h * k - box) / 2f).coerceAtLeast(0f)
        return androidx.compose.ui.geometry.Offset(o.x.coerceIn(-mx, mx), o.y.coerceIn(-my, my))
    }

    androidx.compose.ui.window.Dialog(onDismissRequest = onCancel, properties = androidx.compose.ui.window.DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        Column(Modifier.fillMaxSize().background(Color.Black).systemBarsPadding(), horizontalAlignment = Alignment.CenterHorizontally) {
            Row(Modifier.fillMaxWidth().padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = onCancel) { Icon(Icons.Filled.Close, "Cancel", tint = Color.White) }
                Text("Move and scale", color = Color.White, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                TextButton(onClick = {
                    val k = base() * zoom
                    val side = (box / k).coerceAtMost(minOf(w, h))
                    val cx = w / 2f - off.x / k; val cy = h / 2f - off.y / k
                    val x = (cx - side / 2f).coerceIn(0f, w - side); val y = (cy - side / 2f).coerceIn(0f, h - side)
                    onDone(Bitmap.createBitmap(src, x.toInt(), y.toInt(), side.toInt().coerceAtLeast(1), side.toInt().coerceAtLeast(1)))
                }) { Text("Done", fontWeight = FontWeight.Bold) }
            }
            Spacer(Modifier.weight(1f))
            Box(Modifier.fillMaxWidth().aspectRatio(1f).onSizeChanged { box = it.width }.clipToBounds().pointerInput(box) {
                detectTransformGestures { _, pan, gz, _ ->
                    val nz = (zoom * gz).coerceIn(1f, 6f)
                    zoom = nz; off = clamp(off + pan, nz)
                }
            }) {
                androidx.compose.foundation.Image(src.asImageBitmap(), null, Modifier.fillMaxSize().graphicsLayer { scaleX = zoom; scaleY = zoom; translationX = off.x; translationY = off.y }, contentScale = ContentScale.Crop)
                // circular guide
                Box(Modifier.fillMaxSize().border(2.dp, Color.White.copy(alpha = 0.8f), CircleShape))
            }
            Spacer(Modifier.weight(1f))
            Text("Pinch to zoom, drag to reposition", color = Color(0xB3FFFFFF), fontSize = 13.sp, modifier = Modifier.padding(bottom = 24.dp))
        }
    }
}
