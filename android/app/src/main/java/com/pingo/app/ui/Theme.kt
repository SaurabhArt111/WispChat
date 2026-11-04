package com.pingo.app.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Fill
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.graphics.drawscope.scale

val Mint = Color(0xFF6FF7CF)
val Sky = Color(0xFF38BDF8)
val Violet = Color(0xFF8B7CF6)
val Ink = Color(0xFF080B12)
val Surface0 = Color(0xFF0B0E12)
val Surface1 = Color(0xFF0F141D)
val Surface2 = Color(0xFF151C28)
val Surface3 = Color(0xFF1E2736)
val Brand = Brush.linearGradient(listOf(Mint, Sky, Violet))

private val scheme = darkColorScheme(
    primary = Mint, onPrimary = Color(0xFF04141C),
    secondary = Sky, tertiary = Violet,
    background = Surface0, onBackground = Color(0xFFE8EEF7),
    surface = Surface1, onSurface = Color(0xFFE8EEF7),
    surfaceVariant = Surface2, onSurfaceVariant = Color(0xFF9AA8BD),
    error = Color(0xFFFF6B6B),
)

@Composable
fun PingoTheme(content: @Composable () -> Unit) = MaterialTheme(colorScheme = scheme, content = content)

private const val BUBBLE = "M256 78C156 78 76 146 76 230c0 50 27 94 70 120l-18 66c-2 9 8 15 15 10l68-49c14 3 29 4 45 4 100 0 180-68 180-151S356 78 256 78z"

/** The app mark (speech bubble + "ping" signal). Icon only — no lettering. */
@Composable
fun Logo(size: Dp, modifier: Modifier = Modifier) {
    val bubble = androidx.compose.runtime.remember { PathParser().parsePathString(BUBBLE).toPath() }
    Canvas(modifier.size(size)) {
        val k = this.size.width / 512f
        withTransform({ scale(k, k, Offset.Zero) }) {
            drawPath(bubble, Brand, style = Fill)
            val ink = Color(0xFF0A1020)
            drawCircle(ink, 26f, Offset(256f, 232f))
            for ((ri, ro) in listOf(50f to 72f, 92f to 114f)) {
                for (a0 in listOf(-42f, 138f)) {
                    val p = Path().apply {
                        arcRing(256f, 232f, ri, ro, a0, a0 + 84f)
                    }
                    drawPath(p, ink, style = Fill)
                }
            }
        }
    }
}

private fun Path.arcRing(cx: Float, cy: Float, ri: Float, ro: Float, a0: Float, a1: Float) {
    val outer = androidx.compose.ui.geometry.Rect(cx - ro, cy - ro, cx + ro, cy + ro)
    val inner = androidx.compose.ui.geometry.Rect(cx - ri, cy - ri, cx + ri, cy + ri)
    arcTo(outer, a0, a1 - a0, true)
    arcTo(inner, a1, -(a1 - a0), false)
    close()
}

@Composable
fun Avatar(name: String, colorHex: String, size: Dp, modifier: Modifier = Modifier) {
    val c = try { Color(android.graphics.Color.parseColor(colorHex.ifEmpty { "#6EE7B7" })) } catch (_: Exception) { Mint }
    Box(modifier.size(size).clip(CircleShape).background(c), contentAlignment = Alignment.Center) {
        Text(name.trim().take(1).uppercase().ifEmpty { "?" }, color = Color(0xFF0A1020), fontWeight = FontWeight.Bold, fontSize = (size.value * 0.42f).sp)
    }
}
