@file:OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class, androidx.compose.material3.ExperimentalMaterial3Api::class)

package com.wispchat.app.ui

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.foundation.*
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.*
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.foundation.pager.VerticalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.*
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.*
import androidx.compose.ui.draw.*
import androidx.compose.ui.graphics.*
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.*
import androidx.compose.ui.text.font.*
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.*
import androidx.compose.ui.unit.*
import coil.compose.AsyncImage
import com.wispchat.app.data.Comment
import com.wispchat.app.data.Post
import com.wispchat.app.data.User
import com.wispchat.app.repo
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

// ================================================================================================ Explore tab

/** Tab 3 — endless grid of posts (For you / Friends / Discover) plus people search. */
@Composable
fun ExploreTab(nav: Nav) {
    val ctx = LocalContext.current
    val repo = ctx.repo
    val social = repo.social
    val scope = rememberCoroutineScope()
    val newPosts by social.newPosts.collectAsState()
    var scopeName by remember { mutableStateOf("all") }
    var posts by remember { mutableStateOf<List<Post>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var loadingMore by remember { mutableStateOf(false) }
    var hasMore by remember { mutableStateOf(true) }
    var failed by remember { mutableStateOf(false) }
    var query by remember { mutableStateOf("") }
    var people by remember { mutableStateOf<List<User>>(emptyList()) }
    var searching by remember { mutableStateOf(false) }
    val grid = rememberLazyGridState()

    fun reload() {
        loading = true; failed = false; hasMore = true
        scope.launch {
            try { val (p, more) = social.feed(scopeName, emptyList()); posts = p; hasMore = more; social.clearNewPosts() }
            catch (e: Exception) { failed = posts.isEmpty() } finally { loading = false }
        }
    }
    fun more() {
        if (loadingMore || !hasMore || loading) return
        loadingMore = true
        scope.launch {
            try { val (p, m) = social.feed(scopeName, posts.map { it.id }); posts = (posts + p).distinctBy { it.id }; hasMore = m && p.isNotEmpty() } catch (_: Exception) {} finally { loadingMore = false }
        }
    }
    LaunchedEffect(scopeName) { reload() }
    LaunchedEffect(query) {
        if (query.trim().length < 2) { people = emptyList(); searching = false; return@LaunchedEffect }
        searching = true; delay(300)
        people = try { repo.searchUsers(query.trim().removePrefix("@")).filter { it.id != repo.myId } } catch (_: Exception) { emptyList() }
        searching = false
    }
    // Live: someone deleted a post / changed counts
    LaunchedEffect(Unit) {
        social.events.collect { e ->
            when (e.name) {
                "post:deleted" -> { val id = e.data.optString("postId"); posts = posts.filterNot { it.id == id } }
                "post:stats" -> { val id = e.data.optString("postId"); posts = posts.map { if (it.id == id) it.copy(likeCount = e.data.optInt("likeCount", it.likeCount), commentCount = e.data.optInt("commentCount", it.commentCount)) else it } }
            }
        }
    }
    val nearEnd by remember { derivedStateOf { val last = grid.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0; last >= posts.size - 6 } }
    LaunchedEffect(nearEnd, posts.size) { if (nearEnd && posts.isNotEmpty()) more() }

    Box(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize()) {
            WispTopBar("Explore")
            OutlinedTextField(query, { query = it }, Modifier.fillMaxWidth().padding(horizontal = 14.dp), singleLine = true, shape = RoundedCornerShape(26.dp),
                placeholder = { Text("Search people by @username or name") }, leadingIcon = { Icon(Icons.Filled.Search, null) },
                trailingIcon = { if (query.isNotEmpty()) IconButton(onClick = { query = "" }) { Icon(Icons.Filled.Close, "Clear") } },
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search))
            if (query.trim().length >= 2) {
                LazyColumn(Modifier.fillMaxSize()) {
                    if (searching && people.isEmpty()) items(4) { SkeletonRow(it, 44.dp) }
                    else if (people.isEmpty()) item { Text("No people found", color = wc.dim, modifier = Modifier.fillMaxWidth().padding(32.dp), textAlign = TextAlign.Center) }
                    items(people, key = { it.id }) { u -> PersonRow(u) { nav.push(Route.Person(u)) } }
                }
            } else {
                Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf("all" to "For you", "contacts" to "Friends", "discover" to "Discover").forEach { (k, label) ->
                        FilterChip(selected = scopeName == k, onClick = { if (scopeName != k) { scopeName = k; posts = emptyList() } }, label = { Text(label) })
                    }
                }
                when {
                    loading && posts.isEmpty() -> Column(Modifier.fillMaxSize()) { repeat(4) { Row(Modifier.fillMaxWidth()) { repeat(3) { Box(Modifier.weight(1f).aspectRatio(1f).padding(1.dp).shimmer()) } } } }
                    failed -> EmptyState(Icons.Filled.CloudOff, "Couldn't load posts", "Check your connection.") { TextButton(onClick = { reload() }) { Text("Try again") } }
                    posts.isEmpty() -> EmptyState(Icons.Filled.Explore, "Nothing to explore yet", if (scopeName == "contacts") "Your friends haven't posted anything." else "Posts from people will appear here.")
                    else -> LazyVerticalGrid(GridCells.Fixed(3), Modifier.fillMaxSize(), grid, horizontalArrangement = Arrangement.spacedBy(2.dp), verticalArrangement = Arrangement.spacedBy(2.dp), contentPadding = PaddingValues(bottom = 12.dp)) {
                        items(posts, key = { it.id }) { p -> PostThumb(p, Modifier.clickable { nav.push(Route.PostView(posts, posts.indexOf(p))) }) }
                        if (loadingMore) items(3) { Box(Modifier.aspectRatio(1f).shimmer()) }
                    }
                }
            }
        }
        AnimatedVisibility(newPosts > 0 && query.isBlank(), Modifier.align(Alignment.TopCenter).padding(top = 150.dp), enter = fadeIn() + scaleIn(), exit = fadeOut()) {
            Row(Modifier.clip(CircleShape).background(MaterialTheme.colorScheme.primary).clickable { reload(); scope.launch { grid.scrollToItem(0) } }.padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Filled.ArrowUpward, null, Modifier.size(16.dp), tint = WispInk)
                Text("  $newPosts new post${if (newPosts > 1) "s" else ""}", color = WispInk, fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
            }
        }
    }
}

