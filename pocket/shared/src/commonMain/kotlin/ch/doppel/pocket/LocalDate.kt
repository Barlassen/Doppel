package ch.doppel.pocket

/** The month is zero-based, matching Date.getMonth() in Doppel. */
data class LocalDate(val year: Int, val month: Int)

expect fun localToday(): LocalDate

internal expect fun normalizeUnicode(text: String, decomposed: Boolean = false): String
