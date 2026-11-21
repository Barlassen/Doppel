package ch.doppel.pocket

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val light = lightColorScheme(
    primary = Color(0xFF1E6759),
    onPrimary = Color(0xFFFFFFFF),
    primaryContainer = Color(0xFFD7EDE4),
    onPrimaryContainer = Color(0xFF133C32),
    secondary = Color(0xFF445E56),
    tertiary = Color(0xFF495B91),
    surface = Color(0xFFFAFAF6),
    onSurface = Color(0xFF1B2622),
    onSurfaceVariant = Color(0xFF485750),
    surfaceContainerLow = Color(0xFFF0F3EE),
    surfaceContainerHigh = Color(0xFFE8EEE8),
    outline = Color(0xFF65776D),
    outlineVariant = Color(0xFFCDD8D0),
)

private val dark = darkColorScheme(
    primary = Color(0xFF9AD6C1),
    onPrimary = Color(0xFF08382E),
    primaryContainer = Color(0xFF22483D),
    onPrimaryContainer = Color(0xFFC9EDDF),
    secondary = Color(0xFFAFCAC0),
    tertiary = Color(0xFFB9C7FA),
    surface = Color(0xFF151D19),
    onSurface = Color(0xFFE1EAE3),
    onSurfaceVariant = Color(0xFFC0CEC5),
    surfaceContainerLow = Color(0xFF1C2721),
    surfaceContainerHigh = Color(0xFF29362E),
    outline = Color(0xFF9DAEA3),
    outlineVariant = Color(0xFF405047),
)

internal enum class ThemeMode(val label: String) {
    SYSTEM("pocket.system"), LIGHT("pocket.light"), DARK("pocket.dark")
}

@Composable
internal expect fun PlatformSystemBars(dark: Boolean)

@Composable
internal fun PocketTheme(mode: ThemeMode, content: @Composable () -> Unit) {
    val useDark = when (mode) {
        ThemeMode.SYSTEM -> isSystemInDarkTheme()
        ThemeMode.LIGHT -> false
        ThemeMode.DARK -> true
    }
    PlatformSystemBars(useDark)
    MaterialTheme(colorScheme = if (useDark) dark else light, content = content)
}