@Composable
fun PersonRow(u: User, trailing: (@Composable () -> Unit)? = null, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().clickable(onClick = onClick).padding(horizontal = 16.dp, vertical = 9.dp), verticalAlignment = Alignment.CenterVertically) {
        UserAvatar(u, 46.dp)
        Column(Modifier.weight(1f).padding(horizontal = 14.dp)) {
            Text(u.displayName, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text("@${u.username}", fontSize = 13.sp, color = wc.dim, maxLines = 1)
        }
        trailing?.invoke()
    }
}

@Composable
fun PostThumb(p: Post, modifier: Modifier = Modifier) {
    Box(modifier.aspectRatio(1f).background(wc.surface3)) {
        if (p.kind == "video") Box(Modifier.fillMaxSize().background(Brush.linearGradient(listOf(wc.surface3, wc.surface4))), Alignment.Center) { Icon(Icons.Filled.PlayCircle, null, Modifier.size(34.dp), tint = wc.dim) }
        else NetworkImage(p.url, Modifier.fillMaxSize())
        if (p.kind == "video") Icon(Icons.Filled.Videocam, null, Modifier.align(Alignment.TopEnd).padding(6.dp).size(16.dp), tint = Color.White)
        if (p.isContact) Text("Friend", Modifier.align(Alignment.BottomStart).padding(5.dp).clip(RoundedCornerShape(6.dp)).background(Color(0x99000000)).padding(horizontal = 5.dp, vertical = 1.dp), color = Color.White, fontSize = 10.sp)
    }
}

/** 3-column grid that can sit inside a scrolling page (no nested lazy lists). */
@Composable
fun PostsGrid(posts: List<Post>, onOpen: (Int) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        posts.chunked(3).forEachIndexed { r, row ->
            Row(horizontalArrangement = Arrangement.spacedBy(2.dp)) {
                row.forEachIndexed { c, p -> PostThumb(p, Modifier.weight(1f).clickable { onOpen(r * 3 + c) }) }
                repeat(3 - row.size) { Spacer(Modifier.weight(1f)) }
            }
        }
    }
}

// ================================================================================================ post viewer

