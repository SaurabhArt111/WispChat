package com.pingo.app.ui

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings as AndroidSettings
import android.widget.Toast
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AccountCircle
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Block
import androidx.compose.material.icons.filled.Chat
import androidx.compose.material.icons.filled.DataUsage
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.HelpOutline
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Language
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Logout
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Palette
import androidx.compose.material.icons.filled.PersonAdd
import androidx.compose.material.icons.filled.Photo
import androidx.compose.material.icons.filled.TextFields
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.RadioButton
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
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.pingo.app.BuildConfig
import com.pingo.app.data.AutoDownload
import com.pingo.app.data.Repo
import com.pingo.app.data.ThemeMode
import com.pingo.app.data.User
import com.pingo.app.notify.Notifier
import com.pingo.app.repo
import com.pingo.app.service.RealtimeService
import kotlinx.coroutines.launch

private enum class Page { MAIN, ACCOUNT, PRIVACY, BLOCKED, CHATS, APPEARANCE, NOTIFICATIONS, STORAGE, MANAGE, HELP }

@Composable
fun SettingsScreen(onBack: () -> Unit) {
    var page by remember { mutableStateOf(Page.MAIN) }
    val up: () -> Unit = {
        page = when (page) { Page.MAIN -> { onBack(); Page.MAIN }; Page.BLOCKED -> Page.PRIVACY; Page.MANAGE -> Page.STORAGE; else -> Page.MAIN }
    }
    BackHandler(onBack = up)
    when (page) {
        Page.MAIN -> MainPage(onBack = onBack, go = { page = it })
        Page.ACCOUNT -> AccountPage(up)
        Page.PRIVACY -> PrivacyPage(up) { page = Page.BLOCKED }
        Page.BLOCKED -> BlockedPage(up)
        Page.CHATS -> ChatsPage(up)
        Page.APPEARANCE -> AppearancePage(up)
        Page.NOTIFICATIONS -> NotificationsPage(up)
        Page.STORAGE -> StoragePage(up) { page = Page.MANAGE }
        Page.MANAGE -> ManageStoragePage(up)
        Page.HELP -> HelpPage(up)
    }
}

// ------------------------------------------------------------------ building blocks
@Composable
private fun PageScaffold(title: String, onBack: () -> Unit, content: @Composable () -> Unit) {
    Column(Modifier.fillMaxSize().safeDrawingPadding()) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) { Icon(Icons.Filled.ArrowBack, "Back") }
            Text(title, fontSize = 22.sp, fontWeight = FontWeight.Medium, modifier = Modifier.padding(start = 6.dp))
        }
        HorizontalDivider(color = MaterialTheme.colorScheme.surfaceVariant)
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState())) { content() }
    }
}

@Composable
private fun Item(icon: ImageVector?, title: String, subtitle: String? = null, tint: androidx.compose.ui.graphics.Color = androidx.compose.ui.graphics.Color.Unspecified, trailing: (@Composable () -> Unit)? = null, onClick: (() -> Unit)? = null) {
    Row(Modifier.fillMaxWidth().then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier).padding(horizontal = 24.dp, vertical = 14.dp), verticalAlignment = Alignment.CenterVertically) {
        if (icon != null) Icon(icon, null, Modifier.size(26.dp), tint = if (tint == androidx.compose.ui.graphics.Color.Unspecified) MaterialTheme.colorScheme.onSurfaceVariant else tint)
        else Spacer(Modifier.size(26.dp))
        Column(Modifier.weight(1f).padding(start = 22.dp, end = 8.dp)) {
            Text(title, fontSize = 17.sp, color = if (tint == androidx.compose.ui.graphics.Color.Unspecified) MaterialTheme.colorScheme.onSurface else tint)
            if (subtitle != null) Text(subtitle, fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 2.dp))
        }
        trailing?.invoke()
    }
}

@Composable
private fun SwitchItem(icon: ImageVector?, title: String, subtitle: String?, checked: Boolean, onChange: (Boolean) -> Unit) =
    Item(icon, title, subtitle, trailing = { Switch(checked, onChange) }, onClick = { onChange(!checked) })

@Composable
private fun SectionLabel(text: String) = Text(text, fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(start = 24.dp, top = 18.dp, bottom = 2.dp))

@Composable
private fun <T> ChoiceDialog(title: String, options: List<Pair<T, String>>, selected: T, onPick: (T) -> Unit, onDismiss: () -> Unit) =
    AlertDialog(onDismissRequest = onDismiss, confirmButton = {}, dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } }, title = { Text(title) },
        text = { Column { options.forEach { (v, label) -> Row(Modifier.fillMaxWidth().clickable { onPick(v); onDismiss() }, verticalAlignment = Alignment.CenterVertically) { RadioButton(v == selected, { onPick(v); onDismiss() }); Text(label) } } } })

