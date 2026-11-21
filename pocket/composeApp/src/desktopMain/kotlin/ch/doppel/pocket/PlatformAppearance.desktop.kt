package ch.doppel.pocket

import androidx.compose.runtime.Composable
import ch.doppel.pocket.twin.Language
import java.util.Locale

internal actual fun setResourceLanguage(language: Language) {
    Locale.setDefault(Locale.forLanguageTag(language.tag))
}

@Composable
internal actual fun PlatformSystemBars(dark: Boolean) = Unit