/** Vertical snap feed: swipe up for the next post, double-tap to like, comments in a sheet, endless suggestions at the end. */
@Composable
fun PostViewerScreen(initial: List<Post>, start: Int, nav: Nav) {
    val ctx = LocalContext.current
    val repo = ctx.repo
    val social = repo.social
    val scope = rememberCoroutineScope()
    val list = remember { mutableStateListOf<Post>().apply { addAll(initial) } }
    if (list.isEmpty()) { LaunchedEffect(Unit) { nav.pop() }; return }
    val pager = rememberPagerState(initialPage = start.coerceIn(0, list.lastIndex), pageCount = { list.size })
    var commentsFor by remember { mutableStateOf<String?>(null) }
    var menuFor by remember { mutableStateOf<Post?>(null) }
    var confirmDelete by remember { mutableStateOf<Post?>(null) }
    var loadingMore by remember { mutableStateOf(false) }

    LaunchedEffect(pager.currentPage) {
        if (pager.currentPage >= list.size - 3 && !loadingMore) {
            loadingMore = true
            try { val (more, _) = social.feed("all", list.map { it.id }, 12); list.addAll(more.filter { m -> list.none { it.id == m.id } }) } catch (_: Exception) {} finally { loadingMore = false }
        }
    }
    LaunchedEffect(Unit) {
        social.events.collect { e ->
            val id = e.data.optString("postId")
            val i = list.indexOfFirst { it.id == id }
            if (i < 0) return@collect
            when (e.name) {
                "post:deleted" -> list.removeAt(i)
                "post:stats" -> list[i] = list[i].copy(likeCount = e.data.optInt("likeCount", list[i].likeCount), commentCount = e.data.optInt("commentCount", list[i].commentCount))
            }
        }
    }

    fun toggleLike(i: Int) {
        val p = list.getOrNull(i) ?: return
        list[i] = p.copy(likedByMe = !p.likedByMe, likeCount = (p.likeCount + if (p.likedByMe) -1 else 1).coerceAtLeast(0))
        scope.launch {
            try { val (liked, n) = social.like(p.id); val j = list.indexOfFirst { it.id == p.id }; if (j >= 0) list[j] = list[j].copy(likedByMe = liked, likeCount = n) }
            catch (_: Exception) { val j = list.indexOfFirst { it.id == p.id }; if (j >= 0) list[j] = p }
        }
    }

    Box(Modifier.fillMaxSize().background(Color.Black)) {
        VerticalPager(pager, Modifier.fillMaxSize(), key = { list.getOrNull(it)?.id ?: it }) { page ->
            val p = list.getOrNull(page) ?: return@VerticalPager
            var heart by remember { mutableStateOf(0) }
            Box(Modifier.fillMaxSize()) {
                Box(Modifier.fillMaxSize().pointerInput(p.id) { detectTapGestures(onDoubleTap = { if (!p.likedByMe) toggleLike(page); heart++ }) }, Alignment.Center) {
                    if (p.kind == "video") VideoPlayer(Uri.parse(absoluteUrl(p.url)), Modifier.fillMaxSize(), playing = pager.currentPage == page && commentsFor == null, loop = true)
                    else NetworkImage(p.url, Modifier.fillMaxSize(), ContentScale.Fit)
                }
                var showHeart by remember { mutableStateOf(false) }
                LaunchedEffect(heart) { if (heart > 0) { showHeart = true; delay(650); showHeart = false } }
                AnimatedVisibility(showHeart, Modifier.align(Alignment.Center), enter = scaleIn() + fadeIn(), exit = fadeOut()) { Icon(Icons.Filled.Favorite, null, Modifier.size(110.dp), tint = Color.White.copy(alpha = 0.92f)) }

                // author + caption
                Column(Modifier.align(Alignment.BottomStart).fillMaxWidth().background(Brush.verticalGradient(listOf(Color.Transparent, Color(0xCC000000)))).navigationBarsPadding().padding(start = 14.dp, end = 80.dp, top = 40.dp, bottom = 16.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.clickable { if (!p.isMine) nav.push(Route.Person(p.user)) }) {
                        UserAvatar(p.user, 38.dp)
                        Text(p.user.displayName, color = Color.White, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(start = 10.dp))
                        if (p.isContact) Text("Friend", color = Color.White, fontSize = 11.sp, modifier = Modifier.padding(start = 8.dp).clip(RoundedCornerShape(6.dp)).background(Color(0x55FFFFFF)).padding(horizontal = 6.dp, vertical = 1.dp))
                    }
                    if (p.caption.isNotBlank()) Text(p.caption + if (p.edited) "  (edited)" else "", color = Color.White, fontSize = 14.sp, modifier = Modifier.padding(top = 8.dp), maxLines = 4, overflow = TextOverflow.Ellipsis)
                    Text(formatListTime(p.createdAt), color = Color(0xB3FFFFFF), fontSize = 12.sp, modifier = Modifier.padding(top = 4.dp))
                }
                // action rail
                Column(Modifier.align(Alignment.BottomEnd).navigationBarsPadding().padding(end = 10.dp, bottom = 28.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(16.dp)) {
                    RailButton(if (p.likedByMe) Icons.Filled.Favorite else Icons.Filled.FavoriteBorder, p.likeCount.toString(), if (p.likedByMe) Color(0xFFFF5A6E) else Color.White) { toggleLike(page) }
                    RailButton(Icons.Filled.ChatBubbleOutline, p.commentCount.toString(), Color.White) { commentsFor = p.id }
                    if (p.isMine) RailButton(Icons.Filled.MoreVert, "", Color.White) { menuFor = p }
                }
            }
        }
        IconButton(onClick = { nav.pop() }, Modifier.statusBarsPadding().padding(4.dp)) { Icon(Icons.Filled.ArrowBack, "Back", tint = Color.White) }
    }

    commentsFor?.let { id -> list.firstOrNull { it.id == id }?.let { p ->
        CommentsSheet(p, onDismiss = { commentsFor = null }, onCount = { n -> val j = list.indexOfFirst { it.id == id }; if (j >= 0) list[j] = list[j].copy(commentCount = n) })
    } }
    menuFor?.let { p ->
        Sheet(onDismiss = { menuFor = null }) {
            SheetItem(Icons.Filled.Edit, "Edit post", { menuFor = null; nav.push(Route.NewPost(Uri.EMPTY, p)) })
            SheetItem(Icons.Filled.Delete, "Delete post", { menuFor = null; confirmDelete = p }, tint = MaterialTheme.colorScheme.error)
        }
    }
    confirmDelete?.let { p ->
        ConfirmDialog("Delete this post?", "It will be removed for everyone.", "Delete", true, {
            scope.launch { try { social.deletePost(p.id); list.removeAll { it.id == p.id } } catch (e: Exception) { ctx.toast(e.message ?: "Couldn't delete") } }
        }, { confirmDelete = null })
    }
}

@Composable
private fun RailButton(icon: androidx.compose.ui.graphics.vector.ImageVector, label: String, tint: Color, onClick: () -> Unit) {
    Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.clip(CircleShape).clickable(onClick = onClick).padding(6.dp)) {
        Icon(icon, null, Modifier.size(30.dp), tint = tint)
        if (label.isNotEmpty()) Text(label, color = Color.White, fontSize = 12.sp)
    }
}

