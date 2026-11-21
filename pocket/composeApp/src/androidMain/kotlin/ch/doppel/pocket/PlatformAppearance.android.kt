package ch.doppel.pocket

import android.app.Activity
import android.os.LocaleList
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat
import ch.doppel.pocket.twin.Language
import java.util.Locale

internal actual fun setResourceLanguage(language: Language) {
    val locale = Locale.forLanguageTag(language.tag)
    LocaleList.setDefault(LocaleList(locale))
}

@Composable
internal actual fun PlatformSystemBars(dark: Boolean) {
    val view = LocalView.current
    val activity = view.context as? Activity ?: return
    SideEffect {
        with(WindowCompat.getInsetsController(activity.window, view)) {
            isAppearanceLightStatusBars = !dark
            isAppearanceLightNavigationBars = !dark
        }
    }
}
