package com.wispchat.app.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.size
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Fill
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.sp
import com.wispchat.app.App
import com.wispchat.app.data.ThemeMode

// ---------------------------------------------------------------------------------------------
// WispChat design tokens — a 1:1 port of the web app's tokens.css + theme.css (dark "wisp glow").
// ---------------------------------------------------------------------------------------------
val Mint = Color(0xFF6FF7CF)          // --wisp
val Sky = Color(0xFF38BDF8)           // --cyan / --wisp-strong
val Violet = Color(0xFFA78BFA)        // --violet
val Ember = Color(0xFFF5A65B)         // --ember
val Danger = Color(0xFFF87171)        // --danger
val Online = Color(0xFF10B981)        // --online
val WispInk = Color(0xFF04141C)       // --wisp-ink (text on mint)
val Ink = Color(0xFF080B12)           // --ink
val Surface0 = Color(0xFF080B12)
val Surface1 = Color(0xFF0F141D)      // --surface
val Surface2 = Color(0xFF151C28)      // --surface-2
val Surface3 = Color(0xFF1E2736)      // --surface-3
val Surface4 = Color(0xFF2A3548)      // --surface-4
val BorderDark = Color(0xFF212B3B)    // --border
val TextMain = Color(0xFFF0F3F6)      // --text
val TextDim = Color(0xFF98A2B3)       // --text-dim
val TextFaint = Color(0xFF626C7A)     // --text-faint
val Brand = Brush.linearGradient(listOf(Color(0xFF7BF7D2), Sky, Color(0xFF8B7CF6)))

/** Extra colours that Material's scheme has no slot for. Read with [wc]. */
@Immutable
class WispColors(
    val dark: Boolean,
    val border: Color,
    val surface2: Color,
    val surface3: Color,
    val surface4: Color,
    val dim: Color,
    val faint: Color,
    val bubbleMine: Brush,
    val onBubbleMine: Color,
    val bubbleTheirs: Color,
    val onBubbleTheirs: Color,
    val wisp: Color,
    val wispDim: Color,
    val danger: Color,
)

private val darkWisp = WispColors(
    dark = true, border = BorderDark, surface2 = Surface2, surface3 = Surface3, surface4 = Surface4,
    dim = TextDim, faint = TextFaint,
    // --bubble-mine-bg: linear-gradient(135deg, rgba(111,247,207,.55), rgba(56,189,248,.45)) on the dark chat canvas
    bubbleMine = Brush.linearGradient(listOf(Color(0xFF3A9C8A), Color(0xFF2D7FA8))),
    onBubbleMine = Color(0xFFF4FFFB),
    bubbleTheirs = Surface2, onBubbleTheirs = TextMain,
    wisp = Mint, wispDim = Color(0x1F6FF7CF), danger = Danger,
)

private val lightWisp = WispColors(
    dark = false, border = Color(0xFFD9E0EA), surface2 = Color(0xFFEEF2F7), surface3 = Color(0xFFE2E8F0), surface4 = Color(0xFFCBD5E1),
    dim = Color(0xFF55627A), faint = Color(0xFF8A96AB),
    bubbleMine = Brush.linearGradient(listOf(Color(0xFFB8F5E3), Color(0xFFA9DDF5))),
    onBubbleMine = Color(0xFF0B1B24),
    bubbleTheirs = Color.White, onBubbleTheirs = Color(0xFF0E1522),
    wisp = Color(0xFF0B8F72), wispDim = Color(0x1A0B8F72), danger = Color(0xFFD92D3A),
)

val LocalWisp = staticCompositionLocalOf { darkWisp }

/** Shorthand for the extra palette inside composables. */
val wc: WispColors @Composable get() = LocalWisp.current

