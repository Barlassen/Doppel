package ch.doppel.pocket.snap

import ch.doppel.pocket.finance.Category

data class Creditor(val name: String, val postcode: String, val town: String, val country: String)
data class QrBill(
    val iban: String,
    val creditor: Creditor,
    val amount: Double?,
    val currency: String,
    val debtorName: String?,
    val referenceType: String,
    val reference: String,
    val message: String,
    val billingInfo: String,
) {
    val category: Category get() = if (insurance.containsMatchIn(creditor.name + message)) Category.INSURANCE else Category.BILLS
}

private val version = Regex("""02\d{2}""")
private val insurance = Regex("kranken|versicherung|assurance|insurance", RegexOption.IGNORE_CASE)

/** Swiss QR-bill (SIX v2.x), preserving optional fields and line positions. */
fun parseQrBill(raw: String): QrBill? {
    val lines = raw.replace("\r\n", "\n").split('\n')
    if (lines.getOrNull(0) != "SPC" || !version.matches(lines.getOrNull(1).orEmpty()) ||
        lines.getOrNull(2) != "1" || lines.getOrNull(30) != "EPD") return null
    fun line(index: Int) = lines.getOrNull(index).orEmpty()
    val structured = line(4) == "S"
    return QrBill(
        iban = line(3),
        creditor = Creditor(line(5), if (structured) line(8) else "", line(if (structured) 9 else 7), line(10)),
        amount = line(18).toDoubleOrNull()?.takeIf { it.isFinite() && it in 0.0..50_000_000.0 },
        currency = lines.getOrNull(19) ?: "CHF",
        debtorName = line(21).ifEmpty { null },
        referenceType = lines.getOrNull(27) ?: "NON",
        reference = line(28),
        message = line(29),
        billingInfo = line(31),
    )
}