@Composable
private fun CommentsSheet(post: Post, onDismiss: () -> Unit, onCount: (Int) -> Unit) {
    val ctx = LocalContext.current
    val social = ctx.repo.social
    val scope = rememberCoroutineScope()
    val comments = remember { mutableStateListOf<Comment>().apply { addAll(post.comments) } }
    var text by remember { mutableStateOf("") }
    var editing by remember { mutableStateOf<Comment?>(null) }
    var actions by remember { mutableStateOf<Comment?>(null) }
    LaunchedEffect(post.id) { runCatching { social.post(post.id) }.getOrNull()?.let { fresh -> comments.clear(); comments.addAll(fresh.comments) } }

    Sheet(onDismiss) {
        Text("Comments", fontWeight = FontWeight.Bold, fontSize = 18.sp, modifier = Modifier.padding(horizontal = 22.dp, vertical = 6.dp))
        LazyColumn(Modifier.heightIn(max = 380.dp)) {
            if (comments.isEmpty()) item { Text("No comments yet. Be the first!", color = wc.dim, modifier = Modifier.fillMaxWidth().padding(28.dp), textAlign = TextAlign.Center) }
            items(comments, key = { it.id }) { c ->
                Row(Modifier.fillMaxWidth().combinedClickable(onClick = {}, onLongClick = { if (c.mine || post.isMine) actions = c }).padding(horizontal = 18.dp, vertical = 8.dp)) {
                    UserAvatar(c.user, 36.dp)
                    Column(Modifier.padding(start = 12.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(c.user?.displayName.orEmpty(), fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
                            Text("  ${formatListTime(c.createdAt)}${if (c.edited) " · edited" else ""}", color = wc.dim, fontSize = 11.sp)
                        }
                        Text(c.text, fontSize = 14.sp)
                    }
                }
            }
        }
        Row(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            OutlinedTextField(text, { text = it.take(500) }, Modifier.weight(1f), singleLine = true, shape = RoundedCornerShape(24.dp), placeholder = { Text(if (editing != null) "Edit comment" else "Add a comment…") })
            IconButton(enabled = text.isNotBlank(), onClick = {
                val t = text; val ed = editing; text = ""; editing = null
                scope.launch {
                    try {
                        if (ed != null) { social.editComment(post.id, ed.id, t); val i = comments.indexOfFirst { it.id == ed.id }; if (i >= 0) comments[i] = ed.copy(text = t, edited = true) }
                        else { comments.add(social.comment(post.id, t)); onCount(comments.size) }
                    } catch (e: Exception) { ctx.toast(e.message ?: "Couldn't post comment") }
                }
            }) { Icon(Icons.Filled.Send, "Send", tint = MaterialTheme.colorScheme.primary) }
        }
    }
    actions?.let { c ->
        AlertDialog(onDismissRequest = { actions = null }, containerColor = wc.surface2, confirmButton = {}, text = {
            Column {
                if (c.mine) SheetItem(Icons.Filled.Edit, "Edit", { actions = null; editing = c; text = c.text })
                SheetItem(Icons.Filled.Delete, "Delete", {
                    actions = null
                    scope.launch { try { social.deleteComment(post.id, c.id); comments.removeAll { it.id == c.id }; onCount(comments.size) } catch (e: Exception) { ctx.toast(e.message ?: "Couldn't delete") } }
                }, tint = MaterialTheme.colorScheme.error)
            }
        })
    }
}

// ================================================================================================ new / edit post

/** Preview + caption for a new post (or edit an existing one). */
@Composable
fun NewPostScreen(uri: Uri, editing: Post?, nav: Nav) {
    val ctx = LocalContext.current
    val social = ctx.repo.social
    val scope = rememberCoroutineScope()
    var media by remember { mutableStateOf(if (uri == Uri.EMPTY) null else uri) }
    var caption by remember { mutableStateOf(editing?.caption.orEmpty()) }
    var busy by remember { mutableStateOf(false) }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { u: Uri? -> if (u != null) media = u }
    val isVideo = media?.let { ctx.contentResolver.getType(it)?.startsWith("video") == true } ?: (editing?.kind == "video")

    Column(Modifier.fillMaxSize().imePadding()) {
        WispTopBar(if (editing != null) "Edit post" else "New post", onBack = { nav.pop() }) {
            TextButton(enabled = !busy && (media != null || editing != null), onClick = {
                busy = true
                scope.launch {
                    try {
                        if (editing != null) social.updatePost(editing.id, caption, media) else social.createPost(media!!, caption)
                        nav.pop()
                    } catch (e: Exception) { ctx.toast(e.message ?: "Couldn't save the post"); busy = false }
                }
            }) { if (busy) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp) else Text(if (editing != null) "Save" else "Post", fontWeight = FontWeight.Bold) }
        }
        Box(Modifier.weight(1f).fillMaxWidth().background(Color.Black), Alignment.Center) {
            when {
                media != null && isVideo -> VideoPlayer(media!!, Modifier.fillMaxSize(), loop = true)
                media != null -> AsyncImage(model = media, contentDescription = null, modifier = Modifier.fillMaxSize(), contentScale = ContentScale.Fit)
                editing != null -> if (editing.kind == "video") VideoPlayer(Uri.parse(absoluteUrl(editing.url)), Modifier.fillMaxSize(), loop = true) else NetworkImage(editing.url, Modifier.fillMaxSize(), ContentScale.Fit)
            }
            if (editing != null) FilledTonalButton(onClick = { picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageAndVideo)) }, modifier = Modifier.align(Alignment.BottomCenter).padding(12.dp)) { Icon(Icons.Filled.Image, null); Text("  Change photo / video") }
        }
        OutlinedTextField(caption, { caption = it.take(500) }, Modifier.fillMaxWidth().padding(14.dp), placeholder = { Text("Write a caption…") }, maxLines = 4, shape = RoundedCornerShape(18.dp))
    }
}

