package ch.doppel.pocket

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier

@Composable
fun PocketApp() = MaterialTheme {
    Surface {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Text("Doppel Pocket")
        }
    }
}