private val darkScheme = darkColorScheme(
    primary = Mint, onPrimary = WispInk,
    secondary = Sky, onSecondary = WispInk, tertiary = Violet,
    background = Ink, onBackground = TextMain,
    surface = Surface1, onSurface = TextMain,
    surfaceVariant = Surface2, onSurfaceVariant = TextDim,
    surfaceContainer = Surface2, surfaceContainerHigh = Surface3, surfaceContainerHighest = Surface3,
    surfaceContainerLow = Surface1, surfaceContainerLowest = Ink,
    outline = BorderDark, outlineVariant = Color(0xFF182030),
    error = Danger, onError = Color(0xFF2B0A0A),
    primaryContainer = Color(0xFF123A33), onPrimaryContainer = Mint,
    inverseSurface = TextMain, inverseOnSurface = Ink,
)

private val lightScheme = lightColorScheme(
    primary = Color(0xFF0B8F72), onPrimary = Color.White,
    secondary = Color(0xFF0B7FB8), tertiary = Color(0xFF6A5BE0),
    background = Color(0xFFF6F8FB), onBackground = Color(0xFF0E1522),
    surface = Color.White, onSurface = Color(0xFF0E1522),
    surfaceVariant = Color(0xFFE9EEF5), onSurfaceVariant = Color(0xFF55627A),
    surfaceContainer = Color(0xFFEEF2F7), surfaceContainerHigh = Color(0xFFE2E8F0), surfaceContainerHighest = Color(0xFFE2E8F0),
    surfaceContainerLow = Color.White, surfaceContainerLowest = Color(0xFFF6F8FB),
    outline = Color(0xFFD9E0EA), outlineVariant = Color(0xFFE6EBF2),
    error = Color(0xFFD92D3A),
)

private val wispTypography = Typography().let { t ->
    fun TextStyle.w() = copy(fontFamily = FontFamily.SansSerif)
    t.copy(
        titleLarge = t.titleLarge.w().copy(fontWeight = FontWeight.Bold, fontSize = 22.sp),
        titleMedium = t.titleMedium.w().copy(fontWeight = FontWeight.SemiBold),
        bodyLarge = t.bodyLarge.w(), bodyMedium = t.bodyMedium.w(), labelLarge = t.labelLarge.w(),
    )
}

/** [forceDark] is for the call screens and viewers, which always sit on a dark canvas. */
@Composable
fun WispTheme(forceDark: Boolean = false, content: @Composable () -> Unit) {
    val ctx = LocalContext.current
    val settings = (ctx.applicationContext as App).repo.settings
    val mode by settings.theme.collectAsState()
    val scale by settings.fontScale.collectAsState()
    val dark = forceDark || when (mode) {
        ThemeMode.DARK -> true
        ThemeMode.LIGHT -> false
        ThemeMode.SYSTEM -> isSystemInDarkTheme()
    }
    val d = LocalDensity.current
    CompositionLocalProvider(
        LocalDensity provides Density(d.density, d.fontScale * scale),
        LocalWisp provides (if (dark) darkWisp else lightWisp),
    ) { MaterialTheme(colorScheme = if (dark) darkScheme else lightScheme, typography = wispTypography, content = content) }
}

private const val BUBBLE = "M256 78C156 78 76 146 76 230c0 50 27 94 70 120l-18 66c-2 9 8 15 15 10l68-49c14 3 29 4 45 4 100 0 180-68 180-151S356 78 256 78z"

/** The app mark (speech bubble + "ping" signal). Icon only — no lettering. */
@Composable
fun Logo(size: Dp, modifier: Modifier = Modifier) {
    val bubble = remember { PathParser().parsePathString(BUBBLE).toPath() }
    Canvas(modifier.size(size)) {
        val k = this.size.width / 512f
        withTransform({ scale(k, k, Offset.Zero) }) {
            drawPath(bubble, Brand, style = Fill)
            val ink = Color(0xFF0A1020)
            drawCircle(ink, 26f, Offset(256f, 232f))
            for ((ri, ro) in listOf(50f to 72f, 92f to 114f)) {
                for (a0 in listOf(-42f, 138f)) {
                    val p = Path().apply { arcRing(256f, 232f, ri, ro, a0, a0 + 84f) }
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
