package ch.doppel.pocket

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import ch.doppel.pocket.finance.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

@Composable
fun PocketApp() = PocketTheme {
    var profile by remember { mutableStateOf(profiles.first()) }
    val selected = profile
    val twins by produceState<Pair<Profile, TwinResult>?>(null, selected) {
        value = withContext(Dispatchers.Default) { selected to calculateTwins(selected, baseScenario(selected)) }
    }
    Surface(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize().safeDrawingPadding(), horizontalAlignment = Alignment.CenterHorizontally) {
            Row(
                Modifier.widthIn(max = 1080.dp).fillMaxWidth().padding(horizontal = 20.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("Doppel Pocket", style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f))
                ProfilePicker(selected) { profile = it }
            }
            HorizontalDivider()
            Column(
                Modifier.fillMaxSize().verticalScroll(rememberScrollState()),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Column(
                    Modifier.widthIn(max = 1080.dp).fillMaxWidth().padding(20.dp),
                    verticalArrangement = Arrangement.spacedBy(16.dp),
                ) {
                    val result = twins?.takeIf { it.first == selected }?.second
                    if (result == null) {
                        LinearProgressIndicator(Modifier.fillMaxWidth())
                        Text("Simulating…")
                    } else {
                        Overview(selected, result)
                    }
                }
            }
        }
    }
}

@Composable
private fun ProfilePicker(profile: Profile, onChange: (Profile) -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    Box {
        OutlinedButton(onClick = { expanded = true }) { Text(profile.name) }
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            Text("Demo profile", style = MaterialTheme.typography.labelMedium, modifier = Modifier.padding(12.dp))
            for (demo in profiles) {
                DropdownMenuItem(text = { Text("${demo.name} · ${demo.city}") }, onClick = {
                    onChange(demo)
                    expanded = false
                })
            }
        }
    }
}
