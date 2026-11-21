package ch.doppel.pocket

import java.text.Normalizer
import java.util.Calendar

actual fun localToday(): LocalDate = Calendar.getInstance().let {
    LocalDate(it.get(Calendar.YEAR), it.get(Calendar.MONTH))
}

internal actual fun normalizeUnicode(text: String, decomposed: Boolean): String =
    Normalizer.normalize(text, if (decomposed) Normalizer.Form.NFD else Normalizer.Form.NFC)
