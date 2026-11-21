package ch.doppel.pocket.twin

import ch.doppel.pocket.LocalDate
import ch.doppel.pocket.finance.EventType
import ch.doppel.pocket.finance.message
import ch.doppel.pocket.normalizeUnicode

internal data class IntentContext(val text: String, val house: ch.doppel.pocket.finance.LifeEvent?, val now: LocalDate)

internal fun String.match(pattern: Regex): MatchResult? = pattern.find(this)
internal operator fun MatchResult.get(index: Int): String = groupValues[index]

/** Parts of a date are optional. Out-of-range values are rejected in Commands.kt. */
internal fun MatchResult.count(index: Int): Int = this[index].toIntOrNull() ?: Int.MAX_VALUE

internal fun months(count: Int, years: Boolean): Int =
    if (years) count.coerceAtMost(Int.MAX_VALUE / 12) * 12 else count

/** Months from now to July, preserving the web parser's zero-based month calculation. */
internal fun monthOfYear(year: Int, now: LocalDate): Int = maxOf(0, (year - now.year) * 12 + (6 - now.month))

private val yearPattern = Regex("""(?<!\d)(20[2-6]\d)(?!\d)""")
internal fun yearIn(text: String): Int? = text.match(yearPattern)?.count(1)

private val thousands = Regex("""(?<![\d.,])(\d{1,3})((?:['    .](\d{3}))+)(?![\d]|[.,]\d)""")
private val currency = Regex("""(?<![\p{L}])(?:chf|sfr\.?|fr\.|franken|francs?|frank|isviçre\s+frangı)(?![\p{L}])""")
private val roundAmount = Regex("""(\d)\.[–—-]{1,2}""")
private val apostrophes = Regex("[’\u0060´]")
private val whitespace = Regex("""[\s\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+""")
private val nonDigit = Regex("""\D""")

internal fun normalizeText(text: String, language: Language): String {
    val preprocessed = if (language == Language.TR) text.replace('I', 'ı').replace('İ', 'i') else text
    return normalizeUnicode(preprocessed.lowercase())
        .replace("\u0307", "")
        .replace(apostrophes, "'")
        .replace(roundAmount, "$1")
        .replace(thousands) { it[1] + it[2].replace(nonDigit, "") }
        .replace(currency, " ")
        .replace(whitespace, " ")
        .trim()
}

internal const val AMOUNT = """(\d+(?:[.,]\d+)?)\s*(k|tsd\.?|tausend|bin|mille|mio\.?|millionen|million|millions|milyon|mn|m)?(?![\p{L}\d])"""
private val amountPattern = Regex(AMOUNT)

internal fun amountValue(n: String, unit: String): Double {
    val v = n.replace(',', '.').toDoubleOrNull() ?: Double.NaN
    return when (unit.lowercase().removeSuffix(".")) {
        "k", "tsd", "tausend", "bin", "mille" -> v * 1_000
        "m", "mio", "mn", "million", "millionen", "millions", "milyon" -> v * 1_000_000
        else -> v
    }
}

internal fun largestAmountAbove(t: String, min: Double): Double? = amountPattern.findAll(t).mapNotNull { m ->
    val value = amountValue(m[1], m[2])
    value.takeIf { it > min && !(it in 2020.0..2069.0 && m[2].isEmpty()) }
}.maxOrNull()

private val labels = mapOf(
    "event.home" to "Home",
    "event.jobLoss" to "Job loss",
    "event.crash" to "Market crash −30%",
    "event.baby" to "Baby",
    "event.raise" to "Raise",
)

internal fun homeEvent(place: String?, month: Int, price: Double): Op.Add {
    val msg = if (place == null) message("event.home") else message("event.homeIn", "place" to place)
    val label = if (place == null) labels.getValue(msg.key) else "Home in $place"
    return Op.Add(EventType.HOUSE, label, month, price, labelMsg = msg)
}

internal fun event(type: EventType, key: String, month: Int, amount: Double, duration: Int? = null): Op.Add =
    Op.Add(type, labels.getValue(key), month, amount, duration, message(key))