private fun bytesText(b: Long): String = when { b < 1024 -> "$b B"; b < 1024 * 1024 -> "${b / 1024} KB"; b < 1024L * 1024 * 1024 -> "%.1f MB".format(b / 1048576.0); else -> "%.2f GB".format(b / 1073741824.0) }

// ------------------------------------------------------------------ main (like WhatsApp's Settings)
@Composable
private fun MainPage(onBack: () -> Unit, go: (Page) -> Unit) {
    val ctx = LocalContext.current
    val me by ctx.repo.me.collectAsState()
    PageScaffold("Settings", onBack) {
        Row(Modifier.fillMaxWidth().padding(24.dp), verticalAlignment = Alignment.CenterVertically) {
            Avatar(me?.displayName.orEmpty(), me?.avatarColor.orEmpty(), 68.dp)
            Column(Modifier.padding(start = 18.dp)) {
                Text(me?.displayName.orEmpty(), fontSize = 20.sp, fontWeight = FontWeight.SemiBold)
                Text("@" + me?.username.orEmpty(), fontSize = 14.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        HorizontalDivider(Modifier.padding(horizontal = 24.dp), color = MaterialTheme.colorScheme.surfaceVariant)
        Item(Icons.Filled.AccountCircle, "Account", "Security, sign out") { go(Page.ACCOUNT) }
        Item(Icons.Filled.Lock, "Privacy", "Blocked accounts, encryption") { go(Page.PRIVACY) }
        Item(Icons.Filled.Chat, "Chats", "Enter key, media visibility, chat history") { go(Page.CHATS) }
        Item(Icons.Filled.Palette, "Appearance", "App theme, font size") { go(Page.APPEARANCE) }
        Item(Icons.Filled.Notifications, "Notifications", "Message and call tones, alerts when closed") { go(Page.NOTIFICATIONS) }
        Item(Icons.Filled.DataUsage, "Storage and data", "Manage storage, network usage, auto-download") { go(Page.STORAGE) }
        Item(Icons.Filled.Language, "App language", "Device language") {
            ctx.startActivity(Intent(if (Build.VERSION.SDK_INT >= 33) AndroidSettings.ACTION_APP_LOCALE_SETTINGS else AndroidSettings.ACTION_LOCALE_SETTINGS)
                .apply { if (Build.VERSION.SDK_INT >= 33) data = Uri.parse("package:" + ctx.packageName) })
        }
        Item(Icons.Filled.HelpOutline, "Help and feedback", "App info") { go(Page.HELP) }
        Item(Icons.Filled.PersonAdd, "Invite a contact") {
            ctx.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, "Chat with me on Pingo — private, end-to-end encrypted."), "Invite"))
        }
        Text("Pingo ${BuildConfig.VERSION_NAME}", Modifier.fillMaxWidth().padding(32.dp), fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
    }
}

@Composable
private fun AccountPage(onBack: () -> Unit) {
    val repo = LocalContext.current.repo
    val scope = rememberCoroutineScope()
    var confirm by remember { mutableStateOf(false) }
    PageScaffold("Account", onBack) {
        Item(Icons.Filled.Lock, "Security", "Messages and calls are end-to-end encrypted. Your key never leaves this phone unencrypted.")
        Item(Icons.Filled.Logout, "Sign out", "Also removes downloaded chats and media from this phone", tint = MaterialTheme.colorScheme.error) { confirm = true }
    }
    if (confirm) AlertDialog(onDismissRequest = { confirm = false }, title = { Text("Sign out?") },
        text = { Text("Chats and downloaded media stored on this phone will be removed. They stay on the server and come back when you sign in again.") },
        confirmButton = { TextButton(onClick = { confirm = false; scope.launch { repo.logout() } }) { Text("Sign out", color = MaterialTheme.colorScheme.error) } },
        dismissButton = { TextButton(onClick = { confirm = false }) { Text("Cancel") } })
}

@Composable
private fun PrivacyPage(onBack: () -> Unit, openBlocked: () -> Unit) = PageScaffold("Privacy", onBack) {
    SectionLabel("Who can reach me")
    Item(Icons.Filled.Block, "Blocked accounts", "People you've blocked", onClick = openBlocked)
    SectionLabel("Protection")
    Item(Icons.Filled.Lock, "End-to-end encryption", "Always on for chats where everyone has a key. Downloaded media is stored encrypted on this phone.")
}

@Composable
private fun BlockedPage(onBack: () -> Unit) {
    val repo = LocalContext.current.repo
    val scope = rememberCoroutineScope()
    var list by remember { mutableStateOf<List<User>?>(null) }
    var failed by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { try { list = repo.blocked() } catch (_: Exception) { failed = true } }
    PageScaffold("Blocked accounts", onBack) {
        when {
            failed -> Item(null, "Needs internet", "Connect to see your blocked accounts.")
            list == null -> Item(null, "Loading…")
            list!!.isEmpty() -> Item(null, "No blocked accounts")
            else -> list!!.forEach { u ->
                Item(Icons.Filled.Block, u.displayName, "@${u.username}  ·  tap to unblock") {
                    scope.launch { try { repo.toggleBlock(u.id); list = list!!.filterNot { it.id == u.id } } catch (_: Exception) {} }
                }
            }
        }
    }
}

@Composable
private fun ChatsPage(onBack: () -> Unit) {
    val repo = LocalContext.current.repo
    val st = repo.settings
    val scope = rememberCoroutineScope()
    val enter by st.enterIsSend.collectAsState()
    val gallery by st.saveToGallery.collectAsState()
    var clear by remember { mutableStateOf(false) }
    var alsoMedia by remember { mutableStateOf(true) }
    PageScaffold("Chats", onBack) {
        SectionLabel("Chat settings")
        SwitchItem(null, "Enter is send", "Enter key will send your message", enter, st::setEnterIsSend)
        SwitchItem(null, "Media visibility", "Show newly downloaded media in your device's gallery", gallery, st::setSaveToGallery)
        SectionLabel("History")
        Item(Icons.Filled.Delete, "Clear all chats", "Remove all messages from this phone (they stay on the server)", tint = MaterialTheme.colorScheme.error) { clear = true }
    }
    if (clear) AlertDialog(onDismissRequest = { clear = false }, title = { Text("Clear all chats on this phone?") },
        text = {
            Row(Modifier.clickable { alsoMedia = !alsoMedia }, verticalAlignment = Alignment.CenterVertically) { Checkbox(alsoMedia, { alsoMedia = it }); Text("Also delete downloaded media") }
        },
        confirmButton = { TextButton(onClick = { clear = false; scope.launch { repo.conversations.value.forEach { repo.clearChat(it.id, alsoMedia) } } }) { Text("Clear", color = MaterialTheme.colorScheme.error) } },
        dismissButton = { TextButton(onClick = { clear = false }) { Text("Cancel") } })
}

@Composable
private fun AppearancePage(onBack: () -> Unit) {
    val st = LocalContext.current.repo.settings
    val theme by st.theme.collectAsState()
    val font by st.fontScale.collectAsState()
    var themeDlg by remember { mutableStateOf(false) }
    var fontDlg by remember { mutableStateOf(false) }
    PageScaffold("Appearance", onBack) {
        Item(Icons.Filled.Palette, "Theme", when (theme) { ThemeMode.SYSTEM -> "System default"; ThemeMode.DARK -> "Dark"; ThemeMode.LIGHT -> "Light" }) { themeDlg = true }
        Item(Icons.Filled.TextFields, "Font size", when { font < 0.95f -> "Small"; font > 1.05f -> "Large"; else -> "Medium" }) { fontDlg = true }
    }
    if (themeDlg) ChoiceDialog("Theme", listOf(ThemeMode.SYSTEM to "System default", ThemeMode.LIGHT to "Light", ThemeMode.DARK to "Dark"), theme, st::setTheme) { themeDlg = false }
    if (fontDlg) ChoiceDialog("Font size", listOf(0.88f to "Small", 1f to "Medium", 1.15f to "Large"), font, st::setFontScale) { fontDlg = false }
}

@Composable
private fun NotificationsPage(onBack: () -> Unit) {
    val ctx = LocalContext.current
    val repo = ctx.repo
    val msg by repo.settings.messageNotifications.collectAsState()
    var bg by remember { mutableStateOf(repo.store.backgroundDelivery) }
    fun channel(id: String) = ctx.startActivity(Intent(AndroidSettings.ACTION_CHANNEL_NOTIFICATION_SETTINGS)
        .putExtra(AndroidSettings.EXTRA_APP_PACKAGE, ctx.packageName).putExtra(AndroidSettings.EXTRA_CHANNEL_ID, id))
    PageScaffold("Notifications", onBack) {
        SwitchItem(Icons.Filled.Notifications, "Message notifications", "Show new messages", msg, repo.settings::setMessageNotifications)
        SwitchItem(null, "Alerts when the app is closed", "Keeps a quiet connection so messages and calls arrive in the background", bg) {
            bg = it; repo.store.backgroundDelivery = it; if (it) RealtimeService.startIfWanted(ctx) else RealtimeService.stop(ctx)
        }
        SectionLabel("Messages")
        Item(null, "Notification tone, vibration, pop-up", "Set in Android's notification settings") { channel(Notifier.CH_MESSAGES) }
        SectionLabel("Calls")
        Item(null, "Ringtone and vibration", "Set in Android's notification settings") { channel(Notifier.CH_CALLS) }
        SectionLabel("System")
        Item(null, "All notification settings", "Open Android settings for Pingo") {
            ctx.startActivity(Intent(AndroidSettings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(AndroidSettings.EXTRA_APP_PACKAGE, ctx.packageName))
        }
    }
}

@Composable
private fun StoragePage(onBack: () -> Unit, manage: () -> Unit) {
    val repo = LocalContext.current.repo
    val st = repo.settings
    val mobile by st.onMobile.collectAsState(); val wifi by st.onWifi.collectAsState(); val roam by st.onRoaming.collectAsState()
    var total by remember { mutableStateOf(0L) }
    LaunchedEffect(Unit) { total = repo.media.totalSize() }
    var dlg by remember { mutableStateOf<String?>(null) }
    fun label(a: AutoDownload) = when (a) { AutoDownload.NONE -> "No media"; AutoDownload.PHOTOS -> "Photos"; AutoDownload.ALL -> "All media" }
    val opts = listOf(AutoDownload.NONE to "No media", AutoDownload.PHOTOS to "Photos", AutoDownload.ALL to "All media")
    PageScaffold("Storage and data", onBack) {
        Item(Icons.Filled.Folder, "Manage storage", bytesText(total), onClick = manage)
        HorizontalDivider(Modifier.padding(horizontal = 24.dp), color = MaterialTheme.colorScheme.surfaceVariant)
        Item(Icons.Filled.DataUsage, "Network usage", "${bytesText(st.bytesSent)} sent • ${bytesText(st.bytesReceived)} received  ·  tap to reset") { st.bytesSent = 0; st.bytesReceived = 0 }
        SectionLabel("Media auto-download")
        Item(null, "When using mobile data", label(mobile)) { dlg = "m" }
        Item(null, "When connected on Wi-Fi", label(wifi)) { dlg = "w" }
        Item(null, "When roaming", label(roam)) { dlg = "r" }
        Text("Media that isn't downloaded automatically shows a download button in the chat. Downloaded media stays on this phone, so you can open it without internet.",
            fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(24.dp))
    }
    when (dlg) {
        "m" -> ChoiceDialog("When using mobile data", opts, mobile, st::setOnMobile) { dlg = null }
        "w" -> ChoiceDialog("When connected on Wi-Fi", opts, wifi, st::setOnWifi) { dlg = null }
        "r" -> ChoiceDialog("When roaming", opts, roam, st::setOnRoaming) { dlg = null }
    }
}

@Composable
private fun ManageStoragePage(onBack: () -> Unit) {
    val repo = LocalContext.current.repo
    val scope = rememberCoroutineScope()
    var rows by remember { mutableStateOf<List<Repo.ChatStorage>?>(null) }
    var confirmAll by remember { mutableStateOf(false) }
    var gallery by remember { mutableStateOf(false) }
    fun reload() = scope.launch { rows = repo.storageByChat() }
    LaunchedEffect(Unit) { rows = repo.storageByChat() }
    PageScaffold("Manage storage", onBack) {
        val total = rows?.sumOf { it.bytes } ?: 0L
        Item(Icons.Filled.Folder, "Downloaded media", bytesText(total))
        Item(Icons.Filled.Delete, "Delete all downloaded media", "Messages stay; files can be downloaded again while they are on the server", tint = MaterialTheme.colorScheme.error) { confirmAll = true }
        SectionLabel("By chat")
        when {
            rows == null -> Item(null, "Loading…")
            rows!!.isEmpty() -> Item(null, "Nothing downloaded yet")
            else -> rows!!.forEach { r ->
                Item(Icons.Filled.Photo, r.title, "${bytesText(r.bytes)} · ${r.files} file${if (r.files == 1) "" else "s"}  ·  tap to delete") {
                    scope.launch { repo.media.clearConversation(r.convId, alsoGallery = false); reload() }
                }
            }
        }
    }
    if (confirmAll) AlertDialog(onDismissRequest = { confirmAll = false }, title = { Text("Delete all downloaded media?") },
        text = { Row(Modifier.clickable { gallery = !gallery }, verticalAlignment = Alignment.CenterVertically) { Checkbox(gallery, { gallery = it }); Text("Also remove copies saved to my gallery by Pingo") } },
        confirmButton = { TextButton(onClick = { confirmAll = false; scope.launch { repo.db.allMedia().map { it.url }.let { repo.media.deleteFiles(it, gallery) }; repo.media.clearAll(); reload() } }) { Text("Delete", color = MaterialTheme.colorScheme.error) } },
        dismissButton = { TextButton(onClick = { confirmAll = false }) { Text("Cancel") } })
}

@Composable
private fun HelpPage(onBack: () -> Unit) = PageScaffold("Help and feedback", onBack) {
    Item(Icons.Filled.Info, "App info", "Pingo ${BuildConfig.VERSION_NAME}\nServer: ${BuildConfig.BACKEND_URL}")
}