// ================================================================================================ someone's profile

/** A person's profile (a contact or not): hero, bio, Message / Add contact, and their posts. */
@Composable
fun PersonScreen(user: User, nav: Nav) {
    val ctx = LocalContext.current
    val repo = ctx.repo
    val social = repo.social
    val scope = rememberCoroutineScope()
    val contacts by social.contacts.collectAsState()
    val requests by social.requests.collectAsState()
    val isContact = contacts.any { it.id == user.id }
    val outgoing = requests.firstOrNull { it.user.id == user.id && it.outgoing }
    val incoming = requests.firstOrNull { it.user.id == user.id && !it.outgoing }
    var posts by remember { mutableStateOf<List<Post>?>(null) }
    var busy by remember { mutableStateOf(false) }
    var menu by remember { mutableStateOf(false) }
    var confirmBlock by remember { mutableStateOf(false) }
    LaunchedEffect(user.id) { posts = try { social.userPosts(user.id) } catch (_: Exception) { emptyList() } }

    Column(Modifier.fillMaxSize()) {
        WispTopBar(user.displayName, onBack = { nav.pop() }) {
            Box {
                IconButton(onClick = { menu = true }) { Icon(Icons.Filled.MoreVert, "More") }
                DropdownMenu(menu, { menu = false }) { DropdownMenuItem({ Text("Block", color = MaterialTheme.colorScheme.error) }, onClick = { menu = false; confirmBlock = true }) }
            }
        }
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
            Column(Modifier.fillMaxWidth().padding(20.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                UserAvatar(user, 110.dp)
                Text(user.displayName, fontSize = 22.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 12.dp))
                Text("@${user.username}", color = wc.dim)
                if (user.about.isNotBlank()) Text(user.about, modifier = Modifier.padding(top = 10.dp), textAlign = TextAlign.Center)
                Row(Modifier.padding(top = 16.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    when {
                        isContact -> Button(onClick = { scope.launch { try { val c = repo.openDirect(user.id); nav.replaceTop(Route.Chat(c.id)) } catch (e: Exception) { ctx.toast(e.message ?: "Couldn't open chat") } } }) { Icon(Icons.Filled.Chat, null); Text("  Message") }
                        incoming != null -> {
                            Button(onClick = { scope.launch { try { social.respond(incoming.id, true); ctx.toast("You're now contacts") } catch (e: Exception) { ctx.toast(e.message ?: "Failed") } } }) { Text("Accept request") }
                            OutlinedButton(onClick = { scope.launch { try { social.respond(incoming.id, false) } catch (_: Exception) {} } }) { Text("Decline") }
                        }
                        else -> Button(enabled = !busy && outgoing == null, onClick = {
                            busy = true
                            scope.launch { try { social.sendRequest(user.id); ctx.toast("Request sent") } catch (e: Exception) { ctx.toast(e.message ?: "Couldn't send request") }; busy = false }
                        }) { Icon(Icons.Filled.PersonAdd, null); Text(if (outgoing != null) "  Request sent" else "  Add contact") }
                    }
                }
            }
            HorizontalDivider(color = wc.border)
            Row(Modifier.padding(horizontal = 18.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) { Icon(Icons.Filled.GridOn, null, Modifier.size(18.dp), tint = wc.wisp); Text("  Posts", fontWeight = FontWeight.SemiBold) }
            val p = posts
            when {
                p == null -> Column { repeat(2) { Row(Modifier.fillMaxWidth()) { repeat(3) { Box(Modifier.weight(1f).aspectRatio(1f).padding(1.dp).shimmer()) } } } }
                p.isEmpty() -> Text("No posts yet", color = wc.dim, modifier = Modifier.fillMaxWidth().padding(32.dp), textAlign = TextAlign.Center)
                else -> PostsGrid(p) { i -> nav.push(Route.PostView(p, i)) }
            }
            Spacer(Modifier.height(24.dp).navigationBarsPadding())
        }
    }
    if (confirmBlock) ConfirmDialog("Block ${user.displayName}?", "They won't be able to message you or see your status.", "Block", true, {
        scope.launch { try { repo.toggleBlock(user.id); ctx.toast("Blocked"); nav.pop() } catch (e: Exception) { ctx.toast(e.message ?: "Couldn't block") } }
    }, { confirmBlock = false })
}
