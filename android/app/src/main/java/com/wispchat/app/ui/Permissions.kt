package com.wispchat.app.ui

import android.Manifest
import android.annotation.SuppressLint
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.BatteryChargingFull
import androidx.compose.material.icons.outlined.Bluetooth
import androidx.compose.material.icons.outlined.CameraAlt
import androidx.compose.material.icons.outlined.Mic
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material.icons.outlined.PhoneInTalk
import androidx.compose.material.icons.outlined.PhotoLibrary
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.core.content.ContextCompat

/** One thing WispChat needs, asked for on its own with a short reason. Runtime permissions use [perms]; the rest open a settings page. */
private class PermStep(
    val key: String, val icon: ImageVector, val title: String, val why: String,
    val perms: Array<String> = emptyArray(), val settings: ((Context) -> Intent)? = null,
    val granted: (Context) -> Boolean,
)

private fun has(ctx: Context, p: String) = ContextCompat.checkSelfPermission(ctx, p) == PackageManager.PERMISSION_GRANTED

@SuppressLint("BatteryLife")
private fun allSteps(): List<PermStep> = buildList {
    if (Build.VERSION.SDK_INT >= 33) add(PermStep("notif", Icons.Outlined.Notifications, "Notifications",
        "So you know when a message or a call comes in.", arrayOf(Manifest.permission.POST_NOTIFICATIONS)) { has(it, Manifest.permission.POST_NOTIFICATIONS) })
    add(PermStep("mic", Icons.Outlined.Mic, "Microphone", "For voice notes, voice calls and video calls.", arrayOf(Manifest.permission.RECORD_AUDIO)) { has(it, Manifest.permission.RECORD_AUDIO) })
    add(PermStep("camera", Icons.Outlined.CameraAlt, "Camera", "To take photos and videos in WispChat and for video calls.", arrayOf(Manifest.permission.CAMERA)) { has(it, Manifest.permission.CAMERA) })
    val media = when {
        Build.VERSION.SDK_INT >= 34 -> arrayOf(Manifest.permission.READ_MEDIA_IMAGES, Manifest.permission.READ_MEDIA_VIDEO, Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED)
        Build.VERSION.SDK_INT >= 33 -> arrayOf(Manifest.permission.READ_MEDIA_IMAGES, Manifest.permission.READ_MEDIA_VIDEO)
        else -> arrayOf(Manifest.permission.READ_EXTERNAL_STORAGE)
    }
    add(PermStep("media", Icons.Outlined.PhotoLibrary, "Photos and videos", "To show your recent photos in the camera and let you send them.", media) { c ->
        media.any { has(c, it) } })
    if (Build.VERSION.SDK_INT >= 31) add(PermStep("bt", Icons.Outlined.Bluetooth, "Nearby devices", "To use Bluetooth headphones and car audio during calls.",
        arrayOf(Manifest.permission.BLUETOOTH_CONNECT)) { has(it, Manifest.permission.BLUETOOTH_CONNECT) })
    if (Build.VERSION.SDK_INT >= 34) add(PermStep("fsi", Icons.Outlined.PhoneInTalk, "Full-screen calls",
        "So incoming calls ring full screen over the lock screen, like a phone call.",
        settings = { c -> Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, Uri.parse("package:" + c.packageName)) }) {
        it.getSystemService(NotificationManager::class.java).canUseFullScreenIntent() })
    add(PermStep("battery", Icons.Outlined.BatteryChargingFull, "Keep calls ringing",
        "Let WispChat run in the background so calls and messages still arrive when the app is closed.",
        settings = { c -> Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + c.packageName)) }) {
        (it.getSystemService(Context.POWER_SERVICE) as PowerManager).isIgnoringBatteryOptimizations(it.packageName) })
}

/**
 * First-run permissions, ONE AT A TIME: each step explains why, then shows Android's own prompt.
 * "Not now" skips it (it's asked again only from the feature that needs it). Each step is offered once.
 */
@Composable
fun PermissionOnboarding() {
    val ctx = LocalContext.current
    val prefs = remember { ctx.getSharedPreferences("wisp_perm_steps", Context.MODE_PRIVATE) }
    val steps = remember { allSteps().filter { !prefs.getBoolean(it.key, false) && !it.granted(ctx) } }
    var i by remember { mutableIntStateOf(0) }
    fun done() { steps.getOrNull(i)?.let { prefs.edit().putBoolean(it.key, true).apply() }; i++ }
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { done() }
    val step = steps.getOrNull(i) ?: return
    Dialog({ }, DialogProperties(dismissOnBackPress = false, dismissOnClickOutside = false)) {
        Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(24.dp)).background(MaterialTheme.colorScheme.surface).padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Text("${i + 1} of ${steps.size}", color = wc.dim, fontSize = 12.sp)
            Box(Modifier.padding(top = 12.dp).size(64.dp).clip(CircleShape).background(wc.wispDim), Alignment.Center) {
                Icon(step.icon, null, Modifier.size(32.dp), tint = wc.wisp)
            }
            Text(step.title, fontSize = 20.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 14.dp))
            Text(step.why, color = wc.dim, textAlign = TextAlign.Center, modifier = Modifier.padding(top = 6.dp))
            Row(Modifier.fillMaxWidth().padding(top = 20.dp), verticalAlignment = Alignment.CenterVertically) {
                TextButton(onClick = { done() }) { Text("Not now") }
                Spacer(Modifier.weight(1f))
                Button(onClick = {
                    if (step.perms.isNotEmpty()) launcher.launch(step.perms)
                    else { runCatching { ctx.startActivity(step.settings!!(ctx)) }; done() }
                }) { Text("Continue") }
            }
        }
    }
}
