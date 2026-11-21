package ch.doppel.pocket

import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Window
import androidx.compose.ui.window.application
import androidx.compose.ui.window.rememberWindowState

fun main() = application {
    Window(
        onCloseRequest = ::exitApplication,
        title = "Doppel Pocket",
        state = rememberWindowState(width = 1080.dp, height = 780.dp),
    ) {
        PocketApp()
    }
}
