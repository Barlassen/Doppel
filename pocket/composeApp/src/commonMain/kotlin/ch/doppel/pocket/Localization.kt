package ch.doppel.pocket

import androidx.compose.runtime.Composable
import androidx.compose.runtime.staticCompositionLocalOf
import ch.doppel.pocket.finance.Message
import ch.doppel.pocket.finance.message
import ch.doppel.pocket.resources.Res
import ch.doppel.pocket.resources.allStringResources
import ch.doppel.pocket.twin.Language
import org.jetbrains.compose.resources.stringResource
import kotlin.math.abs
import kotlin.math.roundToLong

internal val LocalLanguage = staticCompositionLocalOf { Language.EN }
internal expect fun setResourceLanguage(language: Language)

private val placeholder = Regex("""\{(\w+)(?::(\w+))?\}""")

@Composable
internal fun localized(key: String, vararg params: Pair<String, Any>): String = localized(message(key, *params))

@Composable
internal fun localized(message: Message): String {
    val key = message.key.replace('.', '_').lowercase()
    val resource = checkNotNull(Res.allStringResources[key]) { "Missing Pocket string ${message.key}" }
    val template = stringResource(resource)
    if (message.params.isEmpty()) return template

    val language = LocalLanguage.current
    val params = mutableMapOf<String, Any>()
    for ((name, value) in message.params) params[name] = if (value is Message) localized(value) else value
    return placeholder.replace(template) { match ->
        val value = params.getValue(match.groupValues[1])
        if (value is Number) format(value.toDouble(), match.groupValues[2], language) else value.toString()
    }
}

internal fun swissInteger(value: Long): String {
    val digits = value.toString().removePrefix("-").reversed().chunked(3).joinToString("'").reversed()
    return if (value < 0) "−$digits" else digits
}

internal fun chf(value: Double): String = "CHF " + swissInteger(value.roundToLong())

private fun chfWithCents(value: Double, language: Language): String {
    val cents = (abs(value) * 100).roundToLong()
    val separator = if (language == Language.FR || language == Language.TR) ',' else '.'
    val fraction = (cents % 100).toString().padStart(2, '0')
    val prefix = if (value < 0) "−CHF " else "CHF "
    return prefix + swissInteger(cents / 100) + separator + fraction
}

@Composable
internal fun percent(value: Double): String = percent(value, LocalLanguage.current, 1)

private fun percent(probability: Double, language: Language, digits: Int): String {
    if (!probability.isFinite()) return "—"
    val number = decimal(probability * 100, language, digits)
    return when (language) {
        Language.FR -> "$number\u202f%"
        Language.TR -> "%$number"
        else -> "$number%"
    }
}

private fun decimal(value: Double, language: Language, digits: Int, trimZeros: Boolean = false): String {
    val factor = when (digits) { 0 -> 1; 1 -> 10; else -> 100 }
    val rounded = (abs(value) * factor).roundToLong()
    val sign = if (value < 0 && rounded != 0L) "−" else ""
    val whole = sign + (rounded / factor)
    if (digits == 0) return whole
    val chars = (rounded % factor).toString().padStart(digits, '0')
    val fraction = if (trimZeros) chars.trimEnd('0') else chars
    val separator = if (language == Language.FR || language == Language.TR) ',' else '.'
    return if (fraction.isEmpty()) whole else whole + separator + fraction
}

internal fun compactChf(value: Double, language: Language): String = when {
    abs(value) >= 1e6 -> decimal(value / 1e6, language, 2, trimZeros = true) + "M"
    abs(value) >= 1e3 -> decimal(value / 1e3, language, 0) + "k"
    else -> decimal(value, language, 0)
}

private fun format(value: Double, kind: String, language: Language): String = when (kind) {
    "chf" -> chf(value)
    "chf2" -> chfWithCents(value, language)
    "chfShort" -> compactChf(value, language)
    "chfSigned" -> sign(value) + chf(abs(value))
    "mio" -> decimal(value / 1e6, language, 2, trimZeros = true)
    "pct" -> percent(value, language, 0)
    "pct1" -> percent(value, language, 1)
    "int" -> swissInteger(value.roundToLong())
    "num1" -> decimal(value, language, 1)
    "signed" -> sign(value) + decimal(abs(value), language, 2, trimZeros = true)
    else -> decimal(value, language, 2, trimZeros = true)
}

private fun sign(value: Double): String = when {
    value > 0 -> "+"
    value < 0 -> "−"
    else -> ""
}
