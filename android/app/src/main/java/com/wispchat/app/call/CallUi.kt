package com.wispchat.app.call

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Lock
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.wispchat.app.ui.Avatar
import com.wispchat.app.ui.rememberDoodleBrush

/** Shared look of the call screens: deep gradient with a faint WispChat doodle pattern. */
@Composable
internal fun CallBackdrop(modifier: Modifier = Modifier, content: @Composable androidx.compose.foundation.layout.BoxScope.() -> Unit) {
    val doodle = rememberDoodleBrush(Color.White.copy(alpha = 0.035f))
    Box(modifier.fillMaxSize().background(Brush.verticalGradient(listOf(Color(0xFF123A33), Color(0xFF0B1A24), Color(0xFF070A10)))).background(doodle)) { content() }
}

/** Caller photo with soft expanding rings while it rings. */
@Composable
internal fun CallerPortrait(name: String, avatar: String, color: String, size: Dp, pulsing: Boolean) {
    Box(Modifier.size(size * 1.7f), Alignment.Center) {
        if (pulsing) {
            val t = rememberInfiniteTransition(label = "pulse")
            for (k in 0 until 3) {
                val p by t.animateFloat(0f, 1f, infiniteRepeatable(tween(2400, delayMillis = k * 800, easing = LinearEasing), RepeatMode.Restart), label = "r$k")
                Box(Modifier.size(size).scale(1f + p * 0.7f).graphicsLayer { alpha = (1f - p) * 0.35f }.clip(CircleShape).background(Color(0xFF6FF7CF)))
            }
        }
        Avatar(name, color.ifEmpty { "#6EE7B7" }, size, Modifier.border(3.dp, Color.White.copy(alpha = 0.18f), CircleShape), url = avatar)
    }
}

@Composable
internal fun EncryptedLabel(modifier: Modifier = Modifier) {
    Row(modifier.clip(RoundedCornerShape(12.dp)).background(Color.White.copy(alpha = 0.08f)).padding(horizontal = 10.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(Icons.Rounded.Lock, null, Modifier.size(12.dp), tint = Color.White.copy(alpha = 0.75f))
        Text("  End-to-end encrypted", fontSize = 12.sp, color = Color.White.copy(alpha = 0.75f))
    }
}

/** Round control with a label underneath ("Mute", "Speaker"…). [on] highlights it like a pressed switch. */
@Composable
internal fun CallControl(icon: ImageVector, label: String, onClick: () -> Unit, on: Boolean = false, color: Color? = null, size: Dp = 60.dp) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Box(Modifier.size(size).clip(CircleShape).background(color ?: if (on) Color.White else Color.White.copy(alpha = 0.14f)).clickable(onClick = onClick), Alignment.Center) {
            Icon(icon, label, tint = if (color == null && on) Color(0xFF0B1A24) else Color.White, modifier = Modifier.size(size * 0.42f))
        }
        Text(label, fontSize = 12.sp, color = Color.White.copy(alpha = 0.85f), fontWeight = FontWeight.Medium, modifier = Modifier.padding(top = 6.dp))
    }
}
