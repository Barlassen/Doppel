package ch.doppel.pocket

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.intl.Locale
import androidx.compose.ui.unit.dp
import ch.doppel.pocket.finance.*
import ch.doppel.pocket.twin.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

private enum class Screen(val label: String) {
    OVERVIEW("pocket.overview"), WHAT_IF("pocket.whatIf"), RECIPES("recipes.title")
}

private data class Plan(
    val scenario: Scenario,
    val changes: List<Message> = emptyList(),
    val previousProbability: Double? = null,
)

private data class Evaluation(val profileId: String, val scenario: Scenario, val result: TwinResult)

@Composable
fun PocketApp() {
    var language by rememberSaveable {
        mutableStateOf(Language.entries.firstOrNull { it.tag == Locale.current.language } ?: Language.EN)
    }
    var theme by rememberSaveable { mutableStateOf(ThemeMode.SYSTEM) }
    var profileId by rememberSaveable { mutableStateOf(profiles.first().id) }
    var screen by rememberSaveable { mutableStateOf(Screen.OVERVIEW) }
    val plans = remember { mutableStateMapOf<String, Plan>() }
    val profile = profiles.first { it.id == profileId }
    val base = remember(profile) { baseScenario(profile) }
    val plan = plans[profileId] ?: Plan(base)
    val scenario = plan.scenario
    val evaluation by produceState<Evaluation?>(null, profile, scenario) {
        value = withContext(Dispatchers.Default) {
            Evaluation(profile.id, scenario, calculateTwins(profile, scenario))
        }
    }
    val result = evaluation?.takeIf { it.profileId == profile.id && it.scenario == scenario }?.result
    var command by rememberSaveable(profileId) { mutableStateOf("") }

    fun update(next: Scenario, changes: List<Message>) {
        plans[profileId] = Plan(next, changes, result?.real?.successProb)
        screen = Screen.OVERVIEW
    }

    CompositionLocalProvider(LocalLanguage provides language) {
        key(language) {
            PocketTheme(theme) {
                Surface(Modifier.fillMaxSize()) {
                    Column(
                        Modifier.fillMaxSize().safeDrawingPadding(),
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        Row(
                            Modifier.widthIn(max = 1080.dp).fillMaxWidth().padding(horizontal = 18.dp, vertical = 8.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text("Doppel Pocket", style = MaterialTheme.typography.titleLarge,
                                modifier = Modifier.weight(1f))
                            ProfilePicker(profile) {
                                profileId = it.id
                                screen = Screen.OVERVIEW
                            }
                            SettingsMenu(language, theme, onLanguage = {
                                setResourceLanguage(it)
                                language = it
                            }, onTheme = { theme = it })
                        }
                        PrimaryTabRow(
                            selectedTabIndex = screen.ordinal,
                            modifier = Modifier.widthIn(max = 1040.dp),
                            containerColor = MaterialTheme.colorScheme.surface,
                        ) {
                            for (item in Screen.entries) {
                                Tab(selected = item == screen, onClick = { screen = item }, text = {
                                    Text(localized(item.label), maxLines = 2)
                                })
                            }
                        }
                        key(screen, profileId) {
                            Column(
                                Modifier.fillMaxSize().imePadding().verticalScroll(rememberScrollState()),
                                horizontalAlignment = Alignment.CenterHorizontally,
                            ) {
                                Column(
                                    Modifier.widthIn(max = 1080.dp).fillMaxWidth().padding(20.dp),
                                    verticalArrangement = Arrangement.spacedBy(16.dp),
                                ) {
                                    when (screen) {
                                        Screen.OVERVIEW -> {
                                            if (plan.changes.isNotEmpty()) {
                                                ChangeSummary(plan, result) { plans.remove(profileId) }
                                            }
                                            if (result == null) Loading("cmd.simulating") else Overview(profile, result)
                                        }
                                        Screen.WHAT_IF -> WhatIf(
                                            command, { command = it }, scenario.events, language,
                                        ) { ops ->
                                            command = ""
                                            update(applyScenarioOps(scenario, ops), ops.map(::describeOp))
                                        }
                                        Screen.RECIPES -> {
                                            if (result == null) Loading("cmd.simulating") else FindPath(profile, scenario, result) {
                                                update(applyRecipe(scenario, it), listOf(it.title))
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun ProfilePicker(profile: Profile, onChange: (Profile) -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    val label = localized("header.profiles")
    Box {
        OutlinedButton(
            onClick = { expanded = true },
            modifier = Modifier.semantics { contentDescription = "$label · ${profile.name}" },
        ) { Text(profile.name) }
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            Text(label, style = MaterialTheme.typography.labelMedium, modifier = Modifier.padding(12.dp))
            for (demo in profiles) {
                DropdownMenuItem(
                    text = { Text("${demo.name} · ${demo.city}") },
                    leadingIcon = { RadioButton(selected = demo == profile, onClick = null) },
                    onClick = { onChange(demo); expanded = false },
                )
            }
        }
    }
}

@Composable
private fun SettingsMenu(
    language: Language,
    theme: ThemeMode,
    onLanguage: (Language) -> Unit,
    onTheme: (ThemeMode) -> Unit,
) {
    var expanded by remember { mutableStateOf(false) }
    val label = localized("pocket.settings")
    Box {
        IconButton(onClick = { expanded = true }, modifier = Modifier.semantics { contentDescription = label }) {
            Text("⋯", style = MaterialTheme.typography.headlineSmall)
        }
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            Text(localized("lang.switcher"), style = MaterialTheme.typography.labelMedium,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp))
            for ((option, name) in languageNames) {
                DropdownMenuItem(
                    text = { Text(name) },
                    leadingIcon = { RadioButton(selected = option == language, onClick = null) },
                    onClick = { onLanguage(option); expanded = false },
                )
            }
            HorizontalDivider()
            Text(localized("pocket.appearance"), style = MaterialTheme.typography.labelMedium,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp))
            for (option in ThemeMode.entries) {
                DropdownMenuItem(
                    text = { Text(localized(option.label)) },
                    leadingIcon = { RadioButton(selected = option == theme, onClick = null) },
                    onClick = { onTheme(option); expanded = false },
                )
            }
        }
    }
}

private val languageNames = mapOf(Language.EN to "English", Language.DE to "Deutsch",
    Language.FR to "Français", Language.TR to "Türkçe")

@Composable
private fun ChangeSummary(plan: Plan, result: TwinResult?, onReset: () -> Unit) {
    SectionCard(Modifier.fillMaxWidth()) {
        val before = plan.previousProbability
        if (before != null && result != null) {
            Text(localized("pocket.applied", "before" to before, "after" to result.real.successProb),
                color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.titleSmall)
        }
        for (change in plan.changes) Text(localized(change), style = MaterialTheme.typography.bodyMedium)
        TextButton(onClick = onReset, modifier = Modifier.align(Alignment.End)) { Text(localized("pocket.reset")) }
    }
}

@Composable
private fun Loading(label: String) {
    LinearProgressIndicator(Modifier.fillMaxWidth())
    Text(localized(label), style = MaterialTheme.typography.bodyMedium)
}

private val examples = listOf("jobLoss", "delay", "crash", "baby", "retire", "invest")

@Composable
private fun WhatIf(
    command: String,
    onCommand: (String) -> Unit,
    events: List<LifeEvent>,
    language: Language,
    onApply: (List<Op>) -> Unit,
) {
    var noMatch by remember { mutableStateOf(false) }
    val focus = LocalFocusManager.current
    fun submit() {
        if (command.isBlank()) return
        val ops = localParseCommand(command, events, language = language)
        noMatch = ops.isEmpty()
        if (!noMatch) {
            focus.clearFocus()
            onApply(ops)
        }
    }

    SectionCard(Modifier.fillMaxWidth()) {
        OutlinedTextField(
            command,
            onValueChange = { noMatch = false; onCommand(it) },
            modifier = Modifier.fillMaxWidth(),
            label = { Text(localized("cmd.inputAria")) },
            singleLine = true,
            isError = noMatch,
            supportingText = if (noMatch) {{ Text(localized("pocket.cannotParse")) }} else null,
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Go),
            keyboardActions = KeyboardActions(onGo = { submit() }),
        )
        Button(onClick = ::submit, enabled = command.isNotBlank(), modifier = Modifier.align(Alignment.End)) {
            Text(localized("cmd.simulate"))
        }
    }
    Text(localized("cmd.examplesAria"), style = MaterialTheme.typography.titleMedium)
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        for (example in examples) {
            if (example == "delay" && events.none { it.type == EventType.HOUSE }) continue
            val text = localized("cmd.examples.$example")
            AssistChip(onClick = { noMatch = false; onCommand(text) }, label = { Text(text) })
        }
    }
}

@Composable
private fun FindPath(profile: Profile, scenario: Scenario, twins: TwinResult, onApply: (Recipe) -> Unit) {
    key(profile.id, scenario) {
        val solver by produceState<SolverResult?>(null) {
            value = withContext(Dispatchers.Default) {
                solveGoal(simInputFor(profile, scenario, twins.behavior.params), twins.behavior.spendTip)
            }
        }
        val solution = solver
        if (solution == null) {
            Loading("recipes.solving")
        } else if (solution.recipes.isEmpty()) {
            SectionCard(Modifier.fillMaxWidth()) {
                Text(localized(if (solution.baseProb >= TARGET) "pocket.onTrack" else "pocket.noRecipe"))
            }
        } else {
            for (recipe in solution.recipes) {
                SectionCard(Modifier.fillMaxWidth()) {
                    Text(localized(recipe.title), style = MaterialTheme.typography.titleMedium)
                    Text(localized(recipe.detail), color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        val odds = percent(recipe.newProb)
                        Text(if (recipe.reaches) odds else localized("recipes.improvesTo") + " " + odds,
                            color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.titleMedium,
                            modifier = Modifier.weight(1f))
                        Button(onClick = { onApply(recipe) }) { Text(localized("recipes.apply")) }
                    }
                }
            }
        }
    }
}
